"""目标问题、平台身份和内容任务的事务命令。"""

from __future__ import annotations

import uuid

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.models.configuration import PlatformProfile, PlatformPrompt, PlatformType, QueryTopic
from app.models.content import ContentTask
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.schemas.configuration import (
    PlatformProfileCreate,
    QueryTopicCreate,
    QueryTopicOut,
    QueryTopicUpdate,
)
from app.schemas.content import ContentTaskCreate
from app.services.platform_configuration import lock_active_platform, lock_platform_prompt_bindings
from app.services.platform_logo_files import lock_platform_logo_change


def query_topic_out(topic: QueryTopic) -> QueryTopicOut:
    """投影目标问题及其当前编辑动作。"""
    payload = {
        field: getattr(topic, field)
        for field in QueryTopicOut.model_fields
        if field not in {"available_actions", "primary_task"}
    }
    payload["available_actions"] = ["UPDATE"]
    payload["primary_task"] = "USE_FOR_OBSERVATION"
    return QueryTopicOut.model_validate(payload)


def create_query_topic(
    *, db: Session, payload: QueryTopicCreate, actor: User, request_id: str
) -> QueryTopic:
    """创建目标问题。"""
    topic = QueryTopic(
        canonical_question=payload.canonical_question.strip(),
        intent_type=payload.intent_type.value,
        variants=payload.variants,
    )
    db.add(topic)
    db.flush()
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
    db.commit()
    return topic


def create_platform_profile(
    *, db: Session, payload: PlatformProfileCreate, actor: User, request_id: str
) -> PlatformProfile:
    """创建稳定平台身份，不隐式创建 Prompt。"""
    lock_platform_prompt_bindings(db)
    if db.get(PlatformType, payload.platform_type_id) is None:
        raise not_found("平台类型")
    if payload.platform_prompt_id is not None:
        selected_prompt_id = db.scalar(
            select(PlatformPrompt.id)
            .where(PlatformPrompt.id == payload.platform_prompt_id)
            .with_for_update()
        )
        if selected_prompt_id is None:
            raise not_found("平台 Prompt")
    if db.scalar(select(PlatformProfile.id).where(PlatformProfile.slug == payload.slug)):
        raise AppError("PLATFORM_SLUG_EXISTS", "平台 slug 已存在", 409)
    logo_file_id = lock_platform_logo_change(
        db,
        current_file_id=None,
        logo=payload.logo,
    )
    profile = PlatformProfile(
        name=payload.name,
        slug=payload.slug,
        allowed_domains=payload.allowed_domains,
        platform_type_id=payload.platform_type_id,
        platform_prompt_id=payload.platform_prompt_id,
        website_url=str(payload.website_url) if payload.website_url is not None else None,
        logo_file_id=logo_file_id,
        logo_external_url=None,
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
    db.commit()
    return profile


def create_content_task(
    *,
    db: Session,
    payload: ContentTaskCreate,
    actor: User,
    request_id: str,
    idempotency_key: str,
    commit: bool = True,
) -> ContentTask:
    """幂等锁定已批准事实和活动平台；Prompt 门禁只在创建 AI 作业时执行。"""
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"content-task-create:{idempotency_key}"},
    )
    existing = db.scalar(
        select(ContentTask).where(ContentTask.idempotency_key == idempotency_key)
    )
    if existing is not None:
        if (
            existing.product_id != payload.product_id
            or existing.fact_version_id != payload.fact_version_id
            or existing.platform_profile_id != payload.platform_profile_id
        ):
            raise AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一内容任务创建请求", 409)
        return existing

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
        platform_profile_name_snapshot=profile.name,
        platform_website_url_snapshot=profile.website_url,
        query_topic_id=None,
        idempotency_key=idempotency_key,
        created_by=actor.id,
    )
    db.add(task)
    db.flush()
    if commit:
        db.commit()
    return task
