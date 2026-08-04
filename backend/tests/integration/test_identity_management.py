"""通过隔离 PostgreSQL 和真实 FastAPI 路径验证用户管理不变量。"""

from __future__ import annotations

import csv
import io
import os
import subprocess
import sys
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

import app.services.identity as identity_service
from app.audit import contains_sensitive_key
from app.config import settings
from app.db import get_db
from app.deps import get_current_session
from app.main import app
from app.models.configuration import PlatformType
from app.models.identity import AuditLog, SessionRecord, User
from app.models.product_facts import Product
from app.schemas.common import (
    UserBulkStatusItem,
    UserBulkStatusRequest,
    UserStatus,
)
from app.security import hash_token


def _psycopg_url(value: str) -> str:
    return value.replace("postgresql+psycopg://", "postgresql://", 1)


def _replace_database(value: str, database_name: str) -> str:
    parts = urlsplit(_psycopg_url(value))
    return urlunsplit(
        (parts.scheme, parts.netloc, f"/{database_name}", parts.query, parts.fragment)
    )


@contextmanager
def temporary_database() -> Iterator[str]:
    """创建身份管理测试专用数据库并迁移到当前 head。"""
    source_url = os.getenv("PARTSIGNAL_TEST_DATABASE_URL")
    if source_url is None and os.getenv("APP_ENV") == "test":
        source_url = os.getenv("DATABASE_URL")
    if not source_url:
        pytest.skip("未设置 PostgreSQL 测试环境，不以 SQLite 替代事务锁语义")
    database_name = f"partsignal_identity_{uuid.uuid4().hex[:10]}"
    with psycopg.connect(_psycopg_url(source_url), autocommit=True) as admin_connection:
        admin_connection.execute(
            sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name))
        )
    test_url = _replace_database(source_url, database_name)
    sqlalchemy_url = test_url.replace("postgresql://", "postgresql+psycopg://", 1)
    backend_dir = Path(__file__).resolve().parents[2]
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        check=True,
        cwd=backend_dir,
        env={**os.environ, "DATABASE_URL": sqlalchemy_url},
    )
    try:
        yield sqlalchemy_url
    finally:
        with psycopg.connect(_psycopg_url(source_url), autocommit=True) as admin_connection:
            admin_connection.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database_name))
            )


