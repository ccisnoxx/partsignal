"""702纯规则：只消费一致冻结输入，不查询、不重判事实、不写入或自动关闭机会。"""
# 严重事实错误随有效声明采用HIGH/CRITICAL；重复错误、竞品突增和连续失败为HIGH。
# 其他规则为MEDIUM；优先级仅保存评估建议，不实现通知或行动。

from collections import defaultdict
from dataclasses import asdict, replace
from datetime import timedelta
from fractions import Fraction
from hashlib import sha256
from uuid import UUID

from app.schemas.geo_insights import GeoOverviewFilters
from app.schemas.geo_rules import GeoRuleCode as Code
from app.services.geo_answer_insights import InsightCell, _cells
from app.services.geo_claim_signatures import claim_signature
from app.services.geo_insight_details import citation_events, claim_events
from app.services.geo_metric_types import MetricCode, MetricResult
from app.services.geo_metric_views import MetricWindow
from app.services.geo_metrics import calculate_metric, compare_metric_windows
from app.services.geo_opportunity_quality_rules import (
    canonical_json,
    cell_scope,
    environment_key,
    failure_rules,
    metric_details,
    metric_reasons,
    ordered_sources,
    quality_rules,
    sources_for,
    stability_rules,
)
from app.services.geo_opportunity_types import OpportunityScope, RuleEvaluation
from app.services.geo_overview_queries import OverviewInput
from app.services.geo_rule_policy import FrozenRuleSet, sample_gates


def _metric(cell: InsightCell, code: MetricCode, rules: FrozenRuleSet) -> MetricResult:
    return calculate_metric(
        [s.metric for s in cell.sources],
        metric=code,
        scope=cell.scope,
        dimensions=cell.sources[0].metric.dimensions,
        sample_policy=rules.sample_policy(),
    )


def _eligible(cell: InsightCell, result: MetricResult) -> list[OverviewInput]:
    ids = set(result.eligible_run_ids)
    return [s for s in cell.sources if s.metric.run_id in ids]


def _minimum(rules: FrozenRuleSet, code: Code) -> int:
    return next(
        g.current_minimum
        for g in sample_gates(rules, current_runs=0, previous_runs=0)
        if g.rule_code == code
    )


def _period_cells(
    inputs: list[OverviewInput], filters: GeoOverviewFilters, window: MetricWindow
) -> list[InsightCell]:
    groups: dict[str, list[OverviewInput]] = defaultdict(list)
    for source in inputs:
        if window.date_from <= source.created_at < window.date_to:
            metric = replace(
                source.metric, dimensions=replace(source.metric.dimensions, window_key=window.key)
            )
            groups[environment_key(source)].append(replace(source, metric=metric))
    # 复用603完整cell和固定竞争集合入口；额外冻结profile配置指纹防止跨环境拼样本。
    return [
        cell
        for _, parts in sorted(groups.items())
        for cell in _cells(parts, filters, "CURRENT").values()
    ]


def _own_primary(cell: InsightCell) -> bool:
    return any(
        s.id == cell.scope.subject_id
        and s.role == "PRIMARY"
        and s.subject_type in {"OWN_BRAND", "OWN_PRODUCT"}
        for s in cell.sources[0].snapshot.subjects
    )


