"""Catalog 字典的信任边界：保留型号区别，不访问网络。"""

import re
import unicodedata

import idna

LANGUAGE_PATTERN = r"^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$"
IP_LITERAL_PATTERN = r"^(?:[0-9]+\.){3}[0-9]+$"
HOSTNAME_PATTERN = (
    r"^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+"
    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$"
)


def _catalog_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split())


def catalog_search_key(value: str) -> str:
    """当前 Product/显示名称的搜索键；读取不施加 Catalog 写入长度限制。"""
    return _catalog_text(value).casefold()


def normalize_catalog_text(value: str) -> str:
    """显示值与匹配键都限长；不删除连字符、标点或型号后缀。"""
    normalized = _catalog_text(value)
    if not 1 <= len(normalized) <= 240:
        raise ValueError("名称或别名必须为 1 到 240 个字符")
    return normalized


def catalog_text_key(value: str) -> str:
    key = normalize_catalog_text(value).casefold()
    if len(key) > 240:
        raise ValueError("名称或别名的规范键不得超过 240 个字符")
    return key


def normalize_catalog_identity(value: str) -> str:
    normalized = normalize_catalog_text(value)
    catalog_text_key(normalized)
    return normalized


def normalize_language_code(value: str) -> str:
    if not 2 <= len(value) <= 16 or re.fullmatch(LANGUAGE_PATTERN, value) is None:
        raise ValueError("语言标签必须为受控的语言子标签及可选连字符子标签")
    return value.lower()


def normalize_catalog_hostname(value: str) -> str:
    """IDNA2008/UTS #46 非 transitional + STD3；拒绝尾点及不可回解 A-label。"""
    if not 3 <= len(value) <= 253 or any(c.isspace() or c in "/:@?#*\\" for c in value):
        raise ValueError("域名必须是不含空白、协议、路径、端口或通配符的主机名")
    try:
        hostname = (
            idna.encode(value, uts46=True, std3_rules=True, transitional=False)
            .decode("ascii")
            .lower()
        )
        decoded = idna.decode(hostname, strict=True)
        if idna.encode(decoded, strict=True).decode("ascii") != hostname:
            raise ValueError("域名不能完成 IDNA 往返校验")
    except (idna.IDNAError, UnicodeError) as error:
        raise ValueError("域名不是有效的 IDNA 主机名") from error
    if re.fullmatch(HOSTNAME_PATTERN, hostname) is None or re.fullmatch(
        IP_LITERAL_PATTERN, hostname
    ):
        raise ValueError("域名必须包含至少两个合法 DNS 标签，且不能为 IP 或带尾点")
    return hostname


def require_catalog_hostname(value: str) -> str:
    """读取边界不悄悄修复持久化字典。"""
    if normalize_catalog_hostname(value) != value:
        raise ValueError("持久化域名必须是规范 lowercase ASCII IDNA 主机名")
    return value
