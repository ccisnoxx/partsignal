"""GEO-603应用读模型：窗口、完整cell、趋势和覆盖；不拥有持久化写入。"""

import json
from collections import defaultdict
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from hashlib import sha256
from typing import cast
from uuid import UUID

from sqlalchemy.orm import Session

from app.errors import not_found
from app.schemas.geo_answer_insights import (
    GeoAnswerInsightCell,
    GeoAnswerInsightDrilldown,
    GeoAnswerInsightMetric,
    GeoAnswerInsightRunPage,
    GeoAnswerInsights,
    GeoAnswerInsightSampleFilters,
    GeoAnswerInsightTrend,
    GeoInsightWindow,
    GeoPlatformPerformance,
    GeoQuestionCoverage,
    GeoQuestionVariantCoverage,
    InsightMetric,
    Period,
)
from app.schemas.geo_insights import (
    GeoOverviewDimensions,
    GeoOverviewExclusion,
    GeoOverviewFilters,
    GeoOverviewRunSample,
)
from app.services.geo_metric_inputs import metric_scope_from_snapshot
from app.services.geo_metric_types import MetricCode, MetricDimensions, MetricResult, MetricScope
from app.services.geo_metric_views import CoveragePolicy, MetricWindow
from app.services.geo_metrics import (
    DEFAULT_SAMPLE_POLICY,
    calculate_metric,
    calculate_metrics,
    compare_metric_windows,
    coverage_classification,
    metric_eligibility,
)
from app.services.geo_overview_queries import OverviewInput, load_inputs, selected_subjects

BUSINESS_METRICS = (
    MetricCode.NATURAL_VISIBILITY,
    MetricCode.RECOMMENDATION_RATE,
    MetricCode.ACCURATE_CLAIM_RATE,
    MetricCode.OWNED_SOURCE_COVERAGE,
    MetricCode.OWNED_CITATION_SHARE,
    MetricCode.PARTIAL_CLAIM_RATE,
    MetricCode.INCORRECT_CLAIM_RATE,
    MetricCode.SEVERE_ERROR_RUN_RATE,
)
SOV_METRICS = (MetricCode.MENTION_SOV, MetricCode.RECOMMENDATION_SOV)
TREND_METRICS = (
    MetricCode.NATURAL_VISIBILITY,
    MetricCode.RECOMMENDATION_RATE,
    MetricCode.ACCURATE_CLAIM_RATE,
    *SOV_METRICS,
)
COVERAGE_POLICY = CoveragePolicy()


@dataclass
class InsightCell:
    public: GeoAnswerInsightCell
    sources: list[OverviewInput]
    scope: MetricScope
    results: dict[MetricCode, MetricResult]


def _cells(
    inputs: list[OverviewInput],
    filters: GeoOverviewFilters,
    period: Period,
) -> dict[str, InsightCell]:
    groups: dict[str, list[OverviewInput]] = defaultdict(list)
    metadata: dict[str, tuple[UUID, MetricScope, bool]] = {}
    # 按完整维度复用序列化，仅存活于本次调用；公式、cell键及分层规则保持一致。
    serialized: dict[MetricDimensions, str] = {}
    bindings: dict[tuple[str, int], list[tuple[UUID, MetricScope, str, bool]]] = {}
    for source in inputs:
        dimension_json = serialized.get(source.metric.dimensions)
        if dimension_json is None:
            dimension_json = GeoOverviewDimensions.model_validate(
                asdict(source.metric.dimensions)
            ).model_dump_json()
            serialized[source.metric.dimensions] = dimension_json
        # snapshot对象只读且由完整输入指纹复用，整个inputs持有它们，id不会被回收重用。
        # 维度仍完整入键；只复用绑定元信息，Run事实与贡献逐条进入同一分组。
        binding_key = dimension_json, id(source.snapshot)
        entries = bindings.get(binding_key)
        if entries is None:
            selected_ids = selected_subjects(source.snapshot, filters)
            # 筛选目标不改变实际冻结竞争集合；同行竞争对象也必须展示SOV。
            sov = frozenset(
                s.id for s in source.snapshot.subjects if s.role in {"PRIMARY", "COMPETITOR"}
            )
            entries = []
            for identity in sorted(selected_ids | set(sov)):
                scope = metric_scope_from_snapshot(source.snapshot, subject_id=identity)
                key = sha256(
                    (
                        dimension_json
                        + str(identity)
                        + ":".join(str(s) for s in sorted(scope.sov_subject_ids))
                    ).encode()
                ).hexdigest()
                entries.append((identity, scope, key, identity in selected_ids))
            bindings[binding_key] = entries
        for identity, scope, key, selected in entries:
            groups[key].append(source)
            metadata[key] = identity, scope, selected
    cells = {}
    for key in sorted(groups):
        sources = groups[key]
        identity, scope, selected = metadata[key]
        codes: tuple[MetricCode, ...] = BUSINESS_METRICS if selected else ()
        if identity in scope.sov_subject_ids:
            codes += SOV_METRICS
        results = calculate_metrics(
            [s.metric for s in sources], metrics=codes, scope=scope,
            dimensions=sources[0].metric.dimensions,
        )
        subject = next(s for s in sources[0].snapshot.subjects if s.id == identity)
        cards = [
            GeoAnswerInsightMetric(
                metric_code=cast(InsightMetric, code.value),
                formula_version=result.formula_version,
                value=result.value,
                numerator=result.numerator,
                denominator=result.denominator,
                sample_level=result.sample_level,
                eligible_run_count=result.eligible_run_count,
                excluded_run_count=result.excluded_run_count,
                exclusion_reason_counts=[
                    GeoOverviewExclusion(code=reason, run_count=count)
                    for reason, count in result.exclusion_reason_counts
                ],
                unjudgeable_claim_count=result.unjudgeable_claim_count,
                unavailable_reason=None if result.denominator else "NO_DENOMINATOR",
                drilldown=GeoAnswerInsightDrilldown(
                    filters=filters,
                    cell_key=key,
                    metric_code=cast(InsightMetric, code.value),
                    period=period,
                    cohort="DENOMINATOR",
                ),
            )
            for code, result in results.items()
        ]
        cells[key] = InsightCell(
            GeoAnswerInsightCell(
                cell_key=key,
                subject_id=identity,
                product_id=subject.product_id,
                display_name=subject.display_name,
                selected_subject=selected,
                dimensions=GeoOverviewDimensions.model_validate(
                    asdict(sources[0].metric.dimensions)
                ),
                sov_subject_ids=sorted(scope.sov_subject_ids),
                metrics=cards,
            ),
            sources,
            scope,
            results,
        )
    return cells


