"""官方 SDK 的 GEO 发送窗口、接收后上限与敏感字段金标。"""

import json
from base64 import b64encode
from dataclasses import replace
from urllib.parse import quote, quote_from_bytes

import httpx2
import pytest
from openai import APIConnectionError
from openai.resources.chat.completions import Completions

from app.collectors.errors import CollectorError, CollectorRetryability, CollectorStage
from app.collectors.openai_compatible import OpenAICompatibleGeoCollector
from app.errors import AppError
from app.schemas.geo_runs import GeoExternalCallState as State
from app.schemas.geo_runs import GeoRunErrorCode as Code
from app.services.ai_provider import AIProvider
from app.services.geo_collection_admission import BudgetExceeded
from tests.geo_collector_contract import assert_secrets_absent, test_secret
from tests.geo_network_guard import local_geo_network as local_geo_network
from tests.geo_openai_support import configuration, make_request


def answer_bytes():
    return b'{"choices":[{"message":{"content":"answer"},"finish_reason":"stop"}]}'


def collector_for_response(request, response, *, calls=None, **changes):
    def receive(wire):
        if calls is not None:
            calls.append(wire)
        if isinstance(response, Exception):
            raise response
        return response

    provider = AIProvider(allow_local_http=False, transport=httpx2.MockTransport(receive))
    return OpenAICompatibleGeoCollector(**configuration(request, provider=provider, **changes))


@pytest.fixture
def sdk_calls(monkeypatch):
    calls = []
    original = Completions.create

    def create(self, *args, **kwargs):
        calls.append(True)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Completions, "create", create)
    return calls


def test_profile_overrides_sampling_and_output_limit_without_adding_instructions():
    request = make_request()
    request = replace(
        request, profile=replace(
            request.profile, settings=(("temperature", 0.2), ("max_output_tokens", 80))
        ),
    )
    calls = []
    params = {"temperature": 1.5, "max_completion_tokens": 100, "top_p": 0.9}
    collector = collector_for_response(
        request, httpx2.Response(200, content=answer_bytes()),
        calls=calls, request_parameters=params
    )
    params["temperature"] = 2
    collector.collect(request, before_send=lambda: None)
    assert len(calls) == 1
    assert json.loads(calls[0].content) == {
        "model": "geo-fixture-model", "stream": False,
        "messages": [{"role": "user", "content": request.prompt_text}],
        "temperature": 0.2, "max_completion_tokens": 80, "top_p": 0.9,
    }


@pytest.mark.parametrize("bad_url", [
    "http://provider.test/v1", "https://user:pass@provider.test/v1",
    "https://provider.test/v1?token=private", "https://provider.test/v1#fragment",
    "https://provider.test/\ud800",
])
def test_forbidden_urls_never_authorize_or_start_sdk(bad_url, sdk_calls):
    request = make_request()
    calls = []
    collector = collector_for_response(
        request, httpx2.Response(200, content=answer_bytes()), calls=calls, base_url=bad_url
    )
    with pytest.raises(CollectorError) as caught:
        collector.collect(request, before_send=lambda: pytest.fail("不能授权"))
    assert caught.value.failure.code == Code.COLLECTOR_CONFIGURATION_INVALID
    assert caught.value.failure.external_call_state == State.NOT_STARTED
    assert calls == sdk_calls == []


@pytest.mark.parametrize("error_type", [
    httpx2.ConnectError, httpx2.ConnectTimeout, httpx2.ReadTimeout,
    httpx2.ReadError, httpx2.RemoteProtocolError,
])
def test_network_failure_after_authorization_is_unknown_and_has_no_sdk_retry(error_type):
    request = make_request()
    calls, authorized = [], []
    collector = collector_for_response(request, error_type("private error"), calls=calls)
    with pytest.raises(CollectorError) as caught:
        collector.collect(request, before_send=lambda: authorized.append(True))
    assert caught.value.failure.code == Code.COLLECTOR_UNKNOWN_OUTCOME
    assert caught.value.failure.stage == CollectorStage.RECEIVE
    assert caught.value.failure.external_call_state == State.UNKNOWN
    assert caught.value.failure.retryability == CollectorRetryability.NEW_ATTEMPT_ONLY
    assert len(calls) == len(authorized) == 1
    assert "private" not in str(caught.value)


