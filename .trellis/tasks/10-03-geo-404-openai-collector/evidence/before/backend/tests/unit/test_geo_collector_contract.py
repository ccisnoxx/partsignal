"""抽象采集边界：不可变原始值、显式发送状态与恢复分类，无 provider I/O。"""

import ast
import inspect
from dataclasses import FrozenInstanceError, fields, replace
from decimal import Decimal
from pathlib import Path
from typing import Any, get_type_hints
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.collectors.base import GeoCollector
from app.collectors.contracts import (
    CollectedAnswer,
    CollectedCitation,
    CollectionEstimate,
    CollectionRequest,
    Money,
    RawPayloadSummary,
    Usage,
)
from app.collectors.errors import (
    CollectorError,
)
from app.collectors.errors import (
    CollectorRetryability as Retry,
)
from app.collectors.errors import (
    CollectorStage as Stage,
)
from app.collectors.registry import CollectorCapability, collector_registry
from app.schemas.geo_runs import (
    GeoExternalCallState as State,
)
from app.schemas.geo_runs import (
    GeoRunErrorCode as Code,
)
from app.schemas.geo_runs import (
    GeoRunErrorStage,
    GeoRunInputSnapshot,
)
from tests.unit.test_geo_run_contract import input_snapshot


def request(**patch: Any) -> CollectionRequest:
    return CollectionRequest.from_snapshot(
        uuid4(),
        GeoRunInputSnapshot.model_validate(input_snapshot("API")),
        **{"timeout_seconds": 30, "max_response_bytes": 2097152, "budget_remaining": None, **patch},
    )


def answer(**patch: Any) -> CollectedAnswer:
    return CollectedAnswer(
        **{
            "answer_text": "  原始回答\r\n型号 A-1\n",
            "answer_format": "MARKDOWN",
            "source_product": None,
            "source_model": None,
            "source_version": None,
            "web_search_observed": None,
            "citations": (),
            "provider_request_id": None,
            "usage": None,
            "cost": None,
            "duration_ms": 0,
            "raw_payload_summary": RawPayloadSummary(),
            "screenshot_bytes": None,
            "raw_payload_bytes": None,
            **patch,
        }
    )


def citation(position: int, url: str = "https://example.test/a#part") -> CollectedCitation:
    return CollectedCitation(url=url, title=None, position=position, extraction_source="STRUCTURED")


@pytest.mark.parametrize("mode", ["MANUAL", "API", "BROWSER"])
def test_request_copies_frozen_configuration_without_analysis_or_credentials(mode: str) -> None:
    snapshot = GeoRunInputSnapshot.model_validate(input_snapshot(mode))
    original = snapshot.prompt.prompt_text
    value = CollectionRequest.from_snapshot(
        uuid4(), snapshot, timeout_seconds=30, max_response_bytes=2097152, budget_remaining=None
    )
    assert value.prompt_text == original
    assert value.profile.adapter_version == snapshot.profile.adapter_version
    assert value.profile.engine_surface_id == snapshot.profile.surface.id
    assert value.data_classification == snapshot.data_classification
    assert CollectorCapability.ANSWER_TEXT in value.engine_surface.capabilities
    snapshot.prompt.prompt_text = "后来修改的问题"
    original_settings = value.profile.settings
    setting = next(iter(snapshot.profile.settings.model_dump()))
    setattr(snapshot.profile.settings, setting, None)
    assert value.prompt_text == original
    assert isinstance(value.profile.settings, tuple)
    assert value.profile.settings == original_settings
    assert {f.name for f in fields(value)}.isdisjoint(
        {"subjects", "subject_snapshot", "session", "api_key", "headers", "fact_version"}
    )
    with pytest.raises(FrozenInstanceError):
        value.profile.adapter_version = "later"  # type: ignore[misc]
    assert original not in repr(value)


