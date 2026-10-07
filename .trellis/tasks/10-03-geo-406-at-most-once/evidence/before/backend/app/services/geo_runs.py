"""采集 Worker 的事务 owner；每次执行一个冻结 Run，不自动重试外部调用。"""

import logging
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from uuid import UUID, uuid4

from app.collectors.base import GeoCollector
from app.collectors.contracts import CollectedAnswer, CollectionRequest
from app.collectors.errors import CollectorError, CollectorStage
from app.config import settings
from app.db import SessionLocal
from app.models.ai_generation import AIChannel
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_runs import GeoObservationRun
from app.schemas.geo_runs import GeoExternalCallState as External
from app.schemas.geo_runs import GeoRunErrorCode, GeoRunInputSnapshot, GeoRunStatus
from app.services.geo_collection_execution import (
    ExecutionVersions,
    build_collector,
    configuration_error,
    lock_configuration,
    qualify,
)
from app.services.geo_run_lifecycle import (
    database_now,
    fail_run,
    lock_run,
    refresh_batch,
    run_state,
)
from app.services.geo_run_policy import run_transition

logger = logging.getLogger("partsignal.worker")


class LeaseLost(Exception):
    """旧消息/旧 token 必须停止，不能创建新调用或修改当前结果。"""


@dataclass(frozen=True, repr=False)
class CollectionLease:
    request: CollectionRequest
    token: UUID
    versions: ExecutionVersions
    collector: GeoCollector


def owns_lease(run: GeoObservationRun, token: UUID, now: datetime) -> bool:
    return (
        run.status == "RUNNING"
        and run.lease_token == token
        and run.lease_expires_at is not None
        and run.lease_expires_at > now
    )


def claim_collection_run(run_id: UUID) -> CollectionLease | None:
    with SessionLocal() as db:
        run = db.get(GeoObservationRun, run_id)
        if run is None or run.status != "PENDING":
            return None
        if run.input_snapshot["profile"]["collection_mode"] == "MANUAL":
            return None
        snapshot = GeoRunInputSnapshot.model_validate(run.input_snapshot)
        request = CollectionRequest.from_snapshot(
            run_id,
            snapshot,
            timeout_seconds=120,
            max_response_bytes=2 * 1024 * 1024,
            budget_remaining=None,
        )
    with SessionLocal.begin() as db:
        lock_configuration(db, request)
        locked = lock_run(db, run_id)
        if locked is None:
            return None
        batch, run = locked
        state = run_state(db, run)
        if (
            state.status != GeoRunStatus.PENDING
            or state.has_answer
            or state.has_successor
            or state.external_call_state != External.NOT_STARTED
        ):
            return None
        now = database_now(db)
        try:
            # 预算预留尚属 GEO-407；不能忽略已冻结的限额然后发送。
            if batch.plan_snapshot.get("budget_limit") is not None:
                raise configuration_error()
            versions = qualify(db, request)
            channel = db.get(AIChannel, request.profile.ai_channel_id)
            assert channel is not None
            request = replace(request, timeout_seconds=channel.timeout_seconds)
            collector = build_collector(db, request)
        except CollectorError as error:
            fail_run(db, run, now=now, code=error.failure.code.value, summary=error.failure.message)
            refresh_batch(db, batch, now)
            return None
        token = uuid4()
        run.status = run_transition(state, GeoRunStatus.RUNNING).value
        run.started_at = now
        run.lease_token = token
        run.lease_expires_at = now + timedelta(
            seconds=request.timeout_seconds + settings.geo_collection_finalize_grace_seconds
        )
        run.revision += 1
        refresh_batch(db, batch, now)
        return CollectionLease(request, token, versions, collector)


