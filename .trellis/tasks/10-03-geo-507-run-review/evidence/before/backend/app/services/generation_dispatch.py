"""生成作业投递、超龄恢复、租约回收与诊断查询。"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select

from app.config import settings
from app.db import SessionLocal
from app.models.ai_generation import GenerationJob

logger = logging.getLogger("partsignal.worker")
GenerationJobSender = Callable[[str], object]


@dataclass(frozen=True)
class RecoveryResult:
    """单轮 PENDING 补投递的非敏感结构化结果。"""

    selected: int
    dispatched: int
    failed: int


def _attempt_dispatch(
    job: GenerationJob,
    sender: GenerationJobSender,
    *,
    now: datetime,
) -> bool:
    """在持有 Job 行锁时尝试投递，并记录本次尝试结果。"""
    dispatched = False
    error_type: str | None = None
    try:
        sender(str(job.id))
        dispatched = True
    except Exception as error:  # Broker 客户端异常类型不稳定，边界统一记录后恢复。
        error_type = type(error).__name__
    job.last_dispatch_attempt_at = now
    job.dispatch_attempt_count += 1
    queue_age_seconds = max(0, int((now - job.created_at).total_seconds()))
    if dispatched:
        logger.info(
            "生成作业已投递 job_id=%s status=PENDING dispatch_attempt_count=%s "
            "queue_age_seconds=%s",
            job.id,
            job.dispatch_attempt_count,
            queue_age_seconds,
        )
    else:
        logger.warning(
            "生成作业投递失败 job_id=%s status=PENDING dispatch_attempt_count=%s "
            "queue_age_seconds=%s error_type=%s",
            job.id,
            job.dispatch_attempt_count,
            queue_age_seconds,
            error_type,
        )
    return dispatched


def dispatch_generation_job(job_id: uuid.UUID, sender: GenerationJobSender) -> bool:
    """首次投递 PENDING Job；任何 Broker 或元数据故障都保留可恢复状态。"""
    try:
        with SessionLocal.begin() as db:
            job = db.scalar(
                select(GenerationJob)
                .where(GenerationJob.id == job_id)
                .with_for_update()
            )
            if job is None or job.status != "PENDING":
                return False
            return _attempt_dispatch(job, sender, now=datetime.now(UTC))
    except Exception as error:
        # Job 已在调用方事务提交；诊断元数据失败不能把已接受业务请求伪装成失败。
        logger.error(
            "生成作业投递事务失败 job_id=%s error_type=%s",
            job_id,
            type(error).__name__,
        )
        return False


def redispatch_pending_generation_jobs(
    sender: GenerationJobSender,
    *,
    now: datetime | None = None,
) -> RecoveryResult:
    """限批次锁定超龄 PENDING Job，并复用统一投递边界补发 UUID。"""
    scan_time = now or datetime.now(UTC)
    due_before = scan_time - timedelta(seconds=settings.generation_pending_redispatch_seconds)
    try:
        with SessionLocal.begin() as db:
            due_at = func.coalesce(
                GenerationJob.last_dispatch_attempt_at,
                GenerationJob.created_at,
            )
            jobs = list(
                db.scalars(
                    select(GenerationJob)
                    .where(
                        GenerationJob.status == "PENDING",
                        due_at <= due_before,
                    )
                    .order_by(due_at, GenerationJob.id)
                    .limit(settings.generation_recovery_batch_size)
                    .with_for_update(skip_locked=True)
                )
            )
            dispatched = sum(
                _attempt_dispatch(job, sender, now=scan_time) for job in jobs
            )
        result = RecoveryResult(
            selected=len(jobs),
            dispatched=dispatched,
            failed=len(jobs) - dispatched,
        )
    except Exception as error:
        logger.error("PENDING 生成作业恢复失败 error_type=%s", type(error).__name__)
        return RecoveryResult(selected=0, dispatched=0, failed=0)
    logger.info(
        "PENDING 生成作业恢复完成 selected=%s dispatched=%s failed=%s",
        result.selected,
        result.dispatched,
        result.failed,
    )
    return result


def fail_expired_generation_jobs(*, now: datetime | None = None) -> int:
    """把过期 RUNNING Job 显式标记失败，绝不重新投递供应商调用。"""
    scan_time = now or datetime.now(UTC)
    with SessionLocal.begin() as db:
        jobs = list(
            db.scalars(
                select(GenerationJob)
                .where(
                    GenerationJob.status == "RUNNING",
                    GenerationJob.lease_expires_at <= scan_time,
                )
                .order_by(GenerationJob.lease_expires_at, GenerationJob.id)
                .limit(settings.generation_recovery_batch_size)
                .with_for_update(skip_locked=True)
            )
        )
        for job in jobs:
            job.status = "FAILED"
            job.error_code = "WORKER_LOST"
            job.error_summary = "Worker 租约过期，需显式创建重试作业"
            job.finished_at = scan_time
            job.lease_expires_at = None
    logger.info("RUNNING 生成作业租约回收完成 failed=%s", len(jobs))
    return len(jobs)


def generation_diagnostics(*, now: datetime | None = None) -> dict[str, Any]:
    """返回不包含生成输入或凭据的当前积压、失败和耗时摘要。"""
    checked_at = now or datetime.now(UTC)
    recent_since = checked_at - timedelta(hours=24)
    with SessionLocal() as db:
        pending_count = int(
            db.scalar(
                select(func.count()).select_from(GenerationJob).where(
                    GenerationJob.status == "PENDING"
                )
            )
            or 0
        )
        running_count = int(
            db.scalar(
                select(func.count()).select_from(GenerationJob).where(
                    GenerationJob.status == "RUNNING"
                )
            )
            or 0
        )
        oldest_pending = db.scalar(
            select(func.min(GenerationJob.created_at)).where(
                GenerationJob.status == "PENDING"
            )
        )
        oldest_running = db.scalar(
            select(func.min(GenerationJob.started_at)).where(
                GenerationJob.status == "RUNNING"
            )
        )
        dispatch_summary = db.execute(
            select(
                func.coalesce(func.sum(GenerationJob.dispatch_attempt_count), 0),
                func.max(GenerationJob.last_dispatch_attempt_at),
            )
        ).one()
        failure_rows = db.execute(
            select(GenerationJob.error_code, func.count())
            .where(
                GenerationJob.status == "FAILED",
                GenerationJob.finished_at >= recent_since,
            )
            .group_by(GenerationJob.error_code)
            .order_by(GenerationJob.error_code)
        ).all()
        duration = db.execute(
            select(
                func.avg(GenerationJob.response_duration_ms),
                func.max(GenerationJob.response_duration_ms),
            ).where(
                GenerationJob.response_duration_ms.is_not(None),
                GenerationJob.finished_at >= recent_since,
            )
        ).one()

    def age_seconds(value: datetime | None) -> int | None:
        return max(0, int((checked_at - value).total_seconds())) if value else None

    return {
        "checked_at": checked_at.isoformat(),
        "pending_count": pending_count,
        "oldest_pending_age_seconds": age_seconds(oldest_pending),
        "running_count": running_count,
        "oldest_running_age_seconds": age_seconds(oldest_running),
        "dispatch_attempts_total": int(dispatch_summary[0]),
        "last_dispatch_attempt_at": (
            dispatch_summary[1].isoformat() if dispatch_summary[1] is not None else None
        ),
        "recent_failure_codes": {
            error_code or "UNKNOWN": int(count) for error_code, count in failure_rows
        },
        "recent_provider_duration_ms": {
            "average": round(float(duration[0]), 2) if duration[0] is not None else None,
            "maximum": int(duration[1]) if duration[1] is not None else None,
        },
    }
