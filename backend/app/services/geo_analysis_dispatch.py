"""数据库驱动的分析派发与过期失败；Broker 只保存稳定 UUID。"""

from collections.abc import Callable
from datetime import datetime, timedelta
from enum import StrEnum
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError

from app.config import settings
from app.db import SessionLocal
from app.models.geo_analysis import GeoAnalysisRevision
from app.models.geo_analysis_worker import GeoAnalysisJob
from app.models.geo_runs import GeoObservationRun
from app.services.geo_analysis_runs import finish_failure, lock_analysis, prepare_collected_run
from app.services.geo_ops_logging import OpsError, geo_event
from app.services.geo_run_lifecycle import database_now

type AnalysisSender = Callable[[str], object]


class AnalysisDispatch(StrEnum):
    SKIPPED = "SKIPPED"
    SENT = "SENT"
    UNAVAILABLE = "UNAVAILABLE"


def publish(identity: UUID, sender: AnalysisSender) -> bool:
    try:
        sender(str(identity))
        return True
    except Exception:
        geo_event(event="dispatch_failed", stage="ANALYSIS", status="FAILED",
                  analysis_id=identity, error_code=OpsError.BROKER_UNAVAILABLE)
        return False


def dispatch_revision(
    analysis_id: UUID, sender: AnalysisSender, *, now: datetime | None = None
) -> AnalysisDispatch:
    with SessionLocal.begin() as db:
        locked = lock_analysis(db, analysis_id)
        if locked is None:
            return AnalysisDispatch.SKIPPED
        _, _, analysis, job = locked
        if analysis.status != "PENDING" or job.claimed_at is not None:
            return AnalysisDispatch.SKIPPED
        clock = now if now is not None else database_now(db)
        if (
            job.last_dispatch_attempt_at is not None
            and job.last_dispatch_attempt_at
            > clock - timedelta(seconds=settings.geo_pending_redispatch_seconds)
        ):
            return AnalysisDispatch.SKIPPED
        job.last_dispatch_attempt_at = clock
        job.dispatch_attempt_count += 1
    # 预留已提交，丢失 Broker 确认时允许重复消息，claim 确保只有一个有效计算者。
    return AnalysisDispatch.SENT if publish(analysis_id, sender) else AnalysisDispatch.UNAVAILABLE


def dispatch_collected_run(run_id: UUID, sender: AnalysisSender) -> bool:
    """采集 commit 后才读实际 COLLECTED；故障窗口由数据库扫描补偿。"""
    if not settings.geo_monitoring_enabled:
        return False
    try:
        with SessionLocal() as db:
            status = db.scalar(
                select(GeoObservationRun.status).where(GeoObservationRun.id == run_id)
            )
    except DBAPIError:
        geo_event(event="dispatch_failed", stage="ANALYSIS", status="FAILED",
                  run_id=run_id, error_code=OpsError.DATABASE_UNAVAILABLE)
        return False
    return status == "COLLECTED" and publish(run_id, sender)


def redispatch_pending_analysis_revisions(
    sender: AnalysisSender, *, now: datetime | None = None
) -> int:
    if not settings.geo_monitoring_enabled:
        return 0
    with SessionLocal() as db:
        clock = now if now is not None else database_now(db)
        collected = list(
            db.scalars(
                select(GeoObservationRun.id)
                .where(
                    GeoObservationRun.status == "COLLECTED",
                )
                .order_by(GeoObservationRun.collected_at, GeoObservationRun.id)
                .limit(settings.geo_recovery_batch_size)
            )
        )
    for run_id in collected:
        try:
            prepare_collected_run(run_id)
        except Exception:
            geo_event(event="dispatch_failed", stage="ANALYSIS", status="FAILED",
                      run_id=run_id, error_code=OpsError.OPERATION_FAILED)
    a, j = GeoAnalysisRevision, GeoAnalysisJob
    with SessionLocal() as db:
        ids = list(
            db.scalars(
                select(a.id)
                .join(j, j.analysis_revision_id == a.id)
                .where(
                    a.status == "PENDING",
                    j.claimed_at.is_(None),
                    (j.last_dispatch_attempt_at.is_(None))
                    | (
                        j.last_dispatch_attempt_at
                        <= clock - timedelta(seconds=settings.geo_pending_redispatch_seconds)
                    ),
                )
                .order_by(func.coalesce(j.last_dispatch_attempt_at, a.created_at), a.id)
                .limit(settings.geo_recovery_batch_size)
            )
        )
    sent = 0
    for identity in ids:
        outcome = dispatch_revision(identity, sender, now=now)
        if outcome == AnalysisDispatch.UNAVAILABLE:
            # Broker 故障不在一个周期逐个等待，未预留项下次仍可派发。
            break
        sent += outcome == AnalysisDispatch.SENT
    return sent


def recover_expired_analysis_revisions(*, now: datetime | None = None) -> int:
    with SessionLocal() as db:
        clock = now if now is not None else database_now(db)
        ids = list(
            db.scalars(
                select(GeoAnalysisRevision.id)
                .join(
                    GeoAnalysisJob,
                    GeoAnalysisJob.analysis_revision_id == GeoAnalysisRevision.id,
                )
                .where(
                    GeoAnalysisRevision.status == "PENDING",
                    GeoAnalysisJob.lease_expires_at <= clock,
                )
                .order_by(GeoAnalysisJob.lease_expires_at, GeoAnalysisRevision.id)
                .limit(settings.geo_recovery_batch_size)
            )
        )
    recovered = 0
    for identity in ids:
        with SessionLocal.begin() as db:
            locked = lock_analysis(db, identity)
            if locked is None:
                continue
            _, _, analysis, job = locked
            if (
                analysis.status != "PENDING"
                or job.lease_expires_at is None
                or job.lease_expires_at > clock
            ):
                continue
            finish_failure(db, locked, clock)
            recovered += 1
    return recovered
