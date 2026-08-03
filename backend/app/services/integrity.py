"""上线前只读业务完整性检查。"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


def publication_integrity_issues(db: Session) -> list[dict[str, Any]]:
    """返回发布完成闭环和平台归属问题，不修改历史记录。"""
    required_tables = db.execute(
        text(
            "SELECT to_regclass('public.content_tasks'), "
            "to_regclass('public.content_versions'), "
            "to_regclass('public.publication_works'), "
            "to_regclass('public.published_articles')"
        )
    ).one()
    if any(table is None for table in required_tables):
        return []
    issues: list[dict[str, Any]] = []
    completed_rows = db.execute(
        text(
            "SELECT content_tasks.id FROM content_tasks "
            "WHERE content_tasks.status = 'COMPLETED' AND NOT EXISTS ("
            "SELECT 1 FROM published_articles "
            "JOIN publication_works ON publication_works.id = published_articles.id "
            "JOIN content_versions ON content_versions.id = publication_works.content_version_id "
            "WHERE content_versions.task_id = content_tasks.id) "
            "ORDER BY content_tasks.id"
        )
    ).all()
    issues.extend(
        {
            "check": "publication_closure",
            "record_type": "ContentTask",
            "record_id": str(task_id),
            "reason_code": "COMPLETED_WITHOUT_PUBLISHED_ARTICLE",
            "related_ids": [],
        }
        for (task_id,) in completed_rows
    )
    cross_platform_rows = db.execute(
        text(
            "SELECT publication_works.id, content_tasks.id, platform_accounts.id, "
            "publication_works.platform_profile_id, content_tasks.platform_profile_id, "
            "platform_accounts.platform_profile_id "
            "FROM publication_works "
            "JOIN content_versions ON content_versions.id = publication_works.content_version_id "
            "JOIN content_tasks ON content_tasks.id = content_versions.task_id "
            "JOIN platform_accounts ON platform_accounts.id = "
            "publication_works.platform_account_id "
            "WHERE publication_works.platform_profile_id <> content_tasks.platform_profile_id "
            "OR publication_works.platform_profile_id <> platform_accounts.platform_profile_id "
            "ORDER BY publication_works.id"
        )
    ).all()
    issues.extend(
        {
            "check": "publication_closure",
            "record_type": "PublicationWork",
            "record_id": str(work_id),
            "reason_code": "PUBLICATION_PLATFORM_MISMATCH",
            "related_ids": [
                str(task_id),
                str(account_id),
                str(work_profile_id),
                str(task_profile_id),
                str(account_profile_id),
            ],
        }
        for (
            work_id,
            task_id,
            account_id,
            work_profile_id,
            task_profile_id,
            account_profile_id,
        ) in cross_platform_rows
    )
    return sorted(
        issues,
        key=lambda item: (
            item["check"],
            item["record_type"],
            item["record_id"],
            item["reason_code"],
        ),
    )
