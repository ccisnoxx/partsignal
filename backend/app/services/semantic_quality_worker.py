"""Slice 3B：Layer 2 异步 AI 语义质量检查 Worker 执行与租约恢复。"""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, Protocol

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.errors import AppError
from app.models.ai_generation import AIChannel, AIModel
from app.models.content import ContentVersion
from app.models.content_quality import ContentQualityCheckJob
from app.models.product_facts import FactVersion, Product
from app.schemas.content_quality import SemanticQualityModelResult
from app.services.ai_configuration import (
    build_snapshot_request_headers,
    request_credentials,
    require_supported_protocol,
)
from app.services.ai_provider import AIProvider, ChatCompletionResult
from app.services.cost_accounting import compute_frozen_ai_cost
from app.services.generation import (
    ensure_generation_sources_public,
    require_business_generation_enabled,
)

logger = logging.getLogger("partsignal.worker")


class SemanticQualityEvaluator(Protocol):
    """仅限测试注入的语义质量评估器协议。"""

    def evaluate(
        self, snapshot: dict[str, Any]
    ) -> tuple[SemanticQualityModelResult, ChatCompletionResult | None]: ...


def _require_test_evaluator(evaluator: SemanticQualityEvaluator | None) -> None:
    if evaluator is not None and settings.environment != "test":
        raise AppError("TEST_ONLY_DEPENDENCY", "仅测试环境允许注入语义质量评估替身", 500)


def _snapshot_timeout_seconds(snapshot: dict[str, Any]) -> int:
    raw = snapshot.get("channel", {}).get("timeout_seconds")
    if not isinstance(raw, int) or isinstance(raw, bool) or not 10 <= raw <= 600:
        raise AppError("GENERATION_SNAPSHOT_INVALID", "语义质量检查作业快照超时配置无效", 409)
    return raw


def _execute_semantic_model_call(
    db: Session,
    job: ContentQualityCheckJob,
    evaluator: SemanticQualityEvaluator | None,
) -> tuple[SemanticQualityModelResult, ChatCompletionResult | None]:
    snapshot = job.input_snapshot
    if snapshot.get("fact_version", {}).get("classification") != "PUBLIC":
        raise AppError("AI_EGRESS_FORBIDDEN", "非 PUBLIC 产品事实禁止外发至外部 AI 模型", 409)
    # 实时复核数据库权威状态，防止排队期间事实退役、产品停用或版本被放弃后仍外发。
    content = db.get(ContentVersion, job.content_version_id)
    if content is None or content.status == "ABANDONED":
        raise AppError("INVALID_STATE_TRANSITION", "目标内容版本已不存在或已放弃", 409)
    fact = db.get(FactVersion, content.fact_version_id)
    product = db.get(Product, fact.product_id) if fact is not None else None
    if (
        fact is None
        or fact.status != "APPROVED"
        or product is None
        or product.status != "ACTIVE"
    ):
        raise AppError("FACT_NOT_APPROVED", "内容绑定的已批准事实或产品已失效", 409)
    ensure_generation_sources_public(fact)

    if evaluator is not None:
        db.rollback()
        return evaluator.evaluate(snapshot)
    require_business_generation_enabled()
    channel = db.get(AIChannel, job.ai_channel_id) if job.ai_channel_id else None
    model = db.get(AIModel, job.ai_model_id) if job.ai_model_id else None
    if channel is None or model is None:
        raise AppError("AI_CONFIGURATION_DELETED", "作业关联的渠道或模型已删除", 409)
    if not channel.is_enabled or not model.is_enabled or model.test_status != "PASSED":
        raise AppError("AI_CONFIGURATION_DISABLED", "作业关联的渠道或模型当前不可用", 409)
    require_supported_protocol(channel.protocol_type)
    if channel.protocol_type != snapshot.get("adapter_name"):
        raise AppError("AI_CONFIGURATION_CHANGED", "作业快照协议与当前渠道不一致", 409)
    if (
        str(channel.id) != snapshot.get("channel", {}).get("id")
        or str(model.id) != snapshot.get("model", {}).get("id")
    ):
        raise AppError("GENERATION_SNAPSHOT_INVALID", "作业配置引用与快照不一致", 409)
    timeout_seconds = _snapshot_timeout_seconds(snapshot)
    sensitive_header_names = list(snapshot["channel"].get("sensitive_header_names", []))
    api_key, current_headers = request_credentials(
        db,
        channel,
        sensitive_header_names=sensitive_header_names,
    )
    headers = build_snapshot_request_headers(
        dict(snapshot["channel"].get("plain_headers", {})),
        sensitive_header_names,
        current_headers,
    )
    base_url = str(snapshot["channel"]["base_url"])
    model_id = str(snapshot["model"]["model_id"])
    request_parameters = dict(snapshot["model"]["request_parameters"])
    system_message = str(snapshot["system_message"])
    user_message = str(snapshot["user_message"])
    # 外部 HTTP 调用前释放只读事务，避免慢响应期间长期 idle in transaction。
    db.rollback()
    result = AIProvider(allow_local_http=settings.ai_allow_local_http).chat_completion(
        base_url=base_url,
        api_key=api_key,
        headers=headers,
        timeout_seconds=timeout_seconds,
        model_id=model_id,
        request_parameters=request_parameters,
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_message},
        ],
    )
    try:
        parsed = json.loads(result.content)
        validated = SemanticQualityModelResult.model_validate(parsed)
    except (json.JSONDecodeError, ValidationError):
        raise AppError(
            "AI_RESPONSE_INVALID",
            "语义质量检查响应不符合严格 JSON Schema",
            502,
        ) from None
    return validated, result


