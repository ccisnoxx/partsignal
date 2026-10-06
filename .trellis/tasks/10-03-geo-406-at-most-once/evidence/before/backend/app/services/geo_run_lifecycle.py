"""Run 锁、状态事实与 Batch 缓存维护；调用方拥有短事务。"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session, aliased

from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.schemas.geo_runs import (
    GeoBatchStatus,
    GeoExternalCallState,
    GeoRunErrorStage,
    GeoRunStatus,
)
from app.schemas.geo_surfaces import GeoCollectionMode
from app.services.geo_batch_policy import BatchRunState, batch_status
from app.services.geo_run_policy import RunState, run_transition


def database_now(db: Session) -> datetime:
    now = db.scalar(select(func.clock_timestamp()))
    assert isinstance(now, datetime)
    return now


def lock_run(db: Session, run_id: UUID) -> tuple[GeoObservationBatch, GeoObservationRun] | None:
    batch_id = db.scalar(select(GeoObservationRun.batch_id).where(GeoObservationRun.id == run_id))
    if batch_id is None:
        return None
    batch = db.scalar(
        select(GeoObservationBatch)
        .where(GeoObservationBatch.id == batch_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    run = db.scalar(
        select(GeoObservationRun)
        .where(GeoObservationRun.id == run_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert batch is not None and run is not None
    return batch, run


def run_state(db: Session, run: GeoObservationRun) -> RunState:
    return RunState(
        status=GeoRunStatus(run.status),
        collection_mode=GeoCollectionMode(run.input_snapshot["profile"]["collection_mode"]),
        external_call_state=GeoExternalCallState(run.external_call_state),
        error_stage=GeoRunErrorStage(run.error_stage) if run.error_stage else None,
        has_answer=bool(db.scalar(select(exists().where(GeoAnswerSnapshot.run_id == run.id)))),
        has_successor=bool(
            db.scalar(select(exists().where(GeoObservationRun.previous_attempt_id == run.id)))
        ),
    )


def refresh_batch(db: Session, batch: GeoObservationBatch, now: datetime) -> None:
    # 完整集合一次读取，不按每个 Run 查询答案/后继；唯一纯策略裁决状态。
    db.flush()
    r, successor = GeoObservationRun, aliased(GeoObservationRun)
    rows = db.execute(
        select(
            r,
            exists().where(GeoAnswerSnapshot.run_id == r.id),
            exists().where(successor.previous_attempt_id == r.id),
        ).where(r.batch_id == batch.id)
    ).all()
    states = [
        BatchRunState(
            r.run_cell_key,
            r.attempt_no,
            RunState(
                r.status,
                r.input_snapshot["profile"]["collection_mode"],
                r.external_call_state,
                r.error_stage,
                answer,
                successor,
            ),
        )
        for r, answer, successor in rows
    ]
    status = batch_status(
        states, requested_run_count=batch.requested_run_count, matrix_committed=True
    )
    if batch.status != status:
        batch.status = status.value
        batch.revision += 1
        if status != GeoBatchStatus.QUEUED and batch.started_at is None:
            batch.started_at = now
        if status in {
            GeoBatchStatus.COMPLETED,
            GeoBatchStatus.PARTIAL,
            GeoBatchStatus.FAILED,
            GeoBatchStatus.CANCELLED,
            GeoBatchStatus.BUDGET_BLOCKED,
        }:
            batch.finished_at = now


def fail_run(
    db: Session, run: GeoObservationRun, *, now: datetime, code: str, summary: str
) -> None:
    # 调用方可能已更新发送事实；先裁决完整状态，禁止中间 UPDATE 绕过 revision。
    with db.no_autoflush:
        state = run_state(db, run)
    run.status = run_transition(state, GeoRunStatus.FAILED).value
    run.error_stage = "COLLECTION"
    run.error_code = code
    run.error_summary = summary
    run.finished_at = now
    run.lease_token = None
    run.lease_expires_at = None
    run.revision += 1
