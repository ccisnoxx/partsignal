"""Slice 2D：基于单次 REPEATABLE READ 快照的运营收件箱聚合读模型（不建第二份待办表）。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.configuration import QueryTopic
from app.models.content import ContentTask, ContentVersion
from app.models.geo_catalog import GeoSubject
from app.models.geo_opportunities import GeoOpportunity
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.models.publication import PublicationWork, PublishedContentIssue
from app.schemas.content import ActorSummary
from app.schemas.work_assignment import (
    WorkbenchInbox,
    WorkbenchInboxBucket,
    WorkbenchInboxCounts,
    WorkbenchInboxItem,
    WorkbenchInboxItemKind,
    WorkPriority,
)
from app.services.product_facts import db_utc_now

_INBOX_ITEM_LIMIT = 50
_PRIORITY_ORDER: dict[WorkPriority, int] = {
    "CRITICAL": 0,
    "HIGH": 1,
    "MEDIUM": 2,
    "LOW": 3,
}
_PUBLICATION_ACTION_STATUSES = ("PREPARING", "PLATFORM_REVIEW", "ACTION_REQUIRED")
_PUBLICATION_OPEN_STATUSES = (*_PUBLICATION_ACTION_STATUSES, "AWAITING_VERIFICATION")
_OPPORTUNITY_OPEN_STATUSES = ("OPEN", "ACKNOWLEDGED", "IN_PROGRESS")
_MAX_DT = datetime(9999, 12, 31, tzinfo=UTC)


@dataclass(slots=True)
class _RawInboxRow:
    item_kind: WorkbenchInboxItemKind
    resource_id: uuid.UUID
    title: str
    summary: str
    priority: WorkPriority
    assignee_id: uuid.UUID | None
    due_at: datetime | None
    blocked_reason: str | None
    base_buckets: tuple[WorkbenchInboxBucket, ...]
    href: str
    updated_at: datetime


def _resolve_timezone(tz_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise AppError("VALIDATION_ERROR", "无效的 IANA 时区标识", 422) from error


def _collect_fact_review_rows(db: Session) -> list[_RawInboxRow]:
    rows = db.execute(
        select(
            FactVersion.id,
            FactVersion.product_id,
            FactVersion.version,
            FactVersion.priority,
            FactVersion.assignee_id,
            FactVersion.due_at,
            FactVersion.blocked_reason,
            FactVersion.created_at,
            Product.brand,
            Product.part_number,
        )
        .join(Product, Product.id == FactVersion.product_id)
        .where(FactVersion.status == "PENDING_REVIEW")
    ).all()
    return [
        _RawInboxRow(
            item_kind="FACT_REVIEW",
            resource_id=fact_id,
            title=f"{brand} {part_number} · 事实 v{version}",
            summary="产品事实待审核",
            priority=cast(WorkPriority, priority),
            assignee_id=assignee_id,
            due_at=due_at,
            blocked_reason=blocked_reason,
            base_buckets=("pending_review",),
            href=f"/products/{product_id}/facts/review",
            updated_at=created_at,
        )
        for (
            fact_id,
            product_id,
            version,
            priority,
            assignee_id,
            due_at,
            blocked_reason,
            created_at,
            brand,
            part_number,
        ) in rows
    ]


def _collect_content_task_rows(db: Session) -> list[_RawInboxRow]:
    rows = db.execute(
        select(
            ContentTask.id,
            ContentTask.priority,
            ContentTask.assignee_id,
            ContentTask.due_at,
            ContentTask.blocked_reason,
            ContentTask.updated_at,
            ContentTask.platform_profile_name_snapshot,
            Product.brand,
            Product.part_number,
            ContentVersion.status.label("cv_status"),
            ContentVersion.title.label("cv_title"),
        )
        .join(Product, Product.id == ContentTask.product_id)
        .outerjoin(
            ContentVersion,
            ContentVersion.id == ContentTask.current_content_version_id,
        )
        .where(ContentTask.status == "OPEN", ContentTask.archived_at.is_(None))
    ).all()
    items: list[_RawInboxRow] = []
    for (
        task_id,
        priority,
        assignee_id,
        due_at,
        blocked_reason,
        updated_at,
        platform_name,
        brand,
        part_number,
        cv_status,
        cv_title,
    ) in rows:
        is_review = cv_status == "PENDING_REVIEW"
        title = cv_title if cv_title else f"{brand} {part_number} · {platform_name}"
        if is_review:
            items.append(
                _RawInboxRow(
                    item_kind="CONTENT_REVIEW",
                    resource_id=task_id,
                    title=title,
                    summary=f"{platform_name} · 内容版本待审核",
                    priority=cast(WorkPriority, priority),
                    assignee_id=assignee_id,
                    due_at=due_at,
                    blocked_reason=blocked_reason,
                    base_buckets=("pending_review",),
                    href=f"/content/tasks/{task_id}/review",
                    updated_at=updated_at,
                )
            )
        elif assignee_id is not None or due_at is not None or blocked_reason is not None:
            items.append(
                _RawInboxRow(
                    item_kind="CONTENT_TASK",
                    resource_id=task_id,
                    title=title,
                    summary=f"{platform_name} · 进行中内容任务",
                    priority=cast(WorkPriority, priority),
                    assignee_id=assignee_id,
                    due_at=due_at,
                    blocked_reason=blocked_reason,
                    base_buckets=(),
                    href=f"/content/tasks/{task_id}",
                    updated_at=updated_at,
                )
            )
    return items


def _collect_publication_rows(db: Session) -> list[_RawInboxRow]:
    rows = db.execute(
        select(
            PublicationWork.id,
            PublicationWork.status,
            PublicationWork.priority,
            PublicationWork.assignee_id,
            PublicationWork.due_at,
            PublicationWork.blocked_reason,
            PublicationWork.updated_at,
            PublicationWork.platform_profile_name_snapshot,
            ContentVersion.title,
        )
        .join(ContentVersion, ContentVersion.id == PublicationWork.content_version_id)
        .where(PublicationWork.status.in_(_PUBLICATION_OPEN_STATUSES))
    ).all()
    status_meta = {
        "PREPARING": (
            "PUBLICATION_WORK",
            "awaiting_publication",
            "等待人工发布准备",
            "preparation",
        ),
        "PLATFORM_REVIEW": (
            "PUBLICATION_WORK",
            "awaiting_publication",
            "待登记发布结果",
            "result",
        ),
        "ACTION_REQUIRED": (
            "PUBLICATION_WORK",
            "awaiting_publication",
            "需修复并复核",
            "verification",
        ),
        "AWAITING_VERIFICATION": (
            "PUBLICATION_VERIFICATION",
            "awaiting_verification",
            "等待首次页面核验",
            "verification",
        ),
    }
    items: list[_RawInboxRow] = []
    for (
        work_id,
        status,
        priority,
        assignee_id,
        due_at,
        blocked_reason,
        updated_at,
        platform_name,
        title,
    ) in rows:
        kind, bucket, label, anchor = status_meta[status]
        items.append(
            _RawInboxRow(
                item_kind=cast(WorkbenchInboxItemKind, kind),
                resource_id=work_id,
                title=title,
                summary=f"{platform_name} · {label}",
                priority=cast(WorkPriority, priority),
                assignee_id=assignee_id,
                due_at=due_at,
                blocked_reason=blocked_reason,
                base_buckets=(cast(WorkbenchInboxBucket, bucket),),
                href=f"/publishing/work/{work_id}#{anchor}",
                updated_at=updated_at,
            )
        )
    return items


def _collect_issue_and_overdue_fact_rows(db: Session, now: datetime) -> list[_RawInboxRow]:
    issue_rows = db.execute(
        select(
            PublishedContentIssue.id,
            PublishedContentIssue.kind,
            PublishedContentIssue.priority,
            PublishedContentIssue.assignee_id,
            PublishedContentIssue.due_at,
            PublishedContentIssue.blocked_reason,
            PublishedContentIssue.opened_at,
            PublicationWork.platform_profile_name_snapshot,
            ContentVersion.title,
        )
        .join(PublicationWork, PublicationWork.id == PublishedContentIssue.published_article_id)
        .join(ContentVersion, ContentVersion.id == PublicationWork.content_version_id)
        .where(PublishedContentIssue.status == "OPEN")
    ).all()
    kind_labels = {
        "PAGE_UNAVAILABLE": "页面不可用",
        "CONTENT_CHANGED": "内容已变化",
        "OTHER": "其他发布问题",
    }
    items: list[_RawInboxRow] = [
        _RawInboxRow(
            item_kind="CONTENT_ISSUE",
            resource_id=issue_id,
            title=title,
            summary=f"{platform_name} · {kind_labels[kind]}",
            priority=cast(WorkPriority, priority),
            assignee_id=assignee_id,
            due_at=due_at,
            blocked_reason=blocked_reason,
            base_buckets=("needs_fix",),
            href=f"/publishing/issues/{issue_id}",
            updated_at=opened_at,
        )
        for (
            issue_id,
            kind,
            priority,
            assignee_id,
            due_at,
            blocked_reason,
            opened_at,
            platform_name,
            title,
        ) in issue_rows
    ]

    overdue_products = db.execute(
        select(
            Product.id,
            Product.brand,
            Product.part_number,
            Product.next_review_at,
            Product.updated_at,
        ).where(
            Product.status == "ACTIVE",
            Product.next_review_at.is_not(None),
            Product.next_review_at <= now,
        )
    ).all()
    for product_id, brand, part_number, next_review_at, updated_at in overdue_products:
        items.append(
            _RawInboxRow(
                item_kind="OVERDUE_FACT",
                resource_id=product_id,
                title=f"{brand} {part_number}",
                summary="产品事实复核已到期，请确认或修订事实",
                priority="HIGH",
                assignee_id=None,
                due_at=next_review_at,
                blocked_reason=None,
                base_buckets=("needs_fix",),
                href=f"/products/{product_id}/facts",
                updated_at=updated_at,
            )
        )
    return items


def _collect_geo_opportunity_rows(db: Session) -> list[_RawInboxRow]:
    rows = db.execute(
        select(
            GeoOpportunity.id,
            GeoOpportunity.rule_code,
            GeoOpportunity.priority,
            GeoOpportunity.status,
            GeoOpportunity.assignee_id,
            GeoOpportunity.due_at,
            GeoOpportunity.blocked_reason,
            GeoOpportunity.last_seen_at,
            GeoSubject.canonical_name,
            QueryTopic.canonical_question,
        )
        .outerjoin(GeoSubject, GeoSubject.id == GeoOpportunity.subject_id)
        .outerjoin(QueryTopic, QueryTopic.id == GeoOpportunity.query_topic_id)
        .where(GeoOpportunity.status.in_(_OPPORTUNITY_OPEN_STATUSES))
    ).all()
    items: list[_RawInboxRow] = []
    for (
        opp_id,
        rule_code,
        priority,
        status,
        assignee_id,
        due_at,
        blocked_reason,
        last_seen_at,
        subject_name,
        topic_question,
    ) in rows:
        is_high = priority in {"HIGH", "CRITICAL"}
        if not is_high and assignee_id is None and due_at is None:
            continue
        title = topic_question or subject_name or rule_code
        items.append(
            _RawInboxRow(
                item_kind="GEO_OPPORTUNITY",
                resource_id=opp_id,
                title=title,
                summary=f"GEO 机会 · {rule_code}（{status}）",
                priority=cast(WorkPriority, priority),
                assignee_id=assignee_id,
                due_at=due_at,
                blocked_reason=blocked_reason,
                base_buckets=("high_priority_geo_opportunities",) if is_high else (),
                href=f"/geo/opportunities?opportunity_id={opp_id}",
                updated_at=last_seen_at,
            )
        )
    return items


def get_workbench_inbox(
    db: Session,
    *,
    actor: User,
    bucket: WorkbenchInboxBucket = "assigned_to_me",
    timezone_name: str = "Asia/Shanghai",
) -> WorkbenchInbox:
    """在单次 REPEATABLE READ 快照内计算全部 8 个运营收件箱分桶与排序队列。"""
    tz = _resolve_timezone(timezone_name)
    now = db_utc_now(db)
    local_now = now.astimezone(tz)
    local_day_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0, fold=0)
    day_start_utc = local_day_start.astimezone(UTC)
    day_end_utc = (local_day_start + timedelta(days=1)).astimezone(UTC)

    raw_rows = [
        *_collect_fact_review_rows(db),
        *_collect_content_task_rows(db),
        *_collect_publication_rows(db),
        *_collect_issue_and_overdue_fact_rows(db, now),
        *_collect_geo_opportunity_rows(db),
    ]

    counts: dict[WorkbenchInboxBucket, int] = {
        "assigned_to_me": 0,
        "due_today": 0,
        "overdue": 0,
        "pending_review": 0,
        "awaiting_publication": 0,
        "awaiting_verification": 0,
        "needs_fix": 0,
        "high_priority_geo_opportunities": 0,
    }
    selected_rows: list[tuple[_RawInboxRow, list[WorkbenchInboxBucket], bool]] = []

    for row in raw_rows:
        is_overdue = bool(row.due_at is not None and row.due_at <= now)
        is_due_today = bool(
            row.due_at is not None and day_start_utc <= row.due_at < day_end_utc
        )
        buckets: list[WorkbenchInboxBucket] = []
        if row.assignee_id == actor.id:
            buckets.append("assigned_to_me")
        if is_due_today:
            buckets.append("due_today")
        if is_overdue:
            buckets.append("overdue")
        for base in row.base_buckets:
            if base not in buckets:
                buckets.append(base)
        if not buckets:
            continue
        for member_bucket in buckets:
            counts[member_bucket] += 1
        if bucket in buckets:
            selected_rows.append((row, buckets, is_overdue))

    selected_rows.sort(
        key=lambda entry: (
            not entry[2],
            entry[0].due_at is None,
            entry[0].due_at if entry[0].due_at is not None else _MAX_DT,
            _PRIORITY_ORDER[entry[0].priority],
            -entry[0].updated_at.timestamp(),
            str(entry[0].resource_id),
        )
    )
    top_rows = selected_rows[:_INBOX_ITEM_LIMIT]
    assignee_ids = {
        row.assignee_id for row, _buckets, _overdue in top_rows if row.assignee_id is not None
    }
    users_by_id = (
        {
            user.id: ActorSummary(
                id=user.id,
                username=user.username,
                display_name=user.display_name,
            )
            for user in db.scalars(select(User).where(User.id.in_(assignee_ids)))
        }
        if assignee_ids
        else {}
    )
    bucket_items = [
        WorkbenchInboxItem(
            item_kind=row.item_kind,
            resource_id=row.resource_id,
            title=row.title,
            summary=row.summary,
            priority=row.priority,
            assignee=users_by_id.get(row.assignee_id) if row.assignee_id else None,
            due_at=row.due_at,
            is_overdue=is_overdue,
            blocked_reason=row.blocked_reason,
            buckets=buckets,
            href=row.href,
            updated_at=row.updated_at,
        )
        for row, buckets, is_overdue in top_rows
    ]
    return WorkbenchInbox(
        generated_at=now,
        timezone=timezone_name,
        active_bucket=bucket,
        bucket_counts=WorkbenchInboxCounts(**counts),
        items=bucket_items,
    )
