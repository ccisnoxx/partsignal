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
from app.models.configuration import (
    ContentHumanizationPrompt,
    PlatformProfile,
    PlatformPrompt,
    PlatformType,
)
from app.models.content import ContentTask, ContentVersion
from app.models.geo_files import FileRecord
from app.models.identity import AuditLog
from app.models.product_facts import FactVersion, Product
from app.models.publication import PlatformAccount, PublicationWork
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
from app.schemas.publication import PlatformAccountOut
from app.services.generation import content_hash
from app.services.review_policy import content_review_actions, fact_review_actions
from app.services.storage import get_evidence_storage

IN_FLIGHT_PUBLICATION_STATUSES = (
    "PREPARING",
    "PLATFORM_REVIEW",
    "AWAITING_VERIFICATION",
    "ACTION_REQUIRED",
)
PLATFORM_PROFILE_AUDIT_ACTIONS = (
    "platform_profile.created",
    "platform_profile.updated",
    "platform_profile.enabled",
    "platform_profile.disabled",
)


def platform_accounts_out(
    db: Session,
    accounts: list[PlatformAccount],
    *,
    can_delete: bool,
) -> list[PlatformAccountOut]:
    """批量投影平台账号及无发布引用时的管理员删除动作。"""
    if not accounts:
        return []
    account_ids = [account.id for account in accounts]
    referenced_ids = set(
        db.scalars(
            select(PublicationWork.platform_account_id).where(
                PublicationWork.platform_account_id.in_(account_ids)
            )
        )
    )
    platform_ids = {account.platform_profile_id for account in accounts}
    platform_enabled = {
        profile.id: profile.is_active
        for profile in db.scalars(
            select(PlatformProfile).where(PlatformProfile.id.in_(platform_ids))
        )
    }
    items: list[PlatformAccountOut] = []
    for account in accounts:
        actions = ["UPDATE", "DISABLE" if account.is_active else "ENABLE"]
        if can_delete and account.id not in referenced_ids:
            actions.append("DELETE")
        payload = {
            field: getattr(account, field)
            for field in PlatformAccountOut.model_fields
            if field not in {"available_actions", "workflow_stage", "primary_task"}
        }
        payload["available_actions"] = actions
        if not platform_enabled.get(account.platform_profile_id, False):
            payload["workflow_stage"] = "PLATFORM_DISABLED"
            payload["primary_task"] = "HANDLE_PLATFORM"
        elif not account.is_active:
            payload["workflow_stage"] = "ACCOUNT_DISABLED"
            payload["primary_task"] = "ENABLE_ACCOUNT"
        else:
            payload["workflow_stage"] = "OPERATIONAL"
            payload["primary_task"] = "MANAGE_ACCOUNT"
        items.append(PlatformAccountOut.model_validate(payload))
    return items


def platform_account_out(
    db: Session, account: PlatformAccount, *, can_delete: bool
) -> PlatformAccountOut:
    """投影单个平台账号的当前动作。"""
    return platform_accounts_out(db, [account], can_delete=can_delete)[0]


def _content_task_protected_history_ids(
    db: Session,
    task_ids: list[uuid.UUID],
) -> set[uuid.UUID]:
    """批量返回已有批准、发布或修复历史的任务，统一删除动作投影口径。"""
    if not task_ids:
        return set()
    return set(
        db.scalars(
            select(ContentVersion.task_id)
            .where(
                ContentVersion.task_id.in_(task_ids),
                ContentVersion.status.in_(("APPROVED", "SUPERSEDED")),
            )
            .union(
                select(ContentVersion.task_id)
                .join(
                    PublicationWork,
                    PublicationWork.content_version_id == ContentVersion.id,
                )
                .where(ContentVersion.task_id.in_(task_ids)),
                select(ContentTask.id).where(
                    ContentTask.id.in_(task_ids),
                    ContentTask.source_published_content_issue_id.is_not(None),
                ),
            )
        )
    )


def _content_task_available_actions(
    task: ContentTask,
    *,
    has_in_flight_publication: bool,
    has_protected_history: bool,
    can_generate: bool,
    can_create_manual_version: bool,
) -> list[
    Literal["CANCEL", "DELETE", "CREATE_GENERATION_JOB", "CREATE_MANUAL_VERSION"]
]:
    """按服务端状态与历史门禁给出当前真正可执行的任务动作。"""
    actions: list[
        Literal["CANCEL", "DELETE", "CREATE_GENERATION_JOB", "CREATE_MANUAL_VERSION"]
    ] = []
    if task.status == "OPEN" and not has_in_flight_publication:
        actions.append("CANCEL")
    if task.status == "CANCELLED" and not has_protected_history:
        actions.append("DELETE")
    if can_generate:
        actions.append("CREATE_GENERATION_JOB")
    if can_create_manual_version:
        actions.append("CREATE_MANUAL_VERSION")
    return actions


