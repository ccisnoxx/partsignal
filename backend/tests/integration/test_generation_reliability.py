"""使用 PostgreSQL、Redis 和真实 HTTP 替身验证生成恢复不变量。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from celery import Celery
from psycopg import sql
from psycopg.types.json import Jsonb
from redis import Redis
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.schemas.content import HumanizationSnapshot
from app.services import generation, generation_dispatch
from app.services.credentials import CredentialCipher


def psycopg_url(value: str) -> str:
    """将 SQLAlchemy URL 转为 psycopg 可直接使用的 URL。"""
    return value.replace("postgresql+psycopg://", "postgresql://", 1)


def replace_database(value: str, database_name: str) -> str:
    """保留连接信息并替换数据库名。"""
    parts = urlsplit(psycopg_url(value))
    return urlunsplit(
        (parts.scheme, parts.netloc, f"/{database_name}", parts.query, parts.fragment)
    )


@contextmanager
def temporary_database(prefix: str) -> Iterator[tuple[str, str, Path]]:
    """创建生成可靠性测试的隔离 PostgreSQL 数据库。"""
    source_url = os.getenv("PARTSIGNAL_TEST_DATABASE_URL")
    if source_url is None and os.getenv("APP_ENV") == "test":
        source_url = os.getenv("DATABASE_URL")
    if not source_url:
        pytest.skip("未设置 PostgreSQL 测试环境，不以 SQLite 替代 PostgreSQL")

    database_name = f"{prefix}_{uuid.uuid4().hex[:10]}"
    with psycopg.connect(psycopg_url(source_url), autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
    test_url = replace_database(source_url, database_name)
    sqlalchemy_url = test_url.replace("postgresql://", "postgresql+psycopg://", 1)
    backend_dir = Path(__file__).resolve().parents[2]
    env = {**os.environ, "DATABASE_URL": sqlalchemy_url}
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        check=True,
        env=env,
        cwd=backend_dir,
    )
    try:
        yield test_url, sqlalchemy_url, backend_dir
    finally:
        with psycopg.connect(psycopg_url(source_url), autocommit=True) as admin:
            admin.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database_name))
            )


class FakeAIState:
    """记录真实 HTTP 请求次数，并可阻塞响应制造 Worker 丢失窗口。"""

    def __init__(self, *, blocked: bool, status_code: int) -> None:
        self.calls = 0
        self.requests: list[dict[str, Any]] = []
        self.status_code = status_code
        self.lock = threading.Lock()
        self.received = threading.Event()
        self.release = threading.Event()
        if not blocked:
            self.release.set()


@contextmanager
def fake_ai_server(
    *,
    blocked: bool = False,
    status_code: int = 200,
) -> Iterator[tuple[str, FakeAIState]]:
    """启动只实现 Chat Completions 的本机真实 HTTP 替身。"""
    state = FakeAIState(blocked=blocked, status_code=status_code)

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 - 标准库回调名称固定
            length = int(self.headers.get("content-length", "0"))
            request_body = json.loads(self.rfile.read(length))
            with state.lock:
                state.calls += 1
                state.requests.append(request_body)
            state.received.set()
            if not state.release.wait(timeout=10):
                self.send_error(504)
                return
            if state.status_code != 200:
                self.send_error(state.status_code)
                return
            content = json.dumps(
                {
                    "title": "可靠性测试草稿",
                    "summary": "仅使用冻结事实的测试摘要",
                    "body_markdown": "正文只包含已批准事实。",
                    "tags": ["reliability"],
                },
                ensure_ascii=False,
            )
            payload = json.dumps(
                {
                    "choices": [{"message": {"content": content}}],
                    "usage": {
                        "prompt_tokens": 10,
                        "completion_tokens": 20,
                        "total_tokens": 30,
                    },
                },
                ensure_ascii=False,
            ).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.send_header("x-request-id", "req-reliability")
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", state
    finally:
        state.release.set()
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()


def generation_snapshot(
    *,
    channel_id: uuid.UUID,
    model_id: uuid.UUID,
    product_id: uuid.UUID,
    fact_version_id: uuid.UUID,
    platform_profile_id: uuid.UUID,
    base_url: str,
    timeout_seconds: int,
) -> dict[str, Any]:
    """构造与生产快照字段一致的最小真实模型输入。"""
    return {
        "adapter_name": "openai-compatible-chat-completions",
        "contract_version": "content-markdown-v2",
        "channel": {
            "id": str(channel_id),
            "base_url": base_url,
            "timeout_seconds": timeout_seconds,
            "plain_headers": {},
            "sensitive_header_names": [],
        },
        "model": {
            "id": str(model_id),
            "model_id": "reliability-model",
            "request_parameters": {},
        },
        "platform_profile": {
            "id": str(platform_profile_id),
            "name": "测试平台",
            "slug": "test",
        },
        "fact_version": {
            "id": str(fact_version_id),
            "product_id": str(product_id),
            "version": 1,
            "classification": "PUBLIC",
        },
        "system_message": "只返回严格 JSON",
        "user_message": "正文只包含已批准事实。",
    }


def seed_generation_job(
    test_url: str,
    *,
    base_url: str,
    timeout_seconds: int = 10,
    created_at: datetime | None = None,
) -> uuid.UUID:
    """写入满足全部数据库触发器的最小生成聚合。"""
    ids = {
        name: uuid.uuid4()
        for name in (
            "user",
            "product",
            "fact",
            "topic",
            "platform_type",
            "prompt",
            "profile",
            "task",
            "channel",
            "model",
            "job",
        )
    }
    snapshot = generation_snapshot(
        channel_id=ids["channel"],
        model_id=ids["model"],
        product_id=ids["product"],
        fact_version_id=ids["fact"],
        platform_profile_id=ids["profile"],
        base_url=base_url,
        timeout_seconds=timeout_seconds,
    )
    cipher = CredentialCipher(settings.ai_credential_encryption_key)
    encrypted_key = cipher.encrypt(
        "integration-api-key",
        associated_data=f"ai_channel:{ids['channel']}:api_key",
    )
    unique = ids["job"].hex[:12]
    with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO users "
            "(id, username, display_name, password_hash, account_type, is_active, "
            "must_change_password, revision) VALUES (%s, %s, '测试用户', 'hash', "
            "'ENGINEER', true, false, 0)",
            (ids["user"], f"reliability-{unique}"),
        )
        cursor.execute(
            "INSERT INTO products "
            "(id, part_number, normalized_part_number, brand, normalized_brand, category, "
            "status, revision, facts_revision) "
            "VALUES (%s, %s, %s, 'TEST', 'test', 'TEST', 'ACTIVE', 0, 0)",
            (ids["product"], f"REL-{unique}", f"rel-{unique}"),
        )
        cursor.execute(
            "INSERT INTO fact_versions "
            "(id, product_id, version, status, body_markdown, classification, "
            "change_summary, revision, "
            "created_by, approved_by, approved_at) "
            "VALUES (%s, %s, 1, 'APPROVED', %s, 'PUBLIC', '测试事实', 0, %s, %s, now())",
            (
                ids["fact"],
                ids["product"],
                "正文只包含已批准事实。",
                ids["user"],
                ids["user"],
            ),
        )
        cursor.execute(
            "INSERT INTO query_topics "
            "(id, canonical_question, intent_type, variants, revision) "
            "VALUES (%s, '如何验证生成可靠性？', 'TEST', %s, 0)",
            (ids["topic"], ["生成可靠性"]),
        )
        cursor.execute(
            "INSERT INTO platform_types (id, name, slug, revision, created_by) "
            "VALUES (%s, '测试平台', %s, 0, %s)",
            (ids["platform_type"], f"test-{unique}", ids["user"]),
        )
        cursor.execute(
            "INSERT INTO platform_prompts "
            "(id, name, template_markdown, revision, updated_by) "
            "VALUES (%s, %s, '只返回严格 JSON', 0, %s)",
            (ids["prompt"], f"可靠性 Prompt {unique}", ids["user"]),
        )
        cursor.execute(
            "INSERT INTO platform_profiles "
            "(id, name, slug, allowed_domains, platform_type_id, platform_prompt_id, "
            "is_active, revision) "
            "VALUES (%s, '测试平台', %s, %s, %s, %s, true, 0)",
            (
                ids["profile"],
                f"profile-{unique}",
                ["example.invalid"],
                ids["platform_type"],
                ids["prompt"],
            ),
        )
        cursor.execute(
            "INSERT INTO content_tasks "
            "(id, query_topic_id, product_id, fact_version_id, platform_profile_id, "
            "platform_profile_name_snapshot, platform_website_url_snapshot, "
            "status, revision, created_by) "
            "VALUES (%s, %s, %s, %s, %s, '测试平台', NULL, 'OPEN', 0, %s)",
            (
                ids["task"],
                ids["topic"],
                ids["product"],
                ids["fact"],
                ids["profile"],
                ids["user"],
            ),
        )
        cursor.execute(
            "INSERT INTO ai_channels "
            "(id, name, description, protocol_type, provider_brand, base_url, "
            "api_key_ciphertext, api_key_updated_at, timeout_seconds, is_enabled, "
            "revision, created_by) "
            "VALUES (%s, '可靠性替身', '', 'openai-compatible-chat-completions', "
            "'CUSTOM', %s, %s, now(), %s, true, 0, %s)",
            (ids["channel"], base_url, encrypted_key, timeout_seconds, ids["user"]),
        )
        cursor.execute(
            "INSERT INTO ai_models "
            "(id, channel_id, display_name, model_id, request_parameters, is_enabled, "
            "test_status, revision, created_by) "
            "VALUES (%s, %s, '可靠性模型', 'reliability-model', '{}', true, "
            "'PASSED', 0, %s)",
            (ids["model"], ids["channel"], ids["user"]),
        )
        cursor.execute(
            "INSERT INTO generation_jobs "
            "(id, content_task_id, idempotency_key, job_type, status, input_snapshot, "
            "ai_channel_id, "
            "ai_model_id, adapter_name, prompt_template_version, prompt_hash, attempt_count, "
            "created_by, created_at) "
            "VALUES (%s, %s, %s, 'GENERATE', 'PENDING', %s, %s, %s, "
            "'openai-compatible-chat-completions', 'content-markdown-v2', %s, 0, %s, %s)",
            (
                ids["job"],
                ids["task"],
                f"idem-{unique}",
                Jsonb(snapshot),
                ids["channel"],
                ids["model"],
                "0" * 64,
                ids["user"],
                created_at or datetime.now(UTC),
            ),
        )
        connection.commit()
    return ids["job"]


@contextmanager
def patched_sessions(
    monkeypatch: pytest.MonkeyPatch,
    sqlalchemy_url: str,
) -> Iterator[sessionmaker[Session]]:
    """让 Worker 和恢复器连接当前测试数据库。"""
    engine = create_engine(sqlalchemy_url, pool_pre_ping=True)
    factory = sessionmaker(bind=engine, expire_on_commit=False, class_=Session)
    monkeypatch.setattr(generation, "SessionLocal", factory)
    monkeypatch.setattr(generation_dispatch, "SessionLocal", factory)
    try:
        yield factory
    finally:
        engine.dispose()


def clone_retry_job(test_url: str, original_id: uuid.UUID) -> uuid.UUID:
    """模拟现有显式重试接口创建一个保留原快照的新 Job。"""
    retry_id = uuid.uuid4()
    with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO generation_jobs "
            "(id, content_task_id, idempotency_key, job_type, status, input_snapshot, "
            "ai_channel_id, "
            "ai_model_id, adapter_name, prompt_template_version, prompt_hash, attempt_count, "
            "retry_of_id, created_by) "
            "SELECT %s, content_task_id, %s, job_type, 'PENDING', input_snapshot, ai_channel_id, "
            "ai_model_id, adapter_name, prompt_template_version, prompt_hash, 0, id, created_by "
            "FROM generation_jobs WHERE id = %s",
            (retry_id, f"retry-{retry_id.hex}", original_id),
        )
        connection.commit()
    return retry_id


def seed_humanization_job(
    test_url: str,
    original_generation_job_id: uuid.UUID,
    source_content_id: uuid.UUID,
) -> uuid.UUID:
    """基于真实生成结果写入严格自然化快照，供 Worker HTTP 集成验证。"""
    job_id = uuid.uuid4()
    with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT content_task_id, ai_channel_id, ai_model_id, input_snapshot, created_by "
            "FROM generation_jobs WHERE id = %s",
            (original_generation_job_id,),
        )
        task_id, channel_id, model_id, original, created_by = cursor.fetchone()
        cursor.execute(
            "SELECT id, task_id, fact_version_id, version, content_hash, title, summary, "
            "body_markdown, tags FROM content_versions WHERE id = %s",
            (source_content_id,),
        )
        source = cursor.fetchone()
        source_payload = {
            "id": str(source[0]),
            "task_id": str(source[1]),
            "fact_version_id": str(source[2]),
            "version": source[3],
            "content_hash": source[4],
            "title": source[5],
            "summary": source[6],
            "body_markdown": source[7],
            "tags": source[8],
        }
        snapshot = {
            "adapter_name": "openai-compatible-chat-completions",
            "contract_version": "humanization-markdown-v2",
            "channel": original["channel"],
            "model": original["model"],
            "humanization_prompt": {
                "revision": 1,
                "template_markdown": "保持批准事实，只改善表达。",
            },
            "source_content": source_payload,
            "source_generation_job_id": str(original_generation_job_id),
            "fact_version": original["fact_version"],
            "system_message": "只改写表达并返回严格 JSON。",
            "user_message": "待自然化源文章\n" + json.dumps(source_payload, ensure_ascii=False),
        }
        HumanizationSnapshot.model_validate(snapshot)
        cursor.execute(
            "INSERT INTO generation_jobs "
            "(id, content_task_id, idempotency_key, job_type, source_content_version_id, "
            "status, input_snapshot, ai_channel_id, ai_model_id, adapter_name, "
            "prompt_template_version, prompt_hash, attempt_count, created_by) "
            "VALUES (%s, %s, %s, 'HUMANIZE', %s, 'PENDING', %s, %s, %s, "
            "'openai-compatible-chat-completions', 'humanization-markdown-v2', %s, 0, %s)",
            (
                job_id,
                task_id,
                f"humanize-{job_id.hex}",
                source_content_id,
                Jsonb(snapshot),
                channel_id,
                model_id,
                "5" * 64,
                created_by,
            ),
        )
        connection.commit()
    return job_id


@pytest.mark.integration
def test_duplicate_workers_use_one_real_provider_call_and_one_content_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """重复消息与并发 Worker 必须由 PostgreSQL 声明门禁吸收。"""
    with (
        temporary_database("partsignal_generation_duplicate") as (
            test_url,
            sqlalchemy_url,
            _,
        ),
        fake_ai_server() as (base_url, state),
    ):
        job_id = seed_generation_job(test_url, base_url=base_url)
        with (
            patched_sessions(monkeypatch, sqlalchemy_url),
            ThreadPoolExecutor(max_workers=2) as executor,
        ):
            futures = [executor.submit(generation.process_generation_job, job_id) for _ in range(2)]
            for future in futures:
                future.result(timeout=15)
            generation.process_generation_job(job_id)
            diagnostics = generation_dispatch.generation_diagnostics()
            assert diagnostics["pending_count"] == 0
            assert diagnostics["running_count"] == 0
            assert diagnostics["recent_provider_duration_ms"]["average"] is not None
            assert "integration-api-key" not in json.dumps(diagnostics)

        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT status, attempt_count FROM generation_jobs WHERE id = %s",
                (job_id,),
            )
            assert cursor.fetchone() == ("SUCCEEDED", 1)
            cursor.execute(
                "SELECT count(*) FROM content_versions WHERE source_job_id = %s",
                (job_id,),
            )
            assert cursor.fetchone() == (1,)
        assert state.calls == 1


@pytest.mark.integration
def test_humanization_uses_real_http_and_creates_repeatable_immutable_versions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """自然化复用真实 HTTP 边界，重复消息和再次自然化都保持版本关系。"""
    with (
        temporary_database("partsignal_humanization_http") as (
            test_url,
            sqlalchemy_url,
            _,
        ),
        fake_ai_server() as (base_url, state),
    ):
        original_job_id = seed_generation_job(test_url, base_url=base_url)
        with patched_sessions(monkeypatch, sqlalchemy_url):
            generation.process_generation_job(original_job_id)
            with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
                cursor.execute(
                    "SELECT content_version_id FROM generation_jobs WHERE id = %s",
                    (original_job_id,),
                )
                source_id = cursor.fetchone()[0]
            first_humanization_id = seed_humanization_job(test_url, original_job_id, source_id)
            generation.process_generation_job(first_humanization_id)
            generation.process_generation_job(first_humanization_id)
            with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
                cursor.execute(
                    "SELECT content_version_id FROM generation_jobs WHERE id = %s",
                    (first_humanization_id,),
                )
                first_result_id = cursor.fetchone()[0]
            second_humanization_id = seed_humanization_job(
                test_url, original_job_id, first_result_id
            )
            generation.process_generation_job(second_humanization_id)

        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT status, content_version_id FROM generation_jobs "
                "WHERE id = ANY(%s) ORDER BY created_at",
                ([first_humanization_id, second_humanization_id],),
            )
            humanization_rows = cursor.fetchall()
            assert all(row[0] == "SUCCEEDED" for row in humanization_rows)
            cursor.execute(
                "SELECT based_on_id, source_type, status FROM content_versions "
                "WHERE source_job_id = %s",
                (first_humanization_id,),
            )
            assert cursor.fetchone() == (source_id, "AI", "DRAFT")
            cursor.execute(
                "SELECT based_on_id, source_type, status FROM content_versions "
                "WHERE source_job_id = %s",
                (second_humanization_id,),
            )
            assert cursor.fetchone() == (first_result_id, "AI", "DRAFT")
            cursor.execute(
                "SELECT status FROM content_versions WHERE id = %s",
                (source_id,),
            )
            assert cursor.fetchone() == ("DRAFT",)
        assert state.calls == 3
        assert "待自然化源文章" in state.requests[1]["messages"][1]["content"]


@pytest.mark.integration
def test_max_timeout_is_not_killed_early_and_late_response_cannot_win(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """600 秒快照租约含收尾裕量，真正过期后迟到响应不能写成功。"""
    with (
        temporary_database("partsignal_generation_lease") as (
            test_url,
            sqlalchemy_url,
            _,
        ),
        fake_ai_server(blocked=True) as (base_url, state),
    ):
        job_id = seed_generation_job(test_url, base_url=base_url, timeout_seconds=600)
        with (
            patched_sessions(monkeypatch, sqlalchemy_url),
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            future = executor.submit(generation.process_generation_job, job_id)
            assert state.received.wait(timeout=10)
            with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
                cursor.execute(
                    "SELECT started_at, lease_expires_at FROM generation_jobs WHERE id = %s",
                    (job_id,),
                )
                started_at, lease_expires_at = cursor.fetchone()
            assert lease_expires_at - started_at == timedelta(
                seconds=600 + settings.generation_finalize_grace_seconds
            )
            assert (
                generation_dispatch.fail_expired_generation_jobs(
                    now=started_at + timedelta(seconds=600)
                )
                == 0
            )
            assert (
                generation_dispatch.fail_expired_generation_jobs(
                    now=lease_expires_at + timedelta(seconds=1)
                )
                == 1
            )
            state.release.set()
            future.result(timeout=15)

            retry_id = clone_retry_job(test_url, job_id)
            generation.process_generation_job(retry_id)

        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT status FROM generation_jobs WHERE id = %s", (job_id,))
            assert cursor.fetchone() == ("FAILED",)
            cursor.execute(
                "SELECT status, retry_of_id FROM generation_jobs WHERE id = %s",
                (retry_id,),
            )
            assert cursor.fetchone() == ("SUCCEEDED", job_id)
            cursor.execute("SELECT source_job_id FROM content_versions ORDER BY created_at")
            assert cursor.fetchall() == [(retry_id,)]
        assert state.calls == 2


@pytest.mark.integration
def test_accepted_broker_message_with_lost_metadata_is_safely_redispatched(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Redis 已接收但投递元数据回滚时，重复消息仍只执行一次供应商调用。"""
    queue_name = f"generation-reliability-{uuid.uuid4().hex}"
    redis = Redis.from_url(settings.redis_url)
    redis.delete(queue_name)
    broker = Celery("generation-reliability-test", broker=settings.redis_url)
    broker.conf.task_ignore_result = True

    with (
        temporary_database("partsignal_generation_broker") as (
            test_url,
            sqlalchemy_url,
            _,
        ),
        fake_ai_server() as (base_url, state),
    ):
        job_id = seed_generation_job(
            test_url,
            base_url=base_url,
            created_at=datetime.now(UTC) - timedelta(minutes=10),
        )
        with patched_sessions(monkeypatch, sqlalchemy_url):

            def sender(value: str) -> object:
                return broker.send_task(
                    "partsignal.generate_content",
                    args=[value],
                    queue=queue_name,
                )

            def fail_metadata_commit(_session: Session) -> None:
                raise RuntimeError("模拟 Broker 接受后的元数据提交失败")

            event.listen(Session, "before_commit", fail_metadata_commit)
            try:
                assert generation_dispatch.dispatch_generation_job(job_id, sender) is False
            finally:
                event.remove(Session, "before_commit", fail_metadata_commit)

            assert redis.llen(queue_name) == 1
            assert generation_dispatch.dispatch_generation_job(job_id, sender) is True
            assert redis.llen(queue_name) == 2
            generation.process_generation_job(job_id)
            generation.process_generation_job(job_id)

        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT status, dispatch_attempt_count FROM generation_jobs WHERE id = %s",
                (job_id,),
            )
            assert cursor.fetchone() == ("SUCCEEDED", 1)
            cursor.execute(
                "SELECT count(*) FROM content_versions WHERE source_job_id = %s",
                (job_id,),
            )
            assert cursor.fetchone() == (1,)
        assert state.calls == 1
    redis.delete(queue_name)


