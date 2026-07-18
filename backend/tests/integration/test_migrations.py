"""只在显式 PostgreSQL 测试环境执行的迁移与初始化集成测试。"""

from __future__ import annotations

import json
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


def generation_job_columns(test_url: str) -> set[str]:
    """读取生成作业列集合，用于证明 0011 只做 expand 迁移。"""
    with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = 'generation_jobs'"
        )
        return {row[0] for row in cursor.fetchall()}


def content_task_columns(test_url: str) -> set[str]:
    """读取内容任务列集合，用于证明 0012 不改写历史任务。"""
    with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = 'content_tasks'"
        )
        return {row[0] for row in cursor.fetchall()}


def seed_legacy_content_task(test_url: str) -> uuid.UUID:
    """在 0012 之前写入最小合法任务，验证升级不会猜测数据分级。"""
    ids = {
        name: uuid.uuid4()
        for name in (
            "user",
            "product",
            "fact",
            "topic",
            "platform_type",
            "profile",
            "profile_version",
            "task",
        )
    }
    with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO users "
            "(id, username, display_name, password_hash, account_type, is_active, "
            "must_change_password, revision) "
            "VALUES (%s, %s, '迁移用户', 'hash', 'ENGINEER', true, false, 0)",
            (ids["user"], f"migration-{ids['user'].hex[:12]}"),
        )
        cursor.execute(
            "INSERT INTO products "
            "(id, part_number, normalized_part_number, brand, normalized_brand, category, "
            "status, revision, facts_revision) "
            "VALUES (%s, %s, %s, 'TEST', 'test', 'TEST', 'ACTIVE', 0, 0)",
            (ids["product"], f"MIG-{ids['product'].hex[:12]}", ids["product"].hex),
        )
        cursor.execute(
            "INSERT INTO fact_versions "
            "(id, product_id, version, status, snapshot_json, change_summary, revision, "
            "created_by, approved_by, approved_at) "
            "VALUES (%s, %s, 1, 'APPROVED', '{}'::jsonb, '迁移事实', 0, %s, %s, now())",
            (ids["fact"], ids["product"], ids["user"], ids["user"]),
        )
        cursor.execute(
            "INSERT INTO query_topics "
            "(id, canonical_question, intent_type, variants, revision) "
            "VALUES (%s, '迁移问题', 'TEST', ARRAY['迁移'], 0)",
            (ids["topic"],),
        )
        cursor.execute(
            "INSERT INTO platform_types (id, name, slug, revision, created_by) "
            "VALUES (%s, '迁移平台', %s, 0, %s)",
            (ids["platform_type"], f"migration-{ids['platform_type'].hex[:12]}", ids["user"]),
        )
        cursor.execute(
            "INSERT INTO platform_profiles "
            "(id, name, slug, allowed_domains, platform_type_id, revision) "
            "VALUES (%s, '迁移平台', %s, ARRAY['example.invalid'], %s, 0)",
            (ids["profile"], f"profile-{ids['profile'].hex[:12]}", ids["platform_type"]),
        )
        cursor.execute(
            "INSERT INTO platform_profile_versions "
            "(id, platform_profile_id, version, status, rules, revision) "
            "VALUES (%s, %s, 1, 'ACTIVE', '{}'::jsonb, 0)",
            (ids["profile_version"], ids["profile"]),
        )
        cursor.execute(
            "INSERT INTO content_tasks "
            "(id, query_topic_id, product_id, fact_version_id, platform_profile_version_id, "
            "platform_type_id, platform_type_snapshot, user_prompt_markdown, target_audience, "
            "content_angle, conversion_goal, desired_format, desired_length_min, "
            "desired_length_max, canonical_url, status, revision, created_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, '历史 Prompt', '测试', '迁移', "
            "'迁移', 'MARKDOWN', 1, 100, 'https://example.invalid', 'OPEN', 0, %s)",
            (
                ids["task"],
                ids["topic"],
                ids["product"],
                ids["fact"],
                ids["profile_version"],
                ids["platform_type"],
                '{"name":"迁移平台","slug":"migration"}',
                ids["user"],
            ),
        )
        connection.commit()
    return ids["task"]


