"""Slice 3D：SSRF 安全、无登录态、只读公开页面抓取与 HTML 元数据解析器。"""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Protocol
from urllib.parse import urljoin, urlsplit

import httpx

from app.services.outbound_url_guard import (
    OutboundUrlError,
    resolve_outbound_target,
    validate_outbound_url_syntax,
)
from app.services.outbound_url_guard import (
    build_pinned_request_url as _build_pinned_request_url,
)

MAX_REDIRECTS = 3
FETCH_TIMEOUT_SECONDS = 10.0
MAX_BODY_BYTES = 1_048_576  # 1 MiB 上限，防止大响应耗尽内存
ALLOWED_PUBLIC_PORTS = frozenset({80, 443})
_ALLOWED_PUBLIC_SCHEMES = frozenset({"http", "https"})
_USER_AGENT = "PartSignal-PublicPageHealthCheck/1.0 (+read-only; no-auth)"

_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_LOGIN_PATH_RE = re.compile(
    r"(?:^|/)(?:login|signin|sign-in|passport|auth/login|account/login)(?:/|$|\?)",
    re.IGNORECASE,
)
_STRONG_WAF_PHRASES = (
    "just a moment...",
    "checking your browser before accessing",
    "attention required! | cloudflare",
    "verify you are human",
    "enable javascript and cookies to continue",
)
_SOFT_LOGIN_PHRASES = (
    "访问频率过高",
    "安全验证",
    "人机验证",
    "请先登录",
)
_SOFT_LOGIN_MAX_BODY_CHARS = 400


@dataclass(frozen=True, slots=True)
class PageFetchResult:
    """单次公开页面只读抓取结果（绝不携带登录态或业务敏感凭据）。"""

    checked_url: str
    final_url: str | None = None
    http_status: int | None = None
    redirect_count: int = 0
    redirected: bool = False
    page_title: str | None = None
    body_text: str = ""
    has_noindex: bool = False
    canonical_url: str | None = None
    waf_or_login_blocked: bool = False
    fetch_error_code: str | None = None


class PageHealthFetcher(Protocol):
    """公开页面健康检查抓取协议；仅测试环境允许注入确定性替身。"""

    def fetch(self, url: str) -> PageFetchResult: ...


def _has_control_char(raw: str) -> bool:
    return any(ord(ch) < 32 or ord(ch) == 127 for ch in raw)


def _is_supported_text_content_type(content_type: str) -> bool:
    """仅接受文本/HTML/XHTML/XML 媒体类型（空头兼容保守按文本处理），阻断二进制大文件。"""
    media_type = content_type.split(";", 1)[0].strip().lower()
    if not media_type:
        return True
    return (
        media_type.startswith("text/")
        or media_type in {"application/xhtml+xml", "application/xml"}
        or media_type.endswith("+xml")
    )


def _decode_html_bytes(raw_body: bytes, encoding: str | None) -> str:
    """安全解码网页字节，拦截 rot_13/zlib 等非文本 codec 引发的 LookupError。"""
    candidate = (encoding or "utf-8").strip() or "utf-8"
    try:
        return raw_body.decode(candidate, errors="replace")
    except (LookupError, UnicodeError):
        return raw_body.decode("utf-8", errors="replace")


def validate_public_http_url(
    raw_url: str,
    *,
    resolve_host: Callable[[str, int], list[str]] | None = None,
) -> tuple[str, str, int, str]:
    """校验公开 HTTP(S) URL 与 DNS 解析结果，返回 (规范URL, ASCII主机名, 端口, 绑定公网IP)。

    抛出 ValueError(error_code) 供上层稳定映射为 SSRF_BLOCKED / DNS_RESOLUTION_FAILED。
    """
    try:
        target = validate_outbound_url_syntax(
            raw_url,
            allowed_schemes=_ALLOWED_PUBLIC_SCHEMES,
            allowed_ports=ALLOWED_PUBLIC_PORTS,
            allow_query_or_fragment=True,
            allow_local_http=False,
        )
        pinned = resolve_outbound_target(target, resolve_host=resolve_host)
    except OutboundUrlError as exc:
        raise ValueError(exc.code) from None
    return pinned.normalized_url, pinned.ascii_host, pinned.port, pinned.pinned_ip


