"""使用 PostgreSQL、Redis 和真实 HTTP 替身验证生成恢复不变量。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from celery import Celery
from fastapi import Depends, FastAPI, Header
from fastapi.testclient import TestClient
from psycopg import sql
from psycopg.types.json import Jsonb
from redis import Redis
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app import db as app_db
from app.config import settings
from app.errors import AppError, app_error_handler
from app.main import request_context
from app.models.ai_generation import GenerationJob
from app.models.content import ContentVersion
from app.models.identity import User
from app.schemas.content import (
    HumanizationJobCreate,
    HumanizationSnapshot,
    OriginalGenerationJobCreate,
)
from app.services import content_production, generation, generation_dispatch
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


def _prepare_humanization_graph(
    test_url: str, base_url: str
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    """准备一张已完成原始生成、可直接进入自然化 command 的真实 graph。"""
    original_job_id = seed_generation_job(test_url, base_url=base_url)
    generation.process_generation_job(original_job_id)
    with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT ai_model_id, created_by, content_version_id, content_task_id "
            "FROM generation_jobs WHERE id = %s", (original_job_id,)
        )
        model_id, actor_id, source_id, task_id = cursor.fetchone()
        cursor.execute(
            "INSERT INTO content_humanization_prompts "
            "(id, template_markdown, revision, updated_by) VALUES (1, %s, 0, %s) "
            "ON CONFLICT (id) DO NOTHING",
            ("只改善表达，保留已批准事实。", actor_id),
        )
        connection.commit()
    return original_job_id, task_id, source_id, model_id, actor_id


def _assert_generation_failure_has_no_content_side_effects(
    test_url: str,
    task_ids: list[uuid.UUID],
    expected_source_ids: list[uuid.UUID],
    expected_job_counts: list[int],
) -> None:
    """共享断言失败 command 未改变内容主线或产生后续业务副作用。"""
    with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT (SELECT count(*) FROM content_versions WHERE task_id = ANY(%s)), "
            "(SELECT count(*) FROM content_review_records r JOIN content_versions v "
            "ON v.id = r.content_version_id WHERE v.task_id = ANY(%s)), "
            "(SELECT count(*) FROM audit_logs WHERE target_id = ANY(%s))",
            (task_ids, task_ids, [str(task_id) for task_id in task_ids]),
        )
        assert cursor.fetchone() == (len(task_ids), 0, 0)
        cursor.execute(
            "SELECT t.id, t.current_content_version_id, t.revision, count(g.id) "
            "FROM content_tasks t LEFT JOIN generation_jobs g ON g.content_task_id = t.id "
            "WHERE t.id = ANY(%s) GROUP BY t.id ORDER BY t.id", (task_ids,)
        )
        rows = cursor.fetchall()
        assert sorted((row[0], row[1], row[2]) for row in rows) == sorted(
            (task_id, source_id, 1)
            for task_id, source_id in zip(task_ids, expected_source_ids, strict=True)
        )
        assert sorted(row[3] for row in rows) == sorted(expected_job_counts)


def _capture_humanization_diagnostics(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    observed: list[str] = []
    classify = content_production._classify_humanization_integrity_error

    def record(error: IntegrityError) -> str | None:
        result = classify(error)
        observed.extend([result] if result is not None else [])
        return result

    monkeypatch.setattr(content_production, "_classify_humanization_integrity_error", record)
    return observed


def _hide_active_humanization_precheck(monkeypatch: pytest.MonkeyPatch) -> None:
    scalar = Session.scalar

    def hide_active_precheck(
        db: Session, statement: object, *args: object, **kwargs: object
    ) -> object:
        statement_text = str(statement)
        if "source_content_version_id" in statement_text and "status IN" in statement_text:
            return None
        return scalar(db, statement, *args, **kwargs)

    monkeypatch.setattr(Session, "scalar", hide_active_precheck)


def _run_same_key_humanization_race(
    test_url: str,
    base_url: str,
    sessions: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    *,
    retry: bool,
) -> tuple[list[object], list[str], list[uuid.UUID], list[uuid.UUID]]:
    """让两个不同父任务绕过预检，在各自最终 flush 竞争同一幂等键。"""
    graphs = [_prepare_humanization_graph(test_url, base_url) for _ in range(2)]
    previous_ids = (
        [seed_humanization_job(test_url, graph[0], graph[2]) for graph in graphs]
        if retry
        else []
    )
    if retry:
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "UPDATE generation_jobs SET status = 'FAILED' WHERE id = ANY(%s)",
                (previous_ids,),
            )
            connection.commit()

    diagnostics = _capture_humanization_diagnostics(monkeypatch)
    race_key = f"humanization-race-key-{'retry' if retry else 'create'}"
    precheck_barrier, flush_barrier = threading.Barrier(2), threading.Barrier(2)
    local = threading.local()
    find_existing = content_production._find_existing_generation_job

    def hold_after_canonical_precheck(db: Session, key: str, identity: Any) -> object:
        result = find_existing(db, key, identity)
        if result is None:
            barrier = precheck_barrier if getattr(local, "prechecks", 0) == 0 else flush_barrier
            barrier.wait(timeout=15)
            local.prechecks = getattr(local, "prechecks", 0) + 1
        return result

    monkeypatch.setattr(
        content_production, "_find_existing_generation_job", hold_after_canonical_precheck
    )

    def wait_for_final_flush(session: Session, _flush_context: object, _instances: object) -> None:
        if any(isinstance(item, GenerationJob) for item in session.new):
            flush_barrier.wait(timeout=15)

    event.listen(Session, "before_flush", wait_for_final_flush)

    def call(index: int) -> object:
        _original_id, _task_id, source_id, model_id, actor_id = graphs[index]
        with sessions() as db:
            actor = db.get(User, actor_id)
            assert actor is not None
            try:
                if retry:
                    return content_production.retry_generation_job(
                        db=db,
                        generation_job_id=previous_ids[index],
                        actor=actor,
                        request_id=f"race-retry-{index}",
                        idempotency_key=race_key,
                    )
                return content_production.create_humanization_job(
                    db=db,
                    content_version_id=source_id,
                    payload=HumanizationJobCreate(ai_model_id=model_id),
                    actor=actor,
                    request_id=f"race-create-{index}",
                    idempotency_key=race_key,
                )
            except AppError as error:
                return error

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(call, index) for index in range(2)]
            results = [future.result(timeout=30) for future in futures]
    finally:
        event.remove(Session, "before_flush", wait_for_final_flush)

    task_ids = [graph[1] for graph in graphs]
    source_ids = [graph[2] for graph in graphs]
    return results, diagnostics, task_ids, source_ids


def _insert_duplicate_generation_job(
    cursor: Any, winner_id: uuid.UUID, key: str | None = None
) -> None:
    cursor.execute(
        "INSERT INTO generation_jobs "
        "(id, content_task_id, idempotency_key, job_type, source_content_version_id, status, "
        "input_snapshot, ai_channel_id, ai_model_id, adapter_name, prompt_template_version, "
        "prompt_hash, attempt_count, created_by) "
        "SELECT %s, content_task_id, COALESCE(%s::text, idempotency_key), job_type, "
        "source_content_version_id, status, "
        "input_snapshot, ai_channel_id, ai_model_id, adapter_name, prompt_template_version, "
        "prompt_hash, 0, created_by FROM generation_jobs WHERE id = %s",
        (uuid.uuid4(), key, winner_id),
    )
def _generation_context(test_url: str, job_id: uuid.UUID):
    with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT g.content_task_id, g.ai_model_id, p.platform_prompt_id, pp.revision, g.created_by FROM generation_jobs g JOIN content_tasks t ON t.id = g.content_task_id JOIN platform_profiles p ON p.id = t.platform_profile_id JOIN platform_prompts pp ON pp.id = p.platform_prompt_id WHERE g.id = %s", (job_id,))  # noqa: E501
        return cursor.fetchone()
def _generation_state(test_url: str, task_id: uuid.UUID):
    with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT (SELECT count(*) FROM generation_jobs WHERE content_task_id=t.id), (SELECT count(*) FROM content_versions WHERE task_id=t.id), t.current_content_version_id, t.revision, (SELECT count(*) FROM content_review_records r JOIN content_versions v ON v.id=r.content_version_id WHERE v.task_id=t.id), (SELECT count(*) FROM audit_logs) FROM content_tasks t WHERE t.id=%s", (task_id,))  # noqa: E501
        return cursor.fetchone()


def _insert_content_version_source(
    test_url: str,
    job_id: uuid.UUID,
    *,
    version: int = 1,
    source_job_id: uuid.UUID | None = None,
    omit_source_job: bool = False,
) -> uuid.UUID:
    """直接写入测试竞争行，保留生产表的外键与唯一约束。"""
    content_id = uuid.uuid4()
    with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT content_task_id, input_snapshot->'fact_version'->>'id', created_by "
            "FROM generation_jobs WHERE id = %s",
            (job_id,),
        )
        task_id, fact_version_id, created_by = cursor.fetchone()
        cursor.execute(
            "INSERT INTO content_versions "
            "(id, task_id, fact_version_id, source_job_id, based_on_id, version, source_type, "
            "title, summary, body_markdown, tags, content_hash, status, revision, "
            "quality_issues, change_summary, created_by) VALUES "
            "(%s, %s, %s, %s, NULL, %s, 'AI', '竞争版本', '竞争摘要', '竞争正文', "
            "ARRAY['reliability'], %s, 'DRAFT', 0, '[]'::jsonb, '测试竞争行', %s)",
            (
                content_id,
                task_id,
                uuid.UUID(fact_version_id),
                None if omit_source_job else (source_job_id or job_id),
                version,
                "c" * 64,
                created_by,
            ),
        )
        connection.commit()
    return content_id


def _seed_pending_job_with_existing_source(
    test_url: str, base_url: str
) -> tuple[uuid.UUID, uuid.UUID]:
    """创建 PENDING 作业及其已提交来源版本，验证 provider 前收敛分支。"""
    job_id = seed_generation_job(test_url, base_url=base_url)
    source_id = _insert_content_version_source(test_url, job_id)
    return job_id, source_id
def _generation_http_app(
    *,
    task_id: uuid.UUID, actor_id: uuid.UUID,
    model_id: uuid.UUID, prompt_id: uuid.UUID,
    prompt_revision: int,
    previous_id: uuid.UUID | None,
    integrity_errors: list[IntegrityError] | None = None,
) -> FastAPI:
    api = FastAPI(debug=False)
    api.add_exception_handler(AppError, app_error_handler)
    api.middleware("http")(request_context)
    db_dependency = Depends(app_db.get_db)

    @api.post("/invoke")
    def invoke(
        db: Session = db_dependency,
        idempotency_key: str = Header(alias="Idempotency-Key"),
    ) -> dict[str, str]:
        actor = db.get(User, actor_id)
        try:
            if previous_id is None:
                content_production.create_generation_job(
                    db=db, content_task_id=task_id,
                    payload=OriginalGenerationJobCreate(
                        ai_model_id=model_id, platform_prompt_id=prompt_id,
                        platform_prompt_revision=prompt_revision),
                    actor=actor, request_id="http", idempotency_key=idempotency_key)
            else:
                content_production.retry_generation_job(
                    db=db, generation_job_id=previous_id, actor=actor, request_id="http",
                    idempotency_key=idempotency_key)
        except IntegrityError as error:
            if integrity_errors is not None:
                integrity_errors.append(error)
            raise
        return {"status": "ok"}

    return api
def _run_generation_race(
    test_url: str,
    sessions: sessionmaker[Session],
    *,
    retry: bool,
) -> tuple[list[object], list[uuid.UUID]]:
    source_jobs = [
        seed_generation_job(test_url, base_url="http://127.0.0.1:9/v1") for _ in range(2)
    ]
    if retry:
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "UPDATE generation_jobs SET status = 'FAILED' WHERE id = ANY(%s)",
                (source_jobs,),
            )
            connection.commit()
    race_key = f"generation-race-key-{'retry' if retry else 'create'}"
    flush_barrier = threading.Barrier(2)
    def wait_for_generation_flush(session: Session, _context: object, _instances: object) -> None:
        if any(isinstance(item, GenerationJob) for item in session.new):
            flush_barrier.wait(timeout=15)
    event.listen(Session, "before_flush", wait_for_generation_flush)
    def call(index: int) -> object:
        job_id = source_jobs[index]
        task_id, model_id, prompt_id, prompt_revision, actor_id = _generation_context(
            test_url, job_id
        )
        with sessions() as db:
            actor = db.get(User, actor_id)
            assert actor is not None
            try:
                if retry:
                    return content_production.retry_generation_job(
                        db=db, generation_job_id=job_id, actor=actor,
                        request_id=f"generation-race-retry-{index}", idempotency_key=race_key)
                return content_production.create_generation_job(
                    db=db, content_task_id=task_id, actor=actor,
                    payload=OriginalGenerationJobCreate(ai_model_id=model_id,
                        platform_prompt_id=prompt_id, platform_prompt_revision=prompt_revision),
                    request_id=f"generation-race-create-{index}", idempotency_key=race_key)
            except AppError as error:
                return error

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(call, index) for index in range(2)]
            results = [future.result(timeout=30) for future in futures]
    finally:
        event.remove(Session, "before_flush", wait_for_generation_flush)
    return results, [_generation_context(test_url, job_id)[0] for job_id in source_jobs]

@pytest.mark.integration
@pytest.mark.parametrize("retry", [False, True], ids=["create", "retry"])
def test_generation_same_task_lock_replays_without_integrity_race(
    monkeypatch: pytest.MonkeyPatch, retry: bool
) -> None:
    with temporary_database("partsignal_generation_same_task") as database:
        test_url, sqlalchemy_url, _ = database
        dispatches: list[uuid.UUID] = []
        monkeypatch.setattr(content_production, "_dispatch_job", dispatches.append)
        with patched_sessions(monkeypatch, sqlalchemy_url) as sessions:
            original_id = seed_generation_job(test_url, base_url="http://127.0.0.1:9/v1")
            task_id, model_id, prompt_id, prompt_revision, actor_id = _generation_context(test_url, original_id)  # noqa: E501
            if retry:
                with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
                    cursor.execute("UPDATE generation_jobs SET status='FAILED' WHERE id=%s", (original_id,))  # noqa: E501
                    connection.commit()
            attempts, flushes, classifier_calls = [0], [0], [0]
            started, first_locked = threading.Barrier(2), threading.Event()
            scalar = Session.scalar
            classify = content_production._classify_generation_integrity_error
            def observe_lock(db: Session, statement: object, *args: object, **kwargs: object) -> object:  # noqa: E501
                if getattr(statement, "_for_update_arg", None) is not None and "content_tasks" in str(statement):  # noqa: E501
                    attempts[0] += 1
                    started.wait(timeout=15)
                    result = scalar(db, statement, *args, **kwargs)
                    first_locked.set()
                    return result
                return scalar(db, statement, *args, **kwargs)
            def observe_integrity(error: IntegrityError) -> bool:
                classifier_calls[0] += 1
                return classify(error)
            monkeypatch.setattr(Session, "scalar", observe_lock)
            monkeypatch.setattr(content_production, "_classify_generation_integrity_error", observe_integrity)  # noqa: E501
            observe_flush = lambda session, *_args: flushes.__setitem__(0, flushes[0] + any(isinstance(item, GenerationJob) for item in session.new))  # noqa: E731,E501
            event.listen(Session, "before_flush", observe_flush)
            def call() -> GenerationJob:
                with sessions() as db:
                    actor = db.get(User, actor_id)
                    if retry:
                        return content_production.retry_generation_job(
                            db=db, generation_job_id=original_id, actor=actor,
                            request_id="generation-same-task-retry", idempotency_key="generation-same-task-key")  # noqa: E501
                    return content_production.create_generation_job(
                        db=db, content_task_id=task_id, actor=actor,
                        payload=OriginalGenerationJobCreate(ai_model_id=model_id, platform_prompt_id=prompt_id,  # noqa: E501
                            platform_prompt_revision=prompt_revision),
                        request_id="generation-same-task-create", idempotency_key="generation-same-task-key")  # noqa: E501
            try:
                with ThreadPoolExecutor(max_workers=2) as executor:
                    futures = [executor.submit(call) for _ in range(2)]
                    results = [future.result(timeout=30) for future in futures]
            finally:
                event.remove(Session, "before_flush", observe_flush)
            assert results[0].id == results[1].id
            assert attempts[0] == 2 and first_locked.is_set() and flushes[0] == 1
            assert classifier_calls[0] == 0 and len(dispatches) == 1 and _generation_state(test_url, task_id)[0] == 2  # noqa: E501
@pytest.mark.integration
@pytest.mark.parametrize("retry", [False, True], ids=["create", "retry"])
def test_generation_cross_task_race_uses_real_postgresql_constraint(
    monkeypatch: pytest.MonkeyPatch,
    retry: bool,
) -> None:
    with temporary_database(
        f"partsignal_generation_race_{'retry' if retry else 'create'}"
    ) as database:
        test_url, sqlalchemy_url, _ = database
        dispatches: list[uuid.UUID] = []
        monkeypatch.setattr(content_production, "_dispatch_job", dispatches.append)
        with patched_sessions(monkeypatch, sqlalchemy_url) as sessions:
            results, task_ids = _run_generation_race(
                test_url, sessions, retry=retry
            )
            assert sum(isinstance(result, GenerationJob) for result in results) == 1
            conflicts = [result for result in results if isinstance(result, AppError)]
            assert len(conflicts) == 1
            assert conflicts[0].code == "IDEMPOTENCY_CONFLICT"
            assert conflicts[0].message == "幂等键已用于另一生成请求"
            assert conflicts[0].details == {}
            assert sorted(_generation_state(test_url, task_id) for task_id in task_ids) == [
                (1, 0, None, 0, 0, 0), (2, 0, None, 0, 0, 0)
            ]
        assert len(dispatches) == 1
@pytest.mark.integration
def test_generation_create_same_identity_exact_constraint_sentinel_replays(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with temporary_database("partsignal_generation_sentinel") as database:
        test_url, sqlalchemy_url, _ = database
        dispatches: list[uuid.UUID] = []
        monkeypatch.setattr(content_production, "_dispatch_job", dispatches.append)
        with patched_sessions(monkeypatch, sqlalchemy_url) as sessions:
            seed_id = seed_generation_job(test_url, base_url="http://127.0.0.1:9/v1")
            task_id, model_id, prompt_id, prompt_revision, actor_id = _generation_context(
                test_url, seed_id
            )
            with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
                cursor.execute("DELETE FROM generation_jobs WHERE id = %s", (seed_id,))
                connection.commit()
            payload = OriginalGenerationJobCreate(
                ai_model_id=model_id,
                platform_prompt_id=prompt_id,
                platform_prompt_revision=prompt_revision,
            )
            with sessions() as db:
                actor = db.get(User, actor_id)
                winner = content_production.create_generation_job(
                    db=db, content_task_id=task_id, payload=payload, actor=actor,
                    request_id="generation-sentinel-winner",
                    idempotency_key="generation-sentinel-key",
                )
            original_find = content_production._find_existing_generation_job
            seen = threading.local()

            def hide_only_insert_lookup(db: Session, key: str, identity: Any) -> object:
                if not getattr(seen, "hidden", False):
                    seen.hidden = True
                    return None
                return original_find(db, key, identity)
            monkeypatch.setattr(
                content_production, "_find_existing_generation_job", hide_only_insert_lookup
            )
            with sessions() as db:
                actor = db.get(User, actor_id)
                replay = content_production.create_generation_job(
                    db=db, content_task_id=task_id, payload=payload, actor=actor,
                    request_id="generation-sentinel-replay",
                    idempotency_key="generation-sentinel-key",
                )
            assert replay.id == winner.id
        assert [job.id for job in dispatches] == [winner.id]
@pytest.mark.integration
def test_generation_http_conflicts_have_exact_envelope_and_request_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with temporary_database("partsignal_generation_http") as database:
        test_url, sqlalchemy_url, _ = database
        dispatches: list[uuid.UUID] = []
        monkeypatch.setattr(content_production, "_dispatch_job", dispatches.append)
        with patched_sessions(monkeypatch, sqlalchemy_url) as sessions:
            monkeypatch.setattr(app_db, "SessionLocal", sessions)
            for retry in (False, True):
                winner_id = seed_generation_job(test_url, base_url="http://127.0.0.1:9/v1")
                loser_id = seed_generation_job(test_url, base_url="http://127.0.0.1:9/v1")
                context = _generation_context(test_url, winner_id)
                if retry:
                    with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
                        cursor.execute(
                            "UPDATE generation_jobs SET status = 'FAILED' WHERE id IN (%s, %s)",
                            (winner_id, loser_id),
                        )
                        connection.commit()
                with sessions() as db:
                    actor = db.get(User, context[4])
                    if retry:
                        content_production.retry_generation_job(
                            db=db, generation_job_id=winner_id, actor=actor,
                            request_id="http-retry-winner", idempotency_key="http-retry-shared-key")
                    else:
                        content_production.create_generation_job(
                            db=db, content_task_id=context[0], actor=actor,
                            payload=OriginalGenerationJobCreate(ai_model_id=context[1],
                                platform_prompt_id=context[2], platform_prompt_revision=context[3]),
                            request_id="http-create-winner",
                            idempotency_key="http-create-shared-key")
                loser_context = _generation_context(test_url, loser_id)
                api = _generation_http_app(
                    task_id=loser_context[0], actor_id=loser_context[4],
                    model_id=loser_context[1], prompt_id=loser_context[2],
                    prompt_revision=loser_context[3], previous_id=loser_id if retry else None)
                key = "http-retry-shared-key" if retry else "http-create-shared-key"
                request_id = "http-retry-conflict" if retry else "http-create-conflict"
                with TestClient(api, raise_server_exceptions=False) as client:
                    response = client.post(
                        "/invoke", headers={"Idempotency-Key": key, "X-Request-ID": request_id})
                assert response.status_code == 409
                assert response.headers["X-Request-ID"] == request_id
                assert response.json()["error"] == {
                    "code": "IDEMPOTENCY_CONFLICT", "message": "幂等键已用于另一生成请求",
                    "details": {}, "request_id": request_id}
                errors: list[IntegrityError] = []
                before, dispatch_count = _generation_state(test_url, loser_context[0]), len(dispatches)  # noqa: E501
                collide = lambda session, *_args, target=winner_id: [setattr(item, "id", target) for item in session.new if isinstance(item, GenerationJob)]  # noqa: E731,E501,B023
                event.listen(Session, "before_flush", collide)
                try:
                    api = _generation_http_app(
                        task_id=loser_context[0], actor_id=loser_context[4], model_id=loser_context[1],  # noqa: E501
                        prompt_id=loser_context[2], prompt_revision=loser_context[3],
                        previous_id=loser_id if retry else None, integrity_errors=errors)
                    with TestClient(api, raise_server_exceptions=False) as client:
                        unknown = client.post("/invoke", headers={"Idempotency-Key": f"unknown-{key}", "X-Request-ID": f"unknown-{request_id}"})  # noqa: E501
                finally:
                    event.remove(Session, "before_flush", collide)
                assert unknown.status_code == 500 and "generation_jobs" not in unknown.text and "duplicate key" not in unknown.text  # noqa: E501
                assert errors and errors[0].orig.sqlstate == "23505" and errors[0].orig.diag.constraint_name == "pk_generation_jobs"  # noqa: E501
                assert not content_production._classify_generation_integrity_error(errors[0])
                assert _generation_state(test_url, loser_context[0]) == before and len(dispatches) == dispatch_count  # noqa: E501


@pytest.mark.integration
def test_humanization_job_unique_catalog_and_diagnostics_are_exact(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with (
        temporary_database("partsignal_humanization_catalog") as database,
        fake_ai_server() as ai,
    ):
        test_url, sqlalchemy_url, _ = database
        base_url, _state = ai
        with patched_sessions(monkeypatch, sqlalchemy_url):
            graph = _prepare_humanization_graph(test_url, base_url)
            original_job_id, _task_id, source_id, _model_id, _actor_id = graph
            with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
                cursor.execute(
                    "SELECT c.contype, c.condeferrable, c.condeferred, n.nspname, r.relname "
                    "FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid "
                    "JOIN pg_namespace n ON n.oid = r.relnamespace WHERE c.conname = %s",
                    ("uq_generation_jobs_idempotency_key",),
                )
                assert cursor.fetchone() == ("u", False, False, "public", "generation_jobs")
                cursor.execute(
                    "SELECT i.indisunique, i.indisvalid, a.amname, i.indnkeyatts, i.indnatts, "
                    "pg_get_indexdef(i.indexrelid), "
                    "pg_get_expr(i.indpred, i.indrelid) FROM pg_index i "
                    "JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_am a ON a.oid = c.relam "
                    "WHERE c.relname = %s",
                    ("uq_generation_jobs_active_humanization_source",),
                )
                active_index = cursor.fetchone()
                assert active_index is not None
                assert active_index[:5] == (True, True, "btree", 1, 1)
                assert "source_content_version_id" in active_index[5]
                assert all(
                    value in active_index[6]
                    for value in ("job_type", "HUMANIZE", "status", "PENDING", "RUNNING")
                )
                cursor.execute(
                    "SELECT 1 FROM pg_constraint WHERE conname = %s",
                    ("uq_generation_jobs_active_humanization_source",),
                )
                assert cursor.fetchone() is None
                with pytest.raises(psycopg.errors.UniqueViolation) as idempotency_error:
                    _insert_duplicate_generation_job(cursor, original_job_id)
                assert idempotency_error.value.sqlstate == "23505"
                assert (
                    idempotency_error.value.diag.constraint_name
                    == "uq_generation_jobs_idempotency_key"
                )
                assert idempotency_error.value.diag.schema_name == "public"
                assert idempotency_error.value.diag.table_name == "generation_jobs"
                connection.rollback()
                active_id = seed_humanization_job(test_url, original_job_id, source_id)
                with pytest.raises(psycopg.errors.UniqueViolation) as active_error:
                    _insert_duplicate_generation_job(
                        cursor, active_id, f"active-{uuid.uuid4().hex}"
                    )
                assert active_error.value.sqlstate == "23505"
                assert (
                    active_error.value.diag.constraint_name
                    == "uq_generation_jobs_active_humanization_source"
                )
                assert active_error.value.diag.schema_name == "public"
                assert active_error.value.diag.table_name == "generation_jobs"

@pytest.mark.integration
def test_humanization_job_idempotency_replay_and_conflict_are_atomic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with (
        temporary_database("partsignal_humanization_idempotency") as database,
        fake_ai_server() as ai,
    ):
        test_url, sqlalchemy_url, _ = database
        base_url, _state = ai
        dispatches: list[uuid.UUID] = []
        monkeypatch.setattr(
            content_production,
            "_dispatch_job",
            lambda job: dispatches.append(job.id),
        )
        with patched_sessions(monkeypatch, sqlalchemy_url) as sessions:
            graph = _prepare_humanization_graph(test_url, base_url)
            _original_job_id, _task_id, source_id, model_id, actor_id = graph
            with sessions() as db:
                actor = db.get(User, actor_id)
                assert actor is not None
                payload = HumanizationJobCreate(ai_model_id=model_id)
                def create(key: str, request: str) -> GenerationJob:
                    return content_production.create_humanization_job(
                        db=db, content_version_id=source_id, payload=payload, actor=actor,
                        request_id=request, idempotency_key=key)

                def retry(key: str, request: str) -> GenerationJob:
                    return content_production.retry_generation_job(
                        db=db, generation_job_id=first.id, actor=actor, request_id=request,
                        idempotency_key=key)

                first = create("humanization-create-key", "request-create")
                replay = create("humanization-create-key", "request-create-replay")
                assert replay.id == first.id
                db.execute(
                    text("UPDATE generation_jobs SET status = 'FAILED' WHERE id = :job_id"),
                    {"job_id": first.id},
                )
                first.status = "FAILED"
                db.commit()
                retry_job = retry("humanization-retry-key", "request-retry")
                retry_replay = retry("humanization-retry-key", "request-retry-replay")
                assert retry_replay.id == retry_job.id
                assert len(dispatches) == 2

            conflict_graph = _prepare_humanization_graph(test_url, base_url)
            with sessions() as conflict_db:
                conflict_actor = conflict_db.get(User, conflict_graph[4])
                assert conflict_actor is not None
                with pytest.raises(AppError) as conflict_error:
                    content_production.create_humanization_job(
                        db=conflict_db, content_version_id=conflict_graph[2],
                        payload=HumanizationJobCreate(ai_model_id=conflict_graph[3]),
                        actor=conflict_actor, request_id="request-conflict",
                        idempotency_key="humanization-create-key")
            assert conflict_error.value.code == "IDEMPOTENCY_CONFLICT"
            assert conflict_error.value.message == "幂等键已用于另一生成请求"
            assert conflict_error.value.details == {}

            missing_diagnostics = _capture_humanization_diagnostics(monkeypatch)
            missing_error = IntegrityError(
                "INSERT", {}, SimpleNamespace(
                    sqlstate="23505",
                    diag=SimpleNamespace(constraint_name="uq_generation_jobs_idempotency_key"),
                ),
            )
            with monkeypatch.context() as isolated:
                def missing_winner(**_kwargs: object) -> tuple[object, bool]:
                    raise missing_error
                isolated.setattr(content_production, "_create_job", missing_winner)
                with sessions() as db:
                    actor = db.get(User, conflict_graph[4])
                    assert actor is not None
                    with pytest.raises(IntegrityError) as missing:
                        content_production.create_humanization_job(
                            db=db, content_version_id=conflict_graph[2],
                            payload=HumanizationJobCreate(ai_model_id=conflict_graph[3]),
                            actor=actor, request_id="request-missing-winner",
                            idempotency_key="humanization-missing-winner")
            assert missing.value is missing_error
            assert missing_diagnostics == ["uq_generation_jobs_idempotency_key"]

            for retry, expected_counts in ((False, [2, 1]), (True, [3, 2])):
                results, diagnostics, task_ids, source_ids = _run_same_key_humanization_race(
                    test_url, base_url, sessions, monkeypatch, retry=retry
                )
                assert sum(isinstance(result, GenerationJob) for result in results) == 1
                conflicts = [result for result in results if isinstance(result, AppError)]
                assert len(conflicts) == 1 and conflicts[0].code == "IDEMPOTENCY_CONFLICT"
                assert diagnostics == ["uq_generation_jobs_idempotency_key"]
                _assert_generation_failure_has_no_content_side_effects(
                    test_url, task_ids, source_ids, expected_counts
                )
            assert len(dispatches) == 4


@pytest.mark.integration
def test_humanization_active_constraint_maps_for_create_and_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with (
        temporary_database("partsignal_humanization_active") as database,
        fake_ai_server() as ai,
    ):
        test_url, sqlalchemy_url, _ = database
        base_url, _state = ai
        monkeypatch.setattr(content_production, "_dispatch_job", lambda _job: None)
        with patched_sessions(monkeypatch, sqlalchemy_url) as sessions:
            original_job_id, _task_id, source_id, model_id, actor_id = _prepare_humanization_graph(
                test_url, base_url
            )
            active_id = seed_humanization_job(test_url, original_job_id, source_id)
            with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
                cursor.execute(
                    "SELECT content_task_id FROM generation_jobs WHERE id = %s", (active_id,)
                )
                task_id = cursor.fetchone()[0]
            observed = _capture_humanization_diagnostics(monkeypatch)
            _hide_active_humanization_precheck(monkeypatch)
            with sessions() as db:
                actor = db.get(User, actor_id)
                with pytest.raises(AppError) as create_error:
                    content_production.create_humanization_job(
                        db=db, content_version_id=source_id,
                        payload=HumanizationJobCreate(ai_model_id=model_id), actor=actor,
                        request_id="request-active-create-final",
                        idempotency_key="active-create-final")
                assert create_error.value.code == "HUMANIZATION_ALREADY_ACTIVE"
            assert observed == ["uq_generation_jobs_active_humanization_source"]
            _assert_generation_failure_has_no_content_side_effects(
                test_url, [task_id], [source_id], [2]
            )

            retry_graph = _prepare_humanization_graph(test_url, base_url)
            original_id, retry_task_id, retry_source_id, retry_model_id, retry_actor_id = (
                retry_graph
            )
            failed_id = seed_humanization_job(test_url, original_id, retry_source_id)
            with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE generation_jobs SET status = 'FAILED' WHERE id = %s", (failed_id,)
                )
                connection.commit()
                active_retry_id = seed_humanization_job(test_url, original_id, retry_source_id)
                cursor.execute(
                    "UPDATE generation_jobs SET created_at = CASE id WHEN %s THEN now() "
                    "ELSE now() - interval '1 second' END WHERE id IN (%s, %s)",
                    (failed_id, active_retry_id, failed_id),
                )
                connection.commit()
            with sessions() as db:
                actor = db.get(User, retry_actor_id)
                with pytest.raises(AppError) as retry_error:
                    content_production.retry_generation_job(
                        db=db, generation_job_id=failed_id, actor=actor,
                        request_id="request-active-retry-final",
                        idempotency_key="active-retry-final")
                assert retry_error.value.code == "HUMANIZATION_ALREADY_ACTIVE"
            assert observed.count("uq_generation_jobs_active_humanization_source") == 2
            _assert_generation_failure_has_no_content_side_effects(
                test_url, [retry_task_id], [retry_source_id], [3]
            )

@pytest.mark.integration
def test_humanization_unknown_integrity_error_reaches_default_500(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with (
        temporary_database("partsignal_humanization_unknown") as database,
        fake_ai_server() as ai,
    ):
        test_url, sqlalchemy_url, _ = database
        base_url, _state = ai
        dispatches: list[uuid.UUID] = []
        monkeypatch.setattr(
            content_production, "_dispatch_job", lambda job: dispatches.append(job.id)
        )
        with patched_sessions(monkeypatch, sqlalchemy_url) as sessions:
            graph = _prepare_humanization_graph(test_url, base_url)
            original_job_id, task_id, source_id, model_id, actor_id = graph
            sentinel_errors: list[IntegrityError] = []
            def collide_with_existing_primary_key(
                session: Session, _flush_context: object, _instances: object
            ) -> None:
                for pending in session.new:
                    if isinstance(pending, GenerationJob):
                        pending.id = original_job_id

            event.listen(Session, "before_flush", collide_with_existing_primary_key)
            try:
                api = FastAPI(debug=False)
                api.add_exception_handler(AppError, app_error_handler)

                db_dependency = Depends(app_db.get_db)

                @api.post("/unknown")
                def unknown(db: Session = db_dependency) -> dict[str, str]:
                    actor = db.get(User, actor_id)
                    try:
                        content_production.create_humanization_job(
                            db=db, content_version_id=source_id,
                            payload=HumanizationJobCreate(ai_model_id=model_id), actor=actor,
                            request_id="request-unknown", idempotency_key="unknown-integrity-key")
                    except IntegrityError as error:
                        sentinel_errors.append(error)
                        raise
                    return {"status": "unexpected-success"}

                monkeypatch.setattr(app_db, "SessionLocal", sessions)
                response = TestClient(api, raise_server_exceptions=False).post("/unknown")
                assert response.status_code == 500
                assert not any(
                    secret in response.text
                    for secret in ("generation_jobs", "pk_generation_jobs", "duplicate key")
                )
            finally:
                event.remove(Session, "before_flush", collide_with_existing_primary_key)
            assert len(sentinel_errors) == 1
            real_error = sentinel_errors[0]
            assert real_error.orig.sqlstate == "23505"
            assert real_error.orig.diag.constraint_name == "pk_generation_jobs"
            assert content_production._classify_humanization_integrity_error(real_error) is None
            assert dispatches == []
            _assert_generation_failure_has_no_content_side_effects(
                test_url, [task_id], [source_id], [1]
            )


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
def test_pending_job_with_existing_source_skips_provider_before_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PENDING 重复投递已有 source 时直接收敛，不再次调用 provider。"""
    with (
        temporary_database("partsignal_generation_source_replay") as database,
        fake_ai_server() as (base_url, state),
    ):
        test_url, sqlalchemy_url, _ = database
        job_id, source_id = _seed_pending_job_with_existing_source(test_url, base_url)
        with patched_sessions(monkeypatch, sqlalchemy_url):
            generation.process_generation_job(job_id)

        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT status, content_version_id, error_code, lease_expires_at "
                "FROM generation_jobs WHERE id = %s",
                (job_id,),
            )
            assert cursor.fetchone() == ("SUCCEEDED", source_id, None, None)
            cursor.execute(
                "SELECT count(*) FROM content_versions WHERE source_job_id = %s",
                (job_id,),
            )
            assert cursor.fetchone() == (1,)
        assert state.calls == 0


