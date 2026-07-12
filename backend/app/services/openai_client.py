"""OpenAI-compatible Chat Completions 的唯一 HTTP 与网络安全边界。"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from app.errors import AppError
from app.schemas import GeneratedDraft
from app.services.pinned_http import HTTPTransport, PinnedHTTPTransport, PinnedResponse

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
    if not value or any(
        ord(character) < 32 or ord(character) == 127 or ord(character) > 255
        for character in value
    ):
        raise AppError("INVALID_HEADER", "Header 值不能为空或包含控制字符", 422)
    return normalized


def validate_base_url(value: str, *, allow_local_http: bool) -> str:
    """规范化 API 根地址，并拒绝不允许的协议、地址和 URL 部件。"""
    return PinnedHTTPTransport(allow_local_http=allow_local_http).validate_url(value)


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
        self,
        *,
        allow_local_http: bool,
        transport: HTTPTransport | None = None,
    ) -> None:
        self._transport = transport or PinnedHTTPTransport(
            allow_local_http=allow_local_http
        )

    def _request(
        self,
        method: str,
        base_url: str,
        suffix: str,
        api_key: str,
        headers: dict[str, str],
        timeout_seconds: int,
        json_body: dict[str, Any] | None = None,
    ) -> PinnedResponse:
        if any(
            ord(character) < 32 or ord(character) == 127 or ord(character) > 255
            for character in api_key
        ):
            raise AppError("AI_CREDENTIAL_INVALID", "AI 渠道凭据包含非法字符", 409)
        normalized_headers: dict[str, str] = {}
        for name, value in headers.items():
            normalized = validate_header(name, value)
            if normalized in normalized_headers:
                raise AppError("INVALID_HEADER", "Header 名称不能重复", 422)
            normalized_headers[normalized] = value
        request_headers = {"Authorization": f"Bearer {api_key}", **headers}
        response = self._transport.request(
            method=method,
            base_url=base_url,
            suffix=suffix,
            headers=request_headers,
            timeout_seconds=timeout_seconds,
            body=(
                json.dumps(json_body, ensure_ascii=False, separators=(",", ":")).encode()
                if json_body is not None
                else None
            ),
        )
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
            data = json.loads(response.body)["data"]
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
            payload = json.loads(response.body)
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