def process_semantic_quality_check_job(
    job_id: uuid.UUID,
    evaluator: SemanticQualityEvaluator | None = None,
    *,
    session_factory: Callable[[], Session] | None = None,
) -> None:
    """在独立事务周期中执行单次语义质量检查并落库不可变终态。"""
    _require_test_evaluator(evaluator)
    factory = session_factory or SessionLocal
    with factory() as db:
        job = db.scalar(
            select(ContentQualityCheckJob)
            .where(ContentQualityCheckJob.id == job_id)
            .with_for_update()
        )
        if job is None or job.status != "PENDING":
            return
        now = datetime.now(UTC)
        try:
            timeout_seconds = _snapshot_timeout_seconds(job.input_snapshot)
        except AppError as error:
            job.status = "FAILED"
            job.error_code = error.code
            job.error_summary = error.message
            job.lease_expires_at = None
            job.finished_at = now
            db.commit()
            return
        job.status = "RUNNING"
        job.started_at = now
        job.lease_expires_at = now + timedelta(
            seconds=timeout_seconds + settings.generation_finalize_grace_seconds
        )
        db.commit()

        started_perf = time.monotonic()
        try:
            validated, completion = _execute_semantic_model_call(db, job, evaluator)
            duration_ms = (
                completion.duration_ms
                if completion is not None
                else max(0, int((time.monotonic() - started_perf) * 1000))
            )
            db.expire_all()
            job = db.scalar(
                select(ContentQualityCheckJob)
                .where(ContentQualityCheckJob.id == job_id)
                .with_for_update()
            )
            if job is None or job.status != "RUNNING":
                return
            cost_amount: Decimal | None = None
            cost_currency: str | None = None
            if completion is not None:
                model = db.get(AIModel, job.ai_model_id) if job.ai_model_id is not None else None
                cost_amount, cost_currency = compute_frozen_ai_cost(
                    model,
                    prompt_tokens=completion.prompt_tokens,
                    completion_tokens=completion.completion_tokens,
                )
            job.status = "SUCCEEDED"
            job.findings = [item.model_dump(mode="json") for item in validated.findings]
            job.differentiation_suggestions = [
                item.strip() for item in validated.differentiation_suggestions if item.strip()
            ][:10]
            if completion is not None:
                job.prompt_tokens = completion.prompt_tokens
                job.completion_tokens = completion.completion_tokens
                job.total_tokens = completion.total_tokens
                job.cost_amount = cost_amount
                job.cost_currency = cost_currency
            job.response_duration_ms = duration_ms
            job.lease_expires_at = None
            job.finished_at = datetime.now(UTC)
            db.commit()
        except Exception as error:  # noqa: BLE001 - 外部 AI 失败统一写入显式终态
            db.rollback()
            job = db.scalar(
                select(ContentQualityCheckJob)
                .where(ContentQualityCheckJob.id == job_id)
                .with_for_update()
            )
            if job is None or job.status != "RUNNING":
                return
            job.status = "FAILED"
            job.error_code = error.code if isinstance(error, AppError) else "SEMANTIC_CHECK_FAILED"
            job.error_summary = (
                error.message if isinstance(error, AppError) else "AI 语义质量检查执行失败"
            )
            job.lease_expires_at = None
            job.finished_at = datetime.now(UTC)
            db.commit()
            logger.error("语义质量检查失败 job_id=%s error_code=%s", job.id, job.error_code)


def fail_expired_semantic_quality_check_jobs() -> int:
    """将过期租约的 RUNNING 语义检查作业标记为 FAILED，防止无限挂起。"""
    now = datetime.now(UTC)
    with SessionLocal() as db:
        expired = list(
            db.scalars(
                select(ContentQualityCheckJob)
                .where(
                    ContentQualityCheckJob.status == "RUNNING",
                    ContentQualityCheckJob.lease_expires_at.is_not(None),
                    ContentQualityCheckJob.lease_expires_at <= now,
                )
                .order_by(ContentQualityCheckJob.lease_expires_at, ContentQualityCheckJob.id)
                .limit(50)
                .with_for_update(skip_locked=True)
            )
        )
        for job in expired:
            job.status = "FAILED"
            job.error_code = "SEMANTIC_CHECK_LEASE_EXPIRED"
            job.error_summary = "语义质量检查执行超时，租约已过期"
            job.lease_expires_at = None
            job.finished_at = now
        if expired:
            db.commit()
        return len(expired)


def redispatch_pending_semantic_quality_check_jobs(dispatch: Callable[[str], Any]) -> int:
    """补投递滞留的 PENDING 语义检查作业（单条异常隔离，Redis 仍仅传递 UUID）。"""
    cutoff = datetime.now(UTC) - timedelta(seconds=settings.generation_pending_redispatch_seconds)
    with SessionLocal() as db:
        pending_ids = list(
            db.scalars(
                select(ContentQualityCheckJob.id)
                .where(
                    ContentQualityCheckJob.status == "PENDING",
                    ContentQualityCheckJob.created_at <= cutoff,
                )
                .order_by(ContentQualityCheckJob.created_at, ContentQualityCheckJob.id)
                .limit(50)
            )
        )
    dispatched = 0
    for job_id in pending_ids:
        try:
            dispatch(str(job_id))
            dispatched += 1
        except Exception:  # noqa: BLE001 - 单条 Broker 失败不阻断其余作业补投递
            logger.warning("补投递语义质量检查作业失败 job_id=%s", job_id)
    return dispatched
