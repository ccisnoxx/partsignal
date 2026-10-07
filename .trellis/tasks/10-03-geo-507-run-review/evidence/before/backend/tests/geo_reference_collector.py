"""套件自测用的测试驱动；仅理解 fake 协议，不是 GEO-404 生产 adapter。"""

from __future__ import annotations

import http.client
import json
import time
from decimal import Decimal
from typing import Any

from pydantic import ValidationError

from app.collectors.base import SendAuthorization
from app.collectors.contracts import (
    CollectedAnswer,
    CollectedCitation,
    CollectionEstimate,
    CollectionRequest,
    Money,
    RawPayloadSummary,
    Usage,
)
from app.collectors.errors import CollectorError
from app.collectors.errors import CollectorStage as Stage
from app.collectors.registry import (
    CollectionProfileSnapshot,
    CollectorCapability,
    CollectorRegistration,
    ProfileBlocker,
)
from app.geo_fake_server import GeoFakeServer
from app.schemas.geo_runs import GeoExternalCallState as State
from app.schemas.geo_runs import GeoRunErrorCode as Code
from app.schemas.geo_surfaces import GeoCollectionMode, GeoProfileLoginState, GeoWebSearchPolicy
from tests.geo_collector_contract import completion_body


class ReferenceCollector:
    """只能连接已启动的回环 server 对象，不接受外部 URL 或生产配置。"""

    def __init__(
        self, provider: GeoFakeServer, *, key: str, version: str, secrets: tuple[str, str, str]
    ) -> None:
        self.provider = provider
        self.secrets = secrets
        self.registration = CollectorRegistration(
            key=key,
            version=version,
            collection_mode=GeoCollectionMode.API,
            capabilities=frozenset(CollectorCapability),
            surface_kinds=frozenset(),
            login_states=frozenset({GeoProfileLoginState.NOT_APPLICABLE}),
            web_search_policies=frozenset(GeoWebSearchPolicy),
            environments=frozenset({"test"}),
        )

    def validate_profile(self, profile: CollectionProfileSnapshot) -> tuple[ProfileBlocker, ...]:
        return self.registration.validate_profile(profile)

    def estimate(self, request: CollectionRequest) -> CollectionEstimate:
        return CollectionEstimate(cost=None)

    def collect(
        self, request: CollectionRequest, *, before_send: SendAuthorization
    ) -> CollectedAnswer:
        if (
            request.profile.collection_mode != self.registration.collection_mode
            or request.profile.adapter_key != self.registration.key
            or request.profile.adapter_version != self.registration.version
        ):
            raise CollectorError(
                Code.COLLECTOR_CONFIGURATION_INVALID,
                stage=Stage.CONFIGURATION,
                external_call_state=State.NOT_STARTED,
            )
        connection = http.client.HTTPConnection(
            "127.0.0.1", self.provider.server_port, timeout=request.timeout_seconds
        )
        started = time.monotonic()
        sent = False
        try:
            connection.connect()
            before_send()
            sent = True
            connection.request(
                "POST",
                "/v1/chat/completions",
                body=completion_body(request),
                headers={
                    "X-GEO-Attempt-ID": str(request.run_id),
                    "Authorization": f"Bearer {self.secrets[0]}",
                    "X-Test-Secret": self.secrets[1],
                    "Cookie": f"session={self.secrets[2]}",
                },
            )
            response = connection.getresponse()
            length = response.getheader("Content-Length")
            if length is not None and int(length) > request.max_response_bytes:
                raise CollectorError(
                    Code.PROVIDER_RESPONSE_TOO_LARGE,
                    stage=Stage.RECEIVE,
                    external_call_state=State.SENT,
                )
            body = response.read(request.max_response_bytes + 1)
            if len(body) > request.max_response_bytes:
                raise CollectorError(
                    Code.PROVIDER_RESPONSE_TOO_LARGE,
                    stage=Stage.RECEIVE,
                    external_call_state=State.SENT,
                )
            if response.status != 200:
                code = {
                    401: Code.PROVIDER_AUTH_FAILED,
                    403: Code.PROVIDER_AUTH_FAILED,
                    429: Code.PROVIDER_RATE_LIMITED,
                    503: Code.PROVIDER_UNAVAILABLE,
                }.get(response.status, Code.PROVIDER_RESPONSE_INVALID)
                raise CollectorError(
                    code,
                    stage=Stage.RECEIVE,
                    external_call_state=State.COMPLETED,
                    provider_status=response.status,
                    retry_after_seconds=2 if response.status == 429 else None,
                )
            try:
                return self._parse(
                    body,
                    response.getheader("x-request-id"),
                    int((time.monotonic() - started) * 1000),
                )
            except (ValueError, TypeError, KeyError, IndexError, ValidationError):
                raise CollectorError(
                    Code.PROVIDER_RESPONSE_INVALID,
                    stage=Stage.PARSE,
                    external_call_state=State.COMPLETED,
                ) from None
        except (OSError, http.client.HTTPException):
            raise CollectorError(
                Code.COLLECTOR_UNKNOWN_OUTCOME if sent else Code.PROVIDER_UNAVAILABLE,
                stage=Stage.RECEIVE if sent else Stage.CONNECT,
                external_call_state=State.UNKNOWN if sent else State.NOT_STARTED,
            ) from None
        finally:
            connection.close()

    def _parse(
        self, body: bytes, provider_request_id: str | None, duration_ms: int
    ) -> CollectedAnswer:
        payload: dict[str, Any] = json.loads(body)
        usage = payload.get("usage")
        cost = payload.get("cost")
        # 只从已知 fixture 字段构造结果；Header/debug/raw 不保留，不保存原始响应。
        return CollectedAnswer(
            answer_text=payload["choices"][0]["message"]["content"],
            answer_format="MARKDOWN",
            source_product=None,
            source_model=payload["model"],
            source_version=payload["source_version"],
            web_search_observed=payload["web_search_observed"],
            citations=tuple(
                CollectedCitation(**c, extraction_source="STRUCTURED")
                for c in payload.get("citations", [])
            ),
            provider_request_id=provider_request_id,
            usage=Usage(
                prompt_tokens=usage.get("prompt_tokens"),
                completion_tokens=usage.get("completion_tokens"),
                total_tokens=usage.get("total_tokens"),
            )
            if usage is not None
            else None,
            cost=Money(amount=Decimal(cost["amount"]), currency=cost["currency"])
            if cost is not None
            else None,
            duration_ms=duration_ms,
            raw_payload_summary=RawPayloadSummary(
                payload_format="JSON", payload_bytes=len(body), finish_reason="STOP"
            ),
            screenshot_bytes=None,
            raw_payload_bytes=None,
        )
