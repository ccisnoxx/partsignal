"""安全发布包、人工发布登记与追加式状态历史接口。"""

from __future__ import annotations

import uuid
from html.parser import HTMLParser
from typing import Annotated, Literal

import bleach
import markdown
from fastapi import APIRouter, Header, Query, Request, status
from sqlalchemy import func, select

from app.audit import append_audit
from app.deps import CsrfProtected, CurrentUser, DbSession, EngineerUser
from app.errors import not_found
from app.models import (
    ContentTask,
    PlatformAccount,
    PlatformProfile,
    PublicationRecord,
)
from app.schemas import (
    ContentTaskOut,
    ManualPublicationCreate,
    PlatformAccountCreate,
    PlatformAccountList,
    PlatformAccountOut,
    PublicationAttentionList,
    PublicationAttentionOut,
    PublicationAttentionStatus,
    PublicationCandidateList,
    PublicationCommand,
    PublicationPackage,
    PublicationRecordList,
    PublicationRecordOut,
    PublicationRepairContext,
    PublicationRepairTaskCreate,
    PublicationStatus,
    ResolvePublicationAttentionRequest,
)
from app.services.projections import content_task_out
from app.services.publication import (
    command_publication,
    create_repair_task,
    get_attention,
    get_repair_context,
    list_attentions,
    publication_out,
    require_publishable,
    resolve_attention,
)
from app.services.publication import (
    create_manual_publication as create_manual_publication_service,
)
from app.services.publication import (
    list_publication_candidates as list_publication_candidates_service,
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
    response_model=PublicationCandidateList,
    operation_id="listPublicationCandidates",
)
def list_publication_candidates(
    db: DbSession, _user: CurrentUser
) -> PublicationCandidateList:
    return list_publication_candidates_service(db)


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
    return create_manual_publication_service(
        db=db,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
        idempotency_key=idempotency_key,
    )


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
    return command_publication(
        db=db,
        publication_id=publication_id,
        command=command,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
    )


@router.get(
    "/publication-attentions",
    response_model=PublicationAttentionList,
    operation_id="listPublicationAttentions",
)
def list_publication_attentions(
    db: DbSession,
    _user: CurrentUser,
    status_filter: Annotated[PublicationAttentionStatus | None, Query(alias="status")] = None,
) -> PublicationAttentionList:
    return list_attentions(db, status_filter.value if status_filter is not None else None)


@router.get(
    "/publication-attentions/{attention_id}",
    response_model=PublicationAttentionOut,
    operation_id="getPublicationAttention",
)
def get_publication_attention(
    attention_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> PublicationAttentionOut:
    return get_attention(db, attention_id)


@router.get(
    "/publication-attentions/{attention_id}/repair-context",
    response_model=PublicationRepairContext,
    operation_id="getPublicationRepairContext",
)
def get_publication_repair_context(
    attention_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> PublicationRepairContext:
    return get_repair_context(db, attention_id)


@router.post(
    "/publication-attentions/{attention_id}/repair-task",
    response_model=ContentTaskOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createPublicationRepairTask",
)
def create_publication_repair_task(
    attention_id: uuid.UUID,
    payload: PublicationRepairTaskCreate,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> ContentTaskOut:
    task = create_repair_task(
        db=db,
        attention_id=attention_id,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
    )
    return content_task_out(db, task)


@router.post(
    "/publication-attentions/{attention_id}/resolve",
    response_model=PublicationAttentionOut,
    operation_id="resolvePublicationAttention",
)
def resolve_publication_attention(
    attention_id: uuid.UUID,
    payload: ResolvePublicationAttentionRequest,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> PublicationAttentionOut:
    return resolve_attention(
        db=db,
        attention_id=attention_id,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
    )
