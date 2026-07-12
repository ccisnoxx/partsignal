"""固定 DNS 解析结果的最小 HTTP/1.1 出站传输。"""

from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import quote, urlsplit, urlunsplit

from app.errors import AppError

Resolver = Callable[..., Sequence[tuple[int, int, int, str, tuple[object, ...]]]]
Connector = Callable[["ResolvedAddress", float], socket.socket]
TLSWrapper = Callable[[socket.socket, str], socket.socket]


@dataclass(frozen=True)
class ResolvedAddress:
    """一次解析得到的规范地址和原始连接参数。"""

    family: int
    ip: str
    sockaddr: tuple[object, ...]


@dataclass(frozen=True)
class ResolvedEndpoint:
    """单次请求内不可变的 URL 与全部已批准目标地址。"""

    scheme: str
    hostname: str
    port: int
    path_prefix: str
    addresses: tuple[ResolvedAddress, ...]

    @property
    def approved_ips(self) -> frozenset[str]:
        return frozenset(address.ip for address in self.addresses)

    @property
    def host_header(self) -> str:
        host = f"[{self.hostname}]" if ":" in self.hostname else self.hostname
        default_port = 443 if self.scheme == "https" else 80
        return host if self.port == default_port else f"{host}:{self.port}"

    @property
    def base_url(self) -> str:
        return urlunsplit((self.scheme, self.host_header, self.path_prefix, "", ""))

    def request_path(self, suffix: str) -> str:
        """拼接唯一允许由协议层传入的固定路径后缀。"""
        return f"{self.path_prefix.rstrip('/')}/{suffix}"


@dataclass(frozen=True)
class PinnedResponse:
    """已受大小上限保护的响应数据。"""

    status_code: int
    headers: dict[str, str]
    body: bytes


class HTTPTransport(Protocol):
    """OpenAI 协议层依赖的最小稳定传输接口。"""

    def request(
        self,
        *,
        method: str,
        base_url: str,
        suffix: str,
        headers: dict[str, str],
        timeout_seconds: int,
        body: bytes | None,
    ) -> PinnedResponse: ...


def _canonical_ip(value: object) -> str:
    """去除 IPv6 scope 并返回可稳定比较的地址文本。"""
    return str(ipaddress.ip_address(str(value).split("%", 1)[0]))


def resolve_endpoint(
    value: str,
    *,
    allow_local_http: bool,
    resolver: Resolver | None = None,
) -> ResolvedEndpoint:
    """解析并一次性批准全部目标地址；混合公网与私网结果整体拒绝。"""
    try:
        parsed = urlsplit(value)
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as error:
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道地址端口无效", 422) from error
    if parsed.scheme not in {"https", "http"} or not parsed.hostname:
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道地址必须是 HTTP(S) 根地址", 422)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道地址不能包含凭据、查询或片段", 422)
    if any(ord(character) < 32 or ord(character) == 127 for character in parsed.path):
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道地址路径包含非法字符", 422)
    try:
        resolved = (resolver or socket.getaddrinfo)(
            parsed.hostname, port, type=socket.SOCK_STREAM
        )
    except (socket.gaierror, UnicodeError, ValueError) as error:
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道域名无法解析", 422) from error

    addresses: list[ResolvedAddress] = []
    seen: set[tuple[int, str, tuple[object, ...]]] = set()
    for family, socktype, _protocol, _canonical_name, sockaddr in resolved:
        if socktype not in {0, socket.SOCK_STREAM} or family not in {
            socket.AF_INET,
            socket.AF_INET6,
        }:
            continue
        try:
            ip = _canonical_ip(sockaddr[0])
        except ValueError as error:
            raise AppError("AI_URL_FORBIDDEN", "AI 渠道域名解析结果无效", 422) from error
        key = (family, ip, sockaddr)
        if key not in seen:
            seen.add(key)
            addresses.append(ResolvedAddress(family=family, ip=ip, sockaddr=sockaddr))
    if not addresses:
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道域名没有可连接地址", 422)

    parsed_addresses = [ipaddress.ip_address(address.ip) for address in addresses]
    local_http = (
        parsed.scheme == "http"
        and allow_local_http
        and all(address.is_loopback for address in parsed_addresses)
    )
    if parsed.scheme == "http" and not local_http:
        raise AppError("AI_URL_FORBIDDEN", "HTTP AI 渠道只允许开发环境本机地址", 422)
    if not local_http and any(not address.is_global for address in parsed_addresses):
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道解析到了非公网地址", 422)

    path_prefix = quote(parsed.path.rstrip("/"), safe="/%:@!$&'()*+,;=-._~")
    return ResolvedEndpoint(
        scheme=parsed.scheme,
        hostname=parsed.hostname,
        port=port,
        path_prefix=path_prefix,
        addresses=tuple(addresses),
    )


