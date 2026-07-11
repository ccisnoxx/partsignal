"""只在显式 PostgreSQL 测试环境执行的迁移集成测试。"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from psycopg import sql


def psycopg_url(value: str) -> str:
    """将 SQLAlchemy psycopg URL 转为驱动可直接连接的 URL。"""
    return value.replace("postgresql+psycopg://", "postgresql://", 1)


def replace_database(value: str, database_name: str) -> str:
    """保持主机和凭据不变，仅切换数据库名。"""
    parts = urlsplit(psycopg_url(value))
    return urlunsplit(
        (parts.scheme, parts.netloc, f"/{database_name}", parts.query, parts.fragment)
    )


@pytest.mark.integration
def test_fresh_postgresql_migrates_to_head() -> None:
    """创建一次性空库，迁移到 head 并验证种子账号和关键触发器。"""
    source_url = os.getenv("PARTSIGNAL_TEST_DATABASE_URL")
    if source_url is None and os.getenv("APP_ENV") == "test":
        source_url = os.getenv("DATABASE_URL")
    if not source_url:
        pytest.skip("未设置 PostgreSQL 测试环境，不以 SQLite 替代 PostgreSQL")
    test_database = f"partsignal_test_{uuid.uuid4().hex[:10]}"
    with psycopg.connect(psycopg_url(source_url), autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(test_database)))
    test_url = replace_database(source_url, test_database)
    sqlalchemy_url = test_url.replace("postgresql://", "postgresql+psycopg://", 1)
    env = {**os.environ, "DATABASE_URL": sqlalchemy_url}
    backend_dir = Path(__file__).resolve().parents[2]
    try:
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            check=True,
            env=env,
            cwd=backend_dir,
        )
        subprocess.run(
            [
                sys.executable,
                "-m",
                "app.cli",
                "seed-demo",
                "--password",
                "integration-test-only",
            ],
            check=True,
            env=env,
            cwd=backend_dir,
        )
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
            cursor.execute("SELECT count(*) FROM users")
            assert cursor.fetchone() == (1,)
            cursor.execute("SELECT account_type, must_change_password FROM users")
            assert cursor.fetchone() == ("ADMIN", False)
            cursor.execute(
                "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' "
                "AND tablename IN ('roles', 'user_roles')"
            )
            assert cursor.fetchone() == (0,)
    finally:
        with psycopg.connect(psycopg_url(source_url), autocommit=True) as admin:
            admin.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(test_database))
            )


@pytest.mark.integration
def test_existing_role_users_migrate_to_account_types() -> None:
    """从 0008 真实角色数据升级，验证权限映射且不保留第二权限源。"""
    source_url = os.getenv("PARTSIGNAL_TEST_DATABASE_URL")
    if source_url is None and os.getenv("APP_ENV") == "test":
        source_url = os.getenv("DATABASE_URL")
    if not source_url:
        pytest.skip("未设置 PostgreSQL 测试环境，不以 SQLite 替代 PostgreSQL")
    test_database = f"partsignal_migration_{uuid.uuid4().hex[:10]}"
    with psycopg.connect(psycopg_url(source_url), autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(test_database)))
    test_url = replace_database(source_url, test_database)
    sqlalchemy_url = test_url.replace("postgresql://", "postgresql+psycopg://", 1)
    env = {**os.environ, "DATABASE_URL": sqlalchemy_url}
    backend_dir = Path(__file__).resolve().parents[2]
    admin_id = uuid.uuid4()
    engineer_id = uuid.uuid4()
    platform_id = uuid.uuid4()
    try:
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "0008_files"],
            check=True,
            env=env,
            cwd=backend_dir,
        )
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
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            check=True,
            env=env,
            cwd=backend_dir,
        )
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
    finally:
        with psycopg.connect(psycopg_url(source_url), autocommit=True) as admin:
            admin.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(test_database))
            )
