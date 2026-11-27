"""Slice 4A：GEO 干预编排与归因 HTTP 路由。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.deps import CsrfProtected, CurrentUser, DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.geo_interventions import (
    GeoInterventionCancelRequest,
    GeoInterventionConcludeRequest,
    GeoInterventionCreate,
    GeoInterventionListPage,
    GeoInterventionOut,
    GeoInterventionStatus,
    GeoInterventionUpdate,
)
from app.services.geo_interventions import (
    cancel_geo_intervention,
    conclude_geo_intervention,
    create_geo_intervention,
    get_geo_intervention_detail,
    list_geo_interventions,
    update_geo_intervention,
)

router = APIRouter(prefix="/api/v1/geo", tags=["geo-interventions"])


def _repeatable_read_snapshot(db: DbSession) -> None:
    """在认证查询开启事务之前配置单次 REPEATABLE READ 读取快照。"""
    db.autoflush = False
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})


@router.get(
    "/interventions",
    response_model=GeoInterventionListPage,
    operation_id="listGeoInterventions",
    dependencies=[Depends(_repeatable_read_snapshot)],
    responses=error_responses(401, 403, 422),
)
def list_geo_interventions_endpoint(
    db: DbSession,
    _user: CurrentUser,
    campaign_id: Annotated[uuid.UUID | None, Query()] = None,
    opportunity_id: Annotated[uuid.UUID | None, Query()] = None,
    intervention_status: Annotated[GeoInterventionStatus | None, Query(alias="status")] = None,
    assignee_id: Annotated[uuid.UUID | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> GeoInterventionListPage:
    return list_geo_interventions(
        db,
        campaign_id=campaign_id,
        opportunity_id=opportunity_id,
        status=intervention_status,
        assignee_id=assignee_id,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/interventions",
    response_model=GeoInterventionOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createGeoIntervention",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_geo_intervention_endpoint(
    payload: GeoInterventionCreate,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoInterventionOut:
    return create_geo_intervention(
        db=db,
        payload=payload,
        actor=actor,
        request_id=request.state.request_id,
    )


@router.get(
    "/interventions/{intervention_id}",
    response_model=GeoInterventionOut,
    operation_id="getGeoIntervention",
    dependencies=[Depends(_repeatable_read_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def get_geo_intervention_endpoint(
    intervention_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> GeoInterventionOut:
    return get_geo_intervention_detail(db, intervention_id)


@router.patch(
    "/interventions/{intervention_id}",
    response_model=GeoInterventionOut,
    operation_id="updateGeoIntervention",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_geo_intervention_endpoint(
    intervention_id: uuid.UUID,
    payload: GeoInterventionUpdate,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoInterventionOut:
    return update_geo_intervention(
        db=db,
        intervention_id=intervention_id,
        payload=payload,
        actor=actor,
        request_id=request.state.request_id,
    )


@router.post(
    "/interventions/{intervention_id}/conclude",
    response_model=GeoInterventionOut,
    operation_id="concludeGeoIntervention",
    responses=error_responses(401, 403, 404, 409, 422),
)
def conclude_geo_intervention_endpoint(
    intervention_id: uuid.UUID,
    payload: GeoInterventionConcludeRequest,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoInterventionOut:
    return conclude_geo_intervention(
        db=db,
        intervention_id=intervention_id,
        payload=payload,
        actor=actor,
        request_id=request.state.request_id,
    )


@router.post(
    "/interventions/{intervention_id}/cancel",
    response_model=GeoInterventionOut,
    operation_id="cancelGeoIntervention",
    responses=error_responses(401, 403, 404, 409, 422),
)
def cancel_geo_intervention_endpoint(
    intervention_id: uuid.UUID,
    payload: GeoInterventionCancelRequest,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoInterventionOut:
    return cancel_geo_intervention(
        db=db,
        intervention_id=intervention_id,
        payload=payload,
        actor=actor,
        request_id=request.state.request_id,
    )
