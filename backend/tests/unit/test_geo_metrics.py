"""透明分母、资格与不可比环境的金标行为合同。"""

from dataclasses import fields, replace
from uuid import UUID

import pytest

from app.schemas.configuration import IntentType
from app.schemas.geo_runs import GeoRunStatus
from app.services.geo_metric_types import (
    MetricCitation,
    MetricCode,
    MetricDimensions,
    MetricExclusion,
    MetricScope,
    SampleLevel,
    SamplePolicy,
)
from app.services.geo_metrics import calculate_metric, metric_eligibility
from tests.unit.geo_metrics_gold import (
    COMPETITOR,
    DIMENSIONS,
    GOLD,
    OWN,
    SCOPE,
    claim,
    gold_runs,
    observation,
    subject,
)


def calculate(runs, code=MetricCode.ANSWER_COVERAGE, dimensions=DIMENSIONS, scope=SCOPE):
    return calculate_metric(runs, metric=MetricCode(code), scope=scope, dimensions=dimensions)


@pytest.mark.parametrize("code,numerator,denominator,eligible,excluded,unjudgeable", GOLD)
def test_complete_formula_gold(code, numerator, denominator, eligible, excluded, unjudgeable):
    runs = gold_runs()
    dimensions = DIMENSIONS
    if code == "branded_answer":
        dimensions = replace(dimensions, mention_mode="BRANDED")
        runs = tuple(replace(run, dimensions=dimensions) for run in runs)
    result = calculate(runs, code, dimensions)
    assert (result.numerator, result.denominator) == (numerator, denominator)
    assert result.value == pytest.approx(numerator / denominator)
    assert (result.eligible_run_count, result.excluded_run_count) == (eligible, excluded)
    assert result.unjudgeable_claim_count == unjudgeable
    assert result.sample_level == (
        SampleLevel.REPORTABLE if eligible == 3 else SampleLevel.OBSERVED
    )
    assert result.formula_version == "geo-answer-v1"
    assert result.scope == SCOPE and result.dimensions == dimensions
    assert MetricExclusion.RUN_NOT_COMPLETED in dict(result.exclusion_reason_counts)
    assert UUID(int=104) not in result.eligible_run_ids


def test_gold_covers_every_defined_metric():
    assert {MetricCode(row[0]) for row in GOLD} == set(MetricCode)


@pytest.mark.parametrize("code", MetricCode)
def test_empty_denominator_is_null(code):
    result = calculate([], code)
    assert (result.value, result.numerator, result.denominator) == (None, 0, 0)
    assert result.sample_level == SampleLevel.NONE
    assert result.eligible_run_count == result.excluded_run_count == 0


@pytest.mark.parametrize(
    "patch,reason",
    [
        ({"status": GeoRunStatus.FAILED}, MetricExclusion.RUN_NOT_COMPLETED),
        ({"status": GeoRunStatus.NEEDS_REVIEW}, MetricExclusion.RUN_NOT_COMPLETED),
        ({"answer_present": False}, MetricExclusion.ANSWER_MISSING_OR_EMPTY),
        ({"current_analysis_available": False}, MetricExclusion.CURRENT_ANALYSIS_UNAVAILABLE),
        ({"review_required": True}, MetricExclusion.CURRENT_REVIEW_REQUIRED),
        ({"integrity_valid": False}, MetricExclusion.INTEGRITY_ERROR),
        ({"administrator_excluded": True}, MetricExclusion.ADMINISTRATOR_EXCLUDED),
        ({"superseded_attempt": True}, MetricExclusion.SUPERSEDED_ATTEMPT),
        ({"applicable_subject_ids": frozenset()}, MetricExclusion.SUBJECT_NOT_APPLICABLE),
    ],
)
def test_generic_exclusions_never_become_absence(patch, reason):
    run = observation(**patch)
    eligibility = metric_eligibility(
        run, metric=MetricCode.ANSWER_COVERAGE, scope=SCOPE, dimensions=DIMENSIONS
    )
    assert eligibility.exclusion_reasons == (reason,)
    result = calculate([run])
    assert result.value is None and result.denominator == 0
    assert result.excluded_run_count == 1
    assert dict(result.exclusion_reason_counts) == {reason: 1}


