"""回答级 GEO 资格和公式唯一所有者；GEO-602 再接入读模型/API。"""

from collections import Counter
from collections.abc import Sequence

from app.schemas.configuration import IntentType
from app.schemas.geo_analysis import GeoClaimSeverity, GeoClaimVerdict
from app.services.geo_metric_types import (
    MetricCode,
    MetricDimensions,
    MetricEligibility,
    MetricExclusion,
    MetricResult,
    MetricRun,
    MetricScope,
    MetricSubject,
    SamplePolicy,
)

FORMULA_VERSION = "geo-answer-v1"
DEFAULT_SAMPLE_POLICY = SamplePolicy()
RECOMMENDATION_INTENTS = frozenset(
    {IntentType.PRODUCT, IntentType.REPLACEMENT, IntentType.COMPARISON, IntentType.APPLICATION}
)
RECOMMENDATION_METRICS = frozenset(
    {
        MetricCode.RECOMMENDATION_RATE,
        MetricCode.TOP_RECOMMENDATION_RATE,
        MetricCode.AVERAGE_RECOMMENDATION_RANK,
        MetricCode.RECOMMENDATION_SOV,
        MetricCode.RECOMMENDATION_STABILITY,
    }
)
CITATION_METRICS = frozenset(
    {MetricCode.OWNED_SOURCE_COVERAGE, MetricCode.OWNED_CITATION_SHARE, MetricCode.DOMAIN_COVERAGE}
)
CLAIM_METRICS = frozenset(
    {
        MetricCode.ACCURATE_CLAIM_RATE,
        MetricCode.PARTIAL_CLAIM_RATE,
        MetricCode.INCORRECT_CLAIM_RATE,
        MetricCode.SEVERE_ERROR_RUN_RATE,
    }
)
SOV_METRICS = frozenset({MetricCode.MENTION_SOV, MetricCode.RECOMMENDATION_SOV})
STABILITY_METRICS = frozenset({MetricCode.MENTION_STABILITY, MetricCode.RECOMMENDATION_STABILITY})


def subject_fact(run: MetricRun, scope: MetricScope) -> MetricSubject | None:
    return next((item for item in run.subjects if item.subject_id == scope.subject_id), None)


def unique_citations(run: MetricRun) -> dict[str, tuple[str, bool]]:
    citations: dict[str, tuple[str, bool]] = {}
    for citation in run.citations:
        classification = (citation.hostname, citation.owned)
        existing = citations.setdefault(citation.normalized_url, classification)
        if existing != classification:
            raise ValueError("同一规范 URL 的引用事实冲突")
    return citations


