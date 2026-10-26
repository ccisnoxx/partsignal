"""机会自动评估配置HTTP边界，不开放内部调度执行权限。"""

from fastapi import APIRouter, Depends, Request, Response

from app.deps import AdminUser, CsrfProtected, DbSession
from app.errors import AppError, error_responses
from app.schemas.geo_opportunity_schedule import (
    GeoOpportunityScheduleCommand,
    GeoOpportunityScheduleDetail,
    GeoOpportunityScheduleSave,
)
from app.services.geo_catalog_queries import read_snapshot
from app.services.geo_opportunity_schedule_commands import ScheduleOperation, change
from app.services.geo_opportunity_schedule_state import detail

router = APIRouter(
    prefix="/api/v1/geo/opportunities/evaluation-schedule", tags=["geo-opportunity-schedule"]
)


@router.get(
    "",
    response_model=GeoOpportunityScheduleDetail,
    operation_id="getGeoOpportunityEvaluationSchedule",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 422),
)
def get_schedule(
    db: DbSession, actor: AdminUser, response: Response
) -> GeoOpportunityScheduleDetail:
    response.headers["Cache-Control"] = "no-store"
    return detail(db)


def command(
    db: DbSession,
    actor: AdminUser,
    request: Request,
    response: Response,
    payload: GeoOpportunityScheduleSave | GeoOpportunityScheduleCommand,
    operation: ScheduleOperation,
) -> GeoOpportunityScheduleDetail:
    response.headers["Cache-Control"] = "no-store"
    try:
        return change(
            db,
            actor=actor,
            request_id=request.state.request_id,
            payload=payload,
            operation=operation,
        )
    except AppError:
        raise
    except Exception:
        failure = RuntimeError("自动评估配置失败，请按请求ID重读配置核对")
    raise failure


@router.put(
    "",
    response_model=GeoOpportunityScheduleDetail,
    operation_id="saveGeoOpportunityEvaluationSchedule",
    responses=error_responses(401, 403, 404, 409, 422),
)
def save_schedule(
    payload: GeoOpportunityScheduleSave,
    request: Request,
    response: Response,
    db: DbSession,
    actor: AdminUser,
    _csrf: CsrfProtected,
) -> GeoOpportunityScheduleDetail:
    return command(db, actor, request, response, payload, "configure")


@router.post(
    "/activate",
    response_model=GeoOpportunityScheduleDetail,
    operation_id="activateGeoOpportunityEvaluationSchedule",
    responses=error_responses(401, 403, 404, 409, 422),
)
def activate(
    payload: GeoOpportunityScheduleCommand,
    request: Request,
    response: Response,
    db: DbSession,
    actor: AdminUser,
    _csrf: CsrfProtected,
) -> GeoOpportunityScheduleDetail:
    return command(db, actor, request, response, payload, "activate")


@router.post(
    "/pause",
    response_model=GeoOpportunityScheduleDetail,
    operation_id="pauseGeoOpportunityEvaluationSchedule",
    responses=error_responses(401, 403, 404, 409, 422),
)
def pause(
    payload: GeoOpportunityScheduleCommand,
    request: Request,
    response: Response,
    db: DbSession,
    actor: AdminUser,
    _csrf: CsrfProtected,
) -> GeoOpportunityScheduleDetail:
    return command(db, actor, request, response, payload, "pause")


@router.post(
    "/resume",
    response_model=GeoOpportunityScheduleDetail,
    operation_id="resumeGeoOpportunityEvaluationSchedule",
    responses=error_responses(401, 403, 404, 409, 422),
)
def resume(
    payload: GeoOpportunityScheduleCommand,
    request: Request,
    response: Response,
    db: DbSession,
    actor: AdminUser,
    _csrf: CsrfProtected,
) -> GeoOpportunityScheduleDetail:
    return command(db, actor, request, response, payload, "resume")
