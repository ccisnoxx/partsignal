"""GEO-402 本地 TCP provider；独立测试进程，不接入业务应用或生产 Registry。"""

from __future__ import annotations

import argparse
import hashlib
import json
import socket
import threading
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from dataclasses import asdict, dataclass
from enum import StrEnum
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Annotated, Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class FakeMode(StrEnum):
    SUCCESS = "success"
    CITATIONS = "citations"
    RATE_LIMIT = "429"
    TIMEOUT = "timeout"
    SLOW_BODY = "slow_body"
    DISCONNECT = "disconnect"
    REDIRECT = "redirect"
    OVERSIZE = "oversize"
    OVERSIZE_CHUNKED = "oversize_chunked"
    INVALID_RESPONSE = "invalid_response"
    INVALID_JSON = "invalid_json"
    EMPTY_ANSWER = "empty_answer"
    AUTH_401 = "401"
    AUTH_403 = "403"
    UNAVAILABLE = "503"


class FakeScenario(BaseModel):
    """测试控制协议；不接受 URL、任意 Header、凭据或待执行代码。"""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, hide_input_in_errors=True)
    mode: FakeMode = FakeMode.SUCCESS
    delay_seconds: Annotated[float, Field(gt=0, le=5)] = 1.5
    response_bytes: Annotated[int, Field(strict=True, ge=1, le=4194304)] = 2097153
    answer_text: Annotated[str, Field(min_length=1, max_length=1048576)] = (
        "仅供测试的虚构回答；不得用于真实选型。"
    )
    web_search_observed: bool | None = None
    partial_usage: bool = False
    reported_cost: bool = False
    echo_sensitive: bool = False


@dataclass(frozen=True)
class RequestRecord:
    body_sha256: str
    body_bytes: int


class FakeProviderState:
    """唯一测试状态 owner；计数如实追加，绝不通过去重掩盖重复调用。"""

    def __init__(self, default: FakeScenario) -> None:
        self._default = default
        self._scenarios: dict[UUID, FakeScenario] = {}
        self._calls: dict[UUID, list[RequestRecord]] = {}
        self._redirect_hits = 0
        self._lock = threading.Lock()
        self.stopping = threading.Event()

    def configure(self, attempt_id: UUID, scenario: FakeScenario) -> None:
        with self._lock:
            self._scenarios[attempt_id] = scenario

    def record(self, attempt_id: UUID, body: bytes) -> FakeScenario:
        with self._lock:
            self._calls.setdefault(attempt_id, []).append(
                RequestRecord(hashlib.sha256(body).hexdigest(), len(body))
            )
            return self._scenarios.get(attempt_id, self._default)

    def redirect_hit(self) -> None:
        with self._lock:
            self._redirect_hits += 1

    def snapshot(self, attempt_id: UUID) -> dict[str, Any]:
        with self._lock:
            records = self._calls.get(attempt_id, [])
            return {
                "attempt_id": str(attempt_id),
                "count": len(records),
                "requests": [asdict(record) for record in records],
                "redirect_hits": self._redirect_hits,
            }


class GeoFakeServer(ThreadingHTTPServer):
    # 计数用例突发发送 12 次请求；默认 backlog=5 会把 accept 调度延迟伪装成网络故障。
    request_queue_size = 12
    # join 所有已接受的连接；timeout/delay 在停止时唤醒，不留下孤儿请求线程。
    daemon_threads = False

    def __init__(self, port: int = 0, *, scenario: FakeScenario | None = None) -> None:
        self.state = FakeProviderState(scenario or FakeScenario())
        super().__init__(("127.0.0.1", port), _Handler)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server_port}"

    def handle_error(
        self, request: socket.socket | tuple[bytes, socket.socket], client_address: Any
    ) -> None:
        # 客户端超时/断开是脚本化故障；不打印可能带请求数据的 traceback。
        print("GEO fake provider 请求处理失败", flush=True)

    def server_close(self) -> None:
        self.state.stopping.set()
        super().server_close()


