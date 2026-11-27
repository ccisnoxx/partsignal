"""Slice 3A：PlatformPrompt 不可变版本写命令与平台显式绑定/回滚服务。"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.configuration import PlatformProfile, PlatformPrompt, PlatformPromptVersion
from app.models.identity import User
from app.schemas.common import AccountType
from app.schemas.prompt_versioning import (
    PlatformPromptBindingOut,
    PlatformPromptVersionBindCommand,
    PlatformPromptVersionCreate,
    PlatformPromptVersionDraftUpdate,
    PlatformPromptVersionOut,
)
from app.services.current_actor import current_actor_command
from app.services.product_facts import db_utc_now
from app.services.prompt_version_queries import (
    get_platform_prompt_binding,
    latest_published_prompt_version,
    project_prompt_versions,
)
from app.services.prompt_version_queries import (
    lock_platform_prompt_bindings_shared as lock_platform_prompt_bindings,
)


def prompt_template_sha256(template_markdown: str) -> str:
    """计算 Prompt 正文稳定的 SHA-256 哈希。"""
    return hashlib.sha256(template_markdown.encode("utf-8")).hexdigest()


def create_initial_published_version(
    db: Session,
    *,
    prompt: PlatformPrompt,
    actor_id: uuid.UUID,
    now: datetime,
) -> PlatformPromptVersion:
    """在创建 PlatformPrompt 主实体时同步生成不可变 v1 已发布版本。"""
    version = PlatformPromptVersion(
        prompt_id=prompt.id,
        version=1,
        status="PUBLISHED",
        template_markdown=prompt.template_markdown,
        template_sha256=prompt_template_sha256(prompt.template_markdown),
        change_summary="初始发布版本",
        revision=0,
        published_at=now,
        published_by=actor_id,
        created_by=actor_id,
        created_at=now,
        updated_at=now,
    )
    db.add(version)
    db.flush()
    return version


def publish_version_from_template_edit(
    db: Session,
    *,
    prompt: PlatformPrompt,
    template_markdown: str,
    actor_id: uuid.UUID,
    now: datetime,
) -> tuple[PlatformPromptVersion | None, PlatformPromptVersion | None]:
    """兼容既有主模板编辑入口：仅当正文实际变化时追加新不可变已发布版本。"""
    previous_latest = latest_published_prompt_version(db, prompt.id)
    new_sha = prompt_template_sha256(template_markdown)
    if previous_latest is not None and previous_latest.template_sha256 == new_sha:
        return previous_latest, None
    max_version = int(
        db.scalar(
            select(func.coalesce(func.max(PlatformPromptVersion.version), 0)).where(
                PlatformPromptVersion.prompt_id == prompt.id
            )
        )
        or 0
    )
    new_version = PlatformPromptVersion(
        prompt_id=prompt.id,
        version=max_version + 1,
        status="PUBLISHED",
        template_markdown=template_markdown,
        template_sha256=new_sha,
        change_summary="通过主模板编辑发布新版本",
        revision=0,
        published_at=now,
        published_by=actor_id,
        created_by=actor_id,
        created_at=now,
        updated_at=now,
    )
    db.add(new_version)
    db.flush()
    return previous_latest, new_version


def create_platform_prompt_version(
    *,
    db: Session,
    platform_prompt_id: uuid.UUID,
    payload: PlatformPromptVersionCreate,
    actor: User,
    request_id: str,
) -> PlatformPromptVersionOut:
    """为指定 Prompt 创建新的草稿或直接发布不可变版本。"""
    markdown = payload.template_markdown.strip()
    if not markdown:
        raise AppError("VALIDATION_ERROR", "Prompt 正文不能为空", 422)
    change_summary = payload.change_summary.strip()
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current_actor:
        lock_platform_prompt_bindings(db)
        prompt = db.scalar(
            select(PlatformPrompt)
            .where(PlatformPrompt.id == platform_prompt_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        if prompt is None:
            raise not_found("平台 Prompt")
        if not payload.publish_immediately:
            existing_draft = db.scalar(
                select(PlatformPromptVersion.id).where(
                    PlatformPromptVersion.prompt_id == prompt.id,
                    PlatformPromptVersion.status == "DRAFT",
                )
            )
            if existing_draft is not None:
                raise AppError(
                    "PROMPT_DRAFT_ALREADY_EXISTS",
                    "当前 Prompt 已存在未发布的草稿版本，请先编辑或发布现有草稿",
                    409,
                )
        max_version = int(
            db.scalar(
                select(func.coalesce(func.max(PlatformPromptVersion.version), 0)).where(
                    PlatformPromptVersion.prompt_id == prompt.id
                )
            )
            or 0
        )
        now = db_utc_now(db)
        status_value = "PUBLISHED" if payload.publish_immediately else "DRAFT"
        version = PlatformPromptVersion(
            prompt_id=prompt.id,
            version=max_version + 1,
            status=status_value,
            template_markdown=markdown,
            template_sha256=prompt_template_sha256(markdown),
            change_summary=change_summary,
            revision=0,
            published_at=now if payload.publish_immediately else None,
            published_by=current_actor.id if payload.publish_immediately else None,
            created_by=current_actor.id,
            created_at=now,
            updated_at=now,
        )
        db.add(version)
        if payload.publish_immediately:
            prompt.template_markdown = markdown
            prompt.updated_by = current_actor.id
            prompt.revision += 1
        try:
            db.flush()
        except IntegrityError as error:
            db.rollback()
            raise AppError(
                "PROMPT_DRAFT_ALREADY_EXISTS", "Prompt 版本创建冲突，请刷新重试", 409
            ) from error
        append_audit(
            db,
            AuditEntry(
                actor_id=current_actor.id,
                business_module=AuditModule.CONFIGURATION,
                action="platform_prompt_version.created",
                target_type="PlatformPromptVersion",
                target_id=version.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已创建 Prompt 版本",
                details={
                    "facts": {
                        "template_id": str(prompt.id),
                        "version": version.version,
                        "status": version.status,
                        "revision": version.revision,
                    }
                },
            ),
        )
        db.commit()
        return project_prompt_versions(db, [version])[0]


def update_platform_prompt_version_draft(
    *,
    db: Session,
    version_id: uuid.UUID,
    payload: PlatformPromptVersionDraftUpdate,
    actor: User,
    request_id: str,
) -> PlatformPromptVersionOut:
    """编辑未发布的 Prompt 草稿版本。"""
    markdown = payload.template_markdown.strip()
    if not markdown:
        raise AppError("VALIDATION_ERROR", "Prompt 正文不能为空", 422)
    change_summary = payload.change_summary.strip()
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current_actor:
        lock_platform_prompt_bindings(db)
        version = db.scalar(
            select(PlatformPromptVersion)
            .where(PlatformPromptVersion.id == version_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        if version is None:
            raise not_found("Prompt 版本")
        if version.revision != payload.expected_revision:
            raise AppError("REVISION_CONFLICT", "Prompt 版本已被其他请求修改", 409)
        if version.status != "DRAFT":
            raise AppError(
                "INVALID_STATE_TRANSITION", "已发布或已归档的 Prompt 版本不可原地修改", 409
            )
        now = db_utc_now(db)
        new_sha = prompt_template_sha256(markdown)
        if version.template_sha256 == new_sha and version.change_summary == change_summary:
            out = project_prompt_versions(db, [version])[0]
            db.rollback()
            return out
        version.template_markdown = markdown
        version.template_sha256 = new_sha
        version.change_summary = change_summary
        version.revision += 1
        version.updated_at = now
        db.flush()
        append_audit(
            db,
            AuditEntry(
                actor_id=current_actor.id,
                business_module=AuditModule.CONFIGURATION,
                action="platform_prompt_version.draft_updated",
                target_type="PlatformPromptVersion",
                target_id=version.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已保存 Prompt 草稿版本",
                details={
                    "facts": {
                        "template_id": str(version.prompt_id),
                        "version": version.version,
                        "status": version.status,
                        "revision": version.revision,
                    }
                },
            ),
        )
        db.commit()
        return project_prompt_versions(db, [version])[0]


def transition_platform_prompt_version(
    *,
    db: Session,
    version_id: uuid.UUID,
    expected_revision: int,
    action: str,
    actor: User,
    request_id: str,
) -> PlatformPromptVersionOut:
    """执行 Prompt 版本发布、归档或恢复。"""
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current_actor:
        lock_platform_prompt_bindings(db)
        # 严格遵循 PlatformPrompt -> PlatformPromptVersion 锁序，避免与生成/编辑形成 AB-BA 死锁
        prompt_id = db.scalar(
            select(PlatformPromptVersion.prompt_id).where(PlatformPromptVersion.id == version_id)
        )
        if prompt_id is None:
            raise not_found("Prompt 版本")
        prompt = db.scalar(
            select(PlatformPrompt)
            .where(PlatformPrompt.id == prompt_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        if prompt is None:
            raise not_found("平台 Prompt")
        version = db.scalar(
            select(PlatformPromptVersion)
            .where(PlatformPromptVersion.id == version_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        if version is None or version.prompt_id != prompt.id:
            raise not_found("Prompt 版本")
        if version.revision != expected_revision:
            raise AppError("REVISION_CONFLICT", "Prompt 版本已被其他请求修改", 409)
        now = db_utc_now(db)
        if action == "publish":
            if version.status != "DRAFT":
                raise AppError("INVALID_STATE_TRANSITION", "只有草稿版本可以发布", 409)
            version.status = "PUBLISHED"
            version.published_at = now
            version.published_by = current_actor.id
            version.revision += 1
            version.updated_at = now
            prompt.template_markdown = version.template_markdown
            prompt.updated_by = current_actor.id
            prompt.revision += 1
            audit_action = "platform_prompt_version.published"
            message = "Prompt 版本已发布并冻结"
        elif action == "archive":
            if version.status != "PUBLISHED":
                raise AppError("INVALID_STATE_TRANSITION", "只有已发布版本可以归档", 409)
            bound_count = int(
                db.scalar(
                    select(func.count())
                    .select_from(PlatformProfile)
                    .where(PlatformProfile.platform_prompt_version_id == version.id)
                )
                or 0
            )
            if bound_count > 0:
                raise AppError(
                    "PROMPT_VERSION_BOUND",
                    f"该 Prompt 版本正被 {bound_count} 个平台绑定，请先将平台切换或回滚至其他版本",
                    409,
                )
            other_published = int(
                db.scalar(
                    select(func.count())
                    .select_from(PlatformPromptVersion)
                    .where(
                        PlatformPromptVersion.prompt_id == prompt.id,
                        PlatformPromptVersion.status == "PUBLISHED",
                        PlatformPromptVersion.id != version.id,
                    )
                )
                or 0
            )
            if other_published == 0:
                raise AppError(
                    "LAST_PUBLISHED_PROMPT_VERSION",
                    "每个 Prompt 至少保留一个已发布版本，不能归档最后一个已发布版本",
                    409,
                )
            version.status = "ARCHIVED"
            version.revision += 1
            version.updated_at = now
            db.flush()
            latest_remaining = latest_published_prompt_version(db, prompt.id)
            if (
                latest_remaining is not None
                and prompt.template_markdown != latest_remaining.template_markdown
            ):
                prompt.template_markdown = latest_remaining.template_markdown
                prompt.updated_by = current_actor.id
                prompt.revision += 1
            audit_action = "platform_prompt_version.archived"
            message = "Prompt 版本已归档"
        elif action == "restore":
            if version.status != "ARCHIVED":
                raise AppError("INVALID_STATE_TRANSITION", "只有已归档版本可以恢复发布", 409)
            version.status = "PUBLISHED"
            version.revision += 1
            version.updated_at = now
            db.flush()
            latest_after = latest_published_prompt_version(db, prompt.id)
            if (
                latest_after is not None
                and prompt.template_markdown != latest_after.template_markdown
            ):
                prompt.template_markdown = latest_after.template_markdown
                prompt.updated_by = current_actor.id
                prompt.revision += 1
            audit_action = "platform_prompt_version.restored"
            message = "Prompt 版本已恢复为可绑定发布状态"
        else:
            raise AppError("VALIDATION_ERROR", "不支持的 Prompt 版本动作", 422)
        db.flush()
        append_audit(
            db,
            AuditEntry(
                actor_id=current_actor.id,
                business_module=AuditModule.CONFIGURATION,
                action=audit_action,
                target_type="PlatformPromptVersion",
                target_id=version.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message=message,
                details={
                    "facts": {
                        "template_id": str(version.prompt_id),
                        "version": version.version,
                        "status": version.status,
                        "revision": version.revision,
                    }
                },
            ),
        )
        db.commit()
        return project_prompt_versions(db, [version])[0]


def bind_platform_prompt_version(
    *,
    db: Session,
    platform_profile_id: uuid.UUID,
    payload: PlatformPromptVersionBindCommand,
    actor: User,
    request_id: str,
) -> PlatformPromptBindingOut:
    """显式将平台切换或回滚至某个已发布的不可变 Prompt 版本。"""
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current_actor:
        lock_platform_prompt_bindings(db)
        profile = db.scalar(
            select(PlatformProfile)
            .where(PlatformProfile.id == platform_profile_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        if profile is None:
            raise not_found("平台")
        if profile.revision != payload.expected_revision:
            raise AppError("REVISION_CONFLICT", "平台已被其他请求修改，请刷新后重试", 409)
        target_version = db.scalar(
            select(PlatformPromptVersion)
            .where(PlatformPromptVersion.id == payload.platform_prompt_version_id)
            .execution_options(populate_existing=True)
            .with_for_update(read=True)
        )
        if target_version is None:
            raise not_found("Prompt 版本")
        if target_version.status != "PUBLISHED":
            raise AppError(
                "INVALID_STATE_TRANSITION",
                "只能为平台绑定已发布（PUBLISHED）状态的 Prompt 版本",
                409,
            )
        if (
            profile.platform_prompt_id == target_version.prompt_id
            and profile.platform_prompt_version_id == target_version.id
        ):
            out = get_platform_prompt_binding(db, profile.id)
            db.rollback()
            return out
        previous_version_id = profile.platform_prompt_version_id
        profile.platform_prompt_id = target_version.prompt_id
        profile.platform_prompt_version_id = target_version.id
        profile.revision += 1
        db.flush()
        append_audit(
            db,
            AuditEntry(
                actor_id=current_actor.id,
                business_module=AuditModule.CONFIGURATION,
                action="platform_profile.prompt_version_bound",
                target_type="PlatformProfile",
                target_id=profile.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已更新平台绑定的 Prompt 版本",
                details={
                    "facts": {
                        "platform_profile_id": str(profile.id),
                        "template_id": str(target_version.prompt_id),
                        "template_version_id": str(target_version.id),
                        "previous_template_version_id": (
                            str(previous_version_id) if previous_version_id else None
                        ),
                        "version": target_version.version,
                        "revision": profile.revision,
                    }
                },
            ),
        )
        db.commit()
        return get_platform_prompt_binding(db, profile.id)
