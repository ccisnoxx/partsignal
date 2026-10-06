"""监测计划HTTP边界；不拥有事务、行锁或ORM写入。"""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import BeforeValidator

from app.deps import CsrfProtected, DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.geo_monitoring_plans import (
    GeoMonitoringPlanCreate,
    GeoMonitoringPlanRevisionRequest,
    GeoMonitoringPlanStatus,
    GeoMonitoringPlanUpdate,
    GeoPlanScheduleKind,
)
from app.schemas.geo_plan_management import (
    GeoMonitoringPlanCopy,
    GeoMonitoringPlanDetail,
    GeoMonitoringPlanListPage,
)
from app.schemas.geo_plan_preview import GeoMonitoringPlanPreview
from app.services import geo_plan_commands as commands
from app.services import geo_plan_queries as queries
from app.services.geo_plans import preview_plan

router = APIRouter(prefix="/api/v1/geo/monitoring-plans", tags=["geo-plans"])


@router.get(
    "",
    response_model=GeoMonitoringPlanListPage,
    operation_id="listGeoMonitoringPlans",
    dependencies=[Depends(queries.read_snapshot)],
    responses=error_responses(401, 403, 422),
)
def list_plans(
    db: DbSession,
    user: EngineerUser,
    q: Annotated[str | None, Query(max_length=200, pattern=r"^[^\x00]*$")] = None,
    status: GeoMonitoringPlanStatus | None = None,
    schedule_kind: GeoPlanScheduleKind | None = None,
    sort: Literal["UPDATED_DESC", "NAME_ASC"] = "UPDATED_DESC",
    page: int = Query(1, ge=1),
    page_size: Annotated[Literal[10, 20, 50], BeforeValidator(int), Query()] = 20,
) -> GeoMonitoringPlanListPage:
    return queries.list_plans(
        db,
        q=q,
        status=status,
        schedule_kind=schedule_kind,
        sort=sort,
        page=page,
        page_size=page_size,
    )


@router.post(
    "",
    response_model=GeoMonitoringPlanDetail,
    status_code=201,
    operation_id="createGeoMonitoringPlan",
    responses=error_responses(401, 403, 409, 422),
)
def create_plan(
    payload: GeoMonitoringPlanCreate,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoMonitoringPlanDetail:
    return commands.create_plan(
        db=db, payload=payload, actor=user, request_id=request.state.request_id
    )


@router.post(
    "/preview",
    response_model=GeoMonitoringPlanPreview,
    operation_id="previewGeoMonitoringPlan",
    dependencies=[Depends(queries.read_snapshot)],
    responses=error_responses(401, 403, 422),
)
def preview(
    payload: GeoMonitoringPlanCreate, db: DbSession, user: EngineerUser, _csrf: CsrfProtected
) -> GeoMonitoringPlanPreview:
    return preview_plan(db, payload)


@router.get(
    "/{plan_id}",
    response_model=GeoMonitoringPlanDetail,
    operation_id="getGeoMonitoringPlan",
    dependencies=[Depends(queries.read_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def get_plan(plan_id: UUID, db: DbSession, user: EngineerUser) -> GeoMonitoringPlanDetail:
    return queries.get_plan(db, plan_id)


@router.patch(
    "/{plan_id}",
    response_model=GeoMonitoringPlanDetail,
    operation_id="updateGeoMonitoringPlan",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_plan(
    plan_id: UUID,
    payload: GeoMonitoringPlanUpdate,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoMonitoringPlanDetail:
    return commands.update_plan(
        db=db, plan_id=plan_id, payload=payload, actor=user, request_id=request.state.request_id
    )


@router.post(
    "/{plan_id}/activate",
    response_model=GeoMonitoringPlanDetail,
    operation_id="activateGeoMonitoringPlan",
    responses=error_responses(401, 403, 404, 409, 422),
)
def activate(
    plan_id: UUID,
    payload: GeoMonitoringPlanRevisionRequest,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoMonitoringPlanDetail:
    return commands.change_status(
        db=db,
        plan_id=plan_id,
        expected_revision=payload.expected_revision,
        operation="activate",
        actor=user,
        request_id=request.state.request_id,
    )


@router.post(
    "/{plan_id}/pause",
    response_model=GeoMonitoringPlanDetail,
    operation_id="pauseGeoMonitoringPlan",
    responses=error_responses(401, 403, 404, 409, 422),
)
def pause(
    plan_id: UUID,
    payload: GeoMonitoringPlanRevisionRequest,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoMonitoringPlanDetail:
    return commands.change_status(
        db=db,
        plan_id=plan_id,
        expected_revision=payload.expected_revision,
        operation="pause",
        actor=user,
        request_id=request.state.request_id,
    )


@router.post(
    "/{plan_id}/resume",
    response_model=GeoMonitoringPlanDetail,
    operation_id="resumeGeoMonitoringPlan",
    responses=error_responses(401, 403, 404, 409, 422),
)
def resume(
    plan_id: UUID,
    payload: GeoMonitoringPlanRevisionRequest,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoMonitoringPlanDetail:
    return commands.change_status(
        db=db,
        plan_id=plan_id,
        expected_revision=payload.expected_revision,
        operation="resume",
        actor=user,
        request_id=request.state.request_id,
    )


@router.post(
    "/{plan_id}/archive",
    response_model=GeoMonitoringPlanDetail,
    operation_id="archiveGeoMonitoringPlan",
    responses=error_responses(401, 403, 404, 409, 422),
)
def archive(
    plan_id: UUID,
    payload: GeoMonitoringPlanRevisionRequest,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoMonitoringPlanDetail:
    return commands.change_status(
        db=db,
        plan_id=plan_id,
        expected_revision=payload.expected_revision,
        operation="archive",
        actor=user,
        request_id=request.state.request_id,
    )


@router.post(
    "/{plan_id}/copy",
    response_model=GeoMonitoringPlanDetail,
    status_code=201,
    operation_id="copyGeoMonitoringPlan",
    responses=error_responses(401, 403, 404, 409, 422),
)
def copy(
    plan_id: UUID,
    payload: GeoMonitoringPlanCopy,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoMonitoringPlanDetail:
    return commands.copy_plan(
        db=db, plan_id=plan_id, payload=payload, actor=user, request_id=request.state.request_id
    )


@router.delete(
    "/{plan_id}",
    status_code=204,
    operation_id="deleteGeoMonitoringPlan",
    responses=error_responses(401, 403, 404, 409, 422),
)
def delete_plan(
    plan_id: UUID,
    expected_revision: Annotated[int, Query(ge=0)],
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> None:
    commands.delete_plan(
        db=db,
        plan_id=plan_id,
        expected_revision=expected_revision,
        actor=user,
        request_id=request.state.request_id,
    )


@router.post(
    "/{plan_id}/run",
    status_code=501,
    response_model=None,
    operation_id="runGeoMonitoringPlanNow",
    responses=error_responses(401, 403, 404, 409, 422, 501),
)
def run_now(
    plan_id: UUID,
    payload: GeoMonitoringPlanRevisionRequest,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=1, max_length=160, pattern=r"^[\x21-\x7E]+$"),
    ],
) -> None:
    commands.run_now(
        db=db,
        plan_id=plan_id,
        expected_revision=payload.expected_revision,
        idempotency_key=idempotency_key,
        actor=user,
    )
