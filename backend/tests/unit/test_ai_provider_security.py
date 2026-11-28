"""AI 渠道出站 SSRF、DNS Rebinding、自定义 HTTPS 端口与流式响应上限安全测试。"""

from __future__ import annotations

import gzip
import json
import threading
import time
import zlib
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import httpx2
import pytest

from app.collectors.errors import CollectorError, CollectorStage
from app.collectors.openai_compatible import OpenAICompatibleGeoCollector
from app.errors import AppError
from app.schemas.geo_runs import GeoExternalCallState as State
from app.schemas.geo_runs import GeoRunErrorCode as Code
from app.services.ai_provider import AIProvider, validate_base_url
from tests.geo_openai_support import configuration, make_request

BASE_ARGS: dict[str, Any] = {
    "base_url": "https://api.example.com/v1",
    "api_key": "fake-security-key",
    "headers": {"X-Custom": "ok"},
    "timeout_seconds": 5,
}


@pytest.mark.parametrize(
    "bad_url",
    [
        "https://127.0.0.1/v1",
        "https://127.0.0.1:8443/v1",
        "https://10.0.0.5/v1",
        "https://172.16.0.1/v1",
        "https://192.168.1.1/v1",
        "https://100.64.0.1/v1",
        "https://169.254.169.254/latest/meta-data",
        "https://0.0.0.0/v1",
        "https://0x7f000001/v1",
        "https://2130706433/v1",
        "https://[::1]/v1",
        "https://[fc00::1]/v1",
        "https://[fe80::1]/v1",
        "https://[::ffff:127.0.0.1]/v1",
        "https://[::ffff:169.254.169.254]/v1",
        "https://[64:ff9b::a9fe:a9fe]/v1",
        "https://[64:ff9b:1::1]/v1",
        "https://[2001::1]/v1",
        "https://[2002:c0a8:0101::1]/v1",
        "https://198.18.0.1/v1",
        "https://localhost/v1",
        "https://sub.localhost/v1",
        "https://service.local/v1",
        "https://metadata.internal/v1",
        "https://intranet/v1",
        "https://api.example.com:0/v1",
    ],
)
def test_validate_base_url_blocks_static_non_public_targets(bad_url: str) -> None:
    for allow_local in (False, True):
        with pytest.raises(AppError) as caught:
            validate_base_url(bad_url, allow_local_http=allow_local)
        assert (caught.value.code, caught.value.status_code) == ("AI_URL_FORBIDDEN", 422)


@pytest.mark.parametrize(
    "resolved_ips",
    [
        ["127.0.0.1"],
        ["10.1.2.3"],
        ["172.16.0.1"],
        ["192.168.10.2"],
        ["100.64.0.1"],
        ["169.254.169.254"],
        ["0.0.0.0"],
        ["::1"],
        ["fc00::1"],
        ["fd12:3456::1"],
        ["fe80::1"],
        ["::ffff:127.0.0.1"],
        ["::ffff:169.254.169.254"],
        ["64:ff9b::a9fe:a9fe"],
        ["64:ff9b:1::1"],
        ["2001::1"],
        ["2002:c0a8:0101::1"],
        ["198.18.0.1"],
        ["93.184.216.34", "192.168.1.10"],
    ],
)
def test_ai_provider_blocks_dns_resolving_to_non_public_or_mixed_ips(
    resolved_ips: list[str],
) -> None:
    def forbid_send(request: httpx2.Request) -> httpx2.Response:
        pytest.fail("非公网 DNS 解析结果不得触发网络发送")

    provider = AIProvider(
        allow_local_http=False,
        transport=httpx2.MockTransport(forbid_send),
        resolve_host=lambda _host, _port: resolved_ips,
    )
    with pytest.raises(AppError) as caught:
        provider.discover_models(**BASE_ARGS)
    assert (caught.value.code, caught.value.status_code) == ("AI_URL_FORBIDDEN", 422)


