"""生成快照、幂等作业、重试和人工内容修订的应用服务。"""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
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
    ContentHumanizationPrompt,
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
    HumanizationPromptSnapshot,
    HumanizationSnapshot,
    HumanizationSourceContent,
)
from app.schemas.geo_files import GeneratedDraft
from app.schemas.product_facts import Confidentiality, ProductFactsBody
from app.services.ai_configuration import require_supported_protocol
from app.services.content_lineage import resolve_content_ai_lineage
from app.services.generation import (
    FIXED_SYSTEM_CONTRACT,
    GENERATION_CONTRACT_VERSION,
    HUMANIZATION_CONTRACT_VERSION,
    HUMANIZATION_FIXED_CONTRACT,
    DevelopmentContentGenerator,
    add_near_duplicate_warning,
    content_hash,
    ensure_generation_sources_public,
    ensure_humanization_egress_allowed,
    ensure_third_party_egress_allowed,
    process_generation_job,
    run_quality_checks,
)
from app.services.generation_dispatch import dispatch_generation_job
from app.worker import generate_content


def source_generation_input(db: Session, content: ContentVersion) -> dict[str, Any]:
    """沿不可变修订链定位原始生成快照，避免读取漂移后的当前配置。"""
    lineage = resolve_content_ai_lineage(db, content)
    if lineage is None:
        raise AppError("GENERATION_SNAPSHOT_INVALID", "内容版本缺少原始生成快照", 409)
    return lineage.generation_snapshot.model_dump(mode="json")


def _channel_snapshot(channel: AIChannel) -> dict[str, Any]:
    """冻结连接所需非敏感配置和敏感 Header 名称。"""
    return {
        "id": str(channel.id),
        "name": channel.name,
        "description": channel.description,
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
    }


def _model_snapshot(model: AIModel) -> dict[str, Any]:
    """冻结供应商模型身份与请求参数。"""
    return {
        "id": str(model.id),
        "display_name": model.display_name,
        "model_id": model.model_id,
        "request_parameters": model.request_parameters,
    }


def _enabled_channel(db: Session, model: AIModel) -> AIChannel:
    """校验用户选择的模型当前可以真实调用。"""
    channel = db.get(AIChannel, model.channel_id)
    if channel is None or not channel.is_enabled:
        raise AppError("AI_CONFIGURATION_DISABLED", "所选 AI 渠道当前不可用", 409)
    if not model.is_enabled or model.test_status != "PASSED":
        raise AppError("AI_MODEL_NOT_TESTED", "所选 AI 模型未启用或未通过测试", 409)
    return channel


