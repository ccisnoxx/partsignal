"""604独立手算金标：事件/运行去重、未知声明和操作质量不能相互替代。"""

from dataclasses import replace
from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.geo_insight_details import GeoInsightQualityFilters
from app.services.geo_answer_insights import _cells
from app.services.geo_insight_details import citation_events, claim_events, summaries
from app.services.geo_insight_evidence import InsightCitation, InsightClaim, InsightEvidence
from app.services.geo_insight_quality import data_quality
from app.services.geo_metric_types import MetricCitation, MetricClaim
from tests.unit.test_geo_overview import filters, source


def evidence_source():
    value = source()
    own = value.snapshot.subjects[0].id
    candidates = (own, uuid4())
    citations = tuple(
        InsightCitation(
            uuid4(),
            url,
            host,
            None,
            positions,
            category,
            own if category == "OWNED" else None,
            shared,
        )
        for url, host, category, positions, shared in (
            ("https://shared.test/a", "shared.test", "OWNED", (1, 4), candidates),
            ("https://shared.test/b", "shared.test", "OWNED", (2,), candidates),
            ("https://media.test/c", "media.test", "INDUSTRY_MEDIA", (3,), ()),
        )
    )
    claims = tuple(
        InsightClaim(
            uuid4(),
            own,
            None if verdict == "UNJUDGEABLE" else uuid4(),
            "PARAMETER",
            "虚构参数声明",
            verdict,
            severity,
            None if verdict == "UNJUDGEABLE" else "批准事实摘录",
            "虚构解释",
        )
        for verdict, severity in (
            ("ACCURATE", "LOW"),
            ("PARTIAL", "HIGH"),
            ("INCORRECT", "HIGH"),
            ("INCORRECT", "LOW"),
            ("UNJUDGEABLE", "CRITICAL"),
        )
    )
    return replace(
        value,
        metric=replace(
            value.metric,
            citations=tuple(
                MetricCitation(c.normalized_url, c.hostname, c.source_category == "OWNED")
                for c in citations
            ),
            claims=tuple(MetricClaim(c.subject_id, c.verdict, c.severity) for c in claims),
            citation_classification_complete=True,
        ),
        evidence=InsightEvidence(
            citations, claims, "fake-model", None, None, "analyzer-v1", "rules-v1"
        ),
    )


def test_citation_gold_deduplicates_url_occurrences_and_domain_run_coverage():
    first = evidence_source()
    first = replace(
        first,
        evidence=replace(
            first.evidence, citations=(*first.evidence.citations, first.evidence.citations[0])
        ),
        metric=replace(
            first.metric, citations=(*first.metric.citations, first.metric.citations[0])
        ),
    )
    second = replace(first, metric=replace(first.metric, run_id=uuid4(), repeat_index=2))
    cells = _cells([first, second], filters(), "CURRENT")
    cell = next(iter(cells.values()))
    summary = summaries(cells, filters())[0][0]
    assert summary.citation_count == len(citation_events(cell)) == 6
    domain = next(b for b in summary.domains if b.key == "shared.test")
    assert (domain.citation_count, domain.run_count, domain.coverage_value, domain.share_value) == (
        4,
        2,
        1,
        4 / 6,
    )
    assert sum(b.citation_count for b in summary.urls) == 6
    card = next(c for c in cell.public.metrics if c.metric_code == "owned_citation_share")
    assert (card.numerator, card.denominator, card.eligible_run_count) == (4, 6, 2)


def test_claim_gold_keeps_unknown_only_run_without_counting_it_correct_or_incorrect():
    first = evidence_source()
    unknown = replace(
        first,
        metric=replace(
            first.metric, run_id=uuid4(), repeat_index=2, claims=(first.metric.claims[-1],)
        ),
        evidence=replace(first.evidence, claims=(first.evidence.claims[-1],)),
    )
    cells = _cells([first, unknown], filters(), "CURRENT")
    cell = next(iter(cells.values()))
    summary = summaries(cells, filters())[1][0]
    assert summary.claim_count == len(claim_events(cell)) == 6
    assert summary.verdict_counts == {"ACCURATE": 1, "PARTIAL": 1, "INCORRECT": 2, "UNJUDGEABLE": 2}
    assert summary.incorrect_severity_counts == {"LOW": 1, "MEDIUM": 0, "HIGH": 1, "CRITICAL": 0}
    cards = {c.metric_code: c for c in cell.public.metrics}
    assert (cards["accurate_claim_rate"].numerator, cards["accurate_claim_rate"].denominator) == (
        1,
        4,
    )
    assert cards["incorrect_claim_rate"].value == 0.5
    assert cards["severe_error_run_rate"].value == 1
    assert cards["severe_error_run_rate"].eligible_run_count == 1
    assert cards["accurate_claim_rate"].unjudgeable_claim_count == 2


