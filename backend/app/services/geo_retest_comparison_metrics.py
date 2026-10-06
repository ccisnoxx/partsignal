"""前后窗口的公式投影和实际可比性；601/602/702 继续持有公式与样本资格。"""

from collections import Counter, defaultdict
from dataclasses import asdict
from typing import cast
from uuid import UUID

from app.schemas.geo_analysis import GeoClaimKind
from app.schemas.geo_insights import GeoOverviewDimensions, GeoOverviewExclusion, GeoOverviewFilters
from app.schemas.geo_metric_values import MetricExclusion
from app.schemas.geo_retest_comparisons import (
    ComparisonMetric,
    DifferenceCode,
    GeoRetestComparisonDifference,
    GeoRetestComparisonEnvironment,
    GeoRetestComparisonMetric,
)
from app.schemas.geo_retests import GeoRetestBaselineSnapshot
from app.schemas.geo_rules import GeoRuleCode as Code
from app.services.geo_claim_signatures import claim_signature
from app.services.geo_metric_inputs import metric_scope_from_snapshot
from app.services.geo_metric_types import MetricCode, SamplePolicy
from app.services.geo_metrics import calculate_metric, unique_citations
from app.services.geo_opportunity_quality_rules import environment_key, failure_rules
from app.services.geo_overview import QUALITY_VERSION, _quality
from app.services.geo_overview_queries import OverviewInput
from app.services.geo_rule_policy import FrozenRuleSet

RULE_METRICS = {
    Code.VISIBILITY_DROP: MetricCode.NATURAL_VISIBILITY,
    Code.RECOMMENDATION_DROP: MetricCode.RECOMMENDATION_RATE,
    Code.COMPETITOR_SURGE: MetricCode.RECOMMENDATION_SOV,
    Code.TOPIC_COVERAGE_GAP: MetricCode.NATURAL_VISIBILITY,
    Code.OWN_CITATION_LOST: MetricCode.OWNED_SOURCE_COVERAGE,
    Code.CRITICAL_FACT_ERROR: MetricCode.SEVERE_ERROR_RUN_RATE,
    Code.REPEATED_FACT_ERROR: MetricCode.INCORRECT_CLAIM_RATE,
    Code.UNSTABLE_RESULT: MetricCode.MENTION_STABILITY,
}


def environments(inputs: list[OverviewInput]) -> list[GeoRetestComparisonEnvironment]:
    return [
        GeoRetestComparisonEnvironment(
            run_id=s.metric.run_id,
            repeat_index=s.metric.repeat_index,
            input_snapshot=s.snapshot,
            source_product=s.evidence.source_product,
            source_model=s.evidence.source_model,
            source_version=s.evidence.source_version,
            dimensions=GeoOverviewDimensions.model_validate(asdict(s.metric.dimensions)),
        )
        for s in sorted(inputs, key=lambda s: s.metric.run_id)
    ]


def actual_differences(
    baseline: list[OverviewInput],
    retest: list[OverviewInput],
) -> list[GeoRetestComparisonDifference]:
    def key(s: OverviewInput) -> tuple[UUID, UUID, int]:
        return s.snapshot.prompt.id, s.snapshot.profile.id, s.metric.repeat_index

    before, after = {key(s): s for s in baseline}, {key(s): s for s in retest}
    differences = []
    for identity in sorted(before.keys() | after.keys()):
        a, b = before.get(identity), after.get(identity)

        def add(
            code: DifferenceCode,
            field: str,
            old: object,
            new: object,
            a: OverviewInput | None = a,
            b: OverviewInput | None = b,
        ) -> None:
            differences.append(
                GeoRetestComparisonDifference(
                    code=code,
                    field=field,
                    baseline_run_id=a.metric.run_id if a else None,
                    retest_run_id=b.metric.run_id if b else None,
                    baseline_value=str(old) if old is not None else None,
                    retest_value=str(new) if new is not None else None,
                )
            )

        if a is None or b is None:
            add("MATRIX_CHANGED", "cells", key(a) if a else None, key(b) if b else None)
            continue
        if a.snapshot != b.snapshot:
            add(
                "INPUT_CHANGED",
                "input_snapshot",
                a.snapshot.model_dump_json(),
                b.snapshot.model_dump_json(),
            )
        for name in ("source_product", "source_model", "source_version"):
            old, new = getattr(a.evidence, name), getattr(b.evidence, name)
            if old != new:
                add("MODEL_VERSION_CHANGED", name, old, new)
        if (
            a.evidence.source_version is None
            or b.evidence.source_version is None
            or not (a.evidence.source_model or a.evidence.source_product)
            or not (b.evidence.source_model or b.evidence.source_product)
        ):
            add(
                "MODEL_VERSION_UNKNOWN",
                "source_version",
                a.evidence.source_version,
                b.evidence.source_version,
            )
        # 缺分析的资格在指标中排除；不能把缺失配置值与已知分析比较成版本变化。
        if a.metric.current_analysis_available and b.metric.current_analysis_available:
            for name in (
                "rule_set_version",
                "analysis_configuration_key",
                "subject_versions",
                "fact_version_bindings",
            ):
                old, new = getattr(a.metric.dimensions, name), getattr(b.metric.dimensions, name)
                if old != new:
                    add("ANALYSIS_VERSION_CHANGED", name, old, new)
    return differences