@pytest.mark.integration
def test_auth_session_probe_distinguishes_anonymous_and_invalid_sessions() -> None:
    """会话探测只把完全无 Cookie 视为匿名，其他认证失败继续返回 401。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        now = datetime.now(UTC)
        with session_factory() as db:
            active_user = User(
                username="session-active",
                display_name="有效会话账号",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            disabled_user = User(
                username="session-disabled",
                display_name="停用会话账号",
                password_hash="not-used",
                account_type="ENGINEER",
                is_active=False,
            )
            db.add_all([active_user, disabled_user])
            db.flush()
            db.add_all(
                [
                    SessionRecord(
                        token_hash=hash_token("valid-session"),
                        csrf_hash=hash_token("valid-csrf"),
                        user_id=active_user.id,
                        expires_at=now + timedelta(hours=1),
                    ),
                    SessionRecord(
                        token_hash=hash_token("revoked-session"),
                        csrf_hash=hash_token("revoked-csrf"),
                        user_id=active_user.id,
                        expires_at=now + timedelta(hours=1),
                        revoked_at=now,
                    ),
                    SessionRecord(
                        token_hash=hash_token("expired-session"),
                        csrf_hash=hash_token("expired-csrf"),
                        user_id=active_user.id,
                        expires_at=now - timedelta(seconds=1),
                    ),
                    SessionRecord(
                        token_hash=hash_token("disabled-session"),
                        csrf_hash=hash_token("disabled-csrf"),
                        user_id=disabled_user.id,
                        expires_at=now + timedelta(hours=1),
                    ),
                ]
            )
            db.commit()
            active_user_id = active_user.id

        def override_db() -> Iterator[Session]:
            with session_factory() as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        client = TestClient(app)
        try:
            anonymous = client.get("/api/v1/auth/me")
            assert anonymous.status_code == 204
            assert anonymous.content == b""
            assert client.get("/api/v1/users").status_code == 401

            client.cookies.set(settings.session_cookie_name, "valid-session")
            valid = client.get("/api/v1/auth/me")
            assert valid.status_code == 200
            assert valid.json()["id"] == str(active_user_id)
            assert valid.json()["available_actions"] == []

            for token in (
                "unknown-session",
                "revoked-session",
                "expired-session",
                "disabled-session",
            ):
                client.cookies.set(settings.session_cookie_name, token)
                rejected = client.get("/api/v1/auth/me")
                assert rejected.status_code == 401
                assert rejected.json()["error"]["code"] == "AUTH_REQUIRED"
        finally:
            app.dependency_overrides.clear()
            client.close()
            engine.dispose()


@pytest.mark.integration
def test_user_query_export_and_temporary_password_flow() -> None:
    """列表、导出与临时密码必须共同遵守权限、筛选和敏感信息边界。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
        with session_factory() as db:
            admin = User(
                id=uuid.UUID(int=1),
                username="admin-seed",
                display_name="管理账号",
                password_hash="not-used",
                account_type="ADMIN",
                created_at=created_at,
            )
            engineer = User(
                id=uuid.UUID(int=2),
                username="engineer-seed",
                display_name="工程账号",
                password_hash="not-used",
                account_type="ENGINEER",
                created_at=created_at,
            )
            literal_percent = User(
                id=uuid.UUID(int=3),
                username="literal-percent%",
                display_name="百分号账号",
                password_hash="not-used",
                account_type="ENGINEER",
                created_at=created_at,
            )
            disabled = User(
                id=uuid.UUID(int=4),
                username="disabled-seed",
                display_name="停用账号",
                password_hash="not-used",
                account_type="ENGINEER",
                is_active=False,
                must_change_password=True,
                created_at=created_at,
            )
            db.add_all([admin, engineer, literal_percent, disabled])
            db.commit()

        csrf_token = "identity-management-csrf-token-more-than-32-characters"

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
        temporary_password = "TemporaryPass!2026"
        new_password = "ReplacementPass!2026"
        created_user_id: uuid.UUID | None = None
        try:
            assert client.get("/api/v1/users").status_code == 403
            current_session.user = admin

            first_page = client.get("/api/v1/users", params={"page_size": 2})
            assert first_page.status_code == 200, first_page.text
            assert [item["id"] for item in first_page.json()["items"]] == [
                str(uuid.UUID(int=1)),
                str(uuid.UUID(int=2)),
            ]
            assert [item["available_actions"] for item in first_page.json()["items"]] == [
                ["UPDATE"],
                ["UPDATE", "RESET_PASSWORD", "DISABLE"],
            ]
            assert first_page.json()["total"] == 4
            assert first_page.json()["summary"] == {
                "user_total": 4,
                "enabled_total": 3,
                "disabled_total": 1,
                "must_change_password_total": 1,
                "admin_total": 1,
            }

            literal = client.get("/api/v1/users", params={"q": "%"})
            assert literal.status_code == 200
            assert [item["id"] for item in literal.json()["items"]] == [str(literal_percent.id)]
            combined = client.get(
                "/api/v1/users",
                params={"account_type": "ADMIN", "status": "ENABLED"},
            )
            assert combined.status_code == 200
            assert [item["id"] for item in combined.json()["items"]] == [str(admin.id)]
            assert combined.json()["summary"] == first_page.json()["summary"]

            exported = client.get("/api/v1/users/export", params={"status": "DISABLED"})
            assert exported.status_code == 200, exported.text
            assert exported.content.startswith(b"\xef\xbb\xbf")
            rows = list(csv.reader(io.StringIO(exported.content.decode("utf-8-sig"))))
            assert rows == [
                ["用户名", "显示名称", "账号类型", "状态", "必须修改密码", "创建时间"],
                [
                    disabled.username,
                    disabled.display_name,
                    "ENGINEER",
                    "DISABLED",
                    "YES",
                    created_at.isoformat(),
                ],
            ]
            assert "users-" in exported.headers["content-disposition"]

            duplicate_item = {"user_id": str(engineer.id), "expected_revision": 0}
            for invalid_items in (
                [],
                [duplicate_item, duplicate_item],
                [
                    {"user_id": str(uuid.UUID(int=value)), "expected_revision": 0}
                    for value in range(100, 201)
                ],
            ):
                invalid = client.post(
                    "/api/v1/users/bulk-status",
                    headers={"X-CSRF-Token": csrf_token},
                    json={"items": invalid_items, "status": "DISABLED"},
                )
                assert invalid.status_code == 422
                assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"

            invalid_csrf = client.post(
                "/api/v1/users",
                headers={"X-CSRF-Token": "wrong-token-more-than-32-characters"},
                json={
                    "username": "temporary-user",
                    "display_name": "临时密码用户",
                    "temporary_password": temporary_password,
                    "account_type": "ENGINEER",
                },
            )
            assert invalid_csrf.status_code == 403
            created = client.post(
                "/api/v1/users",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "username": "temporary-user",
                    "display_name": "临时密码用户",
                    "temporary_password": temporary_password,
                    "account_type": "ENGINEER",
                },
            )
            assert created.status_code == 201, created.text
            assert created.json()["must_change_password"] is True
            assert temporary_password not in created.text
            created_user_id = uuid.UUID(created.json()["id"])

            app.dependency_overrides.pop(get_current_session)
            first_session = TestClient(app)
            other_session = TestClient(app)
            try:
                first_login = first_session.post(
                    "/api/v1/auth/login",
                    json={"username": "temporary-user", "password": temporary_password},
                )
                other_login = other_session.post(
                    "/api/v1/auth/login",
                    json={"username": "temporary-user", "password": temporary_password},
                )
                assert first_login.status_code == 200
                assert other_login.status_code == 200
                blocked = first_session.get("/api/v1/users")
                assert blocked.status_code == 403
                assert blocked.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"

                changed = first_session.post(
                    "/api/v1/auth/change-password",
                    headers={"X-CSRF-Token": first_login.json()["csrf_token"]},
                    json={"old_password": temporary_password, "new_password": new_password},
                )
                assert changed.status_code == 204, changed.text
                assert first_session.get("/api/v1/auth/me").json()["must_change_password"] is False
                assert other_session.get("/api/v1/auth/me").status_code == 401
            finally:
                first_session.close()
                other_session.close()

            fresh_session = TestClient(app)
            try:
                assert (
                    fresh_session.post(
                        "/api/v1/auth/login",
                        json={"username": "temporary-user", "password": temporary_password},
                    ).status_code
                    == 401
                )
                assert (
                    fresh_session.post(
                        "/api/v1/auth/login",
                        json={"username": "temporary-user", "password": new_password},
                    ).status_code
                    == 200
                )
            finally:
                fresh_session.close()
        finally:
            app.dependency_overrides.clear()
            client.close()

        assert created_user_id is not None
        with session_factory() as db:
            stored_user = db.get(User, created_user_id)
            assert stored_user is not None
            assert stored_user.must_change_password is False
            export_audit = db.scalar(select(AuditLog).where(AuditLog.action == "user.exported"))
            assert export_audit is not None
            assert export_audit.details == {
                "facts": {
                    "account_type": None,
                    "status": "DISABLED",
                    "row_count": 1,
                }
            }
            audits = list(db.scalars(select(AuditLog)))
            assert all(audit.business_module == "IDENTITY" for audit in audits)
            assert all(audit.outcome == "SUCCESS" for audit in audits)
            assert all(not contains_sensitive_key(audit.details) for audit in audits)
            assert all(temporary_password not in str(audit.details) for audit in audits)
            assert all(new_password not in str(audit.details) for audit in audits)
        engine.dispose()