def _content_task_payload(task: ContentTask) -> dict[str, object]:
    """构造不暴露服务端幂等键的内容任务响应基础载荷。"""
    return {
        column.name: getattr(task, column.name)
        for column in task.__table__.columns
        if column.name != "idempotency_key"
    }


def content_task_out(db: Session, task: ContentTask) -> ContentTaskOut:
    """复用列表批量投影口径返回单个任务。"""
    item = content_tasks_out(db, [task])[0]
    return ContentTaskOut.model_validate(
        {field: getattr(item, field) for field in ContentTaskOut.model_fields}
    )


def content_versions_out(db: Session, contents: list[ContentVersion]) -> list[ContentVersionOut]:
    """批量投影内容版本的修订、自然化和审核动作。"""
    if not contents:
        return []
    task_ids = {content.task_id for content in contents}
    tasks_by_id = {
        task.id: task
        for task in db.scalars(select(ContentTask).where(ContentTask.id.in_(task_ids)))
    }
    fact_ids = {content.fact_version_id for content in contents}
    facts_by_id = {
        fact.id: fact
        for fact in db.scalars(select(FactVersion).where(FactVersion.id.in_(fact_ids)))
    }
    product_ids = {task.product_id for task in tasks_by_id.values()}
    products_by_id = {
        product.id: product
        for product in db.scalars(select(Product).where(Product.id.in_(product_ids)))
    }
    active_humanization_sources = set(
        db.scalars(
            select(GenerationJob.source_content_version_id).where(
                GenerationJob.source_content_version_id.in_([content.id for content in contents]),
                GenerationJob.job_type == "HUMANIZE",
                GenerationJob.status.in_(("PENDING", "RUNNING")),
            )
        )
    )
    humanization_prompt_configured = db.get(ContentHumanizationPrompt, 1) is not None
    works_by_task = {
        work.content_task_id: work
        for work in db.scalars(
            select(PublicationWork).where(PublicationWork.content_task_id.in_(task_ids))
        )
    }
    items: list[ContentVersionOut] = []
    for content in contents:
        task = tasks_by_id.get(content.task_id)
        fact = facts_by_id.get(content.fact_version_id)
        actions: list[str] = []
        is_current = task is not None and task.current_content_version_id == content.id
        fact_ready = bool(
            task is not None
            and fact is not None
            and task.status == "OPEN"
            and task.fact_version_id == fact.id
            and task.product_id == fact.product_id
            and fact.status == "APPROVED"
            and fact.body_markdown.strip()
        )
        if fact_ready and is_current and content.status in {
            "DRAFT",
            "CHANGES_REQUESTED",
            "APPROVED",
        }:
            actions.append("CREATE_REVISION")
        product = products_by_id.get(task.product_id) if task is not None else None
        actual_hash = content_hash(
            content.title,
            content.summary,
            content.body_markdown,
            content.tags,
        )
        if (
            fact_ready
            and is_current
            and fact is not None
            and fact.classification == "PUBLIC"
            and product is not None
            and product.status == "ACTIVE"
            and content.source_type == "AI"
            and content.status in {"DRAFT", "CHANGES_REQUESTED"}
            and content.source_job_id is not None
            and content.content_hash == actual_hash
            and content.id not in active_humanization_sources
            and humanization_prompt_configured
        ):
            actions.append("CREATE_HUMANIZATION_JOB")
        if fact is not None and is_current:
            actions.extend(content_review_actions(content, fact))
        if is_current and content.status in {"DRAFT", "CHANGES_REQUESTED"}:
            actions.append("ABANDON")
        work = works_by_task.get(content.task_id)
        if (
            work is not None
            and work.content_version_id == content.id
            and work.status == "COMPLETED"
        ):
            workflow_stage, primary_task = "PUBLISHED", "VIEW_PUBLICATION_RESULT"
        elif not is_current:
            workflow_stage, primary_task = "HISTORICAL", "VIEW_VERSION_HISTORY"
        elif content.status == "DRAFT":
            workflow_stage, primary_task = "CURRENT_DRAFT", "EDIT_AND_SUBMIT_REVIEW"
        elif content.status == "PENDING_REVIEW":
            workflow_stage, primary_task = "CURRENT_REVIEW_PENDING", "REVIEW_CONTENT"
        elif content.status == "CHANGES_REQUESTED":
            workflow_stage, primary_task = "CURRENT_CHANGES_REQUESTED", "CREATE_REVISION"
        elif content.status == "APPROVED" and work is not None:
            workflow_stage, primary_task = "CURRENT_PUBLISHING", "CONTINUE_PUBLICATION"
        elif content.status == "APPROVED":
            workflow_stage, primary_task = "CURRENT_APPROVED", "START_PUBLICATION"
        else:
            workflow_stage, primary_task = "HISTORICAL", "VIEW_VERSION_HISTORY"
        payload = {
            field: getattr(content, field)
            for field in ContentVersionOut.model_fields
            if field not in {"available_actions", "workflow_stage", "primary_task"}
        }
        payload["available_actions"] = actions
        payload["workflow_stage"] = workflow_stage
        payload["primary_task"] = primary_task
        items.append(ContentVersionOut.model_validate(payload))
    return items