def _windows(
    db: Session,
    filters: GeoOverviewFilters,
) -> tuple[
    GeoInsightWindow, GeoInsightWindow, datetime, dict[str, InsightCell], dict[str, InsightCell]
]:
    window = MetricWindow(filters.date_from, filters.date_to)
    combined = filters.model_copy(update={"date_from": window.previous.date_from})
    as_of, inputs = load_inputs(db, combined)
    current: list[OverviewInput] = []
    previous: list[OverviewInput] = []
    dimensions_by_period: dict[tuple[bool, MetricDimensions], MetricDimensions] = {}
    for source in inputs:
        is_current = source.created_at >= window.date_from
        identity = is_current, source.metric.dimensions
        dimensions = dimensions_by_period.get(identity)
        if dimensions is None:
            dimensions = replace(
                source.metric.dimensions,
                window_key=window.key if is_current else window.previous.key,
            )
            dimensions_by_period[identity] = dimensions
        value = replace(source, metric=replace(source.metric, dimensions=dimensions))
        (current if is_current else previous).append(value)
    return (
        GeoInsightWindow(**asdict(window)),
        GeoInsightWindow(**asdict(window.previous)),
        as_of,
        _cells(current, filters, "CURRENT"),
        _cells(previous, filters, "PREVIOUS"),
    )


def _trends(
    current: dict[str, InsightCell], previous: dict[str, InsightCell]
) -> list[GeoAnswerInsightTrend]:
    groups: dict[
        tuple[UUID, UUID, UUID, MetricCode], tuple[list[InsightCell], list[InsightCell]]
    ] = {}
    for period, cells in enumerate((current, previous)):
        for cell in cells.values():
            d = cell.public.dimensions
            for code in cell.results:
                if code not in TREND_METRICS:
                    continue
                key = cell.scope.subject_id, d.prompt_variant_id, d.collection_profile_id, code
                groups.setdefault(key, ([], []))[period].append(cell)
    values = []
    for (identity, prompt, profile, code), (now, before) in sorted(groups.items()):
        comparison = compare_metric_windows(
            [c.results[code] for c in now], [c.results[code] for c in before], metric=code
        )
        values.append(
            GeoAnswerInsightTrend(
                subject_id=identity,
                prompt_variant_id=prompt,
                collection_profile_id=profile,
                metric_code=cast(InsightMetric, code.value),
                current_cell_keys=[c.public.cell_key for c in now],
                previous_cell_keys=[c.public.cell_key for c in before],
                **asdict(comparison),
            )
        )
    return values