def seed_legacy_publication(
    test_url: str,
    task_id: uuid.UUID,
    *,
    cross_platform: bool,
    status: str = "PENDING_MANUAL_PUBLISH",
) -> uuid.UUID:
    """在 0012 Schema 写入发布记录，用于验证 0013 历史门禁与触发器。"""
    ids = {name: uuid.uuid4() for name in ("content", "profile", "account", "publication")}
    with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT content_tasks.fact_version_id, content_tasks.created_by, "
            "platform_profile_versions.platform_profile_id, content_tasks.platform_type_id "
            "FROM content_tasks JOIN platform_profile_versions ON "
            "platform_profile_versions.id = content_tasks.platform_profile_version_id "
            "WHERE content_tasks.id = %s",
            (task_id,),
        )
        fact_id, user_id, task_profile_id, platform_type_id = cursor.fetchone()
        account_profile_id = task_profile_id
        if cross_platform:
            cursor.execute(
                "INSERT INTO platform_profiles "
                "(id, name, slug, allowed_domains, platform_type_id, revision) "
                "VALUES (%s, '跨平台迁移测试', %s, ARRAY['other.example.invalid'], %s, 0)",
                (ids["profile"], f"cross-{ids['profile'].hex[:12]}", platform_type_id),
            )
            account_profile_id = ids["profile"]
        cursor.execute(
            "INSERT INTO platform_accounts "
            "(id, platform_profile_id, label, account_identifier, is_active) "
            "VALUES (%s, %s, '迁移发布账号', %s, true)",
            (ids["account"], account_profile_id, f"account-{ids['account'].hex[:12]}"),
        )
        cursor.execute(
            "INSERT INTO content_versions "
            "(id, task_id, fact_version_id, version, source_type, title, summary, "
            "body_markdown, tags, content_hash, status, revision, quality_issues, "
            "change_summary, created_by) "
            "VALUES (%s, %s, %s, 1, 'HUMAN', '迁移内容', '迁移摘要', '迁移正文', "
            "ARRAY['migration'], %s, 'APPROVED', 0, '[]'::jsonb, '迁移测试', %s)",
            (ids["content"], task_id, fact_id, "a" * 64, user_id),
        )
        cursor.execute(
            "INSERT INTO publication_records "
            "(id, idempotency_key, content_version_id, platform_account_id, section_url, "
            "status, content_hash, created_by) "
            "VALUES (%s, %s, %s, %s, 'https://example.invalid/section', %s, %s, %s)",
            (
                ids["publication"],
                f"migration-{ids['publication'].hex}",
                ids["content"],
                ids["account"],
                status,
                "a" * 64,
                user_id,
            ),
        )
        connection.commit()
    return ids["publication"]


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
                        "content_humanization_prompts",
                        "ai_channels",
                        "ai_channel_headers",
                        "ai_models",
                        "generation_jobs",
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
                "content_humanization_prompts",
                "ai_channels",
                "ai_channel_headers",
                "ai_models",
                "generation_jobs",
            }
            cursor.execute(
                "SELECT column_name, is_nullable, column_default "
                "FROM information_schema.columns "
                "WHERE table_name = 'generation_jobs' "
                "AND column_name = ANY(%s) ORDER BY column_name",
                (["dispatch_attempt_count", "last_dispatch_attempt_at"],),
            )
            assert cursor.fetchall() == [
                ("dispatch_attempt_count", "NO", "0"),
                ("last_dispatch_attempt_at", "YES", None),
            ]
            cursor.execute(
                "SELECT indexdef FROM pg_indexes "
                "WHERE tablename = 'generation_jobs' "
                "AND indexname = 'ix_generation_jobs_pending_dispatch_due'"
            )
            index_definition = cursor.fetchone()
            assert index_definition is not None
            assert "COALESCE(last_dispatch_attempt_at, created_at)" in index_definition[0]
            assert "WHERE ((status)::text = 'PENDING'::text)" in index_definition[0]
            cursor.execute("SELECT count(*) FROM content_humanization_prompts")
            assert cursor.fetchone() == (0,)
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
def test_generation_reliability_migration_is_additive_and_reversible() -> None:
    """0011 不改变旧列，降级仅移除可重建的投递诊断元数据。"""
    with temporary_database("partsignal_generation_migration") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0010_user_cleanup")
        before = generation_job_columns(test_url)

        run_alembic(env, backend_dir, "0011_generation_reliability")
        after = generation_job_columns(test_url)
        assert after - before == {
            "last_dispatch_attempt_at",
            "dispatch_attempt_count",
        }
        assert before <= after

        subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0010_user_cleanup"],
            check=True,
            env=env,
            cwd=backend_dir,
        )
        assert generation_job_columns(test_url) == before


