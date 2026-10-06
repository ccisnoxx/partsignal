"""真实 PostgreSQL、Redis 与独占 Celery Worker 的业务模式门禁。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from functools import partial
from pathlib import Path

import psycopg
import pytest
from celery import Celery
from redis import Redis

from app.config import settings
from app.errors import AppError
from app.models.ai_generation import GenerationJob
from app.models.content import ContentTask, ContentVersion
from app.models.identity import User
from app.routers.production import generation_jobs_out, get_generation_options
from app.schemas.common import RevisionRequest
from app.schemas.content import HumanizationJobCreate, OriginalGenerationJobCreate
from app.services import ai_configuration, content_production, generation
from app.services.content_task_queries import get_platform_prompt_preview_options
from app.services.projections import content_tasks_out, content_versions_out
from tests.integration.test_generation_reliability import (
    _prepare_humanization_graph,
    _seed_pending_job_with_existing_source,
    clone_retry_job,
    fake_ai_server,
    patched_sessions,
    seed_generation_job,
    seed_humanization_job,
    temporary_database,
)
from tests.unit.test_generation_runtime_mode import TestGenerator


def _terminal_row(test_url: str, job_id: uuid.UUID) -> tuple:
    with psycopg.connect(test_url) as connection:
        return connection.execute(
            "SELECT status, error_code, attempt_count, started_at, finished_at, "
            "lease_expires_at, content_version_id, provider_request_id, response_duration_ms, "
            "prompt_tokens, completion_tokens, total_tokens FROM generation_jobs WHERE id = %s",
            (job_id,),
        ).fetchone()


def _assert_disabled_terminal(test_url: str, job_id: uuid.UUID) -> tuple:
    row = _terminal_row(test_url, job_id)
    assert row[:4] == ("FAILED", "AI_GENERATION_DISABLED", 0, None)
    assert row[4] is not None
    assert row[5:] == (None,) * 7
    with psycopg.connect(test_url) as connection:
        assert connection.execute(
            "SELECT count(*) FROM content_versions WHERE source_job_id = %s",
            (job_id,),
        ).fetchone() == (0,)
    return row


@pytest.mark.integration
def test_disabled_projections_commands_and_replays_are_side_effect_free(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with (
        temporary_database("partsignal_mode_commands") as (test_url, sqlalchemy_url, _),
        fake_ai_server() as (base_url, state),
        patched_sessions(monkeypatch, sqlalchemy_url) as factory,
    ):
        generate_id = seed_generation_job(test_url, base_url=base_url)
        with psycopg.connect(test_url) as connection:
            connection.execute(
                "UPDATE generation_jobs SET status='FAILED' WHERE id=%s",
                (generate_id,),
            )
        generate_retry = clone_retry_job(test_url, generate_id)
        original_id, human_task_id, source_id, model_id, actor_id = _prepare_humanization_graph(
            test_url,
            base_url,
        )
        human_id = seed_humanization_job(test_url, original_id, source_id)
        with psycopg.connect(test_url) as connection:
            connection.execute(
                "UPDATE generation_jobs SET status='FAILED' WHERE id=%s",
                (human_id,),
            )
        human_retry = clone_retry_job(test_url, human_id)
        with factory() as db:
            previous = db.get(GenerationJob, generate_id)
            task_id = previous.content_task_id
            actor = db.get(User, actor_id)
            source = db.get(ContentVersion, source_id)
            assert (
                "CREATE_HUMANIZATION_JOB"
                not in content_versions_out(db, [source])[0].available_actions
            )
            # 清除活动 retry 后，可用投影必须先证明 openai 模式确实给出业务动作。
            for retry_id in (generate_retry, human_retry):
                db.get(GenerationJob, retry_id).status = "FAILED"
            db.commit()
            task = db.get(ContentTask, task_id)
            assert "CREATE_GENERATION_JOB" in content_tasks_out(db, [task])[0].available_actions
            assert (
                "CREATE_HUMANIZATION_JOB" in content_versions_out(db, [source])[0].available_actions
            )
            options = get_generation_options(task_id, db, actor)
            assert options.models
            prompt_id = options.platform_prompt.id
            assert get_platform_prompt_preview_options(db, prompt_id).contexts
            assert generation_jobs_out(db, [db.get(GenerationJob, generate_retry)])[
                0
            ].available_actions == ["RETRY"]
            before = [
                (job.id, job.status, job.input_snapshot, job.finished_at)
                for job in db.query(GenerationJob).order_by(GenerationJob.id)
            ]
            pointers = [
                (item.id, item.current_content_version_id, item.revision)
                for item in db.query(ContentTask)
            ]
            monkeypatch.setattr(settings, "content_generator", "deterministic")
            assert "CREATE_GENERATION_JOB" not in content_tasks_out(db, [task])[0].available_actions
            assert "CREATE_MANUAL_VERSION" in content_tasks_out(db, [task])[0].available_actions
            assert (
                "CREATE_HUMANIZATION_JOB"
                not in content_versions_out(db, [source])[0].available_actions
            )
            assert "CREATE_REVISION" in content_versions_out(db, [source])[0].available_actions
            assert get_generation_options(task_id, db, actor).models == []
            preview = get_platform_prompt_preview_options(db, prompt_id)
            assert preview.contexts == [] and preview.models == []
            assert (
                generation_jobs_out(db, [db.get(GenerationJob, generate_retry)])[
                    0
                ].available_actions
                == []
            )

            def no_dispatch(_job: GenerationJob) -> None:
                pytest.fail("关闭模式不应投递 Redis")

            monkeypatch.setattr(content_production, "_dispatch_job", no_dispatch)
            for replay in (False, True):
                common = {"db": db, "actor": actor, "request_id": "mode-commands"}
                commands = [
                    partial(
                        content_production.create_generation_job,
                        **common,
                        content_task_id=task_id,
                        payload=OriginalGenerationJobCreate(
                            ai_model_id=previous.ai_model_id,
                            platform_prompt_id=prompt_id,
                            platform_prompt_revision=options.platform_prompt.revision,
                        ),
                        idempotency_key=previous.idempotency_key if replay else "new-generate-key",
                    ),
                    partial(
                        content_production.create_humanization_job,
                        **common,
                        content_version_id=source_id,
                        payload=HumanizationJobCreate(ai_model_id=model_id),
                        idempotency_key=db.get(GenerationJob, human_id).idempotency_key
                        if replay
                        else "new-humanize-key",
                    ),
                ]
                for failed_id, retry_id in ((generate_id, generate_retry), (human_id, human_retry)):
                    with pytest.raises(AppError) as captured:
                        content_production.retry_generation_job(
                            **common,
                            generation_job_id=failed_id,
                            idempotency_key=db.get(GenerationJob, retry_id).idempotency_key
                            if replay
                            else f"new-retry-{failed_id}",
                        )
                    assert (
                        captured.value.code,
                        captured.value.status_code,
                        captured.value.details,
                    ) == ("AI_GENERATION_DISABLED", 409, {})
                for command in commands:
                    with pytest.raises(AppError) as captured:
                        command()
                    assert captured.value.code == "AI_GENERATION_DISABLED"
            assert before == [
                (job.id, job.status, job.input_snapshot, job.finished_at)
                for job in db.query(GenerationJob).order_by(GenerationJob.id)
            ]
            assert pointers == [
                (item.id, item.current_content_version_id, item.revision)
                for item in db.query(ContentTask)
            ]
            assert db.get(ContentTask, human_task_id).current_content_version_id == source_id
        assert state.calls == 1


@pytest.mark.integration
@pytest.mark.parametrize("execution", ["worker", "eager"])
def test_pending_generate_humanize_and_retries_fail_before_provider_and_replay(
    monkeypatch: pytest.MonkeyPatch,
    execution: str,
) -> None:
    with (
        temporary_database("partsignal_mode_pending") as (test_url, sqlalchemy_url, _),
        fake_ai_server() as (base_url, state),
        patched_sessions(monkeypatch, sqlalchemy_url),
    ):
        original_id, _, source_id, _, _ = _prepare_humanization_graph(test_url, base_url)
        generate_id = seed_generation_job(test_url, base_url=base_url)
        human_id = seed_humanization_job(test_url, original_id, source_id)
        monkeypatch.setattr(settings, "content_generator", "deterministic")
        monkeypatch.setattr(settings, "generation_eager", execution == "eager")

        def process(job_id: uuid.UUID) -> None:
            if execution == "eager":
                content_production._dispatch_job(GenerationJob(id=job_id))
            else:
                generation.process_generation_job(job_id)

        for job_id in (generate_id, human_id):
            process(job_id)
            first = _assert_disabled_terminal(test_url, job_id)
            process(job_id)
            assert _terminal_row(test_url, job_id) == first
            retry_id = clone_retry_job(test_url, job_id)
            process(retry_id)
            first_retry = _assert_disabled_terminal(test_url, retry_id)
            process(retry_id)
            assert _terminal_row(test_url, retry_id) == first_retry
        with psycopg.connect(test_url) as connection:
            assert connection.execute("SELECT count(*) FROM content_versions").fetchone() == (1,)
            assert connection.execute("SELECT count(*) FROM audit_logs").fetchone() == (0,)
        assert state.calls == 1


@pytest.mark.integration
@pytest.mark.parametrize("mode", ["deterministic", "openai-compatible"])
def test_invalid_pending_snapshot_fails_without_provider_or_attempt(
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
) -> None:
    with (
        temporary_database("partsignal_mode_invalid") as (test_url, sqlalchemy_url, _),
        fake_ai_server() as (base_url, state),
        patched_sessions(monkeypatch, sqlalchemy_url),
    ):
        job_id = seed_generation_job(test_url, base_url=base_url, snapshot_override={})
        monkeypatch.setattr(settings, "content_generator", mode)
        generation.process_generation_job(job_id)
        first = _terminal_row(test_url, job_id)
        code = (
            "AI_GENERATION_DISABLED" if mode == "deterministic" else "GENERATION_SNAPSHOT_INVALID"
        )
        assert first[:4] == ("FAILED", code, 0, None)
        assert first[4] is not None and first[5:] == (None,) * 7
        generation.process_generation_job(job_id)
        assert _terminal_row(test_url, job_id) == first
        assert state.calls == 0


@pytest.mark.integration
def test_enabled_generate_and_humanize_retry_copy_snapshot_and_call_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with (
        temporary_database("partsignal_mode_retry") as (test_url, sqlalchemy_url, _),
        fake_ai_server(status_code=500) as (base_url, state),
        patched_sessions(monkeypatch, sqlalchemy_url) as factory,
    ):
        monkeypatch.setattr(content_production, "_dispatch_job", lambda _job: None)
        generate_id = seed_generation_job(test_url, base_url=base_url)
        generation.process_generation_job(generate_id)
        assert _terminal_row(test_url, generate_id)[:2] == ("FAILED", "AI_PROVIDER_ERROR")
        assert state.calls == 1
        state.status_code = 200

        def retry(previous_id: uuid.UUID) -> uuid.UUID:
            with factory() as db:
                previous = db.get(GenerationJob, previous_id)
                job = content_production.retry_generation_job(
                    db=db,
                    generation_job_id=previous_id,
                    actor=db.get(User, previous.created_by),
                    request_id="enabled-retry",
                    idempotency_key=f"retry-mode-{previous_id}",
                )
                assert job.input_snapshot == previous.input_snapshot
                assert job.retry_of_id == previous_id and job.job_type == previous.job_type
                return job.id

        generate_retry = retry(generate_id)
        generation.process_generation_job(generate_retry)
        generation.process_generation_job(generate_retry)
        assert state.calls == 2
        with psycopg.connect(test_url) as connection:
            source_id = connection.execute(
                "SELECT content_version_id FROM generation_jobs WHERE id=%s",
                (generate_retry,),
            ).fetchone()[0]
        human_id = seed_humanization_job(test_url, generate_retry, source_id)
        state.status_code = 500
        generation.process_generation_job(human_id)
        assert _terminal_row(test_url, human_id)[:2] == ("FAILED", "AI_PROVIDER_ERROR")
        assert state.calls == 3
        human_retry = retry(human_id)
        state.status_code = 200
        generation.process_generation_job(human_retry)
        generation.process_generation_job(human_retry)
        assert state.calls == 4
        for job_id in (generate_retry, human_retry):
            row = _terminal_row(test_url, job_id)
            assert row[:3] == ("SUCCEEDED", None, 1)
            assert row[7] == "req-reliability" and row[9:] == (10, 20, 30)
        with psycopg.connect(test_url) as connection:
            assert connection.execute(
                "SELECT based_on_id FROM content_versions WHERE source_job_id=%s",
                (human_retry,),
            ).fetchone() == (source_id,)
            assert connection.execute("SELECT count(*) FROM content_versions").fetchone() == (2,)


@pytest.mark.integration
def test_disabled_pending_recovery_preserves_history_and_attempt_diagnostics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with (
        temporary_database("partsignal_mode_history") as (test_url, sqlalchemy_url, _),
        fake_ai_server() as (base_url, state),
        patched_sessions(monkeypatch, sqlalchemy_url),
    ):
        job_id, version_id = _seed_pending_job_with_existing_source(test_url, base_url)
        with psycopg.connect(test_url) as connection:
            connection.execute(
                "UPDATE generation_jobs SET attempt_count=3, started_at=%s, lease_expires_at=%s, "
                "content_version_id=%s "
                "WHERE id=%s",
                (datetime(2026, 1, 1, tzinfo=UTC), datetime.now(UTC), version_id, job_id),
            )
            connection.execute(
                "UPDATE content_tasks SET current_content_version_id=%s WHERE id="
                "(SELECT content_task_id FROM generation_jobs WHERE id=%s)",
                (version_id, job_id),
            )
            history = connection.execute("SELECT * FROM content_versions").fetchall()
            tasks = connection.execute("SELECT * FROM content_tasks").fetchall()
        monkeypatch.setattr(settings, "content_generator", "deterministic")
        generation.process_generation_job(job_id)
        first = _terminal_row(test_url, job_id)
        assert first[:4] == (
            "FAILED",
            "AI_GENERATION_DISABLED",
            3,
            datetime(2026, 1, 1, tzinfo=UTC),
        )
        assert first[4] is not None and first[5:] == (None, version_id, *([None] * 5))
        generation.process_generation_job(job_id)
        assert _terminal_row(test_url, job_id) == first
        with psycopg.connect(test_url) as connection:
            assert connection.execute("SELECT * FROM content_versions").fetchall() == history
            assert connection.execute("SELECT * FROM content_tasks").fetchall() == tasks
            assert connection.execute("SELECT id FROM content_versions").fetchone() == (version_id,)
        assert state.calls == 0


@pytest.mark.integration
def test_disabled_business_mode_still_allows_explicit_admin_discovery_and_model_test(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with (
        temporary_database("partsignal_mode_admin") as (test_url, sqlalchemy_url, _),
        fake_ai_server() as (base_url, state),
        patched_sessions(monkeypatch, sqlalchemy_url) as factory,
    ):
        job_id = seed_generation_job(test_url, base_url=base_url)
        monkeypatch.setattr(settings, "content_generator", "deterministic")
        with factory() as db:
            job = db.get(GenerationJob, job_id)
            actor = db.get(User, job.created_by)
            actor.account_type = "ADMIN"
            db.commit()
            discovered = ai_configuration.discover_ai_channel_models(
                db=db,
                channel_id=job.ai_channel_id,
                payload=RevisionRequest(expected_revision=0),
                actor=actor,
                request_id="explicit-admin-discover",
            )
            tested = ai_configuration.test_ai_model(
                db=db,
                model_id=job.ai_model_id,
                payload=RevisionRequest(expected_revision=0),
                actor=actor,
                request_id="explicit-admin-test",
            )
            assert discovered == ["reliability-model"]
            assert tested.test_status == "PASSED" and not tested.is_enabled
        assert state.calls == 2
        assert state.requests[0]["path"] == "/v1/models"
        assert state.requests[1]["messages"] == [{"role": "user", "content": "hi"}]
        row = _terminal_row(test_url, job_id)
        assert row[:4] == ("PENDING", None, 0, None)
        assert row[4:] == (None,) * 8
        with psycopg.connect(test_url) as connection:
            assert connection.execute("SELECT count(*) FROM content_versions").fetchone() == (0,)


@pytest.mark.integration
def test_running_request_finishes_after_mode_closes_without_replay(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with (
        temporary_database("partsignal_mode_running") as (test_url, sqlalchemy_url, _),
        fake_ai_server(blocked=True) as (base_url, state),
        patched_sessions(monkeypatch, sqlalchemy_url),
        ThreadPoolExecutor(max_workers=1) as executor,
    ):
        job_id = seed_generation_job(test_url, base_url=base_url)
        future = executor.submit(generation.process_generation_job, job_id)
        assert state.received.wait(timeout=10)
        monkeypatch.setattr(settings, "content_generator", "deterministic")
        generation.process_generation_job(job_id)
        assert _terminal_row(test_url, job_id)[0] == "RUNNING"
        state.release.set()
        future.result(timeout=15)
        row = _terminal_row(test_url, job_id)
        assert row[:3] == ("SUCCEEDED", None, 1)
        assert row[7] == "req-reliability" and row[9:] == (10, 20, 30)
        assert state.calls == 1


@pytest.mark.integration
def test_explicit_test_generator_keeps_context_validation_in_disabled_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with (
        temporary_database("partsignal_mode_injection") as (test_url, sqlalchemy_url, _),
        patched_sessions(monkeypatch, sqlalchemy_url),
    ):
        monkeypatch.setattr(settings, "environment", "test")
        monkeypatch.setattr(settings, "content_generator", "deterministic")
        allowed_id = seed_generation_job(test_url, base_url="https://unused.example.invalid")
        forbidden_id = seed_generation_job(test_url, base_url="https://unused.example.invalid")
        with psycopg.connect(test_url) as connection:
            connection.execute(
                "UPDATE content_tasks SET status='CANCELLED' WHERE id="
                "(SELECT content_task_id FROM generation_jobs WHERE id=%s)",
                (forbidden_id,),
            )
        generator = TestGenerator()
        generation.process_generation_job(allowed_id, generator)
        generation.process_generation_job(forbidden_id, generator)
        assert _terminal_row(test_url, allowed_id)[0] == "SUCCEEDED"
        assert _terminal_row(test_url, forbidden_id)[:2] == ("FAILED", "INVALID_STATE_TRANSITION")
        assert generator.calls == 1


@contextmanager
def _celery_worker(
    sqlalchemy_url: str,
    backend_dir: Path,
    queue: str,
    mode: str,
    log_dir: Path,
) -> Iterator[tuple[Celery, Redis]]:
    """独占 worker/queue，只清理本测试创建的 Redis 路由键和进程。"""
    hostname = f"mode-{uuid.uuid4().hex}@localhost"
    broker = Celery("runtime-mode-test", broker=settings.redis_url)
    broker.conf.task_ignore_result = True
    redis = Redis.from_url(settings.redis_url)
    log_dir.mkdir(parents=True, exist_ok=True)
    code = (
        "import sys; from app.worker import celery_app; "
        "celery_app.conf.task_default_queue=sys.argv[1]; "
        "celery_app.worker_main(['worker','--pool=solo','--concurrency=1',"
        "'--queues='+sys.argv[1],'--hostname='+sys.argv[2],"
        "'--without-gossip','--without-mingle','--without-heartbeat','--loglevel=INFO'])"
    )
    with (log_dir / f"celery-{mode}-{queue}.log").open("w") as log:
        process = subprocess.Popen(
            [sys.executable, "-c", code, queue, hostname],
            cwd=backend_dir,
            env={
                **os.environ,
                "APP_ENV": "test",
                "CONTENT_GENERATOR": mode,
                "DATABASE_URL": sqlalchemy_url,
                "REDIS_URL": settings.redis_url,
                "AI_ALLOW_LOCAL_HTTP": "true",
            },
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                assert process.poll() is None, "Celery Worker 提前退出，参见独立日志"
                if broker.control.ping(destination=[hostname], timeout=0.5):
                    break
            else:
                pytest.fail("Celery Worker 未在限定时间就绪")
            yield broker, redis
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            redis.delete(queue, f"_kombu.binding.{queue}")
            assert redis.exists(queue, f"_kombu.binding.{queue}") == 0
            (log_dir / f"celery-{mode}-{queue}-cleanup.json").write_text(
                json.dumps(
                    {
                        "pid": process.pid,
                        "exit_code": process.returncode,
                        "queue": queue,
                        "queue_keys_remaining": 0,
                    }
                )
                + "\n"
            )
            broker.close()
            redis.close()


def _wait_terminal(test_url: str, job_id: uuid.UUID) -> tuple:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        row = _terminal_row(test_url, job_id)
        if row[0] in {"SUCCEEDED", "FAILED"}:
            return row
        time.sleep(0.05)
    pytest.fail("Celery Job 未在限定时间终结")


@pytest.mark.integration
@pytest.mark.parametrize("mode", ["deterministic", "openai-compatible"])
def test_real_celery_duplicate_delivery_and_beat_redispatch(
    mode: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    queue = f"runtime-mode-{uuid.uuid4().hex}"
    log_dir = Path(os.environ.get("PARTSIGNAL_TEST_AUDIT_LOG_DIR", str(tmp_path)))
    with (
        temporary_database("partsignal_mode_celery") as (test_url, sqlalchemy_url, backend_dir),
        fake_ai_server() as (base_url, state),
        patched_sessions(monkeypatch, sqlalchemy_url),
        _celery_worker(sqlalchemy_url, backend_dir, queue, mode, log_dir) as (broker, redis),
    ):
        direct_id = seed_generation_job(test_url, base_url=base_url)
        backlog_id = seed_generation_job(
            test_url,
            base_url=base_url,
            created_at=datetime.now(UTC) - timedelta(minutes=10),
        )
        for _ in range(2):
            broker.send_task("partsignal.generate_content", args=[str(direct_id)], queue=queue)
        first = _wait_terminal(test_url, direct_id)
        broker.send_task("partsignal.redispatch_pending_generation_jobs", queue=queue)
        _wait_terminal(test_url, backlog_id)
        # 同一队列中的最后一条消息充当有序栅栏，证明前面的重复投递已经消费。
        fence_id = seed_generation_job(test_url, base_url=base_url)
        broker.send_task("partsignal.generate_content", args=[str(direct_id)], queue=queue)
        broker.send_task("partsignal.generate_content", args=[str(fence_id)], queue=queue)
        _wait_terminal(test_url, fence_id)
        assert _terminal_row(test_url, direct_id) == first
        if mode == "deterministic":
            for job_id in (direct_id, backlog_id, fence_id):
                _assert_disabled_terminal(test_url, job_id)
            assert state.calls == 0
        else:
            for job_id in (direct_id, backlog_id, fence_id):
                row = _terminal_row(test_url, job_id)
                assert row[:3] == ("SUCCEEDED", None, 1)
                assert row[7] == "req-reliability" and row[9:] == (10, 20, 30)
            assert state.calls == 3
        baseline_calls = state.calls
        # 自然化通过正式 UUID Worker 执行；两种 retry 同样复制旧快照到独立 Job。
        original_id, _, source_id, _, _ = _prepare_humanization_graph(test_url, base_url)
        human_id = seed_humanization_job(test_url, original_id, source_id)
        broker.send_task("partsignal.generate_content", args=[str(human_id)], queue=queue)
        human_first = _wait_terminal(test_url, human_id)
        failed_generate = seed_generation_job(test_url, base_url=base_url)
        with psycopg.connect(test_url) as connection:
            connection.execute(
                "UPDATE generation_jobs SET status='FAILED' WHERE id=%s",
                (failed_generate,),
            )
        generate_retry = clone_retry_job(test_url, failed_generate)
        if mode == "openai-compatible":
            source_id = human_first[6]
            failed_human = seed_humanization_job(test_url, original_id, source_id)
            with psycopg.connect(test_url) as connection:
                connection.execute(
                    "UPDATE generation_jobs SET status='FAILED' WHERE id=%s",
                    (failed_human,),
                )
        else:
            failed_human = human_id
        human_retry = clone_retry_job(test_url, failed_human)
        for job_id in (generate_retry, human_retry):
            for _ in range(2):
                broker.send_task("partsignal.generate_content", args=[str(job_id)], queue=queue)
            row = _wait_terminal(test_url, job_id)
            if mode == "deterministic":
                _assert_disabled_terminal(test_url, job_id)
            else:
                assert row[:3] == ("SUCCEEDED", None, 1)
                assert row[7] == "req-reliability" and row[9:] == (10, 20, 30)
        if mode == "deterministic":
            _assert_disabled_terminal(test_url, human_id)
            assert state.calls == baseline_calls + 1
        else:
            assert human_first[:3] == ("SUCCEEDED", None, 1)
            assert state.calls == baseline_calls + 4
        with psycopg.connect(test_url) as connection:
            assert connection.execute(
                "SELECT dispatch_attempt_count FROM generation_jobs WHERE id=%s",
                (backlog_id,),
            ).fetchone() == (1,)
        assert redis.llen(queue) == 0
