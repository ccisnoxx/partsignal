"""702独立手算金标：机会判定不能把未知、混合口径或旧尝试制造成异常。"""

import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.schemas.geo_insights import GeoOverviewFilters
from app.schemas.geo_rules import GeoRuleConfiguration
from app.services.geo_insight_evidence import InsightCitation, InsightClaim, InsightEvidence
from app.services.geo_metric_types import MetricCitation, MetricClaim, MetricSubject
from app.services.geo_opportunity_rules import evaluate_rules
from app.services.geo_rule_policy import FrozenRuleSet
from tests.unit.test_geo_overview import source

END = datetime(2026, 10, 4, tzinfo=UTC)
FILTERS = GeoOverviewFilters(date_from=END - timedelta(days=7), date_to=END)


def configuration(**values):
    return FrozenRuleSet.freeze(7, GeoRuleConfiguration(**values))


def cohort(base, mentions, *, age=1, recommendations=None, batch_id=None):
    own = base.snapshot.subjects[0].id
    batch_id = batch_id or uuid4()
    recommendations = recommendations if recommendations is not None else mentions
    return [
        replace(
            base,
            created_at=END - timedelta(days=age, seconds=i),
            metric=replace(
                base.metric,
                run_id=uuid4(),
                batch_id=batch_id,
                repeat_index=i + 1,
                subjects=(
                    MetricSubject(
                        own, mention, False, "RECOMMENDED" if recommendation else "UNKNOWN", None
                    ),
                ),
            ),
        )
        for i, (mention, recommendation) in enumerate(zip(mentions, recommendations, strict=True))
    ]


def results(inputs, code, **config):
    return [
        e for e in evaluate_rules(inputs, FILTERS, configuration(**config)) if e.rule_code == code
    ]


def with_claim(value, text="错误参数", *, kind="PARAMETER", verdict="INCORRECT", severity="HIGH"):
    own = value.snapshot.subjects[0].id
    claim = InsightClaim(
        uuid4(), own, uuid4(), kind, text, verdict, severity, "禁止泄露的事实原文", "禁止泄露的解释"
    )
    return replace(
        value,
        metric=replace(value.metric, claims=(MetricClaim(own, verdict, severity),)),
        evidence=replace(value.evidence, claims=(claim,)),
    )


def with_citations(value, owned):
    citations = tuple(
        InsightCitation(
            uuid4(),
            f"https://private.test/{i}",
            "private.test",
            "不能存入机会的标题",
            (1, 2),
            "OWNED" if own else "INDUSTRY_MEDIA",
            None,
            (),
        )
        for i, own in enumerate(owned)
    )
    return replace(
        value,
        evidence=InsightEvidence(citations=citations),
        metric=replace(
            value.metric,
            citations=tuple(
                MetricCitation(c.normalized_url, c.hostname, c.source_category == "OWNED")
                for c in citations
            ),
            citation_classification_complete=True,
        ),
    )


def failed(value, status="FAILED"):
    return replace(
        value,
        analysis_id=None,
        review_id=None,
        metric=replace(
            value.metric,
            status=status,
            answer_present=False,
            current_analysis_available=False,
            integrity_valid=False,
            dimensions=replace(
                value.metric.dimensions,
                source_model=None,
                model_version=None,
                analysis_configuration_key="unavailable",
                rule_set_version="1:unavailable",
            ),
        ),
    )


def test_empty_input_returns_all_ten_unavailable_rules_without_fake_values_or_sources():
    evaluations = evaluate_rules([], FILTERS, configuration())
    assert len(evaluations) == 10
    assert all(
        not e.triggered
        and e.value is None
        and e.numerator == e.denominator == 0
        and e.unavailable_reasons == ("NO_CANDIDATES",)
        and not e.sources
        for e in evaluations
    )


@pytest.mark.parametrize("code", ["VISIBILITY_DROP", "RECOMMENDATION_DROP"])
def test_drop_gold_uses_two_stable_windows_actual_delta_and_correct_source_roles(code):
    base = source()
    current = cohort(base, [True, True, True, True, False])
    previous = cohort(base, [True] * 5, age=10)
    evaluation = results(current + previous, code)[0]
    assert evaluation.triggered and not evaluation.unavailable_reasons
    assert evaluation.value == pytest.approx(-0.2) and evaluation.threshold == -0.1
    assert (evaluation.numerator, evaluation.denominator) == (4, 5)
    assert {s.run_id for s in evaluation.sources if s.source_role == "TRIGGER"} == {
        s.metric.run_id for s in current
    }
    assert {s.run_id for s in evaluation.sources if s.source_role == "BASELINE"} == {
        s.metric.run_id for s in previous
    }
    assert {s.analysis_revision_id for s in evaluation.sources} == {base.analysis_id}
    assert not results(
        current + previous, code, sample_policy={"reportable_minimum": 3, "stable_minimum": 6}
    )[0].triggered
    assert not results(
        current + previous, code, visibility_drop_points=0.3, recommendation_drop_points=0.3
    )[0].triggered
    equal = cohort(base, [True] * 5)
    assert not results(
        equal + previous, code, visibility_drop_points=0.0, recommendation_drop_points=0.0
    )[0].triggered
    boundary = cohort(base, [True] * 6 + [False] * 4)
    before = cohort(base, [True] * 7 + [False] * 3, age=10)
    assert results(boundary + before, code)[0].triggered