def _comparison_rules(
    current: list[InsightCell], previous: list[InsightCell], rules: FrozenRuleSet
) -> list[RuleEvaluation]:
    config = rules.configuration()
    groups: dict[tuple[UUID, UUID, UUID], tuple[list[InsightCell], list[InsightCell]]] = {}
    for period, cells in enumerate((current, previous)):
        for cell in cells:
            d = cell.sources[0].metric.dimensions
            groups.setdefault(
                (cell.scope.subject_id, d.prompt_variant_id, d.collection_profile_id), ([], [])
            )[period].append(cell)
    evaluations = []
    for _, (now, before) in sorted(groups.items()):
        exemplar = (now or before)[0]
        selected = exemplar.public.selected_subject
        competitor = any(
            s.id == exemplar.scope.subject_id and s.role == "COMPETITOR"
            for s in exemplar.sources[0].snapshot.subjects
        )
        codes: list[tuple[Code, MetricCode, float]] = []
        if selected:
            codes.extend(
                (
                    (
                        Code.VISIBILITY_DROP,
                        MetricCode.NATURAL_VISIBILITY,
                        config.visibility_drop_points,
                    ),
                    (
                        Code.RECOMMENDATION_DROP,
                        MetricCode.RECOMMENDATION_RATE,
                        config.recommendation_drop_points,
                    ),
                    (Code.OWN_CITATION_LOST, MetricCode.OWNED_SOURCE_COVERAGE, 0.0),
                )
            )
        if competitor:
            codes.append(
                (
                    Code.COMPETITOR_SURGE,
                    MetricCode.RECOMMENDATION_SOV,
                    config.competitor_surge_points,
                )
            )
        for code, metric, threshold in codes:
            now_results = [_metric(c, metric, rules) for c in now]
            before_results = [_metric(c, metric, rules) for c in before]
            comparison = compare_metric_windows(
                now_results, before_results, metric=metric, sample_policy=rules.sample_policy()
            )
            reasons = [r.value for r in comparison.unavailable_reasons]
            if code == Code.OWN_CITATION_LOST:
                # 普通引用趋势是STABLE；702引用丢失明确采用701的两期REPORTABLE。
                reasons = [r for r in reasons if r != "INSUFFICIENT_SAMPLE"]
                gate = next(
                    g
                    for g in sample_gates(
                        rules,
                        current_runs=min([r.eligible_run_count for r in now_results], default=0),
                        previous_runs=min(
                            [r.eligible_run_count for r in before_results], default=0
                        ),
                    )
                    if g.rule_code == code
                )
                if not gate.sample_sufficient:
                    reasons.append("INSUFFICIENT_SAMPLE")
            for cell in now or before:
                result = _metric(cell, metric, rules)
                local_reasons = list(reasons)
                value = comparison.change_points
                # 保留601公开浮点值；门槛用原事件整数精确比较，避免0.7-0.6舍入漏触发。
                exact_change = (
                    Fraction(now_results[0].numerator, now_results[0].denominator)
                    - Fraction(before_results[0].numerator, before_results[0].denominator)
                    if value is not None
                    else None
                )
                trigger = False
                detail: dict[str, object] = dict(
                    current=[metric_details(r) for r in now_results],
                    previous=[metric_details(r) for r in before_results],
                    changed_dimensions=comparison.changed_dimensions,
                    version_warnings=comparison.version_warnings,
                    minimum_run_count=_minimum(rules, code),
                )
                if code == Code.OWN_CITATION_LOST:
                    events = [
                        (s, c)
                        for member in ([cell] if now else [])
                        for s, c in citation_events(member)
                        if c.source_category == "OWNED"
                    ]
                    baseline = [
                        (s, c)
                        for member in before
                        if len(before) == 1
                        for s, c in citation_events(member)
                        if c.source_category == "OWNED"
                    ]
                    detail.update(
                        current_owned_event_count=len(events) if now else None,
                        previous_owned_event_count=len(baseline) if len(before) == 1 else None,
                        previous_count_threshold=config.own_citation_previous_count,
                        citation_ids=sorted({c.citation_id for _, c in events}),
                        baseline_citation_ids=sorted({c.citation_id for _, c in baseline}),
                    )
                    # 当前存在不可观察无引用的候选时，已观察子集的零不能推广到整个周期。
                    observation = {
                        reason.value
                        for r in now_results
                        for reason, _ in r.exclusion_reason_counts
                        if reason.value == "CITATION_OBSERVATION_UNAVAILABLE"
                    }
                    local_reasons.extend(sorted(observation))
                    value = float(len(events)) if now and not local_reasons else None
                    trigger = value == 0 and len(baseline) >= config.own_citation_previous_count
                elif code == Code.COMPETITOR_SURGE:
                    primary_results = []
                    for member in current:
                        if (
                            _own_primary(member)
                            and member.scope.sov_subject_ids == cell.scope.sov_subject_ids
                            and environment_key(member.sources[0])
                            == environment_key(cell.sources[0])
                        ):
                            primary_results.append(_metric(member, metric, rules))
                    detail["primary_values"] = [metric_details(r) for r in primary_results]
                    if not primary_results:
                        local_reasons.append("PRIMARY_SUBJECT_UNAVAILABLE")
                    else:
                        local_reasons.extend(
                            reason
                            for r in primary_results
                            for reason in metric_reasons(r, minimum=_minimum(rules, code))
                        )
                    if value is not None and result.value is not None:
                        trigger = (
                            exact_change is not None
                            and exact_change >= Fraction(str(threshold))
                            and exact_change > 0
                            and all(
                                r.value is not None and result.value > r.value
                                for r in primary_results
                            )
                        )
                else:
                    trigger = (
                        exact_change is not None
                        and exact_change <= -Fraction(str(threshold))
                        and exact_change < 0
                    )
                for r in (*now_results, *before_results):
                    if not r.eligible_run_count:
                        local_reasons.extend(
                            reason.value for reason, _ in r.exclusion_reason_counts
                        )
                unavailable = tuple(dict.fromkeys(local_reasons))
                sources = sources_for(
                    [s for c, r in zip(now, now_results, strict=True) for s in _eligible(c, r)]
                ) + sources_for(
                    [
                        s
                        for c, r in zip(before, before_results, strict=True)
                        for s in _eligible(c, r)
                    ],
                    role="BASELINE",
                )
                evaluations.append(
                    RuleEvaluation(
                        code,
                        cell_scope(cell),
                        "HIGH" if code == Code.COMPETITOR_SURGE else "MEDIUM",
                        trigger and not unavailable,
                        value if not unavailable else None,
                        -threshold
                        if code in {Code.VISIBILITY_DROP, Code.RECOMMENDATION_DROP}
                        else threshold,
                        result.numerator if now else 0,
                        result.denominator if now else 0,
                        unavailable,
                        ordered_sources(sources),
                        canonical_json(detail),
                    )
                )
    return evaluations