@pytest.mark.integration
def test_ai_data_classification_migration_keeps_history_unclassified_and_reversible() -> None:
    """0012 只扩展分级字段，历史任务保持 NULL 且非法组合由数据库阻断。"""
    with temporary_database("partsignal_classification_migration") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0011_generation_reliability")
        task_id = seed_legacy_content_task(test_url)
        before = content_task_columns(test_url)

        run_alembic(env, backend_dir, "0012_ai_data_classification")
        after = content_task_columns(test_url)
        assert after - before == {
            "generation_data_classification",
            "generation_data_classified_by",
            "generation_data_classified_at",
        }
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT generation_data_classification, generation_data_classified_by, "
                "generation_data_classified_at FROM content_tasks WHERE id = %s",
                (task_id,),
            )
            assert cursor.fetchone() == (None, None, None)
            with pytest.raises(psycopg.errors.CheckViolation):
                cursor.execute(
                    "UPDATE content_tasks SET generation_data_classification = 'PUBLIC' "
                    "WHERE id = %s",
                    (task_id,),
                )
            connection.rollback()

        subprocess.run(
            [
                sys.executable,
                "-m",
                "alembic",
                "downgrade",
                "0011_generation_reliability",
            ],
            check=True,
            env=env,
            cwd=backend_dir,
        )
        assert content_task_columns(test_url) == before


@pytest.mark.integration
def test_publication_closure_migration_blocks_ambiguous_history() -> None:
    """0013 必须稳定报告旧完成态和跨平台发布，并保持迁移原子。"""
    with temporary_database("partsignal_publication_preflight") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0012_ai_data_classification")
        task_id = seed_legacy_content_task(test_url)
        publication_id = seed_legacy_publication(
            test_url,
            task_id,
            cross_platform=True,
        )
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "UPDATE content_tasks SET status = 'COMPLETED' WHERE id = %s",
                (task_id,),
            )
            connection.commit()

        preflight = subprocess.run(
            [sys.executable, "-m", "app.cli", "preflight-integrity"],
            check=False,
            env=env,
            cwd=backend_dir,
            capture_output=True,
            text=True,
        )
        assert preflight.returncode == 1
        issues = json.loads(preflight.stdout)
        assert [(item["record_id"], item["reason_code"]) for item in issues] == [
            (str(task_id), "COMPLETED_WITHOUT_VERIFIED_PUBLICATION"),
            (str(publication_id), "PUBLICATION_PLATFORM_MISMATCH"),
        ]

        result = run_alembic(env, backend_dir, "head", check=False)
        assert result.returncode != 0
        migration_output = result.stdout + result.stderr
        assert "completed_without_verified" in migration_output
        assert str(task_id) in migration_output
        assert "cross_platform_publications" in migration_output
        assert str(publication_id) in migration_output
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0012_ai_data_classification",)
            cursor.execute("SELECT to_regclass('public.publication_attentions')")
            assert cursor.fetchone() == (None,)