@pytest.mark.integration
def test_content_version_identity_constraints_are_named_and_real(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """current-head PostgreSQL catalog 与真实 23505 diagnostics 必须一致。"""
    with temporary_database("partsignal_content_identity_catalog") as database:
        test_url, sqlalchemy_url, _ = database
        with patched_sessions(monkeypatch, sqlalchemy_url):
            job_id = seed_generation_job(test_url, base_url="http://127.0.0.1:9/v1")
            with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
                cursor.execute(
                    "SELECT c.conname, c.contype, array_agg(a.attname ORDER BY k.ord) "
                    "FROM pg_constraint c "
                    "JOIN pg_class r ON r.oid = c.conrelid "
                    "JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true "
                    "JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum = k.attnum "
                    "WHERE r.relname = 'content_versions' AND c.conname IN "
                    "('uq_content_versions_source_job_id', 'uq_content_versions_task_id') "
                    "GROUP BY c.conname, c.contype ORDER BY c.conname"
                )
                assert cursor.fetchall() == [
                    ("uq_content_versions_source_job_id", "u", ["source_job_id"]),
                    ("uq_content_versions_task_id", "u", ["task_id", "version"]),
                ]

            _insert_content_version_source(test_url, job_id)
            with pytest.raises(psycopg.errors.UniqueViolation) as source_error:
                _insert_content_version_source(test_url, job_id, version=2)
            assert source_error.value.sqlstate == "23505"
            assert (
                source_error.value.diag.constraint_name
                == "uq_content_versions_source_job_id"
            )

            with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
                cursor.execute(
                    "SELECT content_task_id, input_snapshot->'fact_version'->>'id', "
                    "created_by FROM generation_jobs WHERE id = %s",
                    (job_id,),
                )
                task_id, fact_version_id, created_by = cursor.fetchone()
                with pytest.raises(psycopg.errors.UniqueViolation) as task_error:
                    cursor.execute(
                        "INSERT INTO content_versions "
                        "(id, task_id, fact_version_id, source_job_id, version, source_type, "
                        "title, summary, body_markdown, tags, content_hash, status, revision, "
                        "quality_issues, change_summary, created_by) VALUES "
                        "(%s, %s, %s, NULL, 1, 'HUMAN', '重复', '重复', '重复', "
                        "ARRAY['catalog'], %s, 'DRAFT', 0, '[]'::jsonb, '重复', %s)",
                        (
                            uuid.uuid4(),
                            task_id,
                            uuid.UUID(fact_version_id),
                            "d" * 64,
                            created_by,
                        ),
                    )
                assert task_error.value.sqlstate == "23505"
                assert task_error.value.diag.constraint_name == "uq_content_versions_task_id"
                connection.rollback()


@pytest.mark.integration
@pytest.mark.parametrize("identity", ["source", "task"])
def test_worker_source_identity_violation_fails_without_replay_or_second_provider(
    monkeypatch: pytest.MonkeyPatch,
    identity: str,
) -> None:
    """final INSERT 命中两类 identity 后只提交安全 FAILED 结果。"""
    with (
        temporary_database("partsignal_generation_source_violation") as database,
        fake_ai_server() as (base_url, state),
    ):
        test_url, sqlalchemy_url, _ = database
        job_id = seed_generation_job(test_url, base_url=base_url)
        original_generate = generation.generate_for_job
        flush_diagnostics: list[tuple[str, str | None]] = []
        original_flush = Session.flush

        def capture_flush(session: Session, *args: Any, **kwargs: Any) -> Any:
            try:
                return original_flush(session, *args, **kwargs)
            except IntegrityError as error:
                orig = error.orig
                flush_diagnostics.append(
                    (getattr(orig, "sqlstate", ""), getattr(orig.diag, "constraint_name", None))
                )
                raise

        monkeypatch.setattr(Session, "flush", capture_flush)

        def inject_competitor(*args: Any, **kwargs: Any) -> Any:
            result = original_generate(*args, **kwargs)
            _insert_content_version_source(
                test_url,
                job_id,
                version=2,
                omit_source_job=identity == "task",
            )
            return result

        monkeypatch.setattr(generation, "generate_for_job", inject_competitor)
        def force_task_version(
            session: Session, _flush_context: object, _instances: object
        ) -> None:
            for pending in session.new:
                if isinstance(pending, ContentVersion) and pending.source_job_id == job_id:
                    pending.version = 2

        if identity == "task":
            event.listen(Session, "before_flush", force_task_version)
        try:
            with patched_sessions(monkeypatch, sqlalchemy_url):
                generation.process_generation_job(job_id)
        finally:
            if identity == "task":
                event.remove(Session, "before_flush", force_task_version)

        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT status, error_code, error_summary, content_version_id, "
                "lease_expires_at FROM generation_jobs WHERE id = %s",
                (job_id,),
            )
            assert cursor.fetchone() == (
                "FAILED",
                "GENERATION_FAILED",
                "生成作业执行失败",
                None,
                None,
            )
            cursor.execute(
                    "SELECT t.current_content_version_id, t.revision, count(*) "
                "FROM content_tasks t JOIN generation_jobs g ON g.content_task_id = t.id "
                "JOIN content_versions v ON v.task_id = t.id "
                "WHERE g.id = %s GROUP BY t.current_content_version_id, t.revision",
                (job_id,),
            )
            assert cursor.fetchone() == (None, 0, 1)
        assert state.calls == 1
        assert flush_diagnostics == [
            (
                "23505",
                f"uq_content_versions_{'source_job_id' if identity == 'source' else 'task_id'}",
            )
        ]


