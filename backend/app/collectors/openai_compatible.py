"""一次调用一个原始问题的 OpenAI-compatible GEO Collector。"""

from __future__ import annotations

import json
import math
import re
from base64 import b64encode
from collections.abc import Mapping
from types import MappingProxyType
from urllib.parse import quote, quote_from_bytes
from uuid import UUID

from pydantic import TypeAdapter

from app.collectors.base import SendAuthorization
from app.collectors.contracts import CollectedAnswer, CollectionEstimate, CollectionRequest
from app.collectors.errors import CollectorError, CollectorStage
from app.collectors.openai_response import parse_response
from app.collectors.registry import (
    CollectionProfileSnapshot,
    CollectorRegistration,
    ProfileBlocker,
    ProfileBlockerCode,
    collector_registry,
)
from app.errors import AppError
from app.schemas.geo_runs import GeoExternalCallState as State
from app.schemas.geo_runs import GeoRunDataClassification
from app.schemas.geo_runs import GeoRunErrorCode as Code
from app.services.ai_provider import AIProvider, RawChatCompletionResult, validate_header

# 只支持非指令数值配置，不能把模型生成 settings/tools/额外 messages 带进监测问题。
_NUMERIC_PARAMETERS = {
    "temperature": (0, 2),
    "top_p": (0, 1),
    "presence_penalty": (-2, 2),
    "frequency_penalty": (-2, 2),
}
_INTEGER_PARAMETERS = {"max_tokens", "max_completion_tokens", "seed", "n"}
_ANSWER: TypeAdapter[CollectedAnswer] = TypeAdapter(CollectedAnswer)


def _percent_encoding(value: bytes) -> bytes:
    """只规范检测副本的 URL escape；大小写等价编码不能绕过已知凭据检查。"""
    return re.sub(rb"%[0-9a-fA-F]{2}", lambda match: match.group().upper(), value)


def _configuration_error() -> CollectorError:
    return CollectorError(
        Code.COLLECTOR_CONFIGURATION_INVALID,
        stage=CollectorStage.CONFIGURATION,
        external_call_state=State.NOT_STARTED,
    )


def _parameters(value: Mapping[str, object]) -> dict[str, object]:
    params = dict(value)
    for key, setting in params.items():
        if key in _NUMERIC_PARAMETERS:
            low, high = _NUMERIC_PARAMETERS[key]
            if (
                type(setting) not in {int, float}
                or not isinstance(setting, (int, float))
                or not low <= setting <= high
                or not math.isfinite(setting)
            ):
                raise _configuration_error()
        elif key in _INTEGER_PARAMETERS:
            if type(setting) is not int or not isinstance(setting, int):
                raise _configuration_error()
            if key.startswith("max_") and not 1 <= setting <= 65536:
                raise _configuration_error()
            if key == "n" and setting != 1:
                raise _configuration_error()
            if key == "seed" and not -(2**63) <= setting < 2**63:
                raise _configuration_error()
        else:
            raise _configuration_error()
    if "max_tokens" in params and "max_completion_tokens" in params:
        raise _configuration_error()
    return params


