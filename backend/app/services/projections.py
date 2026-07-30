"""跨发布与审核读取模型复用的确定性投影。"""

from __future__ import annotations

import difflib
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.ai_generation import GenerationJob
from app.models.configuration import PlatformProfile, PlatformPrompt, PlatformType
from app.models.content import ContentTask, ContentVersion
from app.models.geo_files import FileRecord
from app.models.identity import AuditLog
from app.models.product_facts import FactVersion, Product
from app.models.publication import PlatformAccount, PublicationRecord
from app.schemas.configuration import (
    PlatformLogoExternalOut,
    PlatformLogoOut,
    PlatformLogoUploadOut,
    PlatformProfileOut,
    PlatformPromptReference,
    PlatformTypeSummary,
)
from app.schemas.content import (
    ContentDiff,
    ContentTaskListItem,
    ContentTaskOut,
    ContentTaskPlatformSummary,
    ContentTaskProductSummary,
    ContentVersionOut,
    DiffLine,
)
from app.schemas.product_facts import FactVersionOut
from app.services.storage import get_evidence_storage

IN_FLIGHT_PUBLICATION_STATUSES = (
    "PENDING_MANUAL_PUBLISH",
    "PLATFORM_REVIEW",
    "PUBLISHED",
)
PLATFORM_PROFILE_AUDIT_ACTIONS = (
    "platform_profile.created",
    "platform_profile.updated",
    "platform_profile.enabled",
    "platform_profile.disabled",
)


def _content_task_production_history_ids(
    db: Session,
    task_ids: list[uuid.UUID],
) -> set[uuid.UUID]:
    """批量返回已有生成作业或内容版本的任务，作为删除动作的唯一投影口径。"""
    if not task_ids:
        return set()
    return set(
        db.scalars(
            select(GenerationJob.content_task_id)
            .where(GenerationJob.content_task_id.in_(task_ids))
            .union(
                select(ContentVersion.task_id).where(ContentVersion.task_id.in_(task_ids))
            )
        )
    )


def _content_task_available_actions(
    task: ContentTask,
    *,
    has_in_flight_publication: bool,
    has_production_history: bool,
) -> list[Literal["CANCEL", "DELETE"]]:
    """按服务端状态与历史门禁给出当前真正可执行的任务动作。"""
    if task.status == "OPEN" and not has_in_flight_publication:
        return ["CANCEL"]
    if task.status == "CANCELLED" and not has_production_history:
        return ["DELETE"]
    return []


def _content_task_payload(task: ContentTask) -> dict[str, object]:
    """构造不暴露服务端幂等键的内容任务响应基础载荷。"""
    return {
        column.name: getattr(task, column.name)
        for column in task.__table__.columns
        if column.name != "idempotency_key"
    }


def content_task_out(db: Session, task: ContentTask) -> ContentTaskOut:
    """投影任务及当前唯一可执行的人工动作。"""
    has_in_flight_publication = task.status == "OPEN" and (
        db.scalar(
            select(PublicationRecord.id)
            .join(ContentVersion, ContentVersion.id == PublicationRecord.content_version_id)
            .where(
                ContentVersion.task_id == task.id,
                PublicationRecord.status.in_(IN_FLIGHT_PUBLICATION_STATUSES),
            )
            .limit(1)
        )
        is not None
    )
    has_production_history = task.id in _content_task_production_history_ids(
        db,
        [task.id] if task.status == "CANCELLED" else [],
    )
    payload = _content_task_payload(task)
    payload["available_actions"] = _content_task_available_actions(
        task,
        has_in_flight_publication=has_in_flight_publication,
        has_production_history=has_production_history,
    )
    return ContentTaskOut.model_validate(payload)


def content_version_out(content: ContentVersion) -> ContentVersionOut:
    """将不可变内容版本映射为冻结 HTTP 契约。"""
    return ContentVersionOut.model_validate(content)


def fact_version_out(version: FactVersion) -> FactVersionOut:
    """将 Markdown 事实版本映射为冻结 HTTP 契约。"""
    return FactVersionOut.model_validate(version)


