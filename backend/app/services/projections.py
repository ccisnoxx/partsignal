"""跨发布与审核读取模型复用的确定性投影。"""

from __future__ import annotations

import difflib

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    ContentTask,
    ContentVersion,
    FactVersion,
    PlatformProfileVersion,
    PublicationRecord,
)
from app.schemas import (
    ContentDiff,
    ContentTaskOut,
    ContentVersionOut,
    DiffLine,
    FactVersionOut,
    PlatformProfileVersionOut,
)

IN_FLIGHT_PUBLICATION_STATUSES = (
    "PENDING_MANUAL_PUBLISH",
    "PLATFORM_REVIEW",
    "PUBLISHED",
)


def content_task_out(db: Session, task: ContentTask) -> ContentTaskOut:
    """投影任务及当前唯一可执行的人工动作。"""
    has_in_flight_publication = (
        db.scalar(
            select(PublicationRecord.id)
            .join(ContentVersion, ContentVersion.id == PublicationRecord.content_version_id)
            .where(
                ContentVersion.task_id == task.id,
                PublicationRecord.status.in_(IN_FLIGHT_PUBLICATION_STATUSES),
            )
            .limit(1)
        )
        is not None
    )
    payload = {
        column.name: getattr(task, column.name) for column in task.__table__.columns
    }
    payload["available_actions"] = (
        ["CANCEL"] if task.status == "OPEN" and not has_in_flight_publication else []
    )
    return ContentTaskOut.model_validate(payload)


def content_version_out(content: ContentVersion) -> ContentVersionOut:
    """将不可变内容版本映射为冻结 HTTP 契约。"""
    return ContentVersionOut.model_validate(content)


def fact_version_out(version: FactVersion) -> FactVersionOut:
    """将数据库快照列映射为冻结 HTTP 契约。"""
    return FactVersionOut(
        id=version.id,
        product_id=version.product_id,
        version=version.version,
        status=version.status,
        snapshot=version.snapshot_json,
        change_summary=version.change_summary,
        revision=version.revision,
        created_by=version.created_by,
        approved_by=version.approved_by,
        created_at=version.created_at,
        approved_at=version.approved_at,
    )


def platform_version_out(version: PlatformProfileVersion) -> PlatformProfileVersionOut:
    """将不可变平台规则版本映射为 HTTP 契约。"""
    return PlatformProfileVersionOut(
        id=version.id,
        version=version.version,
        status=version.status,
        rules=version.rules,
        revision=version.revision,
        created_at=version.created_at,
    )


def content_diff(left: ContentVersion, right: ContentVersion) -> ContentDiff:
    """按 Markdown 行生成稳定差异，不解释正文语义。"""
    left_lines = left.body_markdown.splitlines()
    right_lines = right.body_markdown.splitlines()
    matcher = difflib.SequenceMatcher(a=left_lines, b=right_lines, autojunk=False)
    lines: list[DiffLine] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            lines.extend(
                DiffLine(kind="EQUAL", old_line=i + 1, new_line=j + 1, text=left_lines[i])
                for i, j in zip(range(i1, i2), range(j1, j2), strict=True)
            )
            continue
        if tag in {"delete", "replace"}:
            lines.extend(
                DiffLine(kind="DELETE", old_line=i + 1, new_line=None, text=left_lines[i])
                for i in range(i1, i2)
            )
        if tag in {"insert", "replace"}:
            lines.extend(
                DiffLine(kind="ADD", old_line=None, new_line=j + 1, text=right_lines[j])
                for j in range(j1, j2)
            )
    return ContentDiff(left_id=left.id, right_id=right.id, lines=lines)