def content_version_out(db: Session, content: ContentVersion) -> ContentVersionOut:
    """投影单个内容版本及其当前资源动作。"""
    return content_versions_out(db, [content])[0]


def fact_versions_out(
    db: Session,
    versions: list[FactVersion],
    *,
    can_delete: bool,
) -> list[FactVersionOut]:
    """批量投影事实审核动作和无引用删除资格。"""
    if not versions:
        return []
    version_ids = [version.id for version in versions]
    referenced_ids = set(
        db.scalars(
            select(ContentTask.fact_version_id)
            .where(ContentTask.fact_version_id.in_(version_ids))
            .union(
                select(ContentVersion.fact_version_id).where(
                    ContentVersion.fact_version_id.in_(version_ids)
                )
            )
        )
    )
    items: list[FactVersionOut] = []
    for version in versions:
        actions: list[str] = list(fact_review_actions(version))
        if can_delete and version.id not in referenced_ids:
            actions.append("DELETE")
        payload = {
            field: getattr(version, field)
            for field in FactVersionOut.model_fields
            if field not in {"available_actions", "primary_task"}
        }
        payload["available_actions"] = actions
        payload["primary_task"] = {
            "PENDING_REVIEW": "REVIEW_FACT",
            "APPROVED": "CREATE_CONTENT_TASK",
            "CHANGES_REQUESTED": "REVISE_FACT",
            "RETIRED": "VIEW_FACT_HISTORY",
        }[version.status]
        items.append(FactVersionOut.model_validate(payload))
    return items


def fact_version_out(db: Session, version: FactVersion, *, can_delete: bool) -> FactVersionOut:
    """投影单个事实版本及其当前资源动作。"""
    return fact_versions_out(db, [version], can_delete=can_delete)[0]


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


def platform_profile_out(
    db: Session, profile: PlatformProfile, *, can_manage: bool
) -> PlatformProfileOut:
    """投影单个平台，并复用列表批量投影的唯一计算口径。"""
    return platform_profiles_out(db, [profile], can_manage=can_manage)[0]