def build_generation_input(db: Session, task: ContentTask, model: AIModel) -> dict[str, Any]:
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
    topic = db.get(QueryTopic, task.query_topic_id) if task.query_topic_id is not None else None
    if task.query_topic_id is not None and topic is None:
        raise not_found("目标问题")
    if task.platform_type_id is None or task.platform_type_snapshot is None:
        raise AppError("PLATFORM_TYPE_MISSING", "内容任务没有锁定平台类型", 409)
    profile = db.get(PlatformProfile, platform.platform_profile_id)
    if profile is None:
        raise AppError("INVALID_STATE_TRANSITION", "任务绑定的平台不存在", 409)
    prompt = db.get(PlatformPrompt, profile.id)
    if prompt is None:
        raise AppError("PLATFORM_PROMPT_MISSING", "任务平台缺少当前 Prompt", 409)
    channel = _enabled_channel(db, model)
    if not task.user_prompt_markdown.strip():
        raise AppError("USER_PROMPT_REQUIRED", "生成前必须填写工程师 Prompt", 409)
    facts = ProductFactsBody.model_validate(fact.snapshot_json)
    adapter_name = (
        DevelopmentContentGenerator.name
        if settings.content_generator == "deterministic"
        else channel.protocol_type
    )
    if adapter_name != DevelopmentContentGenerator.name:
        require_supported_protocol(adapter_name)
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
    requirements: dict[str, Any] = {
        "product": {
            "id": str(product.id),
            "part_number": product.part_number,
            "brand": product.brand,
            "category": product.category,
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
    if topic is not None:
        requirements["query_topic"] = {
            "id": str(topic.id),
            "canonical_question": topic.canonical_question,
            "intent_type": topic.intent_type,
            "variants": topic.variants,
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
        channel=_channel_snapshot(channel),
        model=_model_snapshot(model),
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
        generation_data_classification=(
            Confidentiality(task.generation_data_classification)
            if task.generation_data_classification is not None
            else None
        ),
        generation_data_classified_by=task.generation_data_classified_by,
        generation_data_classified_at=task.generation_data_classified_at,
        approved_facts=approved_facts,
        task_requirements=requirements,
        user_message=user_message,
    ).model_dump(mode="json")


def _validate_humanization_source(task: ContentTask, source: ContentVersion) -> None:
    """自然化只接受 OPEN 任务中的 AI 草稿或退回稿。"""
    if task.status != "OPEN":
        raise AppError("HUMANIZATION_SOURCE_INVALID", "终态任务不能自然化内容", 409)
    if (
        source.task_id != task.id
        or source.fact_version_id != task.fact_version_id
        or source.source_type != "AI"
        or source.status not in {"DRAFT", "CHANGES_REQUESTED"}
    ):
        raise AppError("HUMANIZATION_SOURCE_INVALID", "只能自然化当前任务中的 AI 草稿或退回稿", 409)
    actual_hash = content_hash(source.title, source.summary, source.body_markdown, source.tags)
    if actual_hash != source.content_hash:
        raise AppError("HUMANIZATION_SOURCE_INVALID", "自然化源版本正文哈希无效", 409)


def build_humanization_input(
    db: Session, task: ContentTask, source: ContentVersion, model: AIModel
) -> dict[str, Any]:
    """冻结源正文、全局 Prompt、模型和原始批准事实。"""
    _validate_humanization_source(task, source)
    lineage = resolve_content_ai_lineage(db, source)
    if lineage is None:
        raise AppError("GENERATION_SNAPSHOT_INVALID", "内容版本缺少原始生成快照", 409)
    original = ensure_third_party_egress_allowed(
        lineage.generation_snapshot.model_dump(mode="json")
    )
    fact = db.get(FactVersion, task.fact_version_id)
    product = db.get(Product, task.product_id)
    if fact is None or fact.status != "APPROVED" or product is None or product.status != "ACTIVE":
        raise AppError("FACT_NOT_APPROVED", "自然化作业绑定的事实或产品已失效", 409)
    ensure_generation_sources_public(task, ProductFactsBody.model_validate(fact.snapshot_json))
    prompt = db.get(ContentHumanizationPrompt, 1)
    if prompt is None:
        raise AppError("HUMANIZATION_PROMPT_MISSING", "管理员尚未配置自然化 Prompt", 409)
    channel = _enabled_channel(db, model)
    adapter_name = require_supported_protocol(channel.protocol_type)
    if (
        original.generation_data_classification != Confidentiality.PUBLIC
        or original.generation_data_classified_by is None
        or original.generation_data_classified_at is None
    ):
        raise AppError(
            "AI_DATA_CLASSIFICATION_FORBIDDEN",
            "自然化只允许处理已明确分级为 PUBLIC 的原始生成输入",
            409,
        )
    source_payload = HumanizationSourceContent(
        id=source.id,
        task_id=source.task_id,
        fact_version_id=source.fact_version_id,
        version=source.version,
        content_hash=source.content_hash,
        title=source.title,
        summary=source.summary,
        body_markdown=source.body_markdown,
        tags=source.tags,
    )
    system_message = "\n\n".join(
        (FIXED_SYSTEM_CONTRACT, HUMANIZATION_FIXED_CONTRACT, prompt.template_markdown)
    )
    user_message = "\n\n".join(
        [
            "## 待自然化源文章（只读）\n"
            + json.dumps(
                source_payload.model_dump(mode="json"), ensure_ascii=False, sort_keys=True
            ),
            "## 已批准事实（只读）\n"
            + json.dumps(original.approved_facts, ensure_ascii=False, sort_keys=True),
            "## 任务要求（只读）\n"
            + json.dumps(original.task_requirements, ensure_ascii=False, sort_keys=True),
        ]
    )
    snapshot = HumanizationSnapshot(
        adapter_name=adapter_name,
        contract_version=HUMANIZATION_CONTRACT_VERSION,
        channel=_channel_snapshot(channel),
        model=_model_snapshot(model),
        humanization_prompt=HumanizationPromptSnapshot(
            revision=prompt.revision,
            template_markdown=prompt.template_markdown,
        ),
        source_content=source_payload,
        source_generation_job_id=lineage.generation_job.id,
        user_prompt_markdown=original.user_prompt_markdown,
        generation_data_classification=original.generation_data_classification,
        generation_data_classified_by=original.generation_data_classified_by,
        generation_data_classified_at=original.generation_data_classified_at,
        approved_facts=original.approved_facts,
        task_requirements=original.task_requirements,
        system_message=system_message,
        user_message=user_message,
    )
    return snapshot.model_dump(mode="json")


def _create_job(
    *,
    db: Session,
    task: ContentTask,
    idempotency_key: str,
    actor: User,
    model: AIModel | None = None,
    source: ContentVersion | None = None,
    retry_of: GenerationJob | None = None,
) -> tuple[GenerationJob, bool]:
    """创建幂等作业；同一键不能被另一业务请求复用。"""
    existing = db.scalar(
        select(GenerationJob).where(GenerationJob.idempotency_key == idempotency_key)
    )
    if existing is not None:
        expected_model_id = retry_of.ai_model_id if retry_of else (model.id if model else None)
        expected_job_type = (
            retry_of.job_type if retry_of else ("HUMANIZE" if source else "GENERATE")
        )
        expected_source_id = (
            retry_of.source_content_version_id if retry_of else (source.id if source else None)
        )
        if (
            existing.content_task_id != task.id
            or existing.retry_of_id != (retry_of.id if retry_of else None)
            or existing.ai_model_id != expected_model_id
            or existing.job_type != expected_job_type
            or existing.source_content_version_id != expected_source_id
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
        _enabled_channel(db, retry_model)
        generation_input = retry_of.input_snapshot
        if retry_of.adapter_name != channel.protocol_type:
            raise AppError("AI_CONFIGURATION_CHANGED", "原作业协议与当前渠道不一致", 409)
        if retry_of.job_type == "GENERATE":
            ensure_third_party_egress_allowed(generation_input)
        else:
            ensure_humanization_egress_allowed(generation_input)
        selected_model = retry_model
    else:
        if model is None:
            raise AppError("AI_MODEL_REQUIRED", "必须选择 AI 模型", 422)
        generation_input = (
            build_humanization_input(db, task, source, model)
            if source is not None
            else build_generation_input(db, task, model)
        )
        selected_model = model
    prompt_hash = hashlib.sha256(
        json.dumps(generation_input, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    job = GenerationJob(
        content_task_id=task.id,
        idempotency_key=idempotency_key,
        job_type=retry_of.job_type if retry_of else ("HUMANIZE" if source else "GENERATE"),
        source_content_version_id=(
            retry_of.source_content_version_id if retry_of else (source.id if source else None)
        ),
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


def create_humanization_job(
    *,
    db: Session,
    content_version_id: uuid.UUID,
    payload: GenerationJobCreate,
    actor: User,
    request_id: str,
    idempotency_key: str,
) -> GenerationJob:
    """对一个合格 AI 版本幂等创建独立自然化作业。"""
    source_identity = db.get(ContentVersion, content_version_id)
    if source_identity is None:
        raise not_found("内容版本")
    task = db.scalar(
        select(ContentTask).where(ContentTask.id == source_identity.task_id).with_for_update()
    )
    source = db.scalar(
        select(ContentVersion).where(ContentVersion.id == content_version_id).with_for_update()
    )
    if task is None or source is None:
        raise not_found("内容版本")
    model = db.get(AIModel, payload.ai_model_id)
    if model is None:
        raise not_found("AI 模型")
    if (
        db.scalar(select(GenerationJob.id).where(GenerationJob.idempotency_key == idempotency_key))
        is not None
    ):
        existing, _created = _create_job(
            db=db,
            task=task,
            idempotency_key=idempotency_key,
            actor=actor,
            model=model,
            source=source,
        )
        return existing
    _validate_humanization_source(task, source)
    active = db.scalar(
        select(GenerationJob.id).where(
            GenerationJob.job_type == "HUMANIZE",
            GenerationJob.source_content_version_id == source.id,
            GenerationJob.status.in_(("PENDING", "RUNNING")),
        )
    )
    if active is not None:
        raise AppError("HUMANIZATION_ALREADY_ACTIVE", "该源版本已有活动自然化作业", 409)
    try:
        job, created = _create_job(
            db=db,
            task=task,
            idempotency_key=idempotency_key,
            actor=actor,
            model=model,
            source=source,
        )
    except IntegrityError as error:
        db.rollback()
        raced_existing = db.scalar(
            select(GenerationJob).where(GenerationJob.idempotency_key == idempotency_key)
        )
        if raced_existing is not None:
            if (
                raced_existing.content_task_id == task.id
                and raced_existing.job_type == "HUMANIZE"
                and raced_existing.source_content_version_id == source.id
                and raced_existing.ai_model_id == model.id
                and raced_existing.retry_of_id is None
            ):
                return raced_existing
            raise AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一生成请求", 409) from error
        raise AppError("HUMANIZATION_ALREADY_ACTIVE", "该源版本已有活动自然化作业", 409) from error
    if created:
        append_audit(
            db,
            actor_id=actor.id,
            action="humanization_job.created",
            target_type="GenerationJob",
            target_id=job.id,
            request_id=request_id,
            details={"source_content_version_id": str(source.id)},
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
    if (
        db.scalar(select(GenerationJob.id).where(GenerationJob.idempotency_key == idempotency_key))
        is not None
    ):
        existing, _created = _create_job(
            db=db,
            task=task,
            idempotency_key=idempotency_key,
            actor=actor,
            retry_of=previous,
        )
        return existing
    if previous.job_type == "HUMANIZE":
        snapshot = ensure_humanization_egress_allowed(previous.input_snapshot)
        if previous.source_content_version_id is None:
            raise AppError("GENERATION_SNAPSHOT_INVALID", "自然化作业缺少源版本", 409)
        source = db.scalar(
            select(ContentVersion)
            .where(ContentVersion.id == previous.source_content_version_id)
            .with_for_update()
        )
        if source is None:
            raise AppError("HUMANIZATION_SOURCE_INVALID", "自然化源版本不存在", 409)
        _validate_humanization_source(task, source)
        if source.content_hash != snapshot.source_content.content_hash:
            raise AppError("HUMANIZATION_SOURCE_INVALID", "自然化源版本与原快照不一致", 409)
        active = db.scalar(
            select(GenerationJob.id).where(
                GenerationJob.job_type == "HUMANIZE",
                GenerationJob.source_content_version_id == source.id,
                GenerationJob.status.in_(("PENDING", "RUNNING")),
            )
        )
        if active is not None:
            raise AppError("HUMANIZATION_ALREADY_ACTIVE", "该源版本已有活动自然化作业", 409)
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
