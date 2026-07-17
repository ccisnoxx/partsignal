"""平台类型、Prompt 与平台配置的事务命令。"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.errors import AppError, in_use, not_found
from app.models.configuration import (
    ContentHumanizationPrompt,
    PlatformProfile,
    PlatformProfileVersion,
    PlatformPrompt,
    PlatformType,
)
from app.models.content import ContentTask
from app.models.identity import User
from app.models.publication import PlatformAccount
from app.schemas.configuration import (
    ContentHumanizationPromptPut,
    PlatformProfileUpdate,
    PlatformPromptPut,
    PlatformTypeCreate,
    PlatformTypeUpdate,
)

HUMANIZATION_PROMPT_SINGLETON_ID = 1


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
    item = db.scalar(
        select(PlatformType).where(PlatformType.id == platform_type_id).with_for_update()
    )
    if item is None:
        raise not_found("平台类型")
    profile_count = int(
        db.scalar(
            select(func.count())
            .select_from(PlatformProfile)
            .where(PlatformProfile.platform_type_id == item.id)
        )
        or 0
    )
    if profile_count:
        raise in_use(
            "PLATFORM_TYPE_IN_USE", "平台类型", [("PLATFORM_PROFILE", "具体平台", profile_count)]
        )
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
    platform_profile_id: uuid.UUID,
    payload: PlatformPromptPut,
    actor: User,
    request_id: str,
) -> PlatformPrompt:
    """创建或按 revision 更新平台 Prompt。"""
    if db.get(PlatformProfile, platform_profile_id) is None:
        raise not_found("平台")
    prompt = db.scalar(
        select(PlatformPrompt)
        .where(PlatformPrompt.platform_profile_id == platform_profile_id)
        .with_for_update()
    )
    markdown = payload.template_markdown.strip()
    if not markdown:
        raise AppError("VALIDATION_ERROR", "平台 Prompt 不能为空", 422)
    if prompt is None:
        if payload.expected_revision is not None:
            raise AppError("REVISION_CONFLICT", "平台 Prompt 尚不存在", 409)
        prompt = PlatformPrompt(
            platform_profile_id=platform_profile_id,
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
        target_type="PlatformProfile",
        target_id=platform_profile_id,
        request_id=request_id,
        details={"revision": prompt.revision},
    )
    db.commit()
    return prompt


def put_content_humanization_prompt(
    *,
    db: Session,
    payload: ContentHumanizationPromptPut,
    actor: User,
    request_id: str,
) -> ContentHumanizationPrompt:
    """首次创建或按 revision 更新全局唯一自然化 Prompt。"""
    prompt = db.scalar(
        select(ContentHumanizationPrompt)
        .where(ContentHumanizationPrompt.id == HUMANIZATION_PROMPT_SINGLETON_ID)
        .with_for_update()
    )
    markdown = payload.template_markdown.strip()
    if not markdown:
        raise AppError("VALIDATION_ERROR", "自然化 Prompt 不能为空", 422)
    if prompt is None:
        if payload.expected_revision is not None:
            raise AppError("REVISION_CONFLICT", "自然化 Prompt 尚不存在", 409)
        prompt = ContentHumanizationPrompt(
            id=HUMANIZATION_PROMPT_SINGLETON_ID,
            template_markdown=markdown,
            updated_by=actor.id,
        )
        db.add(prompt)
    else:
        if payload.expected_revision != prompt.revision:
            raise AppError("REVISION_CONFLICT", "自然化 Prompt 已被其他请求修改", 409)
        prompt.template_markdown = markdown
        prompt.updated_by = actor.id
        prompt.revision += 1
    db.flush()
    append_audit(
        db,
        actor_id=actor.id,
        action="content_humanization_prompt.saved",
        target_type="ContentHumanizationPrompt",
        target_id=uuid.UUID(int=HUMANIZATION_PROMPT_SINGLETON_ID),
        request_id=request_id,
        details={"revision": prompt.revision},
    )
    db.commit()
    return prompt


def delete_platform_prompt(
    *, db: Session, platform_profile_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """删除平台 Prompt 并追加审计。"""
    prompt = db.scalar(
        select(PlatformPrompt)
        .where(PlatformPrompt.platform_profile_id == platform_profile_id)
        .with_for_update()
    )
    if prompt is None:
        raise not_found("平台 Prompt")
    db.delete(prompt)
    append_audit(
        db,
        actor_id=actor.id,
        action="platform_prompt.deleted",
        target_type="PlatformProfile",
        target_id=platform_profile_id,
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
        select(PlatformProfile).where(PlatformProfile.id == platform_profile_id).with_for_update()
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


def delete_platform_profile_version(
    *, db: Session, platform_profile_version_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """删除没有内容任务引用的规则版本，包括当前 ACTIVE 版本。"""
    version = db.scalar(
        select(PlatformProfileVersion)
        .where(PlatformProfileVersion.id == platform_profile_version_id)
        .with_for_update()
    )
    if version is None:
        raise not_found("平台规则版本")
    task_count = int(
        db.scalar(
            select(func.count())
            .select_from(ContentTask)
            .where(ContentTask.platform_profile_version_id == version.id)
        )
        or 0
    )
    if task_count:
        raise in_use(
            "PLATFORM_PROFILE_VERSION_IN_USE",
            "平台规则版本",
            [("CONTENT_TASK", "内容任务", task_count)],
        )
    append_audit(
        db,
        actor_id=actor.id,
        action="platform_profile_version.deleted",
        target_type="PlatformProfileVersion",
        target_id=version.id,
        request_id=request_id,
        details={"status": version.status, "version": version.version},
    )
    db.delete(version)
    db.commit()


def delete_platform_profile(
    *, db: Session, platform_profile_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """仅删除没有规则和账号直接引用的具体平台。"""
    profile = db.scalar(
        select(PlatformProfile).where(PlatformProfile.id == platform_profile_id).with_for_update()
    )
    if profile is None:
        raise not_found("平台")
    references = [
        (
            "PLATFORM_PROFILE_VERSION",
            "平台规则版本",
            int(
                db.scalar(
                    select(func.count())
                    .select_from(PlatformProfileVersion)
                    .where(PlatformProfileVersion.platform_profile_id == profile.id)
                )
                or 0
            ),
        ),
        (
            "PLATFORM_ACCOUNT",
            "平台账号",
            int(
                db.scalar(
                    select(func.count())
                    .select_from(PlatformAccount)
                    .where(PlatformAccount.platform_profile_id == profile.id)
                )
                or 0
            ),
        ),
    ]
    if any(count for _, _, count in references):
        raise in_use("PLATFORM_PROFILE_IN_USE", "平台", references)
    append_audit(
        db,
        actor_id=actor.id,
        action="platform_profile.deleted",
        target_type="PlatformProfile",
        target_id=profile.id,
        request_id=request_id,
    )
    db.delete(profile)
    db.commit()