class _Handler(BaseHTTPRequestHandler):
    server: GeoFakeServer
    protocol_version = "HTTP/1.1"
    server_version = "PartSignalGEOFake/1"
    sys_version = ""

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(6)

    def log_message(self, format: str, *args: Any) -> None:
        # 默认 access log 会回显路径、Header 或恶意请求行；替身只提供闭合统计。
        pass

    def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
        # 标准库的非法 method/request-line 错误可能回显攻击者输入。
        self._json(code, {"error": "测试 HTTP 请求无效"})

    def _json(self, status: int, payload: object, **headers: str) -> None:
        self._respond(status, json.dumps(payload, ensure_ascii=False).encode(), headers)

    def _respond(self, status: int, body: bytes, headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.close_connection = True
        # 超时/超限后的主动关闭是预期结果，不输出正文或底层异常。
        with suppress(BrokenPipeError, ConnectionResetError):
            self.wfile.write(body)

    def _attempt(self, value: str) -> UUID:
        identity = UUID(value)
        if value != str(identity):
            raise ValueError("attempt 必须使用规范 UUID")
        return identity

    def _read_body(self) -> bytes:
        if self.headers.get("Transfer-Encoding") is not None:
            raise ValueError("测试请求不支持 chunked 输入")
        value = self.headers.get("Content-Length", "")
        if not value.isascii() or not value.isdecimal():
            raise ValueError("测试请求长度无效")
        length = int(value)
        if not 0 < length <= 1048576:
            raise ValueError("测试请求长度越界")
        body = self.rfile.read(length)
        if len(body) != length:
            raise ValueError("测试请求不完整")
        return body

    def do_PUT(self) -> None:
        try:
            prefix = "/__geo__/scenarios/"
            if not self.path.startswith(prefix):
                self._json(404, {"error": "测试端点不存在"})
                return
            attempt_id = self._attempt(self.path.removeprefix(prefix))
            scenario = FakeScenario.model_validate_json(self._read_body())
        except (ValueError, ValidationError, OSError):
            self._json(400, {"error": "测试场景无效"})
            return
        self.server.state.configure(attempt_id, scenario)
        self._json(200, {"configured": True})

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"status": "ok"})
        elif self.path == "/__geo__/redirect-target":
            self.server.state.redirect_hit()
            self._json(200, {"error": "不应跟随重定向"})
        elif self.path.startswith("/__geo__/calls/"):
            try:
                attempt_id = self._attempt(self.path.removeprefix("/__geo__/calls/"))
            except ValueError:
                self._json(400, {"error": "测试 attempt 无效"})
                return
            self._json(200, self.server.state.snapshot(attempt_id))
        else:
            self._json(404, {"error": "测试端点不存在"})

    def do_POST(self) -> None:
        if self.path == "/__geo__/redirect-target":
            self.server.state.redirect_hit()
            self._json(200, {"error": "不应跟随重定向"})
            return
        if self.path != "/v1/chat/completions":
            self._json(404, {"error": "测试端点不存在"})
            return
        try:
            attempt_id = self._attempt(self.headers.get("X-GEO-Attempt-ID", ""))
            body = self._read_body()
        except (ValueError, OSError):
            self._json(400, {"error": "测试请求无效"})
            return
        scenario = self.server.state.record(attempt_id, body)
        # 敏感反例仅在当前请求内存/响应存在，绝不进入 state、日志或控制响应。
        noise = (
            " | ".join(
                self.headers.get(name, "") for name in ("Authorization", "X-Test-Secret", "Cookie")
            )
            if scenario.echo_sensitive
            else "虚构供应商错误"
        )
        self._scenario(attempt_id, scenario, noise)

    def _scenario(self, attempt_id: UUID, scenario: FakeScenario, noise: str) -> None:
        mode = scenario.mode
        if mode == FakeMode.DISCONNECT:
            self.close_connection = True
            self.connection.shutdown(socket.SHUT_RDWR)
            return
        if mode == FakeMode.TIMEOUT:
            self.server.state.stopping.wait(scenario.delay_seconds)
        if mode == FakeMode.REDIRECT:
            self._json(307, {"error": noise}, Location="/__geo__/redirect-target")
            return
        statuses = {
            FakeMode.RATE_LIMIT: 429,
            FakeMode.AUTH_401: 401,
            FakeMode.AUTH_403: 403,
            FakeMode.UNAVAILABLE: 503,
        }
        if mode in statuses:
            headers = {"Retry-After": "2"} if mode == FakeMode.RATE_LIMIT else {}
            self._json(statuses[mode], {"error": {"message": noise}}, **headers)
            return
        if mode in {FakeMode.OVERSIZE, FakeMode.OVERSIZE_CHUNKED}:
            self._oversize(scenario)
            return
        response: dict[str, Any] = {
            "id": f"geo-fake-{attempt_id}",
            "model": "geo-fixture-model",
            "source_version": "fixture-v1",
            "web_search_observed": scenario.web_search_observed,
            "choices": [{"message": {"content": scenario.answer_text}, "finish_reason": "stop"}],
        }
        if mode == FakeMode.CITATIONS:
            # 原始顺序与重复 URL 属于证据，不做分析归属或网络抓取。
            response["citations"] = [
                {"url": "https://geo-fixture-a.test/reference", "title": "虚构资料", "position": 1},
                {"url": "https://geo-fixture-a.test/reference", "title": None, "position": 3},
            ]
        if scenario.partial_usage:
            response["usage"] = {"prompt_tokens": 7}
        if scenario.reported_cost:
            response["cost"] = {"amount": "0.001200", "currency": "USD"}
        if scenario.echo_sensitive:
            response["debug"] = {"headers": noise}
        if mode == FakeMode.INVALID_RESPONSE:
            response["choices"] = [{"message": {"content": {"invalid": True}}}]
        elif mode == FakeMode.EMPTY_ANSWER:
            response["choices"] = [{"message": {"content": " \n\t"}}]
        body = (
            b'{"choices":'
            if mode == FakeMode.INVALID_JSON
            else json.dumps(response, ensure_ascii=False).encode()
        )
        headers = {"x-request-id": f"geo-fake-{attempt_id}"}
        if scenario.echo_sensitive:
            headers["Set-Cookie"] = noise
        if mode == FakeMode.SLOW_BODY:
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body[:1])
            self.wfile.flush()
            self.server.state.stopping.wait(scenario.delay_seconds)
            self.close_connection = True
            return
        self._respond(200, body, headers)

    def _oversize(self, scenario: FakeScenario) -> None:
        self.send_response(200)
        chunked = scenario.mode == FakeMode.OVERSIZE_CHUNKED
        self.send_header(
            "Transfer-Encoding" if chunked else "Content-Length",
            "chunked" if chunked else str(scenario.response_bytes),
        )
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        remaining = scenario.response_bytes
        try:
            while remaining:
                chunk = b"x" * min(4096, remaining)
                if chunked:
                    self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                else:
                    self.wfile.write(chunk)
                remaining -= len(chunk)
            if chunked:
                self.wfile.write(b"0\r\n\r\n")
        except (BrokenPipeError, ConnectionResetError):
            pass


@contextmanager
def running_geo_fake(scenario: FakeScenario | None = None) -> Iterator[GeoFakeServer]:
    server = GeoFakeServer(scenario=scenario)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02})
    thread.start()
    try:
        yield server
    finally:
        server.state.stopping.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=7)
        if thread.is_alive():
            raise RuntimeError("GEO fake provider 未能停止")


def main() -> None:
    parser = argparse.ArgumentParser(description="仅绑定回环地址的 GEO 测试 provider")
    parser.add_argument("--port", type=int, default=19012)
    parser.add_argument("--mode", type=FakeMode, choices=list(FakeMode), default=FakeMode.SUCCESS)
    args = parser.parse_args()
    with GeoFakeServer(args.port, scenario=FakeScenario(mode=args.mode)) as server:
        print(f"GEO fake provider listening on {server.base_url}", flush=True)
        with suppress(KeyboardInterrupt):
            server.serve_forever(poll_interval=0.1)


if __name__ == "__main__":
    main()
