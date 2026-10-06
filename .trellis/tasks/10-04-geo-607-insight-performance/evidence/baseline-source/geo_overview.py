"""Overview 应用读模型：统一筛选、完整cell、公式及组成样本的唯一组装者。"""

from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from hashlib import sha256
from typing import cast
from uuid import UUID

from sqlalchemy.orm import Session

from app.errors import not_found
from app.schemas.geo_insights import (
    Cohort,
    GeoOverview,
    GeoOverviewBatch,
    GeoOverviewCard,
    GeoOverviewCell,
    GeoOverviewDataQuality,
    GeoOverviewDimensions,
    GeoOverviewDrilldown,
    GeoOverviewExclusion,
    GeoOverviewFilters,
    GeoOverviewOpportunityPlaceholder,
    GeoOverviewRisk,
    GeoOverviewRunPage,
    GeoOverviewRunSample,
    GeoOverviewSampleFilters,
    OverviewMetric,
)
from app.services.geo_metric_inputs import metric_scope_from_snapshot
from app.services.geo_metric_types import MetricCode, MetricExclusion
from app.services.geo_metrics import DEFAULT_SAMPLE_POLICY, calculate_metric, metric_eligibility
from app.services.geo_overview_queries import OverviewInput, load_inputs, selected_subjects

BUSINESS_CODES = (
    MetricCode.ANSWER_COVERAGE,
    MetricCode.NATURAL_VISIBILITY,
    MetricCode.PRODUCT_MENTION,
    MetricCode.RECOMMENDATION_RATE,
    MetricCode.TOP_RECOMMENDATION_RATE,
    MetricCode.OWNED_SOURCE_COVERAGE,
    MetricCode.ACCURATE_CLAIM_RATE,
    MetricCode.SEVERE_ERROR_RUN_RATE,
)
QUALITY_CODES: tuple[OverviewMetric, ...] = (
    "eligible_runs",
    "run_success_rate",
    "analysis_run_coverage",
    "review_backlog",
    "evidence_completeness",
    "cost_coverage",
    "model_version_coverage",
)
QUALITY_VERSION = "geo-overview-quality-v1"


@dataclass(frozen=True)
class Contribution:
    source: OverviewInput
    numerator: int
    denominator: int
    reasons: tuple[MetricExclusion, ...] = ()


def _drill(
    filters: GeoOverviewFilters,
    code: OverviewMetric,
    *,
    key: str | None = None,
    cohort: Cohort = "DENOMINATOR",
    batch_id: UUID | None = None,
) -> GeoOverviewDrilldown:
    return GeoOverviewDrilldown(
        filters=filters, metric_code=code, cell_key=key, cohort=cohort, batch_id=batch_id
    )


def _generic_reasons(
    source: OverviewInput, filters: GeoOverviewFilters
) -> tuple[MetricExclusion, ...]:
    identity = min(selected_subjects(source.snapshot, filters))
    scope = metric_scope_from_snapshot(source.snapshot, subject_id=identity)
    return metric_eligibility(
        source.metric,
        metric=MetricCode.ANSWER_COVERAGE,
        scope=scope,
        dimensions=source.metric.dimensions,
    ).exclusion_reasons


def _quality(
    inputs: list[OverviewInput],
    filters: GeoOverviewFilters,
) -> dict[OverviewMetric, list[Contribution]]:
    values: dict[OverviewMetric, list[Contribution]] = {code: [] for code in QUALITY_CODES}
    for source in inputs:
        run = source.metric
        reasons = _generic_reasons(source, filters)
        completed = run.status == "COMPLETED"
        collected = run.answer_present
        # 用户2026-10-03裁决三态终态分母；预算阻断单独显示，不猜成FAILED。
        terminal = run.status in {"COMPLETED", "FAILED", "CANCELLED"}
        pairs = {
            "eligible_runs": (int(not reasons), 1),
            "run_success_rate": (int(completed), int(terminal)),
            "analysis_run_coverage": (
                int(collected and run.current_analysis_available),
                int(collected),
            ),
            "review_backlog": (int(run.review_required and not run.current_review_valid), 1),
            "evidence_completeness": (int(completed and source.evidence_complete), int(completed)),
            "cost_coverage": (
                int(source.cost_amount is not None and source.cost_currency is not None),
                1,
            ),
            "model_version_coverage": (int(collected and source.version_known), int(collected)),
        }
        for code in QUALITY_CODES:
            numerator, denominator = pairs[code]
            values[code].append(
                Contribution(
                    source, numerator, denominator, reasons if code == "eligible_runs" else ()
                )
            )
    return values