def _coverage_and_critical(cell: InsightCell, rules: FrozenRuleSet) -> list[RuleEvaluation]:
    visibility = _metric(cell, MetricCode.NATURAL_VISIBILITY, rules)
    reasons = metric_reasons(visibility, minimum=_minimum(rules, Code.TOPIC_COVERAGE_GAP))
    if not _own_primary(cell):
        reasons += ("SUBJECT_NOT_APPLICABLE",)
    if cell.sources[0].snapshot.prompt.priority != "CORE":
        reasons += ("TOPIC_NOT_CORE",)
    coverage = RuleEvaluation(
        Code.TOPIC_COVERAGE_GAP,
        cell_scope(cell),
        "MEDIUM",
        not reasons and visibility.numerator == 0,
        visibility.value,
        0.0,
        visibility.numerator,
        visibility.denominator,
        reasons,
        sources_for(_eligible(cell, visibility)),
        canonical_json(metric_details(visibility)),
    )
    severe = _metric(cell, MetricCode.SEVERE_ERROR_RUN_RATE, rules)
    errors = [
        (s, c)
        for s, c in claim_events(cell)
        if c.verdict == "INCORRECT" and c.severity in {"HIGH", "CRITICAL"}
    ]
    reasons = metric_reasons(severe, minimum=_minimum(rules, Code.CRITICAL_FACT_ERROR))
    detail = metric_details(severe)
    detail["claim_assessment_ids"] = sorted({c.claim_assessment_id for _, c in errors})
    priority = "CRITICAL" if any(c.severity == "CRITICAL" for _, c in errors) else "HIGH"
    critical = RuleEvaluation(
        Code.CRITICAL_FACT_ERROR,
        cell_scope(cell),
        priority,
        not reasons and severe.numerator >= 1,
        float(severe.numerator) if severe.value is not None else None,
        1.0,
        severe.numerator,
        severe.denominator,
        reasons,
        sources_for(_eligible(cell, severe)),
        canonical_json(detail),
    )
    return [coverage, critical]


def _repeated(
    cell: InsightCell, filters: GeoOverviewFilters, rules: FrozenRuleSet
) -> list[RuleEvaluation]:
    config = rules.configuration()
    eligible = _metric(cell, MetricCode.ANSWER_COVERAGE, rules)
    baseline = _eligible(cell, eligible)
    groups = defaultdict(list)
    for source, claim in claim_events(cell):
        if claim.verdict == "INCORRECT":
            # 只保存指纹；subject和claim_kind分别构成同类错误边界，不泄露原声明/事实。
            key = claim_signature(claim.claim_kind, claim.claim_text)
            groups[key].append((source, claim))
    evaluations = []
    for (kind, digest), events in sorted(groups.items()):
        ids = {s.metric.run_id for s, _ in events}
        count = len(ids)
        reasons = metric_reasons(eligible, minimum=config.repeated_error_minimum_runs)
        evaluations.append(
            RuleEvaluation(
                Code.REPEATED_FACT_ERROR,
                cell_scope(cell),
                "HIGH",
                not reasons and count >= config.repeated_error_minimum_runs,
                float(count),
                float(config.repeated_error_minimum_runs),
                count,
                eligible.eligible_run_count,
                reasons,
                sources_for([s for s in baseline if s.created_at >= filters.date_from])
                + sources_for(
                    [s for s in baseline if s.created_at < filters.date_from], role="BASELINE"
                ),
                canonical_json(
                    dict(
                        claim_kind=kind,
                        normalized_claim_sha256=digest,
                        claim_assessment_ids=sorted({c.claim_assessment_id for _, c in events}),
                        distinct_error_run_count=count,
                        window_days=config.repeated_error_window_days,
                        window_end=filters.date_to,
                        eligible_run_count=eligible.eligible_run_count,
                    )
                ),
            )
        )
    if not groups:
        reasons = metric_reasons(eligible, minimum=config.repeated_error_minimum_runs)
        evaluations.append(
            RuleEvaluation(
                Code.REPEATED_FACT_ERROR,
                cell_scope(cell),
                "HIGH",
                False,
                0.0 if eligible.value is not None else None,
                float(config.repeated_error_minimum_runs),
                0,
                eligible.eligible_run_count,
                reasons,
                sources_for(_eligible(cell, eligible)),
                canonical_json(
                    dict(distinct_error_run_count=0, window_days=config.repeated_error_window_days)
                ),
            )
        )
    return evaluations