def test_ai_provider_maps_dns_failure_to_unavailable_without_sending() -> None:
    def fail_dns(_host: str, _port: int) -> list[str]:
        raise OSError("dns failure")

    provider = AIProvider(
        allow_local_http=False,
        transport=httpx2.MockTransport(lambda _req: pytest.fail("DNS 失败不得发送")),
        resolve_host=fail_dns,
    )
    with pytest.raises(AppError) as caught:
        provider.discover_models(**BASE_ARGS)
    assert (caught.value.code, caught.value.status_code) == ("AI_PROVIDER_UNAVAILABLE", 502)


def test_dns_rebinding_single_lookup_pins_ip_host_and_sni_for_custom_https_ports() -> None:
    lookups = 0

    def rebinding_resolver(host: str, port: int) -> list[str]:
        nonlocal lookups
        lookups += 1
        assert host == "gateway.example.com"
        assert port == 8443
        return ["93.184.216.34"] if lookups == 1 else ["127.0.0.1"]

    sent: list[httpx2.Request] = []

    def capture(request: httpx2.Request) -> httpx2.Response:
        sent.append(request)
        return httpx2.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    provider = AIProvider(
        allow_local_http=False,
        transport=httpx2.MockTransport(capture),
        resolve_host=rebinding_resolver,
    )
    result = provider.chat_completion(
        base_url="https://gateway.example.com:8443/custom/v1",
        api_key="fake-caf\u00e9",
        headers={"X-Latin": "caf\u00e9"},
        timeout_seconds=15,
        model_id="test-model",
        messages=[{"role": "user", "content": "hi"}],
        request_parameters={},
    )
    assert result.content == "ok"
    assert lookups == 1
    (request,) = sent
    assert str(request.url) == "https://93.184.216.34:8443/custom/v1/chat/completions"
    assert request.headers["Host"] == "gateway.example.com:8443"
    assert request.headers["Accept-Encoding"] == "identity"
    assert request.extensions["sni_hostname"] == "gateway.example.com"
    assert (b"Authorization", b"Bearer fake-caf\xe9") in request.headers.raw
    assert (b"X-Latin", b"caf\xe9") in request.headers.raw


def test_ipv6_pinned_target_formats_brackets_and_sni_with_custom_port() -> None:
    sent: list[httpx2.Request] = []

    def capture(request: httpx2.Request) -> httpx2.Response:
        sent.append(request)
        return httpx2.Response(200, json={"data": [{"id": "m1"}]})

    provider = AIProvider(
        allow_local_http=False,
        transport=httpx2.MockTransport(capture),
        resolve_host=lambda _h, _p: ["2606:2800:220:1:248:1893:25c8:1946"],
    )
    assert (
        provider.discover_models(
            base_url="https://v6.example.com:9443/v1",
            api_key="fake-key",
            headers={},
            timeout_seconds=10,
        )
        == ["m1"]
    )
    (request,) = sent
    assert str(request.url) == "https://[2606:2800:220:1:248:1893:25c8:1946]:9443/v1/models"
    assert request.headers["Host"] == "v6.example.com:9443"
    assert request.extensions["sni_hostname"] == "v6.example.com"


def test_geo_collector_blocks_ssrf_before_send_authorization() -> None:
    request = make_request()
    provider = AIProvider(
        allow_local_http=False,
        transport=httpx2.MockTransport(lambda _req: pytest.fail("SSRF 不得发送")),
        resolve_host=lambda _h, _p: ["169.254.169.254"],
    )
    collector = OpenAICompatibleGeoCollector(
        **configuration(request, provider=provider, base_url="https://rebind.example.com/v1")
    )
    with pytest.raises(CollectorError) as caught:
        collector.collect(request, before_send=lambda: pytest.fail("SSRF 阻断前不得授权"))
    assert caught.value.failure.code == Code.COLLECTOR_CONFIGURATION_INVALID
    assert caught.value.failure.stage == CollectorStage.CONFIGURATION
    assert caught.value.failure.external_call_state == State.NOT_STARTED


def test_content_length_preflight_aborts_before_reading_stream() -> None:
    iterated = False
    closed = False

    class CountingStream(httpx2.SyncByteStream):
        def __iter__(self) -> Iterator[bytes]:
            nonlocal iterated
            iterated = True
            yield b"x" * 1024

        def close(self) -> None:
            nonlocal closed
            closed = True

    transport = httpx2.MockTransport(
        lambda _req: httpx2.Response(
            200,
            headers={"Content-Length": "99999999", "Content-Type": "application/json"},
            stream=CountingStream(),
        )
    )
    provider = AIProvider(allow_local_http=False, transport=transport)
    with pytest.raises(AppError) as caught:
        provider.discover_models(**BASE_ARGS, max_response_bytes=1024)
    assert (caught.value.code, caught.value.status_code) == ("AI_RESPONSE_TOO_LARGE", 502)
    assert iterated is False
    assert closed is True


