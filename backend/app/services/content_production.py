"""生成快照、幂等作业、重试和人工内容修订的应用服务。"""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.config import settings
from app.errors import AppError, not_found
from app.models.ai_generation import (
    AIChannel,
    AIModel,
    GenerationJob,
)
from app.models.configuration import (
    PlatformProfile,
    PlatformProfileVersion,
    PlatformPrompt,
    QueryTopic,
)
from app.models.content import (
    ContentTask,
    ContentVersion,
)
from app.models.identity import User
from app.models.product_facts import (
    FactVersion,
    Product,
)
from app.schemas.content import (
    ContentRevisionCreate,
    GenerationJobCreate,
    GenerationSnapshot,
)
from app.schemas.geo_files import GeneratedDraft
from app.schemas.product_facts import ProductFactsBody
from app.services.generation import (
    FIXED_SYSTEM_CONTRACT,
    GENERATION_CONTRACT_VERSION,
    DevelopmentContentGenerator,
    add_near_duplicate_warning,
    content_hash,
    ensure_generation_sources_public,
    ensure_third_party_egress_allowed,
    process_generation_job,
    run_quality_checks,
)
from app.services.generation_dispatch import dispatch_generation_job
from app.worker import generate_content


def source_generation_input(db: Session, content: ContentVersion) -> dict[str, Any]:
    """沿不可变修订链定位原始生成快照，避免读取漂移后的当前配置。"""
    current = content
    while True:
        if current.source_job_id is not None:
            job = db.get(GenerationJob, current.source_job_id)
            if job is None:
                raise AppError("GENERATION_SNAPSHOT_INVALID", "内容源作业不存在", 409)
            GenerationSnapshot.model_validate(job.input_snapshot)
            return job.input_snapshot
        if current.based_on_id is None:
            raise AppError("GENERATION_SNAPSHOT_INVALID", "内容版本缺少源生成快照", 409)
        parent = db.get(ContentVersion, current.based_on_id)
        if parent is None:
            raise AppError("GENERATION_SNAPSHOT_INVALID", "内容修订链不完整", 409)
        current = parent


