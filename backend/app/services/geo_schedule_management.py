"""计划配置命令同步游标；调用者已锁定Plan并flush其配置/状态。"""

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.geo_monitoring_plans import GeoMonitoringPlan
from app.models.geo_plan_schedules import GeoPlanSchedule, GeoPlanScheduleWindow
from app.schemas.geo_monitoring_plans import GeoMonitoringPlanConfiguration
from app.services.geo_schedule_clock import next_window


def clock(db: Session) -> datetime:
    value = db.scalar(select(func.clock_timestamp()))
    assert isinstance(value, datetime)
    return value


def following(value: GeoMonitoringPlanConfiguration, after: datetime) -> datetime:
    assert value.cron_expression is not None
    try:
        return next_window(value.cron_expression, value.timezone, after)
    except ValueError as error:
        raise AppError(
            "VALIDATION_ERROR",
            str(error),
            422,
            {"errors": [{"loc": ["body", "cron_expression"], "msg": str(error)}]},
        ) from error


def registered(db: Session, plan_id: UUID) -> bool:
    return db.get(GeoPlanSchedule, plan_id, populate_existing=True) is not None


def synchronize(
    db: Session, plan: GeoMonitoringPlan, value: GeoMonitoringPlanConfiguration, *, creating: bool
) -> None:
    if value.schedule_kind != "CRON":
        return
    now = clock(db)
    # 即使尚未启用，也拒绝永远无日期的Cron。
    last = db.scalar(
        select(GeoPlanScheduleWindow)
        .where(GeoPlanScheduleWindow.plan_id == plan.id)
        .order_by(GeoPlanScheduleWindow.scheduled_for.desc())
        .limit(1)
    )
    lower_bound = now
    if last is not None:
        lower_bound = max(lower_bound, last.scheduled_for)
        if last.covered_until is not None:
            lower_bound = max(lower_bound, last.covered_until - timedelta(microseconds=1))
    # DB时钟回拨也不重新选择已处理窗口/错过区间；旧回执保持只读。
    upcoming = following(value, lower_bound)
    cursor = db.scalar(
        select(GeoPlanSchedule)
        .where(GeoPlanSchedule.plan_id == plan.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if cursor is None:
        if not creating:
            raise AppError("GEO_PLAN_CRON_UNSUPPORTED", "历史CRON未登记调度，保持只读", 409)
        cursor = GeoPlanSchedule(plan_id=plan.id, next_run_at=None)
        db.add(cursor)
    if cursor.next_run_at is not None and cursor.next_run_at <= now:
        db.add(
            GeoPlanScheduleWindow(
                plan_id=plan.id,
                scheduled_for=cursor.next_run_at,
                plan_revision=plan.revision - 1,
                status="MISSED",
                error_code="PLAN_CHANGED",
                covered_until=upcoming,
                batch_id=None,
            )
        )
    cursor.next_run_at = upcoming if plan.status == "ACTIVE" else None