def test_mixed_cells_and_competition_changes_keep_specific_unavailable_reasons():
    base = source()
    current = cohort(base, [False] * 5)
    changed = replace(
        current[-1],
        metric=replace(
            current[-1].metric, dimensions=replace(base.metric.dimensions, profile_revision=99)
        ),
    )
    evaluations = results(
        current[:-1] + [changed] + cohort(base, [True] * 5, age=10), "VISIBILITY_DROP"
    )
    assert len(evaluations) == 2
    assert all(not e.triggered and "MIXED_DIMENSIONS" in e.unavailable_reasons for e in evaluations)
    competitor = base.snapshot.subjects[0].model_copy(update={"id": uuid4(), "role": "COMPETITOR"})
    now = replace(
        base,
        snapshot=base.snapshot.model_copy(
            update={"subjects": [*base.snapshot.subjects, competitor]}
        ),
        metric=replace(
            base.metric,
            dimensions=replace(
                base.metric.dimensions,
                subject_versions=(*base.metric.dimensions.subject_versions, (competitor.id, 0)),
            ),
        ),
    )
    value = next(
        e
        for e in results(
            cohort(now, [False] * 5) + cohort(base, [True] * 5, age=10), "VISIBILITY_DROP"
        )
        if e.scope.subject_id == base.snapshot.subjects[0].id
    )
    assert "COMPETITOR_SET_CHANGED" in value.unavailable_reasons and value.value is None


def test_competitor_surge_gold_uses_event_sov_and_both_reportable_windows():
    base = source()
    own = base.snapshot.subjects[0].id
    competitor = base.snapshot.subjects[0].model_copy(
        update={
            "id": uuid4(),
            "role": "COMPETITOR",
            "subject_type": "COMPETITOR_BRAND",
            "product_id": None,
        }
    )
    base = replace(
        base,
        snapshot=base.snapshot.model_copy(
            update={"subjects": [*base.snapshot.subjects, competitor]}
        ),
        metric=replace(
            base.metric,
            applicable_subject_ids=base.metric.applicable_subject_ids | {competitor.id},
            dimensions=replace(
                base.metric.dimensions,
                subject_versions=(*base.metric.dimensions.subject_versions, (competitor.id, 0)),
            ),
        ),
    )
    previous = cohort(base, [True] * 3, age=10)
    current = cohort(base, [True, False, False])
    current = [
        replace(
            s,
            metric=replace(
                s.metric,
                subjects=(
                    *s.metric.subjects,
                    MetricSubject(competitor.id, True, False, "RECOMMENDED", None),
                ),
            ),
        )
        for s in current
    ]
    previous = [
        replace(
            s,
            metric=replace(
                s.metric,
                subjects=(
                    *s.metric.subjects,
                    MetricSubject(competitor.id, False, False, "UNKNOWN", None),
                ),
            ),
        )
        for s in previous
    ]
    evaluation = results(current + previous, "COMPETITOR_SURGE")[0]
    assert evaluation.scope.subject_id == competitor.id and evaluation.triggered
    assert (evaluation.value, evaluation.numerator, evaluation.denominator) == (0.75, 3, 4)
    assert json.loads(evaluation.details_json)["primary_values"][0]["value"] == 0.25
    assert not results(current + previous[:2], "COMPETITOR_SURGE")[0].triggered
    assert not results(current + previous, "COMPETITOR_SURGE", competitor_surge_points=0.8)[
        0
    ].triggered
    assert own != evaluation.scope.subject_id