def authorize_send(lease: CollectionLease) -> None:
    """首个请求字节前重验当前配置与 token，原子持久化 SENT 后立即释放锁。"""
    with SessionLocal.begin() as db:
        lock_configuration(db, lease.request)
        locked = lock_run(db, lease.request.run_id)
        if locked is None:
            raise LeaseLost()
        _, run = locked
        now = database_now(db)
        if not owns_lease(run, lease.token, now) or run.external_call_state != "NOT_STARTED":
            raise LeaseLost()
        if qualify(db, lease.request) != lease.versions:
            raise configuration_error()
        run.external_call_state = "SENT"
        run.revision += 1


def submit_collection_result(lease: CollectionLease, result: CollectedAnswer) -> bool:
    """答案/状态同一事务；0050 延迟约束禁止半提交或历史覆盖。"""
    with SessionLocal.begin() as db:
        locked = lock_run(db, lease.request.run_id)
        if locked is None:
            return False
        batch, run = locked
        now = database_now(db)
        if not owns_lease(run, lease.token, now) or run.external_call_state != "SENT":
            return False
        if (
            result.citations
            or result.raw_payload_bytes is not None
            or result.screenshot_bytes is not None
        ):
            # 405 只提交正文；引用持久化属 407，文件 adapter 尚未接线，不能静默丢弃。
            raise CollectorError(
                GeoRunErrorCode.PROVIDER_RESPONSE_INVALID,
                stage=CollectorStage.EVIDENCE,
                external_call_state=External.COMPLETED,
            )
        run.external_call_state = "COMPLETED"
        run.revision += 1
        db.flush()  # INSERT 答案守卫要求数据库已是 RUNNING/COMPLETED。
        answer = GeoAnswerSnapshot(
            run_id=run.id,
            prompt_text=lease.request.prompt_text,
            answer_text=result.answer_text,
            answer_format=result.answer_format,
            source_product=result.source_product,
            source_model=result.source_model,
            source_version=result.source_version,
            web_search_observed=result.web_search_observed,
            raw_payload_summary=result.raw_payload_summary.to_contract().model_dump(mode="json"),
            citation_count=0,
            collected_at=now,
        )
        db.add(answer)
        db.flush()
        run.status = run_transition(
            replace(run_state(db, run), has_answer=True), GeoRunStatus.COLLECTED
        ).value
        run.collected_at = now
        run.lease_token = None
        run.lease_expires_at = None
        run.revision += 1
        refresh_batch(db, batch, now)
        return True


def submit_collection_failure(lease: CollectionLease, error: CollectorError | None) -> bool:
    with SessionLocal.begin() as db:
        locked = lock_run(db, lease.request.run_id)
        if locked is None:
            return False
        batch, run = locked
        now = database_now(db)
        if not owns_lease(run, lease.token, now):
            return False
        if error is not None:
            external = error.failure.external_call_state.value
            # 回调已持久化 SENT 时，传输异常不能把事实撤回 NOT_STARTED。
            if external != "NOT_STARTED" and run.external_call_state != "COMPLETED":
                run.external_call_state = external
            code, summary = error.failure.code.value, error.failure.message
        else:
            code, summary = "WORKER_LOST", "采集执行或结果提交失败，禁止自动重发"
        fail_run(db, run, now=now, code=code, summary=summary)
        refresh_batch(db, batch, now)
        return True


def process_collection_run(run_id: UUID) -> None:
    lease = claim_collection_run(run_id)
    if lease is None:
        return
    try:
        result = lease.collector.collect(lease.request, before_send=lambda: authorize_send(lease))
        submit_collection_result(lease, result)
    except LeaseLost:
        logger.info("GEO 采集租约失效 run_id=%s", run_id)
    except CollectorError as error:
        submit_collection_failure(lease, error)
        logger.warning("GEO 采集失败 run_id=%s code=%s", run_id, error.failure.code.value)
    except Exception as error:
        # 不打印异常正文或 traceback，供应商内容和凭据不能进入 Celery 日志。
        submit_collection_failure(lease, None)
        logger.error("GEO 采集执行失败 run_id=%s error_type=%s", run_id, type(error).__name__)
