"""集中计算人工未审核草稿的直接删除阻断。"""

from __future__ import annotations

import uuid
from collections import defaultdict

from sqlalchemy import func, select, union_all
from sqlalchemy.orm import Session

from app.models.ai_generation import GenerationJob
from app.models.content import ContentReviewRecord, ContentVersion
from app.models.publication import PublicationVerification, PublicationWork, PublicationWorkEvent

ContentVersionReference = tuple[str, str, int]


def content_version_delete_references(
    db: Session, version_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[ContentVersionReference]]:
    """按固定查询次数返回每个内容版本的全部直接引用。"""
    references: defaultdict[uuid.UUID, list[ContentVersionReference]] = defaultdict(list)
    if not version_ids:
        return {}

    event_references = union_all(
        select(
            PublicationWorkEvent.from_content_version_id.label("version_id"),
            PublicationWorkEvent.id.label("event_id"),
        ),
        select(
            PublicationWorkEvent.to_content_version_id.label("version_id"),
            PublicationWorkEvent.id.label("event_id"),
        ),
    ).subquery()
    queries = (
        (
            "CONTENT_REVIEW_RECORD",
            "审核记录",
            select(ContentReviewRecord.content_version_id, func.count(ContentReviewRecord.id))
            .where(ContentReviewRecord.content_version_id.in_(version_ids))
            .group_by(ContentReviewRecord.content_version_id),
        ),
        (
            "CONTENT_VERSION_CHILD",
            "后续内容版本",
            select(ContentVersion.based_on_id, func.count(ContentVersion.id))
            .where(ContentVersion.based_on_id.in_(version_ids))
            .group_by(ContentVersion.based_on_id),
        ),
        (
            "GENERATION_JOB_SOURCE",
            "AI 生成来源",
            select(GenerationJob.source_content_version_id, func.count(GenerationJob.id))
            .where(GenerationJob.source_content_version_id.in_(version_ids))
            .group_by(GenerationJob.source_content_version_id),
        ),
        (
            "GENERATION_JOB_RESULT",
            "AI 生成结果",
            select(GenerationJob.content_version_id, func.count(GenerationJob.id))
            .where(GenerationJob.content_version_id.in_(version_ids))
            .group_by(GenerationJob.content_version_id),
        ),
        (
            "PUBLICATION_WORK",
            "发布工作",
            select(PublicationWork.content_version_id, func.count(PublicationWork.id))
            .where(PublicationWork.content_version_id.in_(version_ids))
            .group_by(PublicationWork.content_version_id),
        ),
        (
            "PUBLICATION_EVENT",
            "发布事件",
            select(
                event_references.c.version_id,
                func.count(func.distinct(event_references.c.event_id)),
            )
            .where(event_references.c.version_id.in_(version_ids))
            .group_by(event_references.c.version_id),
        ),
        (
            "PUBLICATION_VERIFICATION",
            "发布核验记录",
            select(
                PublicationVerification.content_version_id,
                func.count(PublicationVerification.id),
            )
            .where(PublicationVerification.content_version_id.in_(version_ids))
            .group_by(PublicationVerification.content_version_id),
        ),
    )
    for type_name, label, statement in queries:
        for version_id, count in db.execute(statement):
            if version_id is not None and count:
                references[version_id].append((type_name, label, int(count)))
    return {version_id: references[version_id] for version_id in version_ids}


def content_version_is_deletable(
    content: ContentVersion, references: list[ContentVersionReference]
) -> bool:
    """只允许无直接引用的人工未审核草稿进入删除命令。"""
    return (
        content.source_type == "HUMAN"
        and content.source_job_id is None
        and content.status in {"DRAFT", "ABANDONED"}
        and not references
    )
