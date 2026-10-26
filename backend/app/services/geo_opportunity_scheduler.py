"""自动评估周期执行：同一配置/UTC窗口仅一个已提交结果，无外部I/O。"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.errors import AppError
from app.models.geo_opportunity_schedule import GeoOpportunitySchedule, GeoOpportunityScheduleWindow
from app.models.identity import User
from app.schemas.common import AccountType
from app.schemas.geo_opportunity_evaluation import (
    GeoOpportunityEvaluationReceipt,
    GeoOpportunityEvaluationRequest,
)
from app.schemas.geo_opportunity_schedule import GeoOpportunityScheduleConfiguration
from app.services.current_actor import current_actor_command
from app.services.geo_opportunity_evaluation import run_scheduled_evaluation
from app.services.geo_opportunity_schedule_state import clock, configuration, enabled

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Attempt:
    revision: int
    authorizer_id: UUID
    due: datetime
    selected: datetime
    next_run: datetime
    configuration: GeoOpportunityScheduleConfiguration


def matches(row: GeoOpportunitySchedule | None, attempt: Attempt) -> bool:
    return (
        row is not None
        and row.status == "ACTIVE"
        and row.revision == attempt.revision
        and row.authorizer_id == attempt.authorizer_id
        and row.next_run_at == attempt.due
    )


def finish(
    db: Session,
    row: GeoOpportunitySchedule,
    attempt: Attempt,
    *,
    receipt: GeoOpportunityEvaluationReceipt | None,
    error_code: str | None,
) -> None:
    data = attempt.configuration.model_dump(mode="json", exclude={"rule_set_revision"})
    fields = dict(
        schedule_id=1,
        configuration_revision=attempt.revision,
        configuration_snapshot=data,
        rule_set_revision=attempt.configuration.rule_set_revision,
    )
    if attempt.selected > attempt.due:
        db.add(
            GeoOpportunityScheduleWindow(
                **fields,
                scheduled_for=attempt.due,
                status="MISSED",
                error_code="SKIPPED_OLDER_WINDOWS",
                covered_until=attempt.selected,
            )
        )
    db.add(
        GeoOpportunityScheduleWindow(
            **fields,
            scheduled_for=attempt.selected,
            status="COMPLETED" if receipt else "FAILED",
            error_code=error_code,
            evaluation_run_id=receipt.evaluation_run_id if receipt else None,
            covered_until=None,
        )
    )
    row.next_run_at = attempt.next_run
    db.flush()
    db.commit()


def record_failure(db: Session, attempt: Attempt, code: str) -> None:
    """评估异常已rollback；重锁仅记录失败，不授权执行或冒充失效管理员。"""
    db.execute(select(User.id).where(User.id == attempt.authorizer_id).with_for_update(read=True))
    row = db.scalar(
        select(GeoOpportunitySchedule)
        .where(GeoOpportunitySchedule.id == 1)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if (
        not enabled()
        or not matches(row, attempt)
        or db.get(GeoOpportunityScheduleWindow, (1, attempt.selected)) is not None
    ):
        db.rollback()
        return  # 暂停/修订/另一执行或已确认的commit先赢，不覆盖真实结果。
    assert row is not None
    finish(db, row, attempt, receipt=None, error_code=code)


def execute_due_evaluation(
    db: Session, *, now: datetime | None = None
) -> GeoOpportunityEvaluationReceipt | None:
    db.autoflush = False
    if db.connection().get_isolation_level() != "READ COMMITTED":
        raise ValueError("自动评估要求READ COMMITTED")
    if not enabled():
        db.rollback()
        return None
    initial = db.get(GeoOpportunitySchedule, 1, populate_existing=True)
    observed = (now or clock(db)).astimezone(UTC)
    if (
        initial is None
        or initial.status != "ACTIVE"
        or initial.next_run_at is None
        or initial.next_run_at > observed
    ):
        db.rollback()
        return None
    cfg = configuration(initial)
    period = timedelta(hours=cfg.interval_hours)
    selected = initial.next_run_at + ((observed - initial.next_run_at) // period) * period
    attempt = Attempt(
        initial.revision,
        initial.authorizer_id,
        initial.next_run_at,
        selected,
        selected + period,
        cfg,
    )
    try:
        actor = db.get(User, attempt.authorizer_id)
        if actor is None:
            raise AppError("AUTH_REQUIRED", "自动评估授权管理员已不可用", 401)
        with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current:
            row = db.scalar(
                select(GeoOpportunitySchedule)
                .where(GeoOpportunitySchedule.id == 1)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if not matches(row, attempt) or not enabled():
                db.rollback()
                return None
            assert row is not None
            payload = GeoOpportunityEvaluationRequest(
                **cfg.model_dump(exclude={"interval_hours", "lookback_days"}),
                date_from=selected - timedelta(days=cfg.lookback_days),
                date_to=selected,
            )
            identity = "auto02:" + selected.astimezone(UTC).isoformat(timespec="microseconds")
            receipt = run_scheduled_evaluation(
                db, payload, actor=current, request_id=identity, idempotency_key=identity
            )
            finish(db, row, attempt, receipt=receipt, error_code=None)
            return receipt
    except AppError as error:
        db.rollback()
        record_failure(db, attempt, error.code)
        return None
    except Exception as error:
        db.rollback()
        logger.error(
            "周期机会评估失败 revision=%s window=%s error_type=%s",
            attempt.revision,
            attempt.selected.isoformat(),
            type(error).__name__,
        )
        record_failure(db, attempt, "EVALUATION_FAILED")
        return None


def evaluate_due_opportunities() -> None:
    if not enabled():
        return
    try:
        with SessionLocal() as db:
            execute_due_evaluation(db)
    except Exception as error:
        logger.error("自动评估窗口未能提交 error_type=%s", type(error).__name__)