def _quality_card(
    code: OverviewMetric,
    parts: list[Contribution],
    filters: GeoOverviewFilters,
) -> GeoOverviewCard:
    numerator, denominator = sum(p.numerator for p in parts), sum(p.denominator for p in parts)
    reasons = Counter(reason for part in parts for reason in part.reasons)
    eligible = numerator if code == "eligible_runs" else denominator
    return GeoOverviewCard(
        metric_code=code,
        formula_version=QUALITY_VERSION,
        value=numerator / denominator if denominator else None,
        numerator=numerator,
        denominator=denominator,
        sample_level=DEFAULT_SAMPLE_POLICY.level(eligible),
        eligible_run_count=eligible,
        excluded_run_count=len(parts) - eligible,
        exclusion_reason_counts=[
            GeoOverviewExclusion(code=reason, run_count=count)
            for reason, count in sorted(reasons.items())
        ],
        unjudgeable_claim_count=0,
        unavailable_reason=None if denominator else "NO_DENOMINATOR",
        drilldown=_drill(filters, code),
    )


def _cells(
    inputs: list[OverviewInput],
    filters: GeoOverviewFilters,
) -> tuple[list[GeoOverviewCell], dict[tuple[str, OverviewMetric], list[Contribution]]]:
    groups: dict[str, list[OverviewInput]] = defaultdict(list)
    metadata: dict[str, tuple[UUID, GeoOverviewDimensions]] = {}
    for source in inputs:
        dimensions = GeoOverviewDimensions.model_validate(asdict(source.metric.dimensions))
        for identity in sorted(selected_subjects(source.snapshot, filters)):
            scope = metric_scope_from_snapshot(source.snapshot, subject_id=identity)
            key = sha256(
                (
                    dimensions.model_dump_json()
                    + str(identity)
                    + ":".join(str(item) for item in sorted(scope.sov_subject_ids))
                ).encode()
            ).hexdigest()
            groups[key].append(source)
            metadata[key] = (identity, dimensions)
    cells = []
    contributions: dict[tuple[str, OverviewMetric], list[Contribution]] = {}
    for key in sorted(groups):
        sources = groups[key]
        identity, dimensions = metadata[key]
        scope = metric_scope_from_snapshot(sources[0].snapshot, subject_id=identity)
        subject = next(item for item in sources[0].snapshot.subjects if item.id == identity)
        cards = []
        for metric in BUSINESS_CODES:
            if metric == MetricCode.PRODUCT_MENTION and not scope.is_product:
                continue
            code = cast(OverviewMetric, metric.value)
            result = calculate_metric(
                [source.metric for source in sources],
                metric=metric,
                scope=scope,
                dimensions=sources[0].metric.dimensions,
            )
            cards.append(
                GeoOverviewCard(
                    metric_code=code,
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
                    drilldown=_drill(filters, code, key=key),
                )
            )
            parts = []
            for source in sources:
                single = calculate_metric(
                    [source.metric], metric=metric, scope=scope, dimensions=source.metric.dimensions
                )
                reasons = metric_eligibility(
                    source.metric, metric=metric, scope=scope, dimensions=source.metric.dimensions
                ).exclusion_reasons
                parts.append(Contribution(source, single.numerator, single.denominator, reasons))
            contributions[key, code] = parts
        cells.append(
            GeoOverviewCell(
                cell_key=key,
                subject_id=identity,
                product_id=subject.product_id,
                display_name=subject.display_name,
                dimensions=dimensions,
                cards=cards,
            )
        )
    return cells, contributions


