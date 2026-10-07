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
from app.models.geo_answers import GeoAnswerCitation, GeoAnswerSnapshot
from app.models.geo_runs import GeoObservationRun
from app.schemas.geo_answers import GeoAnswerCitationInput
from app.schemas.geo_runs import GeoExternalCallState as External
from app.schemas.geo_runs import GeoRunErrorCode, GeoRunInputSnapshot, GeoRunStatus
from app.services import geo_collection_admission as admission
from app.services.geo_answer_citations import prepare_answer_citations
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
        admission.lock_accounting(db)
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
            versions = qualify(db, request)
            channel = db.get(AIChannel, request.profile.ai_channel_id)
            assert channel is not None
            request = replace(request, timeout_seconds=channel.timeout_seconds)
            collector = build_collector(db, request)
            admission.require_profile_capacity(db, request, now)
            estimate = collector.estimate(request).cost
            remaining = admission.require_budget(db, batch, run, estimate, now)
            request = replace(request, budget_remaining=remaining)
        except admission.ProfileThrottled:
            return None
        except admission.BudgetExceeded:
            run.status = run_transition(state, GeoRunStatus.BUDGET_BLOCKED).value
            run.error_stage = "COLLECTION"
            run.error_code = "BUDGET_EXCEEDED"
            run.error_summary = "预算不足、费用未知或币种不一致，禁止外部采集"
            run.finished_at = now
            run.revision += 1
            refresh_batch(db, batch, now)
            return None
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
        admission.reserve(db, run, estimate, now)
        refresh_batch(db, batch, now)
        return CollectionLease(request, token, versions, collector)


def authorize_send(lease: CollectionLease) -> None:
    """首个请求字节前重验当前配置与 token，原子持久化 SENT 后立即释放锁。"""
    with SessionLocal.begin() as db:
        lock_configuration(db, lease.request)
        admission.lock_accounting(db)
        locked = lock_run(db, lease.request.run_id)
        if locked is None:
            raise LeaseLost()
        batch, run = locked
        now = database_now(db)
        if not owns_lease(run, lease.token, now) or run.external_call_state != "NOT_STARTED":
            raise LeaseLost()
        if qualify(db, lease.request) != lease.versions:
            raise configuration_error()
        admission.require_send_capacity(db, lease.request, now)
        admission.authorize(db, batch, run, now)
        run.external_call_state = "SENT"
        run.revision += 1


def submit_collection_result(lease: CollectionLease, result: CollectedAnswer) -> bool:
    """答案/状态同一事务；0050 延迟约束禁止半提交或历史覆盖。"""
    with SessionLocal.begin() as db:
        admission.lock_accounting(db)
        locked = lock_run(db, lease.request.run_id)
        if locked is None:
            return False
        batch, run = locked
        now = database_now(db)
        if not owns_lease(run, lease.token, now) or run.external_call_state != "SENT":
            return False
        if result.raw_payload_bytes is not None or result.screenshot_bytes is not None:
            # 当前 API adapter 无文件产物；未接线 bytes 不能静默丢弃。
            raise CollectorError(
                GeoRunErrorCode.PROVIDER_RESPONSE_INVALID,
                stage=CollectorStage.EVIDENCE,
                external_call_state=External.COMPLETED,
            )
        run.external_call_state = "COMPLETED"
        run.provider_request_id = result.provider_request_id
        run.duration_ms = result.duration_ms
        run.cost_amount = result.cost.amount if result.cost is not None else None
        run.cost_currency = result.cost.currency if result.cost is not None else None
        run.prompt_tokens = result.usage.prompt_tokens if result.usage is not None else None
        run.completion_tokens = result.usage.completion_tokens if result.usage is not None else None
        run.total_tokens = result.usage.total_tokens if result.usage is not None else None
        run.revision += 1
        db.flush()  # INSERT 答案守卫要求数据库已是 RUNNING/COMPLETED。
        citations = prepare_answer_citations(
            [
                GeoAnswerCitationInput(
                    original_url=c.url,
                    title=c.title,
                    position=c.position,
                    extraction_source=c.extraction_source,
                )
                for c in result.citations
            ]
        )
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
            citation_count=len(citations),
            collected_at=now,
        )
        db.add(answer)
        db.flush()
        for citation in citations:
            db.add(
                GeoAnswerCitation(
                    answer_snapshot_id=answer.id,
                    original_url=citation.original_url,
                    normalized_url=citation.normalized_url,
                    hostname=citation.hostname,
                    title=citation.title,
                    position=citation.position,
                    occurrences=list(citation.occurrences),
                    extraction_source=citation.extraction_source,
                )
            )
        db.flush()  # 0050 要求引用在状态推进前与答案一起写入。
        run.status = run_transition(
            replace(run_state(db, run), has_answer=True), GeoRunStatus.COLLECTED
        ).value
        run.collected_at = now
        run.lease_token = None
        run.lease_expires_at = None
        run.revision += 1
        admission.settle(db, run, now)
        refresh_batch(db, batch, now)
        return True


