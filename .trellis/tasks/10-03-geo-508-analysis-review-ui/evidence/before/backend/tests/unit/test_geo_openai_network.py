"""GEO 出站 SSRF、真实本地 TLS、发送边界与响应上限金标。"""

import json
import socket
import ssl
from base64 import b64encode
from dataclasses import replace
from typing import cast
from urllib.parse import quote, quote_from_bytes

import pytest

from app.collectors.errors import CollectorError, CollectorRetryability, CollectorStage
from app.collectors.openai_compatible import OpenAICompatibleGeoCollector
from app.geo_fake_server import running_geo_fake
from app.schemas.geo_runs import GeoExternalCallState as State
from app.schemas.geo_runs import GeoRunErrorCode as Code
from app.services.pinned_http import PinnedHTTPTransport, PinnedTransportError
from tests.geo_collector_contract import assert_secrets_absent, test_secret
from tests.geo_network_guard import local_geo_network as local_geo_network
from tests.geo_openai_support import configuration, make_request
from tests.integration.test_ai_egress_https import PeerOverrideSocket, write_local_ca
from tests.unit.test_pinned_http import FakeSocket, ok_response, resolver_for


def answer_bytes():
    return b'{"choices":[{"message":{"content":"answer"},"finish_reason":"stop"}]}'


def collector_for_socket(request, fake, *, resolver=None, **changes):
    transport = PinnedHTTPTransport(
        allow_local_http=False,
        resolver=resolver or resolver_for("93.184.216.34"),
        connector=lambda _address, _timeout: fake,
        tls_wrapper=lambda connection, _host: connection,
    )
    return OpenAICompatibleGeoCollector(**configuration(request, transport=transport, **changes))


def test_profile_overrides_sampling_and_output_limit_without_adding_instructions():
    request = make_request()
    request = replace(
        request,
        profile=replace(
            request.profile, settings=(("temperature", 0.2), ("max_output_tokens", 80))
        ),
    )
    fake = FakeSocket(peer_ip="93.184.216.34", response=ok_response(answer_bytes()))
    params = {"temperature": 1.5, "max_completion_tokens": 100, "top_p": 0.9}
    collector = collector_for_socket(request, fake, request_parameters=params)
    params["temperature"] = 2
    collector.collect(request, before_send=lambda: None)
    wire = json.loads(fake.sent[0].split(b"\r\n\r\n", 1)[1])
    assert wire == {
        "model": "geo-fixture-model",
        "stream": False,
        "messages": [{"role": "user", "content": request.prompt_text}],
        "temperature": 0.2,
        "max_completion_tokens": 80,
        "top_p": 0.9,
    }
    assert fake.closed


@pytest.mark.parametrize(
    "bad_url",
    [
        "http://provider.test/v1",
        "https://user:pass@provider.test/v1",
        "https://provider.test/v1?token=private",
        "https://provider.test/v1#fragment",
    ],
)
def test_forbidden_urls_never_authorize_or_send(bad_url):
    request = make_request()
    fake = FakeSocket(peer_ip="93.184.216.34", response=ok_response(answer_bytes()))
    collector = collector_for_socket(request, fake, base_url=bad_url)
    with pytest.raises(CollectorError) as caught:
        collector.collect(request, before_send=lambda: pytest.fail("不能授权"))
    assert caught.value.failure.code == Code.COLLECTOR_CONFIGURATION_INVALID
    assert caught.value.failure.external_call_state == State.NOT_STARTED
    assert fake.sent == []


@pytest.mark.parametrize("ip", ["127.0.0.1", "10.0.0.1", "169.254.169.254", "fd00::1", "::1"])
def test_any_private_dns_answer_blocks_whole_set_before_connect(ip):
    request = make_request()
    fake = FakeSocket(peer_ip="93.184.216.34", response=ok_response(answer_bytes()))

    def resolve(_host, port, **_kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port)),
            (
                socket.AF_INET6 if ":" in ip else socket.AF_INET,
                socket.SOCK_STREAM,
                6,
                "",
                (ip, port),
            ),
        ]

    collector = collector_for_socket(request, fake, resolver=resolve)
    with pytest.raises(CollectorError) as caught:
        collector.collect(request, before_send=lambda: pytest.fail("不能授权"))
    assert caught.value.failure.stage == CollectorStage.CONFIGURATION
    assert fake.sent == []