def build_generation_input(
    db: Session, task: ContentTask, model: AIModel
) -> dict[str, Any]:
    """从服务端权威数据构造不含凭据和证据文档的不可变快照。"""
    fact = db.get(FactVersion, task.fact_version_id)
    if fact is None or fact.status != "APPROVED":
        raise AppError("FACT_NOT_APPROVED", "任务绑定的事实版本不再可用于生成", 409)
    product = db.get(Product, task.product_id)
    if product is None or product.status != "ACTIVE":
        raise AppError("FACT_NOT_APPROVED", "产品已停用，不能生成新内容", 409)
    platform = db.get(PlatformProfileVersion, task.platform_profile_version_id)
    if platform is None or platform.status not in {"ACTIVE", "RETIRED"}:
        raise AppError("INVALID_STATE_TRANSITION", "任务绑定的平台规则不是已激活版本", 409)
    topic = db.get(QueryTopic, task.query_topic_id)
    if topic is None:
        raise not_found("目标问题")
    if task.platform_type_id is None or task.platform_type_snapshot is None:
        raise AppError("PLATFORM_TYPE_MISSING", "内容任务没有锁定平台类型", 409)
    profile = db.get(PlatformProfile, platform.platform_profile_id)
    if profile is None:
        raise AppError("INVALID_STATE_TRANSITION", "任务绑定的平台不存在", 409)
    prompt = db.get(PlatformPrompt, profile.id)
    if prompt is None:
        raise AppError("PLATFORM_PROMPT_MISSING", "任务平台缺少当前 Prompt", 409)
    channel = db.get(AIChannel, model.channel_id)
    if channel is None or not channel.is_enabled:
        raise AppError("AI_CONFIGURATION_DISABLED", "所选 AI 渠道当前不可用", 409)
    if not model.is_enabled or model.test_status != "PASSED":
        raise AppError("AI_MODEL_NOT_TESTED", "所选 AI 模型未启用或未通过测试", 409)
    if not task.user_prompt_markdown.strip():
        raise AppError("USER_PROMPT_REQUIRED", "生成前必须填写工程师 Prompt", 409)
    facts = ProductFactsBody.model_validate(fact.snapshot_json)
    adapter_name = (
        DevelopmentContentGenerator.name
        if settings.content_generator == "deterministic"
        else "openai-compatible-chat-completions"
    )
    if adapter_name == "openai-compatible-chat-completions":
        ensure_generation_sources_public(task, facts)
    approved_facts = {
        "fact_version_id": str(fact.id),
        "reference_parts": [item.model_dump(mode="json") for item in facts.reference_parts],
        "parameters": [
            item.model_dump(mode="json", exclude={"evidence_keys"}) for item in facts.parameters
        ],
        "replacement_relations": [
            item.model_dump(mode="json", exclude={"evidence_keys"})
            for item in facts.replacement_relations
        ],
        "claims": [{"type": item.type.value, "text": item.text} for item in facts.claims],
        "evidence_confidentialities": [
            evidence.confidentiality.value for evidence in facts.evidences
        ],
    }
    requirements = {
        "product": {
            "id": str(product.id),
            "part_number": product.part_number,
            "brand": product.brand,
            "category": product.category,
        },
        "query_topic": {
            "id": str(topic.id),
            "canonical_question": topic.canonical_question,
            "intent_type": topic.intent_type,
            "variants": topic.variants,
        },
        "platform_rules": platform.rules,
        "task": {
            "id": str(task.id),
            "target_audience": task.target_audience,
            "content_angle": task.content_angle,
            "conversion_goal": task.conversion_goal,
            "desired_format": task.desired_format,
            "desired_length_min": task.desired_length_min,
            "desired_length_max": task.desired_length_max,
            "canonical_url": task.canonical_url,
        },
    }
    system_message = f"{FIXED_SYSTEM_CONTRACT}\n\n{prompt.template_markdown}"
    user_message = "\n\n".join(
        [
            "## 工程师输入\n" + task.user_prompt_markdown,
            "## 已批准事实（只读）\n"
            + json.dumps(approved_facts, ensure_ascii=False, sort_keys=True),
            "## 任务要求\n" + json.dumps(requirements, ensure_ascii=False, sort_keys=True),
        ]
    )
    return GenerationSnapshot(
        adapter_name=adapter_name,
        contract_version=GENERATION_CONTRACT_VERSION,
        channel={
            "id": str(channel.id),
            "name": channel.name,
            "base_url": channel.base_url,
            "timeout_seconds": channel.timeout_seconds,
            "plain_headers": {
                item.name: item.plain_value
                for item in channel.headers
                if not item.is_sensitive and item.plain_value is not None
            },
            "sensitive_header_names": [item.name for item in channel.headers if item.is_sensitive],
        },
        model={
            "id": str(model.id),
            "display_name": model.display_name,
            "model_id": model.model_id,
            "request_parameters": model.request_parameters,
        },
        platform_type=dict(task.platform_type_snapshot),
        platform_profile={
            "id": str(profile.id),
            "name": profile.name,
            "slug": profile.slug,
            "platform_profile_version_id": str(platform.id),
            "platform_profile_version": platform.version,
        },
        system_message=system_message,
        user_prompt_markdown=task.user_prompt_markdown,
        generation_data_classification=task.generation_data_classification,
        generation_data_classified_by=task.generation_data_classified_by,
        generation_data_classified_at=task.generation_data_classified_at,
        approved_facts=approved_facts,
        task_requirements=requirements,
        user_message=user_message,
    ).model_dump(mode="json")


