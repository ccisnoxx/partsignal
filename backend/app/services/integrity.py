"""上线前只读业务完整性检查。"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


def publication_integrity_issues(db: Session) -> list[dict[str, Any]]:
    """返回稳定排序的发布闭环问题，不修改或猜测任何历史记录。"""
    required_tables = db.execute(
        text(
            "SELECT to_regclass('public.content_tasks'), "
            "to_regclass('public.content_versions'), "
            "to_regclass('public.publication_records'), "
            "to_regclass('public.publication_status_events')"
        )
    ).one()
    if any(table is None for table in required_tables):
        return []
    issues: list[dict[str, Any]] = []
    completed_rows = db.execute(
        text(
            "SELECT content_tasks.id FROM content_tasks "
            "WHERE content_tasks.status = 'COMPLETED' AND NOT EXISTS ("
            "SELECT 1 FROM publication_records "
            "JOIN content_versions ON content_versions.id = publication_records.content_version_id "
            "JOIN publication_status_events ON publication_status_events.publication_id = "
            "publication_records.id "
            "WHERE content_versions.task_id = content_tasks.id "
            "AND publication_status_events.status = 'VERIFIED') "
            "ORDER BY content_tasks.id"
        )
    ).all()
    issues.extend(
        {
            "check": "publication_closure",
            "record_type": "ContentTask",
            "record_id": str(task_id),
            "reason_code": "COMPLETED_WITHOUT_VERIFIED_PUBLICATION",
            "related_ids": [],
        }
        for (task_id,) in completed_rows
    )
    has_direct_platform = db.execute(
        text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = 'content_tasks' "
            "AND column_name = 'platform_profile_id')"
        )
    ).scalar_one()
    # 上线前检查必须同时能在 0013 前的迁移门禁和 0025 后的当前 Schema 上运行。
    platform_query = (
        "SELECT publication_records.id, content_tasks.id, platform_accounts.id, "
        "platform_accounts.platform_profile_id, content_tasks.platform_profile_id "
        "FROM publication_records "
        "JOIN content_versions ON content_versions.id = publication_records.content_version_id "
        "JOIN content_tasks ON content_tasks.id = content_versions.task_id "
        "JOIN platform_accounts ON platform_accounts.id = publication_records.platform_account_id "
        "WHERE platform_accounts.platform_profile_id <> content_tasks.platform_profile_id "
        if has_direct_platform
        else
        "SELECT publication_records.id, content_tasks.id, platform_accounts.id, "
        "platform_accounts.platform_profile_id, platform_profile_versions.platform_profile_id "
        "FROM publication_records "
        "JOIN content_versions ON content_versions.id = publication_records.content_version_id "
        "JOIN content_tasks ON content_tasks.id = content_versions.task_id "
        "JOIN platform_profile_versions ON platform_profile_versions.id = "
        "content_tasks.platform_profile_version_id "
        "JOIN platform_accounts ON platform_accounts.id = publication_records.platform_account_id "
        "WHERE platform_accounts.platform_profile_id <> "
        "platform_profile_versions.platform_profile_id "
    )
    cross_platform_rows = db.execute(
        text(
            platform_query
            + "AND publication_records.status NOT IN "
            "('REJECTED', 'REMOVED', 'VERIFICATION_FAILED') "
            "ORDER BY publication_records.id"
        )
    ).all()
    issues.extend(
        {
            "check": "publication_closure",
            "record_type": "PublicationRecord",
            "record_id": str(publication_id),
            "reason_code": "PUBLICATION_PLATFORM_MISMATCH",
            "related_ids": [
                str(task_id),
                str(account_id),
                str(account_profile_id),
                str(task_profile_id),
            ],
        }
        for (
            publication_id,
            task_id,
            account_id,
            account_profile_id,
            task_profile_id,
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
