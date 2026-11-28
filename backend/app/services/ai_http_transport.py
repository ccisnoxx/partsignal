"""官方 OpenAI SDK 外层 httpx2 传输保护：公网 IP 绑定+SNI、流式字节上限与受限解压。"""

from __future__ import annotations

import time
import zlib
from collections.abc import Iterator
from typing import Any

import httpx2

from app.services.outbound_url_guard import PinnedOutboundTarget, build_pinned_request_url

_SUPPORTED_COMPRESSED_ENCODINGS = frozenset({"gzip", "x-gzip", "deflate"})


class AIResponseTooLargeError(Exception):
    """响应流在接收期间超过字节上限；不继承 httpx2.RequestError，避免被 SDK 吞为连接故障。"""


class AIResponseEncodingError(Exception):
    """响应声明了不支持或损坏的压缩编码；不继承 httpx2.RequestError，避免被 SDK 吞为连接故障。"""


def staged_timeout(timeout_seconds: int) -> httpx2.Timeout:
    """分离连接/写入/连接池与读取超时，防止慢建连占用长达数分钟的读超时窗口。"""
    total = float(timeout_seconds)
    return httpx2.Timeout(
        connect=min(10.0, total),
        read=total,
        write=min(30.0, total),
        pool=min(5.0, total),
    )


def _parse_content_length(raw_value: str | None) -> int | None:
    if raw_value is None:
        return None
    cleaned = raw_value.strip()
    if cleaned and cleaned.isascii() and cleaned.isdecimal():
        return int(cleaned)
    return None


class BoundedSyncByteStream(httpx2.SyncByteStream):
    """在流式读取过程中严格限制压缩前/解压后字节数与总耗时，超限立即关闭底层连接。"""

    def __init__(
        self,
        inner: httpx2.SyncByteStream,
        *,
        max_bytes: int,
        deadline: float,
        request: httpx2.Request,
        content_encoding: str | None = None,
    ) -> None:
        self._inner = inner
        self._max_bytes = max_bytes
        self._deadline = deadline
        self._request = request
        self._content_encoding = content_encoding
        self._wire_bytes = 0
        self._decoded_bytes = 0
        self._closed = False

    def _build_decompressor(self) -> Any:
        if self._content_encoding in ("gzip", "x-gzip"):
            return zlib.decompressobj(16 + zlib.MAX_WBITS)
        if self._content_encoding == "deflate":
            return zlib.decompressobj(zlib.MAX_WBITS)
        return None

    def __iter__(self) -> Iterator[bytes]:
        decompressor = self._build_decompressor()
        try:
            for chunk in self._inner:
                if time.monotonic() > self._deadline:
                    self.close()
                    raise httpx2.ReadTimeout("AI 渠道响应读取超时", request=self._request)
                if not chunk:
                    continue
                self._wire_bytes += len(chunk)
                if self._wire_bytes > self._max_bytes:
                    self.close()
                    raise AIResponseTooLargeError()
                if decompressor is None:
                    yield chunk
                    continue
                remaining = self._max_bytes - self._decoded_bytes
                try:
                    decoded = decompressor.decompress(chunk, remaining + 1)
                except zlib.error:
                    self.close()
                    raise AIResponseEncodingError() from None
                self._decoded_bytes += len(decoded)
                if self._decoded_bytes > self._max_bytes or decompressor.unconsumed_tail:
                    self.close()
                    raise AIResponseTooLargeError()
                if decoded:
                    yield decoded
            if decompressor is not None:
                remaining = self._max_bytes - self._decoded_bytes
                try:
                    tail = decompressor.flush(remaining + 1)
                except zlib.error:
                    self.close()
                    raise AIResponseEncodingError() from None
                self._decoded_bytes += len(tail)
                if self._decoded_bytes > self._max_bytes or decompressor.unconsumed_tail:
                    self.close()
                    raise AIResponseTooLargeError()
                if tail:
                    yield tail
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._inner.close()


class GuardedAITransport(httpx2.BaseTransport):
    """官方 SDK 外层传输保护：公网 IP 绑定+SNI、禁压缩炸弹、流式字节上限与总超时控制。"""

    def __init__(
        self,
        *,
        inner: httpx2.BaseTransport,
        owns_inner: bool,
        pinned_target: PinnedOutboundTarget | None,
        max_response_bytes: int,
        timeout_seconds: int,
    ) -> None:
        self._inner = inner
        self._owns_inner = owns_inner
        self._pinned_target = pinned_target
        self._max_response_bytes = max_response_bytes
        self._timeout_seconds = timeout_seconds

    def handle_request(self, request: httpx2.Request) -> httpx2.Response:
        deadline = time.monotonic() + self._timeout_seconds
        if self._pinned_target is not None:
            pinned_url, host_header = build_pinned_request_url(
                str(request.url),
                self._pinned_target.ascii_host,
                self._pinned_target.pinned_ip,
                self._pinned_target.port,
            )
            headers = httpx2.Headers(request.headers.raw, encoding="latin-1")
            headers["Host"] = host_header
            headers["Accept-Encoding"] = "identity"
            extensions = dict(request.extensions)
            if self._pinned_target.scheme == "https":
                extensions["sni_hostname"] = self._pinned_target.ascii_host
            outgoing = httpx2.Request(
                method=request.method,
                url=pinned_url,
                headers=headers,
                stream=request.stream,
                extensions=extensions,
            )
        else:
            outgoing = request

        response = self._inner.handle_request(outgoing)
        content_length = _parse_content_length(response.headers.get("content-length"))
        if content_length is not None and content_length > self._max_response_bytes:
            response.close()
            raise AIResponseTooLargeError()

        content_encoding = response.headers.get("content-encoding", "").strip().lower()
        bounded_encoding: str | None = None
        response_headers = response.headers
        if content_encoding and content_encoding != "identity":
            if content_encoding not in _SUPPORTED_COMPRESSED_ENCODINGS:
                response.close()
                raise AIResponseEncodingError()
            bounded_encoding = content_encoding
            # 由受限解压流输出明文字节，移除原压缩头避免 httpx2 二次解压或长度校验冲突。
            response_headers = httpx2.Headers(
                [
                    (name, value)
                    for name, value in response.headers.raw
                    if name.lower() not in (b"content-encoding", b"content-length")
                ]
            )

        assert isinstance(response.stream, httpx2.SyncByteStream)
        bounded_stream = BoundedSyncByteStream(
            response.stream,
            max_bytes=self._max_response_bytes,
            deadline=deadline,
            request=request,
            content_encoding=bounded_encoding,
        )
        return httpx2.Response(
            status_code=response.status_code,
            headers=response_headers,
            stream=bounded_stream,
            extensions=response.extensions,
        )

    def close(self) -> None:
        if self._owns_inner:
            self._inner.close()
