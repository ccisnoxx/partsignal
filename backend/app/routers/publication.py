"""发布包、发布工作、发布成果与内容问题 HTTP 接口。"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Header, Query, Request, status
from sqlalchemy import select

from app.deps import CsrfProtected, CurrentUser, DbSession, EngineerUser, assert_account_types
from app.errors import not_found
from app.models.identity import User
from app.models.publication import (
    PlatformAccount,
    PublicationWork,
    PublishedArticle,
    PublishedContentIssue,
)
from app.schemas.common import AccountType, RevisionRequest
from app.schemas.content import ContentTaskOut
from app.schemas.publication import (
    PlatformAccountCreate,
    PlatformAccountList,
    PlatformAccountOut,
    PlatformAccountUpdate,
    PublicationContentVersionSwitchRequest,
    PublicationPackage,
    PublicationPlatformReviewRequest,
    PublicationPreparationUpdate,
    PublicationReadyItemList,
    PublicationResultUpdate,
    PublicationVerificationCreate,
    PublicationWorkbenchSummary,
    PublicationWorkCloseRequest,
    PublicationWorkCreate,
    PublicationWorkList,
    PublicationWorkOut,
    PublicationWorkStatus,
    PublishedArticleList,
    PublishedArticleOut,
    PublishedContentIssueCreate,
    PublishedContentIssueList,
    PublishedContentIssueOut,
    PublishedContentIssueResolveRequest,
    PublishedContentIssueStatus,
    PublishedContentRepairContext,
    PublishedContentRepairTaskCreate,
)
from app.services.projections import content_task_out, platform_account_out, platform_accounts_out
from app.services.publication import (
    close_publication_work,
    create_publication_work,
    create_repair_task,
    mark_publication_platform_review,
    open_published_content_issue,
    register_publication_result,
    require_publishable,
    resolve_published_content_issue,
    switch_publication_content_version,
    update_publication_preparation,
    verify_publication_work,
)
from app.services.publication import (
    create_platform_account as create_platform_account_command,
)
from app.services.publication import (
    delete_platform_account as delete_platform_account_command,
)
from app.services.publication import (
    set_platform_account_enabled as set_platform_account_enabled_command,
)
from app.services.publication import (
    update_platform_account as update_platform_account_command,
)
from app.services.publication_queries import (
    get_published_content_repair_context,
    publication_work_out,
    publication_workbench_summary,
    published_article_out,
    published_content_issue_out,
    render_markdown,
)
from app.services.publication_queries import (
    list_publication_ready_items as list_publication_ready_items_service,
)
from app.services.publication_queries import (
    list_publication_works as list_publication_works_service,
)
from app.services.publication_queries import (
    list_published_articles as list_published_articles_service,
)
from app.services.publication_queries import (
    list_published_content_issues as list_published_content_issues_service,
)

router = APIRouter(prefix="/api/v1", tags=["publication"])
ContentEditor = EngineerUser


def _run_publication_command[CommandResult](
    *,
    actor: User,
    command: Callable[[], CommandResult],
) -> CommandResult:
    """执行工程师或管理员发布命令。"""
    assert_account_types(actor, (AccountType.ADMIN, AccountType.ENGINEER))
    return command()


@router.get(
    "/content-versions/{content_version_id}/publication-package",
    response_model=PublicationPackage,
    operation_id="getPublicationPackage",
)
def get_publication_package(
    content_version_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> PublicationPackage:
    content = require_publishable(db, content_version_id)
    body_html, body_text = render_markdown(content.body_markdown)
    return PublicationPackage(
        content_version_id=content.id,
        fact_version_id=content.fact_version_id,
        title=content.title,
        body_markdown=content.body_markdown,
        body_html=body_html,
        body_text=body_text,
        tags=content.tags,
        content_hash=content.content_hash,
    )


@router.get(
    "/publication-ready-items",
    response_model=PublicationReadyItemList,
    operation_id="listPublicationReadyItems",
)
def list_publication_ready_items(db: DbSession, user: CurrentUser) -> PublicationReadyItemList:
    return list_publication_ready_items_service(
        db,
        can_delete_accounts=user.account_type == AccountType.ADMIN.value,
    )


@router.get(
    "/publication-workbench-summary",
    response_model=PublicationWorkbenchSummary,
    operation_id="getPublicationWorkbenchSummary",
)
def get_publication_workbench_summary(
    db: DbSession, _user: CurrentUser
) -> PublicationWorkbenchSummary:
    return publication_workbench_summary(db)


@router.get(
    "/platform-accounts", response_model=PlatformAccountList, operation_id="listPlatformAccounts"
)
def list_platform_accounts(
    db: DbSession,
    user: CurrentUser,
    platform_profile_id: uuid.UUID | None = None,
) -> PlatformAccountList:
    query = select(PlatformAccount)
    if platform_profile_id is not None:
        query = query.where(PlatformAccount.platform_profile_id == platform_profile_id)
    accounts = list(db.scalars(query.order_by(PlatformAccount.label)))
    return PlatformAccountList(
        items=platform_accounts_out(
            db,
            accounts,
            can_delete=user.account_type == AccountType.ADMIN.value,
        )
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
    account = create_platform_account_command(
        db=db,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
    )
    return platform_account_out(
        db, account, can_delete=editor.account_type == AccountType.ADMIN.value
    )


@router.patch(
    "/platform-accounts/{platform_account_id}",
    response_model=PlatformAccountOut,
    operation_id="updatePlatformAccount",
)
def update_platform_account(
    platform_account_id: uuid.UUID,
    payload: PlatformAccountUpdate,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> PlatformAccountOut:
    account = update_platform_account_command(
        db=db,
        platform_account_id=platform_account_id,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
    )
    return platform_account_out(
        db, account, can_delete=editor.account_type == AccountType.ADMIN.value
    )


def _set_platform_account_status(
    *,
    platform_account_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    enabled: bool,
) -> PlatformAccountOut:
    account = set_platform_account_enabled_command(
        db=db,
        platform_account_id=platform_account_id,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
        enabled=enabled,
    )
    return platform_account_out(
        db, account, can_delete=editor.account_type == AccountType.ADMIN.value
    )


@router.post(
    "/platform-accounts/{platform_account_id}/enable",
    response_model=PlatformAccountOut,
    operation_id="enablePlatformAccount",
)
def enable_platform_account(
    platform_account_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> PlatformAccountOut:
    return _set_platform_account_status(
        platform_account_id=platform_account_id,
        payload=payload,
        request=request,
        db=db,
        editor=editor,
        enabled=True,
    )


@router.post(
    "/platform-accounts/{platform_account_id}/disable",
    response_model=PlatformAccountOut,
    operation_id="disablePlatformAccount",
)
def disable_platform_account(
    platform_account_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> PlatformAccountOut:
    return _set_platform_account_status(
        platform_account_id=platform_account_id,
        payload=payload,
        request=request,
        db=db,
        editor=editor,
        enabled=False,
    )


@router.delete(
    "/platform-accounts/{platform_account_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deletePlatformAccount",
)
def delete_platform_account(
    platform_account_id: uuid.UUID,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
    _csrf: CsrfProtected,
) -> None:
    assert_account_types(admin, (AccountType.ADMIN,))
    delete_platform_account_command(
        db=db,
        platform_account_id=platform_account_id,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/publication-works",
    response_model=PublicationWorkOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createPublicationWork",
)
def create_work(
    payload: PublicationWorkCreate,
    request: Request,
    db: DbSession,
    editor: CurrentUser,
    _csrf: CsrfProtected,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)],
) -> PublicationWorkOut:
    assert_account_types(editor, (AccountType.ADMIN, AccountType.ENGINEER))
    return create_publication_work(
        db=db,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
        idempotency_key=idempotency_key,
    )


@router.get(
    "/publication-works",
    response_model=PublicationWorkList,
    operation_id="listPublicationWorks",
)
def list_publication_works(
    db: DbSession,
    _user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: Annotated[PublicationWorkStatus | None, Query(alias="status")] = None,
    platform_account_id: uuid.UUID | None = None,
    content_task_id: uuid.UUID | None = None,
) -> PublicationWorkList:
    return list_publication_works_service(
        db,
        page=page,
        page_size=page_size,
        status_filter=status_filter.value if status_filter else None,
        platform_account_id=platform_account_id,
        content_task_id=content_task_id,
    )


@router.get(
    "/publication-works/{work_id}",
    response_model=PublicationWorkOut,
    operation_id="getPublicationWork",
)
def get_publication_work(
    work_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> PublicationWorkOut:
    work = db.get(PublicationWork, work_id)
    if work is None:
        raise not_found("发布工作")
    return publication_work_out(db, work)


@router.patch(
    "/publication-works/{work_id}/preparation",
    response_model=PublicationWorkOut,
    operation_id="updatePublicationPreparation",
)
def update_preparation(
    work_id: uuid.UUID,
    payload: PublicationPreparationUpdate,
    request: Request,
    db: DbSession,
    editor: CurrentUser,
    _csrf: CsrfProtected,
) -> PublicationWorkOut:
    return _run_publication_command(
        actor=editor,
        command=lambda: update_publication_preparation(
            db=db,
            work_id=work_id,
            payload=payload,
            actor=editor,
            request_id=request.state.request_id,
        ),
    )


@router.post(
    "/publication-works/{work_id}/platform-review",
    response_model=PublicationWorkOut,
    operation_id="markPublicationPlatformReview",
)
def mark_platform_review(
    work_id: uuid.UUID,
    payload: PublicationPlatformReviewRequest,
    request: Request,
    db: DbSession,
    editor: CurrentUser,
    _csrf: CsrfProtected,
) -> PublicationWorkOut:
    return _run_publication_command(
        actor=editor,
        command=lambda: mark_publication_platform_review(
            db=db,
            work_id=work_id,
            payload=payload,
            actor=editor,
            request_id=request.state.request_id,
        ),
    )


@router.put(
    "/publication-works/{work_id}/result",
    response_model=PublicationWorkOut,
    operation_id="registerPublicationResult",
)
def register_result(
    work_id: uuid.UUID,
    payload: PublicationResultUpdate,
    request: Request,
    db: DbSession,
    editor: CurrentUser,
    _csrf: CsrfProtected,
) -> PublicationWorkOut:
    return _run_publication_command(
        actor=editor,
        command=lambda: register_publication_result(
            db=db,
            work_id=work_id,
            payload=payload,
            actor=editor,
            request_id=request.state.request_id,
        ),
    )


@router.post(
    "/publication-works/{work_id}/content-version",
    response_model=PublicationWorkOut,
    operation_id="switchPublicationContentVersion",
)
def switch_content_version(
    work_id: uuid.UUID,
    payload: PublicationContentVersionSwitchRequest,
    request: Request,
    db: DbSession,
    editor: CurrentUser,
    _csrf: CsrfProtected,
) -> PublicationWorkOut:
    return _run_publication_command(
        actor=editor,
        command=lambda: switch_publication_content_version(
            db=db,
            work_id=work_id,
            payload=payload,
            actor=editor,
            request_id=request.state.request_id,
        ),
    )


@router.post(
    "/publication-works/{work_id}/verifications",
    response_model=PublicationWorkOut,
    operation_id="verifyPublicationWork",
)
def verify_work(
    work_id: uuid.UUID,
    payload: PublicationVerificationCreate,
    request: Request,
    db: DbSession,
    editor: CurrentUser,
    _csrf: CsrfProtected,
) -> PublicationWorkOut:
    return _run_publication_command(
        actor=editor,
        command=lambda: verify_publication_work(
            db=db,
            work_id=work_id,
            payload=payload,
            actor=editor,
            request_id=request.state.request_id,
        ),
    )


@router.post(
    "/publication-works/{work_id}/close",
    response_model=PublicationWorkOut,
    operation_id="closePublicationWork",
)
def close_work(
    work_id: uuid.UUID,
    payload: PublicationWorkCloseRequest,
    request: Request,
    db: DbSession,
    editor: CurrentUser,
    _csrf: CsrfProtected,
) -> PublicationWorkOut:
    return _run_publication_command(
        actor=editor,
        command=lambda: close_publication_work(
            db=db,
            work_id=work_id,
            payload=payload,
            actor=editor,
            request_id=request.state.request_id,
        ),
    )


@router.get(
    "/published-articles",
    response_model=PublishedArticleList,
    operation_id="listPublishedArticles",
)
def list_published_articles(
    db: DbSession,
    _user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> PublishedArticleList:
    return list_published_articles_service(db, page=page, page_size=page_size)


@router.get(
    "/published-articles/{article_id}",
    response_model=PublishedArticleOut,
    operation_id="getPublishedArticle",
)
def get_published_article(
    article_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> PublishedArticleOut:
    article = db.get(PublishedArticle, article_id)
    if article is None:
        raise not_found("发布成果")
    return published_article_out(db, article)


@router.post(
    "/published-articles/{article_id}/issues",
    response_model=PublishedContentIssueOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="openPublishedContentIssue",
)
def open_content_issue(
    article_id: uuid.UUID,
    payload: PublishedContentIssueCreate,
    request: Request,
    db: DbSession,
    editor: CurrentUser,
    _csrf: CsrfProtected,
) -> PublishedContentIssueOut:
    return _run_publication_command(
        actor=editor,
        command=lambda: open_published_content_issue(
            db=db,
            article_id=article_id,
            payload=payload,
            actor=editor,
            request_id=request.state.request_id,
        ),
    )


@router.get(
    "/published-content-issues",
    response_model=PublishedContentIssueList,
    operation_id="listPublishedContentIssues",
)
def list_published_content_issues(
    db: DbSession,
    _user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: Annotated[PublishedContentIssueStatus | None, Query(alias="status")] = None,
) -> PublishedContentIssueList:
    return list_published_content_issues_service(
        db,
        page=page,
        page_size=page_size,
        status_filter=status_filter.value if status_filter else None,
    )


@router.get(
    "/published-content-issues/{issue_id}",
    response_model=PublishedContentIssueOut,
    operation_id="getPublishedContentIssue",
)
def get_published_content_issue(
    issue_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> PublishedContentIssueOut:
    issue = db.get(PublishedContentIssue, issue_id)
    if issue is None:
        raise not_found("发布后内容问题")
    return published_content_issue_out(db, issue)


@router.get(
    "/published-content-issues/{issue_id}/repair-context",
    response_model=PublishedContentRepairContext,
    operation_id="getPublishedContentRepairContext",
)
def get_repair_context(
    issue_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> PublishedContentRepairContext:
    return get_published_content_repair_context(
        db,
        issue_id,
        can_delete=user.account_type == AccountType.ADMIN.value,
    )


@router.post(
    "/published-content-issues/{issue_id}/repair-task",
    response_model=ContentTaskOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createPublishedContentRepairTask",
)
def create_published_content_repair_task(
    issue_id: uuid.UUID,
    payload: PublishedContentRepairTaskCreate,
    request: Request,
    db: DbSession,
    editor: CurrentUser,
    _csrf: CsrfProtected,
) -> ContentTaskOut:
    task = _run_publication_command(
        actor=editor,
        command=lambda: create_repair_task(
            db=db,
            issue_id=issue_id,
            payload=payload,
            actor=editor,
            request_id=request.state.request_id,
        ),
    )
    return content_task_out(db, task)


@router.post(
    "/published-content-issues/{issue_id}/resolve",
    response_model=PublishedContentIssueOut,
    operation_id="resolvePublishedContentIssue",
)
def resolve_content_issue(
    issue_id: uuid.UUID,
    payload: PublishedContentIssueResolveRequest,
    request: Request,
    db: DbSession,
    editor: CurrentUser,
    _csrf: CsrfProtected,
) -> PublishedContentIssueOut:
    return _run_publication_command(
        actor=editor,
        command=lambda: resolve_published_content_issue(
            db=db,
            issue_id=issue_id,
            payload=payload,
            actor=editor,
            request_id=request.state.request_id,
        ),
    )
