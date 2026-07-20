"""发布候选、详情、异常上下文与安全正文的只读投影。"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from html.parser import HTMLParser
from typing import Literal

import bleach
import markdown
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.models.configuration import (
    PlatformProfile,
    PlatformProfileVersion,
    QueryTopic,
)
from app.models.content import (
    ContentTask,
    ContentVersion,
)
from app.models.geo_files import FileRecord
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
from app.schemas.configuration import QueryTopicOut
from app.schemas.product_facts import ProductOut
from app.schemas.publication import (
    FactVersionCandidate,
    FileRecordOut,
    PlatformAccountOut,
    PlatformVersionCandidate,
    PublicationAttentionList,
    PublicationAttentionListItem,
    PublicationAttentionOut,
    PublicationCandidate,
    PublicationCandidateList,
    PublicationEvent,
    PublicationExceptionCounts,
    PublicationPeriodMetrics,
    PublicationRecentActivity,
    PublicationRecordList,
    PublicationRecordListItem,
    PublicationRecordOut,
    PublicationRepairContext,
    PublicationRepairDefaults,
    PublicationStatus,
    PublicationStatusCounts,
    PublicationWorkbenchSummary,
    VersionChange,
    VersionDifference,
)
from app.services.projections import (
    content_task_out,
    content_version_out,
    fact_version_out,
    platform_version_out,
)

PUBLICATION_TRANSITIONS = {
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


def publication_actions(status: str) -> list[str]:
    """返回某一发布状态允许执行的服务端命令。"""
    return [
        command
        for (source, command), _target in PUBLICATION_TRANSITIONS.items()
        if source == status
    ]


def attention_actions(status: str, repair_task_id: uuid.UUID | None) -> list[str]:
    """返回关注事项当前允许的显式动作。"""
    if status != "OPEN":
        return []
    return (["CREATE_REPAIR_TASK"] if repair_task_id is None else []) + ["RESOLVE"]


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


def task_for_publication(db: Session, publication: PublicationRecord) -> ContentTask:
    """返回发布记录锁定的原内容任务。"""
    task = db.scalar(
        select(ContentTask)
        .join(ContentVersion, ContentVersion.task_id == ContentTask.id)
        .where(ContentVersion.id == publication.content_version_id)
    )
    if task is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布记录关联的内容任务不存在", 409)
    return task


def publication_out(db: Session, publication: PublicationRecord) -> PublicationRecordOut:
    """投影发布详情及服务端允许动作。"""
    context = db.execute(
        select(ContentTask, ContentVersion, PlatformProfile, PlatformAccount)
        .join(ContentVersion, ContentVersion.task_id == ContentTask.id)
        .join(
            PlatformProfileVersion,
            PlatformProfileVersion.id == ContentTask.platform_profile_version_id,
        )
        .join(PlatformProfile, PlatformProfile.id == PlatformProfileVersion.platform_profile_id)
        .join(PlatformAccount, PlatformAccount.id == publication.platform_account_id)
        .where(ContentVersion.id == publication.content_version_id)
    ).one_or_none()
    if context is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布记录锁定上下文不完整", 409)
    task, content, profile, account = context
    events = list(
        db.scalars(
            select(PublicationStatusEvent)
            .where(PublicationStatusEvent.publication_id == publication.id)
            .order_by(PublicationStatusEvent.created_at, PublicationStatusEvent.id)
        )
    )
    files = list(
        db.scalars(
            select(FileRecord)
            .join(PublicationAttachment, PublicationAttachment.file_id == FileRecord.id)
            .where(PublicationAttachment.publication_id == publication.id)
            .order_by(FileRecord.created_at, FileRecord.id)
        )
    )
    return PublicationRecordOut(
        id=publication.id,
        content_version_id=publication.content_version_id,
        task_id=task.id,
        content_title=content.title,
        content_version=content.version,
        platform_profile_id=profile.id,
        platform_profile_name=profile.name,
        platform_account_id=publication.platform_account_id,
        platform_account_label=account.label,
        account_identifier=account.account_identifier,
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
        available_actions=publication_actions(publication.status),
    )


def list_publication_candidates(db: Session) -> PublicationCandidateList:
    """返回锁定平台及其活跃账号，避免前端重建平台一致性规则。"""
    rows = db.execute(
        select(ContentVersion, ContentTask, PlatformProfileVersion, PlatformProfile)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .join(FactVersion, FactVersion.id == ContentVersion.fact_version_id)
        .join(
            PlatformProfileVersion,
            PlatformProfileVersion.id == ContentTask.platform_profile_version_id,
        )
        .join(PlatformProfile, PlatformProfile.id == PlatformProfileVersion.platform_profile_id)
        .where(
            ContentVersion.status == "APPROVED",
            FactVersion.status == "APPROVED",
            ContentTask.status == "OPEN",
        )
        .order_by(ContentVersion.created_at.desc(), ContentVersion.id)
    ).all()
    accounts_by_profile: defaultdict[uuid.UUID, list[PlatformAccount]] = defaultdict(list)
    profile_ids = {profile.id for _content, _task, _version, profile in rows}
    if profile_ids:
        for account in db.scalars(
            select(PlatformAccount)
            .where(
                PlatformAccount.platform_profile_id.in_(profile_ids),
                PlatformAccount.is_active.is_(True),
            )
            .order_by(PlatformAccount.label, PlatformAccount.id)
        ):
            accounts_by_profile[account.platform_profile_id].append(account)
    return PublicationCandidateList(
        items=[
            PublicationCandidate(
                content_version=content_version_out(content),
                task_id=task.id,
                platform_profile_id=profile.id,
                platform_profile_name=profile.name,
                platform_profile_version_id=platform_version.id,
                platform_profile_version=platform_version.version,
                matching_accounts=[
                    PlatformAccountOut.model_validate(item)
                    for item in accounts_by_profile[profile.id]
                ],
            )
            for content, task, platform_version, profile in rows
        ]
    )


def list_publication_records(
    db: Session,
    *,
    page: int,
    page_size: int,
    status_filter: str | None,
) -> PublicationRecordList:
    """分页返回发布列表投影，不为每一行加载完整详情。"""
    last_verification = (
        select(
            PublicationStatusEvent.publication_id,
            func.max(PublicationStatusEvent.created_at).label("last_verification_at"),
        )
        .where(PublicationStatusEvent.status.in_(("VERIFIED", "VERIFICATION_FAILED")))
        .group_by(PublicationStatusEvent.publication_id)
        .subquery()
    )
    query = (
        select(
            PublicationRecord,
            ContentTask.id.label("task_id"),
            ContentVersion.title.label("content_title"),
            ContentVersion.version.label("content_version"),
            PlatformProfile.id.label("platform_profile_id"),
            PlatformProfile.name.label("platform_profile_name"),
            PlatformAccount.label.label("platform_account_label"),
            PlatformAccount.account_identifier,
            last_verification.c.last_verification_at,
        )
        .join(ContentVersion, ContentVersion.id == PublicationRecord.content_version_id)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .join(
            PlatformProfileVersion,
            PlatformProfileVersion.id == ContentTask.platform_profile_version_id,
        )
        .join(PlatformProfile, PlatformProfile.id == PlatformProfileVersion.platform_profile_id)
        .join(PlatformAccount, PlatformAccount.id == PublicationRecord.platform_account_id)
        .outerjoin(
            last_verification,
            last_verification.c.publication_id == PublicationRecord.id,
        )
    )
    count_query = select(func.count()).select_from(PublicationRecord)
    if status_filter is not None:
        query = query.where(PublicationRecord.status == status_filter)
        count_query = count_query.where(PublicationRecord.status == status_filter)
    total = int(db.scalar(count_query) or 0)
    rows = db.execute(
        query.order_by(PublicationRecord.created_at.desc(), PublicationRecord.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    items: list[PublicationRecordListItem] = []
    for row in rows:
        publication = row[0]
        items.append(
            PublicationRecordListItem(
                id=publication.id,
                task_id=row.task_id,
                content_version_id=publication.content_version_id,
                content_title=row.content_title,
                content_version=row.content_version,
                platform_profile_id=row.platform_profile_id,
                platform_profile_name=row.platform_profile_name,
                platform_account_id=publication.platform_account_id,
                platform_account_label=row.platform_account_label,
                account_identifier=row.account_identifier,
                status=publication.status,
                actual_title=publication.actual_title,
                final_url=publication.final_url,
                published_at=publication.published_at,
                created_at=publication.created_at,
                last_verification_at=row.last_verification_at,
                available_actions=publication_actions(publication.status),
            )
        )
    return PublicationRecordList(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
    )


def attention_out(db: Session, attention: PublicationAttention) -> PublicationAttentionOut:
    """投影异常待办及关联修复任务。"""
    publication = db.get(PublicationRecord, attention.publication_record_id)
    if publication is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "异常待办关联的发布记录不存在", 409)
    original_task = task_for_publication(db, publication)
    repair_task_id = db.scalar(
        select(ContentTask.id).where(ContentTask.source_publication_attention_id == attention.id)
    )
    return PublicationAttentionOut(
        id=attention.id,
        publication_record_id=attention.publication_record_id,
        original_task_id=original_task.id,
        trigger_status=attention.trigger_status,
        status=attention.status,
        revision=attention.revision,
        opened_at=attention.opened_at,
        resolved_at=attention.resolved_at,
        resolved_by=attention.resolved_by,
        resolution_comment=attention.resolution_comment,
        repair_task_id=repair_task_id,
        available_actions=attention_actions(attention.status, repair_task_id),
    )


def list_attentions(db: Session, status_filter: str | None) -> PublicationAttentionList:
    """按状态批量返回带发布上下文的异常待办。"""
    repair_task = (
        select(
            ContentTask.source_publication_attention_id.label("attention_id"),
            ContentTask.id.label("repair_task_id"),
        )
        .where(ContentTask.source_publication_attention_id.is_not(None))
        .subquery()
    )
    query = (
        select(
            PublicationAttention,
            PublicationRecord,
            ContentTask.id.label("original_task_id"),
            ContentVersion.title.label("content_title"),
            ContentVersion.version.label("content_version"),
            PlatformProfile.id.label("platform_profile_id"),
            PlatformProfile.name.label("platform_profile_name"),
            PlatformAccount.label.label("platform_account_label"),
            repair_task.c.repair_task_id,
        )
        .join(
            PublicationRecord,
            PublicationRecord.id == PublicationAttention.publication_record_id,
        )
        .join(ContentVersion, ContentVersion.id == PublicationRecord.content_version_id)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .join(
            PlatformProfileVersion,
            PlatformProfileVersion.id == ContentTask.platform_profile_version_id,
        )
        .join(PlatformProfile, PlatformProfile.id == PlatformProfileVersion.platform_profile_id)
        .join(PlatformAccount, PlatformAccount.id == PublicationRecord.platform_account_id)
        .outerjoin(repair_task, repair_task.c.attention_id == PublicationAttention.id)
    )
    if status_filter is not None:
        query = query.where(PublicationAttention.status == status_filter)
    rows = db.execute(
        query.order_by(PublicationAttention.opened_at.desc(), PublicationAttention.id)
    ).all()
    items: list[PublicationAttentionListItem] = []
    for row in rows:
        attention, publication = row[0], row[1]
        items.append(
            PublicationAttentionListItem(
                id=attention.id,
                publication_record_id=attention.publication_record_id,
                original_task_id=row.original_task_id,
                content_title=row.content_title,
                content_version=row.content_version,
                platform_profile_id=row.platform_profile_id,
                platform_profile_name=row.platform_profile_name,
                platform_account_label=row.platform_account_label,
                final_url=publication.final_url,
                trigger_status=attention.trigger_status,
                status=attention.status,
                revision=attention.revision,
                opened_at=attention.opened_at,
                resolved_at=attention.resolved_at,
                resolved_by=attention.resolved_by,
                resolution_comment=attention.resolution_comment,
                repair_task_id=row.repair_task_id,
                available_actions=attention_actions(attention.status, row.repair_task_id),
            )
        )
    return PublicationAttentionList(items=items)


def publication_workbench_summary(
    db: Session, window_days: Literal[7, 30]
) -> PublicationWorkbenchSummary:
    """以发布事件和关注事项聚合工作台当前快照与周期指标。"""
    as_of = datetime.now(UTC)
    window_start = as_of - timedelta(days=window_days)
    published_cohort = (
        select(PublicationStatusEvent.publication_id.label("publication_id"))
        .where(
            PublicationStatusEvent.status == "PUBLISHED",
            PublicationStatusEvent.created_at >= window_start,
            PublicationStatusEvent.created_at < as_of,
        )
        .distinct()
        .subquery()
    )
    aggregate = db.execute(
        select(
            *[
                select(func.count())
                .select_from(PublicationRecord)
                .where(PublicationRecord.status == status.value)
                .scalar_subquery()
                .label(status.value)
                for status in PublicationStatus
            ],
            select(func.count())
            .select_from(PublicationAttention)
            .where(
                PublicationAttention.status == "OPEN",
                PublicationAttention.trigger_status == "REMOVED",
            )
            .scalar_subquery()
            .label("removed_open"),
            select(func.count())
            .select_from(PublicationAttention)
            .where(
                PublicationAttention.status == "OPEN",
                PublicationAttention.trigger_status == "VERIFICATION_FAILED",
            )
            .scalar_subquery()
            .label("verification_failed_open"),
            select(func.count())
            .select_from(published_cohort)
            .scalar_subquery()
            .label("registered_count"),
            select(func.count())
            .select_from(published_cohort)
            .where(
                select(PublicationStatusEvent.id)
                .where(
                    PublicationStatusEvent.publication_id == published_cohort.c.publication_id,
                    PublicationStatusEvent.status == "VERIFIED",
                    PublicationStatusEvent.created_at < as_of,
                )
                .exists()
            )
            .scalar_subquery()
            .label("verified_count"),
            select(func.count(func.distinct(PublicationStatusEvent.publication_id)))
            .where(
                PublicationStatusEvent.status.in_(("REJECTED", "REMOVED", "VERIFICATION_FAILED")),
                PublicationStatusEvent.created_at >= window_start,
                PublicationStatusEvent.created_at < as_of,
            )
            .scalar_subquery()
            .label("new_exception_count"),
        )
    ).one()
    status_counts = {
        status.value: int(getattr(aggregate, status.value) or 0) for status in PublicationStatus
    }
    attention_counts = {
        "REMOVED": int(aggregate.removed_open or 0),
        "VERIFICATION_FAILED": int(aggregate.verification_failed_open or 0),
    }
    open_attention_count = sum(attention_counts.values())
    registered_count = int(aggregate.registered_count or 0)
    verified_count = int(aggregate.verified_count or 0)
    recent_rows = db.execute(
        select(
            PublicationStatusEvent.publication_id,
            ContentVersion.title.label("content_title"),
            ContentVersion.version.label("content_version"),
            PlatformProfile.name.label("platform_profile_name"),
            PublicationStatusEvent.status,
            PublicationStatusEvent.created_at.label("occurred_at"),
        )
        .join(
            PublicationRecord,
            PublicationRecord.id == PublicationStatusEvent.publication_id,
        )
        .join(ContentVersion, ContentVersion.id == PublicationRecord.content_version_id)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .join(
            PlatformProfileVersion,
            PlatformProfileVersion.id == ContentTask.platform_profile_version_id,
        )
        .join(PlatformProfile, PlatformProfile.id == PlatformProfileVersion.platform_profile_id)
        .where(PublicationStatusEvent.created_at < as_of)
        .order_by(PublicationStatusEvent.created_at.desc(), PublicationStatusEvent.id.desc())
        .limit(5)
    ).all()
    return PublicationWorkbenchSummary(
        as_of=as_of,
        window_start=window_start,
        window_days=window_days,
        current_status_counts=PublicationStatusCounts(**status_counts),
        open_attention_count=open_attention_count,
        period=PublicationPeriodMetrics(
            registered_published_count=registered_count,
            verified_count=verified_count,
            verification_rate=(verified_count / registered_count if registered_count else None),
            new_exception_count=int(aggregate.new_exception_count or 0),
            current_unresolved_attention_count=open_attention_count,
        ),
        exception_counts=PublicationExceptionCounts(
            rejected=status_counts["REJECTED"],
            removed_open=attention_counts.get("REMOVED", 0),
            verification_failed_open=attention_counts.get("VERIFICATION_FAILED", 0),
        ),
        recent_activity=[
            PublicationRecentActivity(
                publication_id=row.publication_id,
                content_title=row.content_title,
                content_version=row.content_version,
                platform_profile_name=row.platform_profile_name,
                status=row.status,
                occurred_at=row.occurred_at,
            )
            for row in recent_rows
        ],
    )


def get_attention(db: Session, attention_id: uuid.UUID) -> PublicationAttentionOut:
    """返回单个发布异常待办。"""
    attention = db.get(PublicationAttention, attention_id)
    if attention is None:
        raise not_found("发布异常待办")
    return attention_out(db, attention)


def _difference(
    from_id: uuid.UUID,
    to_id: uuid.UUID,
    before: dict[str, object],
    after: dict[str, object],
) -> VersionDifference:
    changes = [
        VersionChange(field=field, before=before.get(field), after=after.get(field))
        for field in sorted(set(before) | set(after))
        if before.get(field) != after.get(field)
    ]
    return VersionDifference(from_id=from_id, to_id=to_id, changes=changes)


def get_repair_context(db: Session, attention_id: uuid.UUID) -> PublicationRepairContext:
    """返回固定业务上下文、当前候选和确定性版本差异。"""
    attention = db.get(PublicationAttention, attention_id)
    if attention is None:
        raise not_found("发布异常待办")
    publication = db.get(PublicationRecord, attention.publication_record_id)
    if publication is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "异常待办关联的发布记录不存在", 409)
    task = task_for_publication(db, publication)
    product = db.get(Product, task.product_id)
    topic = db.get(QueryTopic, task.query_topic_id) if task.query_topic_id is not None else None
    original_fact = db.get(FactVersion, task.fact_version_id)
    original_platform = db.get(PlatformProfileVersion, task.platform_profile_version_id)
    profile = (
        db.get(PlatformProfile, original_platform.platform_profile_id)
        if original_platform is not None
        else None
    )
    if any(item is None for item in (product, original_fact, original_platform, profile)) or (
        task.query_topic_id is not None and topic is None
    ):
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布修复上下文不完整", 409)
    assert product is not None
    assert original_fact is not None
    assert original_platform is not None
    assert profile is not None
    original_fact_out = fact_version_out(original_fact)
    original_platform_out = platform_version_out(original_platform)
    fact_candidates = list(
        db.scalars(
            select(FactVersion)
            .where(FactVersion.product_id == task.product_id, FactVersion.status == "APPROVED")
            .order_by(FactVersion.version.desc(), FactVersion.id)
        )
    )
    platform_candidates = list(
        db.scalars(
            select(PlatformProfileVersion)
            .where(
                PlatformProfileVersion.platform_profile_id == profile.id,
                PlatformProfileVersion.status == "ACTIVE",
            )
            .order_by(PlatformProfileVersion.version.desc(), PlatformProfileVersion.id)
        )
    )
    before_fact = original_fact_out.snapshot.model_dump(mode="json")
    before_platform = original_platform_out.rules.model_dump(mode="json")
    return PublicationRepairContext(
        attention=attention_out(db, attention),
        publication=publication_out(db, publication),
        original_task=content_task_out(db, task),
        product=ProductOut.model_validate(product),
        query_topic=QueryTopicOut.model_validate(topic) if topic is not None else None,
        platform_profile_id=profile.id,
        platform_profile_name=profile.name,
        original_fact_version=original_fact_out,
        fact_candidates=[
            FactVersionCandidate(
                version=fact_version_out(candidate),
                difference=_difference(
                    original_fact.id,
                    candidate.id,
                    before_fact,
                    fact_version_out(candidate).snapshot.model_dump(mode="json"),
                ),
            )
            for candidate in fact_candidates
        ],
        original_platform_version=original_platform_out,
        platform_candidates=[
            PlatformVersionCandidate(
                version=platform_version_out(candidate),
                difference=_difference(
                    original_platform.id,
                    candidate.id,
                    before_platform,
                    platform_version_out(candidate).rules.model_dump(mode="json"),
                ),
            )
            for candidate in platform_candidates
        ],
        defaults=PublicationRepairDefaults(
            target_audience=task.target_audience,
            content_angle=task.content_angle,
            conversion_goal=task.conversion_goal,
            desired_format=task.desired_format,
            desired_length_min=task.desired_length_min,
            desired_length_max=task.desired_length_max,
            canonical_url=task.canonical_url,
        ),
    )


def open_attention_count(db: Session) -> int:
    """返回 OPEN 发布异常数量，供工作台消费同一业务状态。"""
    return int(
        db.scalar(
            select(func.count())
            .select_from(PublicationAttention)
            .where(PublicationAttention.status == "OPEN")
        )
        or 0
    )
