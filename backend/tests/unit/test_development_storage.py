"""独立开发对象存储的签名和完整性测试。"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.dev_storage import app
from app.services.storage import (
    AliyunOssEvidenceStorage,
    DevelopmentEvidenceStorage,
    StorageUnavailable,
    get_evidence_storage,
    signed_storage_url,
)


def request_target(url: str) -> str:
    parsed = urlsplit(url)
    return f"{parsed.path}?{parsed.query}"


def test_upload_and_head_validate_real_object_bytes(tmp_path: Path) -> None:
    original_path = settings.development_storage_path
    original_url = settings.development_storage_public_url
    settings.development_storage_path = str(tmp_path)
    settings.development_storage_public_url = "http://testserver"
    try:
        client = TestClient(app)
        content = b"partsignal-development-object"
        digest = hashlib.sha256(content).hexdigest()
        expires_at = datetime.now(UTC) + timedelta(minutes=5)
        upload_url = signed_storage_url("upload", "development/evidence/test.bin", expires_at)
        response = client.put(
            request_target(upload_url),
            content=content,
            headers={"content-type": "application/octet-stream", "x-meta-sha256": digest},
        )
        assert response.status_code == 204
        head_url = signed_storage_url("head", "development/evidence/test.bin", expires_at)
        head = client.head(request_target(head_url))
        assert head.status_code == 200
        assert head.headers["x-object-size"] == str(len(content))
        assert head.headers["x-meta-sha256"] == digest
    finally:
        settings.development_storage_path = original_path
        settings.development_storage_public_url = original_url


def test_upload_rejects_hash_mismatch(tmp_path: Path) -> None:
    original_path = settings.development_storage_path
    original_url = settings.development_storage_public_url
    settings.development_storage_path = str(tmp_path)
    settings.development_storage_public_url = "http://testserver"
    try:
        expires_at = datetime.now(UTC) + timedelta(minutes=5)
        upload_url = signed_storage_url("upload", "development/evidence/bad.bin", expires_at)
        response = TestClient(app).put(
            request_target(upload_url),
            content=b"actual",
            headers={"content-type": "application/octet-stream", "x-meta-sha256": "0" * 64},
        )
        assert response.status_code == 422
    finally:
        settings.development_storage_path = original_path
        settings.development_storage_public_url = original_url


def test_storage_backend_never_falls_back_from_unknown_value() -> None:
    original_backend = settings.object_storage_backend
    settings.object_storage_backend = "unknown"
    try:
        with pytest.raises(RuntimeError, match="未知 OBJECT_STORAGE_BACKEND"):
            get_evidence_storage()
    finally:
        settings.object_storage_backend = original_backend


def test_aliyun_storage_requires_explicit_credentials() -> None:
    original = (
        settings.oss_endpoint,
        settings.oss_bucket,
        settings.oss_access_key_id,
        settings.oss_access_key_secret,
    )
    settings.oss_endpoint = ""
    settings.oss_bucket = ""
    settings.oss_access_key_id = ""
    settings.oss_access_key_secret = ""
    try:
        with pytest.raises(RuntimeError, match="阿里云 OSS 配置不完整"):
            AliyunOssEvidenceStorage()
    finally:
        (
            settings.oss_endpoint,
            settings.oss_bucket,
            settings.oss_access_key_id,
            settings.oss_access_key_secret,
        ) = original


def test_development_storage_preserves_retry_on_transport_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_head(*args: object, **kwargs: object) -> None:
        raise httpx.ConnectError("test transport failure")

    monkeypatch.setattr(httpx, "head", fail_head)
    with pytest.raises(StorageUnavailable):
        DevelopmentEvidenceStorage().head(
            "development/evidence/missing.bin", datetime.now(UTC) + timedelta(minutes=1)
        )