@pytest.mark.integration
def test_publication_closure_migration_enforces_platform_and_forward_only_history() -> None:
    """0013 允许合法历史升级，数据库拒绝错绑且新待办阻止有损降级。"""
    with temporary_database("partsignal_publication_guard") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0012_ai_data_classification")
        task_id = seed_legacy_content_task(test_url)
        publication_id = seed_legacy_publication(
            test_url,
            task_id,
            cross_platform=True,
            status="REMOVED",
        )
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT created_by FROM publication_records WHERE id = %s",
                (publication_id,),
            )
            (actor_id,) = cursor.fetchone()
            cursor.execute(
                "INSERT INTO publication_status_events "
                "(id, publication_id, status, comment, actor_id) "
                "VALUES (%s, %s, 'VERIFIED', '历史验证成功', %s)",
                (uuid.uuid4(), publication_id, actor_id),
            )
            cursor.execute(
                "UPDATE content_tasks SET status = 'COMPLETED' WHERE id = %s",
                (task_id,),
            )
            connection.commit()
        run_alembic(env, backend_dir, "0013_publication_closure")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT content_versions.id, publication_records.created_by, "
                "content_tasks.platform_type_id "
                "FROM publication_records "
                "JOIN content_versions ON content_versions.id = "
                "publication_records.content_version_id "
                "JOIN content_tasks ON content_tasks.id = content_versions.task_id "
                "WHERE publication_records.id = %s",
                (publication_id,),
            )
            content_id, user_id, platform_type_id = cursor.fetchone()
            other_profile_id = uuid.uuid4()
            other_account_id = uuid.uuid4()
            cursor.execute(
                "INSERT INTO platform_profiles "
                "(id, name, slug, allowed_domains, platform_type_id, revision) "
                "VALUES (%s, '数据库错绑测试', %s, ARRAY['wrong.example.invalid'], %s, 0)",
                (
                    other_profile_id,
                    f"wrong-{other_profile_id.hex[:12]}",
                    platform_type_id,
                ),
            )
            cursor.execute(
                "INSERT INTO platform_accounts "
                "(id, platform_profile_id, label, account_identifier, is_active) "
                "VALUES (%s, %s, '错绑账号', %s, true)",
                (
                    other_account_id,
                    other_profile_id,
                    f"wrong-{other_account_id.hex[:12]}",
                ),
            )
            with pytest.raises(psycopg.errors.CheckViolation):
                cursor.execute(
                    "INSERT INTO publication_records "
                    "(id, idempotency_key, content_version_id, platform_account_id, section_url, "
                    "status, content_hash, created_by) "
                    "VALUES (%s, %s, %s, %s, 'https://wrong.example.invalid', "
                    "'PENDING_MANUAL_PUBLISH', %s, %s)",
                    (
                        uuid.uuid4(),
                        f"wrong-{uuid.uuid4().hex}",
                        content_id,
                        other_account_id,
                        "a" * 64,
                        user_id,
                    ),
                )
            connection.rollback()
            with pytest.raises(psycopg.errors.CheckViolation):
                cursor.execute(
                    "INSERT INTO publication_attentions "
                    "(id, publication_record_id, trigger_status, status, revision, "
                    "resolved_at, resolved_by, resolution_comment) "
                    "VALUES (%s, %s, 'REMOVED', 'RESOLVED', 1, now(), %s, '绕过显式命令')",
                    (uuid.uuid4(), publication_id, user_id),
                )
            connection.rollback()
            attention_id = uuid.uuid4()
            cursor.execute(
                "INSERT INTO publication_attentions "
                "(id, publication_record_id, trigger_status, status, revision) "
                "VALUES (%s, %s, 'REMOVED', 'OPEN', 0)",
                (attention_id, publication_id),
            )
            connection.commit()
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "DELETE FROM publication_attentions WHERE id = %s",
                    (attention_id,),
                )
            connection.rollback()

        downgrade = subprocess.run(
            [
                sys.executable,
                "-m",
                "alembic",
                "downgrade",
                "0012_ai_data_classification",
            ],
            check=False,
            env=env,
            cwd=backend_dir,
            capture_output=True,
            text=True,
        )
        assert downgrade.returncode != 0
        assert "只允许前滚" in downgrade.stdout + downgrade.stderr
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0013_publication_closure",)
            cursor.execute(
                "SELECT status FROM publication_attentions WHERE id = %s",
                (attention_id,),
            )
            assert cursor.fetchone() == ("OPEN",)


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
            username: uuid.uuid4() for username in ("admin", "content_editor", *CLEANUP_USERNAMES)
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
            username: uuid.uuid4() for username in ("admin", "content_editor", *CLEANUP_USERNAMES)
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


@pytest.mark.integration
def test_platform_prompts_move_from_type_to_each_profile() -> None:
    """0014 为每个具体平台复制当前 Prompt，并丢弃没有平台的孤立 Prompt。"""
    with temporary_database("partsignal_prompt_ownership") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "0013_publication_closure")
        seed_accounts(env, backend_dir)
        owner_type, orphan_type = uuid.uuid4(), uuid.uuid4()
        first_profile, second_profile = uuid.uuid4(), uuid.uuid4()
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = 'admin'")
            admin_id = cursor.fetchone()[0]
            cursor.executemany(
                "INSERT INTO platform_types (id, name, slug, created_by) VALUES (%s, %s, %s, %s)",
                [
                    (owner_type, "技术社区", "technical-community", admin_id),
                    (orphan_type, "孤立类型", "orphan-type", admin_id),
                ],
            )
            cursor.executemany(
                "INSERT INTO platform_profiles "
                "(id, name, slug, allowed_domains, platform_type_id) "
                "VALUES (%s, %s, %s, %s, %s)",
                [
                    (first_profile, "平台甲", "platform-a", ["a.example"], owner_type),
                    (second_profile, "平台乙", "platform-b", ["b.example"], owner_type),
                ],
            )
            cursor.executemany(
                "INSERT INTO platform_prompts "
                "(platform_type_id, template_markdown, updated_by) VALUES (%s, %s, %s)",
                [
                    (owner_type, "共享旧 Prompt", admin_id),
                    (orphan_type, "应删除的孤立 Prompt", admin_id),
                ],
            )
            connection.commit()

        run_alembic(env, backend_dir, "head")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT platform_profile_id, template_markdown FROM platform_prompts "
                "ORDER BY platform_profile_id"
            )
            assert set(cursor.fetchall()) == {
                (first_profile, "共享旧 Prompt"),
                (second_profile, "共享旧 Prompt"),
            }
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'platform_prompts' ORDER BY column_name"
            )
            columns = {row[0] for row in cursor.fetchall()}
            assert "platform_profile_id" in columns
            assert "platform_type_id" not in columns
            with pytest.raises(psycopg.errors.UniqueViolation):
                cursor.execute(
                    "INSERT INTO platform_prompts "
                    "(platform_profile_id, template_markdown, updated_by) VALUES (%s, %s, %s)",
                    (first_profile, "重复 Prompt", admin_id),
                )
            connection.rollback()


