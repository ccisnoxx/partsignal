"""只使用虚构数据的本机 HTTP AI Provider，供 SDK 集成验证。"""

from __future__ import annotations

import json
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


@dataclass
class FakeAIProvider:
    base_url: str = ""
    status: int = 200
    response_body: bytes | None = None
    before_response: Callable[[], None] | None = None
    requests: list[dict[str, Any]] = field(default_factory=list)


@contextmanager
def fake_ai_provider() -> Iterator[FakeAIProvider]:
    """随机回环端口；退出时关闭服务器并回收线程。"""
    provider = FakeAIProvider()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            """替身请求中也可能有测试敏感值，不记录原始请求。"""

        def do_GET(self) -> None:
            self.respond(None)

        def do_POST(self) -> None:
            size = int(self.headers["Content-Length"])
            self.respond(json.loads(self.rfile.read(size)))

        def respond(self, body: object) -> None:
            provider.requests.append(
                {
                    "method": self.command,
                    "path": self.path,
                    "headers": dict(self.headers),
                    "body": body,
                }
            )
            if provider.before_response is not None:
                provider.before_response()
            if provider.status != 200:
                payload: dict[str, Any] = {"error": {"message": "fake-provider-secret-body"}}
            elif self.command == "GET" and self.path == "/custom/v1/models":
                payload = {
                    "object": "list",
                    "data": [
                        {"id": "fake-model", "object": "model", "created": 0, "owned_by": "fake"},
                        {"id": "fake-model", "object": "model", "created": 0, "owned_by": "fake"},
                    ],
                }
            elif self.command == "POST" and self.path == "/custom/v1/chat/completions":
                payload = {
                    "id": "fake-completion",
                    "object": "chat.completion",
                    "created": 0,
                    "model": "fake-model",
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": "hello"},
                            "finish_reason": "stop",
                        }
                    ],
                }
            else:
                self.send_error(404)
                return
            encoded = (
                provider.response_body
                if provider.response_body is not None
                else json.dumps(payload).encode()
            )
            self.send_response(provider.status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("X-Request-ID", "fake-request-id")
            self.end_headers()
            self.wfile.write(encoded)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    provider.base_url = f"http://127.0.0.1:{server.server_port}/custom/v1"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield provider
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
