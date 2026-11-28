"""官方同步 SDK 的薄业务边界，组合出站 SSRF 校验与流式响应大小上限。"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx2
from openai import (
    APIConnectionError,
    APIResponseValidationError,
    APIStatusError,
    APITimeoutError,
    DefaultHttpxClient,
    OpenAI,
)
from openai.types.chat import ChatCompletionMessageParam
from pydantic import BaseModel, ValidationError

from app.errors import AppError
from app.services.ai_http_transport import (
    AIResponseEncodingError,
    AIResponseTooLargeError,
    GuardedAITransport,
    staged_timeout,
)
from app.services.outbound_url_guard import (
    OutboundTarget,
    OutboundUrlError,
    PinnedOutboundTarget,
    ResolveHost,
    resolve_outbound_target,
    validate_outbound_url_syntax,
)

HEADER_NAME_PATTERN = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
RESERVED_HEADERS = {
    "authorization",
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
    "accept-encoding",
}
_ALLOWED_AI_SCHEMES = frozenset({"https"})

DEFAULT_DISCOVER_MODELS_MAX_BYTES = 2 * 1024 * 1024  # 2 MiB
DEFAULT_TEST_CONNECTION_MAX_BYTES = 1 * 1024 * 1024  # 1 MiB
DEFAULT_CHAT_COMPLETION_MAX_BYTES = 4 * 1024 * 1024  # 4 MiB
DEFAULT_RAW_COMPLETION_MAX_BYTES = 2 * 1024 * 1024  # 2 MiB

# SDK/传输调试日志不属于业务诊断边界，不能让敏感 Header 或供应商正文进入日志。
for _namespace in ("openai", "httpx2", "httpcore2"):
    _logger = logging.getLogger(_namespace)
    _logger.addHandler(logging.NullHandler())
    _logger.propagate = False


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


def _parse_ai_base_url(value: str, *, allow_local_http: bool) -> OutboundTarget:
    """执行无 DNS 的 AI 渠道静态 URL 校验；生产强制 HTTPS（允许自定义端口）并拒绝非公网字面量。"""
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道地址包含非法字符", 422)
    try:
        parts = urlsplit(value)
    except ValueError:
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道地址必须是有效 HTTP(S) 根地址", 422) from None
    if parts.username is not None or parts.password is not None:
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道地址不能包含凭据、查询或片段", 422)
    try:
        return validate_outbound_url_syntax(
            value,
            allowed_schemes=_ALLOWED_AI_SCHEMES,
            allowed_ports=None,
            allow_query_or_fragment=False,
            allow_local_http=allow_local_http,
            strip_trailing_slash=True,
            reject_outer_whitespace=True,
        )
    except OutboundUrlError:
        raise AppError("AI_URL_FORBIDDEN", "AI 渠道地址不符合公网 HTTPS 安全要求", 422) from None


def validate_base_url(value: str, *, allow_local_http: bool) -> str:
    """静态校验 AI 渠道根地址（不解析 DNS，拒非公网字面量与保留主机，允许自定义 HTTPS 端口）。"""
    return _parse_ai_base_url(value, allow_local_http=allow_local_http).normalized_url


@dataclass(frozen=True)
class ChatCompletionResult:
    """SDK 返回到业务层的文本与可空用量；不包含原始响应或 Header。"""

    content: str
    provider_request_id: str | None
    duration_ms: int
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None


@dataclass(frozen=True, repr=False)
class RawChatCompletionResult:
    """仅驻留请求内存的原始响应；传输层已执行流式大小上限，业务解析器继续校验载荷。"""

    body: bytes
    status_code: int
    provider_request_id: str | None
    retry_after_seconds: int | None
    duration_ms: int


def _response_payload(response: object) -> dict[str, Any]:
    """SDK 宽松响应解析不能替代业务字段校验，也不能打印包含原始值的 warning。"""
    if not isinstance(response, BaseModel):
        raise AppError("AI_RESPONSE_INVALID", "AI 渠道响应结构无效", 502)
    return response.model_dump(warnings=False)


@contextmanager
def _sdk_errors() -> Iterator[None]:
    try:
        yield
    except AIResponseTooLargeError:
        raise AppError("AI_RESPONSE_TOO_LARGE", "AI 渠道响应体超过允许大小上限", 502) from None
    except AIResponseEncodingError:
        raise AppError("AI_RESPONSE_INVALID", "AI 渠道响应编码不受支持", 502) from None
    except APITimeoutError:
        raise AppError("AI_PROVIDER_TIMEOUT", "AI 渠道请求超时", 504) from None
    except APIConnectionError:
        raise AppError("AI_PROVIDER_UNAVAILABLE", "AI 渠道网络请求失败", 502) from None
    except APIStatusError as error:
        if 300 <= error.status_code < 400:
            raise AppError("AI_REDIRECT_FORBIDDEN", "AI 渠道返回了禁止的重定向", 502) from None
        raise AppError(
            "AI_PROVIDER_ERROR", f"AI 渠道返回 HTTP {error.status_code}", 502
        ) from None
    except (
        APIResponseValidationError,
        json.JSONDecodeError,
        UnicodeDecodeError,
        ValidationError,
    ):
        raise AppError("AI_RESPONSE_INVALID", "AI 渠道响应结构无效", 502) from None


class AIProvider:
    """每次调用独立创建并关闭客户端；不重试、不跟随重定向，内置 SSRF 防护与流式上限。"""

    def __init__(
        self,
        *,
        allow_local_http: bool,
        transport: httpx2.BaseTransport | None = None,
        resolve_host: ResolveHost | None = None,
    ) -> None:
        self._allow_local_http = allow_local_http
        self._transport = transport
        self._resolve_host = resolve_host

    @contextmanager
    def _client(
        self,
        *,
        base_url: str,
        api_key: str,
        headers: dict[str, str],
        timeout_seconds: int,
        max_response_bytes: int,
    ) -> Iterator[OpenAI]:
        if max_response_bytes <= 0:
            raise AppError("VALIDATION_ERROR", "AI 响应大小上限必须为正整数", 422)
        target = _parse_ai_base_url(base_url, allow_local_http=self._allow_local_http)
        if not api_key or any(
            ord(character) < 32 or ord(character) == 127 or ord(character) > 255
            for character in api_key
        ):
            raise AppError("AI_CREDENTIAL_INVALID", "AI 渠道凭据包含非法字符", 409)
        if os.environ.get("OPENAI_CUSTOM_HEADERS"):
            raise AppError("INVALID_HEADER", "不允许通过 OPENAI_CUSTOM_HEADERS 配置 AI Header", 422)
        normalized_names: set[str] = set()
        for name, value in headers.items():
            normalized = validate_header(name, value)
            # 该 SDK 控制值决定 raw-response 返回类型，管理员 Header 不能覆盖。
            if normalized == "x-stainless-raw-response":
                raise AppError("INVALID_HEADER", "Header 名称由 SDK 保留", 422)
            if normalized in normalized_names:
                raise AppError("INVALID_HEADER", "Header 名称不能重复", 422)
            normalized_names.add(normalized)

        pinned_target: PinnedOutboundTarget | None = None
        if not target.is_local_http and (self._transport is None or self._resolve_host is not None):
            try:
                pinned_target = resolve_outbound_target(target, resolve_host=self._resolve_host)
            except OutboundUrlError as error:
                if error.code == "DNS_RESOLUTION_FAILED":
                    raise AppError("AI_PROVIDER_UNAVAILABLE", "AI 渠道域名解析失败", 502) from None
                raise AppError(
                    "AI_URL_FORBIDDEN", "AI 渠道地址解析到禁止访问的非公网地址", 422
                ) from None

        # 公共 HTTP 客户端 hook 保留既有 Latin-1 Header 合同，且固定 Accept-Encoding: identity。
        encoded_headers = httpx2.Headers(
            {
                "Authorization": f"Bearer {api_key}",
                "Accept-Encoding": "identity",
                **headers,
            },
            encoding="latin-1",
        )

        def apply_headers(request: httpx2.Request) -> None:
            request.headers.update(encoded_headers)

        owns_inner = self._transport is None
        inner_transport: httpx2.BaseTransport = (
            self._transport
            if self._transport is not None
            else httpx2.HTTPTransport(
                trust_env=False,
                retries=0,
                limits=httpx2.Limits(max_keepalive_connections=0),
            )
        )
        guarded_transport = GuardedAITransport(
            inner=inner_transport,
            owns_inner=owns_inner,
            pinned_target=pinned_target,
            max_response_bytes=max_response_bytes,
            timeout_seconds=timeout_seconds,
        )
        timeout = staged_timeout(timeout_seconds)

        with (
            DefaultHttpxClient(
                timeout=timeout,
                follow_redirects=False,
                trust_env=False,
                transport=guarded_transport,
                event_hooks={"request": [apply_headers]},
            ) as http_client,
            OpenAI(
                base_url=target.normalized_url,
                api_key=api_key,
                organization="",
                project="",
                # SDK 默认以 ASCII 构造 Header；真正的 Latin-1 凭据由公开 hook 设置。
                default_headers={"Authorization": ""},
                timeout=timeout,
                max_retries=0,
                http_client=http_client,
            ) as client,
        ):
            yield client

    def discover_models(
        self,
        *,
        base_url: str,
        api_key: str,
        headers: dict[str, str],
        timeout_seconds: int,
        max_response_bytes: int = DEFAULT_DISCOVER_MODELS_MAX_BYTES,
    ) -> list[str]:
        """只返回去重后的远端 ID，不创建本地模型。"""
        with _sdk_errors(), self._client(
            base_url=base_url,
            api_key=api_key,
            headers=headers,
            timeout_seconds=timeout_seconds,
            max_response_bytes=max_response_bytes,
        ) as client:
            try:
                page = client.models.list()
            except (AttributeError, TypeError):
                # SDK 的宽松模型列表解析遇到非对象 JSON 也可能抛出结构错误。
                raise AppError("AI_RESPONSE_INVALID", "模型列表响应结构无效", 502) from None
            data = _response_payload(page).get("data")
        if not isinstance(data, list) or any(
            not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]
            for item in data
        ):
            raise AppError("AI_RESPONSE_INVALID", "模型列表响应结构无效", 502)
        return list(dict.fromkeys(item["id"] for item in data))

    def chat_completion(
        self,
        *,
        base_url: str,
        api_key: str,
        headers: dict[str, str],
        timeout_seconds: int,
        model_id: str,
        messages: Sequence[ChatCompletionMessageParam],
        request_parameters: dict[str, Any],
        max_response_bytes: int = DEFAULT_CHAT_COMPLETION_MAX_BYTES,
    ) -> ChatCompletionResult:
        """公开 Chat Completions 入口；业务正文解析继续由各调用者拥有。"""
        if {"model", "messages", "stream"}.intersection(request_parameters):
            raise AppError("VALIDATION_ERROR", "模型参数包含系统保留字段", 422)
        with _sdk_errors(), self._client(
            base_url=base_url,
            api_key=api_key,
            headers=headers,
            timeout_seconds=timeout_seconds,
            max_response_bytes=max_response_bytes,
        ) as client:
            started = time.monotonic()
            response = client.chat.completions.with_raw_response.create(
                model=model_id, messages=messages, stream=False, extra_body=request_parameters
            )
            duration_ms = max(0, round((time.monotonic() - started) * 1000))
            payload = _response_payload(response.parse())
            request_id = response.headers.get("x-request-id")
        try:
            content = payload["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise TypeError
        except (KeyError, IndexError, TypeError):
            raise AppError("AI_RESPONSE_INVALID", "Chat Completions 响应结构无效", 502) from None
        usage = payload.get("usage")
        if usage is not None and not isinstance(usage, dict):
            raise AppError("AI_RESPONSE_INVALID", "Chat Completions 用量结构无效", 502)

        def token(name: str) -> int | None:
            value = usage.get(name) if usage is not None else None
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                return value
            return None

        return ChatCompletionResult(
            content=content,
            provider_request_id=request_id,
            duration_ms=duration_ms,
            prompt_tokens=token("prompt_tokens"),
            completion_tokens=token("completion_tokens"),
            total_tokens=token("total_tokens"),
        )

    def raw_chat_completion(
        self,
        *,
        base_url: str,
        api_key: str,
        headers: dict[str, str],
        timeout_seconds: int,
        model_id: str,
        messages: Sequence[ChatCompletionMessageParam],
        request_parameters: dict[str, Any],
        before_send: Callable[[], None],
        max_response_bytes: int = DEFAULT_RAW_COMPLETION_MAX_BYTES,
    ) -> RawChatCompletionResult:
        """授权前完成 URL/DNS/SSRF 校验；授权成功进入外部窗口并由传输层执行流式字节上限。"""
        if {"model", "messages", "stream"}.intersection(request_parameters):
            raise AppError("VALIDATION_ERROR", "模型参数包含系统保留字段", 422)
        with self._client(
            base_url=base_url,
            api_key=api_key,
            headers=headers,
            timeout_seconds=timeout_seconds,
            max_response_bytes=max_response_bytes,
        ) as client:
            started = time.monotonic()
            # 回调在 SDK 异常映射之外，失败原样返回 owner，SDK 方法不会启动。
            before_send()
            try:
                response = client.chat.completions.with_raw_response.create(
                    model=model_id, messages=messages, stream=False, extra_body=request_parameters
                )
            except AIResponseTooLargeError:
                raise AppError(
                    "AI_RESPONSE_TOO_LARGE", "AI 渠道响应体超过允许大小上限", 502
                ) from None
            except AIResponseEncodingError:
                raise AppError("AI_RESPONSE_INVALID", "AI 渠道响应编码不受支持", 502) from None
            except APIStatusError as error:
                http_response = error.response
                status, body = error.status_code, http_response.content
                request_id = http_response.headers.get("x-request-id")
                retry_after = http_response.headers.get("retry-after", "")
            except APIConnectionError:
                # 包含 APITimeoutError；SDK 不提供可靠的首字节阶段，不能声明安全重发。
                raise AppError(
                    "AI_PROVIDER_UNKNOWN_OUTCOME", "AI 渠道外部请求结果未知", 502
                ) from None
            else:
                status, body = response.status_code, response.content
                request_id = response.headers.get("x-request-id")
                retry_after = response.headers.get("retry-after", "")
            return RawChatCompletionResult(
                body=body,
                status_code=status,
                provider_request_id=request_id,
                retry_after_seconds=(
                    int(retry_after)
                    if status == 429
                    and retry_after.isascii()
                    and retry_after.isdecimal()
                    and len(retry_after) <= 9
                    else None
                ),
                duration_ms=max(0, round((time.monotonic() - started) * 1000)),
            )

    def test_connection(
        self,
        *,
        base_url: str,
        api_key: str,
        headers: dict[str, str],
        timeout_seconds: int,
        model_id: str,
        request_parameters: dict[str, Any],
        max_response_bytes: int = DEFAULT_TEST_CONNECTION_MAX_BYTES,
    ) -> str:
        """一条 hi 用户消息足以验证连接，不套用生成草稿 Schema。"""
        return self.chat_completion(
            base_url=base_url,
            api_key=api_key,
            headers=headers,
            timeout_seconds=timeout_seconds,
            model_id=model_id,
            messages=[{"role": "user", "content": "hi"}],
            request_parameters=request_parameters,
            max_response_bytes=max_response_bytes,
        ).content
