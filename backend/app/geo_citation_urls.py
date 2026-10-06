"""原始引用的确定性 URL 身份；不请求页面或判断来源归属。"""

import ipaddress
import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit, urlunsplit

import idna


@dataclass(frozen=True)
class CitationUrl:
    original_url: str
    normalized_url: str
    hostname: str


@dataclass
class CitationUrlMemo:
    """只在一次读取中复用确定性URL校验；不共享身份、位置或可写指标。"""

    values: dict[str, CitationUrl] = field(default_factory=dict)

    def normalize(self, value: str) -> CitationUrl:
        result = self.values.get(value)
        if result is None:
            result = normalize_citation_url(value)
            self.values[value] = result
        return result


def normalize_citation_url(value: str) -> CitationUrl:
    """保留 query 顺序/值；没有批准的追踪参数清单就不删除参数。"""
    if not 1 <= len(value) <= 2083 or any(
        c.isspace() or ord(c) < 32 or ord(c) == 127 for c in value
    ):
        raise ValueError("引用 URL 长度或空白无效")
    if "\\" in value or re.search(r"%(?![0-9a-fA-F]{2})|%[01][0-9a-f]|%7f", value, re.I):
        raise ValueError("引用 URL 不允许反斜线、控制字符或无效转义")
    try:
        parts = urlsplit(value)
        if parts.scheme.lower() not in {"http", "https"} or not parts.hostname:
            raise ValueError("引用必须使用 HTTP(S) 和有效主机名")
        if parts.username is not None or parts.password is not None:
            raise ValueError("引用 URL 不允许认证信息")
        host = parts.hostname.removesuffix(".")
        try:
            hostname = ipaddress.ip_address(host).compressed
        except ValueError:
            hostname = idna.encode(host, uts46=True, std3_rules=True).decode("ascii").lower()
        if "%" in hostname or len(hostname) > 253:
            raise ValueError("引用主机名无效")
        port = parts.port
        if port is not None and not 1 <= port <= 65535:
            raise ValueError("引用端口无效")
        authority = f"[{hostname}]" if ":" in hostname else hostname
        if port is not None and (parts.scheme.lower(), port) not in {("http", 80), ("https", 443)}:
            authority += f":{port}"
        normalized = urlunsplit(
            (parts.scheme.lower(), authority, parts.path or "/", parts.query, "")
        )
        if len(normalized) > 2083:
            raise ValueError("规范引用 URL 过长")
        return CitationUrl(value, normalized, hostname)
    except (ValueError, idna.IDNAError, UnicodeError) as error:
        raise ValueError("引用 URL 无效或包含不允许的信息") from error
