"""安全发布包、人工发布登记与追加式状态历史接口。"""

from __future__ import annotations

import re
import uuid
from html.parser import HTMLParser
from typing import Annotated, Literal
from urllib.parse import urlparse

import bleach
import markdown
from fastapi import APIRouter, Header, Query, Request, status
from sqlalchemy import func, select, text

from app.audit import append_audit
from app.deps import CsrfProtected, CurrentUser, DbSession, EngineerUser
from app.errors import AppError, not_found
from app.models import (
    ContentTask,
    ContentVersion,
    FactVersion,
    FileRecord,
    PlatformAccount,
    PlatformProfile,
    PublicationAttachment,
    PublicationRecord,
    PublicationStatusEvent,
)
from app.routers.production import content_version_out
from app.schemas import (
    ContentVersionList,
    FileRecordOut,
    ManualPublicationCreate,
    PlatformAccountCreate,
    PlatformAccountList,
    PlatformAccountOut,
    PublicationCommand,
    PublicationEvent,
    PublicationPackage,
    PublicationRecordList,
    PublicationRecordOut,
    PublicationStatus,
)

router = APIRouter(prefix="/api/v1", tags=["publication"])
ContentEditor = EngineerUser
PublicationCommandName = Literal[
    "mark-platform-review",
    "mark-published",
    "verify",
    "reject",
    "remove",
    "mark-verification-failed",
]

ALLOWED_HTML_TAGS = [
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "ul",
    "ol",
    "li",
    "strong",
    "em",
    "code",
    "pre",
    "blockquote",
    "a",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "br",
]


class _TextExtractor(HTMLParser):
    """从已清理 HTML 派生不可编辑纯文本。"""

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.parts.append(data.strip())


def render_markdown(body_markdown: str) -> tuple[str, str]:
    """实时派生安全 HTML 与纯文本，不保存第二份正文。"""
    raw_html = markdown.markdown(body_markdown, extensions=["tables", "fenced_code"])
    safe_html = bleach.clean(
        raw_html,
        tags=ALLOWED_HTML_TAGS,
        attributes={"a": ["href", "title", "rel"]},
        protocols=["http", "https"],
        strip=True,
    )
    extractor = _TextExtractor()
    extractor.feed(safe_html)
    return safe_html, "\n".join(extractor.parts)


def domain_allowed(url: str, allowed_domains: list[str]) -> bool:
    """仅允许 HTTP(S) 且主机等于或属于平台配置域名。"""
    parsed = urlparse(url)
    host = (parsed.hostname or "").casefold().strip(".")
    if parsed.scheme not in {"http", "https"} or not host:
        return False
    return any(host == domain or host.endswith(f".{domain}") for domain in allowed_domains)


def publication_out(db: DbSession, publication: PublicationRecord) -> PublicationRecordOut:
    events = list(
        db.scalars(
            select(PublicationStatusEvent)
            .where(PublicationStatusEvent.publication_id == publication.id)
            .order_by(PublicationStatusEvent.created_at)
        )
    )
    files = list(
        db.scalars(
            select(FileRecord)
            .join(PublicationAttachment, PublicationAttachment.file_id == FileRecord.id)
            .where(PublicationAttachment.publication_id == publication.id)
        )
    )
    return PublicationRecordOut(
        id=publication.id,
        content_version_id=publication.content_version_id,
        platform_account_id=publication.platform_account_id,
        section_url=publication.section_url,
        actual_title=publication.actual_title,
        final_url=publication.final_url,
        published_at=publication.published_at,
        status=publication.status,
        content_hash=publication.content_hash,
        created_by=publication.created_by,
        created_at=publication.created_at,
        status_events=[
            PublicationEvent(
                status=event.status,
                comment=event.comment,
                actor_id=event.actor_id,
                created_at=event.created_at,
            )
            for event in events
        ],
        attachments=[FileRecordOut.model_validate(file) for file in files],
    )


def require_publishable(db: DbSession, content_id: uuid.UUID) -> ContentVersion:
    """发布包和登记均重新检查内容及其事实版本。"""
    content = db.get(ContentVersion, content_id)
    if content is None:
        raise not_found("内容版本")
    fact = db.get(FactVersion, content.fact_version_id)
    if content.status != "APPROVED" or fact is None or fact.status != "APPROVED":
        raise AppError("CONTENT_NOT_APPROVED", "只有绑定有效批准事实的批准内容可以发布", 409)
    return content