class OpenAICompatibleGeoCollector:
    """配置仅驻留本次调用内存；调用方拥有当前资格、凭据解密和发送授权事务。"""

    def __init__(
        self,
        *,
        channel_id: UUID,
        model_id: UUID,
        protocol_type: str,
        base_url: str,
        provider_model: str,
        api_key: str,
        headers: Mapping[str, str] | None = None,
        sensitive_headers: Mapping[str, str] | None = None,
        request_parameters: Mapping[str, object] | None = None,
        allow_local_http: bool = False,
        environment: str = "production",
        provider: AIProvider | None = None,
    ) -> None:
        self._registration = collector_registry.resolve("openai-compatible-chat")
        if (
            not isinstance(channel_id, UUID)
            or not isinstance(model_id, UUID)
            or protocol_type != self._registration.model_protocol
            or environment not in self._registration.environments
            or (allow_local_http and environment not in {"development", "test"})
            or not provider_model.strip()
            or len(provider_model) > 200
            or any(ord(c) < 32 or ord(c) == 127 for c in provider_model)
            or not api_key
            or any(ord(c) < 33 or ord(c) > 126 for c in api_key)
        ):
            raise _configuration_error()
        clean_headers: dict[str, str] = {}
        secrets = {api_key, *(sensitive_headers or {}).values()}
        try:
            for name, value in [*(headers or {}).items(), *(sensitive_headers or {}).items()]:
                normalized = validate_header(name, value)
                if normalized in clean_headers or normalized in {"content-type", "accept-encoding"}:
                    raise _configuration_error()
                clean_headers[normalized] = value
                if normalized in {"cookie", "set-cookie", "proxy-authorization"}:
                    secrets.add(value)
            params = _parameters(request_parameters or {})
        except AppError:
            raise _configuration_error() from None
        self._channel_id = channel_id
        self._model_id = model_id
        self._base_url = base_url
        self._api_key = api_key
        self._provider_model = provider_model
        self._headers = MappingProxyType(clean_headers)
        self._parameters = MappingProxyType(params)
        # 检查允许返回的全部字段，不修改原文；已知凭据回显必须使整个结果失败。
        variants = {
            encoded
            for value in secrets
            for encoded in (
                value, quote(value, safe=""), quote_from_bytes(value.encode("latin-1"), safe=""),
                json.dumps(value, ensure_ascii=True)[1:-1],
                b64encode(value.encode("utf-8")).decode("ascii"),
                b64encode(value.encode("latin-1")).decode("ascii"),
            )
        }
        self._secret_needles = frozenset(
            _percent_encoding(wire.encode("utf-8"))
            for value in variants
            for wire in (
                value, json.dumps(value, ensure_ascii=True)[1:-1],
                json.dumps(value, ensure_ascii=False)[1:-1],
            )
        )
        self._provider = provider or AIProvider(allow_local_http=allow_local_http)

    @property
    def registration(self) -> CollectorRegistration:
        return self._registration

    def validate_profile(self, profile: CollectionProfileSnapshot) -> tuple[ProfileBlocker, ...]:
        blockers = self.registration.validate_profile(profile)
        if profile.ai_channel_id != self._channel_id or profile.ai_model_id != self._model_id:
            blockers += (ProfileBlocker(ProfileBlockerCode.MODEL_BINDING_INVALID, "ai_model_id"),)
        return blockers

    def estimate(self, request: CollectionRequest) -> CollectionEstimate:
        return CollectionEstimate(cost=None)

    def collect(
        self, request: CollectionRequest, *, before_send: SendAuthorization
    ) -> CollectedAnswer:
        profile = request.profile
        if (
            profile.adapter_key != self.registration.key
            or profile.adapter_version != self.registration.version
            or profile.collection_mode != self.registration.collection_mode
            or profile.login_state not in self.registration.login_states
            or profile.web_search_policy not in self.registration.web_search_policies
            or profile.ai_channel_id != self._channel_id
            or profile.ai_model_id != self._model_id
            or request.engine_surface.surface_kind not in self.registration.surface_kinds
        ):
            raise _configuration_error()
        # 当前没有非 PUBLIC 外发授权合同；不能把预算或品牌监测授权当成数据外发授权。
        if request.data_classification != GeoRunDataClassification.PUBLIC:
            raise CollectorError(
                Code.DATA_CLASSIFICATION_FORBIDDEN,
                stage=CollectorStage.CONFIGURATION,
                external_call_state=State.NOT_STARTED,
            )
        params = dict(self._parameters)
        settings = dict(profile.settings)
        if settings.get("temperature") is not None:
            params["temperature"] = settings["temperature"]
        if settings.get("max_output_tokens") is not None:
            key = "max_completion_tokens" if "max_completion_tokens" in params else "max_tokens"
            params[key] = settings["max_output_tokens"]
        try:
            request.prompt_text.encode("utf-8")
            params = _parameters(params)
        except (ValueError, UnicodeError):
            raise _configuration_error() from None
        authorizing = False
        authorized = False

        def authorize() -> None:
            nonlocal authorizing, authorized
            authorizing = True
            before_send()
            authorized = True
            authorizing = False

        try:
            response = self._provider.raw_chat_completion(
                base_url=self._base_url,
                api_key=self._api_key,
                headers=dict(self._headers),
                timeout_seconds=request.timeout_seconds,
                model_id=self._provider_model,
                messages=[{"role": "user", "content": request.prompt_text}],
                request_parameters=params,
                before_send=authorize,
            )
        except AppError:
            if authorizing:
                raise
            raise CollectorError(
                (Code.COLLECTOR_UNKNOWN_OUTCOME if authorized
                 else Code.COLLECTOR_CONFIGURATION_INVALID),
                stage=CollectorStage.RECEIVE if authorized else CollectorStage.CONFIGURATION,
                external_call_state=State.UNKNOWN if authorized else State.NOT_STARTED,
            ) from None
        # 官方 raw-response 已完整接收；大小上限保护业务解析/落库，不能限制接收内存。
        if len(response.body) > request.max_response_bytes:
            raise CollectorError(
                Code.PROVIDER_RESPONSE_TOO_LARGE,
                stage=CollectorStage.RECEIVE,
                external_call_state=State.COMPLETED,
            )
        _check_status(response)
        result = parse_response(
            response.body,
            provider_request_id=response.provider_request_id,
            duration_ms=response.duration_ms,
        )
        safe_payload = _percent_encoding(_ANSWER.dump_json(result))
        if any(needle in safe_payload for needle in self._secret_needles):
            raise CollectorError(
                Code.PROVIDER_RESPONSE_INVALID,
                stage=CollectorStage.PARSE,
                external_call_state=State.COMPLETED,
            )
        return result


def _check_status(response: RawChatCompletionResult) -> None:
    status = response.status_code
    if not 100 <= status <= 599:
        raise CollectorError(
            Code.PROVIDER_RESPONSE_INVALID,
            stage=CollectorStage.RECEIVE,
            external_call_state=State.COMPLETED,
        )
    if 200 <= status < 300:
        return
    retry_after = None
    if status in {401, 403}:
        code = Code.PROVIDER_AUTH_FAILED
    elif status == 429:
        code = Code.PROVIDER_RATE_LIMITED
        retry_after = response.retry_after_seconds
    elif 500 <= status < 600:
        code = Code.PROVIDER_UNAVAILABLE
    else:
        code = Code.PROVIDER_RESPONSE_INVALID
    raise CollectorError(
        code,
        stage=CollectorStage.RECEIVE,
        external_call_state=State.COMPLETED,
        provider_status=status,
        retry_after_seconds=retry_after,
    )