@pytest.mark.parametrize("status", [status for status in GeoRunStatus if status != "COMPLETED"])
def test_only_completed_runs_eligible(status):
    assert calculate([observation(status=status)]).value is None


def test_current_review_passes_required_gate():
    result = calculate([observation(review_required=True, current_review_valid=True)])
    assert result.denominator == 1


@pytest.mark.parametrize("name", [field.name for field in fields(MetricDimensions)])
def test_each_comparison_dimension_is_enforced(name):
    previous = getattr(DIMENSIONS, name)
    if isinstance(previous, UUID):
        value = UUID(int=999)
    elif isinstance(previous, int):
        value = previous + 1
    elif name == "subject_versions":
        value = tuple((identity, revision + 1) for identity, revision in previous)
    elif isinstance(previous, tuple):
        value = ()
    else:
        value = "different"
    result = calculate([observation(dimensions=replace(DIMENSIONS, **{name: value}))])
    assert result.denominator == 0
    assert MetricExclusion.DIMENSION_MISMATCH in dict(result.exclusion_reason_counts)


@pytest.mark.parametrize("mode", ["MANUAL", "BROWSER"])
def test_manual_api_browser_default_separate(mode):
    manual = observation(2, dimensions=replace(DIMENSIONS, collection_mode=mode))
    result = calculate([observation(), manual])
    assert (result.denominator, result.excluded_run_count) == (1, 1)


@pytest.mark.parametrize("code", ["natural_visibility", "mention_sov", "recommendation_sov"])
def test_branded_not_in_natural_or_default_sov(code):
    dimensions = replace(DIMENSIONS, mention_mode="BRANDED")
    assert calculate([observation(dimensions=dimensions)], code, dimensions).value is None


@pytest.mark.parametrize("kind", ["RECOMMENDED", "CONSIDERED", "NOT_RECOMMENDED", "UNKNOWN"])
def test_recommendation_states_are_not_mention_or_sentiment(kind):
    run = observation(subjects=(subject(OWN, True, recommendation=kind),))
    assert calculate([run], "recommendation_rate").numerator == int(kind == "RECOMMENDED")
    assert calculate([run], "average_recommendation_rank").value is None


@pytest.mark.parametrize("intent", [IntentType.BRAND, IntentType.TROUBLESHOOTING])
def test_non_recommendation_intents_excluded(intent):
    dimensions = replace(DIMENSIONS, intent_type=intent)
    assert (
        calculate([observation(dimensions=dimensions)], "recommendation_rate", dimensions).value
        is None
    )


def test_product_relevance_is_prebound_not_inferred_from_mentions():
    run = observation(subjects=(subject(OWN, True),), applicable_subject_ids=frozenset())
    assert calculate([run], "product_mention").value is None
    assert calculate([observation()], "product_mention").value == 0
    assert (
        calculate([observation()], "product_mention", scope=replace(SCOPE, is_product=False)).value
        is None
    )


def test_sov_zero_events_and_frozen_set():
    result = calculate([observation()], "mention_sov")
    assert result.value is None and result.sample_level == SampleLevel.OBSERVED
    with pytest.raises(ValueError, match="冻结监测"):
        calculate(gold_runs(), "mention_sov", scope=MetricScope(OWN))
    result = calculate(
        gold_runs(), "mention_sov", scope=replace(SCOPE, sov_subject_ids=frozenset({OWN}))
    )
    assert (result.numerator, result.denominator) == (2, 2)
    assert result.scope.sov_subject_ids == frozenset({OWN})


def test_unknown_citation_absence_not_counted_as_zero():
    run = observation(citation_absence_observable=False)
    assert calculate([run], "owned_source_coverage").value is None
    assert (
        calculate([replace(run, citation_absence_observable=True)], "owned_source_coverage").value
        == 0
    )
    assert calculate([run], "answer_coverage").denominator == 1


def test_citation_classification_gate_and_unique_url_conflict():
    first = gold_runs()[0]
    assert (
        calculate(
            [replace(first, citation_classification_complete=False)], "owned_citation_share"
        ).value
        is None
    )
    bad = replace(
        first,
        citations=first.citations
        + (MetricCitation("https://owned.example/a", "owned.example", False),),
    )
    with pytest.raises(ValueError, match="冲突"):
        calculate([bad], "owned_citation_share")


