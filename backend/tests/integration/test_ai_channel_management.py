"""通过隔离 PostgreSQL 和真实 FastAPI 路径验证 AI 渠道管理边界。"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from sqlalchemy import create_engine, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

import app.routers.configuration as configuration_routes
from app.audit import contains_sensitive_key
from app.db import get_db
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.models.ai_generation import AIChannel, AIChannelHeader, AIModel
from app.models.identity import AuditLog, User
from app.schemas.configuration import (
    AIChannelHeaderCreate,
    AIChannelSort,
    AIModelCreate,
)
from app.security import hash_token
from app.services.ai_configuration import (
    _flush_ai_configuration,
    create_ai_channel_header,
    create_ai_model,
    list_ai_channels,
)


def _psycopg_url(value: str) -> str:
    return value.replace("postgresql+psycopg://", "postgresql://", 1)


def _replace_database(value: str, database_name: str) -> str:
    parts = urlsplit(_psycopg_url(value))
    return urlunsplit(
        (parts.scheme, parts.netloc, f"/{database_name}", parts.query, parts.fragment)
    )


@contextmanager
def temporary_database(
    revision: str,
) -> Iterator[tuple[str, str, dict[str, str], Path]]:
    """创建隔离 PostgreSQL 数据库，并迁移到指定修订。"""
    source_url = os.getenv("PARTSIGNAL_TEST_DATABASE_URL")
    if source_url is None and os.getenv("APP_ENV") == "test":
        source_url = os.getenv("DATABASE_URL")
    if not source_url:
        pytest.skip("未设置 PostgreSQL 测试环境，不以 SQLite 替代 PostgreSQL")
    database_name = f"partsignal_ai_{uuid.uuid4().hex[:10]}"
    with psycopg.connect(_psycopg_url(source_url), autocommit=True) as admin_connection:
        admin_connection.execute(
            sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name))
        )
    test_url = _replace_database(source_url, database_name)
    sqlalchemy_url = test_url.replace("postgresql://", "postgresql+psycopg://", 1)
    backend_dir = Path(__file__).resolve().parents[2]
    migration_env = {**os.environ, "DATABASE_URL": sqlalchemy_url}
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        check=True,
        cwd=backend_dir,
        env=migration_env,
    )
    try:
        yield test_url, sqlalchemy_url, migration_env, backend_dir
    finally:
        with psycopg.connect(_psycopg_url(source_url), autocommit=True) as admin_connection:
            admin_connection.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database_name))
            )


def _ai_channel_list_statement_count(engine: Engine, *, q: str | None = None) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with Session(engine) as db:
            list_ai_channels(
                db=db,
                q=q,
                channel_status=None,
                provider_brand=None,
                sort=AIChannelSort.CREATED_DESC,
                page=1,
                page_size=20,
            )
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


def _seed_concurrent_ai_channel(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    """为并发命令建立只包含用户和渠道的最小真实图。"""
    with Session(engine) as db:
        actor = User(
            username=f"ai-concurrent-{uuid.uuid4().hex[:8]}",
            display_name="AI 并发测试管理员",
            password_hash="not-used",
            account_type="ADMIN",
        )
        db.add(actor)
        db.flush()
        channel = AIChannel(
            name=f"并发渠道 {uuid.uuid4().hex[:8]}",
            description="并发唯一约束测试",
            protocol_type="openai-compatible-chat-completions",
            provider_brand="CUSTOM",
            base_url="https://8.8.8.8/v1",
            api_key_ciphertext="ciphertext",
            api_key_updated_at=datetime.now(UTC),
            timeout_seconds=30,
            created_by=actor.id,
        )
        db.add(channel)
        db.commit()
        return actor.id, channel.id


@pytest.mark.integration
def test_ai_model_duplicate_uses_stable_domain_error() -> None:
    """真实模型唯一约束失败必须返回稳定字段错误，且请求事务不能留下部分写入。"""
    with temporary_database("head") as (_, database_url, _, _):
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            admin = User(
                username=f"ai-integrity-admin-{uuid.uuid4().hex[:8]}",
                display_name="AI 约束边界管理员",
                password_hash="not-used",
                account_type="ADMIN",
            )
            db.add(admin)
            db.commit()

        csrf_token = "ai-integrity-csrf-token-with-more-than-32-characters"
        request_id = f"ai-model-duplicate-{uuid.uuid4().hex}"

        def override_db() -> Iterator[Session]:
            with session_factory() as db:
                yield db

        current_session = SimpleNamespace(
            user=admin,
            csrf_hash=hash_token(csrf_token),
            last_seen_at=None,
        )
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: current_session
        assert app.debug is False
        client = TestClient(app, raise_server_exceptions=False)
        try:
            created_channel = client.post(
                "/api/v1/ai-channels",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "name": "Unknown Integrity 渠道",
                    "description": "唯一约束 sentinel",
                    "protocol_type": "openai-compatible-chat-completions",
                    "provider_brand": "OPENAI",
                    "base_url": "https://8.8.8.8/v1",
                    "api_key": "integrity-channel-key",
                    "timeout_seconds": 30,
                },
            )
            assert created_channel.status_code == 201, created_channel.text
            channel_id = uuid.UUID(created_channel.json()["id"])

            created_model = client.post(
                f"/api/v1/ai-channels/{channel_id}/models",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "display_name": "唯一约束模型",
                    "model_id": "duplicate-integrity-model",
                    "request_parameters": {},
                },
            )
            assert created_model.status_code == 201, created_model.text
            model_id = uuid.UUID(created_model.json()["id"])

            with session_factory() as db:
                channel_before = db.get(AIChannel, channel_id)
                model_before = db.get(AIModel, model_id)
                assert channel_before is not None
                assert model_before is not None
                channel_revision_before = channel_before.revision
                model_revision_before = model_before.revision
                model_count_before = len(
                    list(db.scalars(select(AIModel).where(AIModel.channel_id == channel_id)))
                )

            duplicate = client.post(
                f"/api/v1/ai-channels/{channel_id}/models",
                headers={"X-CSRF-Token": csrf_token, "X-Request-ID": request_id},
                json={
                    "display_name": "不应落库的重复模型",
                    "model_id": "duplicate-integrity-model",
                    "request_parameters": {},
                },
            )
            assert duplicate.status_code == 409, duplicate.text
            assert duplicate.json()["error"]["code"] == "AI_MODEL_ID_EXISTS"
            assert duplicate.json()["error"]["message"] == "该 AI 渠道已存在相同的 Model ID"
            assert duplicate.json()["error"]["details"] == {
                "errors": [
                    {
                        "loc": ["body", "model_id"],
                        "msg": "该 AI 渠道已存在相同的 Model ID",
                        "type": "ai_model_id_exists",
                    }
                ]
            }
            assert duplicate.json()["error"]["request_id"] == request_id

            with session_factory() as db:
                channel_after = db.get(AIChannel, channel_id)
                models_after = list(
                    db.scalars(select(AIModel).where(AIModel.channel_id == channel_id))
                )
                duplicate_success_audits = list(
                    db.scalars(
                        select(AuditLog).where(
                            AuditLog.request_id == request_id,
                            AuditLog.action == "ai_model.created",
                            AuditLog.outcome == "SUCCESS",
                        )
                    )
                )
                assert channel_after is not None
                assert channel_after.revision == channel_revision_before
                assert len(models_after) == model_count_before == 1
                assert models_after[0].id == model_id
                assert models_after[0].revision == model_revision_before
                assert duplicate_success_audits == []
                assert db.scalar(select(1)) == 1

            with session_factory() as db:
                db.add_all(
                    [
                        AIChannelHeader(
                            channel_id=channel_id,
                            name="X-Duplicate",
                            normalized_name="x-duplicate",
                            is_sensitive=False,
                            plain_value="one",
                        ),
                        AIChannelHeader(
                            channel_id=channel_id,
                            name="x-duplicate",
                            normalized_name="x-duplicate",
                            is_sensitive=False,
                            plain_value="two",
                        ),
                    ]
                )
                with pytest.raises(AppError) as header_error:
                    _flush_ai_configuration(
                        db,
                        constraint_name="uq_ai_channel_headers_channel_id",
                        conflict=AppError("AI_CHANNEL_HEADER_NAME_EXISTS", "Header", 409),
                    )
                header_cause = header_error.value.__cause__
                assert header_cause is not None
                assert getattr(header_cause.orig, "sqlstate", None) == "23505"
                assert (
                    getattr(getattr(header_cause.orig, "diag", None), "constraint_name", None)
                    == "uq_ai_channel_headers_channel_id"
                )

            with session_factory() as db:
                db.add(
                    AIModel(
                        id=uuid.uuid4(),
                        channel_id=channel_id,
                        display_name="重复模型诊断",
                        model_id="duplicate-integrity-model",
                        request_parameters={},
                        created_by=admin.id,
                    )
                )
                with pytest.raises(AppError) as model_error:
                    _flush_ai_configuration(
                        db,
                        constraint_name="uq_ai_models_channel_id",
                        conflict=AppError("AI_MODEL_ID_EXISTS", "Model", 409),
                    )
                model_cause = model_error.value.__cause__
                assert model_cause is not None
                assert getattr(model_cause.orig, "sqlstate", None) == "23505"
                assert (
                    getattr(getattr(model_cause.orig, "diag", None), "constraint_name", None)
                    == "uq_ai_models_channel_id"
                )
        finally:
            app.dependency_overrides.clear()
            client.close()


@pytest.mark.integration
def test_ai_model_concurrent_prechecks_reach_one_real_constraint_conflict() -> None:
    """两个独立 Session 在预检后竞争 Model 唯一约束。"""
    with temporary_database("head") as (_, database_url, _, _):
        engine = create_engine(database_url)
        actor_id, channel_id = _seed_concurrent_ai_channel(engine)
        precheck_barrier = Barrier(2)

        def create_model(request_id: str) -> tuple[str, AppError | None]:
            with Session(engine) as db:
                actor = db.get(User, actor_id)
                assert actor is not None
                original_scalar = db.scalar
                synchronized = False

                def synchronized_scalar(
                    statement: object, *args: object, **kwargs: object
                ) -> object:
                    nonlocal synchronized
                    result = original_scalar(statement, *args, **kwargs)
                    if not synchronized:
                        synchronized = True
                        precheck_barrier.wait(timeout=30)
                    return result

                db.scalar = synchronized_scalar
                try:
                    create_ai_model(
                        db=db,
                        channel_id=channel_id,
                        payload=AIModelCreate(
                            display_name="并发模型",
                            model_id="concurrent-model",
                            request_parameters={},
                        ),
                        actor=actor,
                        request_id=request_id,
                    )
                except AppError as error:
                    return "error", error
                return "success", None

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(create_model, ["model-race-1", "model-race-2"]))
        assert [result[0] for result in results].count("success") == 1
        conflict = next(result[1] for result in results if result[1] is not None)
        assert conflict.code == "AI_MODEL_ID_EXISTS"
        assert conflict.details["errors"][0]["loc"] == ["body", "model_id"]
        cause = conflict.__cause__
        assert cause is not None
        assert getattr(cause.orig, "sqlstate", None) == "23505"
        assert getattr(getattr(cause.orig, "diag", None), "constraint_name", None) == (
            "uq_ai_models_channel_id"
        )
        with Session(engine) as db:
            models = list(db.scalars(select(AIModel).where(AIModel.channel_id == channel_id)))
            assert len(models) == 1


@pytest.mark.integration
def test_ai_header_lock_prioritizes_revision_conflict_after_first_success() -> None:
    """Header 渠道锁串行化后，旧 revision 优先于重复名称。"""
    with temporary_database("head") as (_, database_url, _, _):
        engine = create_engine(database_url)
        actor_id, channel_id = _seed_concurrent_ai_channel(engine)
        start_barrier = Barrier(2)

        def create_header(request_id: str) -> tuple[str, AppError | None]:
            with Session(engine) as db:
                actor = db.get(User, actor_id)
                assert actor is not None
                start_barrier.wait(timeout=30)
                try:
                    create_ai_channel_header(
                        db=db,
                        channel_id=channel_id,
                        payload=AIChannelHeaderCreate(
                            expected_channel_revision=0,
                            name="X-Concurrent-Header",
                            value="header-value",
                            is_sensitive=False,
                        ),
                        actor=actor,
                        request_id=request_id,
                    )
                except AppError as error:
                    return "error", error
                return "success", None

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(create_header, ["header-race-1", "header-race-2"]))
        assert [result[0] for result in results].count("success") == 1
        conflict = next(result[1] for result in results if result[1] is not None)
        assert conflict.code == "REVISION_CONFLICT"
        with Session(engine) as db:
            channel = db.get(AIChannel, channel_id)
            assert channel is not None
            assert channel.revision == 1
            assert len(list(db.scalars(select(AIChannelHeader)))) == 1


@pytest.mark.integration
def test_ai_model_unknown_integrity_error_keeps_http_500_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """真实未 allowlist 约束仍返回无数据库文本泄漏的默认 500。"""
    with temporary_database("head") as (_, database_url, _, _):
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            admin = User(
                username=f"ai-unknown-{uuid.uuid4().hex[:8]}",
                display_name="AI 未知错误管理员",
                password_hash="not-used",
                account_type="ADMIN",
            )
            db.add(admin)
            db.commit()
        csrf_token = "ai-unknown-csrf-token-with-more-than-32-characters"

        def override_db() -> Iterator[Session]:
            with session_factory() as db:
                yield db

        current_session = SimpleNamespace(user=admin, csrf_hash=hash_token(csrf_token))
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: current_session
        client = TestClient(app, raise_server_exceptions=False)

        def force_unknown_model(
            *, db: Session, channel_id: uuid.UUID, actor: User, **_: object
        ) -> AIModel:
            model = AIModel(
                id=uuid.uuid4(),
                channel_id=channel_id,
                display_name="未通过 schema 的模型",
                model_id=f"unknown-{uuid.uuid4().hex[:8]}",
                request_parameters={},
                test_status="INVALID",
                created_by=actor.id,
            )
            db.add(model)
            _flush_ai_configuration(
                db,
                constraint_name="uq_ai_models_channel_id",
                conflict=AppError("AI_MODEL_ID_EXISTS", "模型", 409),
            )
            return model

        try:
            created_channel = client.post(
                "/api/v1/ai-channels",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "name": "未知错误边界渠道",
                    "description": "unknown integrity sentinel",
                    "protocol_type": "openai-compatible-chat-completions",
                    "provider_brand": "OPENAI",
                    "base_url": "https://8.8.8.8/v1",
                    "api_key": "unknown-channel-key",
                    "timeout_seconds": 30,
                },
            )
            assert created_channel.status_code == 201, created_channel.text
            channel_id = uuid.UUID(created_channel.json()["id"])
            with session_factory() as db:
                channel_before = db.get(AIChannel, channel_id)
                assert channel_before is not None
                revision_before = channel_before.revision

            monkeypatch.setattr(
                configuration_routes, "create_ai_model_command", force_unknown_model
            )
            request_id = "ai-unknown-integrity-http"
            response = client.post(
                f"/api/v1/ai-channels/{channel_id}/models",
                headers={"X-CSRF-Token": csrf_token, "X-Request-ID": request_id},
                json={
                    "display_name": "合法请求载荷",
                    "model_id": "valid-at-boundary",
                    "request_parameters": {},
                },
            )
            assert response.status_code == 500
            response_text = response.text.lower()
            assert not any(
                fragment in response_text
                for fragment in (
                    "duplicate key",
                    "23514",
                    "ck_ai_models_ck_ai_models_test_status",
                    "ai_models",
                    "uniqueviolation",
                    "violates",
                    "constraint",
                    "postgres",
                    "database",
                    "sql",
                    "sqlalchemy",
                    "psycopg",
                    "traceback",
                    "stack trace",
                )
            )
            with session_factory() as db:
                channel_after = db.get(AIChannel, channel_id)
                assert channel_after is not None
                assert channel_after.revision == revision_before
                assert db.scalar(select(AIModel).where(AIModel.channel_id == channel_id)) is None
                assert (
                    db.scalar(
                        select(AuditLog.id).where(
                            AuditLog.request_id == request_id,
                            AuditLog.action == "ai_model.created",
                            AuditLog.outcome == "SUCCESS",
                        )
                    )
                    is None
                )
                assert db.scalar(select(1)) == 1

            primary_key = uuid.uuid4()
            with session_factory() as db:
                db.add(
                    AIModel(
                        id=primary_key,
                        channel_id=channel_id,
                        display_name="主键模型",
                        model_id="primary-key-model",
                        request_parameters={},
                        created_by=admin.id,
                    )
                )
                db.commit()
            with session_factory() as db:
                db.add(
                    AIModel(
                        id=primary_key,
                        channel_id=channel_id,
                        display_name="重复主键模型",
                        model_id="different-model-id",
                        request_parameters={},
                        created_by=admin.id,
                    )
                )
                with pytest.raises(IntegrityError) as primary_key_error:
                    _flush_ai_configuration(
                        db,
                        constraint_name="uq_ai_models_channel_id",
                        conflict=AppError("AI_MODEL_ID_EXISTS", "Model", 409),
                    )
                assert getattr(primary_key_error.value.orig, "sqlstate", None) == "23505"
                assert (
                    getattr(
                        getattr(primary_key_error.value.orig, "diag", None),
                        "constraint_name",
                        None,
                    )
                    == "pk_ai_models"
                )
        finally:
            app.dependency_overrides.clear()
            client.close()


@pytest.mark.integration
def test_ai_channel_api_enforces_permissions_contract_and_secret_redaction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """管理员管理闭环必须真实持久化，且任何读取和审计都不得泄露凭据。"""
    with temporary_database("head") as (_, database_url, _, _):
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            admin = User(
                username=f"ai-admin-{uuid.uuid4().hex[:8]}",
                display_name="AI 配置管理员",
                password_hash="not-used",
                account_type="ADMIN",
            )
            engineer = User(
                username=f"ai-engineer-{uuid.uuid4().hex[:8]}",
                display_name="AI 配置工程师",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            db.add_all([admin, engineer])
            db.commit()

        csrf_token = "ai-channel-csrf-token-with-more-than-32-characters"

        def override_db() -> Iterator[Session]:
            with session_factory() as db:
                yield db

        current_session = SimpleNamespace(
            user=engineer,
            csrf_hash=hash_token(csrf_token),
            last_seen_at=None,
        )
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: current_session
        client = TestClient(app)
        first_api_key = "first-api-key-must-never-be-returned"
        replacement_api_key = "replacement-api-key-must-never-be-returned"
        try:
            assert client.get("/api/v1/ai-channels").status_code == 403
            current_session.user = admin

            invalid_csrf = client.post(
                "/api/v1/ai-channels",
                headers={"X-CSRF-Token": "wrong-token-with-more-than-32-characters"},
                json={
                    "name": "拒绝的渠道",
                    "description": "CSRF 无效时不得创建",
                    "protocol_type": "openai-compatible-chat-completions",
                    "provider_brand": "CUSTOM",
                    "base_url": "https://8.8.8.8/v1",
                    "api_key": first_api_key,
                    "timeout_seconds": 30,
                },
            )
            assert invalid_csrf.status_code == 403

            created = client.post(
                "/api/v1/ai-channels",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "name": "Alpha 渠道",
                    "description": "主测试渠道",
                    "protocol_type": "openai-compatible-chat-completions",
                    "provider_brand": "OPENAI",
                    "base_url": "https://8.8.8.8/v1",
                    "api_key": first_api_key,
                    "timeout_seconds": 30,
                },
            )
            assert created.status_code == 201
            channel = created.json()
            channel_id = channel["id"]
            assert channel["api_key_configured"] is True
            assert "api_key" not in channel
            assert first_api_key not in created.text
            assert channel["available_actions"] == [
                "UPDATE",
                "REPLACE_API_KEY",
                "DELETE",
                "DISCOVER_MODELS",
                "CREATE_HEADER",
                "CREATE_MODEL",
            ]

            second = client.post(
                "/api/v1/ai-channels",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "name": "Beta 渠道",
                    "description": "分页对照渠道",
                    "protocol_type": "openai-compatible-chat-completions",
                    "provider_brand": "CUSTOM",
                    "base_url": "https://1.1.1.1/v1",
                    "api_key": "second-channel-key",
                    "timeout_seconds": 30,
                },
            )
            assert second.status_code == 201

            def fail_model_discovery(_client: object, **_request: object) -> list[str]:
                raise AppError("AI_UPSTREAM_FAILURE", "第三方原始异常不应进入审计", 502)

            monkeypatch.setattr(
                "app.services.ai_configuration.OpenAICompatibleClient.discover_models",
                fail_model_discovery,
            )
            failed_discovery = client.post(
                f"/api/v1/ai-channels/{channel_id}/discover-models",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "ai-discovery-failed",
                },
                json={"expected_revision": channel["revision"]},
            )
            assert failed_discovery.status_code == 502
            assert failed_discovery.json()["error"]["code"] == "AI_UPSTREAM_FAILURE"

            filtered = client.get(
                "/api/v1/ai-channels",
                params={
                    "q": "Alpha",
                    "status": "DISABLED",
                    "provider_brand": "OPENAI",
                    "sort": "NAME_ASC",
                    "page": 1,
                    "page_size": 10,
                },
            )
            assert filtered.status_code == 200, filtered.text
            assert [item["id"] for item in filtered.json()["items"]] == [channel_id]
            assert filtered.json()["counts"] == {"all": 1, "enabled": 0, "disabled": 1}
            summary = filtered.json()["items"][0]
            assert "base_url" not in summary
            assert summary["model_count"] == 0
            assert summary["enabled_model_count"] == 0
            assert summary["configuration_status"] == "NEEDS_SETUP"
            literal_wildcard = client.get("/api/v1/ai-channels", params={"q": "%", "page_size": 10})
            assert literal_wildcard.status_code == 200
            assert literal_wildcard.json()["items"] == []
            address_search = client.get(
                "/api/v1/ai-channels", params={"q": "8.8.8.8", "page_size": 10}
            )
            assert address_search.status_code == 200
            assert address_search.json()["items"] == []

            updated = client.patch(
                f"/api/v1/ai-channels/{channel_id}",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "expected_revision": channel["revision"],
                    "name": "Alpha 渠道",
                    "description": "更新后的渠道说明",
                    "protocol_type": "openai-compatible-chat-completions",
                    "provider_brand": "QWEN",
                    "base_url": "https://8.8.8.8/v1",
                    "timeout_seconds": 30,
                },
            )
            assert updated.status_code == 200
            assert updated.json()["description"] == "更新后的渠道说明"
            assert updated.json()["provider_brand"] == "QWEN"
            stale_discovery = client.post(
                f"/api/v1/ai-channels/{channel_id}/discover-models",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": channel["revision"]},
            )
            assert stale_discovery.status_code == 409
            assert stale_discovery.json()["error"]["code"] == "REVISION_CONFLICT"

            replaced = client.put(
                f"/api/v1/ai-channels/{channel_id}/api-key",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "expected_revision": updated.json()["revision"],
                    "api_key": replacement_api_key,
                },
            )
            assert replaced.status_code == 200
            assert replacement_api_key not in replaced.text

            public_header_value = "public-header-value-must-never-be-returned"
            secret_header_value = "secret-header-value-must-never-be-returned"
            created_header = client.post(
                f"/api/v1/ai-channels/{channel_id}/headers",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "expected_channel_revision": replaced.json()["revision"],
                    "name": "X-Workspace-Key",
                    "value": public_header_value,
                    "is_sensitive": False,
                },
            )
            assert created_header.status_code == 201
            assert public_header_value not in created_header.text
            header_id = created_header.json()["headers"][0]["id"]
            assert "value" not in created_header.json()["headers"][0]
            sentinel_model_id = uuid.uuid4()
            with session_factory() as db:
                db.add(
                    AIModel(
                        id=sentinel_model_id,
                        channel_id=uuid.UUID(channel_id),
                        display_name="原子性 sentinel",
                        model_id="atomicity-sentinel",
                        request_parameters={"temperature": 0.2},
                        is_enabled=True,
                        test_status="PASSED",
                        last_tested_at=datetime.now(UTC),
                        created_by=admin.id,
                    )
                )
                db.commit()
            def read_header_state(header_key: str) -> tuple[object, ...]:
                with session_factory() as db:
                    channel_row = db.get(AIChannel, uuid.UUID(channel_id))
                    header_row = db.get(AIChannelHeader, uuid.UUID(header_key))
                    sentinel_row = db.get(AIModel, sentinel_model_id)
                    assert channel_row is not None
                    assert header_row is not None
                    assert sentinel_row is not None
                    headers = db.scalars(
                        select(AIChannelHeader).where(
                            AIChannelHeader.channel_id == uuid.UUID(channel_id)
                        )
                    )
                    return (
                        channel_row.revision,
                        len(list(headers)),
                        tuple(
                            getattr(header_row, field)
                            for field in (
                                "name", "normalized_name", "is_sensitive",
                                "plain_value", "encrypted_value",
                            )
                        ),
                        tuple(
                            getattr(sentinel_row, field)
                            for field in (
                                "revision", "is_enabled", "test_status",
                                "last_tested_at", "last_test_error_summary",
                            )
                        ),
                    )
            def assert_header_state(
                header_key: str,
                expected: tuple[object, ...],
                request_id: str,
                action: str,
            ) -> None:
                assert read_header_state(header_key) == expected
                with session_factory() as db:
                    assert db.scalar(
                        select(AuditLog.id).where(
                            AuditLog.request_id == request_id,
                            AuditLog.action == action,
                            AuditLog.outcome == "SUCCESS",
                        )
                    ) is None
            def read_model_state(model_key: str) -> tuple[object, ...]:
                with session_factory() as db:
                    model_row = db.get(AIModel, uuid.UUID(model_key))
                    assert model_row is not None
                    models = db.scalars(
                        select(AIModel).where(AIModel.channel_id == uuid.UUID(channel_id))
                    )
                    return (
                        tuple(
                            dict(model_row.request_parameters)
                            if field == "request_parameters"
                            else getattr(model_row, field)
                            for field in (
                                "display_name", "model_id", "request_parameters",
                                "revision", "is_enabled", "test_status",
                                "last_tested_at", "last_test_error_summary",
                            )
                        ),
                        len(list(models)),
                    )
            header_snapshot = read_header_state(header_id)

            duplicate_header = client.post(
                f"/api/v1/ai-channels/{channel_id}/headers",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "ai-header-duplicate",
                },
                json={
                    "expected_channel_revision": created_header.json()["revision"],
                    "name": "x-workspace-key",
                    "value": "duplicate-header-value",
                    "is_sensitive": False,
                },
            )
            assert duplicate_header.status_code == 409
            assert duplicate_header.json()["error"]["code"] == "AI_CHANNEL_HEADER_NAME_EXISTS"
            assert duplicate_header.json()["error"]["details"]["errors"][0]["loc"] == [
                "body",
                "name",
            ]
            assert_header_state(
                header_id,
                header_snapshot,
                "ai-header-duplicate",
                "ai_channel_header.created",
            )
            updated_header = client.patch(
                f"/api/v1/ai-channel-headers/{header_id}",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "expected_channel_revision": created_header.json()["revision"],
                    "name": "X-Workspace-Key",
                    "value": secret_header_value,
                    "is_sensitive": True,
                },
            )
            assert updated_header.status_code == 200
            assert secret_header_value not in updated_header.text
            assert "value" not in updated_header.json()["headers"][0]
            second_header = client.post(
                f"/api/v1/ai-channels/{channel_id}/headers",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "expected_channel_revision": updated_header.json()["revision"],
                    "name": "X-Other-Key",
                    "value": "other-header-value",
                    "is_sensitive": False,
                },
            )
            assert second_header.status_code == 201
            second_header_id = next(
                item["id"]
                for item in second_header.json()["headers"]
                if item["name"] == "X-Other-Key"
            )
            header_snapshot = read_header_state(second_header_id)
            duplicate_header_update = client.patch(
                f"/api/v1/ai-channel-headers/{second_header_id}",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "ai-header-update-duplicate",
                },
                json={
                    "expected_channel_revision": second_header.json()["revision"],
                    "name": "x-workspace-key",
                    "value": "updated-duplicate-header-value",
                    "is_sensitive": False,
                },
            )
            assert duplicate_header_update.status_code == 409
            assert duplicate_header_update.json()["error"]["code"] == (
                "AI_CHANNEL_HEADER_NAME_EXISTS"
            )
            assert duplicate_header_update.json()["error"]["details"]["errors"][0]["loc"] == [
                "body",
                "name",
            ]
            assert_header_state(
                second_header_id,
                header_snapshot,
                "ai-header-update-duplicate",
                "ai_channel_header.updated",
            )
            stale_duplicate_header_update = client.patch(
                f"/api/v1/ai-channel-headers/{second_header_id}",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "ai-header-update-stale-duplicate",
                },
                json={
                    "expected_channel_revision": second_header.json()["revision"] - 1,
                    "name": "x-workspace-key",
                    "value": "stale-duplicate-header-value",
                    "is_sensitive": False,
                },
            )
            assert stale_duplicate_header_update.status_code == 409
            assert stale_duplicate_header_update.json()["error"]["code"] == (
                "REVISION_CONFLICT"
            )
            assert_header_state(
                second_header_id,
                header_snapshot,
                "ai-header-update-stale-duplicate",
                "ai_channel_header.updated",
            )
            with session_factory() as db:
                sentinel = db.get(AIModel, sentinel_model_id)
                assert sentinel is not None
                db.delete(sentinel)
                db.commit()
            deleted_second_header = client.delete(
                f"/api/v1/ai-channel-headers/{second_header_id}",
                headers={"X-CSRF-Token": csrf_token},
                params={"expected_channel_revision": second_header.json()["revision"]},
            )
            assert deleted_second_header.status_code == 204
            stale_header_delete = client.delete(
                f"/api/v1/ai-channel-headers/{header_id}",
                headers={"X-CSRF-Token": csrf_token},
                params={
                    "expected_channel_revision": updated_header.json()["revision"] - 1
                },
            )
            assert stale_header_delete.status_code == 409
            assert stale_header_delete.json()["error"]["code"] == "REVISION_CONFLICT"
            deleted_header = client.delete(
                f"/api/v1/ai-channel-headers/{header_id}",
                headers={"X-CSRF-Token": csrf_token},
                params={"expected_channel_revision": second_header.json()["revision"] + 1},
            )
            assert deleted_header.status_code == 204
            current_channel = client.get(f"/api/v1/ai-channels/{channel_id}")
            assert current_channel.status_code == 200
            assert current_channel.json()["headers"] == []

            def change_channel_during_discovery(_client: object, **_request: object) -> list[str]:
                """模拟发现期间渠道被修改，旧远端结果不得返回。"""
                with session_factory() as concurrent_db:
                    concurrent_channel = concurrent_db.get(AIChannel, uuid.UUID(channel_id))
                    assert concurrent_channel is not None
                    concurrent_channel.description = "发现期间已修改"
                    concurrent_channel.revision += 1
                    concurrent_db.commit()
                return ["stale-model"]

            monkeypatch.setattr(
                "app.services.ai_configuration.OpenAICompatibleClient.discover_models",
                change_channel_during_discovery,
            )
            conflicted_discovery = client.post(
                f"/api/v1/ai-channels/{channel_id}/discover-models",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": current_channel.json()["revision"]},
            )
            assert conflicted_discovery.status_code == 409
            assert conflicted_discovery.json()["error"]["code"] == "REVISION_CONFLICT"
            current_channel = client.get(f"/api/v1/ai-channels/{channel_id}")
            assert current_channel.status_code == 200

            model = client.post(
                f"/api/v1/ai-channels/{channel_id}/models",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "display_name": "测试模型",
                    "model_id": "test-model",
                    "request_parameters": {"temperature": 0},
                },
            )
            assert model.status_code == 201
            model_id = uuid.UUID(model.json()["id"])
            assert model.json()["available_actions"] == ["UPDATE", "TEST", "DELETE"]
            second_model = client.post(
                f"/api/v1/ai-channels/{channel_id}/models",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "display_name": "第二测试模型",
                    "model_id": "second-test-model",
                    "request_parameters": {},
                },
            )
            assert second_model.status_code == 201
            second_model_id = second_model.json()["id"]
            model_snapshot = read_model_state(second_model_id)
            duplicate_model_update = client.patch(
                f"/api/v1/ai-models/{second_model_id}",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "ai-model-update-duplicate",
                },
                json={
                    "display_name": "不得覆盖的模型",
                    "model_id": "test-model",
                    "request_parameters": {"temperature": 1},
                    "expected_revision": second_model.json()["revision"],
                },
            )
            assert duplicate_model_update.status_code == 409
            assert duplicate_model_update.json()["error"]["code"] == "AI_MODEL_ID_EXISTS"
            assert duplicate_model_update.json()["error"]["details"]["errors"][0]["loc"] == [
                "body",
                "model_id",
            ]
            assert read_model_state(second_model_id) == model_snapshot
            with session_factory() as db:
                assert db.scalar(
                    select(AuditLog.id).where(
                        AuditLog.request_id == "ai-model-update-duplicate",
                        AuditLog.action == "ai_model.updated",
                        AuditLog.outcome == "SUCCESS",
                    )
                ) is None
            with session_factory() as db:
                stale_revision_model = db.get(AIModel, uuid.UUID(second_model_id))
                assert stale_revision_model is not None
                stale_revision_model.revision += 1
                db.commit()
            model_snapshot = read_model_state(second_model_id)
            stale_duplicate_model_update = client.patch(
                f"/api/v1/ai-models/{second_model_id}",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "ai-model-update-stale-duplicate",
                },
                json={
                    "display_name": "不得覆盖的模型",
                    "model_id": "test-model",
                    "request_parameters": {"temperature": 1},
                    "expected_revision": second_model.json()["revision"],
                },
            )
            assert stale_duplicate_model_update.status_code == 409
            assert stale_duplicate_model_update.json()["error"]["code"] == (
                "REVISION_CONFLICT"
            )
            assert read_model_state(second_model_id) == model_snapshot
            with session_factory() as db:
                assert db.scalar(
                    select(AuditLog.id).where(
                        AuditLog.request_id == "ai-model-update-stale-duplicate",
                        AuditLog.action == "ai_model.updated",
                        AuditLog.outcome == "SUCCESS",
                    )
                ) is None
            deleted_second_model = client.delete(
                f"/api/v1/ai-models/{second_model_id}",
                headers={"X-CSRF-Token": csrf_token},
                params={"expected_revision": model_snapshot[0][3]},
            )
            assert deleted_second_model.status_code == 204

            with session_factory() as db:
                stale_model = db.get(AIModel, model_id)
                assert stale_model is not None
                stale_model.revision += 1
                db.commit()

            stale_test = client.post(
                f"/api/v1/ai-models/{model_id}/test",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": model.json()["revision"]},
            )
            assert stale_test.status_code == 409
            assert stale_test.json()["error"]["code"] == "REVISION_CONFLICT"
            current_model = client.get(f"/api/v1/ai-channels/{channel_id}/models").json()["items"][
                0
            ]

            def change_model_during_test(_client: object, **_request: object) -> None:
                """模拟外部调用期间管理员修改模型，旧测试结果不得覆盖新状态。"""
                with session_factory() as concurrent_db:
                    concurrent_model = concurrent_db.get(AIModel, model_id)
                    assert concurrent_model is not None
                    concurrent_model.display_name = "测试期间已修改"
                    concurrent_model.revision += 1
                    concurrent_db.commit()

            monkeypatch.setattr(
                "app.services.ai_configuration.OpenAICompatibleClient.test_connection",
                change_model_during_test,
            )
            conflicted_test = client.post(
                f"/api/v1/ai-models/{model_id}/test",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "ai-model-test-conflict",
                },
                json={"expected_revision": current_model["revision"]},
            )
            assert conflicted_test.status_code == 409
            assert conflicted_test.json()["error"]["code"] == "REVISION_CONFLICT"
            with session_factory() as db:
                stored_model = db.get(AIModel, model_id)
                assert stored_model is not None
                assert stored_model.display_name == "测试期间已修改"
                assert stored_model.test_status == "UNTESTED"
                assert stored_model.last_tested_at is None
                stored_model.test_status = "PASSED"
                db.commit()

            models = client.get(f"/api/v1/ai-channels/{channel_id}/models")
            assert models.status_code == 200
            assert set(models.json()["items"][0]["available_actions"]) == {
                "UPDATE",
                "TEST",
                "ENABLE",
                "DELETE",
            }
            model_projection = models.json()["items"][0]
            duplicate_disable_model = client.post(
                f"/api/v1/ai-models/{model_id}/disable",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": model_projection["revision"]},
            )
            assert duplicate_disable_model.status_code == 409
            assert duplicate_disable_model.json()["error"]["code"] == "INVALID_STATE_TRANSITION"
            enabled_model = client.post(
                f"/api/v1/ai-models/{model_id}/enable",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": model_projection["revision"]},
            )
            assert enabled_model.status_code == 200
            duplicate_enable_model = client.post(
                f"/api/v1/ai-models/{model_id}/enable",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": enabled_model.json()["revision"]},
            )
            assert duplicate_enable_model.status_code == 409
            assert duplicate_enable_model.json()["error"]["code"] == "INVALID_STATE_TRANSITION"
            disabled_model = client.post(
                f"/api/v1/ai-models/{model_id}/disable",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": enabled_model.json()["revision"]},
            )
            assert disabled_model.status_code == 200

            enabled = client.post(
                f"/api/v1/ai-channels/{channel_id}/enable",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": current_channel.json()["revision"]},
            )
            assert enabled.status_code == 200
            assert enabled.json()["is_enabled"] is True
            assert "DISABLE" in enabled.json()["available_actions"]
            assert "base_url" not in enabled.json()
            duplicate_enable = client.post(
                f"/api/v1/ai-channels/{channel_id}/enable",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": enabled.json()["revision"]},
            )
            assert duplicate_enable.status_code == 409
            assert duplicate_enable.json()["error"]["code"] == "INVALID_STATE_TRANSITION"
            disabled = client.post(
                f"/api/v1/ai-channels/{channel_id}/disable",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": enabled.json()["revision"]},
            )
            assert disabled.status_code == 200
            assert disabled.json()["is_enabled"] is False
            assert "ENABLE" in disabled.json()["available_actions"]

            usage = client.get(
                f"/api/v1/ai-channels/{channel_id}/usage-summary",
                params={"period": "30d"},
            )
            assert usage.status_code == 200
            usage_body = usage.json()
            assert usage_body["period_started_at"] is not None
            assert usage_body["period_ended_at"] is not None
            assert usage_body == {
                "channel_id": channel_id,
                "period": "30d",
                "period_started_at": usage_body["period_started_at"],
                "period_ended_at": usage_body["period_ended_at"],
                "total_jobs": 0,
                "succeeded_jobs": 0,
                "failed_jobs": 0,
                "success_rate": None,
                "average_response_duration_ms": None,
                "prompt_tokens": None,
                "completion_tokens": None,
                "total_tokens": None,
                "last_used_at": None,
            }

            audit_response = client.get(f"/api/v1/ai-channels/{channel_id}/audit-logs")
            assert audit_response.status_code == 200
            actions = {item["action"] for item in audit_response.json()["items"]}
            assert {
                "ai_channel.created",
                "ai_channel.updated",
                "ai_channel.api_key_replaced",
                "ai_channel_header.created",
                "ai_channel_header.updated",
                "ai_channel_header.deleted",
                "ai_model.created",
                "ai_channel.enabled",
                "ai_channel.disabled",
            }.issubset(actions)
            assert first_api_key not in audit_response.text
            assert replacement_api_key not in audit_response.text

            deletable_model = client.post(
                f"/api/v1/ai-channels/{channel_id}/models",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "display_name": "待删除模型",
                    "model_id": "delete-model",
                    "request_parameters": {},
                },
            )
            assert deletable_model.status_code == 201
            stale_model_delete = client.delete(
                f"/api/v1/ai-models/{deletable_model.json()['id']}",
                headers={"X-CSRF-Token": csrf_token},
                params={"expected_revision": deletable_model.json()["revision"] + 1},
            )
            assert stale_model_delete.status_code == 409
            assert stale_model_delete.json()["error"]["code"] == "REVISION_CONFLICT"
            deleted_model = client.delete(
                f"/api/v1/ai-models/{deletable_model.json()['id']}",
                headers={"X-CSRF-Token": csrf_token},
                params={"expected_revision": deletable_model.json()["revision"]},
            )
            assert deleted_model.status_code == 204

            stale_delete = client.delete(
                f"/api/v1/ai-channels/{channel_id}",
                headers={"X-CSRF-Token": csrf_token},
                params={"expected_revision": disabled.json()["revision"] - 1},
            )
            assert stale_delete.status_code == 409
            assert stale_delete.json()["error"]["code"] == "REVISION_CONFLICT"
            deleted = client.delete(
                f"/api/v1/ai-channels/{channel_id}",
                headers={"X-CSRF-Token": csrf_token},
                params={"expected_revision": disabled.json()["revision"]},
            )
            assert deleted.status_code == 204
        finally:
            app.dependency_overrides.clear()
            client.close()

        with session_factory() as db:
            assert db.get(AIChannel, uuid.UUID(channel_id)) is None
            assert db.get(AIModel, model_id) is None
            audit_logs = list(db.scalars(select(AuditLog).where(AuditLog.target_id == channel_id)))
            assert any(item.action == "ai_channel.deleted" for item in audit_logs)
            failure_logs = {
                item.request_id: item
                for item in db.scalars(
                    select(AuditLog).where(
                        AuditLog.request_id.in_(["ai-discovery-failed", "ai-model-test-conflict"])
                    )
                )
            }
            assert failure_logs == {}
            assert all(not contains_sensitive_key(item.details) for item in audit_logs)
            assert all(first_api_key not in str(item.details) for item in audit_logs)
            assert all(replacement_api_key not in str(item.details) for item in audit_logs)
            assert all(public_header_value not in str(item.details) for item in audit_logs)
            assert all(secret_header_value not in str(item.details) for item in audit_logs)
            second_channel = db.get(AIChannel, uuid.UUID(second.json()["id"]))
            assert second_channel is not None
            assert "second-channel-key" not in second_channel.api_key_ciphertext

        engine.dispose()


@pytest.mark.integration
def test_ai_channel_list_query_count_is_constant() -> None:
    """列表聚合固定为 counts、total 与当前页三条 SQL。"""
    with temporary_database("head") as (_, database_url, _, _):
        engine = create_engine(database_url)
        try:
            with Session(engine) as db:
                admin = User(
                    username=f"ai-list-admin-{uuid.uuid4().hex[:8]}",
                    display_name="AI 列表管理员",
                    password_hash="not-used",
                    account_type="ADMIN",
                )
                db.add(admin)
                db.commit()
                for index in range(4):
                    channel = AIChannel(
                        name=f"固定查询渠道 {index}",
                        description="查询数量不随行数增长",
                        protocol_type="openai-compatible-chat-completions",
                        provider_brand="CUSTOM",
                        base_url=f"https://8.8.8.{index + 1}/v1",
                        api_key_ciphertext="ciphertext",
                        api_key_updated_at=datetime.now(UTC),
                        timeout_seconds=30,
                        created_by=admin.id,
                    )
                    db.add(channel)
                    db.flush()
                    db.add(AIModel(
                        channel_id=channel.id,
                        display_name=f"模型 {index}",
                        model_id=f"model-{index}",
                        request_parameters={},
                        created_by=admin.id,
                    ))
                db.commit()

            assert _ai_channel_list_statement_count(engine) == 3
            assert _ai_channel_list_statement_count(engine, q="固定查询") == 3
        finally:
            engine.dispose()


@pytest.mark.integration
def test_ai_configuration_concurrent_delete_has_single_successful_effect(
    request: pytest.FixtureRequest,
) -> None:
    """同一 AI 配置并发删除只能成功一次，且失效副作用不能重复。"""
    with temporary_database("head") as (_, database_url, _, _):
        engine = create_engine(database_url)
        request.addfinalizer(engine.dispose)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        admin_id = uuid.uuid4()
        channel_id = uuid.uuid4()
        channel_header_id = uuid.uuid4()
        channel_model_id = uuid.uuid4()
        header_channel_id = uuid.uuid4()
        header_id = uuid.uuid4()
        header_model_id = uuid.uuid4()
        now = datetime.now(UTC)
        with session_factory() as db:
            admin = User(
                id=admin_id,
                username=f"ai-delete-admin-{uuid.uuid4().hex[:8]}",
                display_name="AI 删除管理员",
                password_hash="not-used",
                account_type="ADMIN",
            )
            db.add(admin)
            db.commit()
            db.add_all(
                [
                    AIChannel(
                        id=channel_id,
                        name="并发删除渠道",
                        description="验证渠道删除",
                        protocol_type="openai-compatible-chat-completions",
                        provider_brand="CUSTOM",
                        base_url="https://8.8.8.8/v1",
                        api_key_ciphertext="ciphertext",
                        api_key_updated_at=now,
                        timeout_seconds=30,
                        created_by=admin_id,
                    ),
                    AIChannelHeader(
                        id=channel_header_id,
                        channel_id=channel_id,
                        name="X-Delete-Channel",
                        normalized_name="x-delete-channel",
                        is_sensitive=False,
                        plain_value="value",
                    ),
                    AIModel(
                        id=channel_model_id,
                        channel_id=channel_id,
                        display_name="待级联删除模型",
                        model_id="delete-channel-model",
                        request_parameters={},
                        created_by=admin_id,
                    ),
                    AIChannel(
                        id=header_channel_id,
                        name="Header 并发删除渠道",
                        description="验证 Header 删除",
                        protocol_type="openai-compatible-chat-completions",
                        provider_brand="CUSTOM",
                        base_url="https://8.8.4.4/v1",
                        api_key_ciphertext="ciphertext",
                        api_key_updated_at=now,
                        timeout_seconds=30,
                        is_enabled=True,
                        revision=4,
                        created_by=admin_id,
                    ),
                    AIChannelHeader(
                        id=header_id,
                        channel_id=header_channel_id,
                        name="X-Delete-Header",
                        normalized_name="x-delete-header",
                        is_sensitive=False,
                        plain_value="value",
                    ),
                    AIModel(
                        id=header_model_id,
                        channel_id=header_channel_id,
                        display_name="待失效模型",
                        model_id="delete-header-model",
                        request_parameters={},
                        is_enabled=True,
                        test_status="PASSED",
                        last_tested_at=now,
                        revision=6,
                        created_by=admin_id,
                    ),
                ]
            )
            db.commit()

        csrf_token = "ai-delete-csrf-token-with-more-than-32-characters"

        def override_db() -> Iterator[Session]:
            with session_factory() as db:
                yield db

        current_session = SimpleNamespace(
            user=admin,
            csrf_hash=hash_token(csrf_token),
            last_seen_at=None,
        )
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: current_session

        def delete_twice(path: str, request_prefix: str) -> list[int]:
            barrier = Barrier(2)

            def issue_request(index: int) -> int:
                barrier.wait(timeout=5)
                with TestClient(app) as client:
                    response = client.delete(
                        path,
                        headers={
                            "X-CSRF-Token": csrf_token,
                            "X-Request-ID": f"{request_prefix}-{index}",
                        },
                    )
                return response.status_code

            with ThreadPoolExecutor(max_workers=2) as executor:
                futures = [executor.submit(issue_request, index) for index in range(2)]
                return sorted(future.result(timeout=15) for future in futures)

        try:
            channel_statuses = delete_twice(
                f"/api/v1/ai-channels/{channel_id}?expected_revision=0",
                "concurrent-channel-delete",
            )
            header_statuses = delete_twice(
                f"/api/v1/ai-channel-headers/{header_id}?expected_channel_revision=4",
                "concurrent-header-delete",
            )
        finally:
            app.dependency_overrides.clear()

        assert channel_statuses == [204, 404]
        assert header_statuses == [204, 404]
        with session_factory() as db:
            assert db.get(AIChannel, channel_id) is None
            assert db.get(AIChannelHeader, channel_header_id) is None
            assert db.get(AIModel, channel_model_id) is None
            assert db.get(AIChannelHeader, header_id) is None
            header_channel = db.get(AIChannel, header_channel_id)
            header_model = db.get(AIModel, header_model_id)
            assert header_channel is not None
            assert header_channel.is_enabled is False
            assert header_channel.revision == 5
            assert header_model is not None
            assert header_model.is_enabled is False
            assert header_model.test_status == "UNTESTED"
            assert header_model.last_tested_at is None
            assert header_model.revision == 7
            channel_delete_audits = list(
                db.scalars(
                    select(AuditLog).where(
                        AuditLog.action == "ai_channel.deleted",
                        AuditLog.target_id == str(channel_id),
                        AuditLog.outcome == "SUCCESS",
                    )
                )
            )
            header_delete_audits = list(
                db.scalars(
                    select(AuditLog).where(
                        AuditLog.action == "ai_channel_header.deleted",
                        AuditLog.target_id == str(header_channel_id),
                        AuditLog.outcome == "SUCCESS",
                    )
                )
            )
            assert len(channel_delete_audits) == 1
            assert len(header_delete_audits) == 1


@pytest.mark.integration
def test_ai_channel_migration_backfills_constraints_and_blocks_lossy_downgrade() -> None:
    """0021 只回填可证明值，并拒绝丢弃已填写的渠道身份。"""
    with temporary_database("0020_platform_branding_task_list") as (
        database_url,
        _,
        migration_env,
        backend_dir,
    ):
        user_id = uuid.uuid4()
        channel_id = uuid.uuid4()
        with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO users "
                "(id, username, display_name, password_hash, account_type, is_active, "
                "must_change_password, revision) "
                "VALUES (%s, %s, '迁移测试管理员', 'not-used', 'ADMIN', true, false, 0)",
                (user_id, f"migration-admin-{uuid.uuid4().hex[:8]}"),
            )
            cursor.execute(
                "INSERT INTO ai_channels "
                "(id, name, base_url, api_key_ciphertext, api_key_updated_at, "
                "timeout_seconds, created_by) "
                "VALUES (%s, '历史渠道', 'https://8.8.8.8/v1', 'ciphertext', now(), 30, %s)",
                (channel_id, user_id),
            )
            connection.commit()

        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "0021_ai_channel_model_management"],
            check=True,
            env=migration_env,
            cwd=backend_dir,
        )
        with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT description, protocol_type, provider_brand FROM ai_channels WHERE id = %s",
                (channel_id,),
            )
            assert cursor.fetchone() == (
                "",
                "openai-compatible-chat-completions",
                "CUSTOM",
            )
            cursor.execute(
                "SELECT column_name, column_default, is_nullable "
                "FROM information_schema.columns "
                "WHERE table_name = 'ai_channels' "
                "AND column_name IN ('description', 'protocol_type', 'provider_brand')"
            )
            assert set(cursor.fetchall()) == {
                ("description", None, "NO"),
                ("protocol_type", None, "NO"),
                ("provider_brand", None, "NO"),
            }
            cursor.execute(
                "SELECT indexdef FROM pg_indexes "
                "WHERE tablename = 'generation_jobs' "
                "AND indexname = 'ix_generation_jobs_ai_channel_created_at'"
            )
            assert "(ai_channel_id, created_at)" in cursor.fetchone()[0]
            with pytest.raises(psycopg.errors.CheckViolation):
                cursor.execute(
                    "UPDATE ai_channels SET provider_brand = 'UNREGISTERED' WHERE id = %s",
                    (channel_id,),
                )
            connection.rollback()

        subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0020_platform_branding_task_list"],
            check=True,
            env=migration_env,
            cwd=backend_dir,
        )
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "0021_ai_channel_model_management"],
            check=True,
            env=migration_env,
            cwd=backend_dir,
        )
        with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "UPDATE ai_channels SET description = '不可静默丢失' WHERE id = %s",
                (channel_id,),
            )
            connection.commit()

        downgrade = subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0020_platform_branding_task_list"],
            check=False,
            env=migration_env,
            cwd=backend_dir,
            capture_output=True,
            text=True,
        )
        assert downgrade.returncode != 0
        assert "AI channel identity data exists; downgrade is forbidden" in downgrade.stderr
        with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0021_ai_channel_model_management",)
