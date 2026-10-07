"""分析生命周期事务 owner；输入冻结、claim 与结果提交均以数据库事实仲裁。"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.models.geo_analysis import GeoAnalysisRevision
from app.models.geo_analysis_worker import GeoAnalysisJob
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.schemas.geo_runs import GeoRunStatus
from app.services import geo_analysis_execution as execution
from app.services.geo_analysis_inputs import prepare_revision
from app.services.geo_run_lifecycle import database_now, lock_run, refresh_batch, run_state
from app.services.geo_run_policy import run_transition

logger = logging.getLogger("partsignal.worker")
# 有限本地计算的租约；不是外部 provider 超时或新的配置能力。
ANALYSIS_LEASE_SECONDS = 300
FAILURE_SUMMARY = "分析执行或提交失败，原始回答已保留，可显式重新分析"


@dataclass(frozen=True)
class AnalysisLease:
    analysis_id: UUID
    run_id: UUID
    token: UUID


def lock_analysis(
    db: Session, analysis_id: UUID
) -> tuple[GeoObservationBatch, GeoObservationRun, GeoAnalysisRevision, GeoAnalysisJob] | None:
    run_id = db.scalar(
        select(GeoAnalysisRevision.run_id).where(GeoAnalysisRevision.id == analysis_id)
    )
    if run_id is None:
        return None
    locked = lock_run(db, run_id)
    assert locked is not None
    analysis = db.scalar(
        select(GeoAnalysisRevision)
        .where(GeoAnalysisRevision.id == analysis_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    job = db.scalar(
        select(GeoAnalysisJob)
        .where(GeoAnalysisJob.analysis_revision_id == analysis_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if analysis is None or job is None:
        return None
    return *locked, analysis, job


def prepare_collected_run(run_id: UUID) -> UUID | None:
    if not settings.geo_monitoring_enabled:
        return None
    with SessionLocal() as db:
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        locked = lock_run(db, run_id)
        if locked is None or locked[1].status != "COLLECTED":
            return None
        identity = prepare_revision(db, locked[1], current_dictionary=False)
        db.commit()
        return identity


def claim_analysis_revision(analysis_id: UUID) -> AnalysisLease | None:
    if not settings.geo_monitoring_enabled:
        return None
    with SessionLocal.begin() as db:
        locked = lock_analysis(db, analysis_id)
        if locked is None:
            return None
        batch, run, analysis, job = locked
        if analysis.status != "PENDING" or job.claimed_at is not None:
            return None
        if run.status not in {"COLLECTED", "COMPLETED", "NEEDS_REVIEW", "FAILED"}:
            return None
        now, token = database_now(db), uuid4()
        job.claimed_at = now
        job.lease_token = token
        job.lease_expires_at = now + timedelta(seconds=ANALYSIS_LEASE_SECONDS)
        if run.status == "COLLECTED":
            run.status = run_transition(run_state(db, run), GeoRunStatus.ANALYZING).value
            run.lease_token, run.lease_expires_at = token, job.lease_expires_at
            run.revision += 1
        refresh_batch(db, batch, now)
        return AnalysisLease(analysis.id, run.id, token)


def owns_lease(
    analysis: GeoAnalysisRevision, job: GeoAnalysisJob, token: UUID, now: datetime
) -> bool:
    return (
        analysis.status == "PENDING"
        and job.lease_token == token
        and job.lease_expires_at is not None
        and job.lease_expires_at > now
    )


def finish_failure(
    db: Session,
    locked: tuple[GeoObservationBatch, GeoObservationRun, GeoAnalysisRevision, GeoAnalysisJob],
    now: datetime,
) -> None:
    """调用者已校验有效 token 或真实过期；租约、revision 与首次 Run 失败同事务。"""
    batch, run, analysis, job = locked
    token = job.lease_token
    job.lease_token = job.lease_expires_at = None
    db.flush()  # 执行元数据只能在 revision 尚为 PENDING 时维护。
    analysis.status, analysis.finished_at = "FAILED", now
    analysis.error_code, analysis.error_summary = "ANALYSIS_FAILED", FAILURE_SUMMARY
    db.flush()
    if run.status == "ANALYZING" and run.lease_token == token:
        run.status = run_transition(run_state(db, run), GeoRunStatus.FAILED).value
        run.error_stage, run.error_code, run.error_summary = (
            "ANALYSIS",
            "ANALYSIS_FAILED",
            FAILURE_SUMMARY,
        )
        run.finished_at = now
        run.lease_token = run.lease_expires_at = None
        run.revision += 1
    refresh_batch(db, batch, now)


def submit_analysis_failure(lease: AnalysisLease) -> bool:
    with SessionLocal.begin() as db:
        locked = lock_analysis(db, lease.analysis_id)
        if locked is None or not owns_lease(locked[2], locked[3], lease.token, database_now(db)):
            return False
        finish_failure(db, locked, database_now(db))
        return True


def submit_analysis_result(lease: AnalysisLease, result: execution.AnalysisResult) -> bool:
    with SessionLocal.begin() as db:
        locked = lock_analysis(db, lease.analysis_id)
        if locked is None:
            return False
        batch, run, analysis, job = locked
        now = database_now(db)
        if not owns_lease(analysis, job, lease.token, now):
            return False
        execution.add_results(db, analysis.id, result)
        db.flush()  # 子结果守卫只接受 PENDING；延迟约束要求最终 COMPLETED。
        job.lease_token = job.lease_expires_at = None
        db.flush()
        analysis.status, analysis.finished_at = "COMPLETED", now
        analysis.confidence_summary = {"mentions": None, "recommendations": None, "claims": None}
        analysis.review_required_reasons = list(result.review_required_reasons)
        db.flush()
        if run.status == "ANALYZING" and run.lease_token == lease.token:
            run.status = run_transition(
                run_state(db, run),
                GeoRunStatus.NEEDS_REVIEW
                if result.review_required_reasons
                else GeoRunStatus.COMPLETED,
            ).value
            run.finished_at = now if run.status == "COMPLETED" else None
            run.lease_token = run.lease_expires_at = None
            run.revision += 1
            db.flush()  # 0054 不允许 pointer UPDATE 夹带任何状态/lease 改变。
        newest = db.scalar(
            select(GeoAnalysisRevision.id)
            .where(
                GeoAnalysisRevision.run_id == run.id,
                GeoAnalysisRevision.status == "COMPLETED",
            )
            .order_by(GeoAnalysisRevision.revision.desc())
            .limit(1)
        )
        if newest == analysis.id and run.current_analysis_revision_id != analysis.id:
            run.current_analysis_revision_id = analysis.id
            run.revision += 1
            db.flush()
        refresh_batch(db, batch, now)
        return True


def process_analysis_revision(analysis_id: UUID) -> None:
    lease = claim_analysis_revision(analysis_id)
    if lease is None:
        return
    try:
        with SessionLocal() as db:
            analysis = db.get(GeoAnalysisRevision, analysis_id)
            assert analysis is not None
            value = execution.load_analysis_input(db, analysis)
        result = execution.analyze(value)
        submit_analysis_result(lease, result)
    except Exception as error:
        # 插入/提交异常已经回滚；安全失败摘要不包含答案/事实/SQL/原始异常。
        submit_analysis_failure(lease)
        logger.error("GEO 分析失败 analysis_id=%s error_type=%s", analysis_id, type(error).__name__)


def process_analysis_run(run_id: UUID) -> None:
    try:
        identity = prepare_collected_run(run_id)
    except DBAPIError as error:
        # RR 竞争和数据库故障由下次扫描读取新事实；不能伪造已创建 revision。
        logger.error("GEO 分析输入装配失败 run_id=%s error_type=%s", run_id, type(error).__name__)
        return
    if identity is not None:
        process_analysis_revision(identity)