class _PublicPageHtmlParser(HTMLParser):
    """安全提取公开网页标题、noindex、canonical 与可见正文纯文本。"""

    _IGNORED_TAGS = frozenset({"script", "style", "noscript", "svg", "template"})

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._in_title = False
        self._ignored_depth = 0
        self.title_parts: list[str] = []
        self.text_parts: list[str] = []
        self.has_noindex = False
        self.canonical_url: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lower = tag.lower()
        if lower in self._IGNORED_TAGS:
            self._ignored_depth += 1
            return
        if lower == "title":
            self._in_title = True
            return
        attr_map = {k.lower(): (v or "").strip() for k, v in attrs}
        if lower == "meta":
            name = attr_map.get("name", "").lower()
            if name in {"robots", "googlebot", "baiduspider"}:
                content = attr_map.get("content", "").lower()
                if "noindex" in content:
                    self.has_noindex = True
        elif lower == "link" and self.canonical_url is None:
            rel_tokens = {token.lower() for token in attr_map.get("rel", "").split()}
            href = attr_map.get("href", "")
            if "canonical" in rel_tokens and href:
                self.canonical_url = href[:2000]

    def handle_endtag(self, tag: str) -> None:
        lower = tag.lower()
        if lower in self._IGNORED_TAGS and self._ignored_depth > 0:
            self._ignored_depth -= 1
        elif lower == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._ignored_depth > 0:
            return
        stripped = data.strip()
        if not stripped:
            return
        if self._in_title:
            self.title_parts.append(stripped)
        else:
            self.text_parts.append(stripped)


def parse_public_html(
    html_text: str,
    *,
    x_robots_tag: str = "",
    final_url: str = "",
) -> tuple[str | None, str, bool, str | None, bool]:
    """解析公开 HTML，返回 (title, body_text, has_noindex, canonical_url, waf_or_login_blocked)。"""
    parser = _PublicPageHtmlParser()
    parser.feed(html_text)
    title = " ".join(parser.title_parts).strip()[:500] or None
    body_text = "\n".join(parser.text_parts)
    has_noindex = parser.has_noindex or ("noindex" in x_robots_tag.lower())
    canonical = parser.canonical_url
    if canonical and final_url:
        canonical = urljoin(final_url, canonical)[:2000]
    title_lower = (title or "").lower()
    probe = f"{title_lower}\n{body_text[:1200].lower()}"
    strong_waf = any(phrase in probe for phrase in _STRONG_WAF_PHRASES)
    soft_login = (
        len(body_text.strip()) < _SOFT_LOGIN_MAX_BODY_CHARS
        and any(phrase in probe for phrase in _SOFT_LOGIN_PHRASES)
    ) or any(phrase in title_lower for phrase in _SOFT_LOGIN_PHRASES)
    login_path = bool(final_url and _LOGIN_PATH_RE.search(urlsplit(final_url).path))
    return title, body_text, has_noindex, canonical, (strong_waf or soft_login or login_path)


