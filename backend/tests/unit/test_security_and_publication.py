"""认证原语、请求边界与发布安全规则的行为特征测试。"""

import uuid
from typing import cast

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.config import DEVELOPMENT_SESSION_SECRET, Settings
from app.errors import AppError
from app.models.geo_files import FileRecord
from app.schemas.configuration import QueryTopicCreate
from app.security import generate_token, hash_password, hash_token, verify_password
from app.services.file_records import verified_files
from app.services.publication import domain_allowed
from app.services.publication_queries import render_markdown


class FileQuerySession:
    """为文件完整性特征测试保留当前查询返回语义。"""

    def __init__(self, files: list[FileRecord]) -> None:
        self.files = files

    def scalars(self, _statement: object) -> list[FileRecord]:
        return self.files


def test_password_and_token_are_not_stored_as_plaintext() -> None:
    password = "only-for-unit-test"
    password_hash = hash_password(password)
    token = generate_token()
    assert password not in password_hash
    assert verify_password(password_hash, password)
    assert not verify_password(password_hash, "wrong-password")
    assert hash_token(token) != token


def test_contract_unique_items_are_enforced_at_request_boundary() -> None:
    with pytest.raises(ValidationError, match="列表项不得重复"):
        QueryTopicCreate(
            canonical_question="DEMO-001 如何选用？",
            intent_type="PRODUCT",
            variants=["DEMO-001 选型", "DEMO-001 选型"],
        )


def test_markdown_render_strips_executable_html() -> None:
    body_html, body_text = render_markdown("# 标题\n<script>alert(1)</script>\n正文")
    assert "<script" not in body_html
    assert "alert(1)" in body_text
    assert "标题" in body_text


def test_publication_domain_requires_http_and_real_domain_boundary() -> None:
    assert domain_allowed("https://forum.example.com/post/1", ["example.com"])
    assert not domain_allowed("https://example.com.attacker.invalid/post/1", ["example.com"])
    assert not domain_allowed("javascript:alert(1)", ["example.com"])


def test_verified_files_rejects_duplicate_or_unverified_attachments() -> None:
    file_id = uuid.uuid4()
    session = cast(Session, FileQuerySession([]))
    with pytest.raises(AppError, match="附件文件 ID 重复"):
        verified_files(session, [file_id, file_id])

    unverified = FileRecord(id=file_id, status="PENDING")
    session = cast(Session, FileQuerySession([unverified]))
    with pytest.raises(AppError, match="附件必须全部处于 VERIFIED 状态"):
        verified_files(session, [file_id])


def test_production_rejects_development_session_secret() -> None:
    with pytest.raises(ValidationError, match="独立 SESSION_SECRET"):
        Settings(
            _env_file=None,
            APP_ENV="production",
            SESSION_SECRET=DEVELOPMENT_SESSION_SECRET,
            SESSION_COOKIE_SECURE=True,
            OBJECT_STORAGE_BACKEND="aliyun_oss",
            OSS_ENDPOINT="https://oss.example.invalid",
            OSS_BUCKET="test",
            OSS_ACCESS_KEY_ID="test-key",
            OSS_ACCESS_KEY_SECRET="test-secret",
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("GENERATION_PENDING_REDISPATCH_SECONDS", 0),
        ("GENERATION_FINALIZE_GRACE_SECONDS", 0),
        ("GENERATION_RECOVERY_BATCH_SIZE", 0),
        ("GENERATION_RECOVERY_SCAN_SECONDS", 4),
    ],
)
def test_generation_recovery_configuration_requires_positive_bounds(
    field: str,
    value: int,
) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{field: value})
