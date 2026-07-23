"""跨发布与审核读取模型复用的确定性投影。"""

from __future__ import annotations

import difflib
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.ai_generation import GenerationJob
from app.models.configuration import (
    PlatformProfile,
    PlatformProfileVersion,
    PlatformPrompt,
)
from app.models.content import (
    ContentTask,
    ContentVersion,
)
from app.models.geo_files import FileRecord
from app.models.product_facts import FactVersion, Product
from app.models.publication import PublicationRecord
from app.schemas.configuration import (
    PlatformLogoExternalOut,
    PlatformLogoOut,
    PlatformLogoUploadOut,
    PlatformProfileOut,
    PlatformProfileVersionOut,
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


def content_task_out(db: Session, task: ContentTask) -> ContentTaskOut:
    """投影任务及当前唯一可执行的人工动作。"""
    has_in_flight_publication = (
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
    payload = {column.name: getattr(task, column.name) for column in task.__table__.columns}
    payload["available_actions"] = (
        ["CANCEL"] if task.status == "OPEN" and not has_in_flight_publication else []
    )
    return ContentTaskOut.model_validate(payload)


def content_version_out(content: ContentVersion) -> ContentVersionOut:
    """将不可变内容版本映射为冻结 HTTP 契约。"""
    return ContentVersionOut.model_validate(content)


def fact_version_out(version: FactVersion) -> FactVersionOut:
    """将数据库快照列映射为冻结 HTTP 契约。"""
    return FactVersionOut(
        id=version.id,
        product_id=version.product_id,
        version=version.version,
        status=version.status,
        snapshot=version.snapshot_json,
        change_summary=version.change_summary,
        revision=version.revision,
        created_by=version.created_by,
        approved_by=version.approved_by,
        created_at=version.created_at,
        approved_at=version.approved_at,
    )


def platform_version_out(version: PlatformProfileVersion) -> PlatformProfileVersionOut:
    """将平台规则版本映射为 HTTP 契约。"""
    return PlatformProfileVersionOut(
        id=version.id,
        platform_profile_id=version.platform_profile_id,
        version=version.version,
        status=version.status,
        rules=version.rules,
        revision=version.revision,
        created_at=version.created_at,
    )


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
        return PlatformLogoUploadOut(
            source="UPLOAD",
            file_id=file.id,
            url=get_evidence_storage().download_url(file.object_key, expires_at),
        )
    if profile.logo_external_url is not None:
        return PlatformLogoExternalOut(source="EXTERNAL", url=profile.logo_external_url)
    return None


def platform_profile_out(db: Session, profile: PlatformProfile) -> PlatformProfileOut:
    """投影平台及其唯一 ACTIVE 规则版本。"""
    active = db.scalar(
        select(PlatformProfileVersion).where(
            PlatformProfileVersion.platform_profile_id == profile.id,
            PlatformProfileVersion.status == "ACTIVE",
        )
    )
    logo_files = (
        {profile.logo_file_id: db.get(FileRecord, profile.logo_file_id)}
        if profile.logo_file_id is not None
        else {}
    )
    return PlatformProfileOut(
        id=profile.id,
        name=profile.name,
        slug=profile.slug,
        allowed_domains=profile.allowed_domains,
        platform_type_id=profile.platform_type_id,
        website_url=profile.website_url,
        logo=_platform_logo_out(
            profile,
            {key: value for key, value in logo_files.items() if value is not None},
            datetime.now(UTC) + timedelta(seconds=settings.download_url_ttl_seconds),
        ),
        revision=profile.revision,
        active_version=platform_version_out(active) if active is not None else None,
        prompt_configured=db.get(PlatformPrompt, profile.id) is not None,
    )


def platform_profiles_out(db: Session, profiles: list[PlatformProfile]) -> list[PlatformProfileOut]:
    """批量投影平台，避免列表按平台重复读取规则和 Prompt。"""
    profile_ids = [profile.id for profile in profiles]
    logo_file_ids = {
        profile.logo_file_id for profile in profiles if profile.logo_file_id is not None
    }
    files_by_id = {
        file.id: file
        for file in db.scalars(select(FileRecord).where(FileRecord.id.in_(logo_file_ids)))
    }
    logo_expires_at = datetime.now(UTC) + timedelta(seconds=settings.download_url_ttl_seconds)
    active_by_profile = {
        version.platform_profile_id: version
        for version in db.scalars(
            select(PlatformProfileVersion).where(
                PlatformProfileVersion.platform_profile_id.in_(profile_ids),
                PlatformProfileVersion.status == "ACTIVE",
            )
        )
    }
    prompt_profiles = set(
        db.scalars(
            select(PlatformPrompt.platform_profile_id).where(
                PlatformPrompt.platform_profile_id.in_(profile_ids)
            )
        )
    )
    return [
        PlatformProfileOut(
            id=profile.id,
            name=profile.name,
            slug=profile.slug,
            allowed_domains=profile.allowed_domains,
            platform_type_id=profile.platform_type_id,
            website_url=profile.website_url,
            logo=_platform_logo_out(profile, files_by_id, logo_expires_at),
            revision=profile.revision,
            active_version=(
                platform_version_out(active_by_profile[profile.id])
                if profile.id in active_by_profile
                else None
            ),
            prompt_configured=profile.id in prompt_profiles,
        )
        for profile in profiles
    ]


def content_tasks_out(db: Session, tasks: list[ContentTask]) -> list[ContentTaskListItem]:
    """批量聚合列表展示字段，GENERATE 状态与平台品牌均不触发逐行查询。"""
    if not tasks:
        return []
    task_ids = [task.id for task in tasks]
    product_ids = {task.product_id for task in tasks}
    platform_version_ids = {task.platform_profile_version_id for task in tasks}

    products_by_id = {
        product.id: product
        for product in db.scalars(select(Product).where(Product.id.in_(product_ids)))
    }
    platform_rows = db.execute(
        select(PlatformProfileVersion.id, PlatformProfile)
        .join(
            PlatformProfile,
            PlatformProfile.id == PlatformProfileVersion.platform_profile_id,
        )
        .where(PlatformProfileVersion.id.in_(platform_version_ids))
    )
    platforms_by_version_id = {
        platform_version_id: profile for platform_version_id, profile in platform_rows
    }
    logo_file_ids = {
        profile.logo_file_id
        for profile in platforms_by_version_id.values()
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

    items: list[ContentTaskListItem] = []
    for task in tasks:
        product = products_by_id.get(task.product_id)
        platform = platforms_by_version_id.get(task.platform_profile_version_id)
        if product is None or platform is None:
            raise RuntimeError(f"内容任务 {task.id} 的产品或平台关联不存在")
        payload = {column.name: getattr(task, column.name) for column in task.__table__.columns}
        payload["available_actions"] = (
            ["CANCEL"] if task.status == "OPEN" and task.id not in in_flight_task_ids else []
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
