"""发布工作、首次核验、发布成果与内容问题的领域应用服务。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
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
from app.models.geo_files import (
    FileRecord,
    GeoObservationAttachment,
    GeoObservationCitation,
    GeoObservationPublication,
)
from app.models.identity import AuditLog, User
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
from app.schemas.common import DeletionBlocker, RevisionRequest
from app.schemas.content import (
    ContentTaskPermanentDeleteRequest,
    ContentTaskPermanentDeletionCounts,
    ContentTaskPermanentDeletionPreview,
)
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
    PublishedArticlePermanentDeleteRequest,
    PublishedArticlePermanentDeletionCounts,
    PublishedArticlePermanentDeletionPreview,
    PublishedContentIssueCreate,
    PublishedContentIssueOut,
    PublishedContentIssueResolveRequest,
    PublishedContentRepairTaskCreate,
)
from app.services.file_records import schedule_unreferenced_file, verified_files
from app.services.geo_observation import (
    _delete_manual_observation_chain,
    _lock_manual_observation_chain,
)
from app.services.platform_configuration import lock_active_platform
from app.services.projections import IN_FLIGHT_PUBLICATION_STATUSES
from app.services.publication_queries import (
    NONTERMINAL_WORK_STATUSES,
    publication_work_out,
    published_article_deletion_blockers,
    published_content_issue_out,
    task_for_work,
)


@dataclass(slots=True)
class _TaskDeletionScope:
    """一次任务聚合删除在当前事务内重新计算出的精确范围。"""

    jobs: list[GenerationJob]
    versions: list[ContentVersion]
    reviews: list[ContentReviewRecord]
    works: list[PublicationWork]
    events: list[PublicationWorkEvent]
    verifications: list[PublicationVerification]
    articles: list[PublishedArticle]
    issues: list[PublishedContentIssue]
    publication_file_ids: list[uuid.UUID]
    exclusive_geo_chain_roots: list[uuid.UUID]
    exclusive_geo_observation_ids: list[uuid.UUID]
    exclusive_geo_file_ids: list[uuid.UUID]
    geo_article_relation_count: int
    external_urls: list[str]


@dataclass(slots=True)
class _PublishedArticleDeletionScope:
    """一次成果永久删除在当前事务内锁定的完整范围。"""

    task: ContentTask
    work: PublicationWork
    article: PublishedArticle
    events: list[PublicationWorkEvent]
    verifications: list[PublicationVerification]
    issues: list[PublishedContentIssue]
    publication_file_ids: list[uuid.UUID]
    detached_repair_task_count: int
    blockers: list[DeletionBlocker]


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
    db.commit()
    return account


def delete_platform_account(
    *, db: Session, platform_account_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """删除没有非终态发布工作的账号，终态历史继续使用快照。"""
    _profile, account = _lock_platform_account(db, platform_account_id)
    work_count = int(
        db.scalar(
            select(func.count())
            .select_from(PublicationWork)
            .where(
                PublicationWork.platform_account_id == account.id,
                PublicationWork.status.in_(NONTERMINAL_WORK_STATUSES),
            )
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
        platform_profile_name_snapshot=profile.name,
        platform_account_id=account.id,
        platform_account_label_snapshot=account.label,
        account_identifier_snapshot=account.account_identifier,
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
    work.platform_account_label_snapshot = account.label
    work.account_identifier_snapshot = account.account_identifier
    work.revision += 1
    _work_event(
        db,
        work=work,
        action="PREPARATION_UPDATED",
        from_status=work.status,
        comment=payload.comment,
        actor=actor,
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
    if payload.outcome.value == "PASSED":
        _audit(
            db,
            actor=actor,
            request_id=request_id,
            action="publication_work.completed",
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
    if work.platform_profile_id is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "原发布平台已删除，不能创建修复任务", 409)
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
        platform_profile_name_snapshot=profile.name,
        platform_website_url_snapshot=profile.website_url,
        source_published_content_issue_id=issue.id,
        created_by=actor.id,
    )
    db.add(task)
    db.flush()
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
    db.flush()
    result = published_content_issue_out(db, issue)
    db.commit()
    return result


def _published_article_deletion_scope(
    db: Session, article_id: uuid.UUID
) -> _PublishedArticleDeletionScope:
    """按任务、工作、成果的稳定顺序锁定成果删除范围。"""
    task_id = db.scalar(
        select(PublicationWork.content_task_id)
        .join(PublishedArticle, PublishedArticle.id == PublicationWork.id)
        .where(PublishedArticle.id == article_id)
    )
    if task_id is None:
        raise not_found("发布成果")
    task = db.scalar(select(ContentTask).where(ContentTask.id == task_id).with_for_update())
    work = db.scalar(
        select(PublicationWork).where(PublicationWork.id == article_id).with_for_update()
    )
    article = db.scalar(
        select(PublishedArticle).where(PublishedArticle.id == article_id).with_for_update()
    )
    if task is None or work is None or article is None:
        raise not_found("发布成果")
    if work.content_task_id != task.id or work.status != "COMPLETED" or task.status != "COMPLETED":
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布成果完成闭环不完整", 409)
    events = list(
        db.scalars(
            select(PublicationWorkEvent)
            .where(PublicationWorkEvent.publication_work_id == work.id)
            .order_by(PublicationWorkEvent.id)
            .with_for_update()
        )
    )
    verifications = list(
        db.scalars(
            select(PublicationVerification)
            .where(PublicationVerification.publication_work_id == work.id)
            .order_by(PublicationVerification.id)
            .with_for_update()
        )
    )
    issues = list(
        db.scalars(
            select(PublishedContentIssue)
            .where(PublishedContentIssue.published_article_id == article.id)
            .order_by(PublishedContentIssue.id)
            .with_for_update()
        )
    )
    issue_ids = [issue.id for issue in issues]
    publication_file_ids = list(
        db.scalars(
            select(PublicationAttachment.file_id)
            .where(PublicationAttachment.publication_work_id == work.id)
            .order_by(PublicationAttachment.file_id)
        )
    )
    repair_task_count = (
        int(
            db.scalar(
                select(func.count())
                .select_from(ContentTask)
                .where(ContentTask.source_published_content_issue_id.in_(issue_ids))
            )
            or 0
        )
        if issue_ids
        else 0
    )
    return _PublishedArticleDeletionScope(
        task=task,
        work=work,
        article=article,
        events=events,
        verifications=verifications,
        issues=issues,
        publication_file_ids=publication_file_ids,
        detached_repair_task_count=repair_task_count,
        blockers=published_article_deletion_blockers(db, [article.id])[article.id],
    )


def _raise_if_published_article_in_use(scope: _PublishedArticleDeletionScope) -> None:
    if not scope.blockers:
        return
    labels = {
        "GEO_OBSERVATION": "GEO 观测",
        "GEO_OPTIMIZATION_SOURCE": "GEO 优化来源",
    }
    raise in_use(
        "PUBLISHED_ARTICLE_IN_USE",
        "发布成果",
        [
            (blocker.type.value, labels[blocker.type.value], blocker.count)
            for blocker in scope.blockers
        ],
    )


def preview_published_article_permanent_deletion(
    *, db: Session, article_id: uuid.UUID
) -> PublishedArticlePermanentDeletionPreview:
    """返回管理员确认成果永久删除所需的实时范围。"""
    scope = _published_article_deletion_scope(db, article_id)
    _raise_if_published_article_in_use(scope)
    if scope.work.final_url is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布成果缺少公开地址", 409)
    return PublishedArticlePermanentDeletionPreview(
        article_id=scope.article.id,
        revision=scope.work.revision,
        counts=PublishedArticlePermanentDeletionCounts(
            publication_events=len(scope.events),
            publication_verifications=len(scope.verifications),
            published_content_issues=len(scope.issues),
            detached_repair_tasks=scope.detached_repair_task_count,
            attachment_relations=len(scope.publication_file_ids),
        ),
        external_url=scope.work.final_url,
        confirmation_text="永久删除",
    )


def permanently_delete_published_article(
    *,
    db: Session,
    article_id: uuid.UUID,
    payload: PublishedArticlePermanentDeleteRequest,
    actor: User,
    request_id: str,
) -> None:
    """永久删除无 GEO 引用的发布聚合，并恢复来源任务。"""
    scope = _published_article_deletion_scope(db, article_id)
    if scope.work.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "发布成果已被其他请求修改", 409)
    if payload.confirmation_text != "永久删除":
        raise AppError(
            "PERMANENT_DELETE_CONFIRMATION_MISMATCH",
            "永久删除确认文本不匹配",
            422,
        )
    _raise_if_published_article_in_use(scope)
    db.scalar(
        select(
            func.set_config(
                "partsignal.published_article_delete_id",
                str(scope.article.id),
                True,
            )
        )
    )
    _delete_audit_targets(
        db,
        {
            "PublicationWork": [scope.work.id],
            "PublishedArticle": [scope.article.id],
            "PublishedContentIssue": [issue.id for issue in scope.issues],
        },
    )
    if scope.issues:
        db.execute(
            delete(PublishedContentIssue).where(
                PublishedContentIssue.id.in_([issue.id for issue in scope.issues])
            )
        )
    db.execute(delete(PublishedArticle).where(PublishedArticle.id == scope.article.id))
    db.execute(
        delete(PublicationAttachment).where(
            PublicationAttachment.publication_work_id == scope.work.id
        )
    )
    db.execute(
        delete(PublicationWorkEvent).where(
            PublicationWorkEvent.publication_work_id == scope.work.id
        )
    )
    db.execute(
        delete(PublicationVerification).where(
            PublicationVerification.publication_work_id == scope.work.id
        )
    )
    db.execute(delete(PublicationWork).where(PublicationWork.id == scope.work.id))
    scope.task.status = "OPEN"
    scope.task.revision += 1
    cleanup_time = datetime.now(UTC)
    for file_id in scope.publication_file_ids:
        schedule_unreferenced_file(db, file_id, cleanup_after=cleanup_time)
    _audit(
        db,
        actor=actor,
        request_id=request_id,
        action="published_article.permanently_deleted",
        target_type="PublishedArticle",
        target_id=scope.article.id,
        message="发布成果及其内部历史已永久删除，来源任务已恢复",
    )
    db.commit()


def _task_deletion_scope(db: Session, task: ContentTask) -> _TaskDeletionScope:
    """锁定任务聚合并计算普通/永久删除共用的精确范围。"""
    jobs = list(
        db.scalars(
            select(GenerationJob)
            .where(GenerationJob.content_task_id == task.id)
            .order_by(GenerationJob.id)
            .with_for_update()
        )
    )
    versions = list(
        db.scalars(
            select(ContentVersion)
            .where(ContentVersion.task_id == task.id)
            .order_by(ContentVersion.id)
            .with_for_update()
        )
    )
    version_ids = [version.id for version in versions]
    reviews = (
        list(
            db.scalars(
                select(ContentReviewRecord)
                .where(ContentReviewRecord.content_version_id.in_(version_ids))
                .order_by(ContentReviewRecord.id)
            )
        )
        if version_ids
        else []
    )
    works = list(
        db.scalars(
            select(PublicationWork)
            .where(PublicationWork.content_task_id == task.id)
            .order_by(PublicationWork.id)
            .with_for_update()
        )
    )
    work_ids = [work.id for work in works]
    events = (
        list(
            db.scalars(
                select(PublicationWorkEvent)
                .where(PublicationWorkEvent.publication_work_id.in_(work_ids))
                .order_by(PublicationWorkEvent.id)
            )
        )
        if work_ids
        else []
    )
    verifications = (
        list(
            db.scalars(
                select(PublicationVerification)
                .where(PublicationVerification.publication_work_id.in_(work_ids))
                .order_by(PublicationVerification.id)
            )
        )
        if work_ids
        else []
    )
    articles = (
        list(
            db.scalars(
                select(PublishedArticle)
                .where(PublishedArticle.id.in_(work_ids))
                .order_by(PublishedArticle.id)
            )
        )
        if work_ids
        else []
    )
    article_ids = [article.id for article in articles]
    issues = (
        list(
            db.scalars(
                select(PublishedContentIssue)
                .where(PublishedContentIssue.published_article_id.in_(article_ids))
                .order_by(PublishedContentIssue.id)
            )
        )
        if article_ids
        else []
    )
    publication_file_ids = (
        list(
            db.scalars(
                select(PublicationAttachment.file_id)
                .where(PublicationAttachment.publication_work_id.in_(work_ids))
                .distinct()
                .order_by(PublicationAttachment.file_id)
            )
        )
        if work_ids
        else []
    )
    geo_article_relation_count = 0
    exclusive_roots: list[uuid.UUID] = []
    exclusive_observation_ids: list[uuid.UUID] = []
    exclusive_file_ids: list[uuid.UUID] = []
    if article_ids:
        relation_counts = (
            int(
                db.scalar(
                    select(func.count())
                    .select_from(GeoObservationPublication)
                    .where(GeoObservationPublication.published_article_id.in_(article_ids))
                )
                or 0
            ),
            int(
                db.scalar(
                    select(func.count())
                    .select_from(GeoObservationCitation)
                    .where(GeoObservationCitation.published_article_id.in_(article_ids))
                )
                or 0
            ),
            int(
                db.scalar(
                    select(func.count())
                    .select_from(ContentTaskGeoSource)
                    .where(ContentTaskGeoSource.published_article_id.in_(article_ids))
                )
                or 0
            ),
        )
        geo_article_relation_count = sum(relation_counts)
        affected_observation_ids = list(
            db.scalars(
                select(GeoObservationPublication.observation_id)
                .where(GeoObservationPublication.published_article_id.in_(article_ids))
                .distinct()
                .order_by(GeoObservationPublication.observation_id)
            )
        )
        seen_roots: set[uuid.UUID] = set()
        for observation_id in affected_observation_ids:
            _product, chain = _lock_manual_observation_chain(db, observation_id)
            root_id = chain[0].id
            if root_id in seen_roots:
                continue
            seen_roots.add(root_id)
            chain_ids = [node.id for node in chain]
            other_relation = db.scalar(
                select(GeoObservationPublication.observation_id)
                .where(
                    GeoObservationPublication.observation_id.in_(chain_ids),
                    GeoObservationPublication.published_article_id.not_in(article_ids),
                )
                .limit(1)
            )
            if other_relation is not None:
                continue
            exclusive_roots.append(root_id)
            exclusive_observation_ids.extend(chain_ids)
        if exclusive_observation_ids:
            exclusive_file_ids = list(
                db.scalars(
                    select(GeoObservationAttachment.file_id)
                    .where(GeoObservationAttachment.observation_id.in_(exclusive_observation_ids))
                    .distinct()
                    .order_by(GeoObservationAttachment.file_id)
                )
            )
    return _TaskDeletionScope(
        jobs=jobs,
        versions=versions,
        reviews=reviews,
        works=works,
        events=events,
        verifications=verifications,
        articles=articles,
        issues=issues,
        publication_file_ids=publication_file_ids,
        exclusive_geo_chain_roots=exclusive_roots,
        exclusive_geo_observation_ids=exclusive_observation_ids,
        exclusive_geo_file_ids=exclusive_file_ids,
        geo_article_relation_count=geo_article_relation_count,
        external_urls=sorted({work.final_url for work in works if work.final_url is not None}),
    )


def _permanent_deletion_preview(
    task: ContentTask, scope: _TaskDeletionScope
) -> ContentTaskPermanentDeletionPreview:
    return ContentTaskPermanentDeletionPreview(
        task_id=task.id,
        revision=task.revision,
        counts=ContentTaskPermanentDeletionCounts(
            content_versions=len(scope.versions),
            content_review_records=len(scope.reviews),
            generation_jobs=len(scope.jobs),
            publication_works=len(scope.works),
            publication_events=len(scope.events),
            publication_verifications=len(scope.verifications),
            published_articles=len(scope.articles),
            published_content_issues=len(scope.issues),
            geo_article_relations=scope.geo_article_relation_count,
            exclusive_geo_observation_chains=len(scope.exclusive_geo_chain_roots),
            attachment_relations=(
                len(scope.publication_file_ids) + len(scope.exclusive_geo_file_ids)
            ),
        ),
        external_urls=scope.external_urls,
        confirmation_text="永久删除",
    )


def preview_content_task_permanent_deletion(
    *, db: Session, task_id: uuid.UUID
) -> ContentTaskPermanentDeletionPreview:
    """返回管理员确认永久删除所需的实时内部范围。"""
    task = db.scalar(select(ContentTask).where(ContentTask.id == task_id).with_for_update())
    if task is None:
        raise not_found("内容任务")
    if task.archived_at is None:
        raise AppError("CONTENT_TASK_NOT_ARCHIVED", "内容任务必须先归档", 409)
    return _permanent_deletion_preview(task, _task_deletion_scope(db, task))


def _delete_audit_targets(db: Session, targets: dict[str, list[uuid.UUID]]) -> None:
    """只清理本次已删除对象的旧审计。"""
    for target_type, target_ids in targets.items():
        if target_ids:
            db.execute(
                delete(AuditLog).where(
                    AuditLog.target_type == target_type,
                    AuditLog.target_id.in_([str(target_id) for target_id in target_ids]),
                )
            )


def _delete_task_core(db: Session, task: ContentTask, scope: _TaskDeletionScope) -> None:
    """删除发布前后共用的任务自有记录，不提交事务。"""
    db.scalar(select(func.set_config("partsignal.content_task_delete_id", str(task.id), True)))
    work_ids = [work.id for work in scope.works]
    version_ids = [version.id for version in scope.versions]
    if work_ids:
        db.execute(
            delete(PublicationAttachment).where(
                PublicationAttachment.publication_work_id.in_(work_ids)
            )
        )
        db.execute(
            delete(PublicationWorkEvent).where(
                PublicationWorkEvent.publication_work_id.in_(work_ids)
            )
        )
        db.execute(
            delete(PublicationVerification).where(
                PublicationVerification.publication_work_id.in_(work_ids)
            )
        )
        db.execute(delete(PublicationWork).where(PublicationWork.id.in_(work_ids)))
    db.execute(delete(ContentTaskGeoSource).where(ContentTaskGeoSource.content_task_id == task.id))
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
    db.execute(delete(ContentTask).where(ContentTask.id == task.id))
    cleanup_time = datetime.now(UTC)
    for file_id in scope.publication_file_ids:
        schedule_unreferenced_file(db, file_id, cleanup_after=cleanup_time)


def _task_audit_targets(task: ContentTask, scope: _TaskDeletionScope) -> dict[str, list[uuid.UUID]]:
    return {
        "ContentTask": [task.id],
        "GenerationJob": [item.id for item in scope.jobs],
        "ContentVersion": [item.id for item in scope.versions],
        "PublicationWork": [item.id for item in scope.works],
        "PublishedArticle": [item.id for item in scope.articles],
        "PublishedContentIssue": [item.id for item in scope.issues],
        "GeoObservation": scope.exclusive_geo_observation_ids,
    }


def archive_content_task(*, db: Session, task_id: uuid.UUID, expected_revision: int) -> ContentTask:
    """归档已完成任务，仅改变默认可见性。"""
    task = db.scalar(select(ContentTask).where(ContentTask.id == task_id).with_for_update())
    if task is None:
        raise not_found("内容任务")
    if task.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "内容任务已被其他请求修改", 409)
    if task.status != "COMPLETED" or task.archived_at is not None:
        raise AppError("INVALID_STATE_TRANSITION", "只有未归档的已完成任务可以归档", 409)
    task.archived_at = datetime.now(UTC)
    task.revision += 1
    db.commit()
    return task


def restore_content_task(*, db: Session, task_id: uuid.UUID, expected_revision: int) -> ContentTask:
    """恢复已归档任务，不改变其业务状态。"""
    task = db.scalar(select(ContentTask).where(ContentTask.id == task_id).with_for_update())
    if task is None:
        raise not_found("内容任务")
    if task.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "内容任务已被其他请求修改", 409)
    if task.archived_at is None:
        raise AppError("INVALID_STATE_TRANSITION", "内容任务尚未归档", 409)
    task.archived_at = None
    task.revision += 1
    db.commit()
    return task


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
    db.commit()
    return task


def delete_content_task(*, db: Session, task_id: uuid.UUID, actor: User, request_id: str) -> None:
    """删除没有成功发布或 GEO 关系的完整未归档任务聚合。"""
    task = db.scalar(select(ContentTask).where(ContentTask.id == task_id).with_for_update())
    if task is None:
        raise not_found("内容任务")
    if task.archived_at is not None:
        raise AppError("CONTENT_TASK_REQUIRES_ARCHIVE", "已归档任务必须使用永久删除", 409)
    if task.status not in {"OPEN", "CANCELLED"}:
        raise AppError(
            "CONTENT_TASK_REQUIRES_ARCHIVE",
            "已完成任务必须先归档",
            409,
        )
    scope = _task_deletion_scope(db, task)
    if any(job.status in {"PENDING", "RUNNING"} for job in scope.jobs):
        raise AppError("CONTENT_TASK_BUSY", "任务仍有运行中的生成作业", 409)
    if scope.articles or scope.geo_article_relation_count:
        raise AppError(
            "CONTENT_TASK_REQUIRES_ARCHIVE",
            "成功发布或产生 GEO 关系的任务必须先归档",
            409,
        )
    _delete_audit_targets(db, _task_audit_targets(task, scope))
    _delete_task_core(db, task, scope)
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
                    "generation_job_count": len(scope.jobs),
                    "content_version_count": len(scope.versions),
                    "content_review_record_count": len(scope.reviews),
                    "publication_work_count": len(scope.works),
                }
            },
        ),
    )
    db.commit()


def permanently_delete_content_task(
    *,
    db: Session,
    task_id: uuid.UUID,
    payload: ContentTaskPermanentDeleteRequest,
    actor: User,
    request_id: str,
) -> None:
    """永久删除已归档任务的完整内部聚合，并保留最小墓碑。"""
    task = db.scalar(select(ContentTask).where(ContentTask.id == task_id).with_for_update())
    if task is None:
        raise not_found("内容任务")
    if task.archived_at is None:
        raise AppError("CONTENT_TASK_NOT_ARCHIVED", "内容任务必须先归档", 409)
    if task.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "内容任务已被其他请求修改", 409)
    if payload.confirmation_text != "永久删除":
        raise AppError(
            "PERMANENT_DELETE_CONFIRMATION_MISMATCH",
            "永久删除确认文本不匹配",
            422,
        )
    scope = _task_deletion_scope(db, task)
    if any(job.status in {"PENDING", "RUNNING"} for job in scope.jobs):
        raise AppError("CONTENT_TASK_BUSY", "任务仍有运行中的生成作业", 409)
    db.scalar(select(func.set_config("partsignal.content_task_delete_id", str(task.id), True)))
    for root_id in scope.exclusive_geo_chain_roots:
        _delete_manual_observation_chain(db, root_id)
    article_ids = [article.id for article in scope.articles]
    issue_ids = [issue.id for issue in scope.issues]
    if issue_ids:
        db.execute(delete(PublishedContentIssue).where(PublishedContentIssue.id.in_(issue_ids)))
    if article_ids:
        db.execute(delete(PublishedArticle).where(PublishedArticle.id.in_(article_ids)))
    _delete_audit_targets(db, _task_audit_targets(task, scope))
    _delete_task_core(db, task, scope)
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONTENT_PLANNING,
            action="content_task.permanently_deleted",
            target_type="ContentTask",
            target_id=task.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="内容任务已永久删除",
            details={},
        ),
    )
    db.commit()
