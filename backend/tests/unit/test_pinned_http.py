"""固定解析结果、TCP 对端校验和单次发送边界测试。"""

from __future__ import annotations

import io
import socket

import pytest

from app.errors import AppError
from app.services.pinned_http import PinnedHTTPTransport, ResolvedAddress


def resolver_for(*ips: str):
    """返回稳定的测试解析器，避免访问真实 DNS。"""

    def resolve(_host: str, port: int, **_kwargs: object):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)) for ip in ips
        ]

    return resolve


class FakeSocket:
    """提供 HTTPResponse 所需的最小 socket 表面并记录敏感发送时点。"""

    def __init__(self, *, peer_ip: str, response: bytes, send_error: OSError | None = None):
        self.peer_ip = peer_ip
        self.response = response
        self.send_error = send_error
        self.sent: list[bytes] = []
        self.closed = False

    def getpeername(self) -> tuple[str, int]:
        return self.peer_ip, 443

    def sendall(self, value: bytes) -> None:
        self.sent.append(value)
        if self.send_error is not None:
            raise self.send_error

    def makefile(self, _mode: str):
        return io.BytesIO(self.response)

    def close(self) -> None:
        self.closed = True


def ok_response(body: bytes = b"{}") -> bytes:
    return (
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
        + f"Content-Length: {len(body)}\r\n\r\n".encode()
        + body
    )


def test_public_https_keeps_original_sni_host_and_uses_resolved_sockaddr() -> None:
    fake = FakeSocket(peer_ip="93.184.216.34", response=ok_response())
    connected: list[ResolvedAddress] = []
    sni_names: list[str] = []

    def connect(address: ResolvedAddress, _timeout: float):
        connected.append(address)
        return fake  # type: ignore[return-value]

    def wrap(connection: socket.socket, hostname: str):
        sni_names.append(hostname)
        return connection

    transport = PinnedHTTPTransport(
        allow_local_http=False,
        resolver=resolver_for("93.184.216.34"),
        connector=connect,
        tls_wrapper=wrap,
    )
    transport.request(
        method="POST",
        base_url="https://provider.invalid/openai/v1",
        suffix="chat/completions",
        headers={"Authorization": "Bearer secret"},
        timeout_seconds=10,
        body=b"{}",
    )

    assert connected[0].sockaddr == ("93.184.216.34", 443)
    assert sni_names == ["provider.invalid"]
    wire = fake.sent[0]
    assert wire.startswith(b"POST /openai/v1/chat/completions HTTP/1.1\r\n")
    assert b"Host: provider.invalid\r\n" in wire
    assert b"Authorization: Bearer secret\r\n" in wire


def test_request_never_resolves_hostname_a_second_time() -> None:
    fake = FakeSocket(peer_ip="93.184.216.34", response=ok_response())
    resolutions = 0

    def resolve(_host: str, port: int, **_kwargs: object):
        nonlocal resolutions
        resolutions += 1
        ip = "93.184.216.34" if resolutions == 1 else "10.0.0.8"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]

    transport = PinnedHTTPTransport(
        allow_local_http=False,
        resolver=resolve,
        connector=lambda _address, _timeout: fake,  # type: ignore[arg-type,return-value]
        tls_wrapper=lambda connection, _hostname: connection,
    )
    transport.request(
        method="GET",
        base_url="https://provider.invalid/v1",
        suffix="models",
        headers={"Authorization": "Bearer secret"},
        timeout_seconds=10,
        body=None,
    )
    assert resolutions == 1
    assert len(fake.sent) == 1


def test_mixed_public_and_private_resolution_is_rejected_before_connect() -> None:
    connected = False

    def connect(_address: ResolvedAddress, _timeout: float):
        nonlocal connected
        connected = True
        raise AssertionError("不应连接")

    transport = PinnedHTTPTransport(
        allow_local_http=False,
        resolver=resolver_for("93.184.216.34", "10.0.0.8"),
        connector=connect,
    )
    with pytest.raises(AppError, match="非公网"):
        transport.request(
            method="GET",
            base_url="https://provider.invalid/v1",
            suffix="models",
            headers={"Authorization": "Bearer secret"},
            timeout_seconds=10,
            body=None,
        )
    assert not connected


def test_peer_mismatch_blocks_authorization_before_any_http_byte() -> None:
    fake = FakeSocket(peer_ip="10.0.0.8", response=ok_response())
    transport = PinnedHTTPTransport(
        allow_local_http=False,
        resolver=resolver_for("93.184.216.34"),
        connector=lambda _address, _timeout: fake,  # type: ignore[arg-type,return-value]
    )
    with pytest.raises(AppError, match="不在批准集合"):
        transport.request(
            method="GET",
            base_url="https://provider.invalid/v1",
            suffix="models",
            headers={"Authorization": "Bearer secret"},
            timeout_seconds=10,
            body=None,
        )
    assert fake.sent == []


def test_connect_may_try_next_approved_ip_only_before_http_send() -> None:
    fake = FakeSocket(peer_ip="93.184.216.35", response=ok_response())
    attempts: list[str] = []

    def connect(address: ResolvedAddress, _timeout: float):
        attempts.append(address.ip)
        if address.ip == "93.184.216.34":
            raise OSError("first unavailable")
        return fake  # type: ignore[return-value]

    transport = PinnedHTTPTransport(
        allow_local_http=False,
        resolver=resolver_for("93.184.216.34", "93.184.216.35"),
        connector=connect,
        tls_wrapper=lambda connection, _hostname: connection,
    )
    transport.request(
        method="GET",
        base_url="https://provider.invalid/v1",
        suffix="models",
        headers={"Authorization": "Bearer secret"},
        timeout_seconds=10,
        body=None,
    )
    assert attempts == ["93.184.216.34", "93.184.216.35"]
    assert len(fake.sent) == 1


def test_send_failure_never_switches_to_second_ip() -> None:
    fake = FakeSocket(
        peer_ip="93.184.216.34",
        response=ok_response(),
        send_error=OSError("send failed"),
    )
    attempts: list[str] = []

    def connect(address: ResolvedAddress, _timeout: float):
        attempts.append(address.ip)
        return fake  # type: ignore[return-value]

    transport = PinnedHTTPTransport(
        allow_local_http=False,
        resolver=resolver_for("93.184.216.34", "93.184.216.35"),
        connector=connect,
        tls_wrapper=lambda connection, _hostname: connection,
    )
    with pytest.raises(AppError, match="网络请求失败"):
        transport.request(
            method="POST",
            base_url="https://provider.invalid/v1",
            suffix="chat/completions",
            headers={"Authorization": "Bearer secret"},
            timeout_seconds=10,
            body=b"{}",
        )
    assert attempts == ["93.184.216.34"]


def test_response_size_limit_rejects_before_reading_body() -> None:
    fake = FakeSocket(
        peer_ip="127.0.0.1",
        response=b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\n{} ",
    )
    transport = PinnedHTTPTransport(
        allow_local_http=True,
        max_response_bytes=2,
        resolver=resolver_for("127.0.0.1"),
        connector=lambda _address, _timeout: fake,  # type: ignore[arg-type,return-value]
    )
    with pytest.raises(AppError, match="大小上限"):
        transport.request(
            method="GET",
            base_url="http://provider.invalid/v1",
            suffix="models",
            headers={"Authorization": "Bearer secret"},
            timeout_seconds=10,
            body=None,
        )
