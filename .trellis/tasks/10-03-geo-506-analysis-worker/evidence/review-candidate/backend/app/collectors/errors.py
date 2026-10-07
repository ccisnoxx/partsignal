"""稳定 Collector 异常；发送状态必须显式提供，供应商正文不进入摘要。"""

from enum import StrEnum
from types import MappingProxyType
from typing import Annotated

from pydantic import ConfigDict, Field
from pydantic.dataclasses import dataclass

from app.schemas.geo_runs import GeoExternalCallState, GeoRunErrorCode, GeoRunErrorStage


class CollectorStage(StrEnum):
    CONFIGURATION = "CONFIGURATION"
    CONNECT = "CONNECT"
    SEND = "SEND"
    RECEIVE = "RECEIVE"
    PARSE = "PARSE"
    EVIDENCE = "EVIDENCE"


class CollectorRetryability(StrEnum):
    SAFE_BEFORE_SEND = "SAFE_BEFORE_SEND"
    NEW_ATTEMPT_ONLY = "NEW_ATTEMPT_ONLY"
    NOT_RETRYABLE = "NOT_RETRYABLE"


_MESSAGES = MappingProxyType(
    {
        GeoRunErrorCode.COLLECTOR_CONFIGURATION_INVALID: "采集配置无效",
        GeoRunErrorCode.COLLECTOR_DISABLED: "采集能力已关闭",
        GeoRunErrorCode.PROVIDER_AUTH_FAILED: "供应商认证失败",
        GeoRunErrorCode.PROVIDER_RATE_LIMITED: "供应商请求限流",
        GeoRunErrorCode.PROVIDER_TIMEOUT: "供应商请求超时",
        GeoRunErrorCode.PROVIDER_UNAVAILABLE: "供应商服务不可用",
        GeoRunErrorCode.PROVIDER_RESPONSE_INVALID: "供应商回答格式无效",
        GeoRunErrorCode.PROVIDER_RESPONSE_TOO_LARGE: "供应商回答超过大小限制",
        GeoRunErrorCode.COLLECTOR_UNKNOWN_OUTCOME: "外部请求结果未知，禁止自动重发",
        GeoRunErrorCode.DATA_CLASSIFICATION_FORBIDDEN: "数据分级禁止外发",
        GeoRunErrorCode.PROFILE_NEEDS_REAUTH: "采集会话需要重新认证",
    }
)
_NON_RETRYABLE = frozenset(
    {
        GeoRunErrorCode.COLLECTOR_CONFIGURATION_INVALID,
        GeoRunErrorCode.COLLECTOR_DISABLED,
        GeoRunErrorCode.PROVIDER_AUTH_FAILED,
        GeoRunErrorCode.DATA_CLASSIFICATION_FORBIDDEN,
        GeoRunErrorCode.PROFILE_NEEDS_REAUTH,
    }
)


@dataclass(
    frozen=True,
    config=ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True),
)
class CollectorFailure:
    code: GeoRunErrorCode
    stage: CollectorStage
    external_call_state: GeoExternalCallState
    provider_status: Annotated[int, Field(ge=100, le=599)] | None = None
    retry_after_seconds: Annotated[int, Field(ge=0)] | None = None

    def __post_init__(self) -> None:
        if self.code not in _MESSAGES:
            raise ValueError("错误码不属于 Collector，不能映射分析、业务或 Worker 失败")
        if self.stage in {CollectorStage.CONFIGURATION, CollectorStage.CONNECT}:
            if self.external_call_state != GeoExternalCallState.NOT_STARTED:
                raise ValueError("配置或连接阶段必须确认尚未发送")
        elif self.stage in {CollectorStage.PARSE, CollectorStage.EVIDENCE}:
            if self.external_call_state != GeoExternalCallState.COMPLETED:
                raise ValueError("解析或证据阶段必须已经接收完整外部结果")
        elif (
            self.stage == CollectorStage.RECEIVE
            and self.external_call_state == GeoExternalCallState.NOT_STARTED
        ):
            raise ValueError("接收阶段不能声明尚未发送")
        if (
            self.code == GeoRunErrorCode.COLLECTOR_UNKNOWN_OUTCOME
            and self.external_call_state
            not in {
                GeoExternalCallState.SENT,
                GeoExternalCallState.UNKNOWN,
            }
        ):
            raise ValueError("未知外部结果必须处于已发送或未知状态")
        if (
            self.provider_status is not None
            and self.external_call_state != GeoExternalCallState.COMPLETED
        ):
            raise ValueError("供应商状态码只用于已完整接收的响应")
        if self.retry_after_seconds is not None and (
            self.code != GeoRunErrorCode.PROVIDER_RATE_LIMITED or self.provider_status != 429
        ):
            raise ValueError("重试等待时间只用于完整的供应商 429 响应")

    @property
    def message(self) -> str:
        return _MESSAGES[self.code]

    @property
    def retryability(self) -> CollectorRetryability:
        if self.code in _NON_RETRYABLE:
            return CollectorRetryability.NOT_RETRYABLE
        if self.external_call_state == GeoExternalCallState.NOT_STARTED:
            if self.stage in {CollectorStage.CONNECT, CollectorStage.SEND} and self.code in {
                GeoRunErrorCode.PROVIDER_TIMEOUT,
                GeoRunErrorCode.PROVIDER_UNAVAILABLE,
            }:
                return CollectorRetryability.SAFE_BEFORE_SEND
            return CollectorRetryability.NOT_RETRYABLE
        return CollectorRetryability.NEW_ATTEMPT_ONLY

    @property
    def run_error_stage(self) -> GeoRunErrorStage:
        return GeoRunErrorStage.COLLECTION


class CollectorError(Exception):
    """只接受稳定字段；调用方捕获后消费 failure，不记录底层异常或 response body。"""

    def __init__(
        self,
        code: GeoRunErrorCode,
        *,
        stage: CollectorStage,
        external_call_state: GeoExternalCallState,
        provider_status: int | None = None,
        retry_after_seconds: int | None = None,
    ) -> None:
        self.failure = CollectorFailure(
            code=code,
            stage=stage,
            external_call_state=external_call_state,
            provider_status=provider_status,
            retry_after_seconds=retry_after_seconds,
        )
        super().__init__(self.failure.message)