@pytest.mark.integration
def test_user_delete_and_reset_password_boundaries() -> None:
    """用户删除保留审计、尊重业务外键，并只放宽重置密码到八位。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        expires_at = datetime.now(UTC) + timedelta(hours=1)
        with session_factory() as db:
            admin = User(
                username="delete-admin",
                display_name="删除操作管理员",
                password_hash="not-used",
                account_type="ADMIN",
            )
            engineer = User(
                username="delete-engineer",
                display_name="删除权限工程师",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            deletable_admin = User(
                username="deletable-admin",
                display_name="可删除管理员",
                password_hash="not-used",
                account_type="ADMIN",
                is_active=False,
            )
            active_target = User(
                username="active-delete-target",
                display_name="启用删除目标",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            referenced_target = User(
                username="referenced-delete-target",
                display_name="业务引用删除目标",
                password_hash="not-used",
                account_type="ENGINEER",
                is_active=False,
            )
            reset_target = User(
                username="reset-eight-target",
                display_name="八位密码目标",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            db.add_all(
                [
                    admin,
                    engineer,
                    deletable_admin,
                    active_target,
                    referenced_target,
                    reset_target,
                ]
            )
            db.flush()
            deletable_admin_id = deletable_admin.id
            active_target_id = active_target.id
            referenced_target_id = referenced_target.id
            reset_target_id = reset_target.id
            historical_audit_id = uuid.uuid4()
            db.add_all(
                [
                    PlatformType(
                        name="用户删除业务引用",
                        slug=f"user-delete-reference-{uuid.uuid4().hex[:8]}",
                        created_by=referenced_target.id,
                    ),
                    SessionRecord(
                        token_hash=hash_token("deletable-user-session"),
                        csrf_hash=hash_token("deletable-user-csrf"),
                        user_id=deletable_admin.id,
                        expires_at=expires_at,
                    ),
                    SessionRecord(
                        token_hash=hash_token("reset-target-session"),
                        csrf_hash=hash_token("reset-target-csrf"),
                        user_id=reset_target.id,
                        expires_at=expires_at,
                    ),
                    AuditLog(
                        id=historical_audit_id,
                        actor_id=deletable_admin.id,
                        business_module="IDENTITY",
                        action="user.updated",
                        target_type="User",
                        target_id=str(deletable_admin.id),
                        outcome="SUCCESS",
                        result_message="历史用户操作",
                        request_id="historical-delete-actor",
                        details={"facts": {"status": "DISABLED"}},
                    ),
                ]
            )
            db.commit()

        csrf_token = "user-delete-csrf-token-more-than-32-characters"

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
        try:
            denied = client.delete(
                f"/api/v1/users/{deletable_admin_id}",
                headers={"X-CSRF-Token": csrf_token},
            )
            assert denied.status_code == 403
            assert denied.json()["error"]["code"] == "PERMISSION_DENIED"

            current_session.user = admin
            bad_csrf = client.delete(
                f"/api/v1/users/{deletable_admin_id}",
                headers={"X-CSRF-Token": "wrong-token-more-than-32-characters"},
            )
            assert bad_csrf.status_code == 403
            assert bad_csrf.json()["error"]["code"] == "CSRF_INVALID"

            active = client.delete(
                f"/api/v1/users/{active_target_id}",
                headers={"X-CSRF-Token": csrf_token},
            )
            assert active.status_code == 409
            assert active.json()["error"]["code"] == "USER_ACTIVE"

            referenced = client.delete(
                f"/api/v1/users/{referenced_target_id}",
                headers={"X-CSRF-Token": csrf_token},
            )
            assert referenced.status_code == 409
            assert referenced.json()["error"]["code"] == "USER_IN_USE"
            assert referenced.json()["error"]["details"]["references"] == [
                {"type": "USER_BUSINESS_HISTORY", "count": 1}
            ]

            seven_characters = client.post(
                f"/api/v1/users/{reset_target_id}/reset-password",
                headers={"X-CSRF-Token": csrf_token},
                json={"temporary_password": "1234567"},
            )
            assert seven_characters.status_code == 422
            assert seven_characters.json()["error"]["code"] == "VALIDATION_ERROR"
            eight_characters = client.post(
                f"/api/v1/users/{reset_target_id}/reset-password",
                headers={"X-CSRF-Token": csrf_token},
                json={"temporary_password": "12345678"},
            )
            assert eight_characters.status_code == 204

            before_delete = client.get("/api/v1/users", params={"page_size": 100})
            assert before_delete.status_code == 200
            assert before_delete.json()["summary"]["admin_total"] == 2
            actions_by_id = {
                item["id"]: item["available_actions"]
                for item in before_delete.json()["items"]
            }
            deletion_by_id = {
                item["id"]: item["deletion"]
                for item in before_delete.json()["items"]
            }
            assert "DELETE" in actions_by_id[str(deletable_admin_id)]
            assert "DELETE" not in actions_by_id[str(referenced_target_id)]
            assert deletion_by_id[str(deletable_admin_id)] == {"blockers": []}
            assert deletion_by_id[str(referenced_target_id)] == {
                "blockers": [{"type": "USER_BUSINESS_HISTORY", "count": 1}]
            }
            deleted = client.delete(
                f"/api/v1/users/{deletable_admin_id}",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "delete-user-success",
                },
            )
            assert deleted.status_code == 204, deleted.text
            after_delete = client.get("/api/v1/users", params={"page_size": 100})
            assert after_delete.json()["summary"]["admin_total"] == 1
        finally:
            app.dependency_overrides.clear()
            client.close()

        with session_factory() as db:
            assert db.get(User, deletable_admin_id) is None
            assert db.get(User, active_target_id) is not None
            assert db.get(User, referenced_target_id) is not None
            assert (
                db.scalar(
                    select(SessionRecord.id).where(
                        SessionRecord.user_id == deletable_admin_id
                    )
                )
                is None
            )
            reset_session = db.scalar(
                select(SessionRecord).where(SessionRecord.user_id == reset_target_id)
            )
            assert reset_session is not None and reset_session.revoked_at is not None
            historical_audit = db.get(AuditLog, historical_audit_id)
            assert historical_audit is not None
            assert historical_audit.actor_id is None
            deletion_audit = db.scalar(
                select(AuditLog).where(AuditLog.request_id == "delete-user-success")
            )
            assert deletion_audit is not None
            assert deletion_audit.actor_id == admin.id
            assert deletion_audit.target_id == str(deletable_admin_id)
            assert deletion_audit.details == {
                "facts": {"account_type": "ADMIN", "status": "DISABLED"}
            }
            assert "12345678" not in str(deletion_audit.details)
        engine.dispose()


@pytest.mark.integration
def test_single_and_bulk_status_share_transaction_invariants(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """单个与批量状态必须共享最后管理员、修订、撤销、审计和回滚语义。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            actor = User(
                id=uuid.UUID(int=10),
                username="actor-admin",
                display_name="操作管理员",
                password_hash="not-used",
                account_type="ADMIN",
            )
            second_admin = User(
                id=uuid.UUID(int=20),
                username="second-admin",
                display_name="备用管理员",
                password_hash="not-used",
                account_type="ADMIN",
            )
            engineer_one = User(
                id=uuid.UUID(int=30),
                username="engineer-one",
                display_name="工程师甲",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            engineer_two = User(
                id=uuid.UUID(int=40),
                username="engineer-two",
                display_name="工程师乙",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            rollback_one = User(
                id=uuid.UUID(int=50),
                username="rollback-one",
                display_name="回滚甲",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            rollback_two = User(
                id=uuid.UUID(int=60),
                username="rollback-two",
                display_name="回滚乙",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            db.add_all(
                [
                    actor,
                    second_admin,
                    engineer_one,
                    engineer_two,
                    rollback_one,
                    rollback_two,
                ]
            )
            db.flush()
            historical_type = PlatformType(
                name="历史归属分类",
                slug="historical-owner",
                created_by=engineer_one.id,
            )
            expires_at = datetime.now(UTC) + timedelta(hours=1)
            db.add_all(
                [
                    historical_type,
                    SessionRecord(
                        token_hash=hash_token("engineer-one-session"),
                        csrf_hash=hash_token("engineer-one-csrf"),
                        user_id=engineer_one.id,
                        expires_at=expires_at,
                    ),
                    SessionRecord(
                        token_hash=hash_token("second-admin-session"),
                        csrf_hash=hash_token("second-admin-csrf"),
                        user_id=second_admin.id,
                        expires_at=expires_at,
                    ),
                ]
            )
            db.commit()
            historical_type_id = historical_type.id

        csrf_token = "status-management-csrf-token-more-than-32-characters"

        def override_db() -> Iterator[Session]:
            with session_factory() as db:
                yield db

        current_session = SimpleNamespace(
            user=actor,
            csrf_hash=hash_token(csrf_token),
            last_seen_at=None,
        )
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: current_session
        client = TestClient(app)
        missing_id = uuid.UUID(int=70)
        try:
            partial = client.post(
                "/api/v1/users/bulk-status",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "items": [
                        {"user_id": str(second_admin.id), "expected_revision": 0},
                        {"user_id": str(missing_id), "expected_revision": 0},
                        {"user_id": str(engineer_two.id), "expected_revision": 99},
                        {"user_id": str(engineer_one.id), "expected_revision": 0},
                    ],
                    "status": "DISABLED",
                },
            )
            assert partial.status_code == 200, partial.text
            assert [item["id"] for item in partial.json()["succeeded"]] == [
                str(second_admin.id),
                str(engineer_one.id),
            ]
            assert partial.json()["failures"] == [
                {
                    "user_id": str(missing_id),
                    "code": "NOT_FOUND",
                    "message": "用户不存在",
                },
                {
                    "user_id": str(engineer_two.id),
                    "code": "REVISION_CONFLICT",
                    "message": "用户已被其他请求修改",
                },
            ]

            last_admin = client.patch(
                f"/api/v1/users/{actor.id}",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "expected_revision": 0,
                    "display_name": actor.display_name,
                    "account_type": "ADMIN",
                    "is_active": False,
                },
            )
            assert last_admin.status_code == 409
            assert last_admin.json()["error"]["code"] == "LAST_ADMIN_REQUIRED"

            mixed_last_admin = client.post(
                "/api/v1/users/bulk-status",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "items": [
                        {"user_id": str(actor.id), "expected_revision": 0},
                        {"user_id": str(engineer_two.id), "expected_revision": 0},
                    ],
                    "status": "DISABLED",
                },
            )
            assert mixed_last_admin.status_code == 200
            assert [item["id"] for item in mixed_last_admin.json()["succeeded"]] == [
                str(engineer_two.id)
            ]
            assert mixed_last_admin.json()["failures"] == [
                {
                    "user_id": str(actor.id),
                    "code": "LAST_ADMIN_REQUIRED",
                    "message": "系统必须保留至少一个有效管理员",
                }
            ]

            reenabled = client.patch(
                f"/api/v1/users/{engineer_one.id}",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "expected_revision": 1,
                    "display_name": "工程师甲（已恢复）",
                    "account_type": "ENGINEER",
                    "is_active": True,
                },
            )
            assert reenabled.status_code == 200
            assert reenabled.json()["id"] == str(engineer_one.id)
            assert reenabled.json()["revision"] == 2

            reenabled_admin = client.post(
                "/api/v1/users/bulk-status",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "items": [
                        {"user_id": str(second_admin.id), "expected_revision": 1},
                    ],
                    "status": "ENABLED",
                },
            )
            assert reenabled_admin.status_code == 200
            self_demoted = client.patch(
                f"/api/v1/users/{actor.id}",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "expected_revision": 0,
                    "display_name": actor.display_name,
                    "account_type": "ENGINEER",
                    "is_active": True,
                },
            )
            assert self_demoted.status_code == 200
            assert self_demoted.json()["account_type"] == "ENGINEER"
        finally:
            app.dependency_overrides.clear()
            client.close()

        with session_factory() as db:
            stored_admin = db.get(User, second_admin.id)
            stored_one = db.get(User, engineer_one.id)
            stored_two = db.get(User, engineer_two.id)
            stored_actor = db.get(User, actor.id)
            assert stored_admin is not None and stored_admin.is_active is True
            assert stored_admin.revision == 2
            assert stored_one is not None and stored_one.is_active is True
            assert stored_one.revision == 2
            assert stored_two is not None and stored_two.is_active is False
            assert stored_two.revision == 1
            assert stored_actor is not None and stored_actor.account_type == "ENGINEER"
            sessions = list(
                db.scalars(
                    select(SessionRecord).where(
                        SessionRecord.user_id.in_([second_admin.id, engineer_one.id])
                    )
                )
            )
            assert sessions and all(session.revoked_at is not None for session in sessions)
            history = db.get(PlatformType, historical_type_id)
            assert history is not None
            assert history.created_by == engineer_one.id
            bulk_audits = list(
                db.scalars(
                    select(AuditLog).where(
                        AuditLog.action == "user.updated",
                        AuditLog.target_id.in_([str(second_admin.id), str(engineer_one.id)]),
                    )
                )
            )
            bulk_details = [
                audit.details
                for audit in bulk_audits
                if audit.details.get("facts", {}).get("source") == "BULK_STATUS"
            ]
            assert bulk_details
            assert all(
                details["facts"]
                == {
                    "source": "BULK_STATUS",
                    "status": ("ENABLED" if details["changes"][0]["after"] is True else "DISABLED"),
                }
                and details["changes"][0]["field"] == "is_active"
                for details in bulk_details
            )
            single_details = [
                audit.details
                for audit in db.scalars(
                    select(AuditLog).where(
                        AuditLog.action == "user.updated",
                        AuditLog.target_id == str(engineer_one.id),
                    )
                )
                if audit.details.get("facts", {}).get("source") is None
            ]
            assert single_details == [
                {
                    "changes": [
                        {
                            "field": "display_name",
                            "before": "工程师甲",
                            "after": "工程师甲（已恢复）",
                        },
                        {"field": "is_active", "before": False, "after": True},
                    ],
                    "facts": {},
                }
            ]
            self_demote_audit = db.scalar(
                select(AuditLog).where(
                    AuditLog.action == "user.updated",
                    AuditLog.target_id == str(actor.id),
                    AuditLog.outcome == "SUCCESS",
                )
            )
            assert self_demote_audit is not None
            assert self_demote_audit.details == {
                "changes": [
                    {
                        "field": "account_type",
                        "before": "ADMIN",
                        "after": "ENGINEER",
                    }
                ],
                "facts": {},
            }

        audit_calls = 0
        original_append_audit = identity_service.append_audit

        def fail_second_audit(*args: Any, **kwargs: Any) -> None:
            """在第二项成功审计前注入意外错误，验证外层事务整体回滚。"""
            nonlocal audit_calls
            audit_calls += 1
            if audit_calls == 2:
                raise ValueError("注入的审计失败")
            original_append_audit(*args, **kwargs)

        monkeypatch.setattr(identity_service, "append_audit", fail_second_audit)
        with session_factory() as db:
            stored_actor = db.get(User, actor.id)
            assert stored_actor is not None
            with pytest.raises(ValueError, match="注入的审计失败"):
                identity_service.bulk_update_user_status(
                    db=db,
                    payload=UserBulkStatusRequest(
                        items=[
                            UserBulkStatusItem(user_id=rollback_one.id, expected_revision=0),
                            UserBulkStatusItem(user_id=rollback_two.id, expected_revision=0),
                        ],
                        status=UserStatus.DISABLED,
                    ),
                    actor=stored_actor,
                    request_id="rollback-request",
                )

        with session_factory() as db:
            for user_id in (rollback_one.id, rollback_two.id):
                stored = db.get(User, user_id)
                assert stored is not None
                assert stored.is_active is True
                assert stored.revision == 0
            assert (
                db.scalar(select(AuditLog.id).where(AuditLog.request_id == "rollback-request"))
                is None
            )
        engine.dispose()