def get_overview(db: Session, filters: GeoOverviewFilters) -> GeoOverview:
    as_of, inputs = load_inputs(db, filters)
    cells, _ = _cells(inputs, filters)
    quality_parts = _quality(inputs, filters)
    quality_cards = [_quality_card(code, quality_parts[code], filters) for code in QUALITY_CODES]
    generic = quality_cards[0]
    batches: dict[UUID, list[OverviewInput]] = defaultdict(list)
    for source in inputs:
        batches[source.metric.batch_id].append(source)
    recent = sorted(
        batches.items(), key=lambda pair: (pair[1][0].batch_created_at, pair[0]), reverse=True
    )[:5]
    return GeoOverview(
        as_of=as_of,
        filters=filters,
        cards=quality_cards[:2],
        metric_cells=cells,
        key_products=[cell for cell in cells if cell.product_id is not None],
        risks=[
            GeoOverviewRisk(cell_key=cell.cell_key, subject_id=cell.subject_id, severe_error=card)
            for cell in cells
            for card in cell.cards
            if card.metric_code == "severe_error_run_rate" and card.numerator > 0
        ],
        recent_batches=[
            GeoOverviewBatch(
                batch_id=identity,
                created_at=sources[0].batch_created_at,
                candidate_run_count=len(sources),
                status_counts=dict(Counter(source.metric.status for source in sources)),
                drilldown=_drill(filters, "eligible_runs", cohort="CANDIDATE", batch_id=identity),
            )
            for identity, sources in recent
        ],
        open_opportunities=GeoOverviewOpportunityPlaceholder(filters=filters),
        data_quality=GeoOverviewDataQuality(
            candidate_run_count=len(inputs),
            eligible_run_count=generic.numerator,
            excluded_run_count=len(inputs) - generic.numerator,
            exclusion_reason_counts=generic.exclusion_reason_counts,
            status_counts=dict(Counter(source.metric.status for source in inputs)),
            dimension_count=len({source.metric.dimensions for source in inputs}),
            cards=quality_cards,
        ),
        unavailable_sections=["TRENDS", "COMPETITOR_SOV", "INSIGHT_DETAILS", "OPPORTUNITIES"],
    )


def list_overview_runs(db: Session, request: GeoOverviewSampleFilters) -> GeoOverviewRunPage:
    filters = GeoOverviewFilters.model_validate(
        request.model_dump(include=set(GeoOverviewFilters.model_fields))
    )
    as_of, inputs = load_inputs(db, filters)
    if request.metric_code in QUALITY_CODES:
        if request.cell_key is not None:
            raise not_found("Overview组成样本")
        parts = _quality(inputs, filters)[request.metric_code]
    else:
        _, contributions = _cells(inputs, filters)
        cell_parts = contributions.get((request.cell_key or "", request.metric_code))
        if cell_parts is None:
            raise not_found("Overview指标单元")
        parts = cell_parts
    selected = [
        part
        for part in parts
        if (request.batch_id is None or part.source.metric.batch_id == request.batch_id)
        and (
            request.cohort == "CANDIDATE"
            or (request.cohort == "DENOMINATOR" and part.denominator > 0)
            or (request.cohort == "NUMERATOR" and part.numerator > 0)
            or (
                request.cohort == "EXCLUDED"
                and (
                    bool(part.reasons)
                    if request.metric_code == "eligible_runs"
                    else part.denominator == 0
                )
            )
        )
    ]
    selected.sort(
        key=lambda part: (part.source.created_at, part.source.metric.run_id), reverse=True
    )
    page = selected[(request.page - 1) * request.page_size : request.page * request.page_size]
    return GeoOverviewRunPage(
        as_of=as_of,
        filters=request,
        total=len(selected),
        page=request.page,
        page_size=request.page_size,
        items=[
            GeoOverviewRunSample(
                run_id=part.source.metric.run_id,
                batch_id=part.source.metric.batch_id,
                created_at=part.source.created_at,
                status=part.source.metric.status,
                analysis_revision_id=part.source.analysis_id,
                review_id=part.source.review_id,
                numerator=part.numerator,
                denominator=part.denominator,
                exclusion_reasons=list(part.reasons),
            )
            for part in page
        ],
    )