def _create_job(
    *,
    db: Session,
    task: ContentTask,
    idempotency_key: str,
    actor: User,
    model: AIModel | None = None,
    retry_of: GenerationJob | None = None,
) -> tuple[GenerationJob, bool]:
    """创建幂等作业；同一键不能被另一业务请求复用。"""
    existing = db.scalar(
        select(GenerationJob).where(GenerationJob.idempotency_key == idempotency_key)
    )
    if existing is not None:
        expected_model_id = retry_of.ai_model_id if retry_of else (model.id if model else None)
        if (
            existing.content_task_id != task.id
            or existing.retry_of_id != (retry_of.id if retry_of else None)
            or existing.ai_model_id != expected_model_id
        ):
            raise AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一生成请求", 409)
        return existing, False
    if retry_of is not None:
        if retry_of.ai_channel_id is None or retry_of.ai_model_id is None:
            raise AppError("AI_CONFIGURATION_DELETED", "原作业渠道或模型已删除", 409)
        channel = db.get(AIChannel, retry_of.ai_channel_id)
        retry_model = db.get(AIModel, retry_of.ai_model_id)
        if channel is None or retry_model is None:
            raise AppError("AI_CONFIGURATION_DELETED", "原作业渠道或模型已删除", 409)
        generation_input = retry_of.input_snapshot
        ensure_third_party_egress_allowed(generation_input)
        selected_model = retry_model
    else:
        if model is None:
            raise AppError("AI_MODEL_REQUIRED", "必须选择 AI 模型", 422)
        generation_input = build_generation_input(db, task, model)
        selected_model = model
    prompt_hash = hashlib.sha256(
        json.dumps(generation_input, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    job = GenerationJob(
        content_task_id=task.id,
        idempotency_key=idempotency_key,
        input_snapshot=generation_input,
        ai_channel_id=selected_model.channel_id,
        ai_model_id=selected_model.id,
        adapter_name=str(generation_input["adapter_name"]),
        prompt_template_version=str(generation_input["contract_version"]),
        prompt_hash=prompt_hash,
        retry_of_id=retry_of.id if retry_of else None,
        created_by=actor.id,
    )
    db.add(job)
    db.flush()
    return job, True


def _dispatch_job(job: GenerationJob) -> None:
    """提交后尝试投递 UUID；Broker 故障由 PENDING 补投递恢复。"""
    if settings.generation_eager:
        process_generation_job(job.id)
        return
    dispatch_generation_job(job.id, generate_content.delay)


def create_generation_job(
    *,
    db: Session,
    content_task_id: uuid.UUID,
    payload: GenerationJobCreate,
    actor: User,
    request_id: str,
    idempotency_key: str,
) -> GenerationJob:
    """锁定 OPEN 任务，幂等创建作业并在提交后尝试投递。"""
    task = db.scalar(select(ContentTask).where(ContentTask.id == content_task_id).with_for_update())
    if task is None:
        raise not_found("内容任务")
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "只有 OPEN 内容任务可以生成草稿", 409)
    model = db.get(AIModel, payload.ai_model_id)
    if model is None:
        raise not_found("AI 模型")
    job, created = _create_job(
        db=db, task=task, idempotency_key=idempotency_key, actor=actor, model=model
    )
    if created:
        append_audit(
            db,
            actor_id=actor.id,
            action="generation_job.created",
            target_type="GenerationJob",
            target_id=job.id,
            request_id=request_id,
        )
        db.commit()
        _dispatch_job(job)
        db.refresh(job)
    return job


def retry_generation_job(
    *,
    db: Session,
    generation_job_id: uuid.UUID,
    actor: User,
    request_id: str,
    idempotency_key: str,
) -> GenerationJob:
    """只允许 FAILED 作业在 OPEN 任务上以原快照显式重试。"""
    previous = db.get(GenerationJob, generation_job_id)
    if previous is None:
        raise not_found("生成作业")
    if previous.status != "FAILED":
        raise AppError("INVALID_STATE_TRANSITION", "只有 FAILED 作业可以重试", 409)
    task = db.scalar(
        select(ContentTask).where(ContentTask.id == previous.content_task_id).with_for_update()
    )
    if task is None or task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "内容任务不可再生成", 409)
    job, created = _create_job(
        db=db, task=task, idempotency_key=idempotency_key, actor=actor, retry_of=previous
    )
    if created:
        append_audit(
            db,
            actor_id=actor.id,
            action="generation_job.retried",
            target_type="GenerationJob",
            target_id=job.id,
            request_id=request_id,
            details={"retry_of_id": str(previous.id)},
        )
        db.commit()
        _dispatch_job(job)
        db.refresh(job)
    return job


def create_content_revision(
    *,
    db: Session,
    content_version_id: uuid.UUID,
    payload: ContentRevisionCreate,
    actor: User,
    request_id: str,
) -> ContentVersion:
    """沿原始生成快照校验质量后创建不可变人工修订。"""
    source = db.get(ContentVersion, content_version_id)
    if source is None:
        raise not_found("内容版本")
    task = db.scalar(select(ContentTask).where(ContentTask.id == source.task_id).with_for_update())
    if task is None or task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态任务不能创建内容修订", 409)
    generation_input = source_generation_input(db, source)
    draft = GeneratedDraft(
        title=payload.title,
        summary=payload.summary,
        body_markdown=payload.body_markdown,
        tags=payload.tags,
    )
    quality_issues = run_quality_checks(draft, generation_input)
    add_near_duplicate_warning(db, task, draft, quality_issues)
    next_version = (
        int(
            db.scalar(
                select(func.coalesce(func.max(ContentVersion.version), 0)).where(
                    ContentVersion.task_id == source.task_id
                )
            )
            or 0
        )
        + 1
    )
    content = ContentVersion(
        task_id=source.task_id,
        fact_version_id=source.fact_version_id,
        based_on_id=source.id,
        version=next_version,
        source_type="HUMAN",
        title=payload.title,
        summary=payload.summary,
        body_markdown=payload.body_markdown,
        tags=payload.tags,
        content_hash=content_hash(
            payload.title, payload.summary, payload.body_markdown, payload.tags
        ),
        quality_issues=quality_issues,
        change_summary=payload.change_summary,
        created_by=actor.id,
    )
    db.add(content)
    db.flush()
    append_audit(
        db,
        actor_id=actor.id,
        action="content_version.revised",
        target_type="ContentVersion",
        target_id=content.id,
        request_id=request_id,
        details={"based_on_id": str(source.id), "version": next_version},
    )
    db.commit()
    return content