@pytest.mark.integration
def test_platform_rule_draft_editing_guard() -> None:
    """0015 仅允许 DRAFT 原地更新规则，并可恢复旧触发器。"""
    with temporary_database("partsignal_rule_draft") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "0014_platform_prompt_ownership")
        seed_accounts(env, backend_dir)
        platform_type_id = uuid.uuid4()
        profile_id, other_profile_id = uuid.uuid4(), uuid.uuid4()
        draft_id, active_id, retired_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = 'admin'")
            admin_id = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO platform_types (id, name, slug, created_by) "
                "VALUES (%s, '规则迁移类型', 'rule-migration', %s)",
                (platform_type_id, admin_id),
            )
            cursor.executemany(
                "INSERT INTO platform_profiles "
                "(id, name, slug, allowed_domains, platform_type_id) "
                "VALUES (%s, %s, %s, ARRAY['example.invalid'], %s)",
                [
                    (profile_id, "规则迁移平台", "rule-migration", platform_type_id),
                    (other_profile_id, "其他平台", "rule-migration-other", platform_type_id),
                ],
            )
            cursor.executemany(
                "INSERT INTO platform_profile_versions "
                "(id, platform_profile_id, version, status, rules, revision) "
                "VALUES (%s, %s, %s, %s, %s::jsonb, 0)",
                [
                    (draft_id, profile_id, 1, "DRAFT", '{"body_max":100}'),
                    (active_id, profile_id, 2, "ACTIVE", '{"body_max":200}'),
                    (retired_id, profile_id, 3, "RETIRED", '{"body_max":300}'),
                ],
            )
            connection.commit()

            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "UPDATE platform_profile_versions SET rules = '{\"body_max\":150}'::jsonb "
                    "WHERE id = %s",
                    (draft_id,),
                )
            connection.rollback()

        run_alembic(env, backend_dir, "head")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "UPDATE platform_profile_versions "
                "SET rules = '{\"body_max\":150}'::jsonb, revision = revision + 1 "
                "WHERE id = %s",
                (draft_id,),
            )
            connection.commit()
            cursor.execute(
                "SELECT rules ->> 'body_max', revision FROM platform_profile_versions "
                "WHERE id = %s",
                (draft_id,),
            )
            assert cursor.fetchone() == ("150", 1)

            for frozen_id in (active_id, retired_id):
                with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                    cursor.execute(
                        "UPDATE platform_profile_versions "
                        "SET rules = '{\"body_max\":999}'::jsonb WHERE id = %s",
                        (frozen_id,),
                    )
                connection.rollback()

            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "UPDATE platform_profile_versions "
                    "SET platform_profile_id = %s, version = 9, created_at = now() "
                    "WHERE id = %s",
                    (other_profile_id, draft_id),
                )
            connection.rollback()
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "UPDATE platform_profile_versions "
                    "SET status = 'ACTIVE', rules = '{\"body_max\":400}'::jsonb "
                    "WHERE id = %s",
                    (draft_id,),
                )
            connection.rollback()

        subprocess.run(
            [
                sys.executable,
                "-m",
                "alembic",
                "downgrade",
                "0014_platform_prompt_ownership",
            ],
            check=True,
            env=env,
            cwd=backend_dir,
        )
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "UPDATE platform_profile_versions SET rules = '{\"body_max\":175}'::jsonb "
                    "WHERE id = %s",
                    (draft_id,),
                )
            connection.rollback()
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0014_platform_prompt_ownership",)


