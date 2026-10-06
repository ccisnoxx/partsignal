"""提交后投递与数据库补投递；只有未发送的 PENDING 可入队。"""

import logging
from collections.abc import Callable
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.services.geo_run_lifecycle import (
    database_now,
    fail_run,
    lock_run,
    recover_unsent_run,
    refresh_batch,
)

logger = logging.getLogger("partsignal.worker")
type RunSender = Callable[[str], object]


def _pending(run: GeoObservationRun) -> bool:
    return (
        run.status == "PENDING"
        and run.external_call_state == "NOT_STARTED"
        and run.input_snapshot["profile"]["collection_mode"] == "API"
    )


def _reserve(run: GeoObservationRun, now: datetime) -> None:
    """先提交尝试时间；崩溃后仍由 PENDING 阈值恢复，无跨服务原子成功假象。"""
    run.last_dispatch_attempt_at = now
    run.dispatch_attempt_count += 1
    run.revision += 1


def _publish(run_id: UUID, sender: RunSender) -> bool:
    try:
        sender(str(run_id))
        return True
    except Exception as error:
        logger.warning("GEO 投递失败 run_id=%s error_type=%s", run_id, type(error).__name__)
        return False


def dispatch_batch(db: Session, batch_id: UUID, sender: RunSender) -> int:
    """工厂 commit 后调用；Broker/元数据故障不把已接受的创建回执改为失败。"""
    try:
        batch = db.scalar(
            select(GeoObservationBatch.id)
            .where(GeoObservationBatch.id == batch_id)
            .with_for_update()
        )
        if batch is None:
            db.rollback()
            return 0
        runs = list(
            db.scalars(
                select(GeoObservationRun)
                .where(
                    GeoObservationRun.batch_id == batch_id,
                    GeoObservationRun.status == "PENDING",
                    GeoObservationRun.dispatch_attempt_count == 0,
                )
                .order_by(GeoObservationRun.id)
                .with_for_update()
            )
        )
        now = database_now(db)
        ids = [r.id for r in runs if _pending(r)]
        for run in runs:
            if _pending(run):
                _reserve(run, now)
        db.commit()

    except Exception as error:
        db.rollback()
        logger.error(
            "GEO 首次投递事务失败 batch_id=%s error_type=%s", batch_id, type(error).__name__
        )
        return 0

    dispatched = 0
    for run_id in ids:
        if not _publish(run_id, sender):
            # Broker 故障一次即停止首次同步发布；余下预留由 PENDING 扫描恢复。
            break
        dispatched += 1
    return dispatched


def dispatch_created_batch(db: Session, batch_id: UUID) -> None:
    try:
        # MANUAL 批次无需导入 Worker，更不尝试连接 Broker。
        automatic = db.scalar(
            select(GeoObservationRun.id)
            .where(
                GeoObservationRun.batch_id == batch_id,
                GeoObservationRun.input_snapshot["profile"]["collection_mode"].astext == "API",
                GeoObservationRun.status == "PENDING",
                GeoObservationRun.dispatch_attempt_count == 0,
            )
            .limit(1)
        )
        db.rollback()
        if automatic is not None:
            from app.worker import collect_geo_run

            dispatch_batch(db, batch_id, collect_geo_run.delay)
    except Exception as error:
        db.rollback()
        logger.error("GEO 创建后投递失败 batch_id=%s error_type=%s", batch_id, type(error).__name__)


def _scan_candidates(*, expired: bool, now: datetime) -> list[UUID]:
    r = GeoObservationRun
    due = r.lease_expires_at if expired else func.coalesce(r.last_dispatch_attempt_at, r.created_at)
    cutoff = now if expired else now - timedelta(seconds=settings.geo_pending_redispatch_seconds)
    with SessionLocal() as db:
        return list(
            db.scalars(
                select(r.id)
                .where(
                    r.status == ("RUNNING" if expired else "PENDING"),
                    due <= cutoff,
                    r.input_snapshot["profile"]["collection_mode"].astext == "API",
                )
                .order_by(due, r.id)
                .limit(settings.geo_recovery_batch_size)
            )
        )


def _lock_candidate(db: Session, run_id: UUID) -> GeoObservationRun | None:
    batch_id = db.scalar(select(GeoObservationRun.batch_id).where(GeoObservationRun.id == run_id))
    # 不先锁 Run 再等待 Batch；同批次并行扫描 SKIP LOCKED 避免锁环。
    if (
        db.scalar(
            select(GeoObservationBatch.id)
            .where(GeoObservationBatch.id == batch_id)
            .with_for_update(skip_locked=True)
        )
        is None
    ):
        return None
    return db.scalar(
        select(GeoObservationRun)
        .where(GeoObservationRun.id == run_id)
        .with_for_update(skip_locked=True)
    )


def redispatch_pending_collection_runs(sender: RunSender, *, now: datetime | None = None) -> int:
    with SessionLocal() as db:
        scan_time = now if now is not None else database_now(db)
    dispatched = 0
    for run_id in _scan_candidates(expired=False, now=scan_time):
        with SessionLocal.begin() as db:
            run = _lock_candidate(db, run_id)
            if run is None or not _pending(run):
                continue
            due = run.last_dispatch_attempt_at or run.created_at
            if due > scan_time - timedelta(seconds=settings.geo_pending_redispatch_seconds):
                continue
            _reserve(run, scan_time)
        # 此处已提交并释放全部数据库锁，Broker 延迟不能拖住同批结果提交。
        dispatched += _publish(run_id, sender)
    return dispatched


def recover_expired_collection_runs(*, now: datetime | None = None) -> int:
    """只有持久化未发送事实可安全恢复；SENT/UNKNOWN 永不自动重发。"""
    with SessionLocal() as db:
        scan_time = now if now is not None else database_now(db)
    recovered = 0
    for run_id in _scan_candidates(expired=True, now=scan_time):
        with SessionLocal.begin() as db:
            candidate = _lock_candidate(db, run_id)
            if (
                candidate is None
                or candidate.status != "RUNNING"
                or candidate.lease_expires_at is None
                or candidate.lease_expires_at > scan_time
            ):
                continue
            locked = lock_run(db, run_id)
            assert locked is not None
            batch, run = locked
            if run.external_call_state == "NOT_STARTED":
                recover_unsent_run(db, run, scan_time)
            else:
                unknown = run.external_call_state in {"SENT", "UNKNOWN"}
                if unknown:
                    run.external_call_state = "UNKNOWN"
                fail_run(
                    db,
                    run,
                    now=scan_time,
                    code="COLLECTOR_UNKNOWN_OUTCOME" if unknown else "WORKER_LOST",
                    summary="外部采集结果未知，必须显式创建新尝试"
                    if unknown
                    else "采集结果未提交，必须显式创建新尝试",
                )
            refresh_batch(db, batch, scan_time)
            recovered += 1
    return recovered