def connect_address(address: ResolvedAddress, timeout_seconds: float) -> socket.socket:
    """只连接已解析的 sockaddr，不再次查询 DNS。"""
    connection = socket.socket(address.family, socket.SOCK_STREAM)
    try:
        connection.settimeout(timeout_seconds)
        connection.connect(address.sockaddr)
        return connection
    except OSError:
        connection.close()
        raise


def wrap_tls(connection: socket.socket, hostname: str) -> socket.socket:
    """以原始主机名执行证书校验和 SNI，不以 IP 替换身份。"""
    return ssl.create_default_context().wrap_socket(connection, server_hostname=hostname)


class PinnedHTTPTransport:
    """在发送敏感 Header 前验证实际 TCP 对端属于本次解析集合。"""

    def __init__(
        self,
        *,
        allow_local_http: bool,
        max_response_bytes: int = 2 * 1024 * 1024,
        resolver: Resolver | None = None,
        connector: Connector | None = None,
        tls_wrapper: TLSWrapper | None = None,
    ) -> None:
        self._allow_local_http = allow_local_http
        self._max_response_bytes = max_response_bytes
        self._resolver = resolver
        self._connector = connector or connect_address
        self._tls_wrapper = tls_wrapper or wrap_tls

    def validate_url(self, value: str) -> str:
        """复用实际请求的完整地址策略进行配置校验。"""
        return resolve_endpoint(
            value,
            allow_local_http=self._allow_local_http,
            resolver=self._resolver,
        ).base_url

    def request(
        self,
        *,
        method: str,
        base_url: str,
        suffix: str,
        headers: dict[str, str],
        timeout_seconds: int,
        body: bytes | None,
    ) -> PinnedResponse:
        """最多发送一次 HTTP 请求；开始发送后任何失败都不会换地址重试。"""
        endpoint = resolve_endpoint(
            base_url,
            allow_local_http=self._allow_local_http,
            resolver=self._resolver,
        )
        connection = self._connect(endpoint, timeout_seconds)
        try:
            request_headers = {
                "Host": endpoint.host_header,
                **headers,
                "Connection": "close",
            }
            if body is not None:
                request_headers["Content-Type"] = "application/json"
                request_headers["Content-Length"] = str(len(body))
            request = [
                f"{method} {endpoint.request_path(suffix)} HTTP/1.1\r\n".encode("ascii")
            ]
            request.extend(
                f"{name}: {value}\r\n".encode("latin-1")
                for name, value in request_headers.items()
            )
            request.append(b"\r\n")
            if body is not None:
                request.append(body)
            connection.sendall(b"".join(request))
            response = http.client.HTTPResponse(connection)
            response.begin()
            content_length = response.getheader("content-length")
            if content_length is not None:
                try:
                    if int(content_length) > self._max_response_bytes:
                        raise AppError("AI_RESPONSE_TOO_LARGE", "AI 渠道响应超过大小上限", 502)
                except ValueError as error:
                    raise AppError("AI_RESPONSE_INVALID", "AI 渠道响应长度无效", 502) from error
            response_body = response.read(self._max_response_bytes + 1)
            if len(response_body) > self._max_response_bytes:
                raise AppError("AI_RESPONSE_TOO_LARGE", "AI 渠道响应超过大小上限", 502)
            return PinnedResponse(
                status_code=response.status,
                headers={name.casefold(): value for name, value in response.getheaders()},
                body=response_body,
            )
        except AppError:
            raise
        except TimeoutError as error:
            raise AppError("AI_PROVIDER_TIMEOUT", "AI 渠道请求超时", 504) from error
        except (OSError, http.client.HTTPException) as error:
            raise AppError("AI_PROVIDER_UNAVAILABLE", "AI 渠道网络请求失败", 502) from error
        finally:
            connection.close()

    def _connect(self, endpoint: ResolvedEndpoint, timeout_seconds: int) -> socket.socket:
        """仅在 HTTP 字节尚未发送前依次尝试本次解析批准的地址。"""
        last_error: BaseException | None = None
        for address in endpoint.addresses:
            connection: socket.socket | None = None
            try:
                connection = self._connector(address, timeout_seconds)
                peer_ip = _canonical_ip(connection.getpeername()[0])
                if peer_ip not in endpoint.approved_ips:
                    raise AppError("AI_URL_FORBIDDEN", "AI 渠道实际连接地址不在批准集合", 422)
                if endpoint.scheme == "https":
                    connection = self._tls_wrapper(connection, endpoint.hostname)
                return connection
            except AppError:
                if connection is not None:
                    connection.close()
                raise
            except OSError as error:
                last_error = error
                if connection is not None:
                    connection.close()
        if isinstance(last_error, TimeoutError):
            raise AppError("AI_PROVIDER_TIMEOUT", "AI 渠道请求超时", 504) from last_error
        raise AppError("AI_PROVIDER_UNAVAILABLE", "AI 渠道网络请求失败", 502) from last_error
