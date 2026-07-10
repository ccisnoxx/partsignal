"""认证原语、参数边界和发布派生测试。"""

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.routers.publication import domain_allowed, render_markdown
from app.schemas import PartParameterData, QueryTopicCreate
from app.security import generate_token, hash_password, hash_token, verify_password


def test_password_and_token_are_not_stored_as_plaintext() -> None:
    password = "only-for-unit-test"
    password_hash = hash_password(password)
    token = generate_token()
    assert password not in password_hash
    assert verify_password(password_hash, password)
    assert not verify_password(password_hash, "wrong-password")
    assert hash_token(token) != token


def test_parameter_shape_rejects_guessed_numeric_value() -> None:
    with pytest.raises(ValidationError):
        PartParameterData(
            client_key="voltage",
            owner_key="product",
            key="voltage",
            name="工作电压",
            value_type="NUMERIC",
            min_value=None,
            typical_value=None,
            max_value=None,
            text_value=None,
            unit="V",
            test_conditions="室温",
            is_critical=True,
            evidence_keys=[],
        )


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


def test_production_rejects_development_session_secret() -> None:
    with pytest.raises(ValidationError, match="独立 SESSION_SECRET"):
        Settings(
            _env_file=None,
            APP_ENV="production",
            SESSION_COOKIE_SECURE=True,
            OBJECT_STORAGE_BACKEND="aliyun_oss",
            OSS_ENDPOINT="https://oss.example.invalid",
            OSS_BUCKET="test",
            OSS_ACCESS_KEY_ID="test-key",
            OSS_ACCESS_KEY_SECRET="test-secret",
        )
