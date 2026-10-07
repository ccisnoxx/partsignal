"""GEO Chat Completions 响应边界；正文是原始回答，绝不解析内容生成四字段。"""

from __future__ import annotations

import json
import re
from decimal import Decimal, InvalidOperation
from typing import Literal

from pydantic import TypeAdapter

from app.collectors.contracts import (
    CollectedAnswer,
    CollectedCitation,
    Money,
    RawPayloadSummary,
    Usage,
)
from app.collectors.errors import CollectorError, CollectorStage
from app.schemas.geo_monitoring_plans import PlanBudget
from app.schemas.geo_runs import GeoExternalCallState, GeoRunErrorCode
from app.services.pinned_http import PinnedResponse

_AMOUNT: TypeAdapter[Decimal] = TypeAdapter(PlanBudget)


def _object(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError("必须是对象")
    return value


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("JSON 键不得重复")
        result[key] = value
    return result


def _reject_constant(_value: str) -> object:
    raise ValueError("JSON 数字必须有限")


def _text(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("必须是字符串")
    # UTF-8 JSON 中的孤立 surrogate 转义也不能成为可存储的正文或证据。
    value.encode("utf-8")
    return value


def _optional_text(value: object) -> str | None:
    return None if value is None else _text(value)


def _integer(value: object) -> int:
    if type(value) is not int:
        raise ValueError("必须是整数")
    return value


def _citations(
    payload: dict[str, object], message: dict[str, object], answer: str
) -> tuple[CollectedCitation, ...]:
    reported = payload.get("citations")
    annotations = message.get("annotations")
    if reported is None:
        reported = []
    if annotations is None:
        annotations = []
    if not isinstance(reported, list) or not isinstance(annotations, list):
        raise ValueError("引用必须是数组")
    if len(reported) > 1000 or len(annotations) > 1000:
        raise ValueError("引用超过上限")
    if reported and annotations:
        raise ValueError("引用来源存在歧义")
    citations: list[CollectedCitation] = []
    for raw in reported:
        citation = _object(raw)
        citations.append(
            CollectedCitation(
                url=_text(citation["url"]),
                title=_optional_text(citation.get("title")),
                position=_integer(citation["position"]),
                extraction_source="STRUCTURED",
            )
        )
    # 标准 annotations 以正文字符位置排序；position 是提交合同中的引用序号。
    located: list[tuple[int, int, dict[str, object]]] = []
    for order, raw in enumerate(annotations):
        annotation = _object(raw)
        if annotation.get("type") != "url_citation":
            raise ValueError("不支持的引用类型")
        citation = _object(annotation["url_citation"])
        start = _integer(citation["start_index"])
        end = _integer(citation["end_index"])
        if not 0 <= start < end <= len(answer):
            raise ValueError("引用位置超出正文")
        located.append((start, order, citation))
    for position, (_, _, citation) in enumerate(sorted(located), start=1):
        citations.append(
            CollectedCitation(
                url=_text(citation["url"]),
                title=_optional_text(citation.get("title")),
                position=position,
                extraction_source="STRUCTURED",
            )
        )
    return tuple(sorted(citations, key=lambda item: item.position))


def _usage(value: object) -> Usage | None:
    if value is None:
        return None
    reported = _object(value)
    counts = tuple(
        reported.get(key) for key in ("prompt_tokens", "completion_tokens", "total_tokens")
    )
    if all(count is None for count in counts):
        return None
    return Usage(
        prompt_tokens=None if counts[0] is None else _integer(counts[0]),
        completion_tokens=None if counts[1] is None else _integer(counts[1]),
        total_tokens=None if counts[2] is None else _integer(counts[2]),
    )


def _cost(value: object) -> Money | None:
    if value is None:
        return None
    reported = _object(value)
    amount = reported.get("amount")
    currency = reported.get("currency")
    # 缺任一字段无法建立金额；已报告的非法值仍必须拒绝，不能被 null 掩盖。
    parsed: Decimal | None = None
    if amount is not None:
        if not isinstance(amount, (str, Decimal, int)) or isinstance(amount, bool):
            raise ValueError("费用金额无效")
        parsed = _AMOUNT.validate_python(amount if isinstance(amount, str) else Decimal(amount))
        if not parsed.is_finite() or parsed < 0:
            raise ValueError("费用金额必须有限且非负")
    if currency is not None and re.fullmatch(r"[A-Z]{3}", _text(currency)) is None:
        raise ValueError("费用币种无效")
    if parsed is None or currency is None:
        return None
    return Money(amount=parsed, currency=_text(currency))


def parse_response(response: PinnedResponse, *, duration_ms: int) -> CollectedAnswer:
    """只保留允许落库的正文/结构化元数据；所有解析失败转换为无敏感值的固定错误。"""
    try:
        payload = _object(
            json.loads(
                response.body.decode("utf-8"),
                object_pairs_hook=_unique_object,
                parse_float=Decimal,
                parse_constant=_reject_constant,
            )
        )
        if payload.get("error") is not None:
            raise ValueError("供应商报告失败")
        choices = payload["choices"]
        if not isinstance(choices, list) or len(choices) != 1:
            raise ValueError("必须返回一个完整回答")
        choice = _object(choices[0])
        message = _object(choice["message"])
        if message.get("role", "assistant") != "assistant":
            raise ValueError("回答角色无效")
        if message.get("tool_calls") or message.get("function_call") or message.get("refusal"):
            raise ValueError("未返回可采集的完整回答")
        answer = _text(message["content"])
        finish = choice.get("finish_reason")
        finish_reason: Literal["STOP", "OTHER"] | None = None
        if finish is not None:
            finish = _text(finish)
            if finish in {"length", "content_filter", "tool_calls", "function_call"}:
                raise ValueError("回答已截断或未完成")
            if not finish:
                raise ValueError("结束原因无效")
            finish_reason = "STOP" if finish == "stop" else "OTHER"
        search = payload.get("web_search_observed")
        if search is not None and type(search) is not bool:
            raise ValueError("搜索状态必须为布尔或未知")
        return CollectedAnswer(
            answer_text=answer,
            answer_format="TEXT",
            source_product=_optional_text(payload.get("source_product")),
            source_model=_optional_text(payload.get("model")),
            source_version=_optional_text(payload.get("source_version")),
            web_search_observed=search,
            citations=_citations(payload, message, answer),
            provider_request_id=_optional_text(response.headers.get("x-request-id")),
            usage=_usage(payload.get("usage")),
            cost=_cost(payload.get("cost")),
            duration_ms=duration_ms,
            raw_payload_summary=RawPayloadSummary(
                payload_format="JSON", payload_bytes=len(response.body), finish_reason=finish_reason
            ),
            screenshot_bytes=None,
            raw_payload_bytes=None,
        )
    except (ValueError, TypeError, KeyError, RecursionError, InvalidOperation):
        raise CollectorError(
            GeoRunErrorCode.PROVIDER_RESPONSE_INVALID,
            stage=CollectorStage.PARSE,
            external_call_state=GeoExternalCallState.COMPLETED,
        ) from None
