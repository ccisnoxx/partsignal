"""发布候选、详情、异常上下文与安全正文的只读投影。"""

from __future__ import annotations

import uuid
from html.parser import HTMLParser

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
    PublicationAttentionOut,
    PublicationCandidate,
    PublicationCandidateList,
    PublicationEvent,
    PublicationRecordOut,
    PublicationRepairContext,
    PublicationRepairDefaults,
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
    task = task_for_publication(db, publication)
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
        available_actions=[
            command
            for (source, command), _target in PUBLICATION_TRANSITIONS.items()
            if source == publication.status
        ],
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
    candidates: list[PublicationCandidate] = []
    for content, task, platform_version, profile in rows:
        accounts = list(
            db.scalars(
                select(PlatformAccount)
                .where(
                    PlatformAccount.platform_profile_id == profile.id,
                    PlatformAccount.is_active.is_(True),
                )
                .order_by(PlatformAccount.label, PlatformAccount.id)
            )
        )
        candidates.append(
            PublicationCandidate(
                content_version=content_version_out(content),
                task_id=task.id,
                platform_profile_id=profile.id,
                platform_profile_name=profile.name,
                platform_profile_version_id=platform_version.id,
                platform_profile_version=platform_version.version,
                matching_accounts=[PlatformAccountOut.model_validate(item) for item in accounts],
            )
        )
    return PublicationCandidateList(items=candidates)


def attention_out(db: Session, attention: PublicationAttention) -> PublicationAttentionOut:
    """投影异常待办及关联修复任务。"""
    publication = db.get(PublicationRecord, attention.publication_record_id)
    if publication is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "异常待办关联的发布记录不存在", 409)
    original_task = task_for_publication(db, publication)
    repair_task_id = db.scalar(
        select(ContentTask.id).where(ContentTask.source_publication_attention_id == attention.id)
    )
    actions: list[str] = []
    if attention.status == "OPEN":
        if repair_task_id is None:
            actions.append("CREATE_REPAIR_TASK")
        actions.append("RESOLVE")
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
        available_actions=actions,
    )


def list_attentions(db: Session, status_filter: str | None) -> PublicationAttentionList:
    """按状态返回发布异常待办。"""
    query = select(PublicationAttention)
    if status_filter is not None:
        query = query.where(PublicationAttention.status == status_filter)
    attentions = list(
        db.scalars(query.order_by(PublicationAttention.opened_at.desc(), PublicationAttention.id))
    )
    return PublicationAttentionList(items=[attention_out(db, item) for item in attentions])


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
    topic = db.get(QueryTopic, task.query_topic_id)
    original_fact = db.get(FactVersion, task.fact_version_id)
    original_platform = db.get(PlatformProfileVersion, task.platform_profile_version_id)
    profile = (
        db.get(PlatformProfile, original_platform.platform_profile_id)
        if original_platform is not None
        else None
    )
    if any(item is None for item in (product, topic, original_fact, original_platform, profile)):
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布修复上下文不完整", 409)
    assert product is not None
    assert topic is not None
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
        query_topic=QueryTopicOut.model_validate(topic),
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