def _platform_logo_out(
    profile: PlatformProfile,
    files_by_id: dict[uuid.UUID, FileRecord],
    expires_at: datetime,
) -> PlatformLogoOut | None:
    """按平台持久化来源生成 Logo；上传文件只暴露短期签名地址。"""
    if profile.logo_file_id is not None:
        file = files_by_id.get(profile.logo_file_id)
        if file is None:
            raise RuntimeError(f"平台 {profile.id} 关联的 Logo 文件不存在")
        return PlatformLogoUploadOut.model_validate(
            {
                "source": "UPLOAD",
                "file_id": file.id,
                "url": get_evidence_storage().download_url(file.object_key, expires_at),
            }
        )
    if profile.logo_external_url is not None:
        return PlatformLogoExternalOut.model_validate(
            {"source": "EXTERNAL", "url": profile.logo_external_url}
        )
    return None


def platform_profile_out(db: Session, profile: PlatformProfile) -> PlatformProfileOut:
    """投影单个平台，并复用列表批量投影的唯一计算口径。"""
    return platform_profiles_out(db, [profile])[0]


def platform_profiles_out(db: Session, profiles: list[PlatformProfile]) -> list[PlatformProfileOut]:
    """批量投影平台的类型、Prompt、账号和真实审计时间。"""
    if not profiles:
        return []
    profile_ids = [profile.id for profile in profiles]
    logo_file_ids = {
        profile.logo_file_id for profile in profiles if profile.logo_file_id is not None
    }
    files_by_id = {
        file.id: file
        for file in db.scalars(select(FileRecord).where(FileRecord.id.in_(logo_file_ids)))
    }
    logo_expires_at = datetime.now(UTC) + timedelta(seconds=settings.download_url_ttl_seconds)
    prompt_ids = {
        profile.platform_prompt_id
        for profile in profiles
        if profile.platform_prompt_id is not None
    }
    prompts_by_id = {
        prompt.id: prompt
        for prompt in db.scalars(select(PlatformPrompt).where(PlatformPrompt.id.in_(prompt_ids)))
    }
    platform_type_ids = {
        profile.platform_type_id for profile in profiles if profile.platform_type_id is not None
    }
    platform_types_by_id = {
        item.id: item
        for item in db.scalars(select(PlatformType).where(PlatformType.id.in_(platform_type_ids)))
    }
    account_counts = {
        profile_id: int(count)
        for profile_id, count in db.execute(
            select(PlatformAccount.platform_profile_id, func.count(PlatformAccount.id))
            .where(PlatformAccount.platform_profile_id.in_(profile_ids))
            .group_by(PlatformAccount.platform_profile_id)
        ).tuples()
    }
    profile_id_strings = [str(profile_id) for profile_id in profile_ids]
    updated_at_by_profile = {
        uuid.UUID(target_id): updated_at
        for target_id, updated_at in db.execute(
            select(AuditLog.target_id, func.max(AuditLog.created_at))
            .where(
                AuditLog.target_type == "PlatformProfile",
                AuditLog.action.in_(PLATFORM_PROFILE_AUDIT_ACTIONS),
                AuditLog.target_id.in_(profile_id_strings),
            )
            .group_by(AuditLog.target_id)
        ).tuples()
        if target_id is not None
    }
    for profile in profiles:
        if (
            profile.platform_type_id is not None
            and profile.platform_type_id not in platform_types_by_id
        ):
            raise RuntimeError(f"平台 {profile.id} 关联的平台类型不存在")
        if (
            profile.platform_prompt_id is not None
            and profile.platform_prompt_id not in prompts_by_id
        ):
            raise RuntimeError(f"平台 {profile.id} 关联的 Prompt 不存在")
    return [
        PlatformProfileOut.model_validate(
            {
                "id": profile.id,
                "name": profile.name,
                "slug": profile.slug,
                "allowed_domains": profile.allowed_domains,
                "platform_type_id": profile.platform_type_id,
                "platform_type": (
                    PlatformTypeSummary.model_validate(
                        platform_types_by_id[profile.platform_type_id]
                    )
                    if profile.platform_type_id is not None
                    else None
                ),
                "website_url": profile.website_url,
                "logo": _platform_logo_out(profile, files_by_id, logo_expires_at),
                "revision": profile.revision,
                "is_active": profile.is_active,
                "platform_prompt": (
                    PlatformPromptReference.model_validate(
                        prompts_by_id[profile.platform_prompt_id]
                    )
                    if profile.platform_prompt_id is not None
                    else None
                ),
                "configuration_complete": profile.platform_prompt_id is not None,
                "platform_account_count": account_counts.get(profile.id, 0),
                "updated_at": updated_at_by_profile.get(profile.id),
            }
        )
        for profile in profiles
    ]


