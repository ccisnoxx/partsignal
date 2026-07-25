"""目标问题、平台身份和内容任务的事务命令。"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.configuration import PlatformProfile, PlatformType, QueryTopic
from app.models.content import ContentTask
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.schemas.configuration import PlatformProfileCreate, QueryTopicCreate, QueryTopicUpdate
from app.schemas.content import ContentTaskCreate
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
    """创建稳定平台身份，不隐式创建 Prompt。"""
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


def create_content_task(
    *, db: Session, payload: ContentTaskCreate, actor: User, request_id: str
) -> ContentTask:
    """锁定已批准事实和活动平台；Prompt 门禁只在创建 AI 作业时执行。"""
    profile = lock_active_platform(db, payload.platform_profile_id)
    fact_version = db.get(FactVersion, payload.fact_version_id)
    if (
        fact_version is None
        or fact_version.status != "APPROVED"
        or not fact_version.body_markdown.strip()
    ):
        raise AppError("FACT_NOT_APPROVED", "内容任务只能绑定非空的已批准事实版本", 409)
    if fact_version.product_id != payload.product_id:
        raise AppError("VALIDATION_ERROR", "事实版本不属于所选产品", 422)
    product = db.get(Product, payload.product_id)
    if product is None or product.status != "ACTIVE":
        raise AppError("FACT_NOT_APPROVED", "已停用产品不能创建新任务", 409)
    task = ContentTask(
        product_id=payload.product_id,
        fact_version_id=payload.fact_version_id,
        platform_profile_id=profile.id,
        query_topic_id=None,
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
                    "platform_profile_id": str(task.platform_profile_id),
                }
            },
        ),
    )
    db.commit()
    return task