@pytest.mark.integration
def test_worker_late_final_failure_rolls_back_content_pointer_and_provider_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """final commit 前异常回滚候选版本、主线和非空 provider metadata。"""
    with (
        temporary_database("partsignal_generation_late_rollback") as database,
        fake_ai_server() as (base_url, _state),
    ):
        test_url, sqlalchemy_url, _ = database
        job_id = seed_generation_job(test_url, base_url=base_url)
        raised = False
        observed: list[IntegrityError] = []
        flushed_metadata: list[tuple[Any, ...]] = []
        rollback_states: list[str | None] = []

        def fail_after_success_flush(session: Session) -> None:
            nonlocal raised
            if raised:
                return
            jobs = [
                item
                for item in session.identity_map.values()
                if isinstance(item, GenerationJob)
                and item.id == job_id
                and item.status == "SUCCEEDED"
            ]
            versions = [
                item
                for item in session.identity_map.values()
                if isinstance(item, ContentVersion) and item.source_job_id == job_id
            ]
            if not jobs or not versions:
                return
            session.flush()
            job = jobs[0]
            flushed_metadata.append(
                (
                    job.provider_request_id,
                    job.response_duration_ms,
                    job.prompt_tokens,
                    job.completion_tokens,
                    job.total_tokens,
                )
            )
            try:
                session.execute(
                    text(
                        "INSERT INTO content_versions "
                        "(id, task_id, fact_version_id, source_job_id, based_on_id, version, "
                        "source_type, title, summary, body_markdown, tags, content_hash, status, "
                        "revision, quality_issues, change_summary, created_by) "
                        "SELECT :new_id, task_id, fact_version_id, source_job_id, based_on_id, "
                        "version + 1, source_type, title, summary, body_markdown, tags, "
                        "content_hash, status, revision, quality_issues, change_summary, "
                        "created_by "
                        "FROM content_versions WHERE id = :candidate_id"
                    ),
                    {"new_id": uuid.uuid4(), "candidate_id": versions[0].id},
                )
            except IntegrityError as error:
                raised = True
                observed.append(error)
                raise

        original_rollback = Session.rollback

        def observe_rollback(session: Session, *args: Any, **kwargs: Any) -> Any:
            result = original_rollback(session, *args, **kwargs)
            restored = session.get(GenerationJob, job_id)
            rollback_states.append(restored.status if restored is not None else None)
            return result

        event.listen(Session, "before_commit", fail_after_success_flush)
        monkeypatch.setattr(Session, "rollback", observe_rollback)
        try:
            with patched_sessions(monkeypatch, sqlalchemy_url):
                generation.process_generation_job(job_id)
        finally:
            event.remove(Session, "before_commit", fail_after_success_flush)

        assert len(observed) == 1
        assert observed[0].orig.sqlstate == "23505"
        assert observed[0].orig.diag.constraint_name == "uq_content_versions_source_job_id"
        assert flushed_metadata == [("req-reliability", 0, 10, 20, 30)]
        assert rollback_states == ["RUNNING"]

        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT status, error_code, error_summary, content_version_id, "
                "provider_request_id, response_duration_ms, prompt_tokens, "
                "completion_tokens, total_tokens, attempt_count, started_at, "
                "lease_expires_at FROM generation_jobs WHERE id = %s",
                (job_id,),
            )
            row = cursor.fetchone()
            assert row[:10] == (
                "FAILED",
                "GENERATION_FAILED",
                "生成作业执行失败",
                None,
                None,
                None,
                None,
                None,
                None,
                1,
            )
            assert row[10] is not None and row[11] is None
            cursor.execute(
                "SELECT t.current_content_version_id, t.revision, "
                "count(v.id), count(r.id) FROM content_tasks t "
                "JOIN generation_jobs g ON g.content_task_id = t.id "
                "LEFT JOIN content_versions v ON v.task_id = t.id "
                "LEFT JOIN content_review_records r ON r.content_version_id = v.id "
                "WHERE g.id = %s GROUP BY t.current_content_version_id, t.revision",
                (job_id,),
            )
            assert cursor.fetchone() == (None, 0, 0, 0)
        assert raised


