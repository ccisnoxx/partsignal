"""到期计划建批事务；窗口、批次与游标原子提交，Broker只在commit后使用。"""

import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.errors import AppError, not_found
from app.models.geo_monitoring_plans import GeoMonitoringPlan
from app.models.geo_plan_schedules import GeoPlanSchedule, GeoPlanScheduleWindow
from app.models.geo_runs import GeoObservationBatch
from app.schemas.geo_batch_creation import GeoBatchCreated
from app.services.geo_batches import batch_receipt, freeze_batch, schedule_identity
from app.services.geo_dispatch import dispatch_created_batch
from app.services.geo_plan_locks import lock_plan
from app.services.geo_plan_policy import require_supported_schedule
from app.services.geo_schedule_management import clock, following

logger = logging.getLogger(__name__)


def create_scheduled_batch(
    *, db: Session, plan_id: UUID, scheduled_for: datetime, now: datetime | None = None
) -> GeoBatchCreated | None:
    """内部系统入口；历史已建窗口只读重放，新窗口必须等于登记游标且已到期。"""
    try:
        db.autoflush = False
        if db.connection().get_isolation_level() != "READ COMMITTED":
            raise ValueError("到期建批要求READ COMMITTED")
        identity = schedule_identity(plan_id, scheduled_for)
        previous = db.scalar(
            select(GeoObservationBatch).where(
                GeoObservationBatch.plan_id == plan_id,
                GeoObservationBatch.scheduled_for == scheduled_for,
            )
        )
        if previous is not None:
            result = batch_receipt(previous)
            db.commit()
            return result  # 不重新派发，也不把历史计划登记到新调度。
        initial = db.get(GeoMonitoringPlan, plan_id, populate_existing=True)
        if initial is None:
            raise not_found("监测计划")
        plan, value = lock_plan(db, plan_id, initial.revision)
        cursor = db.scalar(
            select(GeoPlanSchedule)
            .where(GeoPlanSchedule.plan_id == plan_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        require_supported_schedule(value.schedule_kind, registered=cursor is not None)
        previous = db.scalar(
            select(GeoObservationBatch)
            .where(
                GeoObservationBatch.plan_id == plan_id,
                GeoObservationBatch.scheduled_for == scheduled_for,
            )
            .execution_options(populate_existing=True)
        )
        if previous is not None:
            result = batch_receipt(previous)
            db.commit()
            return result
        observed = now or clock(db)
        if not settings.geo_monitoring_enabled:
            db.rollback()
            return None
        if (
            cursor is None
            or plan.status != "ACTIVE"
            or value.schedule_kind != "CRON"
            or cursor.next_run_at != scheduled_for
            or scheduled_for > observed
        ):
            raise AppError("INVALID_STATE_TRANSITION", "计划不再处于此到期窗口", 409)
        # 等待Plan锁后可能已有另一扫描完成；窗口PK+Batch窗口唯一共同防线。
        completed = db.get(GeoPlanScheduleWindow, (plan_id, scheduled_for))
        if completed is not None:
            db.commit()
            return None
        upcoming = following(value, observed)
        window = GeoPlanScheduleWindow(
            plan_id=plan_id,
            scheduled_for=scheduled_for.astimezone(UTC),
            plan_revision=plan.revision,
            status="MISSED",
            batch_id=None,
            error_code="LATE_WINDOW",
            covered_until=upcoming,
        )
        batch = None
        if observed - scheduled_for <= timedelta(minutes=5):
            try:
                with db.begin_nested():
                    batch = freeze_batch(
                        db,
                        value,
                        plan=plan,
                        actor=None,
                        scheduled_for=scheduled_for,
                        identity=identity,
                        request_id=None,
                    )
            except AppError as error:
                # 已知资格拒绝记录真实失败；未知SQL/程序失败整笔回滚，不伪造终态。
                if error.code not in {
                    "GEO_PLAN_PROFILE_INELIGIBLE",
                    "GEO_PLAN_BUDGET_EXCEEDED",
                    "GEO_PLAN_REFERENCE_INVALID",
                }:
                    raise
                window.status, window.error_code, window.covered_until = "FAILED", error.code, None
            else:
                window.status, window.error_code, window.covered_until = "CREATED", None, None
                window.batch_id = batch.id
            skipped = following(value, scheduled_for)
            if skipped <= observed:
                # 本轮只建一批，其余已到期窗口必须留痕，不能因推进未来游标而静默消失。
                db.add(
                    GeoPlanScheduleWindow(
                        plan_id=plan_id,
                        scheduled_for=skipped,
                        plan_revision=plan.revision,
                        status="MISSED",
                        batch_id=None,
                        error_code="LATE_WINDOW",
                        covered_until=upcoming,
                    )
                )
        cursor.next_run_at = upcoming
        db.add(window)
        db.flush()
        receipt = batch_receipt(batch) if batch is not None else None
        db.commit()
        if batch is not None:
            dispatch_created_batch(db, batch.id)
        return receipt
    except Exception:
        db.rollback()
        raise


def create_due_plan_batches() -> int:
    if not settings.geo_monitoring_enabled:
        return 0
    with SessionLocal() as db:
        now = clock(db)
        due = list(
            db.execute(
                select(GeoPlanSchedule.plan_id, GeoPlanSchedule.next_run_at)
                .where(GeoPlanSchedule.next_run_at <= now)
                .order_by(GeoPlanSchedule.next_run_at, GeoPlanSchedule.plan_id)
                .limit(settings.geo_recovery_batch_size)
            ).tuples()
        )
    created = 0
    for plan_id, window in due:
        assert window is not None
        try:
            with SessionLocal() as db:
                receipt = create_scheduled_batch(db=db, plan_id=plan_id, scheduled_for=window)
            created += receipt is not None
        except AppError as error:
            if error.code not in {"REVISION_CONFLICT", "INVALID_STATE_TRANSITION"}:
                logger.error("定时计划建批拒绝 plan_id=%s code=%s", plan_id, error.code)
        except Exception as error:
            logger.error("定时计划建批失败 plan_id=%s error_type=%s", plan_id, type(error).__name__)
    return created
