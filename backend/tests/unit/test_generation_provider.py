"""生成业务通过实际 SDK 序列化请求并严格拒绝非法草稿。"""

from __future__ import annotations

import json
from typing import Any, cast

import httpx2
import pytest
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.ai_generation import AIChannel, AIModel, GenerationJob
from app.services import generation
from app.services.ai_provider import AIProvider
from tests.unit.test_generation import (
    CHANNEL_ID,
    MODEL_ID,
    SnapshotSession,
    generation_input_v3,
    humanization_input,
)

DRAFT = {"title": "标题", "summary": "摘要", "body_markdown": "正文", "tags": ["标签"]}


def sdk_context(
    monkeypatch: pytest.MonkeyPatch, transport: httpx2.BaseTransport, job_type: str
) -> tuple[Session, GenerationJob, dict[str, Any]]:
    snapshot = generation_input_v3() if job_type == "GENERATE" else humanization_input()
    snapshot["channel"].update(id=str(CHANNEL_ID), base_url="https://fake.invalid/v1")
    snapshot["model"].update(id=str(MODEL_ID), request_parameters={"temperature": 0})
    channel = AIChannel(
        id=CHANNEL_ID, is_enabled=True, protocol_type="openai-compatible-chat-completions"
    )
    model = AIModel(id=MODEL_ID, is_enabled=True, test_status="PASSED")
    db = cast(Session, SnapshotSession({AIChannel: channel, AIModel: model}))
    job = GenerationJob(
        job_type=job_type,
        ai_channel_id=CHANNEL_ID,
        ai_model_id=MODEL_ID,
        adapter_name="openai-compatible-chat-completions",
    )

    def provider(*, allow_local_http: bool) -> AIProvider:
        return AIProvider(allow_local_http=allow_local_http, transport=transport)

    monkeypatch.setattr(generation, "AIProvider", provider)
    monkeypatch.setattr(generation, "request_credentials", lambda *a, **k: ("fake-key", {}))
    return db, job, snapshot


@pytest.mark.parametrize("job_type", ["GENERATE", "HUMANIZE"])
def test_generation_sdk_preserves_exact_messages_parameters_and_metrics(
    monkeypatch: pytest.MonkeyPatch, job_type: str
) -> None:
    requests: list[httpx2.Request] = []

    def respond(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(
            200,
            headers={"X-Request-ID": "req-generation"},
            json={
                "choices": [{"message": {"content": json.dumps(DRAFT)}}],
                "usage": {"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5},
            },
        )

    db, job, snapshot = sdk_context(monkeypatch, httpx2.MockTransport(respond), job_type)
    draft, result = generation.generate_for_job(db, job, snapshot, None)
    assert draft.model_dump() == DRAFT
    assert result is not None
    assert result.provider_request_id == "req-generation"
    assert type(result.duration_ms) is int and result.duration_ms >= 0
    assert (result.prompt_tokens, result.completion_tokens, result.total_tokens) == (2, 3, 5)
    (request,) = requests
    assert request.url.path == "/v1/chat/completions"
    assert json.loads(request.content) == {
        "model": "demo",
        "stream": False,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": snapshot["system_message"]},
            {"role": "user", "content": snapshot["user_message"]},
        ],
    }


@pytest.mark.parametrize("job_type", ["GENERATE", "HUMANIZE"])
@pytest.mark.parametrize(
    "content",
    [
        "", "not-json", "```json\n{}\n```", "null", "[]", "{}",
        json.dumps({**DRAFT, "body_markdown": " \n"}),
        json.dumps({**DRAFT, "tags": []}),
        json.dumps({**DRAFT, "extra": "fake-provider-secret"}),
    ],
)
def test_sdk_success_with_invalid_business_content_fails_safely(
    monkeypatch: pytest.MonkeyPatch, job_type: str, content: str
) -> None:
    transport = httpx2.MockTransport(
        lambda _: httpx2.Response(200, json={"choices": [{"message": {"content": content}}]})
    )
    db, job, snapshot = sdk_context(monkeypatch, transport, job_type)
    with pytest.raises(AppError) as caught:
        generation.generate_for_job(db, job, snapshot, None)
    assert (caught.value.code, caught.value.status_code) == ("AI_RESPONSE_INVALID", 502)
    assert "fake-provider-secret" not in caught.value.message
    assert caught.value.__suppress_context__ is True


@pytest.mark.parametrize("job_type", ["GENERATE", "HUMANIZE"])
@pytest.mark.parametrize("classification", ["INTERNAL", "RESTRICTED"])
def test_non_public_snapshots_fail_before_sdk_send(
    monkeypatch: pytest.MonkeyPatch, job_type: str, classification: str
) -> None:
    def forbid_request(_: httpx2.Request) -> httpx2.Response:
        pytest.fail("非 PUBLIC 输入不得外发")

    db, job, snapshot = sdk_context(monkeypatch, httpx2.MockTransport(forbid_request), job_type)
    snapshot["fact_version"]["classification"] = classification
    with pytest.raises(AppError) as caught:
        generation.generate_for_job(db, job, snapshot, None)
    assert caught.value.code == "AI_DATA_CLASSIFICATION_FORBIDDEN"


@pytest.mark.parametrize(
    "exception,code",
    [(httpx2.ReadTimeout, "AI_PROVIDER_TIMEOUT"), (httpx2.ConnectError, "AI_PROVIDER_UNAVAILABLE")],
)
def test_generation_sdk_errors_are_mapped_without_retry_or_fallback(
    monkeypatch: pytest.MonkeyPatch, exception: type[httpx2.RequestError], code: str
) -> None:
    requests: list[httpx2.Request] = []

    def fail(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        raise exception("fake-provider-secret", request=request)

    db, job, snapshot = sdk_context(monkeypatch, httpx2.MockTransport(fail), "GENERATE")
    with pytest.raises(AppError) as caught:
        generation.generate_for_job(db, job, snapshot, None)
    assert caught.value.code == code
    assert len(requests) == 1
    assert "fake-provider-secret" not in caught.value.message