@pytest.mark.integration
def test_worker_waits_for_task_lock_before_allocating_next_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Worker 在 provider 返回后仍须等待 Task 锁，再按 max(version)+1 写入。"""
    with (
        temporary_database("partsignal_generation_task_lock") as database,
        fake_ai_server(blocked=True) as (base_url, state),
    ):
        test_url, sqlalchemy_url, _ = database
        job_id = seed_generation_job(test_url, base_url=base_url)
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT content_task_id FROM generation_jobs WHERE id = %s", (job_id,))
            task_id = cursor.fetchone()[0]

        blocker = psycopg.connect(psycopg_url(test_url))
        blocker_cursor = blocker.cursor()
        with patched_sessions(monkeypatch, sqlalchemy_url):
            executor = ThreadPoolExecutor(max_workers=1)
            future = executor.submit(lambda: generation.process_generation_job(job_id))
            waiting = False
            try:
                assert state.received.wait(timeout=10)
                blocker_cursor.execute(
                    "SELECT id FROM content_tasks WHERE id = %s FOR UPDATE", (task_id,)
                )
                state.release.set()
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    with (
                        psycopg.connect(psycopg_url(test_url)) as observer,
                        observer.cursor() as cursor,
                    ):
                        cursor.execute(
                            "SELECT count(*) FROM pg_stat_activity "
                            "WHERE wait_event_type = 'Lock' AND state = 'active' "
                            "AND query ILIKE '%content_tasks%'"
                        )
                        waiting = cursor.fetchone()[0] > 0
                    if waiting:
                        break
                    threading.Event().wait(0.05)
            finally:
                state.release.set()
                blocker.commit()
                blocker_cursor.close()
                blocker.close()
                future.result(timeout=20)
                executor.shutdown(wait=True)

        assert waiting
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT g.status, g.content_version_id, v.version "
                "FROM generation_jobs g LEFT JOIN content_versions v "
                "ON v.id = g.content_version_id WHERE g.id = %s",
                (job_id,),
            )
            row = cursor.fetchone()
            assert row[0] == "SUCCEEDED"
            assert row[1] is not None
            assert row[2] == 1


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