@pytest.mark.integration
def test_fact_review_cleanup_guard() -> None:
    """0016 仅按事务本地父版本 ID 放行从属审核记录删除。"""
    with temporary_database("partsignal_fact_review_cleanup") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0015_platform_rule_draft_editing")
        seed_accounts(env, backend_dir)
        product_id = uuid.uuid4()
        first_fact_id, second_fact_id = uuid.uuid4(), uuid.uuid4()
        first_review_id, second_review_id = uuid.uuid4(), uuid.uuid4()
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = 'admin'")
            admin_id = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO products "
                "(id, part_number, normalized_part_number, brand, normalized_brand, category, "
                "status, revision, facts_revision) "
                "VALUES (%s, 'REVIEW-CLEANUP', 'review-cleanup', 'TEST', 'test', 'TEST', "
                "'ACTIVE', 0, 0)",
                (product_id,),
            )
            cursor.executemany(
                "INSERT INTO fact_versions "
                "(id, product_id, version, status, snapshot_json, change_summary, revision, "
                "created_by) "
                "VALUES (%s, %s, %s, 'DRAFT', '{}'::jsonb, '迁移测试', 0, %s)",
                [
                    (first_fact_id, product_id, 1, admin_id),
                    (second_fact_id, product_id, 2, admin_id),
                ],
            )
            cursor.executemany(
                "INSERT INTO fact_review_records "
                "(id, fact_version_id, action, comment, actor_id) "
                "VALUES (%s, %s, 'TEST', '迁移测试审核', %s)",
                [
                    (first_review_id, first_fact_id, admin_id),
                    (second_review_id, second_fact_id, admin_id),
                ],
            )
            connection.commit()

            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "DELETE FROM fact_review_records WHERE id = %s",
                    (first_review_id,),
                )
            connection.rollback()

        run_alembic(env, backend_dir, "head")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "DELETE FROM fact_review_records WHERE id = %s",
                    (first_review_id,),
                )
            connection.rollback()

            cursor.execute(
                "SELECT set_config('partsignal.fact_version_delete_id', %s, true)",
                (str(first_fact_id),),
            )
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "DELETE FROM fact_review_records WHERE id = %s",
                    (second_review_id,),
                )
            connection.rollback()

            cursor.execute(
                "SELECT set_config('partsignal.fact_version_delete_id', %s, true)",
                (str(first_fact_id),),
            )
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "UPDATE fact_review_records SET comment = '禁止修改' WHERE id = %s",
                    (first_review_id,),
                )
            connection.rollback()

            cursor.execute(
                "SELECT set_config('partsignal.fact_version_delete_id', %s, true)",
                (str(first_fact_id),),
            )
            cursor.execute(
                "DELETE FROM fact_review_records WHERE id = %s",
                (first_review_id,),
            )
            connection.commit()
            cursor.execute(
                "SELECT count(*) FROM fact_review_records WHERE id = %s",
                (first_review_id,),
            )
            assert cursor.fetchone() == (0,)
            replacement_review_id = uuid.uuid4()
            cursor.execute(
                "INSERT INTO fact_review_records "
                "(id, fact_version_id, action, comment, actor_id) "
                "VALUES (%s, %s, 'TEST', '降级验证审核', %s)",
                (replacement_review_id, first_fact_id, admin_id),
            )
            connection.commit()

        subprocess.run(
            [
                sys.executable,
                "-m",
                "alembic",
                "downgrade",
                "0015_platform_rule_draft_editing",
            ],
            check=True,
            env=env,
            cwd=backend_dir,
        )
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT set_config('partsignal.fact_version_delete_id', %s, true)",
                (str(first_fact_id),),
            )
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "DELETE FROM fact_review_records WHERE id = %s",
                    (replacement_review_id,),
                )
            connection.rollback()
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0015_platform_rule_draft_editing",)