def rule_inputs(
    inputs: list[OverviewInput], snapshot: GeoRetestBaselineSnapshot
) -> list[OverviewInput]:
    scope = snapshot.trigger_snapshot.scope
    if snapshot.trigger_snapshot.rule_code == Code.DATA_QUALITY_PROBLEM:
        return inputs  # 质量分母是完整批次，业务筛选不得删掉失败/成功样本。
    if snapshot.trigger_snapshot.rule_code == Code.RUN_FAILURE:
        return [s for s in inputs if scope.collection_profile_id in {None, s.snapshot.profile.id}]
    return [
        s
        for s in inputs
        if scope.prompt_variant_id in {None, s.snapshot.prompt.id}
        and scope.collection_profile_id in {None, s.snapshot.profile.id}
        and any(v.id == scope.subject_id for v in s.snapshot.subjects)
    ]


def metrics(
    inputs: list[OverviewInput],
    snapshot: GeoRetestBaselineSnapshot,
    filters: GeoOverviewFilters,
    *,
    baseline: list[OverviewInput],
) -> tuple[list[GeoRetestComparisonMetric], list[str]]:
    trigger = snapshot.trigger_snapshot
    rules = FrozenRuleSet.freeze(
        trigger.rule_snapshot.rule_set_revision, trigger.rule_snapshot.configuration
    )
    policy = rules.sample_policy()
    code = trigger.rule_code
    selected = rule_inputs(inputs, snapshot)
    if code == Code.DATA_QUALITY_PROBLEM:
        values = []
        quality_parts = _quality(selected, filters)
        qualification_reasons = {
            c.source.metric.run_id: c.reasons for c in quality_parts["eligible_runs"]
        }
        for name in ("run_success_rate", "evidence_completeness"):
            contributors = quality_parts[name]
            n, d = sum(c.numerator for c in contributors), sum(c.denominator for c in contributors)
            exclusions = Counter(
                reason
                for c in contributors
                if not c.denominator
                for reason in qualification_reasons[c.source.metric.run_id]
            )
            card = _count_metric(
                name, n / d if d else None, n, d, len(selected), d, policy, QUALITY_VERSION
            )
            values.append(
                card.model_copy(
                    update={
                        "exclusion_reason_counts": [
                            GeoOverviewExclusion(code=reason, run_count=count)
                            for reason, count in sorted(exclusions.items())
                        ]
                    }
                )
            )
        return values, []
    if code == Code.RUN_FAILURE:
        evaluations = failure_rules(selected, rules)
        return [
            _count_metric(
                "consecutive_failed_count",
                e.value,
                e.numerator,
                e.denominator,
                e.denominator,
                e.denominator,
                policy,
                "geo-opportunity-failure-v1",
            )
            for e in evaluations
        ], []
    if not selected or trigger.scope.subject_id is None:
        return [], ["NO_CANDIDATES"]
    groups: dict[str, list[OverviewInput]] = defaultdict(list)
    for source in selected:
        groups[environment_key(source)].append(source)
    values = []
    reasons: list[str] = []
    metric_code = RULE_METRICS[code]
    for _, parts in sorted(groups.items()):
        scope = metric_scope_from_snapshot(parts[0].snapshot, subject_id=trigger.scope.subject_id)
        result = calculate_metric(
            [s.metric for s in parts],
            metric=metric_code,
            scope=scope,
            dimensions=parts[0].metric.dimensions,
            sample_policy=policy,
        )
        metric = GeoRetestComparisonMetric(
            metric_code=cast(ComparisonMetric, result.metric_code.value),
            formula_version=result.formula_version,
            value=result.value,
            numerator=result.numerator,
            denominator=result.denominator,
            candidate_run_count=len(parts),
            eligible_run_count=result.eligible_run_count,
            excluded_run_count=result.excluded_run_count,
            sample_level=result.sample_level,
            exclusion_reason_counts=[
                GeoOverviewExclusion(code=c, run_count=n) for c, n in result.exclusion_reason_counts
            ],
            unjudgeable_claim_count=result.unjudgeable_claim_count,
            dimensions=GeoOverviewDimensions.model_validate(asdict(result.dimensions)),
            unavailable_reasons=[] if result.value is not None else ["NO_DENOMINATOR"],
        )
        values.append(metric)
        eligible = [s for s in parts if s.metric.run_id in result.eligible_run_ids]
        if code == Code.OWN_CITATION_LOST:
            reasons.extend(
                c.value
                for c, _ in result.exclusion_reason_counts
                if c
                in {
                    MetricExclusion.CITATION_OBSERVATION_UNAVAILABLE,
                    MetricExclusion.CITATION_CLASSIFICATION_INCOMPLETE,
                }
            )
            count = sum(
                sum(int(owned) for _, owned in unique_citations(s.metric).values())
                for s in eligible
            )
            values.append(
                metric.model_copy(
                    update={
                        "metric_code": "owned_citation_count",
                        "value": float(count) if metric.value is not None else None,
                        "numerator": count,
                        "denominator": result.eligible_run_count,
                    }
                )
            )
        if code in {Code.CRITICAL_FACT_ERROR, Code.REPEATED_FACT_ERROR}:
            signatures = _error_signatures(snapshot, baseline)
            if not signatures:
                reasons.append("FROZEN_ERROR_SIGNATURE_UNAVAILABLE")
            if result.excluded_run_count or result.unjudgeable_claim_count:
                reasons.append("FACT_JUDGEMENT_INCOMPLETE")
            count = len(
                {
                    s.metric.run_id
                    for s in eligible
                    for c in s.evidence.claims
                    if c.subject_id == scope.subject_id
                    and c.verdict == "INCORRECT"
                    and claim_signature(c.claim_kind, c.claim_text) in signatures
                }
            )
            values.append(
                metric.model_copy(
                    update={
                        "metric_code": "same_fact_error_count",
                        "value": float(count) if metric.value is not None and signatures else None,
                        "numerator": count,
                        "denominator": result.eligible_run_count,
                    }
                )
            )
    return values, reasons


