"""Slice 3B：Layer 2 可选异步 AI 语义质量检查命令与读模型。"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Callable
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.ai_generation import AIChannel, AIModel
from app.models.content import ContentBriefSnapshot, ContentTask, ContentVersion
from app.models.content_quality import ContentQualityCheckJob
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.schemas.common import AccountType
from app.schemas.content_quality import (
    SemanticQualityCheckCreate,
    SemanticQualityCheckJobList,
    SemanticQualityCheckJobOut,
    SemanticQualityFinding,
    SemanticQualityJobStatus,
)
from app.services.ai_configuration import require_supported_protocol
from app.services.content_duplication import analyze_content_duplication
from app.services.content_task_queries import generation_model_options
from app.services.current_actor import current_actor_command
from app.services.generation import (
    ensure_generation_sources_public,
    require_business_generation_enabled,
)

logger = logging.getLogger("partsignal.worker")

SEMANTIC_QUALITY_CONTRACT_VERSION = "content-semantic-quality-v1"


def semantic_quality_job_out(job: ContentQualityCheckJob) -> SemanticQualityCheckJobOut:
    snapshot = job.input_snapshot if isinstance(job.input_snapshot, dict) else {}
    raw_rev = snapshot.get("content_revision")
    raw_hash = snapshot.get("content_hash")
    return SemanticQualityCheckJobOut(
        id=job.id,
        content_version_id=job.content_version_id,
        content_task_id=job.content_task_id,
        content_revision=(
            raw_rev if isinstance(raw_rev, int) and not isinstance(raw_rev, bool) else None
        ),
        content_hash=raw_hash if isinstance(raw_hash, str) else None,
        status=cast(SemanticQualityJobStatus, job.status),
        ai_model_id=job.ai_model_id,
        adapter_name=job.adapter_name,
        findings=[SemanticQualityFinding.model_validate(item) for item in (job.findings or [])],
        differentiation_suggestions=list(job.differentiation_suggestions or []),
        prompt_tokens=job.prompt_tokens,
        completion_tokens=job.completion_tokens,
        total_tokens=job.total_tokens,
        response_duration_ms=job.response_duration_ms,
        error_code=job.error_code,
        error_summary=job.error_summary,
        created_by=job.created_by,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


def list_semantic_quality_check_jobs(
    db: Session, content_version_id: uuid.UUID
) -> SemanticQualityCheckJobList:
    """读取目标内容版本的异步语义质量检查历史与独立可用模型列表（单次 REPEATABLE READ 快照）。"""
    if db.get(ContentVersion, content_version_id) is None:
        raise not_found("内容版本")
    jobs = list(
        db.scalars(
            select(ContentQualityCheckJob)
            .where(ContentQualityCheckJob.content_version_id == content_version_id)
            .order_by(ContentQualityCheckJob.created_at.desc(), ContentQualityCheckJob.id.desc())
            .limit(20)
        )
    )
    return SemanticQualityCheckJobList(
        content_version_id=content_version_id,
        items=[semantic_quality_job_out(job) for job in jobs],
        available_models=generation_model_options(db),
    )


def _build_public_semantic_snapshot(
    *,
    db: Session,
    task: ContentTask,
    content: ContentVersion,
    fact: FactVersion,
    product: Product,
    channel: AIChannel,
    model: AIModel,
) -> dict[str, Any]:
    """构建严格仅含 PUBLIC 信息的语义质量核查快照，绝不包含 source_owner/source_reference。"""
    ensure_generation_sources_public(fact)
    brief = db.get(ContentBriefSnapshot, task.id)
    # 外发至第三方模型时严格限定仅对比 PUBLIC 事实支撑的兄弟内容，杜绝泄露非 PUBLIC 标题。
    duplication = analyze_content_duplication(
        db, content_version_id=content.id, public_only=True
    )

    system_message = "\n".join(
        [
            "你是电子元器件 GEO 内容运营质量评审专家。",
            "请仅根据提供的已批准 PUBLIC 产品事实、内容 Brief 与同活动/同产品公开摘要，审查：",
            "1. 超出已批准事实边界的虚构参数、认证或绝对化替代结论（BLOCKING）；",
            "2. 未充分回应 Brief 核心问题或与已有公开内容语义同质化严重的问题（WARNING）；",
            "3. 可提升检索清晰度、结构与差异化表达的优化建议（INFORMATION）。",
            '必须仅返回单个 JSON 对象：{"findings": [{"code": "...", "severity": '
            '"BLOCKING|WARNING|INFORMATION", "message": "...", "suggestion": "..."}], '
            '"differentiation_suggestions": ["..."]}。',
        ]
    )
    user_parts = [
        (
            f"## 产品标识\n品牌：{product.brand}｜型号：{product.part_number}｜"
            f"分类：{product.category}"
        ),
        f"## 已批准 PUBLIC 产品事实\n{fact.body_markdown}",
    ]
    if fact.approved_claims_summary:
        user_parts.append(f"## 已批准核心公开结论\n{fact.approved_claims_summary}")
    if fact.content_restrictions:
        user_parts.append(f"## 公开表达禁用边界\n{fact.content_restrictions}")
    if brief is not None:
        user_parts.append(
            "## 内容 Brief\n"
            + json.dumps(
                {
                    "target_question": brief.target_question,
                    "search_intent": brief.search_intent,
                    "content_angle": brief.content_angle,
                    "must_answer_questions": list(brief.must_answer_questions),
                    "required_fact_points": list(brief.required_fact_points),
                    "forbidden_expressions": list(brief.forbidden_expressions),
                    "target_keywords": list(brief.target_keywords),
                    "cta": brief.cta,
                },
                ensure_ascii=False,
                sort_keys=True,
            )
        )
    user_parts.append(
        "## 待评审内容版本\n"
        + json.dumps(
            {
                "version": content.version,
                "title": content.title,
                "summary": content.summary,
                "tags": list(content.tags),
                "body_markdown": content.body_markdown,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    if duplication.similar_contents:
        user_parts.append(
            "## 同活动/同产品高相似公开内容摘要\n"
            + json.dumps(
                [
                    {
                        "platform_name": item.platform_name,
                        "same_campaign": item.same_campaign,
                        "title": item.title,
                        "similarity": item.similarity,
                    }
                    for item in duplication.similar_contents[:3]
                ],
                ensure_ascii=False,
                sort_keys=True,
            )
        )

    return {
        "contract_version": SEMANTIC_QUALITY_CONTRACT_VERSION,
        "adapter_name": require_supported_protocol(channel.protocol_type),
        "channel": {
            "id": str(channel.id),
            "name": channel.name,
            "protocol_type": channel.protocol_type,
            "provider_brand": channel.provider_brand,
            "base_url": channel.base_url,
            "timeout_seconds": channel.timeout_seconds,
            "plain_headers": {
                item.name: item.plain_value
                for item in channel.headers
                if not item.is_sensitive and item.plain_value is not None
            },
            "sensitive_header_names": [item.name for item in channel.headers if item.is_sensitive],
        },
        "model": {
            "id": str(model.id),
            "display_name": model.display_name,
            "model_id": model.model_id,
            "request_parameters": model.request_parameters,
        },
        "fact_version": {
            "id": str(fact.id),
            "product_id": str(fact.product_id),
            "version": fact.version,
            "classification": fact.classification,
        },
        "content_version_id": str(content.id),
        "content_revision": content.revision,
        "content_hash": content.content_hash,
        "system_message": system_message,
        "user_message": "\n\n".join(user_parts),
    }


def _dispatch_semantic_check(job_id: uuid.UUID) -> None:
    """在 PostgreSQL 提交后向 Celery 投递只含 UUID 的语义质检任务。"""
    from app.worker import run_semantic_quality_check

    try:
        run_semantic_quality_check.delay(str(job_id))
    except Exception:  # noqa: BLE001 - Redis 不可用由后台补投递扫表恢复，不回滚已落库作业
        logger.warning("投递语义质量检查作业到 Redis 失败 job_id=%s", job_id)


def create_semantic_quality_check_job(
    *,
    db: Session,
    content_version_id: uuid.UUID,
    payload: SemanticQualityCheckCreate,
    actor: User,
    request_id: str,
    idempotency_key: str,
    dispatch: Callable[[uuid.UUID], None] | None = None,
) -> SemanticQualityCheckJobOut:
    """创建幂等、PUBLIC 外发受控的异步 AI 语义质量检查作业。"""
    require_business_generation_enabled()
    with current_actor_command(
        db, actor, allowed=(AccountType.ADMIN, AccountType.ENGINEER)
    ) as current_actor:
        task_id = db.scalar(
            select(ContentVersion.task_id).where(ContentVersion.id == content_version_id)
        )
        if task_id is None:
            raise not_found("内容版本")
        task = db.scalar(
            select(ContentTask)
            .where(ContentTask.id == task_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        content = db.scalar(
            select(ContentVersion)
            .where(ContentVersion.id == content_version_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        if task is None or content is None:
            raise not_found("内容版本")

        existing = db.scalar(
            select(ContentQualityCheckJob).where(
                ContentQualityCheckJob.idempotency_key == idempotency_key
            )
        )
        if existing is not None:
            if (
                existing.content_version_id != content.id
                or existing.ai_model_id != payload.ai_model_id
            ):
                raise AppError("IDEMPOTENCY_CONFLICT", "幂等键已绑定到不同的语义检查请求", 409)
            return semantic_quality_job_out(existing)

        if content.status == "ABANDONED":
            raise AppError("INVALID_STATE_TRANSITION", "已放弃的内容版本不能触发语义质量检查", 409)

        fact = db.get(FactVersion, content.fact_version_id)
        product = db.get(Product, task.product_id)
        if (
            fact is None
            or fact.status != "APPROVED"
            or product is None
            or product.status != "ACTIVE"
        ):
            raise AppError("FACT_NOT_APPROVED", "内容绑定的已批准产品事实或产品已失效", 409)
        ensure_generation_sources_public(fact)

        model = db.get(AIModel, payload.ai_model_id)
        if model is None:
            raise not_found("AI 模型")
        channel = db.get(AIChannel, model.channel_id)
        if channel is None or not channel.is_enabled:
            raise AppError("AI_CONFIGURATION_DISABLED", "所选 AI 渠道当前不可用", 409)
        if not model.is_enabled or model.test_status != "PASSED":
            raise AppError("AI_MODEL_NOT_TESTED", "所选 AI 模型未启用或未通过测试", 409)
        adapter_name = require_supported_protocol(channel.protocol_type)

        active = db.scalar(
            select(ContentQualityCheckJob.id).where(
                ContentQualityCheckJob.content_version_id == content.id,
                ContentQualityCheckJob.status.in_(("PENDING", "RUNNING")),
            )
        )
        if active is not None:
            raise AppError(
                "SEMANTIC_QUALITY_CHECK_ACTIVE",
                "该内容版本已有正在执行的 AI 语义质量检查作业",
                409,
            )

        snapshot = _build_public_semantic_snapshot(
            db=db,
            task=task,
            content=content,
            fact=fact,
            product=product,
            channel=channel,
            model=model,
        )
        job = ContentQualityCheckJob(
            content_version_id=content.id,
            content_task_id=task.id,
            idempotency_key=idempotency_key,
            status="PENDING",
            ai_channel_id=channel.id,
            ai_model_id=model.id,
            adapter_name=adapter_name,
            input_snapshot=snapshot,
            created_by=current_actor.id,
        )
        try:
            db.add(job)
            db.flush()
            append_audit(
                db,
                AuditEntry(
                    actor_id=current_actor.id,
                    business_module=AuditModule.CONTENT_PRODUCTION,
                    action="content_quality_check.requested",
                    target_type="ContentQualityCheckJob",
                    target_id=job.id,
                    request_id=request_id,
                    outcome=AuditOutcome.SUCCESS,
                    result_message="已发起内容 AI 语义质量检查作业",
                    details={
                        "facts": {
                            "content_version_id": str(content.id),
                            "task_id": str(task.id),
                            "model_id": str(model.id),
                        }
                    },
                ),
            )
            db.commit()
        except IntegrityError as error:
            db.rollback()
            constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
            if constraint == "uq_content_quality_check_jobs_idempotency_key":
                raced = db.scalar(
                    select(ContentQualityCheckJob).where(
                        ContentQualityCheckJob.idempotency_key == idempotency_key
                    )
                )
                if raced is not None:
                    if (
                        raced.content_version_id != content_version_id
                        or raced.ai_model_id != payload.ai_model_id
                    ):
                        raise AppError(
                            "IDEMPOTENCY_CONFLICT",
                            "幂等键已绑定到不同的语义检查请求",
                            409,
                        ) from error
                    return semantic_quality_job_out(raced)
            if constraint == "uq_content_quality_check_jobs_active_version":
                raise AppError(
                    "SEMANTIC_QUALITY_CHECK_ACTIVE",
                    "该内容版本已有正在执行的 AI 语义质量检查作业",
                    409,
                ) from error
            raise

    dispatcher = dispatch or _dispatch_semantic_check
    dispatcher(job.id)
    return semantic_quality_job_out(job)