@router.get(
    "/content-versions/{content_version_id}/publication-package",
    response_model=PublicationPackage,
    operation_id="getPublicationPackage",
)
def get_publication_package(
    content_version_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> PublicationPackage:
    content = require_publishable(db, content_version_id)
    task = db.get(ContentTask, content.task_id)
    if task is None:
        raise not_found("内容任务")
    body_html, body_text = render_markdown(content.body_markdown)
    return PublicationPackage(
        content_version_id=content.id,
        fact_version_id=content.fact_version_id,
        title=content.title,
        body_markdown=content.body_markdown,
        body_html=body_html,
        body_text=body_text,
        tags=content.tags,
        canonical_url=task.canonical_url,
        content_hash=content.content_hash,
    )


@router.get(
    "/publication-candidates",
    response_model=ContentVersionList,
    operation_id="listPublicationCandidates",
)
def list_publication_candidates(db: DbSession, _user: CurrentUser) -> ContentVersionList:
    contents = list(
        db.scalars(
            select(ContentVersion)
            .join(FactVersion, FactVersion.id == ContentVersion.fact_version_id)
            .where(ContentVersion.status == "APPROVED", FactVersion.status == "APPROVED")
            .order_by(ContentVersion.created_at.desc())
        )
    )
    return ContentVersionList(items=[content_version_out(content) for content in contents])


@router.get(
    "/platform-accounts", response_model=PlatformAccountList, operation_id="listPlatformAccounts"
)
def list_platform_accounts(db: DbSession, _user: CurrentUser) -> PlatformAccountList:
    accounts = list(db.scalars(select(PlatformAccount).order_by(PlatformAccount.label)))
    return PlatformAccountList(
        items=[PlatformAccountOut.model_validate(account) for account in accounts]
    )


@router.post(
    "/platform-accounts",
    response_model=PlatformAccountOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createPlatformAccount",
)
def create_platform_account(
    payload: PlatformAccountCreate,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> PlatformAccountOut:
    if db.get(PlatformProfile, payload.platform_profile_id) is None:
        raise not_found("平台配置")
    account = PlatformAccount(**payload.model_dump())
    db.add(account)
    db.flush()
    append_audit(
        db,
        actor_id=editor.id,
        action="platform_account.created",
        target_type="PlatformAccount",
        target_id=account.id,
        request_id=request.state.request_id,
    )
    db.commit()
    return PlatformAccountOut.model_validate(account)


def verified_files(db: DbSession, file_ids: list[uuid.UUID]) -> list[FileRecord]:
    """附件只能绑定现存且已通过 HEAD 校验的文件。"""
    if len(file_ids) != len(set(file_ids)):
        raise AppError("VALIDATION_ERROR", "附件文件 ID 重复", 422)
    files = (
        list(db.scalars(select(FileRecord).where(FileRecord.id.in_(file_ids)))) if file_ids else []
    )
    if len(files) != len(file_ids) or any(file.status != "VERIFIED" for file in files):
        raise AppError("FILE_INTEGRITY_FAILED", "附件必须全部处于 VERIFIED 状态", 422)
    return files


@router.post(
    "/publication-records/manual",
    response_model=PublicationRecordOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createManualPublication",
)
def create_manual_publication(
    payload: ManualPublicationCreate,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)],
) -> PublicationRecordOut:
    # PostgreSQL 事务级锁把同一幂等键的并发请求串行化，避免先查后插入竞态。
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
    content = require_publishable(db, payload.content_version_id)
    account = db.get(PlatformAccount, payload.platform_account_id)
    if account is None or not account.is_active:
        raise AppError("INVALID_STATE_TRANSITION", "平台账号不存在或已停用", 409)
    profile = db.get(PlatformProfile, account.platform_profile_id)
    if profile is None or not domain_allowed(str(payload.section_url), profile.allowed_domains):
        raise AppError("VALIDATION_ERROR", "栏目 URL 不属于平台允许域名", 422)
    files = verified_files(db, payload.attachment_file_ids)
    publication = PublicationRecord(
        idempotency_key=idempotency_key,
        content_version_id=content.id,
        platform_account_id=account.id,
        section_url=str(payload.section_url),
        status="PENDING_MANUAL_PUBLISH",
        content_hash=content.content_hash,
        created_by=editor.id,
    )
    db.add(publication)
    db.flush()
    db.add(
        PublicationStatusEvent(
            publication_id=publication.id,
            status=publication.status,
            comment="创建人工发布登记",
            actor_id=editor.id,
        )
    )
    db.add_all(
        PublicationAttachment(publication_id=publication.id, file_id=file.id) for file in files
    )
    append_audit(
        db,
        actor_id=editor.id,
        action="publication.created",
        target_type="PublicationRecord",
        target_id=publication.id,
        request_id=request.state.request_id,
        details={"content_version_id": str(content.id)},
    )
    db.commit()
    return publication_out(db, publication)