def _coverage(cells: dict[str, InsightCell]) -> list[GeoQuestionCoverage]:
    groups: dict[tuple[UUID, str], list[InsightCell]] = defaultdict(list)
    for cell in cells.values():
        if (
            MetricCode.NATURAL_VISIBILITY not in cell.results
            or cell.public.dimensions.mention_mode != "UNBRANDED"
        ):
            continue
        # 主题覆盖显式跨问题计数，其余环境/规则/版本/竞争集合保持分层。
        dimensions = cell.public.dimensions.model_dump(
            exclude={
                "query_topic_id",
                "query_topic_revision",
                "prompt_variant_id",
                "prompt_revision",
            },
            mode="json",
        )
        key = sha256(
            json.dumps(
                [dimensions, [str(identity) for identity in cell.public.sov_subject_ids]],
                sort_keys=True,
            ).encode()
        ).hexdigest()
        groups[cell.scope.subject_id, key].append(cell)
    values = []
    for (identity, key), members in sorted(groups.items()):
        monitored, eligible, reached = set(), set(), set()
        variants = []
        for cell in members:
            result = cell.results[MetricCode.NATURAL_VISIBILITY]
            topic = cell.public.dimensions.query_topic_id
            monitored.add(topic)
            if result.eligible_run_count:
                eligible.add(topic)
            target = (
                result.value is not None
                and result.value >= COVERAGE_POLICY.target_rate
                and result.eligible_run_count >= DEFAULT_SAMPLE_POLICY.reportable_minimum
            )
            if target:
                reached.add(topic)
            classification, reason = coverage_classification(
                result, target_rate=COVERAGE_POLICY.target_rate
            )
            variants.append(
                GeoQuestionVariantCoverage(
                    cell_key=cell.public.cell_key,
                    classification=classification,
                    unavailable_reason=reason,
                    target_reached=target,
                )
            )
        values.append(
            GeoQuestionCoverage(
                subject_id=identity,
                stratum_key=key,
                variant_results=variants,
                monitored_topic_ids=sorted(monitored),
                eligible_topic_ids=sorted(eligible),
                reached_topic_ids=sorted(reached),
                numerator=len(reached),
                monitored_denominator=len(monitored),
                eligible_denominator=len(eligible),
                target_topic_coverage=len(reached) / len(monitored) if monitored else None,
                positive_topic_coverage=len(reached) / len(eligible) if eligible else None,
                target_rate=COVERAGE_POLICY.target_rate,
                reportable_minimum=DEFAULT_SAMPLE_POLICY.reportable_minimum,
                stable_minimum=DEFAULT_SAMPLE_POLICY.stable_minimum,
            )
        )
    return values


def get_insights(db: Session, filters: GeoOverviewFilters) -> GeoAnswerInsights:
    from app.services.geo_insight_details import summaries
    from app.services.geo_insight_quality import data_quality

    window, previous_window, as_of, current, previous = _windows(db, filters)
    citations, risks = summaries(current, filters)
    inputs = list({s.metric.run_id: s for c in current.values() for s in c.sources}.values())
    platforms: dict[UUID, list[str]] = defaultdict(list)
    for key, cell in current.items():
        if cell.public.selected_subject:
            platforms[cell.public.dimensions.engine_surface_id].append(key)
    return GeoAnswerInsights(
        as_of=as_of,
        filters=filters,
        current_window=window,
        previous_window=previous_window,
        current_cells=[c.public for c in current.values()],
        previous_cells=[c.public for c in previous.values()],
        trends=_trends(current, previous),
        question_coverage=_coverage(current),
        product_matrix_cell_keys=[
            key for key, c in current.items() if c.public.product_id and c.public.selected_subject
        ],
        platform_performance=[
            GeoPlatformPerformance(engine_surface_id=s, cell_keys=keys)
            for s, keys in sorted(platforms.items())
        ],
        competitor_sov_cell_keys=[
            key for key, c in current.items() if MetricCode.MENTION_SOV in c.results
        ],
        citation_insights=citations,
        fact_risks=risks,
        data_quality=data_quality(inputs, filters),
        unavailable_sections=["OPPORTUNITIES"],
    )


def list_insight_runs(
    db: Session, request: GeoAnswerInsightSampleFilters
) -> GeoAnswerInsightRunPage:
    filters = GeoOverviewFilters.model_validate(
        request.model_dump(include=set(GeoOverviewFilters.model_fields))
    )
    _, _, as_of, current, previous = _windows(db, filters)
    cell = (current if request.period == "CURRENT" else previous).get(request.cell_key)
    code = MetricCode(request.metric_code)
    if cell is None or code not in cell.results:
        raise not_found("回答级洞察指标单元")
    selected = []
    for source in cell.sources:
        result = calculate_metric(
            [source.metric], metric=code, scope=cell.scope, dimensions=source.metric.dimensions
        )
        reasons = metric_eligibility(
            source.metric, metric=code, scope=cell.scope, dimensions=source.metric.dimensions
        ).exclusion_reasons
        if (
            request.cohort == "CANDIDATE"
            or request.cohort == "DENOMINATOR"
            and source.metric.run_id in cell.results[code].eligible_run_ids
            or request.cohort == "NUMERATOR"
            and result.numerator > 0
            or request.cohort == "EXCLUDED"
            and bool(reasons)
        ):
            selected.append(
                GeoOverviewRunSample(
                    run_id=source.metric.run_id,
                    batch_id=source.metric.batch_id,
                    created_at=source.created_at,
                    status=source.metric.status,
                    analysis_revision_id=source.analysis_id,
                    review_id=source.review_id,
                    numerator=result.numerator,
                    denominator=result.denominator,
                    exclusion_reasons=list(reasons),
                )
            )
    selected.sort(key=lambda item: (item.created_at, item.run_id), reverse=True)
    return GeoAnswerInsightRunPage(
        as_of=as_of,
        filters=request,
        total=len(selected),
        page=request.page,
        page_size=request.page_size,
        items=selected[(request.page - 1) * request.page_size : request.page * request.page_size],
    )
