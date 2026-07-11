"""只在显式 PostgreSQL 测试环境执行的迁移与初始化集成测试。"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from psycopg import sql

from app.security import verify_password

ADMIN_PASSWORD = "integration-admin-only"
ENGINEER_PASSWORD = "integration-engineer-only"
CLEANUP_USERNAMES = (
    "product_editor",
    "product_reviewer",
    "content_reviewer",
    "analyst",
)


def psycopg_url(value: str) -> str:
    """将 SQLAlchemy psycopg URL 转为驱动可直接连接的 URL。"""
    return value.replace("postgresql+psycopg://", "postgresql://", 1)


def replace_database(value: str, database_name: str) -> str:
    """保持主机和凭据不变，仅切换数据库名。"""
    parts = urlsplit(psycopg_url(value))
    return urlunsplit(
        (parts.scheme, parts.netloc, f"/{database_name}", parts.query, parts.fragment)
    )


@contextmanager
def temporary_database(prefix: str) -> Iterator[tuple[str, dict[str, str], Path]]:
    """创建迁移专用数据库，并在测试结束后强制清理连接。"""
    source_url = os.getenv("PARTSIGNAL_TEST_DATABASE_URL")
    if source_url is None and os.getenv("APP_ENV") == "test":
        source_url = os.getenv("DATABASE_URL")
    if not source_url:
        pytest.skip("未设置 PostgreSQL 测试环境，不以 SQLite 替代 PostgreSQL")

    test_database = f"{prefix}_{uuid.uuid4().hex[:10]}"
    with psycopg.connect(psycopg_url(source_url), autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(test_database)))
    test_url = replace_database(source_url, test_database)
    sqlalchemy_url = test_url.replace("postgresql://", "postgresql+psycopg://", 1)
    env = {**os.environ, "DATABASE_URL": sqlalchemy_url}
    backend_dir = Path(__file__).resolve().parents[2]
    try:
        yield test_url, env, backend_dir
    finally:
        with psycopg.connect(psycopg_url(source_url), autocommit=True) as admin:
            admin.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(test_database))
            )


def run_alembic(
    env: dict[str, str],
    backend_dir: Path,
    revision: str,
    *,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    """在测试数据库执行迁移，并保留失败输出供原子性断言。"""
    return subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        check=check,
        env=env,
        cwd=backend_dir,
        capture_output=not check,
        text=True,
    )


def seed_accounts(
    env: dict[str, str],
    backend_dir: Path,
    admin_password: str = ADMIN_PASSWORD,
    engineer_password: str = ENGINEER_PASSWORD,
) -> None:
    """通过公开维护命令初始化两个账号。"""
    subprocess.run(
        [
            sys.executable,
            "-m",
            "app.cli",
            "seed-demo",
            "--password",
            admin_password,
            "--engineer-password",
            engineer_password,
        ],
        check=True,
        env=env,
        cwd=backend_dir,
    )


@pytest.mark.integration
def test_fresh_postgresql_migrates_to_head_and_seed_is_idempotent() -> None:
    """空库初始化两个独立账号，重复部署不得覆盖既有账号。"""
    with temporary_database("partsignal_test") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "head")
        seed_accounts(env, backend_dir)

        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT tablename FROM pg_tables "
                "WHERE schemaname = 'public' AND tablename = ANY(%s)",
                (
                    [
                        "fact_versions",
                        "content_versions",
                        "publication_records",
                        "geo_observations",
                        "platform_types",
                        "platform_prompts",
                        "ai_channels",
                        "ai_channel_headers",
                        "ai_models",
                    ],
                ),
            )
            assert {row[0] for row in cursor.fetchall()} == {
                "fact_versions",
                "content_versions",
                "publication_records",
                "geo_observations",
                "platform_types",
                "platform_prompts",
                "ai_channels",
                "ai_channel_headers",
                "ai_models",
            }
            cursor.execute(
                "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname = ANY(%s)",
                (
                    [
                        "fact_versions_guard",
                        "content_tasks_type_guard",
                        "content_versions_guard",
                        "publication_records_guard",
                    ],
                ),
            )
            assert {row[0] for row in cursor.fetchall()} == {
                "fact_versions_guard",
                "content_tasks_type_guard",
                "content_versions_guard",
                "publication_records_guard",
            }
            cursor.execute(
                "SELECT username, account_type, must_change_password, password_hash "
                "FROM users ORDER BY username"
            )
            users = cursor.fetchall()
            assert [(row[0], row[1], row[2]) for row in users] == [
                ("admin", "ADMIN", False),
                ("content_editor", "ENGINEER", True),
            ]
            hashes = {row[0]: row[3] for row in users}
            assert verify_password(hashes["admin"], ADMIN_PASSWORD)
            assert not verify_password(hashes["admin"], ENGINEER_PASSWORD)
            assert verify_password(hashes["content_editor"], ENGINEER_PASSWORD)
            assert not verify_password(hashes["content_editor"], ADMIN_PASSWORD)
            cursor.execute(
                "UPDATE users SET display_name = display_name || ' 已修改', is_active = false, "
                "revision = revision + 3"
            )
            connection.commit()

        seed_accounts(env, backend_dir, "different-admin-password", "different-engineer-password")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT username, display_name, password_hash, is_active, revision "
                "FROM users ORDER BY username"
            )
            repeated_users = cursor.fetchall()
            assert [row[0] for row in repeated_users] == ["admin", "content_editor"]
            assert all(row[1].endswith(" 已修改") for row in repeated_users)
            assert {row[0]: row[2] for row in repeated_users} == hashes
            assert all(row[3] is False and row[4] == 3 for row in repeated_users)
            cursor.execute(
                "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' "
                "AND tablename IN ('roles', 'user_roles')"
            )
            assert cursor.fetchone() == (0,)


@pytest.mark.integration
def test_existing_role_users_migrate_to_account_types() -> None:
    """从 0008 真实角色数据升级，非清理账号不受 0010 影响。"""
    with temporary_database("partsignal_migration") as (test_url, env, backend_dir):
        admin_id = uuid.uuid4()
        engineer_id = uuid.uuid4()
        platform_id = uuid.uuid4()
        run_alembic(env, backend_dir, "0008_files")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO users "
                "(id, username, display_name, password_hash, is_active, revision) "
                "VALUES (%s, 'legacy-admin', '旧管理员', 'hash', true, 0), "
                "(%s, 'legacy-editor', '旧工程师', 'hash', true, 0)",
                (admin_id, engineer_id),
            )
            cursor.execute(
                "INSERT INTO user_roles (user_id, role_name) VALUES "
                "(%s, 'SYSTEM_ADMIN'), (%s, 'CONTENT_EDITOR')",
                (admin_id, engineer_id),
            )
            cursor.execute(
                "INSERT INTO platform_profiles (id, name, slug, allowed_domains) "
                "VALUES (%s, '旧平台', 'legacy-platform', ARRAY['legacy.example'])",
                (platform_id,),
            )
            connection.commit()

        run_alembic(env, backend_dir, "head")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT username, account_type FROM users ORDER BY username")
            assert cursor.fetchall() == [
                ("legacy-admin", "ADMIN"),
                ("legacy-editor", "ENGINEER"),
            ]
            cursor.execute("SELECT to_regclass('public.user_roles'), to_regclass('public.roles')")
            assert cursor.fetchone() == (None, None)
            cursor.execute(
                "SELECT platform_type_id, revision FROM platform_profiles WHERE id = %s",
                (platform_id,),
            )
            assert cursor.fetchone() == (None, 0)


@pytest.mark.integration
def test_legacy_seed_users_are_cleaned_with_sessions() -> None:
    """六个旧初始化账号升级后只保留管理员和内容工程师。"""
    with temporary_database("partsignal_cleanup") as (test_url, env, backend_dir):
        user_ids = {
            username: uuid.uuid4()
            for username in ("admin", "content_editor", *CLEANUP_USERNAMES)
        }
        roles = {
            "admin": "SYSTEM_ADMIN",
            "content_editor": "CONTENT_EDITOR",
            "product_editor": "PRODUCT_EDITOR",
            "product_reviewer": "PRODUCT_REVIEWER",
            "content_reviewer": "CONTENT_REVIEWER",
            "analyst": "ANALYST",
        }
        run_alembic(env, backend_dir, "0008_files")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO users "
                "(id, username, display_name, password_hash, is_active, revision) "
                "VALUES (%s, %s, %s, %s, true, 0)",
                [
                    (
                        user_id,
                        username,
                        username,
                        "content-editor-original-hash"
                        if username == "content_editor"
                        else f"hash-{username}",
                    )
                    for username, user_id in user_ids.items()
                ],
            )
            cursor.executemany(
                "INSERT INTO user_roles (user_id, role_name) VALUES (%s, %s)",
                [(user_ids[username], role) for username, role in roles.items()],
            )
            cursor.executemany(
                "INSERT INTO sessions "
                "(id, token_hash, csrf_hash, user_id, expires_at) "
                "VALUES (%s, %s, %s, %s, now() + interval '1 day')",
                [
                    (uuid.uuid4(), f"token-{index}", f"csrf-{index}", user_ids[username])
                    for index, username in enumerate(user_ids)
                ],
            )
            connection.commit()

        run_alembic(env, backend_dir, "head")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT username, account_type, must_change_password, password_hash, revision "
                "FROM users ORDER BY username"
            )
            assert cursor.fetchall() == [
                ("admin", "ADMIN", False, "hash-admin", 0),
                (
                    "content_editor",
                    "ENGINEER",
                    True,
                    "content-editor-original-hash",
                    1,
                ),
            ]
            cursor.execute(
                "SELECT users.username FROM sessions "
                "JOIN users ON users.id = sessions.user_id ORDER BY users.username"
            )
            assert cursor.fetchall() == [("admin",), ("content_editor",)]


@pytest.mark.integration
def test_referenced_legacy_users_abort_the_complete_cleanup() -> None:
    """业务或审计引用必须汇总报错，并回滚全部账号与强制改密变更。"""
    with temporary_database("partsignal_cleanup_blocked") as (test_url, env, backend_dir):
        user_ids = {
            username: uuid.uuid4()
            for username in ("admin", "content_editor", *CLEANUP_USERNAMES)
        }
        run_alembic(env, backend_dir, "0009_config_center")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO users "
                "(id, username, display_name, password_hash, account_type, is_active, "
                "must_change_password, revision) "
                "VALUES (%s, %s, %s, %s, %s, true, false, %s)",
                [
                    (
                        user_id,
                        username,
                        username,
                        f"hash-{username}",
                        "ADMIN" if username == "admin" else "ENGINEER",
                        7 if username == "content_editor" else 0,
                    )
                    for username, user_id in user_ids.items()
                ],
            )
            cursor.executemany(
                "INSERT INTO sessions "
                "(id, token_hash, csrf_hash, user_id, expires_at) "
                "VALUES (%s, %s, %s, %s, now() + interval '1 day')",
                [
                    (
                        uuid.uuid4(),
                        f"blocked-token-{index}",
                        f"blocked-csrf-{index}",
                        user_ids[username],
                    )
                    for index, username in enumerate(CLEANUP_USERNAMES)
                ],
            )
            cursor.execute(
                "INSERT INTO platform_types (id, name, slug, created_by) "
                "VALUES (%s, '旧账号创建的平台', 'legacy-owner', %s)",
                (uuid.uuid4(), user_ids["product_editor"]),
            )
            cursor.execute(
                "INSERT INTO audit_logs "
                "(id, actor_id, action, target_type, target_id, details, request_id) "
                "VALUES (%s, %s, 'legacy.action', 'User', %s, '{}', 'migration-test')",
                (uuid.uuid4(), user_ids["analyst"], str(user_ids["analyst"])),
            )
            connection.commit()

        result = run_alembic(env, backend_dir, "head", check=False)
        assert result.returncode != 0
        migration_output = result.stdout + result.stderr
        assert "product_editor: platform_types.created_by" in migration_output
        assert "analyst: audit_logs.actor_id" in migration_output

        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0009_config_center",)
            cursor.execute("SELECT username FROM users ORDER BY username")
            assert [row[0] for row in cursor.fetchall()] == sorted(user_ids)
            cursor.execute("SELECT count(*) FROM sessions")
            assert cursor.fetchone() == (4,)
            cursor.execute(
                "SELECT password_hash, must_change_password, revision FROM users "
                "WHERE username = 'content_editor'"
            )
            assert cursor.fetchone() == ("hash-content_editor", False, 7)
            cursor.execute("SELECT count(*) FROM platform_types")
            assert cursor.fetchone() == (1,)
            cursor.execute("SELECT count(*) FROM audit_logs")
            assert cursor.fetchone() == (1,)