@router.get(
    "/publication-records",
    response_model=PublicationRecordList,
    operation_id="listPublicationRecords",
)
def list_publication_records(
    db: DbSession,
    _user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: Annotated[PublicationStatus | None, Query(alias="status")] = None,
) -> PublicationRecordList:
    query = select(PublicationRecord)
    count_query = select(func.count()).select_from(PublicationRecord)
    if status_filter:
        query = query.where(PublicationRecord.status == status_filter.value)
        count_query = count_query.where(PublicationRecord.status == status_filter.value)
    total = int(db.scalar(count_query) or 0)
    records = list(
        db.scalars(
            query.order_by(PublicationRecord.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return PublicationRecordList(
        items=[publication_out(db, item) for item in records],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.get(
    "/publication-records/{publication_id}",
    response_model=PublicationRecordOut,
    operation_id="getPublicationRecord",
)
def get_publication_record(
    publication_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> PublicationRecordOut:
    publication = db.get(PublicationRecord, publication_id)
    if publication is None:
        raise not_found("发布记录")
    return publication_out(db, publication)


@router.post(
    "/publication-records/{publication_id}/{command}",
    response_model=PublicationRecordOut,
    operation_id="commandPublicationRecord",
)
def command_publication_record(
    publication_id: uuid.UUID,
    command: PublicationCommandName,
    payload: PublicationCommand,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> PublicationRecordOut:
    publication = db.get(PublicationRecord, publication_id)
    if publication is None:
        raise not_found("发布记录")
    transitions = {
        ("PENDING_MANUAL_PUBLISH", "mark-platform-review"): "PLATFORM_REVIEW",
        ("PENDING_MANUAL_PUBLISH", "reject"): "REJECTED",
        ("PLATFORM_REVIEW", "mark-published"): "PUBLISHED",
        ("PLATFORM_REVIEW", "reject"): "REJECTED",
        ("PUBLISHED", "verify"): "VERIFIED",
        ("PUBLISHED", "remove"): "REMOVED",
        ("PUBLISHED", "mark-verification-failed"): "VERIFICATION_FAILED",
        ("VERIFIED", "remove"): "REMOVED",
        ("VERIFIED", "mark-verification-failed"): "VERIFICATION_FAILED",
    }
    target = transitions.get((publication.status, command))
    if target is None:
        raise AppError(
            "INVALID_STATE_TRANSITION", f"发布记录不能从 {publication.status} 执行 {command}", 409
        )
    if command == "mark-published":
        if (
            payload.actual_title is None
            or payload.final_url is None
            or payload.published_at is None
        ):
            raise AppError(
                "VALIDATION_ERROR", "登记已发布必须填写实际标题、最终 URL 和发布时间", 422
            )
        account = db.get(PlatformAccount, publication.platform_account_id)
        profile = db.get(PlatformProfile, account.platform_profile_id) if account else None
        if profile is None or not domain_allowed(str(payload.final_url), profile.allowed_domains):
            raise AppError("VALIDATION_ERROR", "最终 URL 不属于平台允许域名", 422)
        publication.actual_title = payload.actual_title
        publication.final_url = str(payload.final_url)
        publication.published_at = payload.published_at
    if command == "verify" and payload.content_matches is not True:
        raise AppError("VALIDATION_ERROR", "验证发布必须明确确认页面正文匹配批准内容", 422)
    publication.status = target
    db.add(
        PublicationStatusEvent(
            publication_id=publication.id,
            status=target,
            comment=payload.comment,
            actor_id=editor.id,
        )
    )
    append_audit(
        db,
        actor_id=editor.id,
        action=f"publication.{re.sub('-', '_', command)}",
        target_type="PublicationRecord",
        target_id=publication.id,
        request_id=request.state.request_id,
        details={"status": target},
    )
    db.commit()
    return publication_out(db, publication)