def test_peer_mismatch_never_authorizes_or_sends_and_releases_socket():
    request = make_request()
    fake = FakeSocket(peer_ip="10.0.0.1", response=ok_response(answer_bytes()))
    collector = collector_for_socket(request, fake)
    with pytest.raises(CollectorError) as caught:
        collector.collect(request, before_send=lambda: pytest.fail("不能授权"))
    assert caught.value.failure.stage == CollectorStage.CONNECT
    assert caught.value.failure.external_call_state == State.NOT_STARTED
    assert fake.closed and fake.sent == []


@pytest.mark.parametrize("error", [OSError("connect"), TimeoutError("connect")])
def test_connect_failure_is_distinct_from_sent_unknown(error):
    request = make_request()

    def connect(_address, _timeout):
        raise error

    collector = OpenAICompatibleGeoCollector(
        **configuration(
            request,
            transport=PinnedHTTPTransport(
                allow_local_http=False,
                resolver=resolver_for("93.184.216.34"),
                connector=connect,
            ),
        )
    )
    with pytest.raises(CollectorError) as caught:
        collector.collect(request, before_send=lambda: pytest.fail("不能授权"))
    assert caught.value.failure.code == (
        Code.PROVIDER_TIMEOUT if isinstance(error, TimeoutError) else Code.PROVIDER_UNAVAILABLE
    )
    assert caught.value.failure.external_call_state == State.NOT_STARTED
    assert caught.value.failure.retryability == CollectorRetryability.SAFE_BEFORE_SEND


def test_send_exception_is_unknown_and_never_switches_addresses():
    request = make_request()
    fake = FakeSocket(peer_ip="93.184.216.34", response=b"", send_error=OSError("partial"))
    calls = []
    collector = collector_for_socket(
        request, fake, resolver=resolver_for("93.184.216.34", "93.184.216.35")
    )
    with pytest.raises(CollectorError) as caught:
        collector.collect(request, before_send=lambda: calls.append("authorized"))
    assert caught.value.failure.code == Code.COLLECTOR_UNKNOWN_OUTCOME
    assert caught.value.failure.stage == CollectorStage.SEND
    assert caught.value.failure.external_call_state == State.UNKNOWN
    assert len(fake.sent) == len(calls) == 1 and fake.closed


@pytest.mark.parametrize(
    "response",
    [
        b"HTTP/1.1 200 OK\r\nContent-Length: 4097\r\n\r\n",
        b"HTTP/1.1 200 OK\r\n\r\n" + b"x" * 4097,
        b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1001\r\n"
        + b"x" * 4097
        + b"\r\n0\r\n\r\n",
    ],
)
def test_per_request_limit_covers_declared_eof_and_chunked_bodies(response):
    request = make_request()
    fake = FakeSocket(peer_ip="93.184.216.34", response=response)
    with pytest.raises(CollectorError) as caught:
        collector_for_socket(request, fake).collect(request, before_send=lambda: None)
    assert caught.value.failure.code == Code.PROVIDER_RESPONSE_TOO_LARGE
    assert caught.value.failure.external_call_state == State.SENT
    assert fake.closed


