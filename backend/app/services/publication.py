"""发布、任务终态与发布异常修复的领域应用服务。"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from urllib.parse import urlparse

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, in_use, not_found
from app.models.configuration import (
    PlatformProfile,
    QueryTopic,
)
from app.models.content import (
    ContentTask,
    ContentVersion,
)
from app.models.geo_files import FileRecord
from app.models.identity import User
from app.models.product_facts import (
    FactVersion,
    Product,
)
from app.models.publication import (
    PlatformAccount,
    PublicationAttachment,
    PublicationAttention,
    PublicationRecord,
    PublicationStatusEvent,
)
from app.schemas.common import RevisionRequest
from app.schemas.publication import (
    ManualPublicationCreate,
    PlatformAccountCreate,
    PlatformAccountUpdate,
    PublicationAttentionOut,
    PublicationCommand,
    PublicationRecordOut,
    PublicationRepairTaskCreate,
    ResolvePublicationAttentionRequest,
)
from app.services.file_records import verified_files
from app.services.platform_configuration import lock_active_platform
from app.services.projections import IN_FLIGHT_PUBLICATION_STATUSES
from app.services.publication_queries import (
    PUBLICATION_TRANSITIONS,
    attention_out,
    publication_out,
    task_for_publication,
)


def _publication_evidence_files(db: Session, file_ids: list[uuid.UUID]) -> list[FileRecord]:
    """返回可关联发布记录的已校验操作截图。"""
    files = verified_files(db, file_ids)
    if any(file.category != "OPERATION_SCREENSHOT" for file in files):
        raise AppError("VALIDATION_ERROR", "发布证据必须使用 OPERATION_SCREENSHOT 类别", 422)
    return files


def domain_allowed(url: str, allowed_domains: list[str]) -> bool:
    """仅允许 HTTP(S) 且主机等于或属于平台配置域名。"""
    parsed = urlparse(url)
    host = (parsed.hostname or "").casefold().strip(".")
    if parsed.scheme not in {"http", "https"} or not host:
        return False
    return any(host == domain or host.endswith(f".{domain}") for domain in allowed_domains)


def _lock_approved_publication_context(
    db: Session,
    content_id: uuid.UUID,
) -> tuple[ContentVersion, ContentTask]:
    """锁定批准内容对应任务，但把任务终态检查留给具体命令。"""
    content = db.get(ContentVersion, content_id)
    if content is None:
        raise not_found("内容版本")
    fact = db.get(FactVersion, content.fact_version_id)
    task = db.scalar(select(ContentTask).where(ContentTask.id == content.task_id).with_for_update())
    if content.status != "APPROVED" or fact is None or fact.status != "APPROVED":
        raise AppError("CONTENT_NOT_APPROVED", "只有绑定有效批准事实的批准内容可以发布", 409)
    if task is None:
        raise AppError("INVALID_STATE_TRANSITION", "终态内容任务不能创建新发布", 409)
    return content, task


def require_publishable(db: Session, content_id: uuid.UUID) -> ContentVersion:
    """读取可发布内容，并重新校验不可变事实与任务状态。"""
    content, task = _lock_approved_publication_context(db, content_id)
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态内容任务不能创建新发布", 409)
    return content


def _platform_account_identifier_exists(
    db: Session,
    *,
    platform_profile_id: uuid.UUID,
    account_identifier: str,
    exclude_account_id: uuid.UUID | None = None,
) -> bool:
    """按数据库唯一索引的相同表达式检查同平台运营账号标识。"""
    query = select(PlatformAccount.id).where(
        PlatformAccount.platform_profile_id == platform_profile_id,
        func.lower(func.btrim(PlatformAccount.account_identifier))
        == func.lower(account_identifier),
    )
    if exclude_account_id is not None:
        query = query.where(PlatformAccount.id != exclude_account_id)
    return db.scalar(query.limit(1)) is not None


def _flush_platform_account(db: Session) -> None:
    """把数据库唯一索引冲突转换为稳定业务错误。"""
    try:
        db.flush()
    except IntegrityError as error:
        constraint_name = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
        if constraint_name == "uq_platform_accounts_profile_identifier_normalized":
            db.rollback()
            raise AppError(
                "PLATFORM_ACCOUNT_IDENTIFIER_EXISTS",
                "该平台已存在相同的运营账号标识",
                409,
            ) from error
        raise


def _lock_platform_account(
    db: Session,
    platform_account_id: uuid.UUID,
    *,
    require_active_platform: bool = False,
) -> tuple[PlatformProfile, PlatformAccount]:
    """按平台、账号的固定顺序锁行，并刷新账号的当前状态。"""
    platform_profile_id = db.scalar(
        select(PlatformAccount.platform_profile_id).where(
            PlatformAccount.id == platform_account_id
        )
    )
    if platform_profile_id is None:
        raise not_found("平台账号")
    profile: PlatformProfile | None
    if require_active_platform:
        profile = lock_active_platform(db, platform_profile_id)
    else:
        profile = db.scalar(
            select(PlatformProfile)
            .where(PlatformProfile.id == platform_profile_id)
            .with_for_update()
        )
        if profile is None:
            raise not_found("平台配置")
    account = db.scalar(
        select(PlatformAccount)
        .where(PlatformAccount.id == platform_account_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if account is None:
        raise not_found("平台账号")
    return profile, account


def create_platform_account(
    *, db: Session, payload: PlatformAccountCreate, actor: User, request_id: str
) -> PlatformAccount:
    """在现存平台下创建人工发布账号并追加审计。"""
    lock_active_platform(db, payload.platform_profile_id)
    if _platform_account_identifier_exists(
        db,
        platform_profile_id=payload.platform_profile_id,
        account_identifier=payload.account_identifier,
    ):
        raise AppError(
            "PLATFORM_ACCOUNT_IDENTIFIER_EXISTS",
            "该平台已存在相同的运营账号标识",
            409,
        )
    account = PlatformAccount(**payload.model_dump())
    db.add(account)
    _flush_platform_account(db)
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.PUBLICATION,
            action="platform_account.created",
            target_type="PlatformAccount",
            target_id=account.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="发布账号已创建",
            details={"facts": {"platform_profile_id": str(account.platform_profile_id)}},
        ),
    )
    db.commit()
    return account


def update_platform_account(
    *,
    db: Session,
    platform_account_id: uuid.UUID,
    payload: PlatformAccountUpdate,
    actor: User,
    request_id: str,
) -> PlatformAccount:
    """按 revision 修改账号业务标签和内部运营标识。"""
    profile, account = _lock_platform_account(db, platform_account_id)
    if account.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "发布账号已被其他请求修改", 409)
    if _platform_account_identifier_exists(
        db,
        platform_profile_id=profile.id,
        account_identifier=payload.account_identifier,
        exclude_account_id=account.id,
    ):
        raise AppError(
            "PLATFORM_ACCOUNT_IDENTIFIER_EXISTS",
            "该平台已存在相同的运营账号标识",
            409,
        )
    account.label = payload.label
    account.account_identifier = payload.account_identifier
    account.revision += 1
    _flush_platform_account(db)
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.PUBLICATION,
            action="platform_account.updated",
            target_type="PlatformAccount",
            target_id=account.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="发布账号已更新",
            details={
                "facts": {
                    "platform_profile_id": str(profile.id),
                    "revision": account.revision,
                }
            },
        ),
    )
    db.commit()
    return account


def set_platform_account_enabled(
    *,
    db: Session,
    platform_account_id: uuid.UUID,
    payload: RevisionRequest,
    actor: User,
    request_id: str,
    enabled: bool,
) -> PlatformAccount:
    """按 revision 启停账号，不改写任何历史发布引用。"""
    profile, account = _lock_platform_account(db, platform_account_id)
    if account.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "发布账号已被其他请求修改", 409)
    previous_enabled = account.is_active
    account.is_active = enabled
    account.revision += 1
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.PUBLICATION,
            action=f"platform_account.{'enabled' if enabled else 'disabled'}",
            target_type="PlatformAccount",
            target_id=account.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message=f"发布账号已{'启用' if enabled else '停用'}",
            details={
                "changes": [
                    {
                        "field": "is_active",
                        "before": previous_enabled,
                        "after": enabled,
                    }
                ],
                "facts": {
                    "platform_profile_id": str(profile.id),
                    "revision": account.revision,
                },
            },
        ),
    )
    db.commit()
    return account


def delete_platform_account(
    *, db: Session, platform_account_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """仅删除没有发布记录引用的发布账号。"""
    _profile, account = _lock_platform_account(db, platform_account_id)
    publication_count = int(
        db.scalar(
            select(func.count())
            .select_from(PublicationRecord)
            .where(PublicationRecord.platform_account_id == account.id)
        )
        or 0
    )
    if publication_count:
        raise in_use(
            "PLATFORM_ACCOUNT_IN_USE",
            "平台账号",
            [("PUBLICATION_RECORD", "发布记录", publication_count)],
        )
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.PUBLICATION,
            action="platform_account.deleted",
            target_type="PlatformAccount",
            target_id=account.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="发布账号已删除",
            details={
                "facts": {
                    "platform_profile_id": str(account.platform_profile_id),
                    "publication_reference_count": publication_count,
                }
            },
        ),
    )
    db.delete(account)
    db.commit()


def _guard_duplicate_platform_content(
    db: Session,
    *,
    platform_profile_id: uuid.UUID,
    content_hash: str,
    exclude_publication_id: uuid.UUID | None = None,
) -> None:
    """串行检查同平台同内容哈希的在途记录和曾公开历史。"""
    lock_key = f"publication:{platform_profile_id}:{content_hash}"
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": lock_key},
    )
    published_event_exists = (
        select(PublicationStatusEvent.id)
        .where(
            PublicationStatusEvent.publication_id == PublicationRecord.id,
            PublicationStatusEvent.status.in_(("PUBLISHED", "VERIFIED")),
        )
        .exists()
    )
    query = (
        select(
            PublicationRecord.status,
            published_event_exists.label("was_public"),
        )
        .join(
            PlatformAccount,
            PlatformAccount.id == PublicationRecord.platform_account_id,
        )
        .where(
            PlatformAccount.platform_profile_id == platform_profile_id,
            PublicationRecord.content_hash == content_hash,
        )
    )
    if exclude_publication_id is not None:
        query = query.where(PublicationRecord.id != exclude_publication_id)
    if any(status != "REJECTED" or was_public for status, was_public in db.execute(query)):
        raise AppError(
            "DUPLICATE_PLATFORM_CONTENT",
            "同一篇文章不能在同一平台重复登记或公开发布",
            409,
        )


def create_manual_publication(
    *,
    db: Session,
    payload: ManualPublicationCreate,
    actor: User,
    request_id: str,
    idempotency_key: str,
) -> PublicationRecordOut:
    """幂等登记人工发布，并在服务端校验任务锁定平台。"""
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": idempotency_key},
    )
    existing = db.scalar(
        select(PublicationRecord).where(PublicationRecord.idempotency_key == idempotency_key)
    )
    if existing is not None:
        existing_file_ids = set(
            db.scalars(
                select(PublicationAttachment.file_id).where(
                    PublicationAttachment.publication_id == existing.id
                )
            )
        )
        if (
            existing.content_version_id != payload.content_version_id
            or existing.platform_account_id != payload.platform_account_id
            or existing.section_url != str(payload.section_url)
            or existing_file_ids != set(payload.attachment_file_ids)
        ):
            raise AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一发布登记", 409)
        return publication_out(db, existing)

    profile, account = _lock_platform_account(
        db,
        payload.platform_account_id,
        require_active_platform=True,
    )
    if not account.is_active:
        raise AppError("INVALID_STATE_TRANSITION", "平台账号不存在或已停用", 409)
    content, task = _lock_approved_publication_context(db, payload.content_version_id)
    if account.platform_profile_id != task.platform_profile_id:
        raise AppError("PUBLICATION_PLATFORM_MISMATCH", "发布账号平台与内容任务锁定平台不一致", 422)
    _guard_duplicate_platform_content(
        db,
        platform_profile_id=profile.id,
        content_hash=content.content_hash,
    )
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态内容任务不能创建新发布", 409)
    if not domain_allowed(str(payload.section_url), profile.allowed_domains):
        raise AppError("VALIDATION_ERROR", "栏目 URL 不属于平台允许域名", 422)
    files = _publication_evidence_files(db, payload.attachment_file_ids)
    publication = PublicationRecord(
        idempotency_key=idempotency_key,
        content_version_id=content.id,
        platform_account_id=account.id,
        section_url=str(payload.section_url),
        status="PENDING_MANUAL_PUBLISH",
        content_hash=content.content_hash,
        created_by=actor.id,
    )
    db.add(publication)
    db.flush()
    db.add(
        PublicationStatusEvent(
            publication_id=publication.id,
            status=publication.status,
            comment="创建人工发布登记",
            actor_id=actor.id,
        )
    )
    db.add_all(
        PublicationAttachment(publication_id=publication.id, file_id=file.id) for file in files
    )
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.PUBLICATION,
            action="publication.created",
            target_type="PublicationRecord",
            target_id=publication.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="人工发布登记已创建",
            details={
                "facts": {
                    "content_version_id": str(content.id),
                    "task_id": str(task.id),
                    "status": publication.status,
                    "attachment_count": len(files),
                }
            },
        ),
    )
    result = publication_out(db, publication)
    db.commit()
    return result


def command_publication(
    *,
    db: Session,
    publication_id: uuid.UUID,
    command: str,
    payload: PublicationCommand,
    actor: User,
    request_id: str,
) -> PublicationRecordOut:
    """锁定发布与任务后原子执行发布状态、任务终态和异常待办。"""
    publication = db.scalar(
        select(PublicationRecord).where(PublicationRecord.id == publication_id).with_for_update()
    )
    if publication is None:
        raise not_found("发布记录")
    target = PUBLICATION_TRANSITIONS.get((publication.status, command))
    if target is None:
        raise AppError(
            "INVALID_STATE_TRANSITION",
            f"发布记录不能从 {publication.status} 执行 {command}",
            409,
        )
    if payload.attachment_file_ids and command != "mark-published":
        raise AppError("VALIDATION_ERROR", "只有登记已发布可以追加结果证据", 422)
    task = db.scalar(
        select(ContentTask)
        .join(ContentVersion, ContentVersion.task_id == ContentTask.id)
        .where(ContentVersion.id == publication.content_version_id)
        .with_for_update()
    )
    if task is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布记录关联的内容任务不存在", 409)
    if command == "mark-published":
        if (
            payload.actual_title is None
            or payload.final_url is None
            or payload.published_at is None
        ):
            raise AppError(
                "VALIDATION_ERROR",
                "登记已发布必须填写实际标题、最终 URL 和发布时间",
                422,
            )
        account = db.get(PlatformAccount, publication.platform_account_id)
        profile = db.get(PlatformProfile, account.platform_profile_id) if account else None
        if profile is None or not domain_allowed(str(payload.final_url), profile.allowed_domains):
            raise AppError("VALIDATION_ERROR", "最终 URL 不属于平台允许域名", 422)
        files = _publication_evidence_files(db, payload.attachment_file_ids)
        if files:
            existing_file_id = db.scalar(
                select(PublicationAttachment.file_id).where(
                    PublicationAttachment.publication_id == publication.id,
                    PublicationAttachment.file_id.in_([file.id for file in files]),
                )
            )
            if existing_file_id is not None:
                raise AppError("PUBLICATION_ATTACHMENT_EXISTS", "结果证据已关联该发布记录", 409)
        _guard_duplicate_platform_content(
            db,
            platform_profile_id=task.platform_profile_id,
            content_hash=publication.content_hash,
            exclude_publication_id=publication.id,
        )
        if files:
            db.add_all(
                PublicationAttachment(publication_id=publication.id, file_id=file.id)
                for file in files
            )
        publication.actual_title = payload.actual_title
        publication.final_url = str(payload.final_url)
        publication.published_at = payload.published_at
    if command == "verify" and payload.content_matches is not True:
        raise AppError("VALIDATION_ERROR", "验证发布必须明确确认页面正文匹配批准内容", 422)

    previous_status = publication.status
    publication.status = target
    db.add(
        PublicationStatusEvent(
            publication_id=publication.id,
            status=target,
            comment=payload.comment,
            actor_id=actor.id,
        )
    )
    if target == "VERIFIED" and task.status == "OPEN":
        previous_task_status = task.status
        task.status = "COMPLETED"
        task.revision += 1
        append_audit(
            db,
            AuditEntry(
                actor_id=actor.id,
                business_module=AuditModule.PUBLICATION,
                action="content_task.completed_by_verified_publication",
                target_type="ContentTask",
                target_id=task.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="内容任务已完成发布闭环",
                details={
                    "changes": [
                        {
                            "field": "status",
                            "before": previous_task_status,
                            "after": task.status,
                        }
                    ],
                    "facts": {
                        "publication_id": str(publication.id),
                        "revision": task.revision,
                    },
                },
            ),
        )
    if target in {"REMOVED", "VERIFICATION_FAILED"}:
        attention = db.scalar(
            select(PublicationAttention).where(
                PublicationAttention.publication_record_id == publication.id
            )
        )
        if attention is None:
            attention = PublicationAttention(
                publication_record_id=publication.id,
                trigger_status=target,
                status="OPEN",
            )
            db.add(attention)
            db.flush()
            append_audit(
                db,
                AuditEntry(
                    actor_id=actor.id,
                    business_module=AuditModule.PUBLICATION,
                    action="publication_attention.opened",
                    target_type="PublicationAttention",
                    target_id=attention.id,
                    request_id=request_id,
                    outcome=AuditOutcome.SUCCESS,
                    result_message="发布异常待办已创建",
                    details={
                        "facts": {
                            "publication_id": str(publication.id),
                            "trigger_status": target,
                        }
                    },
                ),
            )
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.PUBLICATION,
            action=f"publication.{re.sub('-', '_', command)}",
            target_type="PublicationRecord",
            target_id=publication.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="发布状态命令已完成",
            details={
                "changes": [
                    {
                        "field": "status",
                        "before": previous_status,
                        "after": publication.status,
                    }
                ]
            },
        ),
    )
    result = publication_out(db, publication)
    db.commit()
    return result


def cancel_content_task(
    *,
    db: Session,
    task_id: uuid.UUID,
    expected_revision: int,
    comment: str,
    actor: User,
    request_id: str,
) -> ContentTask:
    """取消没有在途发布的 OPEN 任务。"""
    task = db.scalar(select(ContentTask).where(ContentTask.id == task_id).with_for_update())
    if task is None:
        raise not_found("内容任务")
    if task.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "内容任务已被其他请求修改", 409)
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态内容任务不能再次变更状态", 409)
    in_flight = db.scalar(
        select(PublicationRecord.id)
        .join(ContentVersion, ContentVersion.id == PublicationRecord.content_version_id)
        .where(
            ContentVersion.task_id == task.id,
            PublicationRecord.status.in_(IN_FLIGHT_PUBLICATION_STATUSES),
        )
        .limit(1)
    )
    if in_flight is not None:
        raise AppError("PUBLICATION_IN_FLIGHT", "任务存在进行中的发布，必须先处置发布记录", 409)
    previous_status = task.status
    task.status = "CANCELLED"
    task.revision += 1
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONTENT_PLANNING,
            action="content_task.cancelled",
            target_type="ContentTask",
            target_id=task.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="内容任务已取消",
            details={
                "changes": [
                    {
                        "field": "status",
                        "before": previous_status,
                        "after": task.status,
                    }
                ],
                "facts": {"revision": task.revision},
            },
        ),
    )
    db.commit()
    return task


def create_repair_task(
    *,
    db: Session,
    attention_id: uuid.UUID,
    payload: PublicationRepairTaskCreate,
    actor: User,
    request_id: str,
) -> ContentTask:
    """锁定异常与事实版本，继承原任务平台创建修复任务。"""
    attention = db.scalar(
        select(PublicationAttention)
        .where(PublicationAttention.id == attention_id)
        .with_for_update()
    )
    if attention is None:
        raise not_found("发布异常待办")
    if attention.revision != payload.expected_attention_revision:
        raise AppError("REVISION_CONFLICT", "发布异常待办已被其他请求修改", 409)
    if attention.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "只有 OPEN 异常可以创建修复任务", 409)
    existing_task = db.scalar(
        select(ContentTask).where(ContentTask.source_publication_attention_id == attention.id)
    )
    if existing_task is not None:
        raise AppError("REPAIR_TASK_EXISTS", "该异常已经创建修复任务", 409)
    publication = db.get(PublicationRecord, attention.publication_record_id)
    if publication is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "异常待办关联的发布记录不存在", 409)
    original_task = task_for_publication(db, publication)
    product = db.get(Product, original_task.product_id)
    if product is None or product.status != "ACTIVE":
        raise AppError("INVALID_STATE_TRANSITION", "已停用产品不能创建修复任务", 409)
    profile = lock_active_platform(db, original_task.platform_profile_id)
    if (
        original_task.query_topic_id is not None
        and db.get(QueryTopic, original_task.query_topic_id) is None
    ):
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "原任务目标问题不存在", 409)
    fact = db.scalar(
        select(FactVersion).where(FactVersion.id == payload.fact_version_id).with_for_update()
    )
    if (
        fact is None
        or fact.status != "APPROVED"
        or not fact.body_markdown.strip()
        or fact.product_id != original_task.product_id
    ):
        raise AppError("FACT_NOT_APPROVED", "修复任务必须选择当前已批准的同产品事实版本", 409)
    task = ContentTask(
        query_topic_id=original_task.query_topic_id,
        product_id=original_task.product_id,
        fact_version_id=fact.id,
        platform_profile_id=profile.id,
        source_publication_attention_id=attention.id,
        created_by=actor.id,
    )
    db.add(task)
    db.flush()
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.PUBLICATION,
            action="publication_attention.repair_task_created",
            target_type="PublicationAttention",
            target_id=attention.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="发布修复任务已创建",
            details={
                "facts": {
                    "repair_task_id": str(task.id),
                    "fact_version_id": str(fact.id),
                    "platform_profile_id": str(profile.id),
                }
            },
        ),
    )
    db.commit()
    return task


def resolve_attention(
    *,
    db: Session,
    attention_id: uuid.UUID,
    payload: ResolvePublicationAttentionRequest,
    actor: User,
    request_id: str,
) -> PublicationAttentionOut:
    """使用非空处置说明显式解决异常，修复任务状态不隐式参与。"""
    attention = db.scalar(
        select(PublicationAttention)
        .where(PublicationAttention.id == attention_id)
        .with_for_update()
    )
    if attention is None:
        raise not_found("发布异常待办")
    if attention.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "发布异常待办已被其他请求修改", 409)
    if attention.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "只有 OPEN 异常可以解决", 409)
    comment = payload.resolution_comment.strip()
    if not comment:
        raise AppError("RESOLUTION_COMMENT_REQUIRED", "处置说明不能为空", 422)
    actor_id = actor.id
    previous_status = attention.status
    attention.status = "RESOLVED"
    attention.revision += 1
    attention.resolved_at = datetime.now(UTC)
    attention.resolved_by = actor_id
    attention.resolution_comment = comment
    append_audit(
        db,
        AuditEntry(
            actor_id=actor_id,
            business_module=AuditModule.PUBLICATION,
            action="publication_attention.resolved",
            target_type="PublicationAttention",
            target_id=attention.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="发布异常待办已解决",
            details={
                "changes": [
                    {
                        "field": "status",
                        "before": previous_status,
                        "after": attention.status,
                    }
                ],
                "facts": {"revision": attention.revision},
            },
        ),
    )
    db.commit()
    return attention_out(db, attention)
