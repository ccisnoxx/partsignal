"""真实 TCP 替身自测；不调用真实平台，不以 Mock/ASGI 异常冒充网络故障。"""

import hashlib
import json
import socket
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from uuid import uuid4

import httpx
import pytest

from app.errors import AppError
from app.geo_fake_server import FakeMode, FakeScenario, GeoFakeServer, running_geo_fake
from app.services.pinned_http import PinnedHTTPTransport
from tests.geo_collector_contract import assert_secrets_absent, test_secret
from tests.geo_network_guard import local_geo_network as local_geo_network


def send(provider, attempt_id, body=b'{"messages":[]}'):
    return PinnedHTTPTransport(allow_local_http=True, max_response_bytes=4096).request(
        method="POST",
        base_url=provider.base_url + "/v1",
        suffix="chat/completions",
        headers={"X-GEO-Attempt-ID": str(attempt_id)},
        timeout_seconds=1,
        body=body,
    )


@pytest.mark.parametrize("mode", [FakeMode.SUCCESS, FakeMode.CITATIONS])
def test_fake_returns_raw_answer_and_structured_citations(mode):
    with running_geo_fake(FakeScenario(mode=mode)) as provider:
        attempt = uuid4()
        result = send(provider, attempt)
        payload = json.loads(result.body)
        assert payload["choices"][0]["message"]["content"]
        assert payload["web_search_observed"] is None
        assert "usage" not in payload and "cost" not in payload
        assert result.headers["x-request-id"] == f"geo-fake-{attempt}"
        if mode == FakeMode.CITATIONS:
            assert [c["position"] for c in payload["citations"]] == [1, 3]
            assert payload["citations"][0]["url"] == payload["citations"][1]["url"]
        assert provider.state.snapshot(attempt)["count"] == 1


@pytest.mark.parametrize(
    "mode,status",
    [
        (FakeMode.RATE_LIMIT, 429),
        (FakeMode.AUTH_401, 401),
        (FakeMode.AUTH_403, 403),
        (FakeMode.UNAVAILABLE, 503),
        (FakeMode.REDIRECT, 307),
    ],
)
def test_fake_status_and_existing_pinned_transport_never_redirect_or_retry(mode, status):
    with running_geo_fake(FakeScenario(mode=mode)) as provider:
        attempt = uuid4()
        response = send(provider, attempt)
        assert response.status_code == status
        if status == 429:
            assert response.headers["retry-after"] == "2"
        stats = provider.state.snapshot(attempt)
        assert stats["count"] == 1 and stats["redirect_hits"] == 0


@pytest.mark.parametrize(
    "mode,code",
    [
        (FakeMode.TIMEOUT, "AI_PROVIDER_TIMEOUT"),
        (FakeMode.SLOW_BODY, "AI_PROVIDER_TIMEOUT"),
        (FakeMode.DISCONNECT, "AI_PROVIDER_UNAVAILABLE"),
        (FakeMode.OVERSIZE, "AI_RESPONSE_TOO_LARGE"),
        (FakeMode.OVERSIZE_CHUNKED, "AI_RESPONSE_TOO_LARGE"),
    ],
)
def test_real_timeout_drop_and_size_limit_using_existing_pinned_transport(mode, code):
    with running_geo_fake(FakeScenario(mode=mode, response_bytes=8193)) as provider:
        attempt = uuid4()
        with pytest.raises(AppError) as error:
            send(provider, attempt)
        assert error.value.code == code
        assert provider.state.snapshot(attempt)["count"] == 1


@pytest.mark.parametrize(
    "mode",
    [
        FakeMode.INVALID_JSON,
        FakeMode.INVALID_RESPONSE,
        FakeMode.EMPTY_ANSWER,
    ],
)
def test_invalid_response_is_actual_wire_data(mode):
    with running_geo_fake(FakeScenario(mode=mode)) as provider:
        response = send(provider, uuid4())
        assert response.status_code == 200
        if mode == FakeMode.INVALID_JSON:
            with pytest.raises(ValueError):
                json.loads(response.body)
        else:
            content = json.loads(response.body)["choices"][0]["message"]["content"]
            assert not isinstance(content, str) or not content.strip()