def test_topic_gap_requires_primary_own_subject_unbranded_and_stable_samples():
    base = source()
    values = cohort(base, [False] * 5)
    assert results(values, "TOPIC_COVERAGE_GAP")[0].triggered
    standard = [
        replace(
            s,
            snapshot=s.snapshot.model_copy(
                update={"prompt": s.snapshot.prompt.model_copy(update={"priority": "STANDARD"})}
            ),
        )
        for s in values
    ]
    assert "TOPIC_NOT_CORE" in results(standard, "TOPIC_COVERAGE_GAP")[0].unavailable_reasons
    assert not results(values[:4], "TOPIC_COVERAGE_GAP")[0].triggered
    branded = [
        replace(
            s,
            metric=replace(
                s.metric, dimensions=replace(s.metric.dimensions, mention_mode="BRANDED")
            ),
        )
        for s in values
    ]
    evaluation = results(branded, "TOPIC_COVERAGE_GAP")[0]
    assert (
        evaluation.value is None and "MENTION_MODE_NOT_APPLICABLE" in evaluation.unavailable_reasons
    )
    other = [
        replace(
            s,
            snapshot=s.snapshot.model_copy(
                update={
                    "subjects": [
                        s.snapshot.subjects[0].model_copy(update={"subject_type": "REFERENCE_PART"})
                    ]
                }
            ),
        )
        for s in values
    ]
    assert "SUBJECT_NOT_APPLICABLE" in results(other, "TOPIC_COVERAGE_GAP")[0].unavailable_reasons


def test_owned_citation_loss_respects_reportable_event_count_and_observation_gap():
    base = source()
    previous = [with_citations(s, [i < 2]) for i, s in enumerate(cohort(base, [True] * 3, age=10))]
    current = cohort(base, [True] * 3)
    missing = results(current + previous, "OWN_CITATION_LOST")[0]
    assert not missing.triggered and missing.value is None
    assert "CITATION_OBSERVATION_UNAVAILABLE" in missing.unavailable_reasons
    observed = [with_citations(s, [False]) for s in current]
    evaluation = results(observed + previous, "OWN_CITATION_LOST")[0]
    assert evaluation.triggered and evaluation.value == 0 and evaluation.denominator == 3
    assert json.loads(evaluation.details_json)["previous_owned_event_count"] == 2
    assert not results(observed + previous, "OWN_CITATION_LOST", own_citation_previous_count=3)[
        0
    ].triggered
    partial = results(
        observed + [cohort(base, [True], batch_id=uuid4())[0]] + previous, "OWN_CITATION_LOST"
    )[0]
    assert (
        not partial.triggered and "CITATION_OBSERVATION_UNAVAILABLE" in partial.unavailable_reasons
    )
    assert (
        "https://" not in evaluation.details_json and "不能存入机会" not in evaluation.details_json
    )


def test_severe_error_uses_current_effective_review_and_only_incorrect_high_or_critical():
    value = with_claim(cohort(source(), [True])[0], severity="CRITICAL")
    evaluation = results([value], "CRITICAL_FACT_ERROR")[0]
    assert evaluation.triggered and evaluation.priority == "CRITICAL" and evaluation.value == 1
    blocked = replace(
        value, metric=replace(value.metric, review_required=True, current_review_valid=False)
    )
    assert (
        "CURRENT_REVIEW_REQUIRED"
        in results([blocked], "CRITICAL_FACT_ERROR")[0].unavailable_reasons
    )
    review = uuid4()
    reviewed = replace(
        blocked, review_id=review, metric=replace(blocked.metric, current_review_valid=True)
    )
    assert results([reviewed], "CRITICAL_FACT_ERROR")[0].sources[0].review_id == review
    assert not results([with_claim(value, verdict="PARTIAL")], "CRITICAL_FACT_ERROR")[0].triggered
    assert not results([with_claim(value, severity="LOW")], "CRITICAL_FACT_ERROR")[0].triggered


def test_repeated_error_normalizes_unicode_kind_and_distinct_runs_in_independent_30_day_window():
    base = source()
    values = [
        with_claim(cohort(base, [True], age=age)[0], text=text)
        for age, text in ((1, "ＦＯＯ   Bar"), (10, "foo\tbar"), (29, "  Foo\nBAR "))
    ]
    stale = with_claim(cohort(base, [True], age=31)[0], text="foo bar")
    evaluation = results(values + [stale], "REPEATED_FACT_ERROR")[0]
    assert evaluation.triggered and (
        evaluation.value,
        evaluation.numerator,
        evaluation.denominator,
    ) == (3, 3, 3)
    assert len(evaluation.sources) == 3
    details = json.loads(evaluation.details_json)
    assert (
        len(details["normalized_claim_sha256"]) == 64 and len(details["claim_assessment_ids"]) == 3
    )
    assert "foo" not in evaluation.details_json and "禁止泄露" not in evaluation.details_json
    duplicate = replace(
        values[0],
        evidence=replace(
            values[0].evidence, claims=(values[0].evidence.claims[0], values[0].evidence.claims[0])
        ),
    )
    assert not results([duplicate, values[1]], "REPEATED_FACT_ERROR")[0].triggered
    changed_kind = with_claim(values[2], text="foo bar", kind="PRICE")
    assert all(not e.triggered for e in results(values[:2] + [changed_kind], "REPEATED_FACT_ERROR"))