def metric_eligibility(
    run: MetricRun,
    *,
    metric: MetricCode,
    scope: MetricScope,
    dimensions: MetricDimensions,
) -> MetricEligibility:
    """收集稳定原因码，不把不合格运行转换为 false 的业务事实。"""
    reasons: list[MetricExclusion] = []
    checks = (
        (run.status != "COMPLETED", MetricExclusion.RUN_NOT_COMPLETED),
        (not run.answer_present, MetricExclusion.ANSWER_MISSING_OR_EMPTY),
        (not run.current_analysis_available, MetricExclusion.CURRENT_ANALYSIS_UNAVAILABLE),
        (
            run.review_required and not run.current_review_valid,
            MetricExclusion.CURRENT_REVIEW_REQUIRED,
        ),
        (not run.integrity_valid, MetricExclusion.INTEGRITY_ERROR),
        (run.administrator_excluded, MetricExclusion.ADMINISTRATOR_EXCLUDED),
        (run.superseded_attempt, MetricExclusion.SUPERSEDED_ATTEMPT),
        (run.dimensions != dimensions, MetricExclusion.DIMENSION_MISMATCH),
        (
            scope.subject_id not in run.applicable_subject_ids,
            MetricExclusion.SUBJECT_NOT_APPLICABLE,
        ),
    )
    reasons.extend(reason for failed, reason in checks if failed)
    unbranded_only = metric == MetricCode.NATURAL_VISIBILITY or metric in SOV_METRICS
    if (unbranded_only and dimensions.mention_mode != "UNBRANDED") or (
        metric == MetricCode.BRANDED_ANSWER and dimensions.mention_mode != "BRANDED"
    ):
        reasons.append(MetricExclusion.MENTION_MODE_NOT_APPLICABLE)
    if metric == MetricCode.PRODUCT_MENTION and not scope.is_product:
        reasons.append(MetricExclusion.SUBJECT_NOT_APPLICABLE)
    if metric in RECOMMENDATION_METRICS and dimensions.intent_type not in RECOMMENDATION_INTENTS:
        reasons.append(MetricExclusion.INTENT_NOT_APPLICABLE)
    if metric == MetricCode.TOP_RECOMMENDATION_RATE and not any(
        subject.rank is not None for subject in run.subjects
    ):
        reasons.append(MetricExclusion.RELIABLE_ORDER_UNAVAILABLE)
    fact = subject_fact(run, scope)
    if metric == MetricCode.AVERAGE_RECOMMENDATION_RANK and (fact is None or fact.rank is None):
        reasons.append(MetricExclusion.TARGET_RANK_UNAVAILABLE)
    if metric in CITATION_METRICS:
        if not run.citations and not run.citation_absence_observable:
            reasons.append(MetricExclusion.CITATION_OBSERVATION_UNAVAILABLE)
        if not run.citation_classification_complete:
            reasons.append(MetricExclusion.CITATION_CLASSIFICATION_INCOMPLETE)
    if metric in CLAIM_METRICS and not any(
        claim.subject_id == scope.subject_id and claim.verdict != GeoClaimVerdict.UNJUDGEABLE
        for claim in run.claims
    ):
        reasons.append(MetricExclusion.ASSESSABLE_CLAIM_UNAVAILABLE)
    return MetricEligibility(tuple(dict.fromkeys(reasons)))


def _events(run: MetricRun, metric: MetricCode, scope: MetricScope) -> tuple[int, int]:
    fact = subject_fact(run, scope)
    mentioned = fact is not None and fact.mentioned
    recommended = fact is not None and fact.recommended
    if metric in {
        MetricCode.ANSWER_COVERAGE,
        MetricCode.NATURAL_VISIBILITY,
        MetricCode.PRODUCT_MENTION,
        MetricCode.MENTION_STABILITY,
    }:
        return int(mentioned), 1
    if metric == MetricCode.BRANDED_ANSWER:
        return int(fact is not None and fact.described), 1
    if metric in {MetricCode.RECOMMENDATION_RATE, MetricCode.RECOMMENDATION_STABILITY}:
        return int(recommended), 1
    if metric == MetricCode.TOP_RECOMMENDATION_RATE:
        return int(fact is not None and fact.rank == 1), 1
    if metric == MetricCode.AVERAGE_RECOMMENDATION_RANK:
        assert fact is not None and fact.rank is not None
        return fact.rank, 1
    if metric in SOV_METRICS:
        events = {
            item.subject_id
            for item in run.subjects
            if item.subject_id in scope.sov_subject_ids
            and (item.mentioned if metric == MetricCode.MENTION_SOV else item.recommended)
        }
        return int(scope.subject_id in events), len(events)
    if metric in CITATION_METRICS:
        citations = unique_citations(run)
        if metric == MetricCode.OWNED_CITATION_SHARE:
            return sum(owned for _, owned in citations.values()), len(citations)
        if metric == MetricCode.OWNED_SOURCE_COVERAGE:
            return int(any(owned for _, owned in citations.values())), 1
        return int(any(host == scope.domain for host, _ in citations.values())), 1
    if metric in CLAIM_METRICS:
        claims = [
            claim
            for claim in run.claims
            if claim.subject_id == scope.subject_id and claim.verdict != GeoClaimVerdict.UNJUDGEABLE
        ]
        if metric == MetricCode.SEVERE_ERROR_RUN_RATE:
            severe = any(
                claim.verdict == GeoClaimVerdict.INCORRECT
                and claim.severity in {GeoClaimSeverity.HIGH, GeoClaimSeverity.CRITICAL}
                for claim in claims
            )
            return int(severe), 1
        verdict = {
            MetricCode.ACCURATE_CLAIM_RATE: GeoClaimVerdict.ACCURATE,
            MetricCode.PARTIAL_CLAIM_RATE: GeoClaimVerdict.PARTIAL,
            MetricCode.INCORRECT_CLAIM_RATE: GeoClaimVerdict.INCORRECT,
        }[metric]
        return sum(claim.verdict == verdict for claim in claims), len(claims)
    raise ValueError("未定义的指标公式")


