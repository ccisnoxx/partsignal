"""引用和声明摘要/下钻共用事件选择；不把事件条数当运行分母。"""

from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import replace
from datetime import datetime

from sqlalchemy.orm import Session

from app.errors import not_found
from app.schemas.geo_analysis import GeoClaimKind, GeoClaimSeverity, GeoClaimVerdict
from app.schemas.geo_insight_details import (
    GeoInsightCitationBucket,
    GeoInsightCitationDrilldown,
    GeoInsightCitationFilters,
    GeoInsightCitationPage,
    GeoInsightCitationSample,
    GeoInsightCitationSummary,
    GeoInsightClaimDrilldown,
    GeoInsightClaimFilters,
    GeoInsightClaimGroup,
    GeoInsightClaimPage,
    GeoInsightClaimSample,
    GeoInsightFactRiskSummary,
)
from app.schemas.geo_insights import GeoOverviewFilters
from app.services.geo_answer_insights import InsightCell, _cells
from app.services.geo_insight_evidence import InsightCitation, InsightClaim
from app.services.geo_metric_types import MetricCode
from app.services.geo_metrics import calculate_metric, metric_eligibility
from app.services.geo_overview_queries import OverviewInput, load_inputs


def citation_events(cell: InsightCell) -> list[tuple[OverviewInput, InsightCitation]]:
    events: list[tuple[OverviewInput, InsightCitation]] = []
    for source in cell.sources:
        if not metric_eligibility(
            source.metric,
            metric=MetricCode.OWNED_CITATION_SHARE,
            scope=cell.scope,
            dimensions=source.metric.dimensions,
        ).eligible:
            continue
        urls: dict[str, InsightCitation] = {}
        for row in source.evidence.citations:
            if row.source_category is None:
                raise ValueError("合格引用必须有有效来源分类")
            previous = urls.setdefault(row.normalized_url, row)
            if previous != row:
                raise ValueError("同一规范URL的引用证据冲突")
        events.extend((source, row) for row in urls.values())
    return events


def claim_events(cell: InsightCell) -> list[tuple[OverviewInput, InsightClaim]]:
    # UNKNOWN-only仍是可展示的通用合格声明；准确性公式另排除不可判断分母。
    return [
        (source, row)
        for source in cell.sources
        if metric_eligibility(
            source.metric,
            metric=MetricCode.ANSWER_COVERAGE,
            scope=cell.scope,
            dimensions=source.metric.dimensions,
        ).eligible
        for row in source.evidence.claims
        if row.subject_id == cell.scope.subject_id
    ]


def _buckets(
    cell: InsightCell,
    filters: GeoOverviewFilters,
    events: Sequence[tuple[OverviewInput, InsightCitation]],
    field: str,
) -> list[GeoInsightCitationBucket]:
    groups: dict[str, list[tuple[OverviewInput, InsightCitation]]] = defaultdict(list)
    for source, row in events:
        groups[str(getattr(row, field))].append((source, row))
    denominator = cell.results[MetricCode.OWNED_CITATION_SHARE].eligible_run_count
    selector = {
        "hostname": "hostname",
        "normalized_url": "normalized_url",
        "source_category": "source_category",
    }[field]
    buckets = []
    for key, parts in sorted(groups.items(), key=lambda pair: (-len(pair[1]), pair[0])):
        coverage_value = (
            len({s.metric.run_id for s, _ in parts}) / denominator if denominator else None
        )
        if field == "hostname":
            # 域名覆盖已有601权威公式；URL和来源分类仅做同资格事件分组。
            coverage = calculate_metric(
                [s.metric for s in cell.sources],
                metric=MetricCode.DOMAIN_COVERAGE,
                scope=replace(cell.scope, domain=key),
                dimensions=cell.sources[0].metric.dimensions,
            )
            coverage_value = coverage.value
            denominator = coverage.denominator
        buckets.append(
            GeoInsightCitationBucket(
                key=key,
                citation_count=len(parts),
                run_count=len({s.metric.run_id for s, _ in parts}),
                coverage_value=coverage_value,
                coverage_denominator=denominator,
                share_value=len(parts) / len(events) if events else None,
                share_denominator=len(events),
                query_topic_ids=sorted({s.metric.dimensions.query_topic_id for s, _ in parts}),
                engine_surface_ids=sorted(
                    {s.metric.dimensions.engine_surface_id for s, _ in parts}
                ),
                drilldown=GeoInsightCitationDrilldown.model_validate(
                    dict(filters=filters, cell_key=cell.public.cell_key, **{selector: key})
                ),
            )
        )
    return buckets


