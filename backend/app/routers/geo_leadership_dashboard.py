"""Slice 1D：领导效果看板、友好筛选选项、统一证据下钻与冻结周报快照 HTTP 路由。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from app.deps import CsrfProtected, DbSession, EngineerUser, ReaderUser
from app.errors import error_responses
from app.schemas.geo_leadership_dashboard import (
    GeoLeadershipDashboardOut,
    GeoLeadershipEvidenceList,
    GeoLeadershipFilterOptionsOut,
    GeoReportSnapshotCreateRequest,
    GeoReportSnapshotDetail,
    GeoReportSnapshotList,
)
from app.services import geo_leadership_dashboard as dashboard_service
from app.services import geo_leadership_evidence as evidence_service
from app.services import geo_report_snapshots as snapshot_service
from app.services.geo_plan_queries import read_snapshot

router = APIRouter(prefix="/api/v1/geo", tags=["geo-leadership-dashboard"])


@router.get(
    "/leadership-dashboard/filter-options",
    response_model=GeoLeadershipFilterOptionsOut,
    operation_id="getGeoLeadershipFilterOptions",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403),
)
def get_filter_options_route(
    db: DbSession, _user: ReaderUser
) -> GeoLeadershipFilterOptionsOut:
    return evidence_service.get_leadership_filter_options(db)


@router.get(
    "/leadership-dashboard",
    response_model=GeoLeadershipDashboardOut,
    operation_id="getGeoLeadershipDashboard",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 422),
)
def get_leadership_dashboard_route(
    db: DbSession,
    _user: ReaderUser,
    period_from: datetime | None = None,
    period_to: datetime | None = None,
    bucket_granularity: Literal["DAY", "WEEK"] = "DAY",
    product_id: UUID | None = None,
    surface_id: UUID | None = None,
    collection_mode: Literal["MANUAL", "API", "BROWSER"] | None = None,
    timezone: Annotated[str, Query(max_length=64)] = "Asia/Shanghai",
) -> GeoLeadershipDashboardOut:
    now = datetime.now(UTC)
    end = period_to.astimezone(UTC) if period_to is not None else now
    start = period_from.astimezone(UTC) if period_from is not None else (end - timedelta(days=7))
    return dashboard_service.get_leadership_dashboard(
        db,
        period_from=start,
        period_to=end,
        bucket_granularity=bucket_granularity,
        product_id=product_id,
        surface_id=surface_id,
        collection_mode=collection_mode,
        tz_name=timezone,
    )


@router.get(
    "/leadership-dashboard/evidence",
    response_model=GeoLeadershipEvidenceList,
    operation_id="listGeoLeadershipEvidence",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 422),
)
def list_leadership_evidence_route(
    db: DbSession,
    _user: ReaderUser,
    run_id: Annotated[list[UUID] | None, Query()] = None,
    prompt_variant_id: UUID | None = None,
    surface_id: UUID | None = None,
    article_publication_id: UUID | None = None,
    period_from: datetime | None = None,
    period_to: datetime | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> GeoLeadershipEvidenceList:
    return evidence_service.list_leadership_evidence(
        db,
        run_ids=run_id,
        prompt_variant_id=prompt_variant_id,
        surface_id=surface_id,
        article_publication_id=article_publication_id,
        period_from=period_from.astimezone(UTC) if period_from else None,
        period_to=period_to.astimezone(UTC) if period_to else None,
        limit=limit,
    )


@router.get(
    "/report-snapshots",
    response_model=GeoReportSnapshotList,
    operation_id="listGeoReportSnapshots",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 422),
)
def list_report_snapshots_route(
    db: DbSession,
    _user: ReaderUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> GeoReportSnapshotList:
    return snapshot_service.list_report_snapshots(db, limit=limit)


@router.get(
    "/report-snapshots/{snapshot_id}",
    response_model=GeoReportSnapshotDetail,
    operation_id="getGeoReportSnapshot",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def get_report_snapshot_route(
    snapshot_id: UUID,
    db: DbSession,
    _user: ReaderUser,
) -> GeoReportSnapshotDetail:
    return snapshot_service.get_report_snapshot(db, snapshot_id)


@router.post(
    "/report-snapshots",
    status_code=201,
    response_model=GeoReportSnapshotDetail,
    operation_id="createGeoReportSnapshot",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_report_snapshot_route(
    payload: GeoReportSnapshotCreateRequest,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoReportSnapshotDetail:
    return snapshot_service.create_report_snapshot(
        db, payload=payload, actor=user, request_id=request.state.request_id
    )