def test_high_partial_and_unknown_claims_do_not_create_severe_error():
    value = evidence_source()
    keep = (value.evidence.claims[1], value.evidence.claims[-1])
    value = replace(
        value,
        evidence=replace(value.evidence, claims=keep),
        metric=replace(
            value.metric,
            claims=tuple(MetricClaim(c.subject_id, c.verdict, c.severity) for c in keep),
        ),
    )
    cell = next(iter(_cells([value], filters(), "CURRENT").values()))
    severe = next(c for c in cell.public.metrics if c.metric_code == "severe_error_run_rate")
    assert severe.numerator == 0 and severe.denominator == 1


def test_review_backlog_is_quality_data_but_has_no_business_citation_or_claim_events():
    value = evidence_source()
    value = replace(
        value,
        metric=replace(
            value.metric, status="NEEDS_REVIEW", review_required=True, current_review_valid=False
        ),
    )
    cell = next(iter(_cells([value], filters(), "CURRENT").values()))
    assert not citation_events(cell) and not claim_events(cell)
    quality = data_quality([value], filters())
    assert quality.overview.candidate_run_count == quality.overview.excluded_run_count == 1
    assert {x.code for x in quality.overview.exclusion_reason_counts} == {
        "RUN_NOT_COMPLETED",
        "CURRENT_REVIEW_REQUIRED",
    }
    assert quality.shared_domain_run_count == 1 and quality.shared_domain_citation_count == 2
    assert "SHARED_DOMAIN" in quality.notes and "REVIEW_BACKLOG" in quality.notes
    backlog = next(c for c in quality.overview.cards if c.metric_code == "review_backlog")
    assert backlog.numerator == 1


def test_cost_zero_is_known_unknown_is_not_zero_and_currencies_do_not_mix():
    first = evidence_source()
    values = [
        first,
        replace(first, cost_amount=Decimal("0"), cost_currency="USD"),
        replace(first, cost_amount=Decimal("6"), cost_currency="USD"),
        replace(first, cost_amount=Decimal("9"), cost_currency="CNY"),
    ]
    quality = data_quality(values, filters())
    costs = {c.currency: c for c in quality.known_costs}
    assert (
        costs["USD"].total_amount,
        costs["USD"].average_amount,
        costs["USD"].known_run_count,
    ) == (6, 3, 2)
    assert costs["CNY"].total_amount == 9 and costs["CNY"].average_amount == 9
    card = next(c for c in quality.overview.cards if c.metric_code == "cost_coverage")
    assert (card.numerator, card.denominator, card.value) == (3, 4, 0.75)
    assert "COST_UNKNOWN" in quality.notes
    assert data_quality([first], filters()).known_costs == []


def test_unknown_collection_and_mixed_analysis_versions_are_explicit():
    first = evidence_source()
    second = replace(
        first,
        metric=replace(first.metric, run_id=uuid4()),
        evidence=replace(first.evidence, source_version="v2", analyzer_version="analyzer-v2"),
        version_known=True,
    )
    quality = data_quality([first, second], filters())
    assert {v.source_version for v in quality.collection_versions} == {None, "v2"}
    assert {v.analyzer_version for v in quality.analysis_versions} == {"analyzer-v1", "analyzer-v2"}
    assert {"MODEL_VERSION_UNKNOWN", "MIXED_COLLECTION_VERSIONS", "MIXED_ANALYSIS_VERSIONS"} <= set(
        quality.notes
    )


@pytest.mark.parametrize(
    "patch",
    [
        {"quality_code": "review_backlog", "version_key": "0" * 64},
        {"quality_code": "analysis_version", "currency": "USD"},
        {
            "quality_code": "eligible_runs",
            "cohort": "CANDIDATE",
            "exclusion_reason": "INTEGRITY_ERROR",
        },
    ],
)
def test_invalid_quality_selector_combinations_are_rejected(patch):
    with pytest.raises(ValidationError):
        GeoInsightQualityFilters(**filters().model_dump(), **patch)