def calculate_metric(
    runs: Sequence[MetricRun],
    *,
    metric: MetricCode,
    scope: MetricScope,
    dimensions: MetricDimensions,
    sample_policy: SamplePolicy = DEFAULT_SAMPLE_POLICY,
) -> MetricResult:
    """一个明确 cell 的比例；不聚合不同环境，不按平均百分比计算事件份额。"""
    if metric in SOV_METRICS and (
        scope.subject_id not in scope.sov_subject_ids
        or not scope.sov_subject_ids <= {identity for identity, _ in dimensions.subject_versions}
    ):
        raise ValueError("SOV 必须指定包含目标的冻结监测对象集合")
    if metric == MetricCode.DOMAIN_COVERAGE and not scope.domain:
        raise ValueError("域名覆盖必须指定已归一域名")
    if len({run.run_id for run in runs}) != len(runs):
        raise ValueError("同一运行不得重复输入")
    active_samples = [
        (
            run.batch_id,
            run.dimensions.prompt_variant_id,
            run.dimensions.collection_profile_id,
            run.repeat_index,
        )
        for run in runs
        if not run.superseded_attempt and run.dimensions == dimensions
    ]
    if len(set(active_samples)) != len(active_samples):
        raise ValueError("每个重复样本只能提供 latest attempt，不能按成功挑选重试")
    eligible: list[MetricRun] = []
    reasons: Counter[MetricExclusion] = Counter()
    excluded = 0
    unjudgeable = 0
    for run in runs:
        qualification = metric_eligibility(run, metric=metric, scope=scope, dimensions=dimensions)
        # 不可判断数包含仅因没有可判断声明而排除的运行，不包含失败或旧分析。
        if metric in CLAIM_METRICS and not (
            set(qualification.exclusion_reasons) - {MetricExclusion.ASSESSABLE_CLAIM_UNAVAILABLE}
        ):
            unjudgeable += sum(
                claim.subject_id == scope.subject_id
                and claim.verdict == GeoClaimVerdict.UNJUDGEABLE
                for claim in run.claims
            )
        if qualification.eligible:
            eligible.append(run)
        else:
            excluded += 1
            reasons.update(qualification.exclusion_reasons)
    if metric in STABILITY_METRICS:
        if len({run.batch_id for run in eligible}) > 1:
            raise ValueError("稳定性只能在同一批次的同一 cell 计算")
        if len(eligible) < 2:
            reasons[MetricExclusion.INSUFFICIENT_REPEATS] += len(eligible)
            excluded += len(eligible)
            eligible = []
    events = [_events(run, metric, scope) for run in eligible]
    numerator = sum(item[0] for item in events)
    denominator = sum(item[1] for item in events)
    if metric in STABILITY_METRICS:
        numerator = max(numerator, denominator - numerator)
    return MetricResult(
        metric_code=metric,
        formula_version=FORMULA_VERSION,
        dimensions=dimensions,
        scope=scope,
        value=numerator / denominator if denominator else None,
        numerator=numerator,
        denominator=denominator,
        sample_level=sample_policy.level(len(eligible)),
        eligible_run_count=len(eligible),
        excluded_run_count=excluded,
        exclusion_reason_counts=tuple(sorted(reasons.items())),
        eligible_run_ids=tuple(sorted(run.run_id for run in eligible)),
        unjudgeable_claim_count=unjudgeable,
    )
