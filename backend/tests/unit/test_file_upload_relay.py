"""中转上传的真实 HTTP 边界；数据库替身不作为 PostgreSQL 行锁证据。"""

from __future__ import annotations

import asyncio
import hashlib
import threading
import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.main import app
from app.models.geo_files import FileRecord
from app.models.identity import SessionRecord, User
from app.routers import files as files_router
from app.security import hash_token
from app.services import file_records
from app.services.file_records import MAX_SIZES
from app.services.storage import ObjectMetadata, StorageObjectMissing, StorageUnavailable

CSRF_TOKEN = "relay-test-csrf-token-more-than-32-characters"
SESSION_TOKEN = "relay-test-session-token"
CONTENT = b"relay-file-content"


class MemoryStorage:
    """只为验证 HTTP 状态流程保存测试实际收到的字节。"""

    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str, str]] = {}
        self.put_calls = 0
        self.fail_put = False
        self.fail_head = False

    def put(self, key: str, data: bytes, *, content_type: str, sha256: str) -> None:
        self.put_calls += 1
        if self.fail_put:
            raise StorageUnavailable("test-only upstream details must not appear")
        self.objects[key] = (data, content_type, sha256)

    def head(self, key: str, _expires_at: datetime) -> ObjectMetadata:
        if self.fail_head:
            raise StorageUnavailable("test-only upstream details must not appear")
        if key not in self.objects:
            raise StorageObjectMissing("test-only missing object")
        data, content_type, sha256 = self.objects[key]
        return ObjectMetadata(size=len(data), content_type=content_type, sha256=sha256)


class UploadHarness:
    def __init__(self) -> None:
        self.actor = User(
            id=uuid.uuid4(),
            username="relay-test",
            display_name="中转测试",
            password_hash="not-used",
            account_type="ENGINEER",
            is_active=True,
            must_change_password=False,
        )
        self.file = FileRecord(
            id=uuid.uuid4(),
            category="EVIDENCE",
            original_filename="relay.txt",
            object_key="test/evidence/relay.txt",
            content_type="text/plain",
            size=len(CONTENT),
            sha256=hashlib.sha256(CONTENT).hexdigest(),
            access_level="INTERNAL",
            status="PENDING",
            uploader_id=self.actor.id,
            upload_expires_at=datetime.now(UTC) + timedelta(minutes=10),
            created_at=datetime.now(UTC),
        )
        self.current = SimpleNamespace(
            user=self.actor,
            revoked_at=None,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            csrf_hash=hash_token(CSRF_TOKEN),
            last_seen_at=None,
        )
        self.storage = MemoryStorage()
        self.db = Mock(spec=Session)
        self.db.get.side_effect = lambda _model, file_id: (
            self.file if file_id == self.file.id else None
        )
        self.db.scalar.side_effect = self.scalar
        self.db.add.side_effect = self.add

    def scalar(self, statement: object) -> object:
        entity = statement.column_descriptions[0]["entity"]  # type: ignore[attr-defined]
        if entity is SessionRecord:
            return self.current
        if entity is FileRecord:
            file_id = statement.compile().params.get("id_1")  # type: ignore[attr-defined]
            return self.file if file_id == self.file.id else None
        raise AssertionError("测试数据库收到非文件或会话查询")

    def add(self, file: FileRecord) -> None:
        file.status = "PENDING"
        file.created_at = datetime.now(UTC)
        self.file = file

    @property
    def url(self) -> str:
        return f"/api/v1/files/{self.file.id}/content"

    @property
    def headers(self) -> dict[str, str]:
        return {"X-CSRF-Token": CSRF_TOKEN, "Content-Type": "application/octet-stream"}


@pytest.fixture
def relay(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[UploadHarness, TestClient]]:
    harness = UploadHarness()
    overrides = app.dependency_overrides.copy()

    def database_session() -> Iterator[Session]:
        try:
            yield harness.db
        except Exception:
            harness.db.rollback()
            raise

    app.dependency_overrides[get_db] = database_session
    monkeypatch.setattr(file_records, "get_evidence_storage", lambda: harness.storage)
    try:
        with TestClient(app) as client:
            client.cookies.set(settings.session_cookie_name, SESSION_TOKEN)
            yield harness, client
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(overrides)


@pytest.mark.parametrize("account_type", ["ENGINEER", "ADMIN"])
def test_relay_writes_checked_bytes_then_head_complete_verifies(
    relay: tuple[UploadHarness, TestClient],
    account_type: str,
) -> None:
    harness, client = relay
    harness.actor.account_type = account_type
    transferred = client.put(harness.url, content=CONTENT, headers=harness.headers)
    assert transferred.status_code == 204
    assert transferred.content == b""
    assert transferred.headers["X-Request-ID"]
    assert harness.file.status == "PENDING"
    assert harness.storage.objects[harness.file.object_key] == (
        CONTENT,
        "text/plain",
        hashlib.sha256(CONTENT).hexdigest(),
    )
    complete = client.post(
        f"/api/v1/files/{harness.file.id}/complete",
        headers=harness.headers,
    )
    assert complete.status_code == 200
    assert complete.json()["status"] == "VERIFIED"
    assert harness.file.verified_at is not None
    assert client.put(harness.url, content=CONTENT, headers=harness.headers).status_code == 409