@pytest.mark.integration
def test_audit_log_query_detail_filters_and_current_actor_projection() -> None:
    """全局列表使用稳定组合查询，并在读边界再次移除未知和敏感详情。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        created_at = datetime(2026, 7, 23, 8, 0, tzinfo=UTC)
        product_id = uuid.UUID(int=1000)
        product_audit_id = uuid.UUID(int=300)
        deleted_actor_audit_id = uuid.UUID(int=200)
        unsafe_audit_id = uuid.UUID(int=100)
        with session_factory() as db:
            admin = User(
                id=uuid.UUID(int=101),
                username="audit-admin",
                display_name="审计管理员",
                password_hash="not-used",
                account_type="ADMIN",
            )
            actor = User(
                id=uuid.UUID(int=102),
                username="audit-actor",
                display_name="原操作者名称",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            product = Product(
                id=product_id,
                part_number="AUDIT-PART",
                normalized_part_number="audit-part",
                brand="TEST",
                normalized_brand="test",
                category="TEST",
            )
            db.add_all([admin, actor, product])
            db.flush()
            db.add_all(
                [
                    AuditLog(
                        id=product_audit_id,
                        actor_id=actor.id,
                        business_module="PRODUCT_FACTS",
                        action="product.updated",
                        target_type="Product",
                        target_id=str(product.id),
                        outcome="SUCCESS",
                        result_message="产品更新完成",
                        error_code=None,
                        request_id="audit-query-shared",
                        created_at=created_at,
                        details={
                            "changes": [
                                {
                                    "field": "status",
                                    "before": "DRAFT",
                                    "after": "ACTIVE",
                                }
                            ],
                            "facts": {
                                "status": "ACTIVE",
                                "revision": 2,
                                "unknown": "不得返回",
                            },
                        },
                    ),
                    AuditLog(
                        id=deleted_actor_audit_id,
                        actor_id=None,
                        business_module="IDENTITY",
                        action="user.updated",
                        target_type="User",
                        target_id=str(uuid.uuid4()),
                        outcome="DENIED",
                        result_message="用户状态更新被拒绝",
                        error_code="PERMISSION_DENIED",
                        request_id="audit-query-denied",
                        created_at=created_at,
                        details={"facts": {"status": "DISABLED"}},
                    ),
                    AuditLog(
                        id=unsafe_audit_id,
                        actor_id=actor.id,
                        business_module="IDENTITY",
                        action="user.updated",
                        target_type="User",
                        target_id="not-a-uuid",
                        outcome="SUCCESS",
                        result_message="历史操作已完成",
                        error_code=None,
                        request_id="audit-query-unsafe",
                        created_at=created_at,
                        details={
                            "facts": {
                                "status": "ENABLED",
                                "authorization": "Bearer secret",
                            }
                        },
                    ),
                ]
            )
            db.commit()
            actor.display_name = "当前操作者名称"
            db.commit()

        def override_db() -> Iterator[Session]:
            with session_factory() as db:
                yield db

        csrf_token = "audit-query-csrf-token-more-than-32-characters"
        current_session = SimpleNamespace(
            user=admin,
            csrf_hash=hash_token(csrf_token),
            last_seen_at=None,
        )
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: current_session
        client = TestClient(app)
        try:
            response = client.get("/api/v1/audit-logs", params={"page_size": 100})
            assert response.status_code == 200, response.text
            assert [item["id"] for item in response.json()["items"]] == [
                str(product_audit_id),
                str(deleted_actor_audit_id),
                str(unsafe_audit_id),
            ]
            assert response.json()["items"][0]["actor"] == {
                "id": str(actor.id),
                "display_name": "当前操作者名称",
                "account_type": "ENGINEER",
            }
            assert response.json()["items"][1]["actor_id"] is None
            assert response.json()["items"][1]["actor"] is None
            assert response.json()["items"][2]["change_summary"] == {}
            assert "Bearer secret" not in response.text

            filtered = client.get(
                "/api/v1/audit-logs",
                params={
                    "created_from": created_at.isoformat(),
                    "created_to": (created_at + timedelta(seconds=1)).isoformat(),
                    "actor_id": str(actor.id),
                    "business_module": "PRODUCT_FACTS",
                    "action": "product.updated",
                    "target_type": "Product",
                    "target_id": str(product_id),
                    "outcome": "SUCCESS",
                    "request_id": "audit-query-shared",
                    "keyword": "ACTIVE",
                },
            )
            assert filtered.status_code == 200, filtered.text
            assert filtered.json()["total"] == 1
            assert filtered.json()["items"][0]["id"] == str(product_audit_id)

            invalid_window = client.get(
                "/api/v1/audit-logs",
                params={
                    "created_from": created_at.isoformat(),
                    "created_to": created_at.isoformat(),
                },
            )
            assert invalid_window.status_code == 422
            assert invalid_window.json()["error"]["code"] == "VALIDATION_ERROR"

            detail = client.get(f"/api/v1/audit-logs/{product_audit_id}")
            assert detail.status_code == 200, detail.text
            assert detail.json()["facts"] == {"revision": 2, "status": "ACTIVE"}
            assert detail.json()["changes"] == [
                {"field": "status", "before": "DRAFT", "after": "ACTIVE"}
            ]
            assert detail.json()["related_entry"] == {
                "status": "AVAILABLE",
                "kind": "Product",
                "parent_id": None,
            }

            options = client.get("/api/v1/audit-logs/filter-options")
            assert options.status_code == 200
            assert options.json() == {
                "actions": ["product.updated", "user.updated"],
                "target_types": ["Product", "User"],
            }

            current_session.user = actor
            assert client.get("/api/v1/audit-logs").status_code == 403
            assert client.get(f"/api/v1/audit-logs/{product_audit_id}").status_code == 403
        finally:
            app.dependency_overrides.clear()
            client.close()
        engine.dispose()


@pytest.mark.integration
def test_user_status_commands_record_success_failed_and_denied() -> None:
    """单个和批量启停写入真实结果，失败或拒绝不得改变用户状态。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            admin = User(
                id=uuid.UUID(int=201),
                username="status-audit-admin",
                display_name="状态审计管理员",
                password_hash="not-used",
                account_type="ADMIN",
            )
            engineer = User(
                id=uuid.UUID(int=202),
                username="status-audit-engineer",
                display_name="状态审计工程师",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            target = User(
                id=uuid.UUID(int=203),
                username="status-audit-target",
                display_name="状态审计目标",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            db.add_all([admin, engineer, target])
            db.commit()

        def override_db() -> Iterator[Session]:
            with session_factory() as db:
                yield db

        csrf_token = "status-audit-csrf-token-more-than-32-characters"
        current_session = SimpleNamespace(
            user=engineer,
            csrf_hash=hash_token(csrf_token),
            last_seen_at=None,
        )
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: current_session
        client = TestClient(app)
        try:
            payload = {
                "expected_revision": 0,
                "display_name": target.display_name,
                "account_type": "ENGINEER",
                "is_active": False,
            }
            denied = client.patch(
                f"/api/v1/users/{target.id}",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "identity-status-denied",
                },
                json=payload,
            )
            assert denied.status_code == 403

            current_session.user = admin
            failed = client.patch(
                f"/api/v1/users/{target.id}",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "identity-status-failed",
                },
                json={**payload, "expected_revision": 99},
            )
            assert failed.status_code == 409
            succeeded = client.patch(
                f"/api/v1/users/{target.id}",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "identity-status-success",
                },
                json=payload,
            )
            assert succeeded.status_code == 200

            missing_id = uuid.UUID(int=204)
            bulk = client.post(
                "/api/v1/users/bulk-status",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "identity-bulk-mixed",
                },
                json={
                    "items": [
                        {"user_id": str(target.id), "expected_revision": 1},
                        {"user_id": str(missing_id), "expected_revision": 0},
                    ],
                    "status": "ENABLED",
                },
            )
            assert bulk.status_code == 200, bulk.text
            assert [item["id"] for item in bulk.json()["succeeded"]] == [str(target.id)]
            assert bulk.json()["failures"][0]["user_id"] == str(missing_id)
        finally:
            app.dependency_overrides.clear()
            client.close()

        with session_factory() as db:
            stored = db.get(User, target.id)
            assert stored is not None
            assert stored.is_active is True
            assert stored.revision == 2
            outcomes = {
                audit.request_id: (audit.outcome, audit.error_code)
                for audit in db.scalars(
                    select(AuditLog).where(
                        AuditLog.request_id.in_(
                            [
                                "identity-status-denied",
                                "identity-status-failed",
                                "identity-status-success",
                            ]
                        )
                    )
                )
            }
            assert outcomes == {
                "identity-status-denied": ("DENIED", "PERMISSION_DENIED"),
                "identity-status-failed": ("FAILED", "REVISION_CONFLICT"),
                "identity-status-success": ("SUCCESS", None),
            }
            mixed = list(
                db.scalars(
                    select(AuditLog)
                    .where(AuditLog.request_id == "identity-bulk-mixed")
                    .order_by(AuditLog.outcome)
                )
            )
            assert [(audit.target_id, audit.outcome, audit.error_code) for audit in mixed] == [
                (str(missing_id), "FAILED", "NOT_FOUND"),
                (str(target.id), "SUCCESS", None),
            ]
        engine.dispose()
