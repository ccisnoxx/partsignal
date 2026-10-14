"""凭据、快照 Header 与生成业务严格边界测试。"""

from __future__ import annotations

import httpx2
import pytest

from app.audit import contains_sensitive_key
from app.errors import AppError
from app.schemas.configuration import AIModelCreate
from app.services.ai_configuration import build_snapshot_request_headers
from app.services.ai_provider import validate_header
from app.services.credentials import CredentialCipher
from tests.unit.test_generation_provider import sdk_context

KEY_A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
KEY_B = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="


def test_snapshot_headers_only_use_locked_names_and_current_sensitive_values() -> None:
    headers = build_snapshot_request_headers(
        {"X-Region": "cn"},
        ["HTTP-Referer"],
        {
            "http-referer": "https://current.invalid",
            "X-Added-Later": "must-not-leak-into-old-job",
        },
    )
    assert headers == {
        "X-Region": "cn",
        "HTTP-Referer": "https://current.invalid",
    }


def test_snapshot_headers_reject_missing_sensitive_configuration() -> None:
    with pytest.raises(AppError, match="敏感 Header 当前不可用"):
        build_snapshot_request_headers({}, ["X-Required"], {"X-Other": "value"})


def test_credential_cipher_binds_record_identity_and_key() -> None:
    cipher = CredentialCipher(KEY_A)
    encrypted = cipher.encrypt("secret", associated_data="channel:one")
    assert "secret" not in encrypted
    assert cipher.decrypt(encrypted, associated_data="channel:one") == "secret"
    with pytest.raises(AppError, match="无法解密"):
        cipher.decrypt(encrypted, associated_data="channel:two")
    with pytest.raises(AppError, match="无法解密"):
        CredentialCipher(KEY_B).decrypt(encrypted, associated_data="channel:one")


@pytest.mark.parametrize(
    "content",
    [
        "```json\n{}\n```",
        '{"title":"t","summary":"s","body_markdown":"b","tags":["x"],"extra":1}',
        '{"title":"","summary":"s","body_markdown":"b","tags":["x"]}',
        '{"title":"t","summary":"s","body_markdown":"b"}',
        "not-json",
    ],
)
def test_generated_draft_rejects_non_strict_content(
    content: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services.generation import generate_for_job

    transport = httpx2.MockTransport(
        lambda _: httpx2.Response(200, json={"choices": [{"message": {"content": content}}]})
    )
    db, job, snapshot = sdk_context(monkeypatch, transport, "GENERATE")
    with pytest.raises(AppError, match="模型响应"):
        generate_for_job(db, job, snapshot, None)


def test_header_validation_rejects_reserved_and_injection() -> None:
    assert validate_header("HTTP-Referer", "https://example.invalid") == "http-referer"
    with pytest.raises(AppError):
        validate_header("Authorization", "other")
    with pytest.raises(AppError):
        validate_header("X-Test", "ok\r\ninjected: yes")


def test_model_parameters_reject_system_owned_fields() -> None:
    with pytest.raises(ValueError, match="系统保留字段"):
        AIModelCreate(
            display_name="测试模型",
            model_id="model-a",
            request_parameters={"stream": True},
        )


def test_audit_sensitive_key_detection_is_recursive() -> None:
    assert contains_sensitive_key({"changes": [{"API_KEY": "secret"}]})
    assert not contains_sensitive_key({"changes": [{"header_name": "X-Region"}]})