@pytest.mark.parametrize("encoding", ["gzip", "deflate"])
def test_compressed_bomb_is_stopped_during_bounded_decompression(encoding: str) -> None:
    # 1 MiB 零字节压缩后仅约 1 KiB，但解压上限为 4 KiB，必须在解压期即刻截断。
    raw_bomb = b"0" * (1024 * 1024)
    compressed = gzip.compress(raw_bomb) if encoding == "gzip" else zlib.compress(raw_bomb)
    assert len(compressed) < 4096
    closed = False

    class BombStream(httpx2.SyncByteStream):
        def __iter__(self) -> Iterator[bytes]:
            yield compressed

        def close(self) -> None:
            nonlocal closed
            closed = True

    transport = httpx2.MockTransport(
        lambda _req: httpx2.Response(
            200,
            headers={"Content-Encoding": encoding, "Content-Type": "application/json"},
            stream=BombStream(),
        )
    )
    provider = AIProvider(allow_local_http=False, transport=transport)
    with pytest.raises(AppError) as caught:
        provider.chat_completion(
            **BASE_ARGS,
            model_id="m",
            messages=[{"role": "user", "content": "hi"}],
            request_parameters={},
            max_response_bytes=4096,
        )
    assert (caught.value.code, caught.value.status_code) == ("AI_RESPONSE_TOO_LARGE", 502)
    assert closed is True


def test_valid_small_gzip_response_within_limit_is_accepted() -> None:
    payload = json.dumps({"data": [{"id": "gzip-model"}]}).encode("utf-8")
    compressed = gzip.compress(payload)
    transport = httpx2.MockTransport(
        lambda _req: httpx2.Response(
            200,
            headers={"Content-Encoding": "gzip", "Content-Type": "application/json"},
            content=compressed,
        )
    )
    provider = AIProvider(allow_local_http=False, transport=transport)
    assert provider.discover_models(**BASE_ARGS, max_response_bytes=4096) == ["gzip-model"]


def test_unsupported_content_encoding_is_rejected_for_provider_and_geo_collector() -> None:
    transport = httpx2.MockTransport(
        lambda _req: httpx2.Response(
            200,
            headers={"Content-Encoding": "br", "Content-Type": "application/json"},
            content=b"compressed",
        )
    )
    provider = AIProvider(allow_local_http=False, transport=transport)
    with pytest.raises(AppError) as caught:
        provider.discover_models(**BASE_ARGS)
    assert (caught.value.code, caught.value.status_code) == ("AI_RESPONSE_INVALID", 502)

    geo_request = make_request()
    collector = OpenAICompatibleGeoCollector(**configuration(geo_request, provider=provider))
    with pytest.raises(CollectorError) as geo_caught:
        collector.collect(geo_request, before_send=lambda: None)
    assert geo_caught.value.failure.code == Code.PROVIDER_RESPONSE_INVALID
    assert geo_caught.value.failure.stage == CollectorStage.RECEIVE
    assert geo_caught.value.failure.external_call_state == State.COMPLETED


def test_huge_5xx_error_body_is_aborted_at_response_limit() -> None:
    chunks_yielded = 0

    class HugeErrorStream(httpx2.SyncByteStream):
        def __iter__(self) -> Iterator[bytes]:
            nonlocal chunks_yielded
            for _ in range(100):
                chunks_yielded += 1
                yield b"E" * 1024

    transport = httpx2.MockTransport(
        lambda _req: httpx2.Response(
            500,
            headers={"Content-Type": "text/plain"},
            stream=HugeErrorStream(),
        )
    )
    provider = AIProvider(allow_local_http=False, transport=transport)
    with pytest.raises(AppError) as caught:
        provider.test_connection(
            **BASE_ARGS, model_id="m", request_parameters={}, max_response_bytes=4096
        )
    assert (caught.value.code, caught.value.status_code) == ("AI_RESPONSE_TOO_LARGE", 502)
    assert chunks_yielded <= 5


