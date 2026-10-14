"""本机 HTTP fake 与 PostgreSQL 验证 SDK 生成及在途资格复核。"""

from __future__ import annotations

import json
import uuid
from datetime import timedelta
from typing import Any

import psycopg
import pytest

from app.services import generation, generation_dispatch
from tests.ai_provider_support import FakeAIProvider, fake_ai_provider
from tests.integration.test_generation_reliability import (
    patched_sessions,
    seed_generation_job,
    seed_humanization_job,
    temporary_database,
)

DRAFT = {"title": "SDK 草稿", "summary": "SDK 摘要", "body_markdown": "批准事实。", "tags": ["SDK"]}


def response_body(content: str, *, usage: dict[str, int] | None = None) -> bytes:
    return json.dumps(
        {"choices": [{"message": {"content": content}}], "usage": usage}, ensure_ascii=False
    ).encode()


def prepare_job(test_url: str, provider: FakeAIProvider, job_type: str) -> uuid.UUID:
    """自然化必须基于本机 HTTP 真正生成的 AI 草稿，不能伪造成功来源。"""
    job_id = seed_generation_job(test_url, base_url=provider.base_url)
    if job_type == "GENERATE":
        return job_id
    generation.process_generation_job(job_id)
    with psycopg.connect(test_url) as db:
        row = db.execute(
            "SELECT status, content_version_id FROM generation_jobs WHERE id=%s", (job_id,)
        ).fetchone()
        assert row is not None and row[0] == "SUCCEEDED"
    return seed_humanization_job(test_url, job_id, row[1])


def assert_failed_without_result(test_url: str, job_id: uuid.UUID, code: str) -> None:
    with psycopg.connect(test_url) as db:
        row = db.execute(
            "SELECT status, error_code, error_summary, content_version_id, "
            "provider_request_id, response_duration_ms, prompt_tokens, completion_tokens, "
            "total_tokens, lease_expires_at, attempt_count FROM generation_jobs WHERE id=%s",
            (job_id,),
        ).fetchone()
        assert row is not None and row[:2] == ("FAILED", code)
        assert row[3:10] == (None,) * 7
        assert row[10] == 1
        for secret in ("fake-provider-secret", "integration-api-key"):
            assert secret not in row[2]
        assert db.execute(
            "SELECT count(*) FROM content_versions WHERE source_job_id=%s", (job_id,)
        ).fetchone() == (0,)


