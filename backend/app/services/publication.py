"""发布工作、首次核验、发布成果与内容问题的领域应用服务。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, in_use, not_found
from app.models.ai_generation import GenerationJob
from app.models.configuration import PlatformProfile, QueryTopic
from app.models.content import (
    ContentReviewRecord,
    ContentTask,
    ContentTaskGeoSource,
    ContentVersion,
)
from app.models.geo_files import FileRecord
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.models.publication import (
    PlatformAccount,
    PublicationAttachment,
    PublicationVerification,
    PublicationWork,
    PublicationWorkEvent,
    PublishedArticle,
    PublishedContentIssue,
)
from app.schemas.common import RevisionRequest
from app.schemas.publication import (
    PlatformAccountCreate,
    PlatformAccountUpdate,
    PublicationContentVersionSwitchRequest,
    PublicationPlatformReviewRequest,
    PublicationPreparationUpdate,
    PublicationResultUpdate,
    PublicationVerificationCreate,
    PublicationWorkCloseRequest,
    PublicationWorkCreate,
    PublicationWorkOut,
    PublishedContentIssueCreate,
    PublishedContentIssueOut,
    PublishedContentIssueResolveRequest,
    PublishedContentRepairTaskCreate,
)
from app.services.file_records import verified_files
from app.services.platform_configuration import lock_active_platform
from app.services.projections import IN_FLIGHT_PUBLICATION_STATUSES
from app.services.publication_queries import (
    NONTERMINAL_WORK_STATUSES,
    publication_work_out,
    published_content_issue_out,
    task_for_work,
)


def _audit(
    db: Session,
    *,
    actor: User,
    request_id: str,
    action: str,
    target_type: str,
    target_id: uuid.UUID,
    message: str,
    details: dict[str, Any] | None = None,
) -> None:
    """追加发布模块成功审计，与业务写入同一事务提交。"""
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.PUBLICATION,
            action=action,
            target_type=target_type,
            target_id=target_id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message=message,
            details=details or {},
        ),
    )


def _publication_evidence_files(db: Session, file_ids: list[uuid.UUID]) -> list[FileRecord]:
    """返回可关联发布工作的已校验操作截图。"""
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
    db: Session, content_id: uuid.UUID
) -> tuple[ContentVersion, ContentTask]:
    """锁定发布内容及其任务并校验批准事实。"""
    content = db.get(ContentVersion, content_id)
    if content is None:
        raise not_found("内容版本")
    fact = db.get(FactVersion, content.fact_version_id)
    task = db.scalar(select(ContentTask).where(ContentTask.id == content.task_id).with_for_update())
    if content.status != "APPROVED" or fact is None or fact.status != "APPROVED":
        raise AppError("CONTENT_NOT_APPROVED", "只有绑定有效批准事实的批准内容可以发布", 409)
    if task is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "内容版本关联的任务不存在", 409)
    if task.current_content_version_id != content.id:
        raise AppError("CONTENT_VERSION_NOT_CURRENT", "只有任务当前批准版本可以开始发布", 409)
    return content, task


def require_publishable(db: Session, content_id: uuid.UUID) -> ContentVersion:
    """读取可发布内容，并重新校验任务仍处于开放状态。"""
    content, task = _lock_approved_publication_context(db, content_id)
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态内容任务不能开始新发布", 409)
    return content


def _platform_account_identifier_exists(
    db: Session,
    *,
    platform_profile_id: uuid.UUID,
    account_identifier: str,
    exclude_account_id: uuid.UUID | None = None,
) -> bool:
    query = select(PlatformAccount.id).where(
        PlatformAccount.platform_profile_id == platform_profile_id,
        func.lower(func.btrim(PlatformAccount.account_identifier))
        == func.lower(account_identifier),
    )
    if exclude_account_id is not None:
        query = query.where(PlatformAccount.id != exclude_account_id)
    return db.scalar(query.limit(1)) is not None


def _flush_platform_account(db: Session) -> None:
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
    """按平台、账号的固定顺序锁行。"""
    platform_profile_id = db.scalar(
        select(PlatformAccount.platform_profile_id).where(PlatformAccount.id == platform_account_id)
    )
    if platform_profile_id is None:
        raise not_found("平台账号")
    profile = (
        lock_active_platform(db, platform_profile_id)
        if require_active_platform
        else db.scalar(
            select(PlatformProfile)
            .where(PlatformProfile.id == platform_profile_id)
            .with_for_update()
        )
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
    """在启用平台下创建发布账号。"""
    lock_active_platform(db, payload.platform_profile_id)
    if _platform_account_identifier_exists(
        db,
        platform_profile_id=payload.platform_profile_id,
        account_identifier=payload.account_identifier,
    ):
        raise AppError("PLATFORM_ACCOUNT_IDENTIFIER_EXISTS", "该平台已存在相同的运营账号标识", 409)
    account = PlatformAccount(**payload.model_dump())
    db.add(account)
    _flush_platform_account(db)
    _audit(
        db,
        actor=actor,
        request_id=request_id,
        action="platform_account.created",
        target_type="PlatformAccount",
        target_id=account.id,
        message="发布账号已创建",
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
    """按 revision 修改账号标签和运营标识。"""
    profile, account = _lock_platform_account(db, platform_account_id)
    if account.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "发布账号已被其他请求修改", 409)
    if _platform_account_identifier_exists(
        db,
        platform_profile_id=profile.id,
        account_identifier=payload.account_identifier,
        exclude_account_id=account.id,
    ):
        raise AppError("PLATFORM_ACCOUNT_IDENTIFIER_EXISTS", "该平台已存在相同的运营账号标识", 409)
    account.label = payload.label
    account.account_identifier = payload.account_identifier
    account.revision += 1
    _flush_platform_account(db)
    _audit(
        db,
        actor=actor,
        request_id=request_id,
        action="platform_account.updated",
        target_type="PlatformAccount",
        target_id=account.id,
        message="发布账号已更新",
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
    """按 revision 启停账号，不改写历史发布身份。"""
    _profile, account = _lock_platform_account(db, platform_account_id)
    if account.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "发布账号已被其他请求修改", 409)
    account.is_active = enabled
    account.revision += 1
    _audit(
        db,
        actor=actor,
        request_id=request_id,
        action=f"platform_account.{'enabled' if enabled else 'disabled'}",
        target_type="PlatformAccount",
        target_id=account.id,
        message=f"发布账号已{'启用' if enabled else '停用'}",
    )
    db.commit()
    return account


def delete_platform_account(
    *, db: Session, platform_account_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """仅删除没有发布工作引用的账号。"""
    _profile, account = _lock_platform_account(db, platform_account_id)
    work_count = int(
        db.scalar(
            select(func.count())
            .select_from(PublicationWork)
            .where(PublicationWork.platform_account_id == account.id)
        )
        or 0
    )
    if work_count:
        raise in_use(
            "PLATFORM_ACCOUNT_IN_USE",
            "平台账号",
            [("PUBLICATION_WORK", "发布工作", work_count)],
        )
    _audit(
        db,
        actor=actor,
        request_id=request_id,
        action="platform_account.deleted",
        target_type="PlatformAccount",
        target_id=account.id,
        message="发布账号已删除",
    )
    db.delete(account)
    db.commit()


def _advisory_lock(db: Session, key: str) -> None:
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": key},
    )


def _lock_publication_identity(
    db: Session, *, platform_profile_id: uuid.UUID, content_hash: str
) -> None:
    _advisory_lock(db, f"publication:{platform_profile_id}:{content_hash}")


def _ensure_unique_identity(
    db: Session,
    *,
    content_version_id: uuid.UUID,
    platform_profile_id: uuid.UUID,
    content_hash: str,
) -> None:
    if (
        db.scalar(
            select(PublicationWork.id).where(
                PublicationWork.content_version_id == content_version_id
            )
        )
        is not None
        or db.scalar(
            select(PublicationWork.id).where(
                PublicationWork.platform_profile_id == platform_profile_id,
                PublicationWork.content_hash == content_hash,
                PublicationWork.status != "CLOSED",
            )
        )
        is not None
    ):
        raise AppError(
            "PUBLICATION_IDENTITY_CONFLICT",
            "该内容版本或同平台内容已存在发布工作",
            409,
        )


def _work_event(
    db: Session,
    *,
    work: PublicationWork,
    action: str,
    from_status: str | None,
    comment: str,
    actor: User,
    from_content_version_id: uuid.UUID | None = None,
    to_content_version_id: uuid.UUID | None = None,
) -> None:
    db.add(
        PublicationWorkEvent(
            publication_work_id=work.id,
            action=action,
            from_status=from_status,
            to_status=work.status,
            from_content_version_id=from_content_version_id,
            to_content_version_id=to_content_version_id,
            comment=comment,
            actor_id=actor.id,
        )
    )


def _lock_work(db: Session, work_id: uuid.UUID, expected_revision: int) -> PublicationWork:
    work = db.scalar(select(PublicationWork).where(PublicationWork.id == work_id).with_for_update())
    if work is None:
        raise not_found("发布工作")
    if work.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "发布工作已被其他请求修改", 409)
    return work


def _finish_work_command(db: Session, work: PublicationWork) -> PublicationWorkOut:
    db.flush()
    db.refresh(work)
    result = publication_work_out(db, work)
    db.commit()
    return result


def create_publication_work(
    *,
    db: Session,
    payload: PublicationWorkCreate,
    actor: User,
    request_id: str,
    idempotency_key: str,
) -> PublicationWorkOut:
    """幂等创建一次 PREPARING 发布工作。"""
    _advisory_lock(db, f"publication-request:{idempotency_key}")
    existing = db.scalar(
        select(PublicationWork).where(PublicationWork.idempotency_key == idempotency_key)
    )
    if existing is not None:
        if (
            existing.content_version_id != payload.content_version_id
            or existing.platform_account_id != payload.platform_account_id
        ):
            raise AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一发布工作", 409)
        return publication_work_out(db, existing)
    platform_profile_id = db.scalar(
        select(PlatformAccount.platform_profile_id).where(
            PlatformAccount.id == payload.platform_account_id
        )
    )
    content_hash = db.scalar(
        select(ContentVersion.content_hash).where(ContentVersion.id == payload.content_version_id)
    )
    if platform_profile_id is None:
        raise not_found("平台账号")
    if content_hash is None:
        raise not_found("内容版本")
    _lock_publication_identity(
        db,
        platform_profile_id=platform_profile_id,
        content_hash=content_hash,
    )
    profile, account = _lock_platform_account(
        db,
        payload.platform_account_id,
        require_active_platform=True,
    )
    if not account.is_active:
        raise AppError("PLATFORM_ACCOUNT_DISABLED", "平台账号已停用", 409)
    content, task = _lock_approved_publication_context(db, payload.content_version_id)
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态内容任务不能开始新发布", 409)
    if task.platform_profile_id != profile.id:
        raise AppError("PUBLICATION_PLATFORM_MISMATCH", "发布账号平台与内容任务锁定平台不一致", 422)
    _ensure_unique_identity(
        db,
        content_version_id=content.id,
        platform_profile_id=profile.id,
        content_hash=content.content_hash,
    )
    work = PublicationWork(
        idempotency_key=idempotency_key,
        content_task_id=task.id,
        content_version_id=content.id,
        platform_profile_id=profile.id,
        platform_account_id=account.id,
        content_hash=content.content_hash,
        status="PREPARING",
        created_by=actor.id,
    )
    db.add(work)
    db.flush()
    _work_event(
        db,
        work=work,
        action="CREATED",
        from_status=None,
        comment="开始发布工作",
        actor=actor,
    )
    _audit(
        db,
        actor=actor,
        request_id=request_id,
        action="publication_work.created",
        target_type="PublicationWork",
        target_id=work.id,
        message="发布工作已创建",
    )
    return _finish_work_command(db, work)


def switch_publication_content_version(
    *,
    db: Session,
    work_id: uuid.UUID,
    payload: PublicationContentVersionSwitchRequest,
    actor: User,
    request_id: str,
) -> PublicationWorkOut:
    """在首次核验成功前切换到同任务当前批准版本，并保留版本事件。"""
    work = _lock_work(db, work_id, payload.expected_revision)
    if work.status not in NONTERMINAL_WORK_STATUSES:
        raise AppError("INVALID_STATE_TRANSITION", "终态发布工作不能切换内容版本", 409)
    candidate = db.get(ContentVersion, payload.content_version_id)
    if candidate is None:
        raise not_found("内容版本")
    task = db.scalar(
        select(ContentTask).where(ContentTask.id == work.content_task_id).with_for_update()
    )
    fact = db.get(FactVersion, candidate.fact_version_id)
    if (
        task is None
        or candidate.task_id != work.content_task_id
        or task.current_content_version_id != candidate.id
        or candidate.status != "APPROVED"
        or fact is None
        or fact.status != "APPROVED"
    ):
        raise AppError(
            "CONTENT_VERSION_NOT_SWITCHABLE",
            "只能切换到同一任务的当前批准内容版本",
            409,
        )
    if candidate.id == work.content_version_id:
        raise AppError("CONTENT_VERSION_UNCHANGED", "发布工作已使用该内容版本", 409)
    previous_content_version_id = work.content_version_id
    work.content_version_id = candidate.id
    work.content_hash = candidate.content_hash
    work.revision += 1
    _work_event(
        db,
        work=work,
        action="CONTENT_VERSION_CHANGED",
        from_status=work.status,
        comment=payload.comment,
        actor=actor,
        from_content_version_id=previous_content_version_id,
        to_content_version_id=candidate.id,
    )
    _audit(
        db,
        actor=actor,
        request_id=request_id,
        action="publication_work.content_version_changed",
        target_type="PublicationWork",
        target_id=work.id,
        message="发布工作内容版本已切换",
        details={
            "changes": [
                {
                    "field": "content_version_id",
                    "before": str(previous_content_version_id),
                    "after": str(candidate.id),
                }
            ]
        },
    )
    return _finish_work_command(db, work)


def update_publication_preparation(
    *,
    db: Session,
    work_id: uuid.UUID,
    payload: PublicationPreparationUpdate,
    actor: User,
    request_id: str,
) -> PublicationWorkOut:
    """在准备或平台处理中修正发布账号。"""
    work = _lock_work(db, work_id, payload.expected_revision)
    if work.status not in {"PREPARING", "PLATFORM_REVIEW"}:
        raise AppError("INVALID_STATE_TRANSITION", "当前发布工作不能修改准备信息", 409)
    profile, account = _lock_platform_account(db, payload.platform_account_id)
    if profile.id != work.platform_profile_id:
        raise AppError("PUBLICATION_PLATFORM_MISMATCH", "发布账号必须属于工作锁定平台", 422)
    if not account.is_active:
        raise AppError("PLATFORM_ACCOUNT_DISABLED", "平台账号已停用", 409)
    work.platform_account_id = account.id
    work.revision += 1
    _work_event(
        db,
        work=work,
        action="PREPARATION_UPDATED",
        from_status=work.status,
        comment=payload.comment,
        actor=actor,
    )
    _audit(
        db,
        actor=actor,
        request_id=request_id,
        action="publication_work.preparation_updated",
        target_type="PublicationWork",
        target_id=work.id,
        message="发布准备信息已更新",
    )
    return _finish_work_command(db, work)


def mark_publication_platform_review(
    *,
    db: Session,
    work_id: uuid.UUID,
    payload: PublicationPlatformReviewRequest,
    actor: User,
    request_id: str,
) -> PublicationWorkOut:
    """将 PREPARING 工作标记为等待外部平台处理。"""
    work = _lock_work(db, work_id, payload.expected_revision)
    if work.status != "PREPARING":
        raise AppError("INVALID_STATE_TRANSITION", "只有准备中的工作可以标记平台处理中", 409)
    previous = work.status
    work.status = "PLATFORM_REVIEW"
    work.revision += 1
    _work_event(
        db,
        work=work,
        action="PLATFORM_REVIEW_MARKED",
        from_status=previous,
        comment=payload.comment,
        actor=actor,
    )
    _audit(
        db,
        actor=actor,
        request_id=request_id,
        action="publication_work.platform_review_marked",
        target_type="PublicationWork",
        target_id=work.id,
        message="发布工作已进入平台处理中",
    )
    return _finish_work_command(db, work)


def register_publication_result(
    *,
    db: Session,
    work_id: uuid.UUID,
    payload: PublicationResultUpdate,
    actor: User,
    request_id: str,
) -> PublicationWorkOut:
    """登记或修正待首次核验的公开结果。"""
    work = _lock_work(db, work_id, payload.expected_revision)
    if work.status not in NONTERMINAL_WORK_STATUSES:
        raise AppError("INVALID_STATE_TRANSITION", "终态发布工作不能登记结果", 409)
    profile = db.get(PlatformProfile, work.platform_profile_id)
    if profile is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布工作锁定平台不存在", 409)
    if not domain_allowed(str(payload.final_url), profile.allowed_domains):
        raise AppError("VALIDATION_ERROR", "最终 URL 不属于平台允许域名", 422)
    files = _publication_evidence_files(db, payload.attachment_file_ids)
    if (
        files
        and db.scalar(
            select(PublicationAttachment.file_id).where(
                PublicationAttachment.publication_work_id == work.id,
                PublicationAttachment.file_id.in_([file.id for file in files]),
            )
        )
        is not None
    ):
        raise AppError("PUBLICATION_ATTACHMENT_EXISTS", "结果证据已关联该发布工作", 409)
    previous = work.status
    work.actual_title = payload.actual_title
    work.final_url = str(payload.final_url)
    work.published_at = payload.published_at
    work.status = "AWAITING_VERIFICATION"
    work.revision += 1
    db.add_all(
        PublicationAttachment(publication_work_id=work.id, file_id=file.id) for file in files
    )
    _work_event(
        db,
        work=work,
        action="RESULT_REGISTERED",
        from_status=previous,
        comment=payload.comment,
        actor=actor,
    )
    _audit(
        db,
        actor=actor,
        request_id=request_id,
        action="publication_work.result_registered",
        target_type="PublicationWork",
        target_id=work.id,
        message="发布结果已登记",
    )
    return _finish_work_command(db, work)


def verify_publication_work(
    *,
    db: Session,
    work_id: uuid.UUID,
    payload: PublicationVerificationCreate,
    actor: User,
    request_id: str,
) -> PublicationWorkOut:
    """追加首次核验快照；失败继续待处理，成功形成只读成果。"""
    work = _lock_work(db, work_id, payload.expected_revision)
    if work.status not in {"AWAITING_VERIFICATION", "ACTION_REQUIRED"}:
        raise AppError("INVALID_STATE_TRANSITION", "当前发布工作不能核验", 409)
    if work.actual_title is None or work.final_url is None or work.published_at is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布工作缺少可核验结果", 409)
    task = db.scalar(
        select(ContentTask).where(ContentTask.id == work.content_task_id).with_for_update()
    )
    if task is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布工作关联的内容任务不存在", 409)
    previous = work.status
    verification = PublicationVerification(
        publication_work_id=work.id,
        content_version_id=work.content_version_id,
        outcome=payload.outcome.value,
        actual_title_snapshot=work.actual_title,
        final_url_snapshot=work.final_url,
        published_at_snapshot=work.published_at,
        comment=payload.comment,
        actor_id=actor.id,
    )
    db.add(verification)
    db.flush()
    if payload.outcome.value == "FAILED":
        work.status = "ACTION_REQUIRED"
        action = "VERIFICATION_FAILED"
        message = "首次核验失败，发布工作继续待处理"
    else:
        if task.status != "OPEN":
            raise AppError("INVALID_STATE_TRANSITION", "来源内容任务已终止，不能完成发布", 409)
        work.status = "COMPLETED"
        task.status = "COMPLETED"
        task.revision += 1
        db.add(PublishedArticle(id=work.id, verification_id=verification.id))
        action = "COMPLETED"
        message = "首次核验成功，已形成发布成果"
    work.revision += 1
    _work_event(
        db,
        work=work,
        action=action,
        from_status=previous,
        comment=payload.comment or "首次核验通过",
        actor=actor,
    )
    _audit(
        db,
        actor=actor,
        request_id=request_id,
        action=(
            "publication_work.verification_failed"
            if payload.outcome.value == "FAILED"
            else "publication_work.completed"
        ),
        target_type="PublicationWork",
        target_id=work.id,
        message=message,
    )
    return _finish_work_command(db, work)


def close_publication_work(
    *,
    db: Session,
    work_id: uuid.UUID,
    payload: PublicationWorkCloseRequest,
    actor: User,
    request_id: str,
) -> PublicationWorkOut:
    """带原因关闭未完成工作并取消其来源内容任务。"""
    work = _lock_work(db, work_id, payload.expected_revision)
    if work.status not in NONTERMINAL_WORK_STATUSES:
        raise AppError("INVALID_STATE_TRANSITION", "终态发布工作不能关闭", 409)
    task = db.scalar(
        select(ContentTask).where(ContentTask.id == work.content_task_id).with_for_update()
    )
    if task is None or task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "来源内容任务已终止，不能关闭发布工作", 409)
    previous = work.status
    now = datetime.now(UTC)
    work.status = "CLOSED"
    work.close_reason = payload.reason.value
    work.close_comment = payload.comment
    work.closed_by = actor.id
    work.closed_at = now
    work.revision += 1
    task.status = "CANCELLED"
    task.revision += 1
    _work_event(
        db,
        work=work,
        action="CLOSED",
        from_status=previous,
        comment=payload.comment,
        actor=actor,
    )
    _audit(
        db,
        actor=actor,
        request_id=request_id,
        action="publication_work.closed",
        target_type="PublicationWork",
        target_id=work.id,
        message="发布工作已关闭",
        details={"facts": {"reason": payload.reason.value}},
    )
    return _finish_work_command(db, work)


def open_published_content_issue(
    *,
    db: Session,
    article_id: uuid.UUID,
    payload: PublishedContentIssueCreate,
    actor: User,
    request_id: str,
) -> PublishedContentIssueOut:
    """为健康发布成果打开唯一的当前内容问题。"""
    article = db.scalar(
        select(PublishedArticle).where(PublishedArticle.id == article_id).with_for_update()
    )
    if article is None:
        raise not_found("发布成果")
    issues = list(
        db.scalars(
            select(PublishedContentIssue).where(
                PublishedContentIssue.published_article_id == article.id
            )
        )
    )
    if any(issue.status == "OPEN" for issue in issues) or any(
        issue.resolution_outcome == "RETIRED" for issue in issues
    ):
        raise AppError(
            "PUBLISHED_CONTENT_ISSUE_CONFLICT",
            "文章已有开放问题或已退役",
            409,
        )
    issue = PublishedContentIssue(
        published_article_id=article.id,
        kind=payload.kind.value,
        description=payload.description,
        status="OPEN",
        opened_by=actor.id,
    )
    db.add(issue)
    db.flush()
    _audit(
        db,
        actor=actor,
        request_id=request_id,
        action="published_content_issue.opened",
        target_type="PublishedContentIssue",
        target_id=issue.id,
        message="发布后内容问题已打开",
    )
    result = published_content_issue_out(db, issue)
    db.commit()
    return result


def create_repair_task(
    *,
    db: Session,
    issue_id: uuid.UUID,
    payload: PublishedContentRepairTaskCreate,
    actor: User,
    request_id: str,
) -> ContentTask:
    """从开放内容问题创建继承原产品和平台的唯一修复任务。"""
    issue = db.scalar(
        select(PublishedContentIssue).where(PublishedContentIssue.id == issue_id).with_for_update()
    )
    if issue is None:
        raise not_found("发布后内容问题")
    if issue.revision != payload.expected_issue_revision:
        raise AppError("REVISION_CONFLICT", "发布后内容问题已被其他请求修改", 409)
    if issue.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "只有开放问题可以创建修复任务", 409)
    if (
        db.scalar(
            select(ContentTask.id).where(ContentTask.source_published_content_issue_id == issue.id)
        )
        is not None
    ):
        raise AppError("REPAIR_TASK_EXISTS", "该问题已经创建修复任务", 409)
    article = db.get(PublishedArticle, issue.published_article_id)
    work = db.get(PublicationWork, article.id) if article else None
    if work is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "内容问题关联的发布成果不存在", 409)
    original_task = task_for_work(db, work)
    product = db.get(Product, original_task.product_id)
    if product is None or product.status != "ACTIVE":
        raise AppError("INVALID_STATE_TRANSITION", "已停用产品不能创建修复任务", 409)
    profile = lock_active_platform(db, work.platform_profile_id)
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
        source_published_content_issue_id=issue.id,
        created_by=actor.id,
    )
    db.add(task)
    db.flush()
    _audit(
        db,
        actor=actor,
        request_id=request_id,
        action="published_content_issue.repair_task_created",
        target_type="PublishedContentIssue",
        target_id=issue.id,
        message="发布修复任务已创建",
        details={"facts": {"repair_task_id": str(task.id)}},
    )
    db.commit()
    return task


def resolve_published_content_issue(
    *,
    db: Session,
    issue_id: uuid.UUID,
    payload: PublishedContentIssueResolveRequest,
    actor: User,
    request_id: str,
) -> PublishedContentIssueOut:
    """显式解决内容问题，不从修复任务状态推断结果。"""
    issue = db.scalar(
        select(PublishedContentIssue).where(PublishedContentIssue.id == issue_id).with_for_update()
    )
    if issue is None:
        raise not_found("发布后内容问题")
    if issue.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "发布后内容问题已被其他请求修改", 409)
    if issue.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "只有开放问题可以解决", 409)
    issue.status = "RESOLVED"
    issue.revision += 1
    issue.resolved_by = actor.id
    issue.resolved_at = datetime.now(UTC)
    issue.resolution_outcome = payload.outcome.value
    issue.resolution_comment = payload.comment
    _audit(
        db,
        actor=actor,
        request_id=request_id,
        action="published_content_issue.resolved",
        target_type="PublishedContentIssue",
        target_id=issue.id,
        message="发布后内容问题已解决",
        details={"facts": {"outcome": payload.outcome.value}},
    )
    db.flush()
    result = published_content_issue_out(db, issue)
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
    """取消没有进行中发布工作的开放内容任务。"""
    task = db.scalar(select(ContentTask).where(ContentTask.id == task_id).with_for_update())
    if task is None:
        raise not_found("内容任务")
    if task.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "内容任务已被其他请求修改", 409)
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态内容任务不能再次变更状态", 409)
    in_flight = db.scalar(
        select(PublicationWork.id)
        .where(
            PublicationWork.content_task_id == task.id,
            PublicationWork.status.in_(IN_FLIGHT_PUBLICATION_STATUSES),
        )
        .limit(1)
    )
    if in_flight is not None:
        raise AppError("PUBLICATION_IN_FLIGHT", "任务存在进行中的发布，必须先关闭发布工作", 409)
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
            details={"facts": {"comment": comment, "revision": task.revision}},
        ),
    )
    db.commit()
    return task


def delete_content_task(*, db: Session, task_id: uuid.UUID, actor: User, request_id: str) -> None:
    """删除已取消且没有受保护历史的任务及其草稿生成数据。"""
    task = db.scalar(
        select(ContentTask).where(ContentTask.id == task_id).with_for_update()
    )
    if task is None:
        raise not_found("内容任务")
    if task.status != "CANCELLED":
        raise AppError("INVALID_STATE_TRANSITION", "只有已取消的内容任务可以删除", 409)
    jobs = list(
        db.scalars(
            select(GenerationJob)
            .where(GenerationJob.content_task_id == task_id)
            .order_by(GenerationJob.id)
            .with_for_update()
        )
    )
    versions = list(
        db.scalars(
            select(ContentVersion)
            .where(ContentVersion.task_id == task_id)
            .order_by(ContentVersion.id)
            .with_for_update()
        )
    )
    version_ids = [version.id for version in versions]
    protected_content_count = sum(
        version.status in {"APPROVED", "SUPERSEDED"} for version in versions
    )
    work_count = int(
        db.scalar(
            select(func.count(PublicationWork.id)).where(
                PublicationWork.content_task_id == task.id
            )
        )
        or 0
    )
    repair_source_count = int(task.source_published_content_issue_id is not None)
    geo_source_count = int(
        db.scalar(
            select(func.count(ContentTaskGeoSource.content_task_id)).where(
                ContentTaskGeoSource.content_task_id == task.id
            )
        )
        or 0
    )
    if protected_content_count or work_count or repair_source_count or geo_source_count:
        raise in_use(
            "CONTENT_TASK_IN_USE",
            "内容任务",
            [
                ("PROTECTED_CONTENT_VERSION", "已批准内容历史", protected_content_count),
                ("PUBLICATION_WORK", "发布工作", work_count),
                ("PUBLISHED_CONTENT_ISSUE", "发布问题修复来源", repair_source_count),
                ("GEO_OPTIMIZATION_SOURCE", "GEO 优化来源", geo_source_count),
            ],
        )
    review_count = (
        int(
            db.scalar(
                select(func.count(ContentReviewRecord.id)).where(
                    ContentReviewRecord.content_version_id.in_(version_ids)
                )
            )
            or 0
        )
        if version_ids
        else 0
    )
    db.scalar(select(func.set_config("partsignal.content_task_delete_id", str(task.id), True)))
    task.current_content_version_id = None
    db.flush()
    if version_ids:
        db.execute(
            update(ContentVersion)
            .where(ContentVersion.id.in_(version_ids))
            .values(source_job_id=None)
        )
    db.execute(delete(GenerationJob).where(GenerationJob.content_task_id == task.id))
    if version_ids:
        db.execute(
            delete(ContentReviewRecord).where(
                ContentReviewRecord.content_version_id.in_(version_ids)
            )
        )
        db.execute(delete(ContentVersion).where(ContentVersion.id.in_(version_ids)))
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONTENT_PLANNING,
            action="content_task.deleted",
            target_type="ContentTask",
            target_id=task.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="内容任务已删除",
            details={
                "facts": {
                    "generation_job_count": len(jobs),
                    "content_version_count": len(versions),
                    "content_review_record_count": review_count,
                }
            },
        ),
    )
    db.execute(delete(ContentTask).where(ContentTask.id == task.id))
    db.commit()