@pytest.mark.integration
def test_concurrent_pending_recovery_skips_locked_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """多个恢复器不能同时补投递同一超龄 PENDING Job。"""
    with temporary_database("partsignal_generation_recovery") as (test_url, sqlalchemy_url, _):
        job_id = seed_generation_job(
            test_url,
            base_url="http://127.0.0.1:9/v1",
            created_at=datetime.now(UTC) - timedelta(minutes=10),
        )
        entered = threading.Event()
        release = threading.Event()
        sent: list[str] = []

        def blocking_sender(value: str) -> object:
            sent.append(value)
            entered.set()
            assert release.wait(timeout=10)
            return object()

        with (
            patched_sessions(monkeypatch, sqlalchemy_url),
            ThreadPoolExecutor(max_workers=2) as executor,
        ):
            first = executor.submit(
                generation_dispatch.redispatch_pending_generation_jobs,
                blocking_sender,
            )
            assert entered.wait(timeout=10)
            second = executor.submit(
                generation_dispatch.redispatch_pending_generation_jobs,
                blocking_sender,
            )
            second_result = second.result(timeout=10)
            release.set()
            first_result = first.result(timeout=10)

        assert first_result.selected == 1
        assert first_result.dispatched == 1
        assert second_result.selected == 0
        assert sent == [str(job_id)]
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT status, dispatch_attempt_count FROM generation_jobs WHERE id = %s",
                (job_id,),
            )
            assert cursor.fetchone() == ("PENDING", 1)


