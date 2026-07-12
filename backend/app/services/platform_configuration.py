"""平台类型、Prompt 与平台配置的事务命令。"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.errors import AppError, not_found
from app.models.configuration import (
    PlatformProfile,
    PlatformPrompt,
    PlatformType,
)
from app.models.identity import User
from app.schemas.configuration import (
    PlatformProfileUpdate,
    PlatformPromptPut,
    PlatformTypeCreate,
    PlatformTypeUpdate,
)


def create_platform_type(
    *, db: Session, payload: PlatformTypeCreate, actor: User, request_id: str
) -> PlatformType:
    """创建平台类型并在同一事务追加审计。"""
    item = PlatformType(name=payload.name.strip(), slug=payload.slug, created_by=actor.id)
    db.add(item)
    db.flush()
    append_audit(
        db,
        actor_id=actor.id,
        action="platform_type.created",
        target_type="PlatformType",
        target_id=item.id,
        request_id=request_id,
    )
    db.commit()
    return item


def update_platform_type(
    *,
    db: Session,
    platform_type_id: uuid.UUID,
    payload: PlatformTypeUpdate,
    actor: User,
    request_id: str,
) -> PlatformType:
    """以 revision 乐观锁更新平台类型。"""
    item = db.scalar(
        select(PlatformType).where(PlatformType.id == platform_type_id).with_for_update()
    )
    if item is None:
        raise not_found("平台类型")
    if item.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "平台类型已被其他请求修改", 409)
    item.name = payload.name.strip()
    item.slug = payload.slug
    item.revision += 1
    append_audit(
        db,
        actor_id=actor.id,
        action="platform_type.updated",
        target_type="PlatformType",
        target_id=item.id,
        request_id=request_id,
        details={"revision": item.revision},
    )
    db.commit()
    return item


def delete_platform_type(
    *, db: Session, platform_type_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """仅删除未被具体平台引用的平台类型。"""
    item = db.get(PlatformType, platform_type_id)
    if item is None:
        raise not_found("平台类型")
    if db.scalar(
        select(func.count())
        .select_from(PlatformProfile)
        .where(PlatformProfile.platform_type_id == item.id)
    ):
        raise AppError("PLATFORM_TYPE_IN_USE", "平台类型仍被具体平台引用", 409)
    append_audit(
        db,
        actor_id=actor.id,
        action="platform_type.deleted",
        target_type="PlatformType",
        target_id=item.id,
        request_id=request_id,
    )
    db.delete(item)
    db.commit()


def put_platform_prompt(
    *,
    db: Session,
    platform_type_id: uuid.UUID,
    payload: PlatformPromptPut,
    actor: User,
    request_id: str,
) -> PlatformPrompt:
    """创建或按 revision 更新平台 Prompt。"""
    if db.get(PlatformType, platform_type_id) is None:
        raise not_found("平台类型")
    prompt = db.scalar(
        select(PlatformPrompt)
        .where(PlatformPrompt.platform_type_id == platform_type_id)
        .with_for_update()
    )
    markdown = payload.template_markdown.strip()
    if not markdown:
        raise AppError("VALIDATION_ERROR", "平台 Prompt 不能为空", 422)
    if prompt is None:
        if payload.expected_revision is not None:
            raise AppError("REVISION_CONFLICT", "平台 Prompt 尚不存在", 409)
        prompt = PlatformPrompt(
            platform_type_id=platform_type_id,
            template_markdown=markdown,
            updated_by=actor.id,
        )
        db.add(prompt)
    else:
        if payload.expected_revision != prompt.revision:
            raise AppError("REVISION_CONFLICT", "平台 Prompt 已被其他请求修改", 409)
        prompt.template_markdown = markdown
        prompt.updated_by = actor.id
        prompt.revision += 1
    db.flush()
    append_audit(
        db,
        actor_id=actor.id,
        action="platform_prompt.saved",
        target_type="PlatformType",
        target_id=platform_type_id,
        request_id=request_id,
        details={"revision": prompt.revision},
    )
    db.commit()
    return prompt


def delete_platform_prompt(
    *, db: Session, platform_type_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """删除平台 Prompt 并追加审计。"""
    prompt = db.get(PlatformPrompt, platform_type_id)
    if prompt is None:
        raise not_found("平台 Prompt")
    db.delete(prompt)
    append_audit(
        db,
        actor_id=actor.id,
        action="platform_prompt.deleted",
        target_type="PlatformType",
        target_id=platform_type_id,
        request_id=request_id,
    )
    db.commit()


def update_platform_profile(
    *,
    db: Session,
    platform_profile_id: uuid.UUID,
    payload: PlatformProfileUpdate,
    actor: User,
    request_id: str,
) -> PlatformProfile:
    """锁定平台并校验类型存在后更新配置。"""
    profile = db.scalar(
        select(PlatformProfile)
        .where(PlatformProfile.id == platform_profile_id)
        .with_for_update()
    )
    if profile is None:
        raise not_found("平台")
    if profile.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "平台已被其他请求修改", 409)
    if db.get(PlatformType, payload.platform_type_id) is None:
        raise not_found("平台类型")
    profile.name = payload.name.strip()
    profile.allowed_domains = payload.allowed_domains
    profile.platform_type_id = payload.platform_type_id
    profile.revision += 1
    append_audit(
        db,
        actor_id=actor.id,
        action="platform_profile.updated",
        target_type="PlatformProfile",
        target_id=profile.id,
        request_id=request_id,
        details={"platform_type_id": str(profile.platform_type_id), "revision": profile.revision},
    )
    db.commit()
    return profile