@pytest.mark.integration
@pytest.mark.parametrize("job_type", ["GENERATE", "HUMANIZE"])
@pytest.mark.parametrize("report_usage", [True, False])
def test_sdk_job_preserves_snapshot_messages_metrics_and_source(
    monkeypatch: pytest.MonkeyPatch, job_type: str, report_usage: bool
) -> None:
    with (
        temporary_database("partsignal_sdk_metrics") as (test_url, sqlalchemy_url, _),
        fake_ai_provider() as provider,
        patched_sessions(monkeypatch, sqlalchemy_url),
    ):
        usage = {"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5}
        provider.response_body = response_body(
            json.dumps(DRAFT), usage=usage if report_usage else None
        )
        job_id = prepare_job(test_url, provider, job_type)
        with psycopg.connect(test_url) as db:
            before = db.execute(
                "SELECT input_snapshot, source_content_version_id FROM generation_jobs WHERE id=%s",
                (job_id,),
            ).fetchone()
            assert before is not None
            source = db.execute(
                "SELECT * FROM content_versions WHERE id=%s", (before[1],)
            ).fetchone()
        previous_calls = len(provider.requests)
        generation.process_generation_job(job_id)
        generation.process_generation_job(job_id)
        assert len(provider.requests) == previous_calls + 1
        request = provider.requests[-1]
        assert (request["method"], request["path"]) == ("POST", "/custom/v1/chat/completions")
        snapshot = before[0]
        assert request["body"] == {
            "model": snapshot["model"]["model_id"],
            "messages": [
                {"role": "system", "content": snapshot["system_message"]},
                {"role": "user", "content": snapshot["user_message"]},
            ],
            "stream": False,
            **snapshot["model"]["request_parameters"],
        }
        assert request["headers"]["Authorization"] == "Bearer integration-api-key"
        with psycopg.connect(test_url) as db:
            row = db.execute(
                "SELECT status, provider_request_id, response_duration_ms, prompt_tokens, "
                "completion_tokens, total_tokens, input_snapshot FROM generation_jobs WHERE id=%s",
                (job_id,),
            ).fetchone()
            assert row is not None and row[:2] == ("SUCCEEDED", "fake-request-id")
            assert type(row[2]) is int and row[2] >= 0
            assert row[3:6] == ((2, 3, 5) if report_usage else (None,) * 3)
            assert row[6] == snapshot
            assert "integration-api-key" not in json.dumps(row[6])
            assert db.execute(
                "SELECT based_on_id, status FROM content_versions WHERE source_job_id=%s",
                (job_id,),
            ).fetchall() == [(before[1], "DRAFT")]
            assert db.execute(
                "SELECT * FROM content_versions WHERE id=%s", (before[1],)
            ).fetchone() == source


@pytest.mark.integration
@pytest.mark.parametrize("job_type", ["GENERATE", "HUMANIZE"])
@pytest.mark.parametrize(
    "body",
    [
        response_body("fake-provider-secret"),
        response_body(json.dumps({**DRAFT, "body_markdown": " \n"})),
        response_body(json.dumps({**DRAFT, "extra": "fake-provider-secret"})),
        b'{"choices":[]}',
    ],
)
def test_sdk_success_with_invalid_output_commits_safe_failure(
    monkeypatch: pytest.MonkeyPatch, job_type: str, body: bytes
) -> None:
    with (
        temporary_database("partsignal_sdk_invalid") as (test_url, sqlalchemy_url, _),
        fake_ai_provider() as provider,
        patched_sessions(monkeypatch, sqlalchemy_url),
    ):
        provider.response_body = response_body(json.dumps(DRAFT))
        job_id = prepare_job(test_url, provider, job_type)
        provider.response_body = body
        previous_calls = len(provider.requests)
        generation.process_generation_job(job_id)
        generation.process_generation_job(job_id)
        assert len(provider.requests) == previous_calls + 1
        assert_failed_without_result(test_url, job_id, "AI_RESPONSE_INVALID")


@pytest.mark.integration
@pytest.mark.parametrize("job_type", ["GENERATE", "HUMANIZE"])
@pytest.mark.parametrize("status", [429, 503])
def test_retryable_sdk_http_errors_are_never_automatically_replayed(
    monkeypatch: pytest.MonkeyPatch, job_type: str, status: int
) -> None:
    with (
        temporary_database("partsignal_sdk_http_error") as (test_url, sqlalchemy_url, _),
        fake_ai_provider() as provider,
        patched_sessions(monkeypatch, sqlalchemy_url),
    ):
        provider.response_body = response_body(json.dumps(DRAFT))
        job_id = prepare_job(test_url, provider, job_type)
        provider.response_body = None
        provider.status = status
        previous_calls = len(provider.requests)
        generation.process_generation_job(job_id)
        generation.process_generation_job(job_id)
        assert len(provider.requests) == previous_calls + 1
        assert_failed_without_result(test_url, job_id, "AI_PROVIDER_ERROR")


@pytest.mark.integration
@pytest.mark.parametrize(
    "job_type,invalidation,code",
    [
        ("GENERATE", "fact", "FACT_NOT_APPROVED"),
        ("HUMANIZE", "fact", "FACT_NOT_APPROVED"),
        ("GENERATE", "task", "INVALID_STATE_TRANSITION"),
        ("HUMANIZE", "task", "INVALID_STATE_TRANSITION"),
        ("HUMANIZE", "source", "HUMANIZATION_SOURCE_INVALID"),
        ("GENERATE", "mainline", "CONTENT_MAINLINE_EXISTS"),
        ("HUMANIZE", "mainline", "CONTENT_VERSION_NOT_CURRENT"),
    ],
)
def test_sdk_inflight_invalidation_cannot_commit_a_result(
    monkeypatch: pytest.MonkeyPatch, job_type: str, invalidation: str, code: str
) -> None:
    with (
        temporary_database("partsignal_sdk_inflight") as (test_url, sqlalchemy_url, _),
        fake_ai_provider() as provider,
        patched_sessions(monkeypatch, sqlalchemy_url),
    ):
        provider.response_body = response_body(json.dumps(DRAFT))
        job_id = prepare_job(test_url, provider, job_type)
        with psycopg.connect(test_url) as db:
            identity = db.execute(
                "SELECT g.content_task_id, t.fact_version_id, g.source_content_version_id "
                "FROM generation_jobs g JOIN content_tasks t ON t.id=g.content_task_id "
                "WHERE g.id=%s", (job_id,),
            ).fetchone()
            assert identity is not None
        task_id, fact_id, source_id = identity

        def invalidate() -> None:
            # HTTP 已接收后由另一连接提交失效，不能依赖 Worker 内缓存的 ORM 状态。
            with psycopg.connect(test_url) as db:
                if invalidation == "fact":
                    db.execute("UPDATE fact_versions SET status='RETIRED' WHERE id=%s", (fact_id,))
                elif invalidation == "task":
                    db.execute(
                        "UPDATE content_tasks SET status='CANCELLED' WHERE id=%s", (task_id,)
                    )
                elif invalidation == "source":
                    db.execute(
                        "UPDATE content_versions SET status='ABANDONED' WHERE id=%s", (source_id,)
                    )
                elif job_type == "HUMANIZE":
                    db.execute(
                        "UPDATE content_tasks SET current_content_version_id=NULL WHERE id=%s",
                        (task_id,),
                    )
                else:
                    from tests.integration.test_generation_reliability import (
                        _insert_content_version_source,
                    )

                    _insert_content_version_source(test_url, job_id, omit_source_job=True)
                    db.execute(
                        "UPDATE content_tasks SET current_content_version_id="
                        "(SELECT id FROM content_versions WHERE task_id=%s) WHERE id=%s",
                        (task_id, task_id),
                    )

        provider.before_response = invalidate
        previous_calls = len(provider.requests)
        generation.process_generation_job(job_id)
        assert len(provider.requests) == previous_calls + 1
        assert_failed_without_result(test_url, job_id, code)


@pytest.mark.integration
@pytest.mark.parametrize("job_type", ["GENERATE", "HUMANIZE"])
@pytest.mark.parametrize("status", [200, 503])
def test_late_sdk_failure_cannot_overwrite_an_expired_terminal_job(
    monkeypatch: pytest.MonkeyPatch, job_type: str, status: int
) -> None:
    with (
        temporary_database("partsignal_sdk_late_failure") as (test_url, sqlalchemy_url, _),
        fake_ai_provider() as provider,
        patched_sessions(monkeypatch, sqlalchemy_url),
    ):
        provider.response_body = response_body(json.dumps(DRAFT))
        job_id = prepare_job(test_url, provider, job_type)
        provider.status = status
        provider.response_body = response_body("fake-provider-secret") if status == 200 else None
        terminal: list[tuple[Any, ...]] = []

        def expire_lease() -> None:
            with psycopg.connect(test_url) as db:
                lease = db.execute(
                    "SELECT lease_expires_at FROM generation_jobs WHERE id=%s", (job_id,)
                ).fetchone()
                assert lease is not None
            assert generation_dispatch.fail_expired_generation_jobs(
                now=lease[0] + timedelta(seconds=1)
            ) == 1
            with psycopg.connect(test_url) as db:
                row = db.execute("SELECT * FROM generation_jobs WHERE id=%s", (job_id,)).fetchone()
                assert row is not None
                terminal.append(row)

        provider.before_response = expire_lease
        previous_calls = len(provider.requests)
        generation.process_generation_job(job_id)
        generation.process_generation_job(job_id)
        assert len(provider.requests) == previous_calls + 1
        with psycopg.connect(test_url) as db:
            assert db.execute(
                "SELECT status, error_code FROM generation_jobs WHERE id=%s", (job_id,)
            ).fetchone() == ("FAILED", "WORKER_LOST")
            assert db.execute(
                "SELECT * FROM generation_jobs WHERE id=%s", (job_id,)
            ).fetchone() == terminal[0]
            assert db.execute(
                "SELECT count(*) FROM content_versions WHERE source_job_id=%s", (job_id,)
            ).fetchone() == (0,)
