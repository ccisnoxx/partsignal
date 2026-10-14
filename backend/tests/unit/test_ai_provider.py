"""实际 SDK 序列化、异常、输入与脱敏边界；所有传输均为本地替身。"""

from __future__ import annotations

import json
import logging
import socket
from typing import Any

import httpx2
import pytest

from app.errors import AppError
from app.services.ai_provider import AIProvider, validate_base_url

ARGUMENTS: dict[str, Any] = {
    "base_url": "https://provider.invalid/custom/v1",
    "api_key": "fake-sdk-api-key",
    "headers": {"X-Secret": "fake-sdk-header-secret", "X-Latin": "caf\u00e9"},
    "timeout_seconds": 13,
}


def test_model_list_uses_sdk_path_credentials_timeout_and_stable_deduplication(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid:1")
    monkeypatch.setenv("OPENAI_ORG_ID", "must-not-be-sent")
    monkeypatch.setenv("OPENAI_PROJECT_ID", "must-not-be-sent")
    requests: list[httpx2.Request] = []

    def respond(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(200, json={"data": [{"id": "b"}, {"id": "a"}, {"id": "b"}]})

    provider = AIProvider(allow_local_http=False, transport=httpx2.MockTransport(respond))
    assert provider.discover_models(**ARGUMENTS) == ["b", "a"]
    (request,) = requests
    assert request.method == "GET"
    assert str(request.url) == "https://provider.invalid/custom/v1/models"
    assert request.headers["Authorization"] == "Bearer fake-sdk-api-key"
    assert request.headers["X-Secret"] == "fake-sdk-header-secret"
    assert (b"X-Latin", b"caf\xe9") in request.headers.raw
    assert not request.headers.get("OpenAI-Organization")
    assert not request.headers.get("OpenAI-Project")
    assert request.extensions["timeout"] == dict.fromkeys(("connect", "read", "write", "pool"), 13)


def test_connection_uses_one_hi_message_and_preserves_provider_parameters() -> None:
    requests: list[httpx2.Request] = []

    def respond(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(200, json={"choices": [{"message": {"content": ""}}]})

    provider = AIProvider(allow_local_http=False, transport=httpx2.MockTransport(respond))
    assert (
        provider.test_connection(
            **ARGUMENTS,
            model_id="fake-model",
            request_parameters={"temperature": 0, "vendor": {"x": 1}},
        )
        == ""
    )
    (request,) = requests
    assert request.method == "POST"
    assert request.url.path == "/custom/v1/chat/completions"
    assert json.loads(request.content) == {
        "model": "fake-model",
        "messages": [{"role": "user", "content": "hi"}],
        "stream": False,
        "temperature": 0,
        "vendor": {"x": 1},
    }


@pytest.mark.parametrize(
    "usage", [None, {"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5}]
)
def test_chat_completion_only_projects_content_request_id_and_reported_usage(
    usage: dict[str, int] | None,
) -> None:
    transport = httpx2.MockTransport(
        lambda _request: httpx2.Response(
            200,
            headers={"X-Request-ID": "fake-req", "X-Other": "hidden"},
            json={"choices": [{"message": {"content": "hello"}}], "usage": usage},
        )
    )
    result = AIProvider(allow_local_http=False, transport=transport).chat_completion(
        **ARGUMENTS,
        model_id="fake-model",
        messages=[{"role": "user", "content": "hi"}],
        request_parameters={},
    )
    assert result.content == "hello"
    assert result.provider_request_id == "fake-req"
    assert type(result.duration_ms) is int and result.duration_ms >= 0
    assert (result.prompt_tokens, result.completion_tokens, result.total_tokens) == (
        (2, 3, 5) if usage else (None, None, None)
    )


@pytest.mark.parametrize("operation", ["discover_models", "test_connection"])
@pytest.mark.parametrize("status", [302, 401, 403, 404, 408, 409, 429, 500, 503])
def test_sdk_status_errors_are_safe_and_never_retried_or_redirected(
    operation: str,
    status: int,
    caplog: pytest.LogCaptureFixture,
) -> None:
    requests: list[httpx2.Request] = []
    caplog.set_level(logging.DEBUG)

    def respond(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(
            status,
            headers={"Location": "https://other.invalid/"},
            json={"error": {"message": "fake-provider-secret-body"}},
        )

    provider = AIProvider(allow_local_http=False, transport=httpx2.MockTransport(respond))
    arguments = dict(ARGUMENTS)
    if operation == "test_connection":
        arguments.update(model_id="fake-model", request_parameters={})
    with pytest.raises(AppError) as caught:
        getattr(provider, operation)(**arguments)
    assert caught.value.code == ("AI_REDIRECT_FORBIDDEN" if status == 302 else "AI_PROVIDER_ERROR")
    assert caught.value.status_code == 502
    assert len(requests) == 1
    exposed = f"{caught.value.message} {caught.value.details} {caplog.text}"
    for secret in ("fake-provider-secret-body", "fake-sdk-api-key", "fake-sdk-header-secret"):
        assert secret not in exposed
    assert caught.value.__suppress_context__ is True


@pytest.mark.parametrize(
    "exception_type,code,status",
    [
        (httpx2.ReadTimeout, "AI_PROVIDER_TIMEOUT", 504),
        (httpx2.ConnectError, "AI_PROVIDER_UNAVAILABLE", 502),
    ],
)
def test_sdk_network_error_mapping_does_not_retry(
    exception_type: type[httpx2.RequestError],
    code: str,
    status: int,
) -> None:
    requests: list[httpx2.Request] = []

    def respond(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        raise exception_type("fake-provider-secret-body", request=request)

    with pytest.raises(AppError) as caught:
        AIProvider(allow_local_http=False, transport=httpx2.MockTransport(respond)).discover_models(
            **ARGUMENTS
        )
    assert (caught.value.code, caught.value.status_code) == (code, status)
    assert "fake-provider-secret-body" not in caught.value.message
    assert len(requests) == 1


@pytest.mark.parametrize(
    "payload",
    [{}, {"data": None}, {"data": [{}]}, {"data": [{"id": ""}]}, {"data": [{"id": 7}]}, []],
)
def test_invalid_model_lists_fail_at_business_boundary(payload: object) -> None:
    transport = httpx2.MockTransport(lambda _request: httpx2.Response(200, json=payload))
    with pytest.raises(AppError) as caught:
        AIProvider(allow_local_http=False, transport=transport).discover_models(**ARGUMENTS)
    assert caught.value.code == "AI_RESPONSE_INVALID"


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"choices": []},
        {"choices": [{"message": {}}]},
        {"choices": [{"message": {"content": None}}]},
        {"choices": [{"message": {"content": 7}}]},
    ],
)
def test_invalid_connection_content_is_not_accepted(payload: object) -> None:
    transport = httpx2.MockTransport(lambda _request: httpx2.Response(200, json=payload))
    with pytest.raises(AppError) as caught:
        AIProvider(allow_local_http=False, transport=transport).test_connection(
            **ARGUMENTS, model_id="fake-model", request_parameters={}
        )
    assert caught.value.code == "AI_RESPONSE_INVALID"


@pytest.mark.parametrize("operation", ["discover_models", "test_connection"])
@pytest.mark.parametrize("content_type", ["application/json", "text/html"])
def test_non_json_provider_responses_fail_safely(operation: str, content_type: str) -> None:
    transport = httpx2.MockTransport(
        lambda _request: httpx2.Response(
            200, headers={"Content-Type": content_type}, content=b"fake-provider-secret-body"
        )
    )
    arguments = dict(ARGUMENTS)
    if operation == "test_connection":
        arguments.update(model_id="fake-model", request_parameters={})
    with pytest.raises(AppError) as caught:
        getattr(AIProvider(allow_local_http=False, transport=transport), operation)(**arguments)
    assert caught.value.code == "AI_RESPONSE_INVALID"
    assert "fake-provider-secret-body" not in caught.value.message


@pytest.mark.parametrize(
    "url",
    [
        "https://user:pass@provider.invalid/v1",
        "https://@provider.invalid/v1",
        "https://provider.invalid/v1?x=1",
        "https://provider.invalid/v1#x",
        "https://provider.invalid:bad/v1",
        "ftp://provider.invalid/v1",
        "https://provider.invalid/v1\n",
        "http://provider.invalid/v1",
    ],
)
def test_url_input_rejects_forbidden_components(url: str) -> None:
    with pytest.raises(AppError) as caught:
        validate_base_url(url, allow_local_http=True)
    assert caught.value.code == "AI_URL_FORBIDDEN"


def test_url_validation_is_syntactic_and_local_http_is_explicit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbid_dns(*args: object, **kwargs: object) -> None:
        pytest.fail("URL 输入校验不得解析 DNS")

    monkeypatch.setattr(socket, "getaddrinfo", forbid_dns)
    assert validate_base_url("https://provider.invalid/v1/", allow_local_http=False) == (
        "https://provider.invalid/v1"
    )
    for host in ("localhost", "127.0.0.1", "[::1]"):
        url = f"http://{host}:12345/v1"
        assert validate_base_url(url, allow_local_http=True) == url
        with pytest.raises(AppError):
            validate_base_url(url, allow_local_http=False)


@pytest.mark.parametrize(
    "headers", [{"Authorization": "other"}, {"X-Test": "a\r\nb"}, {"X-Test": "a", "x-test": "b"}]
)
def test_headers_are_validated_before_sdk_request(headers: dict[str, str]) -> None:
    def forbid_request(request: httpx2.Request) -> httpx2.Response:
        pytest.fail("非法 Header 不得发送")

    arguments = {**ARGUMENTS, "headers": headers}
    with pytest.raises(AppError) as caught:
        AIProvider(
            allow_local_http=False, transport=httpx2.MockTransport(forbid_request)
        ).discover_models(**arguments)
    assert caught.value.code == "INVALID_HEADER"


@pytest.mark.parametrize("owner", ["configuration", "profile"])
def test_geo_e2e_diagnostics_use_sdk_with_diagnostic_attempt_id(
    monkeypatch: pytest.MonkeyPatch, owner: str,
) -> None:
    """两条实际诊断入口都必须保留 fake 的独立诊断身份。"""
    from uuid import UUID, uuid4

    from app.services import ai_configuration, geo_profile_tests
    from tests.geo_e2e_environment import PROVIDER_API_URL
    from tests.geo_e2e_runtime import _install_diagnostics

    monkeypatch.setattr(ai_configuration, "AIProvider", ai_configuration.AIProvider)
    monkeypatch.setattr(geo_profile_tests, "AIProvider", geo_profile_tests.AIProvider)
    monkeypatch.setattr(geo_profile_tests, "_reserve", geo_profile_tests._reserve)
    _install_diagnostics()
    requests: list[httpx2.Request] = []

    def respond(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(200, json={"choices": [{"message": {"content": "hello"}}]})

    module = ai_configuration if owner == "configuration" else geo_profile_tests
    provider = module.AIProvider(
        allow_local_http=True, transport=httpx2.MockTransport(respond)
    )
    attempt_id = uuid4()
    assert (
        provider.test_connection(
            base_url=PROVIDER_API_URL,
            api_key="fake-key",
            headers={},
            timeout_seconds=10,
            model_id="fake-model",
            request_parameters={},
            **({"_geo_e2e_attempt_id": attempt_id} if owner == "profile" else {}),
        )
        == "hello"
    )
    (request,) = requests
    assert str(UUID(request.headers["X-GEO-Attempt-ID"])) == request.headers["X-GEO-Attempt-ID"]
    if owner == "profile":
        assert request.headers["X-GEO-Attempt-ID"] == str(attempt_id)
    assert json.loads(request.content)["messages"] == [{"role": "user", "content": "hi"}]


@pytest.mark.parametrize("operation", ["discover_models", "test_connection"])
def test_ambient_sdk_headers_are_rejected_without_sending(
    operation: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "OPENAI_CUSTOM_HEADERS",
        "X-Ambient-Secret: fake-unrelated-secret\nHost: wrong.invalid\nContent-Type: text/plain",
    )
    requests: list[httpx2.Request] = []

    def respond(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        pytest.fail("未归属渠道的环境 Header 不得外发")

    arguments = dict(ARGUMENTS)
    if operation == "test_connection":
        arguments.update(model_id="fake-model", request_parameters={})
    with pytest.raises(AppError) as caught:
        getattr(
            AIProvider(allow_local_http=False, transport=httpx2.MockTransport(respond)), operation
        )(**arguments)
    assert caught.value.code == "INVALID_HEADER"
    assert requests == []
    assert "fake-unrelated-secret" not in caught.value.message


@pytest.mark.parametrize("operation", ["discover_models", "test_connection"])
def test_sdk_preserves_existing_latin1_api_keys(operation: str) -> None:
    requests: list[httpx2.Request] = []

    def respond(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(
            200, json={"data": [{"id": "fake-model"}], "choices": [{"message": {"content": "hi"}}]}
        )

    arguments = {**ARGUMENTS, "api_key": "fake-caf\u00e9"}
    if operation == "test_connection":
        arguments.update(model_id="fake-model", request_parameters={})
    result = getattr(
        AIProvider(allow_local_http=False, transport=httpx2.MockTransport(respond)), operation
    )(**arguments)
    assert result == (["fake-model"] if operation == "discover_models" else "hi")
    assert (b"Authorization", b"Bearer fake-caf\xe9") in requests[0].headers.raw
    assert (b"X-Latin", b"caf\xe9") in requests[0].headers.raw
    assert requests[0].headers["Host"] == "provider.invalid"
    if operation == "test_connection":
        assert requests[0].headers["Content-Type"] == "application/json"


@pytest.mark.parametrize("operation", ["discover_models", "test_connection"])
def test_invalid_utf8_response_is_a_safe_business_failure(operation: str) -> None:
    transport = httpx2.MockTransport(
        lambda request: httpx2.Response(
            200, headers={"Content-Type": "application/json"}, content=b"\xff"
        )
    )
    arguments = dict(ARGUMENTS)
    if operation == "test_connection":
        arguments.update(model_id="fake-model", request_parameters={})
    with pytest.raises(AppError) as caught:
        getattr(AIProvider(allow_local_http=False, transport=transport), operation)(**arguments)
    assert (caught.value.code, caught.value.status_code) == ("AI_RESPONSE_INVALID", 502)