def test_intent_does_not_initialize_storage_or_issue_a_capability(
    relay: tuple[UploadHarness, TestClient],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness, client = relay

    def unavailable() -> None:
        raise AssertionError("上传意图不得依赖对象存储")

    monkeypatch.setattr(file_records, "get_evidence_storage", unavailable)
    created = client.post(
        "/api/v1/files/upload-intents",
        headers={"X-CSRF-Token": CSRF_TOKEN},
        json={
            "category": "EVIDENCE",
            "original_filename": "relay.txt",
            "content_type": "text/plain",
            "size": len(CONTENT),
            "sha256": hashlib.sha256(CONTENT).hexdigest(),
            "access_level": "INTERNAL",
        },
    )
    assert created.status_code == 201
    upload = created.json()["upload"]
    assert upload == {
        "method": "PUT",
        "url": harness.url,
        "headers": {"Content-Type": "application/octet-stream"},
        "fields": {},
        "expires_at": harness.file.upload_expires_at.isoformat().replace("+00:00", "Z"),
    }


@pytest.mark.parametrize(
    "failure, expected",
    [
        ("anonymous", 401),
        ("revoked", 401),
        ("disabled", 401),
        ("role", 403),
        ("csrf", 403),
        ("missing_csrf", 422),
        ("owner", 403),
        ("expired", 409),
        ("missing", 404),
        ("ABORTED", 409),
        ("DELETING", 409),
        ("DELETED", 409),
    ],
)
def test_relay_rejects_identity_and_intent_failures_before_storage(
    relay: tuple[UploadHarness, TestClient],
    failure: str,
    expected: int,
) -> None:
    harness, client = relay
    headers = harness.headers
    url = harness.url
    if failure == "anonymous":
        client.cookies.clear()
    elif failure == "revoked":
        harness.current.revoked_at = datetime.now(UTC)
    elif failure == "disabled":
        harness.actor.is_active = False
    elif failure == "role":
        harness.actor.account_type = "UNSUPPORTED"
    elif failure == "csrf":
        headers["X-CSRF-Token"] = "incorrect-csrf-token-more-than-32-characters"
    elif failure == "missing_csrf":
        headers.pop("X-CSRF-Token")
    elif failure == "owner":
        harness.file.uploader_id = uuid.uuid4()
    elif failure == "expired":
        harness.file.upload_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    elif failure == "missing":
        url = f"/api/v1/files/{uuid.uuid4()}/content"
    else:
        harness.file.status = failure
    response = client.put(url, content=CONTENT, headers=headers)
    assert response.status_code == expected
    assert response.json()["error"]["request_id"] == response.headers["X-Request-ID"]
    assert harness.storage.put_calls == 0


@pytest.mark.parametrize(
    "data, content_type, expected",
    [
        (CONTENT + b"!", "application/octet-stream", 413),
        (CONTENT[:-1], "application/octet-stream", 422),
        (b"X" * len(CONTENT), "application/octet-stream", 422),
        (CONTENT, "text/plain", 422),
        (b"", "application/octet-stream", 422),
    ],
)
def test_relay_checks_actual_size_hash_and_transport_type_before_put(
    relay: tuple[UploadHarness, TestClient],
    data: bytes,
    content_type: str,
    expected: int,
) -> None:
    harness, client = relay
    headers = {**harness.headers, "Content-Type": content_type}
    response = client.put(harness.url, content=data, headers=headers)
    assert response.status_code == expected
    assert harness.file.status == "PENDING"
    assert harness.storage.put_calls == 0


def test_relay_counts_chunks_instead_of_trusting_content_length(
    relay: tuple[UploadHarness, TestClient],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness, client = relay

    async def stream(_request: Request) -> AsyncIterator[bytes]:
        # 接收前已经提交认证事务，最终写入行锁尚未取得。
        assert harness.db.commit.call_count == 1
        assert all(
            "FOR UPDATE" not in str(call.args[0]) for call in harness.db.scalar.call_args_list
        )
        yield CONTENT
        yield b"oversize"

    monkeypatch.setattr(Request, "stream", stream)
    response = client.put(
        harness.url, content=b"x", headers={**harness.headers, "Content-Length": "1"}
    )
    assert response.status_code == 413
    assert harness.storage.put_calls == 0


@pytest.mark.parametrize("change", ["ABORTED", "DELETING", "expired", "owner"])
def test_relay_rechecks_intent_after_receiving_bytes(
    relay: tuple[UploadHarness, TestClient],
    monkeypatch: pytest.MonkeyPatch,
    change: str,
) -> None:
    harness, client = relay

    async def stream(_request: Request) -> AsyncIterator[bytes]:
        yield CONTENT
        if change == "expired":
            harness.file.upload_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        elif change == "owner":
            harness.file.uploader_id = uuid.uuid4()
        else:
            harness.file.status = change
        yield b""

    monkeypatch.setattr(Request, "stream", stream)
    response = client.put(harness.url, content=CONTENT, headers=harness.headers)
    assert response.status_code == (403 if change == "owner" else 409)
    assert harness.storage.put_calls == 0


def test_relay_receive_deadline_returns_408_without_writing(
    relay: tuple[UploadHarness, TestClient],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness, client = relay

    async def slow_stream(_request: Request) -> AsyncIterator[bytes]:
        await asyncio.sleep(0.02)
        yield CONTENT

    monkeypatch.setattr(Request, "stream", slow_stream)
    monkeypatch.setattr(files_router, "UPLOAD_RECEIVE_TIMEOUT_SECONDS", 0.005)
    response = client.put(harness.url, content=CONTENT, headers=harness.headers)
    assert response.status_code == 408
    assert harness.storage.put_calls == 0
    assert harness.file.status == "PENDING"


def test_storage_failure_keeps_pending_and_abort_blocks_later_transfer(
    relay: tuple[UploadHarness, TestClient],
) -> None:
    harness, client = relay
    harness.storage.fail_put = True
    response = client.put(harness.url, content=CONTENT, headers=harness.headers)
    assert response.status_code == 503
    assert "upstream details" not in response.text
    assert harness.file.status == "PENDING"
    assert harness.db.rollback.called
    abort = client.post(f"/api/v1/files/{harness.file.id}/abort", headers=harness.headers)
    assert abort.status_code == 200
    assert abort.json()["status"] == "ABORTED"
    harness.storage.fail_put = False
    assert client.put(harness.url, content=CONTENT, headers=harness.headers).status_code == 409
    assert (
        client.post(
            f"/api/v1/files/{harness.file.id}/complete",
            headers=harness.headers,
        ).status_code
        == 409
    )


def test_head_unavailable_can_retry_while_missing_object_fails_explicitly(
    relay: tuple[UploadHarness, TestClient],
) -> None:
    harness, client = relay
    assert client.put(harness.url, content=CONTENT, headers=harness.headers).status_code == 204
    harness.storage.fail_head = True
    complete_url = f"/api/v1/files/{harness.file.id}/complete"
    assert client.post(complete_url, headers=harness.headers).status_code == 503
    assert harness.file.status == "PENDING"
    harness.storage.fail_head = False
    harness.storage.objects.clear()
    assert client.post(complete_url, headers=harness.headers).status_code == 422
    assert harness.file.status == "FAILED"


def test_upload_complete_abort_share_refreshing_row_lock_and_put_runs_off_loop(
    relay: tuple[UploadHarness, TestClient],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness, client = relay
    thread_observed: list[str] = []
    original_put = harness.storage.put

    def put(key: str, data: bytes, *, content_type: str, sha256: str) -> None:
        with pytest.raises(RuntimeError, match="no running event loop"):
            asyncio.get_running_loop()
        thread_observed.append(threading.current_thread().name)
        assert harness.db.commit.call_count == 1
        original_put(key, data, content_type=content_type, sha256=sha256)

    monkeypatch.setattr(harness.storage, "put", put)
    assert client.put(harness.url, content=CONTENT, headers=harness.headers).status_code == 204
    assert thread_observed
    assert (
        client.post(
            f"/api/v1/files/{harness.file.id}/complete",
            headers=harness.headers,
        ).status_code
        == 200
    )
    harness.file.status = "PENDING"
    assert (
        client.post(
            f"/api/v1/files/{harness.file.id}/abort",
            headers=harness.headers,
        ).status_code
        == 200
    )
    locked = [
        call.args[0]
        for call in harness.db.scalar.call_args_list
        if "FOR UPDATE" in str(call.args[0])
    ]
    assert len(locked) == 3
    assert all(statement.get_execution_options()["populate_existing"] for statement in locked)


@pytest.mark.parametrize("category", list(MAX_SIZES))
def test_intent_preserves_each_category_maximum(
    relay: tuple[UploadHarness, TestClient],
    category: str,
) -> None:
    _, client = relay
    response = client.post(
        "/api/v1/files/upload-intents",
        headers={"X-CSRF-Token": CSRF_TOKEN},
        json={
            "category": category,
            "original_filename": "limit.png",
            "content_type": "image/png",
            "size": MAX_SIZES[category] + 1,
            "sha256": "a" * 64,
            "access_level": "INTERNAL",
        },
    )
    assert response.status_code == 422


def test_evidence_transfer_accepts_the_full_50_mib_limit(
    relay: tuple[UploadHarness, TestClient],
) -> None:
    harness, client = relay
    data = b"x" * MAX_SIZES["EVIDENCE"]
    harness.file.size = len(data)
    harness.file.sha256 = hashlib.sha256(data).hexdigest()
    response = client.put(harness.url, content=data, headers=harness.headers)
    assert response.status_code == 204
    assert len(harness.storage.objects[harness.file.object_key][0]) == 50 * 1024 * 1024