@pytest.mark.integration
def test_content_humanization_migration_constraints_and_forward_only_history() -> None:
    """0017 不预置 Prompt，并保护作业类型、活动唯一性和历史可读性。"""
    with temporary_database("partsignal_humanization") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "0016_fact_review_cleanup")
        task_id = seed_legacy_content_task(test_url)
        generation_job_id = uuid.uuid4()
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT created_by FROM content_tasks WHERE id = %s", (task_id,))
            user_id = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO generation_jobs "
                "(id, content_task_id, idempotency_key, status, input_snapshot, adapter_name, "
                "prompt_template_version, prompt_hash, attempt_count, created_by) "
                "VALUES (%s, %s, %s, 'SUCCEEDED', '{}'::jsonb, 'legacy', 'legacy', %s, 1, %s)",
                (generation_job_id, task_id, f"legacy-{generation_job_id.hex}", "0" * 64, user_id),
            )
            connection.commit()

        run_alembic(env, backend_dir, "head")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM content_humanization_prompts")
            assert cursor.fetchone() == (0,)
            cursor.execute(
                "SELECT job_type, source_content_version_id FROM generation_jobs WHERE id = %s",
                (generation_job_id,),
            )
            assert cursor.fetchone() == ("GENERATE", None)
            cursor.execute(
                "SELECT column_default FROM information_schema.columns "
                "WHERE table_name = 'generation_jobs' AND column_name = 'job_type'"
            )
            assert cursor.fetchone() == (None,)

        subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0016_fact_review_cleanup"],
            check=True,
            env=env,
            cwd=backend_dir,
        )
        run_alembic(env, backend_dir, "head")

        source_id = uuid.uuid4()
        humanization_job_id = uuid.uuid4()
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT fact_version_id, created_by FROM content_tasks WHERE id = %s",
                (task_id,),
            )
            fact_id, user_id = cursor.fetchone()
            cursor.execute(
                "INSERT INTO content_versions "
                "(id, task_id, fact_version_id, source_job_id, version, source_type, title, "
                "summary, body_markdown, tags, content_hash, status, revision, quality_issues, "
                "change_summary, created_by) "
                "VALUES (%s, %s, %s, %s, 1, 'AI', '源文章', '摘要', '正文', ARRAY['test'], "
                "%s, 'DRAFT', 0, '[]'::jsonb, '原始生成', %s)",
                (source_id, task_id, fact_id, generation_job_id, "1" * 64, user_id),
            )
            cursor.execute(
                "UPDATE generation_jobs SET content_version_id = %s WHERE id = %s",
                (source_id, generation_job_id),
            )
            cursor.execute(
                "INSERT INTO generation_jobs "
                "(id, content_task_id, idempotency_key, job_type, source_content_version_id, "
                "status, input_snapshot, adapter_name, prompt_template_version, prompt_hash, "
                "attempt_count, created_by) "
                "VALUES (%s, %s, %s, 'HUMANIZE', %s, 'PENDING', '{}'::jsonb, 'test', "
                "'humanization-json-v1', %s, 0, %s)",
                (
                    humanization_job_id,
                    task_id,
                    f"humanize-{humanization_job_id.hex}",
                    source_id,
                    "2" * 64,
                    user_id,
                ),
            )
            connection.commit()

            with pytest.raises(psycopg.errors.UniqueViolation):
                cursor.execute(
                    "INSERT INTO generation_jobs "
                    "(id, content_task_id, idempotency_key, job_type, source_content_version_id, "
                    "status, input_snapshot, adapter_name, prompt_template_version, prompt_hash, "
                    "attempt_count, created_by) "
                    "VALUES (%s, %s, %s, 'HUMANIZE', %s, 'RUNNING', '{}'::jsonb, 'test', "
                    "'humanization-json-v1', %s, 0, %s)",
                    (
                        uuid.uuid4(),
                        task_id,
                        f"duplicate-{uuid.uuid4().hex}",
                        source_id,
                        "3" * 64,
                        user_id,
                    ),
                )
            connection.rollback()

            with pytest.raises(psycopg.errors.CheckViolation):
                cursor.execute(
                    "INSERT INTO generation_jobs "
                    "(id, content_task_id, idempotency_key, job_type, status, input_snapshot, "
                    "adapter_name, prompt_template_version, prompt_hash, attempt_count, "
                    "created_by) "
                    "VALUES (%s, %s, %s, 'HUMANIZE', 'FAILED', '{}'::jsonb, 'test', "
                    "'humanization-json-v1', %s, 0, %s)",
                    (uuid.uuid4(), task_id, f"invalid-{uuid.uuid4().hex}", "4" * 64, user_id),
                )
            connection.rollback()

        downgrade = subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0016_fact_review_cleanup"],
            check=False,
            env=env,
            cwd=backend_dir,
            capture_output=True,
            text=True,
        )
        assert downgrade.returncode != 0
        assert "content humanization history exists" in downgrade.stderr
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0019_product_driven_tasks",)
            cursor.execute(
                "SELECT job_type FROM generation_jobs WHERE id = %s",
                (humanization_job_id,),
            )
            assert cursor.fetchone() == ("HUMANIZE",)