@pytest.mark.parametrize("error", [
    BudgetExceeded(), OSError("授权存储失败"),
    AppError("FORBIDDEN", "授权失败", 403),
    APIConnectionError(request=httpx2.Request("POST", "https://provider.test")),
])
def test_callback_exception_is_original_and_sdk_never_starts(error, sdk_calls):
    request = make_request()
    calls = []
    collector = collector_for_response(
        request, httpx2.Response(200, content=answer_bytes()), calls=calls
    )

    def reject():
        raise error

    with pytest.raises(type(error)) as caught:
        collector.collect(request, before_send=reject)
    assert caught.value is error
    assert calls == sdk_calls == []


@pytest.mark.parametrize("headers", [{}, {"content-length": "9000"}, {
    "transfer-encoding": "chunked",
}])
def test_response_limit_checks_actual_received_bytes_and_reports_completed(headers):
    request = replace(make_request(), max_response_bytes=len(answer_bytes()) - 1)
    with pytest.raises(CollectorError) as caught:
        collector_for_response(request, httpx2.Response(
            200, headers=headers, content=answer_bytes()
        )).collect(request, before_send=lambda: None)
    assert caught.value.failure.code == Code.PROVIDER_RESPONSE_TOO_LARGE
    assert caught.value.failure.external_call_state == State.COMPLETED


def test_exact_utf8_byte_limit_is_accepted_and_counts_raw_provider_extensions():
    body = json.dumps({"choices": [{"message": {"content": "中文"}}],
                       "debug": "unused"}, ensure_ascii=False).encode()
    request = replace(make_request(), max_response_bytes=len(body))
    result = collector_for_response(request, httpx2.Response(200, content=body)).collect(
        request, before_send=lambda: None
    )
    assert result.answer_text == "中文"
    assert result.raw_payload_summary.payload_bytes == len(body)
    with pytest.raises(CollectorError) as caught:
        collector_for_response(request, httpx2.Response(200, content=body + b" ")).collect(
            request, before_send=lambda: None
        )
    assert caught.value.failure.code == Code.PROVIDER_RESPONSE_TOO_LARGE


@pytest.mark.parametrize("status", [600, 999])
def test_invalid_http_status_has_stable_completed_error(status):
    request = make_request()
    with pytest.raises(CollectorError) as caught:
        collector_for_response(request, httpx2.Response(status, content=b"{}")).collect(
            request, before_send=lambda: None
        )
    assert caught.value.failure.code == Code.PROVIDER_RESPONSE_INVALID
    assert caught.value.failure.stage == CollectorStage.RECEIVE
    assert caught.value.failure.external_call_state == State.COMPLETED
    assert caught.value.failure.provider_status is None


@pytest.mark.parametrize("value,expected", [
    ("2", 2), ("0", 0), ("999999999", 999999999), ("1000000000", None),
    ("-1", None), ("1.2", None), ("Wed, 01 Jan 2025 00:00:00 GMT", None),
    ("private", None),
])
def test_retry_after_is_safe_bounded_metadata(value, expected):
    request = make_request()
    with pytest.raises(CollectorError) as caught:
        collector_for_response(request, httpx2.Response(
            429, headers={"Retry-After": value}, json={"error": {"message": "private"}}
        )).collect(request, before_send=lambda: None)
    assert caught.value.failure.retry_after_seconds == expected
    assert caught.value.failure.provider_status == 429
    assert caught.value.failure.external_call_state == State.COMPLETED


