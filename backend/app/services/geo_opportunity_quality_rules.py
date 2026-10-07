"""702 操作规则：批次质量沿用602口径，失败序列只消费 latest 逻辑尝试。"""

import json
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from hashlib import sha256
from uuid import UUID

from app.schemas.geo_insights import GeoOverviewFilters, OverviewMetric
from app.schemas.geo_rules import GeoRuleCode
from app.services.geo_answer_insights import InsightCell
from app.services.geo_metric_types import MetricCode, MetricResult
from app.services.geo_metrics import calculate_metric
from app.services.geo_opportunity_types import (
    OpportunityScope,
    OpportunitySource,
    RuleEvaluation,
)
from app.services.geo_overview import QUALITY_VERSION, _quality
from app.services.geo_overview_queries import OverviewInput
from app.services.geo_rule_policy import FrozenRuleSet, sample_gates


def canonical_json(value: object) -> str:
    return json.dumps(value, default=str, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def environment_key(source: OverviewInput, *, collection_only: bool = False) -> str:
    """完整业务cell指纹，不含窗口和本次评估阈值；未知版本仍是null。"""
    dimensions = asdict(source.metric.dimensions)
    dimensions.pop("window_key")
    # profile revision之外保留实际冻结配置，不依赖当前可变Catalog。
    profile_key = sha256(source.snapshot.profile.model_dump_json().encode()).hexdigest()
    if collection_only:
        # 运维连续失败属于采集profile，题目/对象/下游analysis不改变采集环境。
        collection = {
            name: dimensions[name]
            for name in (
                "collection_profile_id",
                "profile_revision",
                "engine_surface_id",
                "surface_revision",
                "collection_mode",
                "language_code",
                "region_code",
                "login_state",
                "source_model",
                "source_product",
                "model_version",
                "product_version",
            )
        }
        return sha256(canonical_json([collection, profile_key]).encode()).hexdigest()
    competitors = sorted(
        str(s.id) for s in source.snapshot.subjects if s.role in {"PRIMARY", "COMPETITOR"}
    )
    return sha256(canonical_json([dimensions, profile_key, competitors]).encode()).hexdigest()


def sources_for(
    inputs: list[OverviewInput], *, role: str = "TRIGGER"
) -> tuple[OpportunitySource, ...]:
    return ordered_sources(
        OpportunitySource(s.metric.run_id, s.analysis_id, s.review_id, role) for s in inputs
    )


def ordered_sources(sources: Iterable[OpportunitySource]) -> tuple[OpportunitySource, ...]:
    """来源身份去重与稳定排序只有一个所有者，TRIGGER/BASELINE不互相覆盖。"""
    return tuple(
        sorted(
            set(sources),
            key=lambda s: (
                str(s.run_id),
                str(s.analysis_revision_id or ""),
                str(s.review_id or ""),
                s.source_role,
            ),
        )
    )


def _batch_scope(inputs: list[OverviewInput]) -> OpportunityScope:
    # 602操作质量允许一个批次包含多cell；该集合指纹不能冒充单一业务环境。
    key = sha256(canonical_json(sorted({environment_key(s) for s in inputs})).encode()).hexdigest()
    return OpportunityScope(None, None, None, None, None, inputs[0].metric.batch_id, key)


def cell_scope(cell: InsightCell, *, batch_id: UUID | None = None) -> OpportunityScope:
    d = cell.sources[0].metric.dimensions
    return OpportunityScope(
        cell.scope.subject_id,
        d.query_topic_id,
        d.prompt_variant_id,
        d.collection_profile_id,
        d.engine_surface_id,
        batch_id,
        environment_key(cell.sources[0]),
    )


def metric_details(result: MetricResult) -> dict[str, object]:
    return dict(
        metric_code=result.metric_code,
        formula_version=result.formula_version,
        value=result.value,
        numerator=result.numerator,
        denominator=result.denominator,
        eligible_run_count=result.eligible_run_count,
        excluded_run_count=result.excluded_run_count,
        sample_level=result.sample_level,
        dimensions=asdict(result.dimensions),
        sov_subject_ids=sorted(result.scope.sov_subject_ids),
        exclusion_reason_counts=dict(result.exclusion_reason_counts),
        unjudgeable_claim_count=result.unjudgeable_claim_count,
    )


def metric_reasons(result: MetricResult, *, minimum: int) -> tuple[str, ...]:
    reasons = []
    if result.value is None:
        reasons.append("NO_DENOMINATOR")
    if result.eligible_run_count < minimum:
        reasons.append("INSUFFICIENT_SAMPLE")
    if not result.eligible_run_count:
        reasons.extend(reason.value for reason, _ in result.exclusion_reason_counts)
    return tuple(dict.fromkeys(reasons))


def stability_rules(cell: InsightCell, rules: FrozenRuleSet) -> list[RuleEvaluation]:
    """采样稳定性是批次质量规则；不能用跨批次样本凑足重复数。"""
    batches: dict[UUID, list[OverviewInput]] = defaultdict(list)
    for source in cell.sources:
        batches[source.metric.batch_id].append(source)
    threshold = rules.configuration().stability_minimum_rate
    minimum = next(
        g.current_minimum
        for g in sample_gates(rules, current_runs=0, previous_runs=0)
        if g.rule_code == GeoRuleCode.UNSTABLE_RESULT
    )
    evaluations = []
    for batch_id, sources in sorted(batches.items()):
        result = calculate_metric(
            [s.metric for s in sources],
            metric=MetricCode.MENTION_STABILITY,
            scope=cell.scope,
            dimensions=sources[0].metric.dimensions,
            sample_policy=rules.sample_policy(),
        )
        reasons = metric_reasons(result, minimum=minimum)
        eligible = [s for s in sources if s.metric.run_id in result.eligible_run_ids]
        detail = metric_details(result)
        detail["repeat_indices"] = sorted({s.metric.repeat_index for s in eligible})
        evaluations.append(
            RuleEvaluation(
                GeoRuleCode.UNSTABLE_RESULT,
                cell_scope(cell, batch_id=batch_id),
                "MEDIUM",
                not reasons and result.value is not None and result.value < threshold,
                result.value,
                threshold,
                result.numerator,
                result.denominator,
                reasons,
                sources_for(eligible),
                canonical_json(detail),
            )
        )
    return evaluations


@dataclass(frozen=True)
class QualityMeasure:
    metric_code: OverviewMetric
    value: float | None
    threshold: float | None
    numerator: int
    denominator: int

    @property
    def failed(self) -> bool:
        return self.value is not None and self.threshold is not None and self.value < self.threshold


def quality_rules(
    inputs: list[OverviewInput], filters: GeoOverviewFilters, rules: FrozenRuleSet
) -> list[RuleEvaluation]:
    batches: dict[UUID, list[OverviewInput]] = defaultdict(list)
    for source in inputs:
        if not source.metric.superseded_attempt:
            batches[source.metric.batch_id].append(source)
    config = rules.configuration()
    thresholds: dict[OverviewMetric, float | None] = {
        "run_success_rate": config.data_quality_minimum_success_rate,
        "evidence_completeness": config.data_quality_minimum_evidence_rate,
    }
    evaluations = []
    # 完整批次可能含业务筛选外binding；602通用资格选取也必须看到其实际对象。
    governance_filters = filters.model_copy(update={"subject_ids": [], "product_ids": []})
    for _, batch in sorted(batches.items()):
        parts = _quality(batch, governance_filters)
        measures = []
        for code, threshold in thresholds.items():
            contributions = parts[code]
            numerator = sum(p.numerator for p in contributions)
            denominator = sum(p.denominator for p in contributions)
            value = numerator / denominator if denominator else None
            measures.append(QualityMeasure(code, value, threshold, numerator, denominator))
        configured = [m for m in measures if m.threshold is not None]
        failed = [m for m in configured if m.failed]
        # 一个已配置且有分母的失败条件足以触发OR；另一项未知保留在details，不能补零。
        unknown = [m for m in configured if m.value is None]
        chosen = (failed or unknown or configured or measures)[0]
        reasons = (
            ()
            if failed or configured and not unknown
            else ("THRESHOLD_NOT_CONFIGURED",)
            if not configured
            else ("NO_DENOMINATOR",)
        )
        selected = [p.source for code in thresholds for p in parts[code] if p.denominator]
        evaluations.append(
            RuleEvaluation(
                GeoRuleCode.DATA_QUALITY_PROBLEM,
                _batch_scope(batch),
                "MEDIUM",
                bool(failed),
                chosen.value,
                chosen.threshold,
                chosen.numerator,
                chosen.denominator,
                reasons,
                sources_for(selected),
                canonical_json(
                    dict(
                        formula_version=QUALITY_VERSION,
                        measures=[asdict(m) for m in measures],
                        candidate_run_count=len(batch),
                        dimension_count=len({environment_key(s) for s in batch}),
                    )
                ),
            )
        )
    return evaluations


def failure_rules(inputs: list[OverviewInput], rules: FrozenRuleSet) -> list[RuleEvaluation]:
    profiles: dict[UUID, list[OverviewInput]] = defaultdict(list)
    for source in inputs:
        if not source.metric.superseded_attempt:
            profiles[source.metric.dimensions.collection_profile_id].append(source)
    threshold = rules.configuration().run_failure_consecutive_limit
    evaluations = []
    for profile_id, profile in sorted(profiles.items()):
        ordered = sorted(profile, key=lambda s: (s.created_at, s.metric.run_id))
        latest = ordered[-1]
        key = environment_key(latest, collection_only=True)
        suffix = []
        # 只看profile时间序列的末尾。不按环境先分组，否则环境切换后会接回旧失败。
        for source in reversed(ordered):
            if (
                environment_key(source, collection_only=True) != key
                or source.metric.status != "FAILED"
            ):
                break
            suffix.append(source)
        count = len(suffix)
        dimensions = latest.metric.dimensions
        scope = OpportunityScope(
            None, None, None, profile_id, dimensions.engine_surface_id, environment_key=key
        )
        evaluations.append(
            RuleEvaluation(
                GeoRuleCode.RUN_FAILURE,
                scope,
                "HIGH",
                threshold is not None and count >= threshold,
                float(count),
                float(threshold) if threshold is not None else None,
                count,
                len(ordered),
                () if threshold is not None else ("THRESHOLD_NOT_CONFIGURED",),
                sources_for(suffix),
                canonical_json(
                    dict(
                        consecutive_failed_count=count,
                        candidate_run_count=len(ordered),
                        latest_run_id=str(latest.metric.run_id),
                        latest_status=latest.metric.status,
                        sequence_order="created_at/run_id",
                        environment_key=key,
                    )
                ),
            )
        )
    return evaluations