@pytest.mark.integration
def test_manual_geo_migration_preserves_legacy_history_and_blocks_lossy_downgrade() -> None:
    """0018 只标记旧观测；产生人工观测后整个降级事务必须回滚。"""
    with temporary_database("partsignal_manual_geo") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "0017_content_humanization")
        task_id = seed_legacy_content_task(test_url)
        legacy_observation_id = uuid.uuid4()
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT product_id, query_topic_id, created_by FROM content_tasks WHERE id = %s",
                (task_id,),
            )
            product_id, query_topic_id, user_id = cursor.fetchone()
            cursor.execute(
                "INSERT INTO geo_observations "
                "(id, query_topic_id, product_id, actual_prompt, model_name, tested_at, "
                "web_search_enabled, answer_summary, mentioned, recommendation, accuracy, "
                "notes, tested_by) "
                "VALUES (%s, %s, %s, '旧观测问题', 'legacy-model', now(), true, "
                "'旧回答', true, 'RECOMMENDED', 'ACCURATE', '历史记录', %s)",
                (legacy_observation_id, query_topic_id, product_id, user_id),
            )
            connection.commit()

        run_alembic(env, backend_dir, "head")
        manual_observation_id = uuid.uuid4()
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT observation_kind, search_platform, search_query "
                "FROM geo_observations WHERE id = %s",
                (legacy_observation_id,),
            )
            assert cursor.fetchone() == ("LEGACY_MODEL_RESULT", None, None)
            cursor.execute(
                "INSERT INTO geo_observations "
                "(id, observation_kind, product_id, search_platform, search_query, tested_at, "
                "notes, tested_by) "
                "VALUES (%s, 'MANUAL_ARTICLE_SEARCH', %s, 'DeepSeek', '人工搜索词', "
                "now(), '人工观测', %s)",
                (manual_observation_id, product_id, user_id),
            )
            connection.commit()

        downgrade = subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0017_content_humanization"],
            check=False,
            env=env,
            cwd=backend_dir,
            capture_output=True,
            text=True,
        )
        assert downgrade.returncode != 0
        assert "manual GEO observation history exists" in downgrade.stderr
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0019_product_driven_tasks",)
            cursor.execute(
                "SELECT count(*) FROM geo_observations WHERE id IN (%s, %s)",
                (legacy_observation_id, manual_observation_id),
            )
            assert cursor.fetchone() == (2,)


@pytest.mark.integration
def test_product_driven_task_migration_preserves_history_and_blocks_lossy_downgrade() -> None:
    """0019 保留历史关联，并在新任务存在时拒绝恢复目标问题必填。"""
    with temporary_database("partsignal_product_tasks") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "0018_manual_geo_observation")
        legacy_task_id = seed_legacy_content_task(test_url)
        run_alembic(env, backend_dir, "head")

        product_task_id = uuid.uuid4()
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT query_topic_id, product_id, fact_version_id, "
                "platform_profile_version_id, platform_type_id, platform_type_snapshot, "
                "created_by FROM content_tasks WHERE id = %s",
                (legacy_task_id,),
            )
            (
                legacy_topic_id,
                product_id,
                fact_id,
                platform_version_id,
                platform_type_id,
                platform_type_snapshot,
                user_id,
            ) = cursor.fetchone()
            assert legacy_topic_id is not None
            cursor.execute(
                "INSERT INTO content_tasks "
                "(id, query_topic_id, product_id, fact_version_id, platform_profile_version_id, "
                "platform_type_id, platform_type_snapshot, user_prompt_markdown, target_audience, "
                "content_angle, conversion_goal, desired_format, desired_length_min, "
                "desired_length_max, canonical_url, status, revision, created_by) "
                "VALUES (%s, NULL, %s, %s, %s, %s, %s::jsonb, '', '产品工程师', '产品说明', "
                "'查看资料', 'MARKDOWN', 1, 100, 'https://example.invalid/product', "
                "'OPEN', 0, %s)",
                (
                    product_task_id,
                    product_id,
                    fact_id,
                    platform_version_id,
                    platform_type_id,
                    json.dumps(platform_type_snapshot),
                    user_id,
                ),
            )
            connection.commit()

        downgrade = subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0018_manual_geo_observation"],
            check=False,
            env=env,
            cwd=backend_dir,
            capture_output=True,
            text=True,
        )
        assert downgrade.returncode != 0
        assert "product-driven content task history exists" in downgrade.stderr
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0019_product_driven_tasks",)
            cursor.execute(
                "SELECT query_topic_id FROM content_tasks WHERE id IN (%s, %s) ORDER BY id",
                (legacy_task_id, product_task_id),
            )
            values = {row[0] for row in cursor.fetchall()}
            assert values == {legacy_topic_id, None}