def test_sample_grade_uses_runs_not_citation_or_claim_events():
    run = observation(claims=(claim("ACCURATE"),) * 20)
    result = calculate([run], "accurate_claim_rate")
    assert result.denominator == 20 and result.sample_level == SampleLevel.OBSERVED


@pytest.mark.parametrize(
    "count,level",
    [
        (0, "NONE"),
        (1, "OBSERVED"),
        (2, "OBSERVED"),
        (3, "REPORTABLE"),
        (4, "REPORTABLE"),
        (5, "STABLE"),
    ],
)
def test_sample_thresholds(count, level):
    assert calculate([observation(index) for index in range(1, count + 1)]).sample_level == level


def test_sample_policy_explicit_and_validated():
    result = calculate_metric(
        [observation(1), observation(2)],
        metric=MetricCode.ANSWER_COVERAGE,
        scope=SCOPE,
        dimensions=DIMENSIONS,
        sample_policy=SamplePolicy(2, 4),
    )
    assert result.sample_level == SampleLevel.REPORTABLE
    with pytest.raises(ValueError):
        SamplePolicy(3, 3)


@pytest.mark.parametrize("code", ["mention_stability", "recommendation_stability"])
def test_stability_needs_two_distinct_repeats_in_one_batch(code):
    assert calculate([observation()], code).value is None
    assert calculate([observation(1), observation(2)], code).value == 1
    with pytest.raises(ValueError, match="同一批次"):
        calculate([observation(1), observation(2, batch_id=UUID(int=9))], code)
    with pytest.raises(ValueError, match="latest attempt"):
        calculate([observation(1), observation(2, repeat_index=1)], code)


def test_retry_supersedes_success_and_latest_failure_is_not_absence():
    old = observation(superseded_attempt=True, subjects=(subject(OWN, True),))
    latest = observation(2, repeat_index=1, status=GeoRunStatus.FAILED)
    result = calculate([old, latest])
    assert result.value is None and result.excluded_run_count == 2
    with pytest.raises(ValueError, match="重复输入"):
        calculate([old, old])


def test_rank_must_be_reliable_positive_recommendation():
    with pytest.raises(ValueError, match="rank"):
        subject(OWN, recommendation="CONSIDERED", rank=1)
    with pytest.raises(ValueError, match="rank"):
        subject(OWN, recommendation="RECOMMENDED", rank=0)


def test_high_partial_is_not_severe_incorrect_and_claims_are_subject_scoped():
    run = observation(
        claims=(claim("PARTIAL", "CRITICAL"), claim("INCORRECT", "CRITICAL", identity=COMPETITOR))
    )
    assert calculate([run], "severe_error_run_rate").value == 0
    assert calculate([run], "partial_claim_rate").value == 1


def test_two_denominators_follow_user_methodology_decision():
    ranked = observation(
        subjects=(subject(OWN, recommendation="RECOMMENDED", rank=1),),
        claims=(claim("INCORRECT", "CRITICAL"),),
    )
    unavailable = observation(2, claims=(claim("UNJUDGEABLE"),))
    assert calculate([ranked, unavailable], "top_recommendation_rate").value == 1
    assert calculate([ranked, unavailable], "severe_error_run_rate").value == 1
    assert calculate([ranked, unavailable], "recommendation_rate").value == 0.5


def test_average_rank_is_mean_of_reliable_target_positions():
    first = observation(subjects=(subject(OWN, recommendation="RECOMMENDED", rank=1),))
    third = observation(2, subjects=(subject(OWN, recommendation="RECOMMENDED", rank=3),))
    result = calculate([first, third, observation(3)], "average_recommendation_rank")
    assert (result.value, result.numerator, result.denominator) == (2, 4, 2)


def test_multiple_exclusion_reasons_do_not_inflate_excluded_run_count():
    result = calculate([observation(status=GeoRunStatus.FAILED, answer_present=False)])
    assert result.excluded_run_count == 1
    assert dict(result.exclusion_reason_counts) == {
        MetricExclusion.RUN_NOT_COMPLETED: 1,
        MetricExclusion.ANSWER_MISSING_OR_EMPTY: 1,
    }


def test_two_active_attempts_are_rejected_even_if_latest_failed():
    with pytest.raises(ValueError, match="latest attempt"):
        calculate([observation(1), observation(2, repeat_index=1, status=GeoRunStatus.FAILED)])