def content_tasks_out(db: Session, tasks: list[ContentTask]) -> list[ContentTaskListItem]:
    """批量聚合列表展示字段，生成状态与平台品牌均不触发逐行查询。"""
    if not tasks:
        return []
    task_ids = [task.id for task in tasks]
    product_ids = {task.product_id for task in tasks}
    platform_ids = {task.platform_profile_id for task in tasks}
    products_by_id = {
        product.id: product
        for product in db.scalars(select(Product).where(Product.id.in_(product_ids)))
    }
    platforms_by_id = {
        profile.id: profile
        for profile in db.scalars(
            select(PlatformProfile).where(PlatformProfile.id.in_(platform_ids))
        )
    }
    logo_file_ids = {
        profile.logo_file_id
        for profile in platforms_by_id.values()
        if profile.logo_file_id is not None
    }
    logo_files_by_id = {
        file.id: file
        for file in db.scalars(select(FileRecord).where(FileRecord.id.in_(logo_file_ids)))
    }
    logo_expires_at = datetime.now(UTC) + timedelta(seconds=settings.download_url_ttl_seconds)
    ranked_generate_jobs = (
        select(
            GenerationJob.content_task_id.label("task_id"),
            GenerationJob.status.label("status"),
            func.row_number()
            .over(
                partition_by=GenerationJob.content_task_id,
                order_by=(GenerationJob.created_at.desc(), GenerationJob.id.desc()),
            )
            .label("position"),
        )
        .where(
            GenerationJob.content_task_id.in_(task_ids),
            GenerationJob.job_type == "GENERATE",
        )
        .subquery()
    )
    latest_generation_by_task: dict[uuid.UUID, str] = {
        task_id: status
        for task_id, status in db.execute(
            select(ranked_generate_jobs.c.task_id, ranked_generate_jobs.c.status).where(
                ranked_generate_jobs.c.position == 1
            )
        ).tuples()
    }
    in_flight_task_ids = set(
        db.scalars(
            select(ContentVersion.task_id)
            .join(PublicationRecord, PublicationRecord.content_version_id == ContentVersion.id)
            .where(
                ContentVersion.task_id.in_(task_ids),
                PublicationRecord.status.in_(IN_FLIGHT_PUBLICATION_STATUSES),
            )
            .distinct()
        )
    )
    production_history_task_ids = _content_task_production_history_ids(
        db,
        [task.id for task in tasks if task.status == "CANCELLED"],
    )
    items: list[ContentTaskListItem] = []
    for task in tasks:
        product = products_by_id.get(task.product_id)
        platform = platforms_by_id.get(task.platform_profile_id)
        if product is None or platform is None:
            raise RuntimeError(f"内容任务 {task.id} 的产品或平台关联不存在")
        payload = _content_task_payload(task)
        payload["available_actions"] = _content_task_available_actions(
            task,
            has_in_flight_publication=task.id in in_flight_task_ids,
            has_production_history=task.id in production_history_task_ids,
        )
        payload["product"] = ContentTaskProductSummary(
            id=product.id,
            brand=product.brand,
            part_number=product.part_number,
        )
        payload["platform"] = ContentTaskPlatformSummary(
            id=platform.id,
            name=platform.name,
            website_url=platform.website_url,
            logo=_platform_logo_out(platform, logo_files_by_id, logo_expires_at),
        )
        payload["latest_generation_status"] = latest_generation_by_task.get(task.id)
        items.append(ContentTaskListItem.model_validate(payload))
    return items


def content_diff(left: ContentVersion, right: ContentVersion) -> ContentDiff:
    """按 Markdown 行生成稳定差异，不解释正文语义。"""
    left_lines = left.body_markdown.splitlines()
    right_lines = right.body_markdown.splitlines()
    matcher = difflib.SequenceMatcher(a=left_lines, b=right_lines, autojunk=False)
    lines: list[DiffLine] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            lines.extend(
                DiffLine(kind="EQUAL", old_line=i + 1, new_line=j + 1, text=left_lines[i])
                for i, j in zip(range(i1, i2), range(j1, j2), strict=True)
            )
            continue
        if tag in {"delete", "replace"}:
            lines.extend(
                DiffLine(kind="DELETE", old_line=i + 1, new_line=None, text=left_lines[i])
                for i in range(i1, i2)
            )
        if tag in {"insert", "replace"}:
            lines.extend(
                DiffLine(kind="ADD", old_line=None, new_line=j + 1, text=right_lines[j])
                for j in range(j1, j2)
            )
    return ContentDiff(left_id=left.id, right_id=right.id, lines=lines)
