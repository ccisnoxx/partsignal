"""原始回答组件、URL 身份与安全摘要的外部可观察合同。"""

import hashlib
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest
from pydantic import TypeAdapter, ValidationError

from app.geo_citation_urls import normalize_citation_url
from app.schemas.geo_answers import (
    GeoAnswerCitationInput,
    GeoAnswerCitationOut,
    GeoAnswerSnapshotOut,
    GeoRawPayloadSummary,
)
from app.services.geo_answer_citations import prepare_answer_citations
from tests.unit.test_geo_run_contract import contract, validate

__all__ = ["contract"]


def answer_payload() -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "run_id": str(uuid4()),
        "prompt_text": "冻结问题",
        "answer_text": "  原始回答\r\n型号 A-1\n",
        "answer_format": "TEXT",
        "source_product": None,
        "source_model": None,
        "source_version": None,
        "web_search_observed": None,
        "raw_payload_summary": GeoRawPayloadSummary().model_dump(),
        "raw_payload_file_id": None,
        "screenshot_file_id": None,
        "citation_count": 0,
        "collected_at": datetime.now(UTC).isoformat(),
        "created_at": datetime.now(UTC).isoformat(),
        "answer_sha256": hashlib.sha256("  原始回答\r\n型号 A-1\n".encode()).hexdigest(),
    }


@pytest.mark.parametrize(
    "model",
    [GeoAnswerSnapshotOut, GeoAnswerCitationInput, GeoAnswerCitationOut, GeoRawPayloadSummary],
)
def test_components_match(contract: dict[str, Any], model: type) -> None:
    schema = TypeAdapter(model).json_schema(ref_template="#/components/schemas/{model}")
    definitions = schema.pop("$defs", {})
    assert contract["components"]["schemas"][model.__name__] == schema
    for name, value in definitions.items():
        assert contract["components"]["schemas"][name] == value


def test_original_bytes_and_unknown_signal_round_trip(contract: dict[str, Any]) -> None:
    payload = answer_payload()
    parsed = GeoAnswerSnapshotOut.model_validate(payload)
    assert parsed.answer_text == payload["answer_text"]
    assert parsed.web_search_observed is None
    validate(contract, "GeoAnswerSnapshotOut", parsed.model_dump(mode="json"))
    with pytest.raises(ValidationError):
        GeoAnswerSnapshotOut.model_validate(payload | {"answer_sha256": "0" * 64})


@pytest.mark.parametrize("text", ["", "\n\t ", "value\x00", "a" * 1048577])
def test_empty_or_invalid_answer_rejected(text: str) -> None:
    with pytest.raises(ValidationError):
        GeoAnswerSnapshotOut.model_validate(answer_payload() | {"answer_text": text})


@pytest.mark.parametrize("key", ["api_key", "Authorization", "Cookie", "headers", "body", "token"])
def test_summary_secret_keys_rejected(key: str, contract: dict[str, Any]) -> None:
    from jsonschema.exceptions import ValidationError as JsonError

    value = GeoRawPayloadSummary().model_dump() | {key: "fixture-secret"}
    with pytest.raises(ValidationError):
        GeoRawPayloadSummary.model_validate(value)
    with pytest.raises(JsonError):
        validate(contract, "GeoRawPayloadSummary", value)


@pytest.mark.parametrize(
    "patch",
    [
        {"payload_format": "fixture-secret"},
        {"finish_reason": "Bearer fixture"},
        {"payload_bytes": "fixture-secret"},
        {"payload_bytes": {"api_key": "fixture"}},
        {"payload_bytes": True},
        {"payload_bytes": -1},
        {"payload_bytes": 52428801},
        {"schema_version": 2},
        {"schema_version": True},
    ],
)
def test_summary_string_objects_and_bounds_rejected(patch: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        GeoRawPayloadSummary.model_validate(GeoRawPayloadSummary().model_dump() | patch)


@pytest.mark.parametrize(
    ("url", "normalized", "host"),
    [
        ("HTTPS://Example.COM:443#section", "https://example.com/", "example.com"),
        (
            "http://例子.测试:80/a?id=2&id=1#x",
            "http://xn--fsqu00a.xn--0zwm56d/a?id=2&id=1",
            "xn--fsqu00a.xn--0zwm56d",
        ),
        (
            "https://EXAMPLE.com:8443/A?q=2&b=1&utm_source=a",
            "https://example.com:8443/A?q=2&b=1&utm_source=a",
            "example.com",
        ),
        ("https://[2001:db8::1]:443/a", "https://[2001:db8::1]/a", "2001:db8::1"),
        ("http://127.0.0.1/a", "http://127.0.0.1/a", "127.0.0.1"),
        ("https://a/", "https://a/", "a"),
        ("https://[2001:db8::]/a", "https://[2001:db8::]/a", "2001:db8::"),
    ],
)
def test_url_normalization(url: str, normalized: str, host: str) -> None:
    result = normalize_citation_url(url)
    assert result.original_url == url
    assert result.normalized_url == normalized
    assert result.hostname == host


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "data:text/html,a",
        "file:///etc/passwd",
        "https://user:pass@example.com/a",
        "https://example.com\\@evil.test",
        " https://example.com",
        "https://example.com/%0a",
        "https://example.com/%1f",
        "https://example.com/%GG",
        "https://example.com\n/",
        "https://example.com:99999/a",
        "https:///a",
    ],
)
def test_unsafe_urls_rejected(url: str) -> None:
    with pytest.raises(ValueError):
        normalize_citation_url(url)


def test_duplicates_preserve_first_source_and_all_original_positions() -> None:
    values = [
        GeoAnswerCitationInput(
            original_url=url, position=pos, title=title, extraction_source="MANUAL"
        )
        for url, pos, title in [
            ("https://example.com/a#second", 3, "第二次"),
            ("https://other.test/b", 2, "其他"),
            ("HTTPS://EXAMPLE.COM:443/a#first", 1, "首次"),
        ]
    ]
    result = prepare_answer_citations(values)
    assert [v.position for v in result] == [1, 2]
    assert result[0].occurrences == (1, 3)
    assert result[0].original_url == values[2].original_url
    assert result[0].title == "首次"
    with pytest.raises(ValueError):
        prepare_answer_citations([values[0], values[0]])
