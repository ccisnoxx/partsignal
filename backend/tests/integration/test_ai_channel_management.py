"""通过隔离 PostgreSQL 和真实 FastAPI 路径验证 AI 渠道管理边界。"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.audit import contains_sensitive_key
from app.db import get_db
from app.deps import get_current_session
from app.main import app
from app.models.ai_generation import AIChannel, AIModel
from app.models.identity import AuditLog, User
from app.security import hash_token


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
            literal_wildcard = client.get("/api/v1/ai-channels", params={"q": "%", "page_size": 10})
            assert literal_wildcard.status_code == 200
            assert literal_wildcard.json()["items"] == []

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
                headers={"X-CSRF-Token": csrf_token},
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

            enabled = client.post(
                f"/api/v1/ai-channels/{channel_id}/enable",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": replaced.json()["revision"]},
            )
            assert enabled.status_code == 200
            assert enabled.json()["is_enabled"] is True
            disabled = client.post(
                f"/api/v1/ai-channels/{channel_id}/disable",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": enabled.json()["revision"]},
            )
            assert disabled.status_code == 200
            assert disabled.json()["is_enabled"] is False

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
                "ai_model.created",
                "ai_channel.enabled",
                "ai_channel.disabled",
            }.issubset(actions)
            assert first_api_key not in audit_response.text
            assert replacement_api_key not in audit_response.text

            deleted = client.delete(
                f"/api/v1/ai-channels/{channel_id}",
                headers={"X-CSRF-Token": csrf_token},
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
            assert all(not contains_sensitive_key(item.details) for item in audit_logs)
            assert all(first_api_key not in str(item.details) for item in audit_logs)
            assert all(replacement_api_key not in str(item.details) for item in audit_logs)
            second_channel = db.get(AIChannel, uuid.UUID(second.json()["id"]))
            assert second_channel is not None
            assert "second-channel-key" not in second_channel.api_key_ciphertext

        engine.dispose()


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