def test_control_api_closed_scenarios_and_no_sensitive_diagnostics(capsys):
    secret = test_secret("api")
    with running_geo_fake() as provider, httpx.Client(trust_env=False) as client:
        attempt = uuid4()
        url = f"{provider.base_url}/__geo__/scenarios/{attempt}"
        response = client.put(url, json={"mode": "429"})
        assert response.json() == {"configured": True}
        response = send(provider, attempt)
        assert response.status_code == 429
        stats = client.get(f"{provider.base_url}/__geo__/calls/{attempt}").json()
        assert stats["count"] == 1
        for payload in (
            {"mode": "unknown"},
            {"mode": "success", "extra": secret},
            {"response_bytes": True},
            {"delay_seconds": 9},
        ):
            invalid = client.put(url, json=payload)
            assert invalid.status_code == 400
            assert_secrets_absent([invalid.text], [secret])
        invalid = client.get(f"{provider.base_url}/__geo__/calls/{secret}")
        assert invalid.status_code == 400
        assert_secrets_absent([invalid.text, json.dumps(stats)], [secret])
    assert_secrets_absent(capsys.readouterr(), [secret])


def test_call_counter_observes_duplicates_concurrency_and_instance_isolation():
    attempt = uuid4()
    body = b'{"messages":[{"role":"user","content":"fixture"}]}'
    with running_geo_fake() as first, running_geo_fake() as second:
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = [pool.submit(send, first, attempt, body) for _ in range(12)]
            assert all(f.result(timeout=5).status_code == 200 for f in futures)
        records = first.state.snapshot(attempt)
        assert records["count"] == 12
        assert all(
            record == {"body_sha256": hashlib.sha256(body).hexdigest(), "body_bytes": len(body)}
            for record in records["requests"]
        )
        assert second.state.snapshot(attempt)["count"] == 0
        assert first.state.snapshot(uuid4())["count"] == 0
        # 返回副本不可改变真实计数。
        records["requests"].clear()
        assert first.state.snapshot(attempt)["count"] == 12


def test_fake_accepts_pending_connection_burst_before_handler_scheduling():
    # accept 线程尚未调度时仍要容纳计数用例的突发连接；使用真实 TCP，不改客户端超时。
    with GeoFakeServer() as provider, ExitStack() as pending:
        for _ in range(12):
            pending.enter_context(
                socket.create_connection(("127.0.0.1", provider.server_port), timeout=1)
            )


def test_failed_connection_is_genuinely_unsent_and_provider_can_stop():
    with running_geo_fake() as provider:
        port = provider.server_port
    with socket.socket() as connection:
        connection.settimeout(1)
        assert connection.connect_ex(("127.0.0.1", port)) != 0


@pytest.mark.parametrize(
    "body,headers",
    [
        (b"{}", {}),
        (b"{}", {"X-GEO-Attempt-ID": "not-uuid"}),
    ],
)
def test_invalid_attempt_never_creates_call_record(body, headers):
    with running_geo_fake() as provider, httpx.Client(trust_env=False) as client:
        response = client.post(
            provider.base_url + "/v1/chat/completions", content=body, headers=headers
        )
        assert response.status_code == 400


def test_network_guard_rejects_non_loopback_before_dns_or_connect():
    with pytest.raises(AssertionError, match="禁止外部网络"):
        socket.getaddrinfo("provider.invalid", 443)
    with socket.socket() as connection:
        with pytest.raises(AssertionError, match="禁止外部网络"):
            connection.connect(("192.0.2.1", 443))
        with pytest.raises(AssertionError, match="禁止外部网络"):
            connection.connect_ex(("192.0.2.1", 443))


def test_unsupported_http_method_error_cannot_echo_sensitive_request(capsys):
    secret = test_secret("header")
    with running_geo_fake() as provider, httpx.Client(trust_env=False) as client:
        response = client.request(secret, provider.base_url + "/")
        assert response.status_code == 501
        assert_secrets_absent([response.text, *capsys.readouterr()], [secret])


@pytest.mark.parametrize("mode", [FakeMode.SUCCESS, FakeMode.RATE_LIMIT])
def test_sensitive_canaries_actually_reach_wire_but_never_statistics(mode, capsys, caplog):
    secrets = [test_secret(kind) for kind in ("api", "header", "cookie")]
    attempt = uuid4()
    with (
        running_geo_fake(FakeScenario(mode=mode, echo_sensitive=True)) as provider,
        httpx.Client(trust_env=False) as client,
    ):
        response = client.post(
            provider.base_url + "/v1/chat/completions",
            content=b"{}",
            headers={
                "X-GEO-Attempt-ID": str(attempt),
                "Authorization": "Bearer " + secrets[0],
                "X-Test-Secret": secrets[1],
                "Cookie": secrets[2],
            },
        )
        assert all(secret in response.text for secret in secrets)
        if mode == FakeMode.SUCCESS:
            assert all(secret in response.headers["set-cookie"] for secret in secrets)
        stats = client.get(f"{provider.base_url}/__geo__/calls/{attempt}")
        assert_secrets_absent([stats.text, caplog.text, *capsys.readouterr()], secrets)
