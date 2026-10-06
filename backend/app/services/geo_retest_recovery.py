"""706 冻结恢复裁决；既有公式/资格提供观测值，此处仅应用恢复阈值。"""

from fractions import Fraction

from app.schemas.geo_retest_comparisons import (
    GeoRetestComparisonMetric,
    GeoRetestRecovery,
)
from app.schemas.geo_retest_comparisons import (
    GeoRetestRecoveryStatus as Status,
)
from app.schemas.geo_retests import GeoRetestBaselineSnapshot
from app.schemas.geo_rules import GeoRuleCode as Code
from app.services.geo_rule_policy import FrozenRuleSet, sample_gates


def recovery(
    snapshot: GeoRetestBaselineSnapshot,
    metrics: list[GeoRetestComparisonMetric],
    *,
    comparable: bool,
    pending: bool,
    extra_reasons: list[str],
) -> GeoRetestRecovery:
    trigger = snapshot.trigger_snapshot
    config = trigger.rule_snapshot.configuration
    rules = FrozenRuleSet.freeze(trigger.rule_snapshot.rule_set_revision, config)
    gate = next(
        g
        for g in sample_gates(rules, current_runs=0, previous_runs=0)
        if g.rule_code == trigger.rule_code
    )
    stable_codes = {
        Code.VISIBILITY_DROP,
        Code.RECOMMENDATION_DROP,
        Code.TOPIC_COVERAGE_GAP,
        Code.UNSTABLE_RESULT,
    }
    metric_minimum = (
        config.sample_policy.stable_minimum
        if trigger.rule_code in stable_codes
        else gate.current_minimum
    )
    # 规则的独立重复门槛不能被较低的样本策略或恢复门槛覆盖。
    minimum = max(config.recovery.minimum_runs, metric_minimum, gate.current_minimum)
    code = trigger.rule_code
    previous = code in {Code.VISIBILITY_DROP, Code.RECOMMENDATION_DROP, Code.COMPETITOR_SURGE}
    result = GeoRetestRecovery(
        status=Status.UNAVAILABLE,
        rule_snapshot=trigger.rule_snapshot,
        recovery_configuration=config.recovery
        if snapshot.rule_snapshot.schema_version == 2
        else None,
        required_run_count=minimum,
        reference_kind="PREVIOUS_TRIGGER_WINDOW" if previous else "FROZEN_RECOVERY_THRESHOLD",
        reference_value=None,
        observed_value=None,
        threshold=None,
        reasons=[],
    )
    if result.recovery_configuration is None:
        result.reasons = ["FROZEN_RECOVERY_CONFIGURATION_UNAVAILABLE"]
        return result
    if pending:
        result.status, result.reasons = Status.PENDING, ["RETEST_NOT_FINISHED"]
        return result
    if not comparable:
        result.status, result.reasons = Status.NOT_COMPARABLE, ["STRICT_COMPARABILITY_REQUIRED"]
        return result
    selected_codes = {
        Code.VISIBILITY_DROP: ["natural_visibility"],
        Code.RECOMMENDATION_DROP: ["recommendation_rate"],
        Code.COMPETITOR_SURGE: ["recommendation_sov"],
        Code.TOPIC_COVERAGE_GAP: ["natural_visibility"],
        Code.OWN_CITATION_LOST: ["owned_citation_count"],
        Code.CRITICAL_FACT_ERROR: ["same_fact_error_count"],
        Code.REPEATED_FACT_ERROR: ["same_fact_error_count"],
        Code.UNSTABLE_RESULT: ["mention_stability"],
        Code.DATA_QUALITY_PROBLEM: [
            name
            for name, threshold in (
                ("run_success_rate", config.data_quality_minimum_success_rate),
                ("evidence_completeness", config.data_quality_minimum_evidence_rate),
            )
            if threshold is not None
        ],
        Code.RUN_FAILURE: ["consecutive_failed_count"],
    }[code]
    selected = [m for m in metrics if m.metric_code in selected_codes]
    reasons = list(extra_reasons)
    if not gate.threshold_configured or not selected_codes:
        reasons.append("THRESHOLD_NOT_CONFIGURED")
    if len(selected) != len(selected_codes):
        reasons.append("MISSING_OR_MIXED_METRIC_DIMENSIONS")
    for metric in selected:
        reasons.extend(metric.unavailable_reasons)
        if metric.value is None:
            reasons.append("NO_DENOMINATOR")
        if metric.unjudgeable_claim_count:
            reasons.append("UNJUDGEABLE_CLAIMS")
    if reasons:
        result.reasons = sorted(set(reasons))
        return result
    if any(m.eligible_run_count < minimum for m in selected):
        result.status, result.reasons = Status.INSUFFICIENT_SAMPLE, ["INSUFFICIENT_SAMPLE"]
        return result
    first = selected[0]
    result.observed_value = first.value
    policy = config.recovery
    if previous:
        before = trigger.details.get("previous")
        if not isinstance(before, list) or len(before) != 1 or not isinstance(before[0], dict):
            result.reasons = ["PREVIOUS_TRIGGER_REFERENCE_UNAVAILABLE"]
            return result
        reference = before[0]
        if (
            reference.get("metric_code") != first.metric_code
            or not isinstance(reference.get("eligible_run_count"), int)
            or reference["eligible_run_count"] < gate.previous_minimum
            or not isinstance(reference.get("numerator"), int)
            or not isinstance(reference.get("denominator"), int)
            or reference["denominator"] <= 0
        ):
            result.reasons = ["PREVIOUS_TRIGGER_REFERENCE_UNAVAILABLE"]
            return result
        dimensions = reference.get("dimensions")
        if first.dimensions is None or not isinstance(dimensions, dict):
            result.reasons = ["PREVIOUS_TRIGGER_REFERENCE_UNAVAILABLE"]
            return result
        observed_dimensions = first.dimensions.model_dump(mode="json")
        if any(
            dimensions.get(name) != value
            for name, value in observed_dimensions.items()
            if name != "window_key"
        ):
            result.reasons = ["PREVIOUS_TRIGGER_REFERENCE_DIMENSIONS_CHANGED"]
            return result
        value = Fraction(reference["numerator"], reference["denominator"])
        observed = Fraction(first.numerator, first.denominator)
        result.reference_value = float(value)
        limits = {
            Code.VISIBILITY_DROP: policy.visibility_drop_max_points,
            Code.RECOMMENDATION_DROP: policy.recommendation_drop_max_points,
            Code.COMPETITOR_SURGE: policy.competitor_surge_max_points,
        }
        limit = Fraction(str(limits[code]))
        result.threshold = float(value + limit if code == Code.COMPETITOR_SURGE else value - limit)
        passed = (
            observed <= value + limit
            if code == Code.COMPETITOR_SURGE
            else observed >= value - limit
        )
    else:
        thresholds = {
            Code.TOPIC_COVERAGE_GAP: policy.topic_visibility_minimum_rate,
            Code.OWN_CITATION_LOST: policy.owned_citation_minimum_count,
            Code.CRITICAL_FACT_ERROR: policy.fact_error_max_count,
            Code.REPEATED_FACT_ERROR: policy.fact_error_max_count,
            Code.UNSTABLE_RESULT: policy.stability_minimum_rate,
            Code.DATA_QUALITY_PROBLEM: config.data_quality_minimum_success_rate
            if first.metric_code == "run_success_rate"
            else config.data_quality_minimum_evidence_rate,
            Code.RUN_FAILURE: config.run_failure_consecutive_limit,
        }
        result.threshold = thresholds[code]
        if code == Code.DATA_QUALITY_PROBLEM:
            passed = True
            for m in selected:
                quality_limit = (
                    config.data_quality_minimum_success_rate
                    if m.metric_code == "run_success_rate"
                    else config.data_quality_minimum_evidence_rate
                )
                assert quality_limit is not None and m.value is not None
                passed = passed and m.value >= quality_limit
        elif code == Code.RUN_FAILURE:
            assert first.value is not None and result.threshold is not None
            passed = first.value < result.threshold
        elif code in {Code.CRITICAL_FACT_ERROR, Code.REPEATED_FACT_ERROR}:
            passed = first.value == 0
        else:
            assert first.value is not None and result.threshold is not None
            passed = (
                Fraction(first.numerator, first.denominator) >= Fraction(str(result.threshold))
                if code in {Code.TOPIC_COVERAGE_GAP, Code.UNSTABLE_RESULT}
                else first.value >= result.threshold
            )
    result.status = Status.RECOVERED if passed else Status.NOT_RECOVERED
    result.reasons = [] if passed else ["FROZEN_RECOVERY_THRESHOLD_NOT_MET"]
    return result