@pytest.mark.parametrize("field", [
    "answer", "model", "source_product", "source_version", "request_id",
    "citation_url", "citation_title",
])
def test_provider_cannot_return_actual_credentials_in_any_retained_field(field):
    request = make_request()
    secret = test_secret("api")
    payload = json.loads(answer_bytes())
    headers = {}
    if field == "answer":
        payload["choices"][0]["message"]["content"] = f"原文包含 {secret}"
    elif field == "request_id":
        headers["x-request-id"] = secret
    elif field.startswith("citation_"):
        payload["citations"] = [{
            "url": f"https://example.com/?credential={secret}" if field == "citation_url"
            else "https://example.com/", "title": secret if field == "citation_title" else None,
            "position": 1,
        }]
    else:
        payload[field] = secret
    with pytest.raises(CollectorError) as caught:
        collector_for_response(request, httpx2.Response(
            200, headers=headers, json=payload
        ), api_key=secret).collect(request, before_send=lambda: None)
    assert caught.value.failure.code == Code.PROVIDER_RESPONSE_INVALID
    assert caught.value.failure.stage == CollectorStage.PARSE
    assert caught.value.failure.external_call_state == State.COMPLETED
    assert_secrets_absent([str(caught.value), repr(caught.value)], [secret])


@pytest.mark.parametrize("encoding", [
    "plain", "url", "url-lower", "url-wire", "json", "base64", "base64-wire",
])
def test_sensitive_header_reflections_are_rejected_in_retained_text(encoding):
    request = make_request()
    secret = test_secret("header") + '/quoted"é'
    values = {
        "plain": secret, "url": quote(secret, safe=""),
        "url-wire": quote_from_bytes(secret.encode("latin-1"), safe=""),
        "url-lower": quote(secret, safe="").replace("%2F", "%2f").replace("%C3%A9", "%c3%a9"),
        "json": json.dumps(secret, ensure_ascii=True)[1:-1],
        "base64": b64encode(secret.encode()).decode(),
        "base64-wire": b64encode(secret.encode("latin-1")).decode(),
    }
    body = json.dumps({"choices": [{"message": {"content": values[encoding]}}]}).encode()
    with pytest.raises(CollectorError):
        collector_for_response(request, httpx2.Response(200, content=body),
                               sensitive_headers={"X-Secret": secret}).collect(
            request, before_send=lambda: None
        )


def test_sdk_environment_headers_fail_before_authorization(monkeypatch, sdk_calls):
    monkeypatch.setenv("OPENAI_CUSTOM_HEADERS", "X-Secret: private")
    request = make_request()
    with pytest.raises(CollectorError) as caught:
        collector_for_response(request, httpx2.Response(200, content=answer_bytes())).collect(
            request, before_send=lambda: pytest.fail("不能授权")
        )
    assert caught.value.failure.external_call_state == State.NOT_STARTED
    assert sdk_calls == []


@pytest.mark.parametrize("location", ["headers", "sensitive_headers"])
@pytest.mark.parametrize("name", ["X-Stainless-Raw-Response", "x-stainless-raw-response"])
@pytest.mark.parametrize("value", ["false", "stream"])
def test_sdk_control_header_is_rejected_before_authorization_and_sdk(
    location, name, value, sdk_calls
):
    request = make_request()
    calls = []
    collector = collector_for_response(
        request, httpx2.Response(200, content=answer_bytes()), calls=calls,
        **{location: {name: value}},
    )
    with pytest.raises(CollectorError) as caught:
        collector.collect(request, before_send=lambda: pytest.fail("SDK 控制 Header 不能授权"))
    assert caught.value.failure.code == Code.COLLECTOR_CONFIGURATION_INVALID
    assert caught.value.failure.external_call_state == State.NOT_STARTED
    assert sdk_calls == calls == []


@pytest.mark.parametrize("operation", ["discover_models", "test_connection"])
def test_shared_sdk_client_rejects_raw_control_header_before_io(operation):
    calls = []

    def receive(request):
        calls.append(request)
        return httpx2.Response(200, json={"data": []})

    provider = AIProvider(allow_local_http=False, transport=httpx2.MockTransport(receive))
    arguments = {"base_url": "https://provider.test/v1", "api_key": "synthetic-key",
                 "headers": {"X-Stainless-Raw-Response": "false"}, "timeout_seconds": 1}
    if operation == "test_connection":
        arguments.update(model_id="fixture", request_parameters={})
    with pytest.raises(AppError) as caught:
        getattr(provider, operation)(**arguments)
    assert caught.value.code == "INVALID_HEADER"
    assert calls == []
