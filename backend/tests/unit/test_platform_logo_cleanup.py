"""平台 Logo 引用保留与两阶段清理测试。"""

from __future__ import annotations

import uuid
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from app.services import file_records
from app.services.file_records import (
    _claim_file_cleanup,
    cleanup_file_records,
    file_is_referenced,
)
from app.services.platform_logo_files import (
    schedule_detached_platform_logo,
)
from app.services.storage import EvidenceStorage, StorageUnavailable
from app.worker import celery_app


def file_record(
    *,
    status: str = "VERIFIED",
    cleanup_after: datetime | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        category="PLATFORM_LOGO",
        status=status,
        object_key=f"test/platform_logo/{uuid.uuid4()}.png",
        cleanup_after=cleanup_after,
        upload_expires_at=datetime.now(UTC) - timedelta(hours=1),
        created_at=datetime.now(UTC) - timedelta(days=1),
        deleted_at=None,
    )


def test_detached_logo_gets_seven_day_retention_after_last_reference() -> None:
    """只有全部实际外键都解除后才开始七天保留期。"""
    now = datetime.now(UTC)
    file = file_record()
    db = Mock(spec=Session)
    db.scalar.side_effect = [file, 0, 0, 0]
    schedule_detached_platform_logo(db, file.id, now=now)
    assert file.cleanup_after == now + timedelta(days=7)


def test_cleanup_skips_referenced_verified_logo_and_clears_wrong_deadline() -> None:
    """实时引用优先于 cleanup_after，错误截止时间不能触发对象删除。"""
    now = datetime.now(UTC)
    file = file_record(cleanup_after=now - timedelta(minutes=1))
    db = Mock(spec=Session)
    db.scalars.return_value = [file]
    db.scalar.return_value = 1
    assert _claim_file_cleanup(db, now=now, batch_size=10) == []
    assert file.status == "VERIFIED"
    assert file.cleanup_after is None


def test_cleanup_reference_authority_uses_all_current_file_foreign_keys() -> None:
    """删除权威只查询当前 head 的三类真实文件外键。"""
    db = Mock(spec=Session)
    db.scalar.return_value = 0
    assert not file_is_referenced(db, uuid.uuid4())
    queries = [str(call.args[0]) for call in db.scalar.call_args_list]
    assert len(queries) == 3
    assert "platform_profiles" in queries[0]
    assert "publication_attachments" in queries[1]
    assert "geo_observation_attachments" in queries[2]
    assert all("evidences" not in query for query in queries)


def test_cleanup_marks_unreferenced_due_logo_deleting_before_object_delete() -> None:
    """无引用到期文件先持久化 DELETING，避免并发重新绑定。"""
    now = datetime.now(UTC)
    file = file_record(cleanup_after=now - timedelta(minutes=1))
    db = Mock(spec=Session)
    db.scalars.return_value = [file]
    db.scalar.side_effect = [0, 0, 0]
    assert _claim_file_cleanup(db, now=now, batch_size=10) == [
        (file.id, file.object_key)
    ]
    claim_sql = str(
        db.scalars.call_args.args[0].compile(dialect=postgresql.dialect())
    )
    assert "FOR UPDATE SKIP LOCKED" in claim_sql
    assert file.status == "DELETING"


def test_cleanup_deletes_object_then_keeps_deleted_database_tombstone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DELETING 重试成功后写入 DELETED 墓碑，不物理删除 FileRecord。"""
    now = datetime.now(UTC)
    file = file_record(status="DELETING")
    claim_db = Mock(spec=Session)
    claim_db.scalars.return_value = [file]
    claim_db.scalar.side_effect = [0, 0, 0]
    finish_db = Mock(spec=Session)
    finish_db.scalar.return_value = file
    sessions = iter([claim_db, finish_db])

    class FakeSessionLocal:
        @staticmethod
        def begin():
            return nullcontext(next(sessions))

    monkeypatch.setattr(file_records, "SessionLocal", FakeSessionLocal)
    storage = Mock(spec=EvidenceStorage)
    result = cleanup_file_records(now=now, storage=storage, batch_size=10)
    assert (result.selected, result.deleted, result.retry, result.failed) == (1, 1, 0, 0)
    storage.delete.assert_called_once_with(file.object_key)
    assert file.status == "DELETED"
    assert file.deleted_at is not None


def test_cleanup_storage_failure_keeps_deleting_for_next_scan(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """对象存储暂时失败时保留 DELETING，由下一小时扫描重试。"""
    file = file_record(status="DELETING")
    claim_db = Mock(spec=Session)
    claim_db.scalars.return_value = [file]
    claim_db.scalar.side_effect = [0, 0, 0]

    class FakeSessionLocal:
        @staticmethod
        def begin():
            return nullcontext(claim_db)

    monkeypatch.setattr(file_records, "SessionLocal", FakeSessionLocal)
    storage = Mock(spec=EvidenceStorage)
    storage.delete.side_effect = StorageUnavailable("test")
    result = cleanup_file_records(storage=storage, batch_size=10)
    assert (result.selected, result.deleted, result.retry, result.failed) == (1, 0, 1, 0)
    assert file.status == "DELETING"
    assert file.deleted_at is None


def test_logo_cleanup_is_registered_as_hourly_postgresql_scan() -> None:
    """Beat 只周期触发通用清理命令，不在 Redis 消息中携带文件列表。"""
    schedule = celery_app.conf.beat_schedule["cleanup-platform-logo-files"]
    assert schedule == {
        "task": "partsignal.cleanup_platform_logo_files",
        "schedule": 3600.0,
    }