def platform_profiles_out(
    db: Session,
    profiles: list[PlatformProfile],
    *,
    can_manage: bool,
) -> list[PlatformProfileOut]:
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
        profile.platform_prompt_id for profile in profiles if profile.platform_prompt_id is not None
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
    task_counts = {
        profile_id: int(count)
        for profile_id, count in db.execute(
            select(ContentTask.platform_profile_id, func.count(ContentTask.id))
            .where(ContentTask.platform_profile_id.in_(profile_ids))
            .group_by(ContentTask.platform_profile_id)
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
                "workflow_stage": (
                    "DISABLED"
                    if not profile.is_active
                    else (
                        "OPERATIONAL"
                        if profile.platform_prompt_id is not None
                        else "GENERATION_UNCONFIGURED"
                    )
                ),
                "primary_task": (
                    "ENABLE_PLATFORM"
                    if not profile.is_active
                    else (
                        "VIEW_PLATFORM_OPERATION"
                        if profile.platform_prompt_id is not None
                        else "CONFIGURE_GENERATION"
                    )
                ),
                "platform_account_count": account_counts.get(profile.id, 0),
                "available_actions": (
                    [
                        "UPDATE",
                        "DISABLE" if profile.is_active else "ENABLE",
                        *(
                            ["DELETE"]
                            if account_counts.get(profile.id, 0) == 0
                            and task_counts.get(profile.id, 0) == 0
                            else []
                        ),
                    ]
                    if can_manage
                    else []
                ),
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
    fact_ids = {task.fact_version_id for task in tasks}
    platform_ids = {task.platform_profile_id for task in tasks}
    products_by_id = {
        product.id: product
        for product in db.scalars(select(Product).where(Product.id.in_(product_ids)))
    }
    facts_by_id = {
        fact.id: fact
        for fact in db.scalars(select(FactVersion).where(FactVersion.id.in_(fact_ids)))
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
    works_by_task = {
        work.content_task_id: work
        for work in db.scalars(
            select(PublicationWork).where(PublicationWork.content_task_id.in_(task_ids))
        )
    }
    in_flight_task_ids = {
        task_id
        for task_id, work in works_by_task.items()
        if work.status in IN_FLIGHT_PUBLICATION_STATUSES
    }
    current_ids = {
        task.current_content_version_id
        for task in tasks
        if task.current_content_version_id is not None
    }
    current_by_id = {
        content.id: content
        for content in db.scalars(select(ContentVersion).where(ContentVersion.id.in_(current_ids)))
    }
    protected_history_task_ids = _content_task_protected_history_ids(
        db,
        [task.id for task in tasks if task.status == "CANCELLED"],
    )
    items: list[ContentTaskListItem] = []
    for task in tasks:
        product = products_by_id.get(task.product_id)
        fact = facts_by_id.get(task.fact_version_id)
        platform = platforms_by_id.get(task.platform_profile_id)
        if product is None or fact is None or platform is None:
            raise RuntimeError(f"内容任务 {task.id} 的产品或平台关联不存在")
        fact_ready = bool(
            task.status == "OPEN"
            and fact.product_id == task.product_id
            and fact.status == "APPROVED"
            and fact.body_markdown.strip()
        )
        latest_generation_status = latest_generation_by_task.get(task.id)
        current = (
            current_by_id.get(task.current_content_version_id)
            if task.current_content_version_id is not None
            else None
        )
        work = works_by_task.get(task.id)
        if task.status == "CANCELLED":
            workflow_stage, primary_task = "CANCELLED", "VIEW_CANCELLATION"
        elif work is not None and work.status == "COMPLETED":
            workflow_stage, primary_task = "VERIFIED", "VIEW_FULL_LINEAGE"
        elif work is not None:
            workflow_stage, primary_task = "PUBLISHING", "CONTINUE_PUBLICATION"
        elif current is None and latest_generation_status in {"PENDING", "RUNNING"}:
            workflow_stage, primary_task = "GENERATING", "VIEW_GENERATION_PROGRESS"
        elif current is None and latest_generation_status == "FAILED":
            workflow_stage, primary_task = "GENERATION_FAILED", "HANDLE_GENERATION_FAILURE"
        elif current is None:
            workflow_stage, primary_task = "NO_DRAFT", "CREATE_FIRST_DRAFT"
        elif current.status == "DRAFT":
            workflow_stage, primary_task = "DRAFT", "EDIT_AND_SUBMIT_REVIEW"
        elif current.status == "PENDING_REVIEW":
            workflow_stage, primary_task = "REVIEW_PENDING", "REVIEW_CONTENT"
        elif current.status == "CHANGES_REQUESTED":
            workflow_stage, primary_task = "CHANGES_REQUESTED", "REVISE_CONTENT"
        elif current.status == "APPROVED":
            workflow_stage, primary_task = "APPROVED", "START_PUBLICATION"
        else:
            raise RuntimeError(f"内容任务 {task.id} 的当前版本状态无效")
        payload = _content_task_payload(task)
        payload["available_actions"] = _content_task_available_actions(
            task,
            has_in_flight_publication=task.id in in_flight_task_ids,
            has_protected_history=task.id in protected_history_task_ids,
            can_generate=bool(
                fact_ready
                and current is None
                and latest_generation_status not in {"PENDING", "RUNNING"}
                and fact.classification == "PUBLIC"
                and product.status == "ACTIVE"
                and platform.is_active
                and platform.platform_prompt_id is not None
            ),
            can_create_manual_version=bool(fact_ready and current is None),
        )
        payload["workflow_stage"] = workflow_stage
        payload["primary_task"] = primary_task
        payload["product"] = ContentTaskProductSummary(
            id=product.id,
            brand=product.brand,
            part_number=product.part_number,
        )
        payload["platform"] = ContentTaskPlatformSummary.model_validate(
            {
                "id": platform.id,
                "name": platform.name,
                "website_url": platform.website_url,
                "logo": _platform_logo_out(platform, logo_files_by_id, logo_expires_at),
            }
        )
        payload["latest_generation_status"] = latest_generation_status
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