def submit_collection_failure(
    lease: CollectionLease,
    error: CollectorError | None,
    *,
    result_received: bool = False,
    budget_denied: bool = False,
) -> bool:
    with SessionLocal.begin() as db:
        admission.lock_accounting(db)
        locked = lock_run(db, lease.request.run_id)
        if locked is None:
            return False
        batch, run = locked
        now = database_now(db)
        if not owns_lease(run, lease.token, now):
            return False
        reported = error.failure.external_call_state.value if error is not None else None
        code, summary = (
            (error.failure.code.value, error.failure.message)
            if error is not None
            else ("WORKER_LOST", "采集执行或结果提交失败，禁止自动重发")
        )
        if budget_denied:
            code, summary = "BUDGET_EXCEEDED", "发送前预算不足、费用未知或币种不一致"
        if result_received or reported == "COMPLETED":
            run.external_call_state = "COMPLETED"
        elif run.external_call_state == "SENT" and reported in {None, "NOT_STARTED", "UNKNOWN"}:
            # SENT 授权已提交但未证实完整接收，包括首字节前崩溃窗口。
            run.external_call_state = "UNKNOWN"
            code, summary = "COLLECTOR_UNKNOWN_OUTCOME", "外部采集结果未知，必须显式创建新尝试"
        elif run.external_call_state not in {"UNKNOWN", "COMPLETED"} and reported is not None:
            run.external_call_state = reported
        if error is not None:
            run.provider_status = error.failure.provider_status
            run.retry_after_seconds = error.failure.retry_after_seconds
        fail_run(db, run, now=now, code=code, summary=summary)
        admission.settle(db, run, now)
        refresh_batch(db, batch, now)
        return True


def process_collection_run(run_id: UUID) -> None:
    lease = claim_collection_run(run_id)
    if lease is None:
        return
    result_received = False
    try:
        result = lease.collector.collect(lease.request, before_send=lambda: authorize_send(lease))
        result_received = True
        submit_collection_result(lease, result)
    except LeaseLost:
        logger.info("GEO 采集租约失效 run_id=%s", run_id)
    except admission.BudgetExceeded:
        submit_collection_failure(lease, None, budget_denied=True)
    except admission.ProfileThrottled:
        submit_collection_failure(lease, configuration_error(GeoRunErrorCode.PROVIDER_RATE_LIMITED))
    except CollectorError as error:
        submit_collection_failure(lease, error)
        logger.warning("GEO 采集失败 run_id=%s code=%s", run_id, error.failure.code.value)
    except Exception as error:
        # 不打印异常正文或 traceback，供应商内容和凭据不能进入 Celery 日志。
        submit_collection_failure(lease, None, result_received=result_received)
        logger.error("GEO 采集执行失败 run_id=%s error_type=%s", run_id, type(error).__name__)
