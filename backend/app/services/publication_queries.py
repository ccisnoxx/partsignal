"""发布就绪项、工作、成果、内容问题与安全正文的只读投影。"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Mapping
from html.parser import HTMLParser
from typing import Any

import bleach
import markdown
from sqlalchemy import case, func, select
from sqlalchemy.engine import Row
from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.models.configuration import PlatformProfile, QueryTopic
from app.models.content import ContentTask, ContentVersion
from app.models.geo_files import FileRecord
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
from app.schemas.publication import (
    FactVersionCandidate,
    FileRecordOut,
    PlatformAccountOut,
    PublicationReadyItem,
    PublicationReadyItemList,
    PublicationVerificationOut,
    PublicationWorkAction,
    PublicationWorkbenchSummary,
    PublicationWorkEventOut,
    PublicationWorkList,
    PublicationWorkListItem,
    PublicationWorkOut,
    PublishedArticleAction,
    PublishedArticleList,
    PublishedArticleListItem,
    PublishedArticleOut,
    PublishedContentIssueAction,
    PublishedContentIssueHistoryItem,
    PublishedContentIssueList,
    PublishedContentIssueListItem,
    PublishedContentIssueOut,
    PublishedContentRepairContext,
    VersionChange,
    VersionDifference,
)
from app.services.content_planning import query_topic_out
from app.services.product_facts import product_out
from app.services.projections import (
    content_task_out,
    content_versions_out,
    fact_version_out,
    fact_versions_out,
    platform_accounts_out,
)

NONTERMINAL_WORK_STATUSES = (
    "PREPARING",
    "PLATFORM_REVIEW",
    "AWAITING_VERIFICATION",
    "ACTION_REQUIRED",
)


def publication_work_actions(
    status: str,
) -> tuple[list[PublicationWorkAction], PublicationWorkAction | None]:
    """返回发布工作当前可执行动作及唯一主动作。"""
    actions_by_status: dict[str, list[PublicationWorkAction]] = {
        "PREPARING": [
            "REGISTER_RESULT",
            "UPDATE_PREPARATION",
            "MARK_PLATFORM_REVIEW",
            "CLOSE",
        ],
        "PLATFORM_REVIEW": ["REGISTER_RESULT", "UPDATE_PREPARATION", "CLOSE"],
        "AWAITING_VERIFICATION": ["VERIFY", "REGISTER_RESULT", "CLOSE"],
        "ACTION_REQUIRED": ["VERIFY", "REGISTER_RESULT", "CLOSE"],
    }
    actions = actions_by_status.get(status, [])
    return actions, (actions[0] if actions else None)


def published_article_actions(
    *, has_open_issue: bool, retired: bool
) -> tuple[list[PublishedArticleAction], PublishedArticleAction | None]:
    """只有当前健康且从未退役的文章可以打开问题。"""
    actions: list[PublishedArticleAction] = [] if has_open_issue or retired else ["OPEN_ISSUE"]
    return actions, (actions[0] if actions else None)


def published_content_issue_actions(
    *, status: str, repair_task_id: uuid.UUID | None
) -> tuple[list[PublishedContentIssueAction], PublishedContentIssueAction | None]:
    """返回内容问题当前可执行动作及唯一主动作。"""
    if status != "OPEN":
        return [], None
    actions: list[PublishedContentIssueAction] = []
    if repair_task_id is None:
        actions.append("CREATE_REPAIR_TASK")
    actions.append("RESOLVE")
    return actions, actions[0]


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


def task_for_work(db: Session, work: PublicationWork) -> ContentTask:
    """返回发布工作锁定内容所属的原任务。"""
    task = db.scalar(
        select(ContentTask)
        .join(ContentVersion, ContentVersion.task_id == ContentTask.id)
        .where(ContentVersion.id == work.content_version_id)
    )
    if task is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布工作关联的内容任务不存在", 409)
    return task


def list_publication_ready_items(
    db: Session, *, can_delete_accounts: bool
) -> PublicationReadyItemList:
    """实时返回尚未开始且满足平台身份约束的发布就绪项。"""
    work_for_content = (
        select(PublicationWork.id)
        .where(PublicationWork.content_version_id == ContentVersion.id)
        .exists()
    )
    active_same_hash = (
        select(PublicationWork.id)
        .where(
            PublicationWork.platform_profile_id == ContentTask.platform_profile_id,
            PublicationWork.content_hash == ContentVersion.content_hash,
            PublicationWork.status != "CLOSED",
        )
        .exists()
    )
    rows = db.execute(
        select(ContentVersion, ContentTask, PlatformProfile)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .join(FactVersion, FactVersion.id == ContentVersion.fact_version_id)
        .join(PlatformProfile, PlatformProfile.id == ContentTask.platform_profile_id)
        .where(
            ContentVersion.status == "APPROVED",
            FactVersion.status == "APPROVED",
            ContentTask.status == "OPEN",
            PlatformProfile.is_active.is_(True),
            ~work_for_content,
            ~active_same_hash,
            select(PlatformAccount.id)
            .where(
                PlatformAccount.platform_profile_id == PlatformProfile.id,
                PlatformAccount.is_active.is_(True),
            )
            .exists(),
        )
        .order_by(ContentVersion.created_at.desc(), ContentVersion.id)
    ).all()
    profile_ids = {profile.id for _content, _task, profile in rows}
    accounts = (
        list(
            db.scalars(
                select(PlatformAccount)
                .where(
                    PlatformAccount.platform_profile_id.in_(profile_ids),
                    PlatformAccount.is_active.is_(True),
                )
                .order_by(PlatformAccount.label, PlatformAccount.id)
            )
        )
        if profile_ids
        else []
    )
    accounts_by_profile: defaultdict[uuid.UUID, list[PlatformAccountOut]] = defaultdict(list)
    for account in platform_accounts_out(db, accounts, can_delete=can_delete_accounts):
        accounts_by_profile[account.platform_profile_id].append(account)
    contents = [content for content, _task, _profile in rows]
    projected_contents = {
        content.id: item
        for content, item in zip(contents, content_versions_out(db, contents), strict=True)
    }
    return PublicationReadyItemList(
        items=[
            PublicationReadyItem(
                content_version=projected_contents[content.id],
                task_id=task.id,
                platform_profile_id=profile.id,
                platform_profile_name=profile.name,
                matching_accounts=accounts_by_profile[profile.id],
                available_actions=["START"],
                primary_action="START",
            )
            for content, task, profile in rows
        ]
    )


def _work_context_query() -> Any:
    return (
        select(
            PublicationWork,
            ContentTask.id.label("task_id"),
            ContentVersion.title.label("content_title"),
            ContentVersion.version.label("content_version"),
            PlatformProfile.name.label("platform_profile_name"),
            PlatformAccount.label.label("platform_account_label"),
            PlatformAccount.account_identifier,
        )
        .join(ContentVersion, ContentVersion.id == PublicationWork.content_version_id)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .join(PlatformProfile, PlatformProfile.id == PublicationWork.platform_profile_id)
        .join(PlatformAccount, PlatformAccount.id == PublicationWork.platform_account_id)
    )


def _latest_verification(db: Session, work_id: uuid.UUID) -> PublicationVerification | None:
    return db.scalar(
        select(PublicationVerification)
        .where(PublicationVerification.publication_work_id == work_id)
        .order_by(PublicationVerification.created_at.desc(), PublicationVerification.id.desc())
        .limit(1)
    )


def _work_list_item(
    row: Row[Any], latest: PublicationVerification | None
) -> PublicationWorkListItem:
    work = row[0]
    actions, primary_action = publication_work_actions(work.status)
    return PublicationWorkListItem.model_validate(
        {
            "id": work.id,
            "task_id": row.task_id,
            "content_version_id": work.content_version_id,
            "content_title": row.content_title,
            "content_version": row.content_version,
            "platform_profile_id": work.platform_profile_id,
            "platform_profile_name": row.platform_profile_name,
            "platform_account_id": work.platform_account_id,
            "platform_account_label": row.platform_account_label,
            "account_identifier": row.account_identifier,
            "section_url": work.section_url,
            "actual_title": work.actual_title,
            "final_url": work.final_url,
            "published_at": work.published_at,
            "status": work.status,
            "revision": work.revision,
            "close_reason": work.close_reason,
            "close_comment": work.close_comment,
            "created_at": work.created_at,
            "updated_at": work.updated_at,
            "latest_verification_outcome": latest.outcome if latest else None,
            "latest_verification_at": latest.created_at if latest else None,
            "available_actions": actions,
            "primary_action": primary_action,
        }
    )


def publication_work_out(db: Session, work: PublicationWork) -> PublicationWorkOut:
    """投影发布工作详情、事件、核验快照与附件。"""
    row = db.execute(_work_context_query().where(PublicationWork.id == work.id)).one_or_none()
    if row is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布工作锁定上下文不完整", 409)
    events = list(
        db.scalars(
            select(PublicationWorkEvent)
            .where(PublicationWorkEvent.publication_work_id == work.id)
            .order_by(PublicationWorkEvent.created_at, PublicationWorkEvent.id)
        )
    )
    verifications = list(
        db.scalars(
            select(PublicationVerification)
            .where(PublicationVerification.publication_work_id == work.id)
            .order_by(PublicationVerification.created_at, PublicationVerification.id)
        )
    )
    files = list(
        db.scalars(
            select(FileRecord)
            .join(PublicationAttachment, PublicationAttachment.file_id == FileRecord.id)
            .where(PublicationAttachment.publication_work_id == work.id)
            .order_by(FileRecord.created_at, FileRecord.id)
        )
    )
    item = _work_list_item(row, verifications[-1] if verifications else None)
    return PublicationWorkOut(
        **item.model_dump(),
        content_hash=work.content_hash,
        closed_by=work.closed_by,
        closed_at=work.closed_at,
        created_by=work.created_by,
        events=[PublicationWorkEventOut.model_validate(event) for event in events],
        verifications=[PublicationVerificationOut.model_validate(item) for item in verifications],
        attachments=[FileRecordOut.model_validate(file) for file in files],
    )


def list_publication_works(
    db: Session,
    *,
    page: int,
    page_size: int,
    status_filter: str | None,
) -> PublicationWorkList:
    """按处理优先级分页返回发布工作；未指定状态时只返回未终结待办。"""
    query = _work_context_query()
    count_query = select(func.count()).select_from(PublicationWork)
    statuses = (status_filter,) if status_filter is not None else NONTERMINAL_WORK_STATUSES
    query = query.where(PublicationWork.status.in_(statuses))
    count_query = count_query.where(PublicationWork.status.in_(statuses))
    total = int(db.scalar(count_query) or 0)
    rows = db.execute(
        query.order_by(
            case(
                (PublicationWork.status == "ACTION_REQUIRED", 0),
                (PublicationWork.status == "AWAITING_VERIFICATION", 1),
                (PublicationWork.status == "PLATFORM_REVIEW", 2),
                (PublicationWork.status == "PREPARING", 3),
                (PublicationWork.status == "CLOSED", 4),
                else_=5,
            ),
            PublicationWork.updated_at.desc(),
            PublicationWork.id,
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    work_ids = [row[0].id for row in rows]
    ranked = (
        select(
            PublicationVerification,
            func.row_number()
            .over(
                partition_by=PublicationVerification.publication_work_id,
                order_by=(
                    PublicationVerification.created_at.desc(),
                    PublicationVerification.id.desc(),
                ),
            )
            .label("position"),
        )
        .where(PublicationVerification.publication_work_id.in_(work_ids))
        .subquery()
    )
    latest_by_work: dict[uuid.UUID, PublicationVerification] = {}
    if work_ids:
        for verification in db.scalars(
            select(PublicationVerification)
            .join(ranked, ranked.c.id == PublicationVerification.id)
            .where(ranked.c.position == 1)
        ):
            latest_by_work[verification.publication_work_id] = verification
    return PublicationWorkList(
        items=[_work_list_item(row, latest_by_work.get(row[0].id)) for row in rows],
        page=page,
        page_size=page_size,
        total=total,
    )


def _article_context_query() -> Any:
    return (
        select(
            PublishedArticle,
            PublicationWork,
            PublicationVerification,
            ContentTask.id.label("task_id"),
            ContentVersion.title.label("content_title"),
            ContentVersion.version.label("content_version"),
            PlatformProfile.name.label("platform_profile_name"),
            PlatformAccount.label.label("platform_account_label"),
            PlatformAccount.account_identifier,
        )
        .join(PublicationWork, PublicationWork.id == PublishedArticle.id)
        .join(
            PublicationVerification, PublicationVerification.id == PublishedArticle.verification_id
        )
        .join(ContentVersion, ContentVersion.id == PublicationWork.content_version_id)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .join(PlatformProfile, PlatformProfile.id == PublicationWork.platform_profile_id)
        .join(PlatformAccount, PlatformAccount.id == PublicationWork.platform_account_id)
    )


def _article_item(
    row: Row[Any], issue_rows: list[tuple[str, str | None]]
) -> PublishedArticleListItem:
    article, work, verification = row[0], row[1], row[2]
    has_open_issue = any(status == "OPEN" for status, _outcome in issue_rows)
    retired = any(outcome == "RETIRED" for _status, outcome in issue_rows)
    actions, primary_action = published_article_actions(
        has_open_issue=has_open_issue,
        retired=retired,
    )
    if work.actual_title is None or work.final_url is None or work.published_at is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布成果缺少冻结结果", 409)
    return PublishedArticleListItem.model_validate(
        {
            "id": article.id,
            "task_id": row.task_id,
            "content_version_id": work.content_version_id,
            "content_title": row.content_title,
            "content_version": row.content_version,
            "platform_profile_id": work.platform_profile_id,
            "platform_profile_name": row.platform_profile_name,
            "platform_account_id": work.platform_account_id,
            "platform_account_label": row.platform_account_label,
            "account_identifier": row.account_identifier,
            "actual_title": work.actual_title,
            "final_url": work.final_url,
            "published_at": work.published_at,
            "verified_at": verification.created_at,
            "has_open_issue": has_open_issue,
            "retired": retired,
            "available_actions": actions,
            "primary_action": primary_action,
        }
    )


def published_article_out(db: Session, article: PublishedArticle) -> PublishedArticleOut:
    """投影只读发布成果及其历史问题。"""
    row = db.execute(
        _article_context_query().where(PublishedArticle.id == article.id)
    ).one_or_none()
    if row is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布成果上下文不完整", 409)
    issue_rows = [
        (status, outcome)
        for status, outcome in db.execute(
            select(PublishedContentIssue.status, PublishedContentIssue.resolution_outcome).where(
                PublishedContentIssue.published_article_id == article.id
            )
        )
    ]
    item = _article_item(row, issue_rows)
    work, verification = row[1], row[2]
    issues = list(
        db.scalars(
            select(PublishedContentIssue)
            .where(PublishedContentIssue.published_article_id == article.id)
            .order_by(PublishedContentIssue.opened_at.desc(), PublishedContentIssue.id)
        )
    )
    return PublishedArticleOut(
        **item.model_dump(),
        section_url=work.section_url,
        content_hash=work.content_hash,
        verification=PublicationVerificationOut.model_validate(verification),
        issues=[PublishedContentIssueHistoryItem.model_validate(issue) for issue in issues],
    )


def list_published_articles(db: Session, *, page: int, page_size: int) -> PublishedArticleList:
    """按首次核验时间倒序分页返回发布成果。"""
    total = int(db.scalar(select(func.count()).select_from(PublishedArticle)) or 0)
    rows = db.execute(
        _article_context_query()
        .order_by(PublicationVerification.created_at.desc(), PublishedArticle.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    article_ids = [row[0].id for row in rows]
    issue_states: defaultdict[uuid.UUID, list[tuple[str, str | None]]] = defaultdict(list)
    if article_ids:
        for article_id, issue_status, outcome in db.execute(
            select(
                PublishedContentIssue.published_article_id,
                PublishedContentIssue.status,
                PublishedContentIssue.resolution_outcome,
            ).where(PublishedContentIssue.published_article_id.in_(article_ids))
        ):
            issue_states[article_id].append((issue_status, outcome))
    return PublishedArticleList(
        items=[_article_item(row, issue_states[row[0].id]) for row in rows],
        page=page,
        page_size=page_size,
        total=total,
    )


def _issue_repair_task_id(db: Session, issue_id: uuid.UUID) -> uuid.UUID | None:
    return db.scalar(
        select(ContentTask.id).where(ContentTask.source_published_content_issue_id == issue_id)
    )


def published_content_issue_out(
    db: Session, issue: PublishedContentIssue
) -> PublishedContentIssueOut:
    """投影内容问题、原文章与修复任务入口。"""
    article = db.get(PublishedArticle, issue.published_article_id)
    if article is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "内容问题关联的发布成果不存在", 409)
    article_out = published_article_out(db, article)
    repair_task_id = _issue_repair_task_id(db, issue.id)
    actions, primary_action = published_content_issue_actions(
        status=issue.status,
        repair_task_id=repair_task_id,
    )
    return PublishedContentIssueOut.model_validate(
        {
            "id": issue.id,
            "published_article_id": issue.published_article_id,
            "content_title": article_out.content_title,
            "platform_profile_name": article_out.platform_profile_name,
            "actual_title": article_out.actual_title,
            "final_url": article_out.final_url,
            "kind": issue.kind,
            "description": issue.description,
            "status": issue.status,
            "revision": issue.revision,
            "opened_by": issue.opened_by,
            "opened_at": issue.opened_at,
            "resolved_by": issue.resolved_by,
            "resolved_at": issue.resolved_at,
            "resolution_outcome": issue.resolution_outcome,
            "resolution_comment": issue.resolution_comment,
            "repair_task_id": repair_task_id,
            "available_actions": actions,
            "primary_action": primary_action,
            "article": {
                field: getattr(article_out, field)
                for field in PublishedArticleListItem.model_fields
            },
        }
    )


def list_published_content_issues(
    db: Session,
    *,
    page: int,
    page_size: int,
    status_filter: str | None,
) -> PublishedContentIssueList:
    """按状态和打开时间分页返回发布后内容问题。"""
    query = select(PublishedContentIssue)
    count_query = select(func.count()).select_from(PublishedContentIssue)
    if status_filter is not None:
        query = query.where(PublishedContentIssue.status == status_filter)
        count_query = count_query.where(PublishedContentIssue.status == status_filter)
    total = int(db.scalar(count_query) or 0)
    issues = list(
        db.scalars(
            query.order_by(PublishedContentIssue.opened_at.desc(), PublishedContentIssue.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    article_ids = {issue.published_article_id for issue in issues}
    article_rows = (
        {
            row[0].id: row
            for row in db.execute(
                _article_context_query().where(PublishedArticle.id.in_(article_ids))
            ).all()
        }
        if article_ids
        else {}
    )
    issue_states: defaultdict[uuid.UUID, list[tuple[str, str | None]]] = defaultdict(list)
    if article_ids:
        for article_id, issue_status, outcome in db.execute(
            select(
                PublishedContentIssue.published_article_id,
                PublishedContentIssue.status,
                PublishedContentIssue.resolution_outcome,
            ).where(PublishedContentIssue.published_article_id.in_(article_ids))
        ):
            issue_states[article_id].append((issue_status, outcome))
    repair_tasks = {
        source_id: task_id
        for source_id, task_id in db.execute(
            select(ContentTask.source_published_content_issue_id, ContentTask.id).where(
                ContentTask.source_published_content_issue_id.in_([issue.id for issue in issues])
            )
        )
        if source_id is not None
    }
    items: list[PublishedContentIssueListItem] = []
    for issue in issues:
        row = article_rows.get(issue.published_article_id)
        if row is None:
            raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "内容问题关联的发布成果不存在", 409)
        article = _article_item(row, issue_states[issue.published_article_id])
        repair_task_id = repair_tasks.get(issue.id)
        actions, primary_action = published_content_issue_actions(
            status=issue.status,
            repair_task_id=repair_task_id,
        )
        items.append(
            PublishedContentIssueListItem.model_validate(
                {
                    **PublishedContentIssueHistoryItem.model_validate(issue).model_dump(),
                    "published_article_id": issue.published_article_id,
                    "content_title": article.content_title,
                    "platform_profile_name": article.platform_profile_name,
                    "actual_title": article.actual_title,
                    "final_url": article.final_url,
                    "revision": issue.revision,
                    "repair_task_id": repair_task_id,
                    "available_actions": actions,
                    "primary_action": primary_action,
                }
            )
        )
    return PublishedContentIssueList(items=items, page=page, page_size=page_size, total=total)


def publication_workbench_summary(db: Session) -> PublicationWorkbenchSummary:
    """返回发布工作台五个互斥运营口径。"""
    work_for_content = (
        select(PublicationWork.id)
        .where(PublicationWork.content_version_id == ContentVersion.id)
        .exists()
    )
    active_same_hash = (
        select(PublicationWork.id)
        .where(
            PublicationWork.platform_profile_id == ContentTask.platform_profile_id,
            PublicationWork.content_hash == ContentVersion.content_hash,
            PublicationWork.status != "CLOSED",
        )
        .exists()
    )
    ready_count = int(
        db.scalar(
            select(func.count())
            .select_from(ContentVersion)
            .join(ContentTask, ContentTask.id == ContentVersion.task_id)
            .join(FactVersion, FactVersion.id == ContentVersion.fact_version_id)
            .join(PlatformProfile, PlatformProfile.id == ContentTask.platform_profile_id)
            .where(
                ContentVersion.status == "APPROVED",
                FactVersion.status == "APPROVED",
                ContentTask.status == "OPEN",
                PlatformProfile.is_active.is_(True),
                ~work_for_content,
                ~active_same_hash,
                select(PlatformAccount.id)
                .where(
                    PlatformAccount.platform_profile_id == PlatformProfile.id,
                    PlatformAccount.is_active.is_(True),
                )
                .exists(),
            )
        )
        or 0
    )
    counts = {
        status: int(
            db.scalar(
                select(func.count())
                .select_from(PublicationWork)
                .where(PublicationWork.status == status)
            )
            or 0
        )
        for status in (
            "PREPARING",
            "PLATFORM_REVIEW",
            "AWAITING_VERIFICATION",
            "ACTION_REQUIRED",
        )
    }
    open_issue_count = int(
        db.scalar(
            select(func.count())
            .select_from(PublishedContentIssue)
            .where(PublishedContentIssue.status == "OPEN")
        )
        or 0
    )
    return PublicationWorkbenchSummary(
        ready_count=ready_count,
        active_count=counts["PREPARING"] + counts["PLATFORM_REVIEW"],
        awaiting_verification_count=counts["AWAITING_VERIFICATION"],
        action_required_count=counts["ACTION_REQUIRED"],
        open_issue_count=open_issue_count,
    )


def _difference(
    from_id: uuid.UUID,
    to_id: uuid.UUID,
    before: Mapping[str, object],
    after: Mapping[str, object],
) -> VersionDifference:
    changes = [
        VersionChange(field=field, before=before.get(field), after=after.get(field))
        for field in sorted(set(before) | set(after))
        if before.get(field) != after.get(field)
    ]
    return VersionDifference(from_id=from_id, to_id=to_id, changes=changes)


def get_published_content_repair_context(
    db: Session, issue_id: uuid.UUID, *, can_delete: bool
) -> PublishedContentRepairContext:
    """返回问题修复所需的锁定业务上下文和事实候选。"""
    issue = db.get(PublishedContentIssue, issue_id)
    if issue is None:
        raise not_found("发布后内容问题")
    article = db.get(PublishedArticle, issue.published_article_id)
    work = db.get(PublicationWork, article.id) if article else None
    if work is None or article is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "内容问题关联的发布成果不存在", 409)
    task = task_for_work(db, work)
    product = db.get(Product, task.product_id)
    topic = db.get(QueryTopic, task.query_topic_id) if task.query_topic_id is not None else None
    original_fact = db.get(FactVersion, task.fact_version_id)
    profile = db.get(PlatformProfile, work.platform_profile_id)
    if any(item is None for item in (product, original_fact, profile)) or (
        task.query_topic_id is not None and topic is None
    ):
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布修复上下文不完整", 409)
    assert product is not None
    assert original_fact is not None
    assert profile is not None
    candidates = list(
        db.scalars(
            select(FactVersion)
            .where(FactVersion.product_id == task.product_id, FactVersion.status == "APPROVED")
            .order_by(FactVersion.version.desc(), FactVersion.id)
        )
    )
    candidates = [candidate for candidate in candidates if candidate.body_markdown.strip()]
    before = {
        "body_markdown": original_fact.body_markdown,
        "classification": original_fact.classification,
    }
    return PublishedContentRepairContext(
        issue=published_content_issue_out(db, issue),
        article=published_article_out(db, article),
        original_task=content_task_out(db, task),
        product=product_out(db, product, can_delete=can_delete),
        query_topic=query_topic_out(topic) if topic is not None else None,
        platform_profile_id=profile.id,
        platform_profile_name=profile.name,
        original_fact_version=fact_version_out(db, original_fact, can_delete=can_delete),
        fact_candidates=[
            FactVersionCandidate(
                version=projected,
                difference=_difference(
                    original_fact.id,
                    candidate.id,
                    before,
                    {
                        "body_markdown": candidate.body_markdown,
                        "classification": candidate.classification,
                    },
                ),
            )
            for candidate, projected in zip(
                candidates,
                fact_versions_out(db, candidates, can_delete=can_delete),
                strict=True,
            )
        ],
    )


def open_issue_count(db: Session) -> int:
    """返回开放发布后内容问题数量。"""
    return int(
        db.scalar(
            select(func.count())
            .select_from(PublishedContentIssue)
            .where(PublishedContentIssue.status == "OPEN")
        )
        or 0
    )