def summaries(
    cells: dict[str, InsightCell],
    filters: GeoOverviewFilters,
) -> tuple[list[GeoInsightCitationSummary], list[GeoInsightFactRiskSummary]]:
    citations, risks = [], []
    for key, cell in cells.items():
        if not cell.public.selected_subject:
            continue
        events = citation_events(cell)
        citations.append(
            GeoInsightCitationSummary(
                cell_key=key,
                subject_id=cell.scope.subject_id,
                citation_count=len(events),
                domains=_buckets(cell, filters, events, "hostname"),
                urls=_buckets(cell, filters, events, "normalized_url"),
                source_categories=_buckets(cell, filters, events, "source_category"),
                drilldown=GeoInsightCitationDrilldown(filters=filters, cell_key=key),
            )
        )
        claims = claim_events(cell)
        groups: dict[
            tuple[GeoClaimKind, GeoClaimVerdict, GeoClaimSeverity],
            list[tuple[OverviewInput, InsightClaim]],
        ] = defaultdict(list)
        for source, claim in claims:
            groups[claim.claim_kind, claim.verdict, claim.severity].append((source, claim))
        verdicts = Counter(c.verdict for _, c in claims)
        severities = Counter(c.severity for _, c in claims if c.verdict == "INCORRECT")
        risks.append(
            GeoInsightFactRiskSummary(
                cell_key=key,
                subject_id=cell.scope.subject_id,
                claim_count=len(claims),
                verdict_counts={v: verdicts[v] for v in GeoClaimVerdict},
                incorrect_severity_counts={v: severities[v] for v in GeoClaimSeverity},
                groups=[
                    GeoInsightClaimGroup(
                        claim_kind=kind,
                        verdict=verdict,
                        severity=severity,
                        claim_count=len(parts),
                        run_count=len({s.metric.run_id for s, _ in parts}),
                        drilldown=GeoInsightClaimDrilldown(
                            filters=filters,
                            cell_key=key,
                            claim_kind=kind,
                            verdict=verdict,
                            severity=severity,
                        ),
                    )
                    for (kind, verdict, severity), parts in sorted(groups.items())
                ],
                drilldown=GeoInsightClaimDrilldown(filters=filters, cell_key=key),
            )
        )
    return citations, risks


def _load_cell(
    db: Session, request: GeoInsightCitationFilters | GeoInsightClaimFilters
) -> tuple[datetime, InsightCell]:
    filters = GeoOverviewFilters.model_validate(
        request.model_dump(include=set(GeoOverviewFilters.model_fields))
    )
    as_of, inputs = load_inputs(db, filters)
    cell = _cells(inputs, filters, "CURRENT").get(request.cell_key)
    if cell is None or not cell.public.selected_subject:
        raise not_found("引用/声明洞察单元")
    return as_of, cell


def list_citations(db: Session, request: GeoInsightCitationFilters) -> GeoInsightCitationPage:
    as_of, cell = _load_cell(db, request)
    events = [
        (source, row)
        for source, row in citation_events(cell)
        if (request.hostname is None or row.hostname == request.hostname)
        and (request.normalized_url is None or row.normalized_url == request.normalized_url)
        and (request.source_category is None or row.source_category == request.source_category)
    ]
    events.sort(
        key=lambda pair: (pair[0].created_at, pair[0].metric.run_id, pair[1].citation_id),
        reverse=True,
    )
    page = events[(request.page - 1) * request.page_size : request.page * request.page_size]
    items = []
    for source, row in page:
        assert source.analysis_id is not None and row.source_category is not None
        items.append(
            GeoInsightCitationSample(
                run_id=source.metric.run_id,
                batch_id=source.metric.batch_id,
                created_at=source.created_at,
                analysis_revision_id=source.analysis_id,
                review_id=source.review_id,
                citation_id=row.citation_id,
                normalized_url=row.normalized_url,
                hostname=row.hostname,
                title=row.title,
                occurrences=list(row.occurrences),
                source_category=row.source_category,
                attributed_subject_id=row.attributed_subject_id,
                candidate_subject_ids=list(row.candidate_subject_ids),
                shared_domain=row.shared_domain,
            )
        )
    return GeoInsightCitationPage(
        as_of=as_of,
        filters=request,
        total=len(events),
        run_count=len({s.metric.run_id for s, _ in events}),
        page=request.page,
        page_size=request.page_size,
        items=items,
    )


def list_claims(db: Session, request: GeoInsightClaimFilters) -> GeoInsightClaimPage:
    as_of, cell = _load_cell(db, request)
    events = [
        (source, row)
        for source, row in claim_events(cell)
        if (request.verdict is None or row.verdict == request.verdict)
        and (request.severity is None or row.severity == request.severity)
        and (request.claim_kind is None or row.claim_kind == request.claim_kind)
    ]
    events.sort(
        key=lambda pair: (pair[0].created_at, pair[0].metric.run_id, pair[1].claim_assessment_id),
        reverse=True,
    )
    items = []
    for source, row in events[
        (request.page - 1) * request.page_size : request.page * request.page_size
    ]:
        assert source.analysis_id is not None
        items.append(
            GeoInsightClaimSample(
                run_id=source.metric.run_id,
                batch_id=source.metric.batch_id,
                created_at=source.created_at,
                analysis_revision_id=source.analysis_id,
                review_id=source.review_id,
                claim_assessment_id=row.claim_assessment_id,
                subject_id=row.subject_id,
                fact_version_id=row.fact_version_id,
                claim_kind=row.claim_kind,
                claim_text=row.claim_text,
                verdict=row.verdict,
                severity=row.severity,
                fact_excerpt=row.fact_excerpt,
                explanation=row.explanation,
            )
        )
    return GeoInsightClaimPage(
        as_of=as_of,
        filters=request,
        total=len(events),
        run_count=len({s.metric.run_id for s, _ in events}),
        page=request.page,
        page_size=request.page_size,
        items=items,
    )
