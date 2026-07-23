"""目标问题、平台规则版本和内容任务的事务命令。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.configuration import (
    PlatformProfile,
    PlatformProfileVersion,
    PlatformPrompt,
    PlatformType,
    QueryTopic,
)
from app.models.content import ContentTask
from app.models.identity import User
from app.models.product_facts import (
    FactVersion,
    Product,
)
from app.schemas.common import CommandRequest
from app.schemas.configuration import (
    PlatformProfileCreate,
    PlatformProfileVersionCreate,
    PlatformProfileVersionUpdate,
    QueryTopicCreate,
    QueryTopicUpdate,
)
from app.schemas.content import (
    ContentTaskCreate,
    ContentTaskUserPromptUpdate,
)
from app.services.file_records import platform_logo_storage_values
from app.services.platform_configuration import lock_active_platform


def create_query_topic(
    *, db: Session, payload: QueryTopicCreate, actor: User, request_id: str
) -> QueryTopic:
    """创建目标问题并追加审计。"""
    topic = QueryTopic(
        canonical_question=payload.canonical_question.strip(),
        intent_type=payload.intent_type.value,
        variants=payload.variants,
    )
    db.add(topic)
    db.flush()
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONTENT_PLANNING,
            action="query_topic.created",
            target_type="QueryTopic",
            target_id=topic.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="目标问题已创建",
        ),
    )
    db.commit()
    return topic


def update_query_topic(
    *,
    db: Session,
    query_topic_id: uuid.UUID,
    payload: QueryTopicUpdate,
    actor: User,
    request_id: str,
) -> QueryTopic:
    """以 revision 乐观锁更新目标问题。"""
    topic = db.scalar(select(QueryTopic).where(QueryTopic.id == query_topic_id).with_for_update())
    if topic is None:
        raise not_found("目标问题")
    if topic.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "目标问题已被其他请求修改", 409)
    topic.canonical_question = payload.canonical_question.strip()
    topic.intent_type = payload.intent_type.value
    topic.variants = payload.variants
    topic.revision += 1
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONTENT_PLANNING,
            action="query_topic.updated",
            target_type="QueryTopic",
            target_id=topic.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="目标问题已更新",
            details={"facts": {"revision": topic.revision}},
        ),
    )
    db.commit()
    return topic


def create_platform_profile(
    *, db: Session, payload: PlatformProfileCreate, actor: User, request_id: str
) -> PlatformProfile:
    """创建平台身份，规则版本由独立流程维护。"""
    if db.get(PlatformType, payload.platform_type_id) is None:
        raise not_found("平台类型")
    if db.scalar(select(PlatformProfile.id).where(PlatformProfile.slug == payload.slug)):
        raise AppError("PLATFORM_SLUG_EXISTS", "平台 slug 已存在", 409)
    logo_file_id, logo_external_url = platform_logo_storage_values(db, payload.logo)
    profile = PlatformProfile(
        name=payload.name,
        slug=payload.slug,
        allowed_domains=payload.allowed_domains,
        platform_type_id=payload.platform_type_id,
        website_url=str(payload.website_url) if payload.website_url is not None else None,
        logo_file_id=logo_file_id,
        logo_external_url=logo_external_url,
        is_active=True,
    )
    db.add(profile)
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        if db.scalar(select(PlatformProfile.id).where(PlatformProfile.slug == payload.slug)):
            raise AppError("PLATFORM_SLUG_EXISTS", "平台 slug 已存在", 409) from error
        raise
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_profile.created",
            target_type="PlatformProfile",
            target_id=profile.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台配置已创建",
            details={"facts": {"platform_type_id": str(profile.platform_type_id)}},
        ),
    )
    db.commit()
    return profile


def create_platform_profile_version(
    *,
    db: Session,
    platform_profile_id: uuid.UUID,
    payload: PlatformProfileVersionCreate,
    actor: User,
    request_id: str,
) -> PlatformProfileVersion:
    """锁定平台后分配单调递增的 DRAFT 规则版本号。"""
    if (
        db.scalar(
            select(PlatformProfile)
            .where(PlatformProfile.id == platform_profile_id)
            .with_for_update()
        )
        is None
    ):
        raise not_found("平台配置")
    next_version = (
        int(
            db.scalar(
                select(func.coalesce(func.max(PlatformProfileVersion.version), 0)).where(
                    PlatformProfileVersion.platform_profile_id == platform_profile_id
                )
            )
            or 0
        )
        + 1
    )
    version = PlatformProfileVersion(
        platform_profile_id=platform_profile_id,
        version=next_version,
        status="DRAFT",
        rules=payload.rules.model_dump(mode="json"),
    )
    db.add(version)
    db.flush()
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_profile_version.created",
            target_type="PlatformProfileVersion",
            target_id=version.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台规则版本已创建",
            details={
                "facts": {
                    "platform_profile_id": str(platform_profile_id),
                    "version": next_version,
                }
            },
        ),
    )
    db.commit()
    return version


def update_platform_profile_version(
    *,
    db: Session,
    platform_profile_version_id: uuid.UUID,
    payload: PlatformProfileVersionUpdate,
    actor: User,
    request_id: str,
) -> PlatformProfileVersion:
    """以 revision 更新 DRAFT 规则，已激活或退役版本保持冻结。"""
    version = db.scalar(
        select(PlatformProfileVersion)
        .where(PlatformProfileVersion.id == platform_profile_version_id)
        .with_for_update()
    )
    if version is None:
        raise not_found("平台规则版本")
    if version.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "平台规则版本已被其他请求修改", 409)
    if version.status != "DRAFT":
        raise AppError("INVALID_STATE_TRANSITION", "只有 DRAFT 平台规则可以编辑", 409)
    version.rules = payload.rules.model_dump(mode="json")
    version.revision += 1
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_profile_version.updated",
            target_type="PlatformProfileVersion",
            target_id=version.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台规则草稿已更新",
            details={"facts": {"revision": version.revision}},
        ),
    )
    db.commit()
    return version


def activate_platform_profile_version(
    *,
    db: Session,
    platform_profile_version_id: uuid.UUID,
    payload: CommandRequest,
    actor: User,
    request_id: str,
) -> PlatformProfileVersion:
    """原子退役当前 ACTIVE 版本并激活指定 DRAFT 版本。"""
    platform_profile_id = db.scalar(
        select(PlatformProfileVersion.platform_profile_id).where(
            PlatformProfileVersion.id == platform_profile_version_id
        )
    )
    if platform_profile_id is None:
        raise not_found("平台规则版本")
    db.scalar(
        select(PlatformProfile).where(PlatformProfile.id == platform_profile_id).with_for_update()
    )
    version = db.scalar(
        select(PlatformProfileVersion)
        .where(PlatformProfileVersion.id == platform_profile_version_id)
        .with_for_update()
    )
    if version is None:
        raise not_found("平台规则版本")
    if version.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "平台规则版本已被其他请求修改", 409)
    if version.status != "DRAFT":
        raise AppError("INVALID_STATE_TRANSITION", "只有 DRAFT 平台规则可以激活", 409)
    current = db.scalar(
        select(PlatformProfileVersion).where(
            PlatformProfileVersion.platform_profile_id == version.platform_profile_id,
            PlatformProfileVersion.status == "ACTIVE",
        )
    )
    if current is not None:
        previous_current_status = current.status
        current.status = "RETIRED"
        current.revision += 1
        append_audit(
            db,
            AuditEntry(
                actor_id=actor.id,
                business_module=AuditModule.CONFIGURATION,
                action="platform_profile_version.retired",
                target_type="PlatformProfileVersion",
                target_id=current.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="原平台规则版本已退役",
                details={
                    "changes": [
                        {
                            "field": "status",
                            "before": previous_current_status,
                            "after": current.status,
                        }
                    ],
                    "facts": {
                        "reason": "REPLACED",
                        "replacement_version_id": str(version.id),
                        "revision": current.revision,
                    },
                },
            ),
        )
        # 先释放部分唯一索引中的 ACTIVE 槽位，再激活替代版本。
        db.flush()
    previous_version_status = version.status
    version.status = "ACTIVE"
    version.revision += 1
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_profile_version.activated",
            target_type="PlatformProfileVersion",
            target_id=version.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台规则版本已激活",
            details={
                "changes": [
                    {
                        "field": "status",
                        "before": previous_version_status,
                        "after": version.status,
                    }
                ],
                "facts": {
                    "previous_active_version_id": (
                        str(current.id) if current is not None else None
                    ),
                    "revision": version.revision,
                },
            },
        ),
    )
    db.commit()
    return version


def retire_platform_profile_version(
    *,
    db: Session,
    platform_profile_version_id: uuid.UUID,
    payload: CommandRequest,
    actor: User,
    request_id: str,
) -> PlatformProfileVersion:
    """只允许直接退役尚未激活的 DRAFT 规则。"""
    version = db.scalar(
        select(PlatformProfileVersion)
        .where(PlatformProfileVersion.id == platform_profile_version_id)
        .with_for_update()
    )
    if version is None:
        raise not_found("平台规则版本")
    if version.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "平台规则版本已被其他请求修改", 409)
    if version.status != "DRAFT":
        raise AppError(
            "INVALID_STATE_TRANSITION",
            "ACTIVE 版本只能在激活替代版本时停用，避免平台失去活动配置",
            409,
        )
    previous_status = version.status
    version.status = "RETIRED"
    version.revision += 1
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_profile_version.retired",
            target_type="PlatformProfileVersion",
            target_id=version.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台规则草稿已退役",
            details={
                "changes": [
                    {
                        "field": "status",
                        "before": previous_status,
                        "after": version.status,
                    }
                ],
                "facts": {"reason": "DIRECT", "revision": version.revision},
            },
        ),
    )
    db.commit()
    return version


def create_content_task(
    *, db: Session, payload: ContentTaskCreate, actor: User, request_id: str
) -> ContentTask:
    """重新校验事实、产品和平台规则后锁定任务生成上下文。"""
    platform_profile_id = db.scalar(
        select(PlatformProfileVersion.platform_profile_id).where(
            PlatformProfileVersion.id == payload.platform_profile_version_id
        )
    )
    if platform_profile_id is None:
        raise AppError("INVALID_STATE_TRANSITION", "内容任务只能绑定 ACTIVE 平台规则", 409)
    profile = lock_active_platform(db, platform_profile_id)
    platform_version = db.scalar(
        select(PlatformProfileVersion)
        .where(PlatformProfileVersion.id == payload.platform_profile_version_id)
        .with_for_update()
    )
    if platform_version is None or platform_version.status != "ACTIVE":
        raise AppError("INVALID_STATE_TRANSITION", "内容任务只能绑定 ACTIVE 平台规则", 409)
    fact_version = db.get(FactVersion, payload.fact_version_id)
    if fact_version is None or fact_version.status != "APPROVED":
        raise AppError("FACT_NOT_APPROVED", "内容任务只能绑定已批准事实版本", 409)
    if fact_version.product_id != payload.product_id:
        raise AppError("VALIDATION_ERROR", "事实版本不属于所选产品", 422)
    product = db.get(Product, payload.product_id)
    if product is None or product.status != "ACTIVE":
        raise AppError("FACT_NOT_APPROVED", "已停用产品不能创建新任务", 409)
    if profile.platform_type_id is None:
        raise AppError("PLATFORM_TYPE_MISSING", "所选平台尚未归类，不能创建内容任务", 409)
    platform_type = db.get(PlatformType, profile.platform_type_id)
    if platform_type is None:
        raise AppError("PLATFORM_TYPE_MISSING", "所选平台类型不存在", 409)
    if db.get(PlatformPrompt, profile.id) is None:
        raise AppError("PLATFORM_PROMPT_MISSING", "所选平台尚未配置当前 Prompt", 409)
    task = ContentTask(
        **payload.model_dump(mode="python", exclude={"canonical_url"}),
        canonical_url=str(payload.canonical_url),
        platform_type_id=platform_type.id,
        platform_type_snapshot={
            "id": str(platform_type.id),
            "name": platform_type.name,
            "slug": platform_type.slug,
        },
        user_prompt_markdown="",
        created_by=actor.id,
    )
    db.add(task)
    db.flush()
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONTENT_PLANNING,
            action="content_task.created",
            target_type="ContentTask",
            target_id=task.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="内容任务已创建",
            details={
                "facts": {
                    "fact_version_id": str(task.fact_version_id),
                    "platform_profile_version_id": str(task.platform_profile_version_id),
                }
            },
        ),
    )
    db.commit()
    return task


def update_content_task_user_prompt(
    *,
    db: Session,
    content_task_id: uuid.UUID,
    payload: ContentTaskUserPromptUpdate,
    actor: User,
    request_id: str,
) -> ContentTask:
    """使用任务 revision 同时保存 Prompt 和完整生成输入分级。"""
    task = db.scalar(select(ContentTask).where(ContentTask.id == content_task_id).with_for_update())
    if task is None:
        raise not_found("内容任务")
    if task.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "内容任务已被其他请求修改", 409)
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态内容任务不能修改 Prompt", 409)
    previous_prompt_configured = bool(task.user_prompt_markdown.strip())
    previous_classification = task.generation_data_classification
    task.user_prompt_markdown = payload.user_prompt_markdown
    task.generation_data_classification = payload.generation_data_classification.value
    task.generation_data_classified_by = actor.id
    task.generation_data_classified_at = datetime.now(UTC)
    task.revision += 1
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONTENT_PLANNING,
            action="content_task.user_prompt_updated",
            target_type="ContentTask",
            target_id=task.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="内容任务生成输入已更新",
            details={
                "changes": [
                    {
                        "field": "generation_input_configured",
                        "before": previous_prompt_configured,
                        "after": bool(task.user_prompt_markdown.strip()),
                    },
                    {
                        "field": "generation_data_classification",
                        "before": previous_classification,
                        "after": task.generation_data_classification,
                    },
                ],
                "facts": {"revision": task.revision},
            },
        ),
    )
    db.commit()
    return task