@contextmanager
def _streaming_http_server(
    *, mode: str, total_chunks: int = 200, chunk_size: int = 4096, delay_per_chunk: float = 0.0
) -> Iterator[tuple[str, dict[str, int]]]:
    stats = {"chunks_written": 0, "disconnected_early": 0}
    stop_event = threading.Event()

    class StreamHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: Any) -> None:
            pass

        def _drain_request(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 0:
                self.rfile.read(length)

        def _serve(self) -> None:
            self._drain_request()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Transfer-Encoding", "chunked")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            payload = b"a" * chunk_size
            frame = f"{len(payload):x}\r\n".encode("ascii") + payload + b"\r\n"
            try:
                for _ in range(total_chunks):
                    if stop_event.is_set():
                        return
                    if delay_per_chunk > 0:
                        stop_event.wait(delay_per_chunk)
                    self.wfile.write(frame)
                    self.wfile.flush()
                    stats["chunks_written"] += 1
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                stats["disconnected_early"] = 1

        def do_GET(self) -> None:
            self._serve()

        def do_POST(self) -> None:
            self._serve()

    server = ThreadingHTTPServer(("127.0.0.1", 0), StreamHandler)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02})
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", stats
    finally:
        stop_event.set()
        server.shutdown()
        server.server_close()
        with suppress(RuntimeError):
            thread.join(timeout=3)


def test_live_chunked_oversize_stream_aborts_mid_flight_without_full_buffering() -> None:
    # 服务端计划发送 256 * 4 KiB = 1 MiB，客户端限制 8 KiB；必须在中途断连，不得缓冲全量。
    with _streaming_http_server(mode="oversize", total_chunks=256, chunk_size=4096) as (
        base_url,
        stats,
    ):
        provider = AIProvider(allow_local_http=True)
        with pytest.raises(AppError) as caught:
            provider.chat_completion(
                base_url=base_url,
                api_key="fake-key",
                headers={},
                timeout_seconds=5,
                model_id="m",
                messages=[{"role": "user", "content": "hi"}],
                request_parameters={},
                max_response_bytes=8192,
            )
        assert (caught.value.code, caught.value.status_code) == ("AI_RESPONSE_TOO_LARGE", 502)
        # 留短暂窗口让服务端线程感知对端关闭
        deadline = time.monotonic() + 1.0
        while stats["disconnected_early"] == 0 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert stats["chunks_written"] < 128

    with _streaming_http_server(mode="oversize", total_chunks=256, chunk_size=4096) as (
        base_url,
        geo_stats,
    ):
        request = replace(make_request(), max_response_bytes=8192)
        collector = OpenAICompatibleGeoCollector(
            **configuration(
                request,
                base_url=base_url,
                allow_local_http=True,
                environment="test",
            )
        )
        with pytest.raises(CollectorError) as geo_caught:
            collector.collect(request, before_send=lambda: None)
        assert geo_caught.value.failure.code == Code.PROVIDER_RESPONSE_TOO_LARGE
        assert geo_caught.value.failure.stage == CollectorStage.RECEIVE
        assert geo_caught.value.failure.external_call_state == State.COMPLETED
        assert geo_stats["chunks_written"] < 128


def test_slow_drip_stream_hits_overall_wall_clock_deadline() -> None:
    # 每 0.35s 发送 16 字节（远小于单次 read 超时 1s），验证整体 deadline 仍会按时中止。
    with _streaming_http_server(
        mode="slow", total_chunks=20, chunk_size=16, delay_per_chunk=0.35
    ) as (base_url, _stats):
        started = time.monotonic()
        with pytest.raises(AppError) as caught:
            AIProvider(allow_local_http=True).discover_models(
                base_url=base_url,
                api_key="fake-key",
                headers={},
                timeout_seconds=1,
                max_response_bytes=65536,
            )
        elapsed = time.monotonic() - started
        assert (caught.value.code, caught.value.status_code) == ("AI_PROVIDER_TIMEOUT", 504)
        assert elapsed < 3.0