def test_exact_response_limit_is_valid_but_truncated_declared_body_is_unknown():
    request = replace(make_request(), max_response_bytes=len(answer_bytes()))
    fake = FakeSocket(peer_ip="93.184.216.34", response=ok_response(answer_bytes()))
    assert (
        collector_for_socket(request, fake).collect(request, before_send=lambda: None).answer_text
    )
    fake = FakeSocket(
        peer_ip="93.184.216.34",
        response=(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n" + answer_bytes()),
    )
    request = replace(request, max_response_bytes=100)
    with pytest.raises(CollectorError) as caught:
        collector_for_socket(request, fake).collect(request, before_send=lambda: None)
    assert caught.value.failure.code == Code.COLLECTOR_UNKNOWN_OUTCOME
    assert caught.value.failure.external_call_state == State.UNKNOWN


def test_callback_exception_is_not_mapped_as_network_failure():
    request = make_request()
    fake = FakeSocket(peer_ip="93.184.216.34", response=ok_response(answer_bytes()))
    rejected = OSError("授权存储失败")

    def reject():
        raise rejected

    with pytest.raises(OSError) as caught:
        collector_for_socket(request, fake).collect(request, before_send=reject)
    assert caught.value is rejected
    assert fake.sent == [] and fake.closed


def test_transport_error_from_callback_is_the_original_authorization_failure():
    request = make_request()
    fake = FakeSocket(peer_ip="93.184.216.34", response=ok_response(answer_bytes()))
    rejected = PinnedTransportError(
        "AI_PROVIDER_TIMEOUT", "授权方失败", 504, stage="CONNECT", request_started=False
    )

    def reject():
        raise rejected

    with pytest.raises(PinnedTransportError) as caught:
        collector_for_socket(request, fake).collect(request, before_send=reject)
    assert caught.value is rejected
    assert fake.sent == [] and fake.closed


@pytest.mark.parametrize("status", [600, 999])
def test_invalid_http_status_has_stable_completed_error(status):
    request = make_request()
    fake = FakeSocket(
        peer_ip="93.184.216.34",
        response=(f"HTTP/1.1 {status} Invalid\r\nContent-Length: 0\r\n\r\n".encode()),
    )
    with pytest.raises(CollectorError) as caught:
        collector_for_socket(request, fake).collect(request, before_send=lambda: None)
    assert caught.value.failure.code == Code.PROVIDER_RESPONSE_INVALID
    assert caught.value.failure.stage == CollectorStage.RECEIVE
    assert caught.value.failure.external_call_state == State.COMPLETED
    assert caught.value.failure.provider_status is None
    assert len(fake.sent) == 1 and fake.closed


@pytest.mark.parametrize(
    "field",
    [
        "answer",
        "model",
        "source_product",
        "source_version",
        "request_id",
        "citation_url",
        "citation_title",
    ],
)
def test_provider_cannot_return_actual_credentials_in_any_retained_field(field):
    request = make_request()
    secret = test_secret("api")
    payload = json.loads(answer_bytes())
    response_headers = b""
    if field == "answer":
        payload["choices"][0]["message"]["content"] = f"原文包含 {secret}"
    elif field == "request_id":
        response_headers = f"X-Request-ID: {secret}\r\n".encode()
    elif field.startswith("citation_"):
        payload["citations"] = [
            {
                "url": f"https://example.com/?credential={secret}"
                if field == "citation_url"
                else "https://example.com/",
                "title": secret if field == "citation_title" else None,
                "position": 1,
            }
        ]
    else:
        payload[field] = secret
    body = json.dumps(payload).encode()
    fake = FakeSocket(
        peer_ip="93.184.216.34",
        response=(
            b"HTTP/1.1 200 OK\r\n"
            + response_headers
            + f"Content-Length: {len(body)}\r\n\r\n".encode()
            + body
        ),
    )
    with pytest.raises(CollectorError) as caught:
        collector_for_socket(request, fake, api_key=secret).collect(
            request, before_send=lambda: None
        )
    assert caught.value.failure.code == Code.PROVIDER_RESPONSE_INVALID
    assert caught.value.failure.stage == CollectorStage.PARSE
    assert caught.value.failure.external_call_state == State.COMPLETED
    assert_secrets_absent([str(caught.value), repr(caught.value)], [secret])


@pytest.mark.parametrize(
    "encoding", ["plain", "url", "url-lower", "url-wire", "json", "base64", "base64-wire"]
)
def test_sensitive_header_reflections_are_rejected_in_retained_text(encoding):
    request = make_request()
    secret = test_secret("header") + '/quoted"é'
    values = {
        "plain": secret,
        "url": quote(secret, safe=""),
        "url-wire": quote_from_bytes(secret.encode("latin-1"), safe=""),
        "url-lower": quote(secret, safe="").replace("%2F", "%2f").replace("%C3%A9", "%c3%a9"),
        "json": json.dumps(secret, ensure_ascii=True)[1:-1],
        "base64": b64encode(secret.encode()).decode(),
        "base64-wire": b64encode(secret.encode("latin-1")).decode(),
    }
    body = json.dumps({"choices": [{"message": {"content": values[encoding]}}]}).encode()
    fake = FakeSocket(peer_ip="93.184.216.34", response=ok_response(body))
    with pytest.raises(CollectorError):
        collector_for_socket(request, fake, sensitive_headers={"X-Secret": secret}).collect(
            request, before_send=lambda: None
        )


@pytest.mark.parametrize("url", ["https://☃.test/v1", "https://provider.test/\ud800"])
def test_unencodable_url_configuration_fails_before_callback_with_stable_error(url):
    request = make_request()
    fake = FakeSocket(peer_ip="93.184.216.34", response=ok_response(answer_bytes()))
    collector = collector_for_socket(request, fake, base_url=url)
    with pytest.raises(CollectorError) as caught:
        collector.collect(request, before_send=lambda: pytest.fail("不能授权"))
    assert caught.value.failure.code == Code.COLLECTOR_CONFIGURATION_INVALID
    assert caught.value.failure.external_call_state == State.NOT_STARTED
    assert fake.sent == []
    assert fake.closed if "☃" in url else not fake.closed


@pytest.mark.parametrize("case", ["trusted", "untrusted", "wrong-hostname"])
def test_real_local_tls_checks_ca_sni_host_before_send(case, tmp_path, monkeypatch):
    hostname = "provider.test"
    certificate_name = "wrong.test" if case == "wrong-hostname" else hostname
    ca, certificate, key = write_local_ca(tmp_path, certificate_name)
    server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_context.load_cert_chain(certificate, key)
    sni_names = []
    server_context.set_servername_callback(lambda _socket, name, _context: sni_names.append(name))
    client_context = ssl.create_default_context(cafile=None if case == "untrusted" else str(ca))
    request = make_request()
    host_headers = []
    with running_geo_fake() as provider:
        provider.socket = server_context.wrap_socket(provider.socket, server_side=True)

        def connect(_address, timeout):
            connection = socket.create_connection(provider.server_address, timeout=timeout)
            return cast(socket.socket, PeerOverrideSocket(connection, "93.184.216.34"))

        def wrap(connection, name):
            tls = client_context.wrap_socket(connection, server_hostname=name)
            send = tls.sendall

            def capture(data):
                host_headers.extend(
                    line for line in data.split(b"\r\n") if line.startswith(b"Host:")
                )
                send(data)

            monkeypatch.setattr(tls, "sendall", capture)
            return tls

        transport = PinnedHTTPTransport(
            allow_local_http=False,
            resolver=resolver_for("93.184.216.34"),
            connector=connect,
            tls_wrapper=wrap,
        )
        collector = OpenAICompatibleGeoCollector(
            **configuration(
                request,
                transport=transport,
                headers={"X-GEO-Attempt-ID": str(request.run_id)},
            )
        )
        callbacks = []

        def authorize():
            assert sni_names == [hostname]
            assert provider.state.snapshot(request.run_id)["count"] == 0
            callbacks.append("authorized")

        if case == "trusted":
            collector.collect(request, before_send=authorize)
            assert callbacks == ["authorized"]
            stats = provider.state.snapshot(request.run_id)
            assert stats["count"] == 1
            assert host_headers == [b"Host: provider.test"]
        else:
            with pytest.raises(CollectorError) as caught:
                collector.collect(request, before_send=authorize)
            assert caught.value.failure.stage == CollectorStage.CONNECT
            assert caught.value.failure.external_call_state == State.NOT_STARTED
            assert callbacks == [] and provider.state.snapshot(request.run_id)["count"] == 0
