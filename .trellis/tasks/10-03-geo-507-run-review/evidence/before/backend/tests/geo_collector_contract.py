"""可复用 Collector 合同断言；接收真实 adapter，不拥有业务状态或生产解析器。"""

from __future__ import annotations

import base64
import hashlib
import json
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from urllib.parse import quote
from uuid import uuid4

from pydantic import TypeAdapter

from app.collectors.base import GeoCollector
from app.collectors.contracts import CollectedAnswer, CollectionRequest
from app.collectors.errors import CollectorError, CollectorRetryability, CollectorStage
from app.geo_fake_server import FakeMode, FakeScenario, GeoFakeServer
from app.schemas.geo_runs import GeoExternalCallState as State
from app.schemas.geo_runs import GeoRunErrorCode as Code


@dataclass(frozen=True)
class FailureCase:
    mode: FakeMode
    code: Code
    stage: CollectorStage
    state: State
    status: int | None = None


FAILURE_CASES = (
    FailureCase(
        FakeMode.RATE_LIMIT,
        Code.PROVIDER_RATE_LIMITED,
        CollectorStage.RECEIVE,
        State.COMPLETED,
        429,
    ),
    FailureCase(
        FakeMode.TIMEOUT, Code.COLLECTOR_UNKNOWN_OUTCOME, CollectorStage.RECEIVE, State.UNKNOWN
    ),
    FailureCase(
        FakeMode.SLOW_BODY, Code.COLLECTOR_UNKNOWN_OUTCOME, CollectorStage.RECEIVE, State.UNKNOWN
    ),
    FailureCase(
        FakeMode.DISCONNECT, Code.COLLECTOR_UNKNOWN_OUTCOME, CollectorStage.RECEIVE, State.UNKNOWN
    ),
    FailureCase(
        FakeMode.REDIRECT,
        Code.PROVIDER_RESPONSE_INVALID,
        CollectorStage.RECEIVE,
        State.COMPLETED,
        307,
    ),
    FailureCase(
        FakeMode.OVERSIZE, Code.PROVIDER_RESPONSE_TOO_LARGE, CollectorStage.RECEIVE, State.SENT
    ),
    FailureCase(
        FakeMode.OVERSIZE_CHUNKED,
        Code.PROVIDER_RESPONSE_TOO_LARGE,
        CollectorStage.RECEIVE,
        State.SENT,
    ),
    FailureCase(
        FakeMode.INVALID_RESPONSE,
        Code.PROVIDER_RESPONSE_INVALID,
        CollectorStage.PARSE,
        State.COMPLETED,
    ),
    FailureCase(
        FakeMode.INVALID_JSON, Code.PROVIDER_RESPONSE_INVALID, CollectorStage.PARSE, State.COMPLETED
    ),
    FailureCase(
        FakeMode.EMPTY_ANSWER, Code.PROVIDER_RESPONSE_INVALID, CollectorStage.PARSE, State.COMPLETED
    ),
    FailureCase(
        FakeMode.AUTH_401, Code.PROVIDER_AUTH_FAILED, CollectorStage.RECEIVE, State.COMPLETED, 401
    ),
    FailureCase(
        FakeMode.AUTH_403, Code.PROVIDER_AUTH_FAILED, CollectorStage.RECEIVE, State.COMPLETED, 403
    ),
    FailureCase(
        FakeMode.UNAVAILABLE,
        Code.PROVIDER_UNAVAILABLE,
        CollectorStage.RECEIVE,
        State.COMPLETED,
        503,
    ),
)


TEST_SECRETS: list[str] = []


def test_secret(kind: str) -> str:
    value = f"geo-canary-{kind}-{uuid4().hex}"
    TEST_SECRETS.append(value)
    return value


test_secret.__test__ = False


class CollectorContractViolation(AssertionError):
    """固定诊断，不回显 provider 值、期望值或实际值。"""


def require(condition: bool, rule: str) -> None:
    if not condition:
        raise CollectorContractViolation(f"Collector 合同不符合：{rule}")


def secret_variants(secret: str) -> set[bytes]:
    return {
        secret.encode(),
        quote(secret, safe="").encode(),
        json.dumps(secret, ensure_ascii=True)[1:-1].encode(),
        base64.b64encode(secret.encode()),
    }


def assert_secrets_absent(contents: Iterable[bytes | str], secrets: Sequence[str] = ()) -> None:
    needles = {value for secret in secrets if secret for value in secret_variants(secret)}
    canary = re.compile(rb"geo-canary-(?:api|header|cookie)-[a-f0-9]{32}")
    for content in contents:
        data = content.encode() if isinstance(content, str) else content
        require(not canary.search(data) and not any(n in data for n in needles), "敏感值外泄")