def test_unstable_gold_keeps_two_thirds_below_point_67_and_separates_batches():
    values = cohort(source(), [True, True, False])
    evaluation = results(values, "UNSTABLE_RESULT")[0]
    assert evaluation.triggered and (
        evaluation.value,
        evaluation.numerator,
        evaluation.denominator,
    ) == (2 / 3, 2, 3)
    assert not results(values, "UNSTABLE_RESULT", stability_minimum_rate=0.66)[0].triggered
    split = [*values[:2], replace(values[2], metric=replace(values[2].metric, batch_id=uuid4()))]
    assert all(
        not e.triggered and "INSUFFICIENT_SAMPLE" in e.unavailable_reasons
        for e in results(split, "UNSTABLE_RESULT")
    )


def test_quality_gold_preserves_602_terminal_denominator_and_unconfigured_unknown_values():
    values = cohort(source(), [True] * 5)
    values = [
        values[0],
        failed(values[1]),
        failed(values[2], "CANCELLED"),
        failed(values[3], "PENDING"),
        failed(values[4], "BUDGET_BLOCKED"),
    ]
    initial = results(values, "DATA_QUALITY_PROBLEM")[0]
    assert initial.threshold is None and initial.unavailable_reasons == (
        "THRESHOLD_NOT_CONFIGURED",
    )
    evaluation = results(values, "DATA_QUALITY_PROBLEM", data_quality_minimum_success_rate=0.4)[0]
    assert evaluation.triggered and (
        evaluation.value,
        evaluation.numerator,
        evaluation.denominator,
    ) == (1 / 3, 1, 3)
    assert len(evaluation.sources) == 3
    unknown = results(
        [failed(values[0])],
        "DATA_QUALITY_PROBLEM",
        data_quality_minimum_success_rate=0.0,
        data_quality_minimum_evidence_rate=0.9,
    )[0]
    assert (
        not unknown.triggered
        and unknown.value is None
        and unknown.unavailable_reasons == ("NO_DENOMINATOR",)
    )


def test_failure_suffix_stops_on_every_nonfailed_status_and_environment_change():
    values = [failed(s) for s in cohort(source(), [True] * 4)]
    initial = results(values, "RUN_FAILURE")[0]
    assert initial.unavailable_reasons == ("THRESHOLD_NOT_CONFIGURED",)
    evaluation = results(list(reversed(values)), "RUN_FAILURE", run_failure_consecutive_limit=3)[0]
    assert evaluation.triggered and evaluation.value == 4 and len(evaluation.sources) == 4
    for status in ("CANCELLED", "BUDGET_BLOCKED", "PENDING", "COMPLETED"):
        interrupted = [values[0], values[1], failed(values[2], status), values[3]]
        assert not results(interrupted, "RUN_FAILURE", run_failure_consecutive_limit=3)[0].triggered
    changed = replace(
        values[1],
        metric=replace(
            values[1].metric, dimensions=replace(values[1].metric.dimensions, region_code="US")
        ),
    )
    evaluation = results(
        [values[0], changed, values[2]], "RUN_FAILURE", run_failure_consecutive_limit=2
    )[0]
    assert not evaluation.triggered and evaluation.value == 1
    superseded = replace(values[1], metric=replace(values[1].metric, superseded_attempt=True))
    assert results(
        [values[0], superseded, values[2]], "RUN_FAILURE", run_failure_consecutive_limit=2
    )[0].triggered


def test_environment_fingerprint_excludes_window_threshold_and_outputs_are_deterministic():
    values = [with_claim(s) for s in cohort(source(), [True] * 3)]
    first = evaluate_rules(values, FILTERS, configuration())
    assert first == evaluate_rules(list(reversed(values)), FILTERS, configuration())
    second = evaluate_rules(
        values,
        FILTERS.model_copy(update={"date_from": END - timedelta(days=8)}),
        configuration(visibility_drop_points=0.25),
    )
    one = next(e for e in first if e.rule_code == "CRITICAL_FACT_ERROR")
    two = next(e for e in second if e.rule_code == "CRITICAL_FACT_ERROR")
    assert one.scope.environment_key == two.scope.environment_key
    for e in first:
        assert e.sources == tuple(
            sorted(
                e.sources,
                key=lambda s: (
                    str(s.run_id),
                    str(s.analysis_revision_id or ""),
                    str(s.review_id or ""),
                    s.source_role,
                ),
            )
        )


def test_duplicate_run_or_multiple_active_attempts_fail_explicitly():
    value = cohort(source(), [True])[0]
    with pytest.raises(ValueError, match="同一Run"):
        evaluate_rules([value, value], FILTERS, configuration())
    with pytest.raises(ValueError, match="latest attempt"):
        evaluate_rules(
            [value, replace(value, metric=replace(value.metric, run_id=uuid4()))],
            FILTERS,
            configuration(),
        )
