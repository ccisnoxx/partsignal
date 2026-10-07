"""覆盖与SOV读模型金标，保证全部变体、实际集合和下钻来源。"""

from dataclasses import replace
from uuid import uuid4

from app.services.geo_answer_insights import _cells, _coverage, _trends
from app.services.geo_metric_types import MetricClaim, MetricSubject
from tests.unit.test_geo_overview import filters, source


def repeats(value, count, *, mentioned=True):
    own = value.snapshot.subjects[0].id
    return [
        replace(
            value,
            metric=replace(
                value.metric,
                run_id=uuid4(),
                repeat_index=i + 1,
                subjects=(
                    MetricSubject(
                        own, mentioned, False, "RECOMMENDED" if mentioned else "UNKNOWN", None
                    ),
                ),
            ),
        )
        for i in range(count)
    ]


def test_all_variant_results_are_kept_when_one_variant_reaches_topic_target():
    first = source()
    second = replace(
        first,
        metric=replace(
            first.metric, dimensions=replace(first.metric.dimensions, prompt_variant_id=uuid4())
        ),
    )
    cells = _cells(repeats(first, 5) + repeats(second, 5, mentioned=False), filters(), "CURRENT")
    coverage = _coverage(cells)
    assert len(coverage) == 1
    assert (
        coverage[0].numerator
        == coverage[0].monitored_denominator
        == coverage[0].eligible_denominator
        == 1
    )
    assert coverage[0].target_topic_coverage == 1
    assert len(coverage[0].variant_results) == 2
    assert {v.classification for v in coverage[0].variant_results} == {"STABLE", "NOT_VISIBLE"}


def test_topic_with_failed_candidates_remains_monitored_and_has_no_positive_value():
    value = source()
    value = replace(value, metric=replace(value.metric, status="FAILED"))
    coverage = _coverage(_cells([value], filters(), "CURRENT"))[0]
    assert coverage.numerator == coverage.eligible_denominator == 0
    assert coverage.monitored_denominator == 1 and coverage.target_topic_coverage == 0
    assert coverage.positive_topic_coverage is None
    assert coverage.variant_results[0].classification == "DATA_INSUFFICIENT"


def test_subject_filter_keeps_all_frozen_competitors_and_event_denominator():
    value = source()
    own = value.snapshot.subjects[0].id
    competitor = value.snapshot.subjects[-1].model_copy(
        update={"id": uuid4(), "role": "COMPETITOR"}
    )
    snapshot = value.snapshot.model_copy(
        update={"subjects": [*value.snapshot.subjects, competitor]}
    )
    value = replace(
        value,
        snapshot=snapshot,
        metric=replace(
            value.metric,
            dimensions=replace(
                value.metric.dimensions,
                subject_versions=(*value.metric.dimensions.subject_versions, (competitor.id, 0)),
            ),
            applicable_subject_ids=value.metric.applicable_subject_ids | {competitor.id},
            subjects=(
                MetricSubject(own, True, False, "RECOMMENDED", 1),
                MetricSubject(competitor.id, True, False, "RECOMMENDED", 2),
            ),
        ),
    )
    cells = _cells([value], filters(subject_ids=[own]), "CURRENT")
    assert len(cells) == 2
    for cell in cells.values():
        sov = next(m for m in cell.public.metrics if m.metric_code == "mention_sov")
        assert sov.numerator == 1 and sov.denominator == 2 and sov.value == 0.5
        assert len(cell.public.sov_subject_ids) == 2
    assert sum(c.public.selected_subject for c in cells.values()) == 1


def test_branded_variants_are_not_question_natural_coverage():
    value = source()
    value = replace(
        value,
        metric=replace(
            value.metric, dimensions=replace(value.metric.dimensions, mention_mode="BRANDED")
        ),
    )
    assert _coverage(_cells(repeats(value, 5), filters(), "CURRENT")) == []


def test_mixed_profile_revisions_keep_original_cells_and_unavailable_trend():
    value = source()
    other = replace(
        value,
        metric=replace(
            value.metric,
            run_id=uuid4(),
            batch_id=uuid4(),
            dimensions=replace(value.metric.dimensions, profile_revision=10),
        ),
    )
    current = _cells([value, other], filters(), "CURRENT")
    previous = _cells([value], filters(), "PREVIOUS")
    assert len(current) == 2
    for trend in _trends(current, previous):
        assert trend.change_points is None and "MIXED_DIMENSIONS" in trend.unavailable_reasons


def test_accuracy_keeps_unjudgeable_claim_count_outside_judgeable_denominator():
    value = source()
    own = value.snapshot.subjects[0].id
    value = replace(
        value,
        metric=replace(
            value.metric,
            claims=(MetricClaim(own, "ACCURATE", "LOW"),)
            + (MetricClaim(own, "UNJUDGEABLE", "LOW"),) * 100,
        ),
    )
    cell = next(iter(_cells([value], filters(), "CURRENT").values()))
    card = next(m for m in cell.public.metrics if m.metric_code == "accurate_claim_rate")
    assert card.numerator == card.denominator == 1 and card.value == 1
    assert card.unjudgeable_claim_count == 100
