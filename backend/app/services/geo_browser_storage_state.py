"""人工导入的 Playwright storage state 的唯一校验边界。"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

from app.errors import AppError

MAX_STORAGE_STATE_BYTES = 128 * 1024
_COOKIE_FIELDS = {"name", "value", "domain", "path", "expires", "httpOnly", "secure", "sameSite"}


def _invalid() -> AppError:
    return AppError("GEO_BROWSER_SESSION_INVALID", "浏览器会话资料不符合安全契约", 422)


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


def _reject_constant(_value: str) -> None:
    raise ValueError


def _https_origin(value: str, *, website: bool = False) -> tuple[str, str]:
    if not isinstance(value, str) or any(ord(character) <= 32 for character in value):
        raise ValueError
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise ValueError
    if "\\" in value or (not website and (parsed.path or parsed.query or parsed.fragment)):
        raise ValueError
    hostname = parsed.hostname.encode("idna").decode("ascii").lower()
    port = parsed.port
    if port is not None and not 1 <= port <= 65535:
        raise ValueError
    authority = f"[{hostname}]" if ":" in hostname else hostname
    if port is not None and port != 443:
        authority += f":{port}"
    return hostname, f"https://{authority}"


def validate_storage_state(
    value: str, website_url: str, expires_at: datetime, now: datetime
) -> str:
    """只接收单一 Surface 的资料；期限和域名失败不回显秘密或字段值。"""
    try:
        if (
            not isinstance(value, str)
            or len(value.encode("utf-8")) > MAX_STORAGE_STATE_BYTES
            or expires_at.utcoffset() is None
            or now.utcoffset() is None
            or not now < expires_at <= now + timedelta(days=30)
        ):
            raise ValueError
        hostname, origin = _https_origin(website_url, website=True)
        state = json.loads(value, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
        if not isinstance(state, dict) or set(state) != {"cookies", "origins"}:
            raise ValueError
        if not isinstance(state["cookies"], list) or not isinstance(state["origins"], list):
            raise ValueError
        cookie_identities: set[tuple[str, str, str]] = set()
        for cookie in state["cookies"]:
            if not isinstance(cookie, dict) or set(cookie) != _COOKIE_FIELDS:
                raise ValueError
            if any(
                not isinstance(cookie[field], str) for field in ("name", "value", "domain", "path")
            ):
                raise ValueError
            domain = cookie["domain"]
            if domain.startswith("."):
                domain = domain[1:]
            if domain.lower() != hostname or not cookie["path"].startswith("/"):
                raise ValueError
            if type(cookie["httpOnly"]) is not bool or type(cookie["secure"]) is not bool:
                raise ValueError
            if cookie["sameSite"] not in ("Strict", "Lax", "None"):
                raise ValueError
            expiry = cookie["expires"]
            if type(expiry) not in (int, float) or not math.isfinite(expiry):
                raise ValueError
            if expiry != -1 and (expiry <= now.timestamp() or expiry < expires_at.timestamp()):
                raise ValueError
            identity = (cookie["name"], cookie["domain"].lower(), cookie["path"])
            if identity in cookie_identities:
                raise ValueError
            cookie_identities.add(identity)
        origins_seen: set[str] = set()
        record_count = len(state["cookies"])
        for entry in state["origins"]:
            if not isinstance(entry, dict) or set(entry) != {"origin", "localStorage"}:
                raise ValueError
            _, entry_origin = _https_origin(entry["origin"])
            if entry_origin != origin or entry_origin in origins_seen:
                raise ValueError
            origins_seen.add(entry_origin)
            if not isinstance(entry["localStorage"], list):
                raise ValueError
            names: set[str] = set()
            for item in entry["localStorage"]:
                if (
                    not isinstance(item, dict)
                    or set(item) != {"name", "value"}
                    or not isinstance(item["name"], str)
                    or not isinstance(item["value"], str)
                    or item["name"] in names
                ):
                    raise ValueError
                names.add(item["name"])
            record_count += len(entry["localStorage"])
        if not record_count:
            raise ValueError
        canonical = json.dumps(state, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        if len(canonical.encode("utf-8")) > MAX_STORAGE_STATE_BYTES:
            raise ValueError
        return canonical
    except (ValueError, TypeError, AttributeError, OverflowError, RecursionError):
        # JSON/编码异常可能包含 Cookie 或 localStorage；禁止保留异常链。
        raise _invalid() from None