def completion_body(request: CollectionRequest) -> bytes:
    """测试协议请求预期；只发送原问题，不注入监测对象/事实/分析背景。"""
    return json.dumps(
        {
            "model": "geo-fixture-model",
            "stream": False,
            "messages": [{"role": "user", "content": request.prompt_text}],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()


def assert_collection_case(
    collector: GeoCollector,
    request: CollectionRequest,
    provider: GeoFakeServer,
    scenario: FakeScenario,
    *,
    secrets: Sequence[str] = (),
) -> CollectedAnswer | CollectorError:
    """每个 case 用新 run UUID；未来 adapter 测试直接复用该入口。"""
    provider.state.configure(request.run_id, scenario)
    require(provider.state.snapshot(request.run_id)["count"] == 0, "case 必须使用新 attempt")
    callbacks = 0

    def before_send() -> None:
        nonlocal callbacks
        callbacks += 1
        require(provider.state.snapshot(request.run_id)["count"] == 0, "授权必须早于请求")

    try:
        result: CollectedAnswer | CollectorError = collector.collect(
            request, before_send=before_send
        )
    except CollectorError as error:
        result = error
    stats = provider.state.snapshot(request.run_id)
    require(callbacks == 1, "发送回调必须恰好一次")
    require(stats["count"] == 1, "每 attempt 必须只有一次请求")
    require(stats["redirect_hits"] == 0, "禁止跟随重定向")
    require(
        stats["requests"][0]["body_sha256"] == hashlib.sha256(completion_body(request)).hexdigest(),
        "请求必须只有原 user prompt",
    )
    assert_secrets_absent([json.dumps(stats), str(result), repr(result)], secrets)
    expected = next((c for c in FAILURE_CASES if c.mode == scenario.mode), None)
    if expected is not None:
        require(isinstance(result, CollectorError), "故障不能成为成功")
        assert isinstance(result, CollectorError)
        failure = result.failure
        require(failure.code == expected.code, "稳定错误码")
        require(failure.stage == expected.stage, "错误阶段")
        require(failure.external_call_state == expected.state, "发送状态")
        require(failure.provider_status == expected.status, "完整响应状态码")
        require(
            failure.retryability != CollectorRetryability.SAFE_BEFORE_SEND, "发送后不能安全重发"
        )
        require(
            failure.retry_after_seconds == (2 if expected.status == 429 else None),
            "Retry-After 仅为新 attempt 元数据",
        )
    else:
        require(isinstance(result, CollectedAnswer), "成功必须返回原始回答")
        assert isinstance(result, CollectedAnswer)
        require(result.answer_text == scenario.answer_text, "保留完整原文")
        require(result.web_search_observed is scenario.web_search_observed, "搜索 unknown 保留")
        require(result.provider_request_id == f"geo-fake-{request.run_id}", "请求标识")
        require(result.source_model == "geo-fixture-model", "实际模型")
        require(result.source_version == "fixture-v1", "实际版本")
        require(result.raw_payload_summary.payload_bytes is not None, "响应字节元数据")
        if scenario.mode == FakeMode.CITATIONS:
            require(tuple(c.position for c in result.citations) == (1, 3), "实际引用位置")
            require(result.citations[0].url == result.citations[1].url, "保留重复原始引用")
        else:
            require(result.citations == (), "未报告引用不能猜测")
        if scenario.partial_usage:
            require(result.usage is not None, "已报告用量")
            assert result.usage is not None
            require(
                result.usage.prompt_tokens == 7
                and result.usage.completion_tokens is None
                and result.usage.total_tokens is None,
                "partial usage 不补算",
            )
        else:
            require(result.usage is None, "未知用量为 null")
        require((result.cost is not None) == scenario.reported_cost, "未知费用为 null")
        assert_secrets_absent([TypeAdapter(CollectedAnswer).dump_json(result)], secrets)
    return result


def assert_authorization_rejection(
    collector: GeoCollector,
    request: CollectionRequest,
    provider: GeoFakeServer,
) -> None:
    callbacks = 0

    class AuthorizationRejected(Exception):
        pass

    def reject() -> None:
        nonlocal callbacks
        callbacks += 1
        raise AuthorizationRejected("测试发送授权拒绝")

    try:
        collector.collect(request, before_send=reject)
    except AuthorizationRejected:
        pass
    else:
        raise CollectorContractViolation("Collector 合同不符合：必须保留发送授权失败")
    require(callbacks == 1, "发送授权必须恰好一次")
    require(provider.state.snapshot(request.run_id)["count"] == 0, "授权失败不能发送")
