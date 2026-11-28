"""Slice 1C：今日待监测清单、单条直录/补录与引用归因确认 HTTP 路由。"""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from app.deps import CsrfProtected, DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.geo_daily_checklist import (
    GeoCitationLinkDecisionRequest,
    GeoCitationManualLinkRequest,
    GeoCitationPublicationLinkOut,
    GeoDailyChecklistEnsureOut,
    GeoDailyChecklistEnsureRequest,
    GeoDailyChecklistOut,
    GeoDirectManualObservationCreate,
    GeoDirectManualObservationOut,
)
from app.schemas.geo_prompt_variants import GeoPromptCategory
from app.schemas.geo_runs import GeoRunStatus
from app.services import geo_citation_matching as citation_links
from app.services import geo_daily_checklist as checklist_service
from app.services import geo_direct_observation as direct_service
from app.services.geo_plan_queries import read_snapshot

router = APIRouter(prefix="/api/v1/geo", tags=["geo-daily-checklist"])


@router.get(
    "/daily-checklist",
    response_model=GeoDailyChecklistOut,
    operation_id="getGeoDailyChecklist",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 422),
)
def get_daily_checklist_route(
    db: DbSession,
    _user: EngineerUser,
    target_date: date | None = None,
    timezone: Annotated[str, Query(max_length=64)] = "Asia/Shanghai",
    assignee_id: UUID | None = None,
    status: GeoRunStatus | None = None,
    category: GeoPromptCategory | None = None,
) -> GeoDailyChecklistOut:
    return checklist_service.get_daily_checklist(
        db,
        target_date=target_date,
        tz_name=timezone,
        assignee_id=assignee_id,
        status=status,
        category=category,
    )


@router.post(
    "/daily-checklist/ensure",
    response_model=GeoDailyChecklistEnsureOut,
    operation_id="ensureGeoDailyChecklist",
    responses=error_responses(401, 403, 409, 422),
)
def ensure_daily_checklist_route(
    payload: GeoDailyChecklistEnsureRequest,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoDailyChecklistEnsureOut:
    return checklist_service.ensure_daily_checklist(
        db, payload=payload, actor=user, request_id=request.state.request_id
    )


@router.post(
    "/direct-observations",
    status_code=201,
    response_model=GeoDirectManualObservationOut,
    operation_id="createGeoDirectManualObservation",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_direct_manual_observation_route(
    payload: GeoDirectManualObservationCreate,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoDirectManualObservationOut:
    return direct_service.create_direct_manual_observation(
        db, payload=payload, actor=user, request_id=request.state.request_id
    )


@router.patch(
    "/citation-links/{link_id}",
    response_model=GeoCitationPublicationLinkOut,
    operation_id="decideGeoCitationLink",
    responses=error_responses(401, 403, 404, 409, 422),
)
def decide_citation_link_route(
    link_id: UUID,
    payload: GeoCitationLinkDecisionRequest,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoCitationPublicationLinkOut:
    return citation_links.decide_citation_link(
        db, link_id=link_id, payload=payload, actor=user, request_id=request.state.request_id
    )


@router.post(
    "/citations/{citation_id}/links",
    status_code=201,
    response_model=GeoCitationPublicationLinkOut,
    operation_id="createManualGeoCitationLink",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_manual_citation_link_route(
    citation_id: UUID,
    payload: GeoCitationManualLinkRequest,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoCitationPublicationLinkOut:
    return citation_links.create_manual_citation_link(
        db,
        citation_id=citation_id,
        payload=payload,
        actor=user,
        request_id=request.state.request_id,
    )