def evaluate_rules(
    inputs: list[OverviewInput],
    filters: GeoOverviewFilters,
    rules: FrozenRuleSet,
    *,
    quality_inputs: list[OverviewInput] | None = None,
    failure_inputs: list[OverviewInput] | None = None,
) -> list[RuleEvaluation]:
    if len({s.metric.run_id for s in inputs}) != len(inputs):
        raise ValueError("规则评估不得重复输入同一Run")
    active = [
        (
            s.metric.batch_id,
            s.metric.dimensions.prompt_variant_id,
            s.metric.dimensions.collection_profile_id,
            s.metric.repeat_index,
        )
        for s in inputs
        if not s.metric.superseded_attempt
    ]
    if len(set(active)) != len(active):
        raise ValueError("每个逻辑样本只能提供latest attempt")
    window = MetricWindow(filters.date_from, filters.date_to)
    current = _period_cells(inputs, filters, window)
    previous = _period_cells(inputs, filters, window.previous)
    evaluations = _comparison_rules(current, previous, rules)
    for cell in current:
        if cell.public.selected_subject:
            evaluations.extend(_coverage_and_critical(cell, rules))
            evaluations.extend(stability_rules(cell, rules))
    repeated_window = MetricWindow(
        filters.date_to - timedelta(days=rules.configuration().repeated_error_window_days),
        filters.date_to,
    )
    for cell in _period_cells(inputs, filters, repeated_window):
        if cell.public.selected_subject:
            evaluations.extend(_repeated(cell, filters, rules))
    candidates = [s for s in inputs if filters.date_from <= s.created_at < filters.date_to]
    evaluations.extend(
        quality_rules(candidates if quality_inputs is None else quality_inputs, filters, rules)
    )
    evaluations.extend(
        failure_rules(candidates if failure_inputs is None else failure_inputs, rules)
    )
    present = {e.rule_code for e in evaluations}
    config = rules.configuration()
    thresholds = {
        Code.VISIBILITY_DROP: -config.visibility_drop_points,
        Code.RECOMMENDATION_DROP: -config.recommendation_drop_points,
        Code.COMPETITOR_SURGE: config.competitor_surge_points,
        Code.TOPIC_COVERAGE_GAP: 0.0,
        Code.OWN_CITATION_LOST: 0.0,
        Code.CRITICAL_FACT_ERROR: 1.0,
        Code.REPEATED_FACT_ERROR: float(config.repeated_error_minimum_runs),
        Code.UNSTABLE_RESULT: config.stability_minimum_rate,
        Code.DATA_QUALITY_PROBLEM: config.data_quality_minimum_success_rate
        if config.data_quality_minimum_success_rate is not None
        else config.data_quality_minimum_evidence_rate,
        Code.RUN_FAILURE: float(config.run_failure_consecutive_limit)
        if config.run_failure_consecutive_limit is not None
        else None,
    }
    for code in Code:
        if code not in present:
            evaluations.append(
                RuleEvaluation(
                    code,
                    OpportunityScope(
                        None,
                        None,
                        None,
                        None,
                        None,
                        environment_key=sha256(b"NO_CANDIDATES").hexdigest(),
                    ),
                    "MEDIUM",
                    False,
                    None,
                    thresholds[code],
                    0,
                    0,
                    ("NO_CANDIDATES",),
                    (),
                    "{}",
                )
            )
    evaluations = [replace(e, sources=ordered_sources(e.sources)) for e in evaluations]
    return sorted(
        evaluations,
        key=lambda e: (e.rule_code.value, canonical_json(asdict(e.scope)), e.details_json),
    )
