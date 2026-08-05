"""生成快照、幂等作业、重试和人工内容修订的应用服务。"""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

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
    PlatformPrompt,
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
    GenerationFactSnapshot,
    GenerationSnapshot,
    HumanizationJobCreate,
    HumanizationPromptSnapshot,
    HumanizationSnapshot,
    HumanizationSourceContent,
    OriginalGenerationJobCreate,
    PlatformPromptSnapshot,
)
from app.schemas.geo_files import GeneratedDraft
from app.schemas.product_facts import Confidentiality
from app.services.ai_configuration import require_supported_protocol
from app.services.content_lineage import resolve_content_ai_lineage
from app.services.generation import (
    GENERATION_CONTRACT_VERSION,
    HUMANIZATION_CONTRACT_VERSION,
    add_near_duplicate_warning,
    content_hash,
    ensure_generation_eligible,
    ensure_generation_sources_public,
    ensure_humanization_egress_allowed,
    ensure_third_party_egress_allowed,
    process_generation_job,
)
from app.services.generation_dispatch import dispatch_generation_job
from app.worker import generate_content


def generation_job_contract_retryable(job: GenerationJob) -> bool:
    """仅允许当前正式快照版本和已声明可读的 v2 原始生成快照重试。"""
    contract_version = job.input_snapshot.get("contract_version")
    retryable_contracts = (
        {"content-markdown-v2", GENERATION_CONTRACT_VERSION}
        if job.job_type == "GENERATE"
        else {HUMANIZATION_CONTRACT_VERSION}
    )
    return contract_version in retryable_contracts


def generation_job_retryable(job: GenerationJob, task: ContentTask | None) -> bool:
    """返回作业是否通过重试入口的快照、状态与父任务门禁。"""
    return (
        generation_job_contract_retryable(job)
        and job.status == "FAILED"
        and task is not None
        and task.status == "OPEN"
    )


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


def build_generation_input(
    db: Session,
    task: ContentTask,
    model: AIModel,
    platform_prompt_id: uuid.UUID,
    platform_prompt_revision: int,
) -> dict[str, Any]:
    """冻结平台 Prompt 与事实 Markdown，消息正文不做任何改写。"""
    fact = db.get(FactVersion, task.fact_version_id)
    if fact is None or fact.status != "APPROVED" or fact.product_id != task.product_id:
        raise AppError("FACT_NOT_APPROVED", "任务绑定的事实版本不再可用于生成", 409)
    product = db.get(Product, task.product_id)
    if product is None or product.status != "ACTIVE":
        raise AppError("FACT_NOT_APPROVED", "产品已停用，不能生成新内容", 409)
    profile = db.scalar(
        select(PlatformProfile)
        .where(PlatformProfile.id == task.platform_profile_id)
        .with_for_update()
    )
    if profile is None or not profile.is_active:
        raise AppError("INVALID_STATE_TRANSITION", "任务绑定的平台不存在", 409)
    if profile.platform_prompt_id is None:
        raise AppError("PLATFORM_PROMPT_MISSING", "任务平台缺少当前 Prompt", 409)
    if profile.platform_prompt_id != platform_prompt_id:
        raise AppError("PLATFORM_PROMPT_CHANGED", "平台当前 Prompt 已变化，请重新确认", 409)
    prompt = db.scalar(
        select(PlatformPrompt)
        .where(PlatformPrompt.id == profile.platform_prompt_id)
        .with_for_update()
    )
    if prompt is None or not prompt.template_markdown.strip():
        raise AppError("PLATFORM_PROMPT_MISSING", "任务平台缺少当前 Prompt", 409)
    if prompt.revision != platform_prompt_revision:
        raise AppError("PLATFORM_PROMPT_CHANGED", "平台当前 Prompt 已变化，请重新确认", 409)
    channel = _enabled_channel(db, model)
    adapter_name = require_supported_protocol(channel.protocol_type)
    ensure_generation_sources_public(fact)
    return GenerationSnapshot(
        adapter_name=adapter_name,
        contract_version=GENERATION_CONTRACT_VERSION,
        channel=_channel_snapshot(channel),
        model=_model_snapshot(model),
        platform_profile={
            "id": str(profile.id),
            "name": profile.name,
            "slug": profile.slug,
        },
        platform_prompt=PlatformPromptSnapshot(
            id=prompt.id,
            name=prompt.name,
            revision=prompt.revision,
        ),
        fact_version=GenerationFactSnapshot(
            id=fact.id,
            product_id=fact.product_id,
            version=fact.version,
            classification=Confidentiality(fact.classification),
        ),
        system_message=prompt.template_markdown,
        user_message=fact.body_markdown,
    ).model_dump(mode="json")


