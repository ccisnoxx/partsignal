"""真实响应解析金标；不使用生产解析器生成期望结果。"""

import json
from decimal import Decimal

import pytest

from app.collectors.errors import CollectorError, CollectorStage
from app.collectors.openai_response import parse_response
from app.schemas.geo_runs import GeoExternalCallState, GeoRunErrorCode
from app.services.pinned_http import PinnedResponse


def completion(**changes):
    return {
        "choices": [{"message": {"content": "原始回答与引用"}, "finish_reason": "stop"}],
        **changes,
    }


def parse(payload, **headers):
    return parse_response(
        PinnedResponse(200, headers, json.dumps(payload, ensure_ascii=False).encode()),
        duration_ms=1,
    )


def test_original_answer_is_not_a_generated_draft_and_metadata_is_not_inferred():
    content = '{"title":"保持原文","body_markdown":"body","excerpt":"","geo_summary":""}'
    result = parse({"choices": [{"message": {"content": content}}]})
    assert result.answer_text == content
    assert result.source_model is result.source_version is result.source_product is None
    assert result.web_search_observed is result.cost is result.usage is None
    assert result.provider_request_id is None
    assert result.raw_payload_summary.finish_reason is None


def test_structured_citations_keep_actual_positions_and_repeated_urls():
    result = parse(
        completion(
            citations=[
                {"url": "https://example.com/a", "title": None, "position": 7},
                {"url": "https://example.com/a", "title": "证据", "position": 2},
            ]
        )
    )
    assert tuple(c.position for c in result.citations) == (2, 7)
    assert result.citations[0].url == result.citations[1].url
    assert result.web_search_observed is None


def test_standard_url_annotations_follow_answer_positions_and_are_not_fetched():
    result = parse(
        {
            "choices": [
                {
                    "message": {
                        "content": "原始回答与引用",
                        "annotations": [
                            {
                                "type": "url_citation",
                                "url_citation": {
                                    "url": "https://example.com/b",
                                    "title": "后",
                                    "start_index": 5,
                                    "end_index": 7,
                                },
                            },
                            {
                                "type": "url_citation",
                                "url_citation": {
                                    "url": "https://example.com/a",
                                    "title": "前",
                                    "start_index": 0,
                                    "end_index": 2,
                                },
                            },
                        ],
                    }
                }
            ]
        }
    )
    assert tuple(c.title for c in result.citations) == ("前", "后")
    assert tuple(c.position for c in result.citations) == (1, 2)
    assert all(c.extraction_source == "STRUCTURED" for c in result.citations)


@pytest.mark.parametrize(
    "usage",
    [
        {"prompt_tokens": 7},
        {"completion_tokens": 0},
        {"total_tokens": 8},
    ],
)
def test_usage_is_partial_without_sums(usage):
    result = parse(completion(usage=usage))
    assert result.usage is not None
    for field in ("prompt_tokens", "completion_tokens", "total_tokens"):
        assert getattr(result.usage, field) == usage.get(field)


@pytest.mark.parametrize(
    "cost", [{"amount": "0", "currency": "USD"}, {"amount": "0.001200", "currency": "CNY"}]
)
def test_reported_cost_is_exact_and_zero_is_distinct_from_unknown(cost):
    result = parse(completion(cost=cost))
    assert result.cost.amount == Decimal(cost["amount"])
    assert result.cost.currency == cost["currency"]


@pytest.mark.parametrize("cost", [{}, {"amount": "1.200000"}, {"currency": "USD"}])
def test_partial_cost_stays_unknown(cost):
    assert parse(completion(cost=cost)).cost is None


@pytest.mark.parametrize(
    "changes",
    [
        {"choices": []},
        {"choices": [{}, {}]},
        {"choices": [{"message": {"content": []}}]},
        {"choices": [{"message": {"content": " \n"}}]},
        {"choices": [{"message": {"content": "NUL\x00"}}]},
        {"choices": [{"message": {"content": "\ud800"}}]},
        {"choices": [{"message": {"content": "x" * 1048577}}]},
        {"choices": [{"message": {"content": "partial"}, "finish_reason": "length"}]},
        {"choices": [{"message": {"content": "blocked"}, "finish_reason": "content_filter"}]},
        {"choices": [{"message": {"content": "tool", "tool_calls": [{"id": "call"}]}}]},
        {"web_search_observed": "unknown"},
        {"web_search_observed": 0},
        {"model": ""},
        {"source_version": {}},
        {"error": {"message": "private"}},
        {"usage": {"prompt_tokens": True}},
        {"usage": {"completion_tokens": -1}},
        {"usage": {"total_tokens": 2147483648}},
        {"usage": {"prompt_tokens": "7"}},
        {"cost": {"amount": "NaN", "currency": "USD"}},
        {"cost": {"amount": "0.0000001", "currency": "USD"}},
        {"cost": {"amount": "100000000", "currency": "USD"}},
        {"cost": {"amount": "-1", "currency": "USD"}},
        {"cost": {"amount": True, "currency": "USD"}},
        {"cost": {"amount": "1", "currency": "usd"}},
        {"cost": {"amount": "invalid"}},
        {"citations": [{"url": "javascript:alert(1)", "position": 1}]},
        {"citations": [{"url": "https://example.com", "position": True}]},
        {"citations": [{"url": "https://example.com", "position": 1001}]},
        {"citations": [{"url": "https://example.com", "position": 1}] * 2},
        {"citations": [{"url": "https://example.com", "position": 1}] * 1001},
        {
            "choices": [
                {
                    "message": {
                        "content": "text",
                        "annotations": [
                            {
                                "type": "url_citation",
                                "url_citation": {
                                    "url": "https://example.com",
                                    "start_index": 0,
                                    "end_index": 5,
                                },
                            }
                        ],
                    }
                }
            ]
        },
    ],
)
def test_malformed_or_incomplete_reported_fields_fail_closed(changes):
    # ensure_ascii 可构造非法 surrogate 金标，由响应边界负责拒绝。
    response = PinnedResponse(200, {}, json.dumps(completion(**changes)).encode())
    with pytest.raises(CollectorError) as caught:
        parse_response(response, duration_ms=1)
    assert caught.value.failure.code == GeoRunErrorCode.PROVIDER_RESPONSE_INVALID
    assert caught.value.failure.stage == CollectorStage.PARSE
    assert caught.value.failure.external_call_state == GeoExternalCallState.COMPLETED
    assert str(caught.value) == "供应商回答格式无效"


@pytest.mark.parametrize(
    "body",
    [
        b"not json",
        b"\xff",
        b'{"choices":[],"choices":[]}',
        b'{"usage":{"prompt_tokens":NaN}}',
        b"[" * 2000,
    ],
)
def test_invalid_encoding_duplicates_nonfinite_and_excessive_nesting(body):
    with pytest.raises(CollectorError):
        parse_response(PinnedResponse(200, {}, body), duration_ms=1)


def test_request_id_controls_are_rejected_and_debug_cookies_are_discarded():
    with pytest.raises(CollectorError):
        parse(completion(), **{"x-request-id": "id\nsecret"})
    result = parse(completion(debug={"token": "private"}), **{"set-cookie": "private"})
    assert result.raw_payload_bytes is None
    assert result.raw_payload_summary.to_contract().model_dump() == {
        "schema_version": 1,
        "payload_format": "JSON",
        "payload_bytes": result.raw_payload_summary.payload_bytes,
        "finish_reason": "STOP",
    }
