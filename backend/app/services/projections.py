"""跨发布与审核读取模型复用的确定性投影。"""

from __future__ import annotations

import difflib
import uuid
from datetime import UTC, datetime, timedelta
from typing import TypedDict

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import not_found
from app.models.ai_generation import GenerationJob
from app.models.configuration import (
    PlatformProfile,
    PlatformProfileVersion,
    PlatformPrompt,
    PlatformType,
)
from app.models.content import (
    ContentTask,
    ContentVersion,
)
from app.models.geo_files import FileRecord
from app.models.identity import AuditLog
from app.models.product_facts import FactVersion, Product
from app.models.publication import PlatformAccount, PublicationRecord
from app.schemas.configuration import (
    PlatformLogoExternalOut,
    PlatformLogoOut,
    PlatformLogoUploadOut,
    PlatformProfileOut,
    PlatformProfileVersionAction,
    PlatformProfileVersionOut,
    PlatformProfileVersionSummary,
    PlatformRuleImpactSummary,
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
PLATFORM_VERSION_AUDIT_ACTIONS = (
    "platform_profile_version.created",
    "platform_profile_version.updated",
    "platform_profile_version.activated",
    "platform_profile_version.retired",
)


class _PlatformVersionAuditMetadata(TypedDict):
    created_by: uuid.UUID | None
    created_audit_at: datetime | None
    activated_at: datetime | None
    last_changed_at: datetime | None


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
    return FactVersionOut.model_validate(
        {
            "id": version.id,
            "product_id": version.product_id,
            "version": version.version,
            "status": version.status,
            "snapshot": version.snapshot_json,
            "change_summary": version.change_summary,
            "revision": version.revision,
            "created_by": version.created_by,
            "approved_by": version.approved_by,
            "created_at": version.created_at,
            "approved_at": version.approved_at,
        }
    )


def platform_version_out(version: PlatformProfileVersion) -> PlatformProfileVersionOut:
    """将平台规则版本映射为 HTTP 契约。"""
    return PlatformProfileVersionOut.model_validate(version)


def _platform_version_actions(
    status: str, reference_count: int
) -> list[PlatformProfileVersionAction]:
    """按状态与实时引用数给出管理入口，命令端仍负责最终校验。"""
    actions: list[PlatformProfileVersionAction] = []
    if status == "DRAFT":
        actions.extend(
            [
                PlatformProfileVersionAction.EDIT,
                PlatformProfileVersionAction.ACTIVATE,
                PlatformProfileVersionAction.RETIRE,
            ]
        )
    if reference_count == 0:
        actions.append(PlatformProfileVersionAction.DELETE)
    return actions


def platform_versions_out(
    db: Session, versions: list[PlatformProfileVersion]
) -> list[PlatformProfileVersionSummary]:
    """以固定两次聚合查询批量生成规则版本管理投影。"""
    if not versions:
        return []
    version_ids = [version.id for version in versions]
    reference_counts = {
        version_id: int(count)
        for version_id, count in db.execute(
            select(ContentTask.platform_profile_version_id, func.count(ContentTask.id))
            .where(ContentTask.platform_profile_version_id.in_(version_ids))
            .group_by(ContentTask.platform_profile_version_id)
        ).tuples()
    }
    version_id_by_target = {str(version_id): version_id for version_id in version_ids}
    audit_by_version: dict[uuid.UUID, _PlatformVersionAuditMetadata] = {}
    for target_id, action, actor_id, created_at in db.execute(
        select(AuditLog.target_id, AuditLog.action, AuditLog.actor_id, AuditLog.created_at).where(
            AuditLog.target_type == "PlatformProfileVersion",
            AuditLog.target_id.in_(version_id_by_target),
            AuditLog.action.in_(PLATFORM_VERSION_AUDIT_ACTIONS),
        )
    ).tuples():
        if target_id is None:
            continue
        version_id = version_id_by_target[target_id]
        metadata = audit_by_version.setdefault(
            version_id,
            {
                "created_by": None,
                "created_audit_at": None,
                "activated_at": None,
                "last_changed_at": None,
            },
        )
        if action == "platform_profile_version.created" and (
            metadata["created_audit_at"] is None or created_at < metadata["created_audit_at"]
        ):
            metadata["created_by"] = actor_id
            metadata["created_audit_at"] = created_at
        if action == "platform_profile_version.activated" and (
            metadata["activated_at"] is None or created_at > metadata["activated_at"]
        ):
            metadata["activated_at"] = created_at
        if metadata["last_changed_at"] is None or created_at > metadata["last_changed_at"]:
            metadata["last_changed_at"] = created_at

    summaries: list[PlatformProfileVersionSummary] = []
    for version in versions:
        version_audit = audit_by_version.get(version.id)
        reference_count = reference_counts.get(version.id, 0)
        audit_changed_at = version_audit["last_changed_at"] if version_audit is not None else None
        summaries.append(
            PlatformProfileVersionSummary(
                **platform_version_out(version).model_dump(),
                created_by=version_audit["created_by"] if version_audit is not None else None,
                activated_at=(version_audit["activated_at"] if version_audit is not None else None),
                last_changed_at=(
                    max(version.created_at, audit_changed_at)
                    if isinstance(audit_changed_at, datetime)
                    else version.created_at
                ),
                reference_count=reference_count,
                available_actions=_platform_version_actions(version.status, reference_count),
            )
        )
    return summaries


def platform_rule_impact(
    db: Session,
    platform_profile_version_id: uuid.UUID,
    *,
    as_of: datetime | None = None,
) -> PlatformRuleImpactSummary:
    """按已发布、审核中、其余未发布的优先级互斥统计直接绑定任务。"""
    if db.get(PlatformProfileVersion, platform_profile_version_id) is None:
        raise not_found("平台规则版本")
    query_as_of = as_of or datetime.now(UTC)
    published_exists = exists(
        select(ContentVersion.id)
        .join(PublicationRecord, PublicationRecord.content_version_id == ContentVersion.id)
        .where(
            ContentVersion.task_id == ContentTask.id,
            PublicationRecord.status.in_(("PUBLISHED", "VERIFIED")),
        )
    ).correlate(ContentTask)
    platform_review_exists = exists(
        select(ContentVersion.id)
        .join(PublicationRecord, PublicationRecord.content_version_id == ContentVersion.id)
        .where(
            ContentVersion.task_id == ContentTask.id,
            PublicationRecord.status == "PLATFORM_REVIEW",
        )
    ).correlate(ContentTask)
    pending_review_exists = exists(
        select(ContentVersion.id).where(
            ContentVersion.task_id == ContentTask.id,
            ContentVersion.status == "PENDING_REVIEW",
        )
    ).correlate(ContentTask)
    review_signal = platform_review_exists | pending_review_exists
    bound, unpublished, reviewing, published = db.execute(
        select(
            func.count(ContentTask.id),
            func.count(ContentTask.id).filter(~published_exists & ~review_signal),
            func.count(ContentTask.id).filter(~published_exists & review_signal),
            func.count(ContentTask.id).filter(published_exists),
        ).where(ContentTask.platform_profile_version_id == platform_profile_version_id)
    ).one()
    return PlatformRuleImpactSummary(
        as_of=query_as_of,
        bound_task_total=int(bound),
        unpublished_task_total=int(unpublished),
        reviewing_task_total=int(reviewing),
        published_task_total=int(published),
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
    """批量投影平台的类型、规则、Prompt、账号和真实审计时间。"""
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
    active_by_profile = {
        version.platform_profile_id: version
        for version in db.scalars(
            select(PlatformProfileVersion).where(
                PlatformProfileVersion.platform_profile_id.in_(profile_ids),
                PlatformProfileVersion.status == "ACTIVE",
            )
        )
    }
    prompt_updated_at_by_profile = {
        profile_id: updated_at
        for profile_id, updated_at in db.execute(
            select(PlatformPrompt.platform_profile_id, PlatformPrompt.updated_at).where(
                PlatformPrompt.platform_profile_id.in_(profile_ids)
            )
        ).tuples()
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
    }

    for profile in profiles:
        if (
            profile.platform_type_id is not None
            and profile.platform_type_id not in platform_types_by_id
        ):
            raise RuntimeError(f"平台 {profile.id} 关联的平台类型不存在")

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
                "active_version": (
                    platform_version_out(active_by_profile[profile.id])
                    if profile.id in active_by_profile
                    else None
                ),
                "prompt_configured": profile.id in prompt_updated_at_by_profile,
                "prompt_updated_at": prompt_updated_at_by_profile.get(profile.id),
                "configuration_complete": (
                    profile.id in active_by_profile and profile.id in prompt_updated_at_by_profile
                ),
                "platform_account_count": account_counts.get(profile.id, 0),
                "updated_at": updated_at_by_profile.get(profile.id),
            }
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
