"""凭据、SSRF、Header 与 Chat Completions 严格边界测试。"""

from __future__ import annotations

import json
import socket

import pytest

from app.audit import contains_sensitive_key
from app.errors import AppError
from app.schemas import AIModelCreate
from app.services.ai_configuration import build_snapshot_request_headers
from app.services.credentials import CredentialCipher
from app.services.openai_client import (
    OpenAICompatibleClient,
    parse_generated_draft,
    validate_base_url,
    validate_header,
)
from app.services.pinned_http import PinnedResponse

KEY_A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
KEY_B = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="


class StubTransport:
    """只替代协议层以下的传输，固定地址行为由独立测试覆盖。"""

    def __init__(
        self,
        response: PinnedResponse | None = None,
        error: AppError | None = None,
    ) -> None:
        self.response = response
        self.error = error
        self.requests: list[dict[str, object]] = []

    def request(self, **request: object) -> PinnedResponse:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        assert self.response is not None
        return self.response


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
def test_generated_draft_rejects_non_strict_content(content: str) -> None:
    with pytest.raises(AppError, match="模型响应"):
        parse_generated_draft(content)


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


def test_url_validation_allows_only_loopback_http_in_development(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))],
    )
    with pytest.raises(AppError, match="非公网"):
        validate_base_url("https://provider.invalid/v1", allow_local_http=False)
    assert (
        validate_base_url("http://provider.invalid/v1/", allow_local_http=True)
        == "http://provider.invalid/v1"
    )

    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.8", 80))],
    )
    with pytest.raises(AppError, match="本机地址"):
        validate_base_url("http://provider.invalid/v1", allow_local_http=True)

    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80))
        ],
    )
    with pytest.raises(AppError, match="本机地址"):
        validate_base_url("http://provider.invalid/v1", allow_local_http=True)


def test_chat_completions_sends_exact_path_headers_and_parameters(
) -> None:
    transport = StubTransport(
        PinnedResponse(
            status_code=200,
            headers={"x-request-id": "req-1"},
            body=json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": (
                                    '{"title":"标题","summary":"摘要",'
                                    '"body_markdown":"正文","tags":["标签"]}'
                                )
                            }
                        }
                    ],
                    "usage": {"prompt_tokens": 2, "completion_tokens": 3},
                },
                ensure_ascii=False,
            ).encode(),
        )
    )
    result = OpenAICompatibleClient(
        allow_local_http=False, transport=transport
    ).complete(
        base_url="https://provider.invalid/openai/v1",
        api_key="api-secret",
        headers={"X-Title": "PartSignal"},
        timeout_seconds=30,
        model_id="model-a",
        request_parameters={"temperature": 0.2, "metadata": {"purpose": "test"}},
        system_message="system",
        user_message="user",
    )
    request = transport.requests[0]
    assert request["base_url"] == "https://provider.invalid/openai/v1"
    assert request["suffix"] == "chat/completions"
    assert request["headers"] == {
        "Authorization": "Bearer api-secret",
        "X-Title": "PartSignal",
    }
    body = json.loads(request["body"])  # type: ignore[arg-type]
    assert body["model"] == "model-a"
    assert body["stream"] is False
    assert body["temperature"] == 0.2
    assert result.provider_request_id == "req-1"
    assert result.total_tokens is None


def test_redirect_is_not_followed() -> None:
    transport = StubTransport(
        PinnedResponse(
            status_code=302,
            headers={"location": "https://other.invalid/v1"},
            body=b"",
        )
    )
    with pytest.raises(AppError, match="重定向"):
        OpenAICompatibleClient(
            allow_local_http=False, transport=transport
        ).discover_models(
            base_url="https://provider.invalid/v1",
            api_key="key",
            headers={},
            timeout_seconds=10,
        )


def test_provider_timeout_is_not_retried() -> None:
    transport = StubTransport(error=AppError("AI_PROVIDER_TIMEOUT", "AI 渠道请求超时", 504))
    with pytest.raises(AppError, match="请求超时"):
        OpenAICompatibleClient(
            allow_local_http=False, transport=transport
        ).complete(
            base_url="https://provider.invalid/v1",
            api_key="key",
            headers={},
            timeout_seconds=10,
            model_id="model-a",
            request_parameters={},
            system_message="system",
            user_message="user",
        )
    assert len(transport.requests) == 1