def _count_metric(
    code: str,
    value: float | None,
    numerator: int,
    denominator: int,
    candidates: int,
    eligible: int,
    policy: SamplePolicy,
    version: str,
) -> GeoRetestComparisonMetric:
    return GeoRetestComparisonMetric(
        metric_code=cast(ComparisonMetric, code),
        formula_version=version,
        value=value,
        numerator=numerator,
        denominator=denominator,
        candidate_run_count=candidates,
        eligible_run_count=eligible,
        excluded_run_count=candidates - eligible,
        sample_level=policy.level(eligible),
        exclusion_reason_counts=[
            GeoOverviewExclusion(
                code=MetricExclusion.RUN_NOT_COMPLETED, run_count=candidates - eligible
            )
        ]
        if candidates > eligible
        else [],
        unjudgeable_claim_count=0,
        dimensions=None,
        unavailable_reasons=[] if value is not None else ["NO_DENOMINATOR"],
    )


def _error_signatures(
    snapshot: GeoRetestBaselineSnapshot, baseline: list[OverviewInput]
) -> set[tuple[GeoClaimKind, str]]:
    trigger = snapshot.trigger_snapshot
    if trigger.rule_code == Code.REPEATED_FACT_ERROR:
        kind, digest = (
            trigger.details.get("claim_kind"),
            trigger.details.get("normalized_claim_sha256"),
        )
        if not isinstance(kind, str) or not isinstance(digest, str) or len(digest) != 64:
            return set()
        try:
            return {(GeoClaimKind(kind), digest)}
        except (TypeError, ValueError):
            return set()
    ids = trigger.details.get("claim_assessment_ids")
    if not isinstance(ids, list) or not ids:
        return set()
    claims = [
        c
        for s in baseline
        for c in s.evidence.claims
        if str(c.claim_assessment_id) in ids
        and c.subject_id == trigger.scope.subject_id
        and c.verdict == "INCORRECT"
        and c.severity in {"HIGH", "CRITICAL"}
    ]
    # 首次触发的任一错误证据未包含在本批冻结窗口时，不能宣称全部错误已恢复。
    if {str(c.claim_assessment_id) for c in claims} != set(ids):
        return set()
    return {claim_signature(c.claim_kind, c.claim_text) for c in claims}
