"""OpenAI-compatible Chat Completions 的唯一 HTTP 与网络安全边界。"""

from __future__ import annotations

import ipaddress
import json
import re
import socket
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx
from pydantic import ValidationError

from app.errors import AppError
from app.schemas import GeneratedDraft

HEADER_NAME_PATTERN = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
RESERVED_HEADERS = {
    "authorization",
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
}


@dataclass(frozen=True)
class CompletionResult:
    """一次成功响应中允许进入业务层的非敏感结果。"""

    draft: GeneratedDraft
    provider_request_id: str | None
    duration_ms: int
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None


def validate_header(name: str, value: str) -> str:
    """校验 Header token、保留名和控制字符，返回小写唯一键。"""
    normalized = name.casefold()
    if not HEADER_NAME_PATTERN.fullmatch(name) or normalized in RESERVED_HEADERS:
        raise AppError("INVALID_HEADER", "Header 名称无效或属于系统保留字段", 422)
    if not value or any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise AppError("INVALID_HEADER", "Header 值不能为空或包含控制字符", 422)
    return normalized


def validate_base_url(value: str, *, allow_local_http: bool) -> str:
    """规范化 API 根地址，并拒绝不允许的协议、地址和 URL 部件。"""
    parsed = urlsplit(value)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname:
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道地址必须是 HTTP(S) 根地址", 422)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道地址不能包含凭据、查询或片段", 422)
    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(
                parsed.hostname,
                parsed.port or (443 if parsed.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        }
    except socket.gaierror as error:
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道域名无法解析", 422) from error
    if not addresses:
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道域名没有可连接地址", 422)
    parsed_addresses = [ipaddress.ip_address(item) for item in addresses]
    local_http = (
        parsed.scheme == "http"
        and allow_local_http
        and all(item.is_loopback for item in parsed_addresses)
    )
    if parsed.scheme == "http" and not local_http:
        raise AppError("AI_URL_FORBIDDEN", "HTTP AI 渠道只允许开发环境本机地址", 422)
    if not local_http and any(not item.is_global for item in parsed_addresses):
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道解析到了非公网地址", 422)
    path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def endpoint_url(base_url: str, suffix: str) -> str:
    """在保留版本前缀的前提下拼接固定协议路径。"""
    parsed = urlsplit(base_url)
    return urlunsplit((parsed.scheme, parsed.netloc, f"{parsed.path.rstrip('/')}/{suffix}", "", ""))


def parse_generated_draft(content: str) -> GeneratedDraft:
    """直接解析严格四字段 JSON，不做清理、提取或修复。"""
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as error:
        raise AppError("AI_RESPONSE_INVALID", "模型响应不是单个合法 JSON 对象", 502) from error
    try:
        return GeneratedDraft.model_validate(payload)
    except ValidationError as error:
        raise AppError("AI_RESPONSE_INVALID", "模型响应不符合严格四字段 Schema", 502) from error


class OpenAICompatibleClient:
    """执行无重试、无重定向、非流式的固定协议请求。"""

    def __init__(
        self, *, allow_local_http: bool, transport: httpx.BaseTransport | None = None
    ) -> None:
        self._allow_local_http = allow_local_http
        self._transport = transport

    def _request(
        self,
        method: str,
        base_url: str,
        suffix: str,
        api_key: str,
        headers: dict[str, str],
        timeout_seconds: int,
        json_body: dict[str, Any] | None = None,
    ) -> httpx.Response:
        validated = validate_base_url(base_url, allow_local_http=self._allow_local_http)
        request_headers = {"Authorization": f"Bearer {api_key}", **headers}
        try:
            with httpx.Client(
                follow_redirects=False, timeout=timeout_seconds, transport=self._transport
            ) as client:
                response = client.request(
                    method,
                    endpoint_url(validated, suffix),
                    headers=request_headers,
                    json=json_body,
                )
        except httpx.TimeoutException as error:
            raise AppError("AI_PROVIDER_TIMEOUT", "AI 渠道请求超时", 504) from error
        except httpx.HTTPError as error:
            raise AppError("AI_PROVIDER_UNAVAILABLE", "AI 渠道网络请求失败", 502) from error
        if 300 <= response.status_code < 400:
            raise AppError("AI_REDIRECT_FORBIDDEN", "AI 渠道返回了禁止的重定向", 502)
        if response.status_code >= 400:
            raise AppError(
                "AI_PROVIDER_ERROR", f"AI 渠道返回 HTTP {response.status_code}", 502
            )
        return response

    def discover_models(
        self,
        *,
        base_url: str,
        api_key: str,
        headers: dict[str, str],
        timeout_seconds: int,
    ) -> list[str]:
        """读取远端模型 ID，不创建本地配置。"""
        response = self._request(
            "GET", base_url, "models", api_key, headers, timeout_seconds
        )
        try:
            data = response.json()["data"]
            model_ids = [item["id"] for item in data]
        except (ValueError, KeyError, TypeError) as error:
            raise AppError("AI_RESPONSE_INVALID", "模型列表响应结构无效", 502) from error
        if not all(isinstance(item, str) and item for item in model_ids):
            raise AppError("AI_RESPONSE_INVALID", "模型列表包含无效 model_id", 502)
        return list(dict.fromkeys(model_ids))

    def complete(
        self,
        *,
        base_url: str,
        api_key: str,
        headers: dict[str, str],
        timeout_seconds: int,
        model_id: str,
        request_parameters: dict[str, Any],
        system_message: str,
        user_message: str,
    ) -> CompletionResult:
        """执行一次 Chat Completions 并提取严格正文与可用指标。"""
        body = {
            "model": model_id,
            "messages": [
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message},
            ],
            "stream": False,
            **request_parameters,
        }
        started = time.monotonic()
        response = self._request(
            "POST", base_url, "chat/completions", api_key, headers, timeout_seconds, body
        )
        duration_ms = max(0, round((time.monotonic() - started) * 1000))
        try:
            payload = response.json()
            content = payload["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise TypeError
            usage = payload.get("usage") or {}
            if not isinstance(usage, dict):
                raise TypeError
        except (ValueError, KeyError, IndexError, TypeError) as error:
            raise AppError("AI_RESPONSE_INVALID", "Chat Completions 响应结构无效", 502) from error

        def token(name: str) -> int | None:
            value = usage.get(name)
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                return value
            return None

        return CompletionResult(
            draft=parse_generated_draft(content),
            provider_request_id=response.headers.get("x-request-id"),
            duration_ms=duration_ms,
            prompt_tokens=token("prompt_tokens"),
            completion_tokens=token("completion_tokens"),
            total_tokens=token("total_tokens"),
        )
