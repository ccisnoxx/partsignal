"""出站 HTTP(S) 目标的统一 SSRF 校验、DNS 单次解析与 IP 绑定构造模块。

由公开页面健康巡检（page_health_fetcher）与外部 AI 渠道（ai_provider）共同复用，
作为公网 IP 分类、保留主机名过滤与 DNS Rebinding 阻断的唯一事实源。
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

from pydantic import HttpUrl, TypeAdapter, ValidationError

ResolveHost = Callable[[str, int], list[str]]
OutboundUrlErrorCode = Literal["SSRF_BLOCKED", "DNS_RESOLUTION_FAILED"]

_HTTP_URL_ADAPTER: TypeAdapter[HttpUrl] = TypeAdapter(HttpUrl)
_LOCAL_HTTP_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

# 显式覆盖 Python ipaddress 各版本可能视为 global 的特殊/转换网段（CGNAT、NAT64、隧道与基准网段）。
_CGNAT_V4 = ipaddress.ip_network("100.64.0.0/10")
_BENCHMARKING_V4 = ipaddress.ip_network("198.18.0.0/15")
_DOCUMENTATION_V4 = (
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
)
_NAT64_WELL_KNOWN_V6 = ipaddress.ip_network("64:ff9b::/96")
_NAT64_LOCAL_USE_V6 = ipaddress.ip_network("64:ff9b:1::/48")
_TEREDO_V6 = ipaddress.ip_network("2001::/32")
_SIXTOFOUR_V6 = ipaddress.ip_network("2002::/16")
_BENCHMARKING_V6 = ipaddress.ip_network("2001:2::/48")
_DOCUMENTATION_V6 = ipaddress.ip_network("2001:db8::/32")


class OutboundUrlError(ValueError):
    """出站 URL 安全校验或 DNS 解析失败；code 为闭合机器可读枚举。"""

    def __init__(self, code: OutboundUrlErrorCode) -> None:
        super().__init__(code)
        self.code: OutboundUrlErrorCode = code


@dataclass(frozen=True, slots=True)
class OutboundTarget:
    """仅完成语法、静态非公网字面量与端口策略校验的规范目标（未触发 DNS）。"""

    normalized_url: str
    scheme: str
    ascii_host: str
    port: int
    is_ip_literal: bool
    is_local_http: bool = False


@dataclass(frozen=True, slots=True)
class PinnedOutboundTarget:
    """已完成单次 DNS 解析并锁定单个公网单播 IP 的出站连接目标。"""

    normalized_url: str
    scheme: str
    ascii_host: str
    port: int
    pinned_ip: str


def is_public_global_ip(raw_ip: str) -> bool:
    """严格判定 IP 是否为公网单播地址（阻断私网/环回/链路/元数据/CGNAT/IPv4-mapped/NAT64）。"""
    try:
        addr = ipaddress.ip_address(raw_ip)
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped is not None:
            addr = addr.ipv4_mapped
        elif (
            addr in _NAT64_WELL_KNOWN_V6
            or addr in _NAT64_LOCAL_USE_V6
            or addr in _TEREDO_V6
            or addr in _SIXTOFOUR_V6
            or addr in _BENCHMARKING_V6
            or addr in _DOCUMENTATION_V6
        ):
            return False
    if isinstance(addr, ipaddress.IPv4Address) and (
        addr in _CGNAT_V4
        or addr in _BENCHMARKING_V4
        or any(addr in net for net in _DOCUMENTATION_V4)
    ):
        return False
    return bool(
        addr.is_global
        and not addr.is_private
        and not addr.is_loopback
        and not addr.is_link_local
        and not addr.is_multicast
        and not addr.is_reserved
        and not addr.is_unspecified
    )


def default_resolve_host(hostname: str, port: int) -> list[str]:
    """解析主机名全部 TCP A/AAAA 记录并按返回顺序去重。"""
    infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    ips: list[str] = []
    for _family, _socktype, _proto, _canonname, sockaddr in infos:
        ip_str = str(sockaddr[0])
        if ip_str not in ips:
            ips.append(ip_str)
    return ips


def validate_outbound_url_syntax(
    raw_url: str,
    *,
    allowed_schemes: frozenset[str],
    allowed_ports: frozenset[int] | None = None,
    allow_query_or_fragment: bool = True,
    allow_local_http: bool = False,
    strip_trailing_slash: bool = False,
    reject_outer_whitespace: bool = False,
) -> OutboundTarget:
    """执行无 DNS 的静态 URL 与非公网字面量/保留主机名校验。"""
    if reject_outer_whitespace:
        cleaned = raw_url
        if not cleaned or any(ord(ch) < 32 or ord(ch) == 127 for ch in cleaned):
            raise OutboundUrlError("SSRF_BLOCKED")
    else:
        cleaned = raw_url.strip()
        if not cleaned or any(ord(ch) <= 32 or ord(ch) == 127 for ch in cleaned):
            raise OutboundUrlError("SSRF_BLOCKED")

    try:
        raw_parts = urlsplit(cleaned)
        parsed_pydantic = _HTTP_URL_ADAPTER.validate_python(cleaned)
    except (ValidationError, ValueError):
        raise OutboundUrlError("SSRF_BLOCKED") from None

    if raw_parts.username is not None or raw_parts.password is not None:
        raise OutboundUrlError("SSRF_BLOCKED")
    if not allow_query_or_fragment and (
        parsed_pydantic.query is not None or parsed_pydantic.fragment is not None
    ):
        raise OutboundUrlError("SSRF_BLOCKED")

    normalized_url = str(parsed_pydantic)
    parts = urlsplit(normalized_url)
    scheme = parts.scheme.lower()
    if parts.username is not None or parts.password is not None:
        raise OutboundUrlError("SSRF_BLOCKED")
    hostname = (parts.hostname or "").strip().rstrip(".")
    if not hostname:
        raise OutboundUrlError("SSRF_BLOCKED")

    try:
        raw_port = parts.port
    except ValueError:
        raise OutboundUrlError("SSRF_BLOCKED") from None
    port = (443 if scheme == "https" else 80) if raw_port is None else raw_port
    if not 1 <= port <= 65535:
        raise OutboundUrlError("SSRF_BLOCKED")

    if strip_trailing_slash:
        normalized_url = normalized_url.rstrip("/")

    # 开发/测试环境显式允许的本机 HTTP 替身，仅放行环回主机且跳过公网校验。
    if scheme == "http" and allow_local_http and hostname.lower() in _LOCAL_HTTP_HOSTS:
        is_literal = hostname.lower() != "localhost"
        return OutboundTarget(
            normalized_url=normalized_url,
            scheme=scheme,
            ascii_host=hostname.lower(),
            port=port,
            is_ip_literal=is_literal,
            is_local_http=True,
        )

    if scheme not in allowed_schemes:
        raise OutboundUrlError("SSRF_BLOCKED")
    if allowed_ports is not None and port not in allowed_ports:
        raise OutboundUrlError("SSRF_BLOCKED")

    try:
        ascii_hostname = hostname.encode("idna").decode("ascii").lower()
    except UnicodeError:
        raise OutboundUrlError("SSRF_BLOCKED") from None

    try:
        ipaddress.ip_address(ascii_hostname)
    except ValueError:
        if (
            ascii_hostname == "localhost"
            or ascii_hostname.endswith((".localhost", ".local", ".internal"))
            or "." not in ascii_hostname
        ):
            raise OutboundUrlError("SSRF_BLOCKED") from None
        return OutboundTarget(
            normalized_url=normalized_url,
            scheme=scheme,
            ascii_host=ascii_hostname,
            port=port,
            is_ip_literal=False,
        )

    if not is_public_global_ip(ascii_hostname):
        raise OutboundUrlError("SSRF_BLOCKED")
    return OutboundTarget(
        normalized_url=normalized_url,
        scheme=scheme,
        ascii_host=ascii_hostname,
        port=port,
        is_ip_literal=True,
    )


def resolve_outbound_target(
    target: OutboundTarget,
    *,
    resolve_host: ResolveHost | None = None,
) -> PinnedOutboundTarget:
    """对已完成静态校验的公网目标执行单次 DNS 解析并验证全部记录为公网单播 IP。"""
    if target.is_local_http:
        raise OutboundUrlError("SSRF_BLOCKED")
    if target.is_ip_literal:
        if not is_public_global_ip(target.ascii_host):
            raise OutboundUrlError("SSRF_BLOCKED")
        return PinnedOutboundTarget(
            normalized_url=target.normalized_url,
            scheme=target.scheme,
            ascii_host=target.ascii_host,
            port=target.port,
            pinned_ip=target.ascii_host,
        )

    resolver = resolve_host or default_resolve_host
    try:
        resolved_ips = resolver(target.ascii_host, target.port)
    except OSError:
        raise OutboundUrlError("DNS_RESOLUTION_FAILED") from None
    if not resolved_ips:
        raise OutboundUrlError("DNS_RESOLUTION_FAILED")
    if not all(is_public_global_ip(ip) for ip in resolved_ips):
        raise OutboundUrlError("SSRF_BLOCKED")
    return PinnedOutboundTarget(
        normalized_url=target.normalized_url,
        scheme=target.scheme,
        ascii_host=target.ascii_host,
        port=target.port,
        pinned_ip=resolved_ips[0],
    )


def build_pinned_request_url(
    logical_url: str,
    ascii_host: str,
    pinned_ip: str,
    port: int,
) -> tuple[str, str]:
    """构造绑定已校验公网 IP 的请求 URL 与 RFC 9110 合规 Host 头（消除 DNS Rebinding）。"""
    parts = urlsplit(logical_url)
    ip_host = f"[{pinned_ip}]" if ":" in pinned_ip else pinned_ip
    default_port = 443 if parts.scheme == "https" else 80
    path = parts.path or "/"
    query = f"?{parts.query}" if parts.query else ""
    pinned_url = f"{parts.scheme}://{ip_host}:{port}{path}{query}"
    host_literal = f"[{ascii_host}]" if ":" in ascii_host else ascii_host
    host_header = host_literal if port == default_port else f"{host_literal}:{port}"
    return pinned_url, host_header