class PublicPageHttpFetcher:
    """生产默认公开页只读抓取器：逐跳独立 Client（防 TLS SNI/Cookie 复用）、总时限与 1 MiB 截断。"""

    def __init__(
        self,
        *,
        resolve_host: Callable[[str, int], list[str]] | None = None,
        timeout_seconds: float = FETCH_TIMEOUT_SECONDS,
        max_redirects: int = MAX_REDIRECTS,
        max_body_bytes: int = MAX_BODY_BYTES,
    ) -> None:
        self._resolve_host = resolve_host
        self._timeout_seconds = timeout_seconds
        self._max_redirects = max_redirects
        self._max_body_bytes = max_body_bytes

    def fetch(self, url: str) -> PageFetchResult:
        current_url = url.strip()
        redirects = 0
        deadline = time.monotonic() + self._timeout_seconds
        try:
            while True:
                remaining_total = deadline - time.monotonic()
                if remaining_total <= 0:
                    return PageFetchResult(
                        checked_url=url,
                        final_url=current_url[:2000],
                        redirect_count=redirects,
                        redirected=redirects > 0,
                        fetch_error_code="TIMEOUT",
                    )

                try:
                    logical_url, ascii_host, port, pinned_ip = validate_public_http_url(
                        current_url, resolve_host=self._resolve_host
                    )
                except ValueError as err:
                    code = str(err)
                    if redirects > 0 and code == "SSRF_BLOCKED":
                        code = "UNSAFE_REDIRECT"
                    return PageFetchResult(
                        checked_url=url,
                        final_url=current_url[:2000],
                        redirect_count=redirects,
                        redirected=redirects > 0,
                        fetch_error_code=code,
                    )

                pinned_url, host_header = _build_pinned_request_url(
                    logical_url, ascii_host, pinned_ip, port
                )
                headers = {
                    "Host": host_header,
                    "User-Agent": _USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
                    "Accept-Encoding": "identity",
                    "Connection": "close",
                }
                extensions = (
                    {"sni_hostname": ascii_host}
                    if logical_url.startswith("https://")
                    else {}
                )

                # 逐跳使用独立无持久连接/无 Cookie 的 httpx.Client，防止共享 IP 复用跳过 SNI 校验
                with (
                    httpx.Client(
                        follow_redirects=False,
                        trust_env=False,
                        limits=httpx.Limits(max_keepalive_connections=0),
                        timeout=httpx.Timeout(max(0.1, remaining_total)),
                    ) as client,
                    client.stream(
                        "GET", pinned_url, headers=headers, extensions=extensions
                    ) as response,
                ):
                        status_code = response.status_code
                        location = response.headers.get("location")
                        if status_code in _REDIRECT_STATUSES and location is not None:
                            if not location.strip() or _has_control_char(location):
                                return PageFetchResult(
                                    checked_url=url,
                                    final_url=logical_url[:2000],
                                    http_status=status_code,
                                    redirect_count=redirects,
                                    redirected=redirects > 0,
                                    fetch_error_code="UNSAFE_REDIRECT",
                                )
                            if redirects >= self._max_redirects:
                                return PageFetchResult(
                                    checked_url=url,
                                    final_url=logical_url[:2000],
                                    http_status=status_code,
                                    redirect_count=redirects,
                                    redirected=redirects > 0,
                                    fetch_error_code="TOO_MANY_REDIRECTS",
                                )
                            current_url = urljoin(logical_url, location.strip())
                            redirects += 1
                            continue

                        content_type = response.headers.get("content-type", "")
                        if 200 <= status_code <= 299 and not _is_supported_text_content_type(
                            content_type
                        ):
                            return PageFetchResult(
                                checked_url=url,
                                final_url=logical_url[:2000],
                                http_status=status_code,
                                redirect_count=redirects,
                                redirected=redirects > 0,
                                fetch_error_code="UNSUPPORTED_CONTENT_TYPE",
                            )

                        chunks: list[bytes] = []
                        total_bytes = 0
                        for chunk in response.iter_bytes():
                            if time.monotonic() > deadline:
                                return PageFetchResult(
                                    checked_url=url,
                                    final_url=logical_url[:2000],
                                    http_status=status_code,
                                    redirect_count=redirects,
                                    redirected=redirects > 0,
                                    fetch_error_code="TIMEOUT",
                                )
                            remaining = self._max_body_bytes - total_bytes
                            if remaining <= 0:
                                break
                            if len(chunk) > remaining:
                                chunks.append(chunk[:remaining])
                                total_bytes += remaining
                                break
                            chunks.append(chunk)
                            total_bytes += len(chunk)

                        raw_body = b"".join(chunks)
                        html_text = _decode_html_bytes(raw_body, response.encoding)
                        x_robots = response.headers.get("x-robots-tag", "")
                        cf_mitigated = response.headers.get("cf-mitigated", "").lower()
                        title, body_text, has_noindex, canonical, waf_hint = parse_public_html(
                            html_text, x_robots_tag=x_robots, final_url=logical_url
                        )
                        return PageFetchResult(
                            checked_url=url,
                            final_url=logical_url[:2000],
                            http_status=status_code,
                            redirect_count=redirects,
                            redirected=redirects > 0,
                            page_title=title,
                            body_text=body_text,
                            has_noindex=has_noindex,
                            canonical_url=canonical,
                            waf_or_login_blocked=waf_hint or (cf_mitigated == "challenge"),
                        )
        except httpx.TimeoutException:
            return PageFetchResult(
                checked_url=url,
                final_url=current_url[:2000],
                redirect_count=redirects,
                redirected=redirects > 0,
                fetch_error_code="TIMEOUT",
            )
        except httpx.HTTPError:
            return PageFetchResult(
                checked_url=url,
                final_url=current_url[:2000],
                redirect_count=redirects,
                redirected=redirects > 0,
                fetch_error_code="NETWORK_ERROR",
            )
