"""认证原语、请求边界与发布安全规则的行为特征测试。"""

import base64
import subprocess
import sys
import uuid
from pathlib import Path
from typing import cast
from unittest.mock import MagicMock

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
from app.services.publication_queries import (
    _work_list_item,
    publication_work_actions,
    published_article_actions,
    published_content_issue_actions,
    render_markdown,
)


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


def test_query_topic_text_is_trimmed_before_unique_validation() -> None:
    payload = QueryTopicCreate(
        canonical_question="  DEMO-001 如何选用？  ",
        intent_type="PRODUCT",
        variants=["  DEMO-001 选型  ", "DEMO-001 参数"],
    )
    assert payload.canonical_question == "DEMO-001 如何选用？"
    assert payload.variants == ["DEMO-001 选型", "DEMO-001 参数"]
    with pytest.raises(ValidationError, match="列表项不得重复"):
        QueryTopicCreate(
            canonical_question="DEMO-001 如何选用？",
            intent_type="PRODUCT",
            variants=["DEMO-001 选型", "  DEMO-001 选型  "],
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


def test_publication_actions_have_one_server_projected_primary_task() -> None:
    assert publication_work_actions("ACTION_REQUIRED", "VERIFICATION_FAILED") == (
        ["VERIFY", "REGISTER_RESULT", "SWITCH_CONTENT_VERSION", "CLOSE"],
        "FIX_AND_REVERIFY",
    )
    assert publication_work_actions("ACTION_REQUIRED", "CONTENT_VERSION_CHANGED") == (
        ["REGISTER_RESULT", "SWITCH_CONTENT_VERSION", "CLOSE"],
        "REGISTER_RESULT",
    )
    assert publication_work_actions("COMPLETED", "COMPLETED") == ([], "VIEW_COMPLETION")
    assert published_article_actions(has_open_issue=False, retired=False) == (
        ["OPEN_ISSUE"],
        "HEALTHY",
        "START_PRODUCT_OBSERVATION",
    )
    assert published_article_actions(has_open_issue=True, retired=False) == (
        [],
        "OPEN_ISSUE",
        "HANDLE_CONTENT_ISSUE",
    )
    repair_task_id = uuid.uuid4()
    assert published_content_issue_actions(
        status="OPEN", repair_task_id=None, repair_task_status=None
    ) == (
        ["CREATE_REPAIR_TASK", "RESOLVE"],
        "OPEN",
        "HANDLE_CONTENT_ISSUE",
    )
    assert published_content_issue_actions(
        status="OPEN", repair_task_id=repair_task_id, repair_task_status="OPEN"
    ) == (["RESOLVE"], "REPAIRING", "CONTINUE_REPAIR")
    for terminal_status in ("COMPLETED", "CANCELLED"):
        assert published_content_issue_actions(
            status="OPEN",
            repair_task_id=repair_task_id,
            repair_task_status=terminal_status,
        ) == (["RESOLVE"], "AWAITING_RESOLUTION", "CONFIRM_RESOLUTION")
    assert published_content_issue_actions(
        status="RESOLVED",
        repair_task_id=repair_task_id,
        repair_task_status="CANCELLED",
    ) == ([], "RESOLVED", "VIEW_RESOLUTION")
    with pytest.raises(AppError, match="内容问题状态无效"):
        published_content_issue_actions(
            status="UNKNOWN",
            repair_task_id=None,
            repair_task_status=None,
        )


@pytest.mark.parametrize(
    "missing_field",
    ("platform_profile_name", "platform_account_label", "account_identifier"),
)
def test_publication_work_projection_rejects_missing_live_identity(missing_field: str) -> None:
    """非终态身份投影缺少任一实时字段时必须返回结构化 409。"""
    row = MagicMock()
    row.__getitem__.return_value = MagicMock(status="PREPARING")
    row.platform_profile_name = "当前平台"
    row.platform_account_label = "当前账号"
    row.account_identifier = "current-account"
    setattr(row, missing_field, None)

    with pytest.raises(AppError) as error:
        _work_list_item(row, None, MagicMock(action="CREATED"))

    assert error.value.code == "PUBLICATION_CONTEXT_INCOMPLETE"
    assert error.value.status_code == 409


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


def test_settings_repr_hides_sensitive_values() -> None:
    marker = f"a28-{uuid.uuid4().hex}"
    sensitive_values = {
        "DATABASE_URL": f"postgresql://{marker}@localhost/test",
        "REDIS_URL": f"redis://{marker}@localhost/1",
        "SESSION_SECRET": marker,
        "UPLOAD_SIGNING_SECRET": f"{marker}-storage",
        "OSS_ACCESS_KEY_ID": f"{marker}-id",
        "OSS_ACCESS_KEY_SECRET": f"{marker}-secret",
        "AI_CREDENTIAL_ENCRYPTION_KEY": base64.b64encode(
            marker.encode()[:32]
        ).decode(),
    }

    rendered = repr(Settings(_env_file=None, APP_ENV="test", **sensitive_values))

    assert "environment=" in rendered
    assert all(value not in rendered for value in sensitive_values.values())


def test_settings_validation_error_hides_sensitive_input() -> None:
    marker = f"a28-{uuid.uuid4().hex}"
    with pytest.raises(ValidationError) as captured:
        Settings(
            _env_file=None,
            APP_ENV="production",
            DATABASE_URL=f"postgresql://{marker}@localhost/test",
            REDIS_URL=f"redis://{marker}@localhost/1",
            SESSION_SECRET=marker,
            AI_ALLOW_LOCAL_HTTP=True,
        )

    rendered = str(captured.value)
    assert "AI_ALLOW_LOCAL_HTTP 仅允许" in rendered
    assert marker not in rendered
    assert "postgresql://" not in rendered
    assert "redis://" not in rendered
    assert "input_value=" not in rendered


def test_settings_failure_output_hides_sensitive_input() -> None:
    marker = f"a28-{uuid.uuid4().hex}"
    child_code = """
import os
from app.config import Settings

marker = os.environ["A28_PROBE"]
Settings(
    _env_file=None,
    APP_ENV="production",
    DATABASE_URL=f"postgresql://{marker}@localhost/test",
    REDIS_URL=f"redis://{marker}@localhost/1",
    SESSION_SECRET=marker,
    AI_ALLOW_LOCAL_HTTP=True,
)
"""

    completed = subprocess.run(
        [sys.executable, "-c", child_code],
        check=False,
        capture_output=True,
        text=True,
        env={"A28_PROBE": marker},
        cwd=Path(__file__).resolve().parents[2],
    )
    output = completed.stdout + completed.stderr

    assert completed.returncode != 0
    assert "AI_ALLOW_LOCAL_HTTP 仅允许" in output
    assert marker not in output
    assert "input_value=" not in output


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
