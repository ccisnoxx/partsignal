"""Overview 的事件贡献、质量口径及完整cell分栏金标。"""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.geo_insights import GeoOverviewFilters
from app.services.geo_metric_inputs import metric_run_from_snapshot
from app.services.geo_metric_types import MetricCitation, MetricClaim
from app.services.geo_overview import _cells, _quality, _quality_card
from app.services.geo_overview_queries import OverviewInput
from tests.unit.test_geo_metric_inputs import case


def source():
    values = case()
    values["integrity_valid"] = True
    values["analysis_detail"].revisions[0].analysis.review_required_reasons = []
    values["analysis_detail"].selection.current_review_id = None
    metric = metric_run_from_snapshot(**values)
    now = datetime.now(UTC)
    return OverviewInput(
        metric, values["snapshot"], now, now, uuid4(), None, None, None, False, True
    )


def filters(**patch):
    return GeoOverviewFilters(
        date_from=datetime(2026, 1, 1, tzinfo=UTC),
        date_to=datetime(2027, 1, 1, tzinfo=UTC),
        **patch,
    )


def test_quality_terminal_denominator_and_current_run_coverage():
    first = source()
    values = [first] + [
        replace(
            first,
            metric=replace(
                first.metric,
                run_id=uuid4(),
                status=status,
                answer_present=collected,
                current_analysis_available=analysed,
            ),
        )
        for status, collected, analysed in (
            ("FAILED", True, False),
            ("PENDING", False, False),
            ("PENDING", False, False),
            ("BUDGET_BLOCKED", False, False),
        )
    ]
    parts = _quality(values, filters())
    success = _quality_card("run_success_rate", parts["run_success_rate"], filters())
    analysis = _quality_card("analysis_run_coverage", parts["analysis_run_coverage"], filters())
    assert (success.numerator, success.denominator, success.value) == (1, 2, 0.5)
    assert (analysis.numerator, analysis.denominator, analysis.value) == (1, 2, 0.5)
    assert _quality_card("cost_coverage", parts["cost_coverage"], filters()).value == 0


def test_claim_event_denominator_is_reproducible_from_run_contributions():
    value = source()
    subject = value.snapshot.subjects[0].id
    value = replace(
        value,
        metric=replace(
            value.metric,
            claims=(
                MetricClaim(subject, "ACCURATE", "LOW"),
                MetricClaim(subject, "INCORRECT", "HIGH"),
                MetricClaim(subject, "UNJUDGEABLE", "LOW"),
            ),
        ),
    )
    cells, parts = _cells([value], filters())
    card = next(c for c in cells[0].cards if c.metric_code == "accurate_claim_rate")
    assert (card.numerator, card.denominator, card.value, card.sample_level) == (
        1,
        2,
        0.5,
        "OBSERVED",
    )
    assert card.unjudgeable_claim_count == 1
    pieces = parts[cells[0].cell_key, "accurate_claim_rate"]
    assert sum(p.numerator for p in pieces) == card.numerator
    assert sum(p.denominator for p in pieces) == card.denominator


@pytest.mark.parametrize(
    "change", ["collection_mode", "mention_mode", "model_version", "profile_revision"]
)
def test_incompatible_dimensions_remain_separate_cells(change):
    first = source()
    dimensions = replace(
        first.metric.dimensions,
        **{
            change: {
                "collection_mode": "MANUAL",
                "mention_mode": "BRANDED",
                "model_version": "v2",
                "profile_revision": first.metric.dimensions.profile_revision + 1,
            }[change]
        },
    )
    second = replace(
        first, metric=replace(first.metric, run_id=uuid4(), batch_id=uuid4(), dimensions=dimensions)
    )
    cells, _ = _cells([first, second], filters())
    assert len(cells) == 2
    assert all(c.denominator <= 1 for cell in cells for c in cell.cards)
    assert len({cell.cell_key for cell in cells}) == 2


def test_no_citation_observation_or_failed_run_is_not_zero_business_result():
    first = source()
    failed = replace(
        first, metric=replace(first.metric, run_id=uuid4(), batch_id=uuid4(), status="FAILED")
    )
    cells, _ = _cells([first, failed], filters())
    coverage = next(c for c in cells[0].cards if c.metric_code == "answer_coverage")
    citation = next(c for c in cells[0].cards if c.metric_code == "owned_source_coverage")
    assert (coverage.numerator, coverage.denominator, coverage.excluded_run_count) == (1, 1, 1)
    assert citation.value is None and citation.denominator == 0
    assert citation.unavailable_reason == "NO_DENOMINATOR"
    with_citation = replace(
        first,
        metric=replace(
            first.metric,
            citations=(MetricCitation("https://example.test/a", "example.test", True),),
            citation_classification_complete=True,
        ),
    )
    assert (
        next(
            c
            for c in _cells([with_citation], filters())[0][0].cards
            if c.metric_code == "owned_source_coverage"
        ).value
        == 1
    )


def test_filters_normalize_sets_and_reject_invalid_window_and_unknowns():
    identity = uuid4()
    assert filters(subject_ids=[identity, identity]).subject_ids == [identity]
    with pytest.raises(ValidationError):
        GeoOverviewFilters(
            date_from=datetime.now(UTC), date_to=datetime.now(UTC) - timedelta(days=1)
        )
    for patch in ({"collection_modes": ["AUTO"]}, {"unknown": True}, {"review_policy": "BEST"}):
        with pytest.raises(ValidationError):
            filters(**patch)


def test_empty_quality_ratios_stay_null():
    for code, parts in _quality([], filters()).items():
        card = _quality_card(code, parts, filters())
        assert card.value is None and card.numerator == card.denominator == 0
        assert card.sample_level == "NONE"