@pytest.mark.integration
def test_worker_offline_backlog_recovery_respects_batch_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Worker 离线积压按配置限批次补投递，后续扫描继续处理剩余 Job。"""
    with temporary_database("partsignal_generation_batch") as (test_url, sqlalchemy_url, _):
        job_ids = [
            seed_generation_job(
                test_url,
                base_url="http://127.0.0.1:9/v1",
                created_at=datetime.now(UTC) - timedelta(minutes=10),
            )
            for _ in range(3)
        ]
        sent: list[str] = []
        monkeypatch.setattr(settings, "generation_recovery_batch_size", 2)
        with patched_sessions(monkeypatch, sqlalchemy_url):
            first = generation_dispatch.redispatch_pending_generation_jobs(sent.append)
            second = generation_dispatch.redispatch_pending_generation_jobs(sent.append)

        assert first.selected == 2
        assert first.dispatched == 2
        assert second.selected == 1
        assert second.dispatched == 1
        assert set(sent) == {str(job_id) for job_id in job_ids}


@pytest.mark.integration
def test_provider_failure_has_safe_diagnostic_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """供应商失败显式落库并进入诊断，错误摘要不包含凭据或响应正文。"""
    with (
        temporary_database("partsignal_generation_provider_failure") as (
            test_url,
            sqlalchemy_url,
            _,
        ),
        fake_ai_server(status_code=500) as (base_url, state),
    ):
        job_id = seed_generation_job(test_url, base_url=base_url)
        with patched_sessions(monkeypatch, sqlalchemy_url):
            generation.process_generation_job(job_id)
            diagnostics = generation_dispatch.generation_diagnostics()

        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT status, error_code, error_summary FROM generation_jobs WHERE id = %s",
                (job_id,),
            )
            status, error_code, error_summary = cursor.fetchone()
        assert (status, error_code) == ("FAILED", "AI_PROVIDER_ERROR")
        assert "integration-api-key" not in error_summary
        assert diagnostics["recent_failure_codes"] == {"AI_PROVIDER_ERROR": 1}
        assert "integration-api-key" not in json.dumps(diagnostics)
        assert state.calls == 1
