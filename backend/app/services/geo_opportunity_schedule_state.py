"""周期评估自己的配置/窗口投影；不借用监测计划的运行状态。"""

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.geo_opportunity_evaluation import GeoOpportunityEvaluationRun
from app.models.geo_opportunity_schedule import GeoOpportunitySchedule, GeoOpportunityScheduleWindow
from app.models.identity import User
from app.schemas.geo_opportunity_evaluation import GeoOpportunityEvaluationReceipt
from app.schemas.geo_opportunity_schedule import (
    GeoOpportunityScheduleConfiguration,
    GeoOpportunityScheduleDetail,
    GeoOpportunityScheduleWindowOut,
)


def enabled() -> bool:
    return settings.geo_monitoring_enabled and settings.geo_opportunity_evaluation_enabled


def clock(db: Session) -> datetime:
    value = db.scalar(select(func.clock_timestamp()))
    assert isinstance(value, datetime)
    return value


def configuration(
    row: GeoOpportunitySchedule | GeoOpportunityScheduleWindow,
) -> GeoOpportunityScheduleConfiguration:
    value = (
        row.configuration if isinstance(row, GeoOpportunitySchedule) else row.configuration_snapshot
    )
    return GeoOpportunityScheduleConfiguration.model_validate(
        value | {"rule_set_revision": row.rule_set_revision}
    )


def latest(db: Session) -> GeoOpportunityScheduleWindow | None:
    return db.scalar(
        select(GeoOpportunityScheduleWindow)
        .where(GeoOpportunityScheduleWindow.schedule_id == 1)
        .order_by(GeoOpportunityScheduleWindow.scheduled_for.desc())
        .limit(1)
    )


def detail(db: Session) -> GeoOpportunityScheduleDetail:
    row = db.get(GeoOpportunitySchedule, 1, populate_existing=True)
    recent = latest(db) if row is not None else None
    window = None
    if recent is not None:
        receipt = (
            db.get(GeoOpportunityEvaluationRun, recent.evaluation_run_id)
            if recent.evaluation_run_id
            else None
        )
        window = GeoOpportunityScheduleWindowOut(
            scheduled_for=recent.scheduled_for,
            configuration_revision=recent.configuration_revision,
            configuration=configuration(recent),
            status=recent.status,
            covered_until=recent.covered_until,
            error_code=recent.error_code,
            created_at=recent.created_at,
            receipt=GeoOpportunityEvaluationReceipt.model_validate(receipt.receipt)
            if receipt
            else None,
        )
    actions = ["CONFIGURE"]
    if row is not None:
        if row.status == "ACTIVE":
            actions.append("PAUSE")
        elif enabled():
            actions.append("ACTIVATE" if row.status == "DISABLED" else "RESUME")
    blocked = None if enabled() else "GEO_MONITORING_DISABLED"
    if blocked is None and row is not None:
        authorizer = db.get(User, row.authorizer_id)
        assert authorizer is not None  # RESTRICT FK保证当前授权身份可读取。
        if not authorizer.is_active:
            blocked = "AUTH_REQUIRED"
        elif authorizer.must_change_password:
            blocked = "PASSWORD_CHANGE_REQUIRED"
        elif authorizer.account_type != "ADMIN":
            blocked = "PERMISSION_DENIED"
    return GeoOpportunityScheduleDetail(
        revision=row.revision if row else 0,
        status=row.status if row else "UNCONFIGURED",
        configuration=configuration(row) if row else None,
        authorizer_id=row.authorizer_id if row else None,
        next_run_at=row.next_run_at if row else None,
        latest_window=window,
        available_actions=actions,
        blocked_reason=blocked,
    )