@pytest.mark.parametrize(
    "patch",
    [
        {"timeout_seconds": 0},
        {"timeout_seconds": True},
        {"max_response_bytes": 0},
        {"budget_remaining": Decimal("-0.1")},
        {"budget_remaining": Decimal("NaN")},
    ],
)
def test_request_rejects_invalid_limits(patch: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        request(**patch)


def test_request_profile_identity_and_closed_settings() -> None:
    value = request()
    with pytest.raises(ValidationError):
        replace(value, profile=replace(value.profile, engine_surface_id=uuid4()))
    for settings in ((("Cookie", 1),), (("temperature", True),), (("temperature", 1),) * 2):
        with pytest.raises(ValidationError):
            replace(value.profile, settings=settings)


def test_answer_preserves_original_text_unknown_and_partial_reported_usage() -> None:
    value = answer(usage=Usage(prompt_tokens=7, completion_tokens=None, total_tokens=None))
    assert value.answer_text == "  原始回答\r\n型号 A-1\n"
    assert value.web_search_observed is value.cost is value.source_version is None
    assert value.usage is not None
    assert value.usage.total_tokens is None
    assert value.raw_payload_summary.to_contract().model_dump() == {
        "schema_version": 1,
        "payload_format": None,
        "payload_bytes": None,
        "finish_reason": None,
    }
    assert value.answer_text not in repr(value)
    with pytest.raises(FrozenInstanceError):
        value.raw_payload_summary.payload_bytes = 10  # type: ignore[misc]


@pytest.mark.parametrize(
    "patch",
    [
        {"answer_text": ""},
        {"answer_text": "\n\t "},
        {"answer_text": "a\x00"},
        {"answer_text": "a" * 1048577},
        {"web_search_observed": 0},
        {"duration_ms": True},
        {"duration_ms": -1},
        {"source_model": "m" * 201},
        {"provider_request_id": "request\n"},
        {"provider_request_id": " request"},
        {"screenshot_bytes": b""},
        {"raw_payload_bytes": b""},
        {"citations": (citation(2), citation(1))},
        {"citations": (citation(1), citation(1))},
    ],
)
def test_invalid_raw_result_cannot_be_success(patch: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        answer(**patch)


@pytest.mark.parametrize("field", ["source_product", "source_model", "source_version"])
@pytest.mark.parametrize("value", ["", " \n\t ", "\x00", "model\x00version"])
def test_source_metadata_cannot_violate_persistence_contract(field: str, value: str) -> None:
    with pytest.raises(ValidationError):
        answer(**{field: value})


def test_citation_title_rejects_nul_without_normalizing_original_metadata() -> None:
    with pytest.raises(ValidationError):
        CollectedCitation(
            url="https://example.test/a", title="title\x00", position=1,
            extraction_source="STRUCTURED",
        )
    value = answer(source_model=" model version ")
    assert value.source_model == " model version "


def test_original_citation_occurrences_are_preserved_for_persistence_boundary() -> None:
    value = answer(citations=(citation(1, "HTTPS://EXAMPLE.test:443/a#one"), citation(3)))
    assert [c.position for c in value.citations] == [1, 3]
    assert value.citations[0].url == "HTTPS://EXAMPLE.test:443/a#one"
    for url in ("javascript:alert(1)", "https://user:password@example.test/"):
        with pytest.raises(ValidationError):
            citation(1, url)


@pytest.mark.parametrize(
    "patch",
    [
        {"Cookie": "synthetic-secret"},
        {"payload_bytes": 52428801},
        {"finish_reason": "synthetic-secret"},
        {"schema_version": True},
    ],
)
def test_summary_is_closed_and_validation_does_not_echo_input(patch: dict[str, Any]) -> None:
    with pytest.raises(ValidationError) as caught:
        RawPayloadSummary(**patch)
    assert "synthetic-secret" not in str(caught.value)


def test_cost_unknown_differs_from_explicit_zero_and_usage_is_not_invented() -> None:
    assert CollectionEstimate(cost=None).cost is None
    assert CollectionEstimate(cost=Money(amount=Decimal("0"), currency="USD")).cost is not None
    for value in (Decimal("NaN"), Decimal("-1"), Decimal("1.0000001")):
        with pytest.raises(ValidationError):
            Money(amount=value, currency="USD")
    with pytest.raises(ValidationError):
        Money(amount=Decimal("1"), currency="usd")
    with pytest.raises(ValidationError):
        Usage(prompt_tokens=2147483648, completion_tokens=None, total_tokens=None)


@pytest.mark.parametrize("code", [Code.PROVIDER_TIMEOUT, Code.PROVIDER_UNAVAILABLE])
@pytest.mark.parametrize("stage", [Stage.CONNECT, Stage.SEND])
def test_only_confirmed_unsent_transient_failure_is_safe(code: Code, stage: Stage) -> None:
    error = CollectorError(code, stage=stage, external_call_state=State.NOT_STARTED)
    assert error.failure.retryability == Retry.SAFE_BEFORE_SEND
    assert error.failure.run_error_stage == GeoRunErrorStage.COLLECTION


@pytest.mark.parametrize("state", [State.SENT, State.UNKNOWN, State.COMPLETED])
@pytest.mark.parametrize(
    "code",
    [
        Code.PROVIDER_TIMEOUT,
        Code.PROVIDER_UNAVAILABLE,
        Code.PROVIDER_RESPONSE_INVALID,
        Code.PROVIDER_RATE_LIMITED,
        Code.PROVIDER_AUTH_FAILED,
    ],
)
def test_sent_failure_never_allows_same_attempt_resend(code: Code, state: State) -> None:
    error = CollectorError(code, stage=Stage.RECEIVE, external_call_state=state)
    assert error.failure.retryability != Retry.SAFE_BEFORE_SEND
    assert error.failure.external_call_state == state


def test_rate_limit_wait_is_new_attempt_metadata_only() -> None:
    error = CollectorError(
        Code.PROVIDER_RATE_LIMITED,
        stage=Stage.RECEIVE,
        external_call_state=State.COMPLETED,
        provider_status=429,
        retry_after_seconds=15,
    )
    assert error.failure.retryability == Retry.NEW_ATTEMPT_ONLY
    assert error.failure.retry_after_seconds == 15
    assert str(error) == error.failure.message == "供应商请求限流"
    with pytest.raises(FrozenInstanceError):
        error.failure.external_call_state = State.NOT_STARTED  # type: ignore[misc]


@pytest.mark.parametrize(
    "code,stage,state,metadata",
    [
        (Code.PROVIDER_TIMEOUT, Stage.CONNECT, State.SENT, {}),
        (Code.PROVIDER_TIMEOUT, Stage.RECEIVE, State.NOT_STARTED, {}),
        (Code.PROVIDER_RESPONSE_INVALID, Stage.PARSE, State.UNKNOWN, {}),
        (Code.PROVIDER_RESPONSE_INVALID, Stage.EVIDENCE, State.NOT_STARTED, {}),
        (Code.COLLECTOR_UNKNOWN_OUTCOME, Stage.SEND, State.NOT_STARTED, {}),
        (Code.COLLECTOR_UNKNOWN_OUTCOME, Stage.RECEIVE, State.COMPLETED, {}),
        (Code.ANALYSIS_FAILED, Stage.PARSE, State.COMPLETED, {}),
        (Code.WORKER_LOST, Stage.RECEIVE, State.UNKNOWN, {}),
        (Code.PROVIDER_RATE_LIMITED, Stage.RECEIVE, State.SENT, {"provider_status": 429}),
        (Code.PROVIDER_RATE_LIMITED, Stage.RECEIVE, State.COMPLETED, {"provider_status": True}),
        (Code.PROVIDER_RATE_LIMITED, Stage.RECEIVE, State.COMPLETED, {"retry_after_seconds": 15}),
        (Code.PROVIDER_TIMEOUT, Stage.RECEIVE, State.COMPLETED, {"retry_after_seconds": 15}),
    ],
)
def test_inconsistent_or_wrong_owner_error_rejected(
    code: Code, stage: Stage, state: State, metadata: dict[str, Any]
) -> None:
    with pytest.raises(ValidationError):
        CollectorError(code, stage=stage, external_call_state=state, **metadata)


def test_error_requires_explicit_send_state_and_cannot_accept_raw_provider_message() -> None:
    with pytest.raises(TypeError):
        CollectorError(Code.PROVIDER_TIMEOUT, stage=Stage.RECEIVE)  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        CollectorError(
            Code.PROVIDER_TIMEOUT,
            stage=Stage.RECEIVE,
            external_call_state=State.UNKNOWN,
            message="Bearer synthetic-secret",  # type: ignore[call-arg]
        )
    error = CollectorError(
        Code.COLLECTOR_UNKNOWN_OUTCOME, stage=Stage.RECEIVE, external_call_state=State.UNKNOWN
    )
    with pytest.raises(CollectorError) as caught:
        raise error from None
    assert "synthetic-secret" not in repr(caught.value)
    assert caught.value.failure.retryability == Retry.NEW_ATTEMPT_ONLY


def test_protocol_exposes_single_metadata_owner_and_required_send_boundary() -> None:
    assert get_type_hints(GeoCollector.collect)["request"] is CollectionRequest
    assert get_type_hints(GeoCollector.collect)["return"] is CollectedAnswer
    parameter = inspect.signature(GeoCollector.collect).parameters["before_send"]
    assert parameter.kind == inspect.Parameter.KEYWORD_ONLY
    assert parameter.default is inspect.Parameter.empty
    assert not isinstance(collector_registry.resolve("manual"), GeoCollector)
    assert collector_registry.capabilities("manual") <= frozenset(CollectorCapability)


def test_collector_modules_do_not_depend_on_orm_or_transaction_owner() -> None:
    root = Path(__file__).resolve().parents[2] / "app/collectors"
    for path in root.glob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert not (node.module or "").startswith(
                    ("sqlalchemy", "app.db", "app.models", "app.services")
                )
            elif isinstance(node, ast.Import):
                assert all(not n.name.startswith("sqlalchemy") for n in node.names)
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                assert node.func.attr not in {"commit", "rollback", "flush", "execute"}