def _validate_humanization_source(task: ContentTask, source: ContentVersion) -> None:
    """自然化只接受 OPEN 任务中的 AI 草稿或退回稿。"""
    if task.status != "OPEN":
        raise AppError("HUMANIZATION_SOURCE_INVALID", "终态任务不能自然化内容", 409)
    if (
        source.task_id != task.id
        or task.current_content_version_id != source.id
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
    """冻结源正文、事实 Markdown、全局 Prompt 和模型。"""
    _validate_humanization_source(task, source)
    lineage = resolve_content_ai_lineage(db, source)
    if lineage is None:
        raise AppError("GENERATION_SNAPSHOT_INVALID", "内容版本缺少原始生成快照", 409)
    fact = db.get(FactVersion, task.fact_version_id)
    product = db.get(Product, task.product_id)
    if (
        fact is None
        or fact.status != "APPROVED"
        or fact.product_id != task.product_id
        or product is None
        or product.status != "ACTIVE"
    ):
        raise AppError("FACT_NOT_APPROVED", "自然化作业绑定的事实或产品已失效", 409)
    ensure_generation_sources_public(fact)
    prompt = db.get(ContentHumanizationPrompt, 1)
    if prompt is None or not prompt.template_markdown.strip():
        raise AppError("HUMANIZATION_PROMPT_MISSING", "管理员尚未配置自然化 Prompt", 409)
    channel = _enabled_channel(db, model)
    adapter_name = require_supported_protocol(channel.protocol_type)
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
    user_message = "\n\n".join(
        [
            "## 待自然化源文章（只读）\n"
            + json.dumps(
                source_payload.model_dump(mode="json"), ensure_ascii=False, sort_keys=True
            ),
            "## 已批准事实 Markdown（只读）\n" + fact.body_markdown,
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
        fact_version=GenerationFactSnapshot(
            id=fact.id,
            product_id=fact.product_id,
            version=fact.version,
            classification=Confidentiality(fact.classification),
        ),
        system_message=prompt.template_markdown,
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
    platform_prompt_id: uuid.UUID | None = None,
    platform_prompt_revision: int | None = None,
) -> tuple[GenerationJob, bool]:
    """创建幂等作业；同一键不能被另一业务请求复用。"""
    original_generation = retry_of is None and source is None
    if original_generation and (
        platform_prompt_id is None or platform_prompt_revision is None
    ):
        raise AppError("PLATFORM_PROMPT_REQUIRED", "必须确认平台当前 Prompt", 422)
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
        if original_generation:
            existing_prompt = existing.input_snapshot.get("platform_prompt")
            if (
                not isinstance(existing_prompt, dict)
                or existing_prompt.get("id") != str(platform_prompt_id)
                or existing_prompt.get("revision") != platform_prompt_revision
            ):
                raise AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一生成请求", 409)
        return existing, False
    if retry_of is not None:
        contract_version = retry_of.input_snapshot.get("contract_version")
        retryable_contracts = (
            {"content-markdown-v2", GENERATION_CONTRACT_VERSION}
            if retry_of.job_type == "GENERATE"
            else {HUMANIZATION_CONTRACT_VERSION}
        )
        if contract_version not in retryable_contracts:
            raise AppError(
                "LEGACY_GENERATION_RETRY_FORBIDDEN",
                "旧版生成作业仅供历史读取，不能创建重试",
                409,
            )
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
        if source is not None:
            generation_input = build_humanization_input(db, task, source, model)
        else:
            assert platform_prompt_id is not None and platform_prompt_revision is not None
            generation_input = build_generation_input(
                db,
                task,
                model,
                platform_prompt_id,
                platform_prompt_revision,
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
    payload: OriginalGenerationJobCreate,
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
    if task.current_content_version_id is not None and db.scalar(
        select(GenerationJob.id).where(GenerationJob.idempotency_key == idempotency_key)
    ) is None:
        raise AppError("CONTENT_MAINLINE_EXISTS", "任务已有当前内容版本，不能重复创建首稿", 409)
    model = db.get(AIModel, payload.ai_model_id)
    if model is None:
        raise not_found("AI 模型")
    job, created = _create_job(
        db=db,
        task=task,
        idempotency_key=idempotency_key,
        actor=actor,
        model=model,
        platform_prompt_id=payload.platform_prompt_id,
        platform_prompt_revision=payload.platform_prompt_revision,
    )
    if created:
        db.commit()
        _dispatch_job(job)
        db.refresh(job)
    return job


def create_humanization_job(
    *,
    db: Session,
    content_version_id: uuid.UUID,
    payload: HumanizationJobCreate,
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
    if not generation_job_contract_retryable(previous):
        raise AppError(
            "LEGACY_GENERATION_RETRY_FORBIDDEN",
            "旧版生成作业仅供历史读取，不能创建重试",
            409,
        )
    if previous.status != "FAILED":
        raise AppError("INVALID_STATE_TRANSITION", "只有 FAILED 作业可以重试", 409)
    task = db.scalar(
        select(ContentTask).where(ContentTask.id == previous.content_task_id).with_for_update()
    )
    if task is None or task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "内容任务不可再生成", 409)
    retry_snapshot = (
        ensure_third_party_egress_allowed(previous.input_snapshot)
        if previous.job_type == "GENERATE"
        else ensure_humanization_egress_allowed(previous.input_snapshot)
    )
    fact = db.get(FactVersion, task.fact_version_id)
    product = db.get(Product, task.product_id)
    ensure_generation_eligible(task, fact, product, retry_snapshot.fact_version)
    if fact is not None:
        ensure_generation_sources_public(fact)
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
        db.commit()
        _dispatch_job(job)
        db.refresh(job)
    return job


def _validated_manual_draft(payload: ContentRevisionCreate) -> GeneratedDraft:
    """复用严格文章结构，并把人工输入错误留在请求边界。"""
    if not payload.change_summary.strip():
        raise AppError("VALIDATION_ERROR", "变更说明不能为空白", 422)
    try:
        return GeneratedDraft(
            title=payload.title,
            summary=payload.summary,
            body_markdown=payload.body_markdown,
            tags=payload.tags,
        )
    except ValidationError as error:
        raise AppError("VALIDATION_ERROR", "标题、摘要、正文和标签均必须填写", 422) from error


def _require_approved_task_fact(db: Session, task: ContentTask) -> FactVersion:
    """人工版本也必须继续绑定有效且非空的已批准事实。"""
    fact = db.get(FactVersion, task.fact_version_id)
    if (
        fact is None
        or fact.status != "APPROVED"
        or fact.product_id != task.product_id
        or not fact.body_markdown.strip()
    ):
        raise AppError("FACT_NOT_APPROVED", "任务绑定的事实版本已失效", 409)
    return fact


def _create_human_content(
    *,
    db: Session,
    task: ContentTask,
    payload: ContentRevisionCreate,
    actor: User,
    based_on_id: uuid.UUID | None,
) -> ContentVersion:
    """创建共享审核链上的人工 Markdown 版本。"""
    draft = _validated_manual_draft(payload)
    quality_issues: list[dict[str, str]] = []
    add_near_duplicate_warning(db, task, draft, quality_issues)
    next_version = (
        int(
            db.scalar(
                select(func.coalesce(func.max(ContentVersion.version), 0)).where(
                    ContentVersion.task_id == task.id
                )
            )
            or 0
        )
        + 1
    )
    content = ContentVersion(
        task_id=task.id,
        fact_version_id=task.fact_version_id,
        based_on_id=based_on_id,
        version=next_version,
        source_type="HUMAN",
        title=draft.title,
        summary=draft.summary,
        body_markdown=draft.body_markdown,
        tags=draft.tags,
        content_hash=content_hash(draft.title, draft.summary, draft.body_markdown, draft.tags),
        status="DRAFT",
        quality_issues=quality_issues,
        change_summary=payload.change_summary,
        created_by=actor.id,
    )
    db.add(content)
    db.flush()
    task.current_content_version_id = content.id
    task.revision += 1
    return content


def create_manual_content_version(
    *,
    db: Session,
    content_task_id: uuid.UUID,
    payload: ContentRevisionCreate,
    actor: User,
    request_id: str,
) -> ContentVersion:
    """在 OPEN 任务上创建不含虚假 AI lineage 的人工首稿。"""
    task = db.scalar(select(ContentTask).where(ContentTask.id == content_task_id).with_for_update())
    if task is None:
        raise not_found("内容任务")
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态任务不能创建人工首稿", 409)
    if task.current_content_version_id is not None:
        raise AppError("CONTENT_MAINLINE_EXISTS", "任务已有当前内容版本，不能重复创建首稿", 409)
    _require_approved_task_fact(db, task)
    content = _create_human_content(
        db=db,
        task=task,
        payload=payload,
        actor=actor,
        based_on_id=None,
    )
    db.commit()
    return content


def create_content_revision(
    *,
    db: Session,
    content_version_id: uuid.UUID,
    payload: ContentRevisionCreate,
    actor: User,
    request_id: str,
) -> ContentVersion:
    """仅基于任务当前版本创建不可变人工修订并推进主线。"""
    source = db.get(ContentVersion, content_version_id)
    if source is None:
        raise not_found("内容版本")
    task = db.scalar(select(ContentTask).where(ContentTask.id == source.task_id).with_for_update())
    if task is None or task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态任务不能创建内容修订", 409)
    if source.task_id != task.id or source.fact_version_id != task.fact_version_id:
        raise AppError("GENERATION_SNAPSHOT_INVALID", "内容版本与任务事实不一致", 409)
    if task.current_content_version_id != source.id:
        raise AppError("CONTENT_VERSION_NOT_CURRENT", "只能基于任务当前内容版本创建修订", 409)
    if source.status not in {"DRAFT", "CHANGES_REQUESTED", "APPROVED"}:
        raise AppError("INVALID_STATE_TRANSITION", "当前内容版本不能创建修订", 409)
    _require_approved_task_fact(db, task)
    content = _create_human_content(
        db=db,
        task=task,
        payload=payload,
        actor=actor,
        based_on_id=source.id,
    )
    db.commit()
    return content


def abandon_content_version(
    *,
    db: Session,
    content_version_id: uuid.UUID,
    expected_revision: int,
    comment: str,
    actor: User,
    request_id: str,
) -> ContentVersion:
    """放弃当前草稿或退回稿，并恢复最近批准版本作为任务主线。"""
    source = db.get(ContentVersion, content_version_id)
    if source is None:
        raise not_found("内容版本")
    task = db.scalar(select(ContentTask).where(ContentTask.id == source.task_id).with_for_update())
    source = db.scalar(
        select(ContentVersion).where(ContentVersion.id == content_version_id).with_for_update()
    )
    if task is None or source is None:
        raise not_found("内容版本")
    if source.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "内容版本已被其他请求修改", 409)
    if task.current_content_version_id != source.id:
        raise AppError("CONTENT_VERSION_NOT_CURRENT", "只能放弃任务当前内容版本", 409)
    if source.status not in {"DRAFT", "CHANGES_REQUESTED"}:
        raise AppError("INVALID_STATE_TRANSITION", "当前内容版本不能放弃", 409)
    previous = db.scalar(
        select(ContentVersion)
        .where(
            ContentVersion.task_id == task.id,
            ContentVersion.status == "APPROVED",
            ContentVersion.id != source.id,
        )
        .order_by(ContentVersion.version.desc())
        .limit(1)
    )
    source.status = "ABANDONED"
    source.revision += 1
    task.current_content_version_id = previous.id if previous is not None else None
    task.revision += 1
    db.commit()
    return source
