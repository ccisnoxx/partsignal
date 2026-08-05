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
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0036_remove_section_url",)
            cursor.execute(
                "SELECT tablename FROM pg_tables "
                "WHERE schemaname = 'public' AND tablename = ANY(%s)",
                (
                    [
                        "fact_versions",
                        "content_versions",
                        "publication_works",
                        "publication_work_events",
                        "publication_verifications",
                        "published_articles",
                        "published_content_issues",
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
                "publication_works",
                "publication_work_events",
                "publication_verifications",
                "published_articles",
                "published_content_issues",
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
                        "content_tasks_platform_guard",
                        "content_versions_guard",
                        "publication_works_guard",
                    ],
                ),
            )
            assert {row[0] for row in cursor.fetchall()} == {
                "fact_versions_guard",
                "content_tasks_platform_guard",
                "content_versions_guard",
                "publication_works_guard",
            }
            cursor.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public' "
                "AND tablename = ANY(%s)",
                (
                    [
                        "reference_parts",
                        "evidences",
                        "part_parameters",
                        "replacement_relations",
                        "fact_claims",
                        "parameter_evidence_links",
                        "replacement_evidence_links",
                        "claim_evidence_links",
                        "platform_profile_versions",
                        "publication_records",
                        "publication_status_events",
                        "publication_attentions",
                    ],
                ),
            )
            assert cursor.fetchall() == []
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

        downgrade = subprocess.run(
            [
                sys.executable,
                "-m",
                "alembic",
                "downgrade",
                "0033_task_owned_history_delete",
            ],
            check=False,
            env=env,
            cwd=backend_dir,
            capture_output=True,
            text=True,
        )
        assert downgrade.returncode != 0
        assert "0036 无法安全降级" in downgrade.stdout + downgrade.stderr
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0036_remove_section_url",)


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
    """历史 0013 直接迁移仍稳定报告歧义数据并保持原子。"""
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

        run_alembic(env, backend_dir, "0014_platform_prompt_ownership")
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

        run_alembic(env, backend_dir, "0015_platform_rule_draft_editing")
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

        run_alembic(env, backend_dir, "0016_fact_review_cleanup")
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

        run_alembic(env, backend_dir, "0017_content_humanization")
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
        run_alembic(env, backend_dir, "0019_product_driven_tasks")

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

        run_alembic(env, backend_dir, "0018_manual_geo_observation")
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
            assert cursor.fetchone() == ("0018_manual_geo_observation",)
            cursor.execute(
                "SELECT count(*) FROM geo_observations WHERE id IN (%s, %s)",
                (legacy_observation_id, manual_observation_id),
            )
            assert cursor.fetchone() == (2,)


@pytest.mark.integration
def test_geo_insight_migration_preserves_unknown_history_and_enforces_new_stages() -> None:
    """0022 保留历史空值，并拒绝缺问题主题或违反累计阶段的新事实。"""
    with temporary_database("partsignal_geo_insights") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "0021_ai_channel_model_management")
        task_id = seed_legacy_content_task(test_url)
        publication_id = seed_legacy_publication(
            test_url,
            task_id,
            cross_platform=False,
        )
        old_observation_id = uuid.uuid4()
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT product_id, query_topic_id, created_by FROM content_tasks WHERE id = %s",
                (task_id,),
            )
            product_id, query_topic_id, user_id = cursor.fetchone()
            cursor.execute(
                "UPDATE publication_records SET status = 'PLATFORM_REVIEW' WHERE id = %s",
                (publication_id,),
            )
            cursor.execute(
                "UPDATE publication_records SET status = 'PUBLISHED', "
                "actual_title = '历史 GEO 内容', "
                "final_url = 'https://example.invalid/geo-history', published_at = now() "
                "WHERE id = %s",
                (publication_id,),
            )
            cursor.execute(
                "INSERT INTO geo_observations "
                "(id, observation_kind, product_id, search_platform, search_query, tested_at, "
                "notes, tested_by) VALUES "
                "(%s, 'MANUAL_ARTICLE_SEARCH', %s, 'DeepSeek', '历史人工搜索', now(), "
                "'补采前历史', %s)",
                (old_observation_id, product_id, user_id),
            )
            cursor.execute(
                "INSERT INTO geo_observation_publications "
                "(observation_id, publication_record_id, recommendation_status) "
                "VALUES (%s, %s, 'NOT_RECOMMENDED')",
                (old_observation_id, publication_id),
            )
            connection.commit()

        run_alembic(env, backend_dir, "0022_geo_observation_insights")
        new_observation_id = uuid.uuid4()
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0022_geo_observation_insights",)
            cursor.execute(
                "SELECT observation.query_topic_id, relation.discovered, relation.mentioned, "
                "relation.cited, relation.accuracy "
                "FROM geo_observations observation "
                "JOIN geo_observation_publications relation "
                "ON relation.observation_id = observation.id WHERE observation.id = %s",
                (old_observation_id,),
            )
            assert cursor.fetchone() == (None, None, None, None, None)

            with pytest.raises(psycopg.errors.CheckViolation):
                cursor.execute(
                    "INSERT INTO geo_observations "
                    "(id, observation_kind, product_id, search_platform, search_query, "
                    "tested_at, notes, tested_by) VALUES "
                    "(%s, 'MANUAL_ARTICLE_SEARCH', %s, 'DeepSeek', '缺少问题主题', "
                    "now(), '非法新观测', %s)",
                    (uuid.uuid4(), product_id, user_id),
                )
            connection.rollback()

            cursor.execute(
                "INSERT INTO geo_observations "
                "(id, observation_kind, query_topic_id, product_id, search_platform, "
                "search_query, tested_at, notes, tested_by) VALUES "
                "(%s, 'MANUAL_ARTICLE_SEARCH', %s, %s, 'DeepSeek', '完整新观测', "
                "now(), '迁移后事实', %s)",
                (new_observation_id, query_topic_id, product_id, user_id),
            )
            connection.commit()

            with pytest.raises(psycopg.errors.CheckViolation):
                cursor.execute(
                    "INSERT INTO geo_observation_publications "
                    "(observation_id, publication_record_id, recommendation_status, "
                    "discovered, mentioned, cited, accuracy) VALUES "
                    "(%s, %s, 'RECOMMENDED', true, false, false, 'UNJUDGEABLE')",
                    (new_observation_id, publication_id),
                )
            connection.rollback()

            cursor.execute(
                "INSERT INTO geo_observation_publications "
                "(observation_id, publication_record_id, recommendation_status, "
                "discovered, mentioned, cited, accuracy) VALUES "
                "(%s, %s, 'RECOMMENDED', true, true, true, 'ACCURATE')",
                (new_observation_id, publication_id),
            )
            connection.commit()

        downgrade = subprocess.run(
            [
                sys.executable,
                "-m",
                "alembic",
                "downgrade",
                "0021_ai_channel_model_management",
            ],
            check=False,
            env=env,
            cwd=backend_dir,
            capture_output=True,
            text=True,
        )
        assert downgrade.returncode != 0
        assert "GEO insight facts exist; downgrade is forbidden" in downgrade.stderr
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0022_geo_observation_insights",)


@pytest.mark.integration
def test_product_driven_task_migration_preserves_history_and_blocks_lossy_downgrade() -> None:
    """0019 保留历史关联，并在新任务存在时拒绝恢复目标问题必填。"""
    with temporary_database("partsignal_product_tasks") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "0018_manual_geo_observation")
        legacy_task_id = seed_legacy_content_task(test_url)
        run_alembic(env, backend_dir, "0019_product_driven_tasks")

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


@pytest.mark.integration
def test_platform_branding_migration_enforces_single_source_and_blocks_lossy_downgrade() -> None:
    """0020 约束 Logo 单一来源，并在品牌数据存在时拒绝删除字段。"""
    with temporary_database("partsignal_platform_branding") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "0019_product_driven_tasks")
        seed_legacy_content_task(test_url)
        run_alembic(env, backend_dir, "0020_platform_branding_task_list")

        logo_file_id = uuid.uuid4()
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT created_by FROM platform_types LIMIT 1")
            uploader_id = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO file_records "
                "(id, category, original_filename, object_key, content_type, size, sha256, "
                "access_level, status, uploader_id, upload_expires_at) "
                "VALUES (%s, 'PLATFORM_LOGO', 'logo.webp', %s, 'image/webp', 10, %s, "
                "'PUBLIC', 'VERIFIED', %s, now())",
                (logo_file_id, f"test/platform-logo/{logo_file_id}.webp", "a" * 64, uploader_id),
            )
            connection.commit()
            with pytest.raises(psycopg.errors.CheckViolation):
                cursor.execute(
                    "UPDATE platform_profiles SET logo_file_id = %s, "
                    "logo_external_url = 'https://cdn.example.invalid/logo.webp'",
                    (logo_file_id,),
                )
            connection.rollback()
            cursor.execute(
                "UPDATE platform_profiles SET website_url = "
                "'https://platform.example.invalid', logo_external_url = "
                "'https://cdn.example.invalid/logo.webp'"
            )
            connection.commit()

        downgrade = subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0019_product_driven_tasks"],
            check=False,
            env=env,
            cwd=backend_dir,
            capture_output=True,
            text=True,
        )
        assert downgrade.returncode != 0
        assert "platform branding data exists" in downgrade.stderr

        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "UPDATE platform_profiles SET website_url = NULL, logo_external_url = NULL"
            )
            connection.commit()
        run_alembic(env, backend_dir, "0019_product_driven_tasks")


@pytest.mark.integration
def test_platform_management_migration_backfills_status_indexes_and_downgrades() -> None:
    """0023 回填启用状态并增加真实查询索引，降级会移除该状态。"""
    with temporary_database("partsignal_platform_management") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "0022_geo_observation_insights")
        task_id = seed_legacy_content_task(test_url)

        run_alembic(env, backend_dir, "0023_platform_management")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT profile.is_active FROM platform_profiles profile "
                "JOIN platform_profile_versions version "
                "ON version.platform_profile_id = profile.id "
                "JOIN content_tasks task ON task.platform_profile_version_id = version.id "
                "WHERE task.id = %s",
                (task_id,),
            )
            assert cursor.fetchone() == (True,)
            cursor.execute(
                "SELECT indexname, indexdef FROM pg_indexes "
                "WHERE indexname = ANY(%s) ORDER BY indexname",
                (
                    [
                        "ix_audit_logs_target_created_at",
                        "ix_content_tasks_platform_profile_version_created_at",
                        "ix_platform_accounts_platform_profile_active",
                    ],
                ),
            )
            indexes = dict(cursor.fetchall())
            assert set(indexes) == {
                "ix_audit_logs_target_created_at",
                "ix_content_tasks_platform_profile_version_created_at",
                "ix_platform_accounts_platform_profile_active",
            }
            assert "created_at DESC" in indexes["ix_audit_logs_target_created_at"]

        subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0022_geo_observation_insights"],
            check=True,
            env=env,
            cwd=backend_dir,
        )
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM information_schema.columns "
                "WHERE table_name = 'platform_profiles' AND column_name = 'is_active'"
            )
            assert cursor.fetchone() == (0,)


@pytest.mark.integration
def test_audit_outcome_migration_backfills_exact_results_and_blocks_lossy_downgrade() -> None:
    """0024 精确分类历史结果，并在空对象标识存在时拒绝有损降级。"""
    with temporary_database("partsignal_audit_outcome") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "0023_platform_management")
        seed_accounts(env, backend_dir)
        audit_ids = [uuid.uuid4() for _ in range(6)]
        target_ids = [uuid.uuid4() for _ in range(6)]
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = 'admin'")
            actor_id = cursor.fetchone()[0]
            cursor.executemany(
                "INSERT INTO audit_logs "
                "(id, actor_id, action, target_type, target_id, details, request_id) "
                "VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s)",
                [
                    (
                        audit_ids[0],
                        actor_id,
                        "user.updated",
                        "User",
                        str(target_ids[0]),
                        "{}",
                        "audit-success",
                    ),
                    (
                        audit_ids[1],
                        actor_id,
                        "ai_model.tested",
                        "AIModel",
                        str(target_ids[1]),
                        '{"test_status":"FAILED"}',
                        "audit-model-failed",
                    ),
                    (
                        audit_ids[2],
                        actor_id,
                        "ai_channel.models_discovered",
                        "AIChannel",
                        str(target_ids[2]),
                        '{"error_code":"PROVIDER_UNAVAILABLE"}',
                        "audit-discovery-failed",
                    ),
                    (
                        audit_ids[3],
                        actor_id,
                        "platform_prompt.saved",
                        "PlatformType",
                        str(target_ids[3]),
                        "{}",
                        "audit-legacy-prompt-saved",
                    ),
                    (
                        audit_ids[4],
                        actor_id,
                        "platform_prompt.deleted",
                        "PlatformType",
                        str(target_ids[4]),
                        "{}",
                        "audit-legacy-prompt-deleted",
                    ),
                    (
                        audit_ids[5],
                        actor_id,
                        "publication.mark_platform_review",
                        "PublicationRecord",
                        str(target_ids[5]),
                        "{}",
                        "audit-platform-review",
                    ),
                ],
            )
            connection.commit()

        run_alembic(env, backend_dir, "0024_audit_outcome")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT business_module, outcome, result_message, error_code "
                "FROM audit_logs ORDER BY request_id"
            )
            assert cursor.fetchall() == [
                (
                    "CONFIGURATION",
                    "FAILED",
                    "AI 模型发现失败",
                    "PROVIDER_UNAVAILABLE",
                ),
                ("CONFIGURATION", "SUCCESS", "操作已完成", None),
                ("CONFIGURATION", "SUCCESS", "操作已完成", None),
                (
                    "CONFIGURATION",
                    "FAILED",
                    "AI 模型测试失败",
                    "AI_MODEL_TEST_FAILED",
                ),
                ("PUBLICATION", "SUCCESS", "操作已完成", None),
                ("IDENTITY", "SUCCESS", "操作已完成", None),
            ]
            cursor.execute(
                "SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_audit_logs_created_id'"
            )
            index_definition = cursor.fetchone()
            assert index_definition is not None
            assert "created_at DESC, id DESC" in index_definition[0]
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "UPDATE audit_logs SET result_message = '禁止修改' WHERE id = %s",
                    (audit_ids[0],),
                )
            connection.rollback()
            cursor.execute(
                "INSERT INTO audit_logs "
                "(id, actor_id, business_module, action, target_type, target_id, outcome, "
                "result_message, error_code, details, request_id) "
                "VALUES (%s, %s, 'PUBLICATION', 'publication.created', "
                "'PublicationRecord', NULL, 'FAILED', '发布登记创建失败', "
                "'REVISION_CONFLICT', '{\"facts\":{}}'::jsonb, 'audit-null-target')",
                (uuid.uuid4(), actor_id),
            )
            connection.commit()

        downgrade = subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0023_platform_management"],
            check=False,
            env=env,
            cwd=backend_dir,
            capture_output=True,
            text=True,
        )
        assert downgrade.returncode != 0
        assert "nullable audit target history exists" in downgrade.stderr
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0024_audit_outcome",)
            cursor.execute("SELECT outcome FROM audit_logs WHERE request_id = 'audit-null-target'")
            assert cursor.fetchone() == ("FAILED",)


@pytest.mark.integration
def test_audit_outcome_migration_rejects_unknown_history_atomically() -> None:
    """未分类 action/target 组合必须阻断 0024，不能写 OTHER 或留下半迁移列。"""
    with temporary_database("partsignal_audit_unknown") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "0023_platform_management")
        seed_accounts(env, backend_dir)
        unknown_id = uuid.uuid4()
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = 'admin'")
            actor_id = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO audit_logs "
                "(id, actor_id, action, target_type, target_id, details, request_id) "
                "VALUES (%s, %s, 'unknown.action', 'UnknownTarget', %s, '{}', "
                "'audit-unknown')",
                (unknown_id, actor_id, str(uuid.uuid4())),
            )
            connection.commit()

        result = run_alembic(env, backend_dir, "0024_audit_outcome", check=False)
        assert result.returncode != 0
        assert "unknown.action/UnknownTarget" in result.stdout + result.stderr
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0023_platform_management",)
            cursor.execute(
                "SELECT count(*) FROM information_schema.columns "
                "WHERE table_name = 'audit_logs' "
                "AND column_name IN ('business_module', 'outcome', 'result_message', 'error_code')"
            )
            assert cursor.fetchone() == (0,)
            cursor.execute("SELECT action FROM audit_logs WHERE id = %s", (unknown_id,))
            assert cursor.fetchone() == ("unknown.action",)


@pytest.mark.integration
def test_markdown_facts_migration_rejects_active_legacy_jobs_atomically() -> None:
    """0025 必须在删旧结构前拒绝仍可能调用供应商的旧契约作业。"""
    with temporary_database("partsignal_markdown_active_job") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0022_geo_observation_insights")
        task_id = seed_legacy_content_task(test_url)
        run_alembic(env, backend_dir, "0024_audit_outcome")
        job_id = uuid.uuid4()
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT created_by FROM content_tasks WHERE id = %s", (task_id,))
            actor_id = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO generation_jobs "
                "(id, content_task_id, idempotency_key, job_type, status, input_snapshot, "
                "adapter_name, prompt_template_version, prompt_hash, attempt_count, created_by) "
                "VALUES (%s, %s, %s, 'GENERATE', 'PENDING', "
                '\'{"contract_version":"chat-json-v1"}\'::jsonb, '
                "'openai-compatible-chat-completions', 'chat-json-v1', %s, 0, %s)",
                (job_id, task_id, f"legacy-active-{job_id}", "a" * 64, actor_id),
            )
            connection.commit()

        result = run_alembic(
            env,
            backend_dir,
            "0025_markdown_facts",
            check=False,
        )
        assert result.returncode != 0
        output = result.stdout + result.stderr
        assert "0025 迁移前必须终止旧契约活动作业" in output
        assert str(job_id) in output
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0024_audit_outcome",)
            cursor.execute(
                "SELECT count(*) FROM information_schema.columns "
                "WHERE table_name = 'products' AND column_name = 'facts_body_markdown'"
            )
            assert cursor.fetchone() == (0,)
            cursor.execute("SELECT status FROM generation_jobs WHERE id = %s", (job_id,))
            assert cursor.fetchone() == ("PENDING",)


@pytest.mark.integration
def test_markdown_facts_migration_converts_history_and_targets_direct_platform_schema() -> None:
    """0025 只渲染旧值、保守分级、保留历史引用并删除两套废弃模型。"""
    with temporary_database("partsignal_markdown_facts") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "0022_geo_observation_insights")
        task_id = seed_legacy_content_task(test_url)
        run_alembic(env, backend_dir, "0024_audit_outcome")
        ids = {
            name: uuid.uuid4()
            for name in (
                "fact",
                "reference",
                "public_evidence",
                "unknown_evidence",
                "parameter",
                "replacement",
                "claim",
            )
        }
        fact_snapshot = {
            "reference_parts": [
                {
                    "client_key": "snapshot-ref",
                    "part_number": "SNAP-REF",
                    "manufacturer": "快照厂商",
                    "category": "快照分类",
                }
            ],
            "parameters": [],
            "replacement_relations": [],
            "evidences": [
                {
                    "client_key": "snapshot-source",
                    "type": "DATASHEET",
                    "title": "内部快照来源",
                    "version": "2.0",
                    "source_url": None,
                    "file_id": None,
                    "confidentiality": "INTERNAL",
                }
            ],
            "claims": [
                {
                    "client_key": "snapshot-claim",
                    "type": "APPROVED",
                    "text": "只保留快照中的事实。",
                    "evidence_keys": ["snapshot-source"],
                }
            ],
        }
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT product_id, fact_version_id, platform_profile_version_id, "
                "platform_type_id, created_by FROM content_tasks WHERE id = %s",
                (task_id,),
            )
            (
                product_id,
                empty_fact_id,
                platform_version_id,
                platform_type_id,
                actor_id,
            ) = cursor.fetchone()
            cursor.execute(
                "SELECT platform_profile_id FROM platform_profile_versions WHERE id = %s",
                (platform_version_id,),
            )
            platform_profile_id = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO fact_versions "
                "(id, product_id, version, status, snapshot_json, change_summary, revision, "
                "created_by, approved_by, approved_at) "
                "VALUES (%s, %s, 2, 'APPROVED', %s::jsonb, '结构化快照', 0, %s, %s, now())",
                (
                    ids["fact"],
                    product_id,
                    json.dumps(fact_snapshot, ensure_ascii=False),
                    actor_id,
                    actor_id,
                ),
            )
            cursor.execute(
                "UPDATE content_tasks SET fact_version_id = %s WHERE id = %s",
                (ids["fact"], task_id),
            )
            cursor.execute(
                "INSERT INTO reference_parts "
                "(id, product_id, client_key, part_number, normalized_part_number, "
                "manufacturer, normalized_manufacturer, category) "
                "VALUES (%s, %s, 'ref-a', 'REF-A', 'refa', '旧厂商', '旧厂商', 'MCU')",
                (ids["reference"], product_id),
            )
            cursor.executemany(
                "INSERT INTO evidences "
                "(id, product_id, client_key, type, title, version, source_url, "
                "file_record_id, confidentiality) "
                "VALUES (%s, %s, %s, 'DATASHEET', %s, '1.0', %s, NULL, %s)",
                [
                    (
                        ids["unknown_evidence"],
                        product_id,
                        "mystery",
                        "未知分级来源",
                        None,
                        "LEGACY_UNKNOWN",
                    ),
                    (
                        ids["public_evidence"],
                        product_id,
                        "datasheet",
                        "公开数据手册",
                        "https://docs.example.invalid/a.pdf",
                        "PUBLIC",
                    ),
                ],
            )
            cursor.execute(
                "INSERT INTO part_parameters "
                "(id, product_id, owner_product_id, reference_part_id, client_key, key, name, "
                "value_type, min_value, typical_value, max_value, text_value, unit, "
                "test_conditions, is_critical) "
                "VALUES (%s, %s, %s, NULL, 'power', 'power', '功耗', 'NUMERIC', "
                "NULL, 1.25, 2.5, NULL, 'W', '室温', true)",
                (ids["parameter"], product_id, product_id),
            )
            cursor.execute(
                "INSERT INTO replacement_relations "
                "(id, product_id, reference_part_id, client_key, replacement_level, "
                "conditions, exclusions) "
                "VALUES (%s, %s, %s, 'replace-a', 'PARAMETER_COMPATIBLE', "
                "'仅限已验证条件', '不适用于未知场景')",
                (ids["replacement"], product_id, ids["reference"]),
            )
            cursor.execute(
                "INSERT INTO fact_claims (id, product_id, client_key, type, text) "
                "VALUES (%s, %s, 'claim-a', 'APPROVED', '迁移只表达旧字段。')",
                (ids["claim"], product_id),
            )
            cursor.execute(
                "INSERT INTO parameter_evidence_links (parameter_id, evidence_id) VALUES (%s, %s)",
                (ids["parameter"], ids["public_evidence"]),
            )
            cursor.execute(
                "INSERT INTO replacement_evidence_links (replacement_id, evidence_id) "
                "VALUES (%s, %s)",
                (ids["replacement"], ids["public_evidence"]),
            )
            cursor.execute(
                "INSERT INTO claim_evidence_links (claim_id, evidence_id) VALUES (%s, %s)",
                (ids["claim"], ids["public_evidence"]),
            )
            connection.commit()

        publication_id = seed_legacy_publication(test_url, task_id, cross_platform=False)
        run_alembic(env, backend_dir, "0025_markdown_facts")

        expected_workspace = """## 参考型号

### 记录 1
- `client_key`: "ref-a"
- `part_number`: "REF-A"
- `manufacturer`: "旧厂商"
- `category`: "MCU"

## 参数

### 记录 1
- `client_key`: "power"
- `owner_key`: "product"
- `key`: "power"
- `name`: "功耗"
- `value_type`: "NUMERIC"
- `min_value`: null
- `typical_value`: 1.25
- `max_value`: 2.5
- `text_value`: null
- `unit`: "W"
- `test_conditions`: "室温"
- `is_critical`: true
- `evidence_keys`: ["datasheet"]

## 替代关系

### 记录 1
- `client_key`: "replace-a"
- `reference_part_key`: "ref-a"
- `replacement_level`: "PARAMETER_COMPATIBLE"
- `conditions`: "仅限已验证条件"
- `exclusions`: "不适用于未知场景"
- `evidence_keys`: ["datasheet"]

## 证据

### 记录 1
- `client_key`: "datasheet"
- `type`: "DATASHEET"
- `title`: "公开数据手册"
- `version`: "1.0"
- `source_url`: "https://docs.example.invalid/a.pdf"
- `file_id`: null
- `confidentiality`: "PUBLIC"

### 记录 2
- `client_key`: "mystery"
- `type`: "DATASHEET"
- `title`: "未知分级来源"
- `version`: "1.0"
- `source_url`: null
- `file_id`: null
- `confidentiality`: "LEGACY_UNKNOWN"

## 声明

### 记录 1
- `client_key`: "claim-a"
- `type`: "APPROVED"
- `text`: "迁移只表达旧字段。"
- `evidence_keys`: ["datasheet"]"""
        expected_fact = """## 参考型号

### 记录 1
- `client_key`: "snapshot-ref"
- `part_number`: "SNAP-REF"
- `manufacturer`: "快照厂商"
- `category`: "快照分类"

## 证据

### 记录 1
- `client_key`: "snapshot-source"
- `type`: "DATASHEET"
- `title`: "内部快照来源"
- `version`: "2.0"
- `source_url`: null
- `file_id`: null
- `confidentiality`: "INTERNAL"

## 声明

### 记录 1
- `client_key`: "snapshot-claim"
- `type`: "APPROVED"
- `text`: "只保留快照中的事实。"
- `evidence_keys`: ["snapshot-source"]"""
        removed_tables = {
            "reference_parts",
            "evidences",
            "part_parameters",
            "replacement_relations",
            "fact_claims",
            "parameter_evidence_links",
            "replacement_evidence_links",
            "claim_evidence_links",
            "platform_profile_versions",
        }
        removed_task_columns = {
            "platform_profile_version_id",
            "platform_type_id",
            "platform_type_snapshot",
            "user_prompt_markdown",
            "generation_data_classification",
            "generation_data_classified_by",
            "generation_data_classified_at",
            "target_audience",
            "content_angle",
            "conversion_goal",
            "desired_format",
            "desired_length_min",
            "desired_length_max",
            "canonical_url",
        }
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT facts_body_markdown, facts_classification FROM products WHERE id = %s",
                (product_id,),
            )
            assert cursor.fetchone() == (expected_workspace, "RESTRICTED")
            cursor.execute(
                "SELECT id, body_markdown, classification FROM fact_versions "
                "WHERE product_id = %s ORDER BY version",
                (product_id,),
            )
            assert cursor.fetchall() == [
                (empty_fact_id, "", "RESTRICTED"),
                (ids["fact"], expected_fact, "INTERNAL"),
            ]
            cursor.execute(
                "SELECT fact_version_id, platform_profile_id FROM content_tasks WHERE id = %s",
                (task_id,),
            )
            assert cursor.fetchone() == (ids["fact"], platform_profile_id)
            cursor.execute(
                "SELECT count(*) FROM publication_records WHERE id = %s",
                (publication_id,),
            )
            assert cursor.fetchone() == (1,)

            cursor.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public' "
                "AND tablename = ANY(%s)",
                (list(removed_tables),),
            )
            assert cursor.fetchall() == []
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'content_tasks'"
            )
            task_columns = {row[0] for row in cursor.fetchall()}
            assert "platform_profile_id" in task_columns
            assert not task_columns & removed_task_columns
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'fact_versions'"
            )
            fact_columns = {row[0] for row in cursor.fetchall()}
            assert {"body_markdown", "classification"} <= fact_columns
            assert "snapshot_json" not in fact_columns
            cursor.execute("SELECT indexname FROM pg_indexes WHERE tablename = 'content_tasks'")
            task_indexes = {row[0] for row in cursor.fetchall()}
            assert "ix_content_tasks_platform_profile_created_at" in task_indexes
            assert "ix_content_tasks_platform_profile_version_created_at" not in task_indexes
            cursor.execute(
                "SELECT conname FROM pg_constraint "
                "WHERE conrelid IN ('products'::regclass, 'fact_versions'::regclass, "
                "'content_tasks'::regclass)"
            )
            constraints = {row[0] for row in cursor.fetchall()}
            assert {
                "ck_products_facts_classification",
                "ck_fact_versions_classification",
                "fk_content_tasks_platform_profile_id",
            } <= constraints
            cursor.execute(
                "SELECT pg_get_functiondef("
                "'partsignal_validate_publication_insert()'::regprocedure)"
            )
            publication_guard = cursor.fetchone()[0]
            assert "ct.platform_profile_id" in publication_guard
            assert "platform_profile_versions" not in publication_guard

            with pytest.raises(psycopg.errors.CheckViolation):
                cursor.execute(
                    "INSERT INTO content_tasks "
                    "(id, query_topic_id, product_id, fact_version_id, platform_profile_id, "
                    "status, revision, created_by) "
                    "VALUES (%s, NULL, %s, %s, %s, 'OPEN', 0, %s)",
                    (
                        uuid.uuid4(),
                        product_id,
                        empty_fact_id,
                        platform_profile_id,
                        actor_id,
                    ),
                )
            connection.rollback()

            other_profile_id = uuid.uuid4()
            other_account_id = uuid.uuid4()
            cursor.execute(
                "INSERT INTO platform_profiles "
                "(id, name, slug, allowed_domains, platform_type_id, revision, is_active) "
                "VALUES (%s, '迁移后其他平台', %s, ARRAY['other.example.invalid'], %s, 0, true)",
                (
                    other_profile_id,
                    f"post-migration-{other_profile_id.hex[:12]}",
                    platform_type_id,
                ),
            )
            cursor.execute(
                "INSERT INTO platform_accounts "
                "(id, platform_profile_id, label, account_identifier, is_active) "
                "VALUES (%s, %s, '其他账号', %s, true)",
                (
                    other_account_id,
                    other_profile_id,
                    f"post-migration-{other_account_id.hex[:12]}",
                ),
            )
            connection.commit()
            cursor.execute(
                "SELECT content_version_id, content_hash, created_by "
                "FROM publication_records WHERE id = %s",
                (publication_id,),
            )
            content_version_id, content_hash, publication_actor_id = cursor.fetchone()
            with pytest.raises(psycopg.errors.CheckViolation):
                cursor.execute(
                    "INSERT INTO publication_records "
                    "(id, idempotency_key, content_version_id, platform_account_id, "
                    "section_url, status, content_hash, created_by) "
                    "VALUES (%s, %s, %s, %s, 'https://other.example.invalid/section', "
                    "'PENDING_MANUAL_PUBLISH', %s, %s)",
                    (
                        uuid.uuid4(),
                        f"wrong-platform-{uuid.uuid4()}",
                        content_version_id,
                        other_account_id,
                        content_hash,
                        publication_actor_id,
                    ),
                )
            connection.rollback()

        downgrade = subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0024_audit_outcome"],
            check=False,
            env=env,
            cwd=backend_dir,
            capture_output=True,
            text=True,
        )
        assert downgrade.returncode != 0
        assert "0025 不支持有损降级" in downgrade.stderr
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0025_markdown_facts",)


def seed_platform_accounts_for_0026(
    test_url: str,
    identifiers: list[str],
) -> tuple[uuid.UUID, list[uuid.UUID]]:
    """在 0025 Schema 写入同平台账号，供 0026 迁移边界测试使用。"""
    platform_type_id = uuid.uuid4()
    platform_profile_id = uuid.uuid4()
    account_ids = [uuid.uuid4() for _ in identifiers]
    with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT id FROM users WHERE username = 'admin'")
        actor_id = cursor.fetchone()[0]
        cursor.execute(
            "INSERT INTO platform_types (id, name, slug, revision, created_by) "
            "VALUES (%s, '0026 迁移平台类型', %s, 0, %s)",
            (
                platform_type_id,
                f"migration-0026-type-{platform_type_id.hex[:12]}",
                actor_id,
            ),
        )
        cursor.execute(
            "INSERT INTO platform_profiles "
            "(id, name, slug, allowed_domains, platform_type_id, revision, is_active) "
            "VALUES (%s, '0026 迁移平台', %s, ARRAY['migration.invalid'], %s, 0, true)",
            (
                platform_profile_id,
                f"migration-0026-profile-{platform_profile_id.hex[:12]}",
                platform_type_id,
            ),
        )
        cursor.executemany(
            "INSERT INTO platform_accounts "
            "(id, platform_profile_id, label, account_identifier, is_active) "
            "VALUES (%s, %s, %s, %s, true)",
            [
                (
                    account_id,
                    platform_profile_id,
                    f" 迁移账号 {index} ",
                    identifier,
                )
                for index, (account_id, identifier) in enumerate(
                    zip(account_ids, identifiers, strict=True),
                    start=1,
                )
            ],
        )
        connection.commit()
    return platform_profile_id, account_ids


@pytest.mark.integration
def test_publication_account_dedup_migration_adds_constraints_and_downgrades() -> None:
    """0026 去除两侧空白，增加 revision 与同平台规范化唯一约束。"""
    with temporary_database("partsignal_account_dedup") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "0025_markdown_facts")
        seed_accounts(env, backend_dir)
        platform_profile_id, account_ids = seed_platform_accounts_for_0026(
            test_url,
            ["  Operator-A  ", "+86 13800000000 + 张三"],
        )

        run_alembic(env, backend_dir, "0026_publication_account_dedup")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT label, account_identifier, revision FROM platform_accounts WHERE id = %s",
                (account_ids[0],),
            )
            assert cursor.fetchone() == ("迁移账号 1", "Operator-A", 0)
            cursor.execute(
                "SELECT indexdef FROM pg_indexes "
                "WHERE indexname = 'uq_platform_accounts_profile_identifier_normalized'"
            )
            index_definition = cursor.fetchone()
            assert index_definition is not None
            assert "UNIQUE INDEX" in index_definition[0]
            assert "lower(btrim" in index_definition[0]
            cursor.execute(
                "SELECT conname FROM pg_constraint WHERE conrelid = 'platform_accounts'::regclass"
            )
            assert {
                "ck_platform_accounts_revision_nonnegative",
                "ck_platform_accounts_label_nonblank",
                "ck_platform_accounts_identifier_nonblank",
            } <= {row[0] for row in cursor.fetchall()}

            with pytest.raises(psycopg.errors.UniqueViolation):
                cursor.execute(
                    "INSERT INTO platform_accounts "
                    "(id, platform_profile_id, label, account_identifier, is_active, revision) "
                    "VALUES (%s, %s, '重复账号', '  operator-a ', true, 0)",
                    (uuid.uuid4(), platform_profile_id),
                )
            connection.rollback()
            with pytest.raises(psycopg.errors.CheckViolation):
                cursor.execute(
                    "INSERT INTO platform_accounts "
                    "(id, platform_profile_id, label, account_identifier, is_active, revision) "
                    "VALUES (%s, %s, '   ', 'valid-account', true, 0)",
                    (uuid.uuid4(), platform_profile_id),
                )
            connection.rollback()

        subprocess.run(
            [
                sys.executable,
                "-m",
                "alembic",
                "downgrade",
                "0025_markdown_facts",
            ],
            check=True,
            env=env,
            cwd=backend_dir,
        )
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM information_schema.columns "
                "WHERE table_name = 'platform_accounts' AND column_name = 'revision'"
            )
            assert cursor.fetchone() == (0,)
            cursor.execute(
                "SELECT count(*) FROM pg_indexes "
                "WHERE indexname = 'uq_platform_accounts_profile_identifier_normalized'"
            )
            assert cursor.fetchone() == (0,)


@pytest.mark.integration
def test_publication_account_dedup_migration_rejects_existing_duplicates_atomically() -> None:
    """0026 遇到同平台大小写或空白等价标识时必须明确失败且不留半迁移。"""
    with temporary_database("partsignal_account_dedup_conflict") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0025_markdown_facts")
        seed_accounts(env, backend_dir)
        seed_platform_accounts_for_0026(
            test_url,
            [" Operator-A ", "operator-a"],
        )

        result = run_alembic(
            env,
            backend_dir,
            "0026_publication_account_dedup",
            check=False,
        )
        assert result.returncode != 0
        assert "0026 检测到同平台重复运营账号标识" in result.stderr
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0025_markdown_facts",)
            cursor.execute(
                "SELECT count(*) FROM information_schema.columns "
                "WHERE table_name = 'platform_accounts' AND column_name = 'revision'"
            )
            assert cursor.fetchone() == (0,)


@pytest.mark.integration
def test_audit_user_delete_guard_is_targeted_and_reversible() -> None:
    """0027 只为当前事务目标用户放行审计操作者置空。"""
    with temporary_database("partsignal_audit_user_delete") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0026_publication_account_dedup")
        seed_accounts(env, backend_dir)
        target_id, replacement_target_id = uuid.uuid4(), uuid.uuid4()
        target_audit_id, other_audit_id = uuid.uuid4(), uuid.uuid4()

        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = 'admin'")
            admin_id = cursor.fetchone()[0]
            cursor.executemany(
                "INSERT INTO users "
                "(id, username, display_name, password_hash, account_type, is_active, "
                "must_change_password, revision) "
                "VALUES (%s, %s, %s, 'hash', 'ENGINEER', false, false, 0)",
                [
                    (target_id, f"audit-target-{target_id.hex[:8]}", "审计删除目标"),
                    (
                        replacement_target_id,
                        f"audit-target-{replacement_target_id.hex[:8]}",
                        "降级删除目标",
                    ),
                ],
            )
            cursor.executemany(
                "INSERT INTO audit_logs "
                "(id, actor_id, business_module, action, target_type, target_id, outcome, "
                "result_message, request_id, details) "
                "VALUES (%s, %s, 'IDENTITY', 'user.updated', 'User', %s, 'SUCCESS', "
                "'用户资料更新完成', %s, '{}'::jsonb)",
                [
                    (
                        target_audit_id,
                        target_id,
                        str(target_id),
                        "migration-audit-target",
                    ),
                    (
                        other_audit_id,
                        admin_id,
                        str(admin_id),
                        "migration-audit-other",
                    ),
                ],
            )
            connection.commit()

            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute("DELETE FROM users WHERE id = %s", (target_id,))
            connection.rollback()

        run_alembic(env, backend_dir, "0027_audit_user_delete_guard")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "UPDATE audit_logs SET actor_id = NULL WHERE id = %s",
                    (target_audit_id,),
                )
            connection.rollback()

            cursor.execute(
                "SELECT set_config('partsignal.user_delete_id', %s, true)",
                (str(admin_id),),
            )
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "UPDATE audit_logs SET actor_id = NULL WHERE id = %s",
                    (target_audit_id,),
                )
            connection.rollback()

            cursor.execute(
                "SELECT set_config('partsignal.user_delete_id', %s, true)",
                (str(target_id),),
            )
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "UPDATE audit_logs SET actor_id = NULL WHERE id = %s",
                    (target_audit_id,),
                )
            connection.rollback()

            cursor.execute(
                "SELECT set_config('partsignal.user_delete_id', %s, true)",
                (str(target_id),),
            )
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "UPDATE audit_logs SET actor_id = NULL, result_message = '禁止篡改' "
                    "WHERE id = %s",
                    (target_audit_id,),
                )
            connection.rollback()

            cursor.execute(
                "SELECT set_config('partsignal.user_delete_id', %s, true)",
                (str(target_id),),
            )
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute("DELETE FROM audit_logs WHERE id = %s", (target_audit_id,))
            connection.rollback()

            cursor.execute(
                "SELECT set_config('partsignal.user_delete_id', %s, true)",
                (str(target_id),),
            )
            cursor.execute("DELETE FROM users WHERE id = %s", (target_id,))
            connection.commit()
            cursor.execute(
                "SELECT actor_id, result_message FROM audit_logs WHERE id = %s",
                (target_audit_id,),
            )
            assert cursor.fetchone() == (None, "用户资料更新完成")
            cursor.execute(
                "SELECT actor_id FROM audit_logs WHERE id = %s",
                (other_audit_id,),
            )
            assert cursor.fetchone() == (admin_id,)

        subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0026_publication_account_dedup"],
            check=True,
            env=env,
            cwd=backend_dir,
        )
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            replacement_audit_id = uuid.uuid4()
            cursor.execute(
                "INSERT INTO audit_logs "
                "(id, actor_id, business_module, action, target_type, target_id, outcome, "
                "result_message, request_id, details) "
                "VALUES (%s, %s, 'IDENTITY', 'user.updated', 'User', %s, 'SUCCESS', "
                "'用户资料更新完成', 'migration-audit-downgrade', '{}'::jsonb)",
                (
                    replacement_audit_id,
                    replacement_target_id,
                    str(replacement_target_id),
                ),
            )
            connection.commit()
            cursor.execute(
                "SELECT set_config('partsignal.user_delete_id', %s, true)",
                (str(replacement_target_id),),
            )
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "DELETE FROM users WHERE id = %s",
                    (replacement_target_id,),
                )
            connection.rollback()
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0026_publication_account_dedup",)


@pytest.mark.integration
def test_platform_logo_lifecycle_migration_initializes_retention_and_guards_links() -> None:
    """0028 初始化保留期、校验 Logo 外键，并在删除开始后拒绝降级。"""
    with temporary_database("partsignal_platform_logo_lifecycle") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0027_audit_user_delete_guard")
        seed_accounts(env, backend_dir)
        platform_type_id = uuid.uuid4()
        platform_profile_id = uuid.uuid4()
        linked_logo_id = uuid.uuid4()
        orphan_logo_id = uuid.uuid4()
        wrong_category_id = uuid.uuid4()

        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = 'admin'")
            actor_id = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO platform_types (id, name, slug, revision, created_by) "
                "VALUES (%s, 'Logo 生命周期类型', %s, 0, %s)",
                (
                    platform_type_id,
                    f"logo-lifecycle-type-{platform_type_id.hex[:10]}",
                    actor_id,
                ),
            )
            cursor.executemany(
                "INSERT INTO file_records "
                "(id, category, original_filename, object_key, content_type, size, sha256, "
                "access_level, status, uploader_id, upload_expires_at, verified_at) "
                "VALUES (%s, %s, 'logo.png', %s, 'image/png', 10, %s, "
                "'PUBLIC', 'VERIFIED', %s, now(), now())",
                [
                    (
                        linked_logo_id,
                        "PLATFORM_LOGO",
                        f"test/platform-logo/{linked_logo_id}.png",
                        "a" * 64,
                        actor_id,
                    ),
                    (
                        orphan_logo_id,
                        "PLATFORM_LOGO",
                        f"test/platform-logo/{orphan_logo_id}.png",
                        "b" * 64,
                        actor_id,
                    ),
                    (
                        wrong_category_id,
                        "PUBLICATION_ASSET",
                        f"test/publication/{wrong_category_id}.png",
                        "c" * 64,
                        actor_id,
                    ),
                ],
            )
            cursor.execute(
                "INSERT INTO platform_profiles "
                "(id, name, slug, allowed_domains, platform_type_id, logo_file_id, "
                "revision, is_active) "
                "VALUES (%s, 'Logo 生命周期平台', %s, ARRAY['logo.invalid'], %s, %s, 0, true)",
                (
                    platform_profile_id,
                    f"logo-lifecycle-{platform_profile_id.hex[:10]}",
                    platform_type_id,
                    linked_logo_id,
                ),
            )
            connection.commit()

        run_alembic(env, backend_dir, "0028_platform_logo_lifecycle")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, cleanup_after IS NULL, "
                "COALESCE(cleanup_after BETWEEN now() + interval '6 days 23 hours' "
                "AND now() + interval '7 days 1 hour', false) "
                "FROM file_records WHERE id IN (%s, %s) ORDER BY id",
                (linked_logo_id, orphan_logo_id),
            )
            retention = {row[0]: (row[1], row[2]) for row in cursor.fetchall()}
            assert retention[linked_logo_id] == (True, False)
            assert retention[orphan_logo_id] == (False, True)

            with pytest.raises(psycopg.errors.CheckViolation):
                cursor.execute(
                    "UPDATE platform_profiles SET logo_file_id = %s WHERE id = %s",
                    (wrong_category_id, platform_profile_id),
                )
            connection.rollback()

            cursor.execute(
                "UPDATE file_records SET status = 'DELETING' WHERE id = %s",
                (orphan_logo_id,),
            )
            connection.commit()

        downgrade = subprocess.run(
            [
                sys.executable,
                "-m",
                "alembic",
                "downgrade",
                "0027_audit_user_delete_guard",
            ],
            check=False,
            env=env,
            cwd=backend_dir,
            capture_output=True,
            text=True,
        )
        assert downgrade.returncode != 0
        assert "platform logo deletion has started" in downgrade.stderr


@pytest.mark.integration
def test_geo_evidence_migration_removes_stages_and_guards_manual_delete() -> None:
    """0029 删除累计字段，只按事务声明放行人工观测删除。"""
    with temporary_database("partsignal_geo_evidence") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "0028_platform_logo_lifecycle")
        seed_accounts(env, backend_dir)
        product_id = uuid.uuid4()
        topic_id = uuid.uuid4()
        manual_id = uuid.uuid4()
        legacy_id = uuid.uuid4()

        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = 'admin'")
            actor_id = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO products "
                "(id, part_number, normalized_part_number, brand, normalized_brand, category, "
                "status, revision, facts_revision, facts_body_markdown, facts_classification) "
                "VALUES (%s, '0029-MIG', %s, 'PartSignal', %s, 'TEST', "
                "'ACTIVE', 0, 0, '', 'RESTRICTED')",
                (
                    product_id,
                    f"0029-{product_id.hex}",
                    f"partsignal-{product_id.hex}",
                ),
            )
            cursor.execute(
                "INSERT INTO query_topics "
                "(id, canonical_question, intent_type, variants, revision) "
                "VALUES (%s, '0029 迁移问题', 'PRODUCT', ARRAY[]::text[], 0)",
                (topic_id,),
            )
            cursor.execute(
                "INSERT INTO geo_observations "
                "(id, observation_kind, query_topic_id, product_id, search_platform, "
                "search_query, tested_at, notes, tested_by) "
                "VALUES (%s, 'MANUAL_ARTICLE_SEARCH', %s, %s, 'DeepSeek', "
                "'0029-MIG', now(), '', %s)",
                (manual_id, topic_id, product_id, actor_id),
            )
            cursor.execute(
                "INSERT INTO geo_observations "
                "(id, observation_kind, query_topic_id, product_id, actual_prompt, model_name, "
                "tested_at, web_search_enabled, answer_summary, mentioned, recommendation, "
                "accuracy, notes, tested_by) "
                "VALUES (%s, 'LEGACY_MODEL_RESULT', %s, %s, '历史问题', '历史模型', "
                "now(), true, '历史回答', true, 'RECOMMENDED', 'ACCURATE', '', %s)",
                (legacy_id, topic_id, product_id, actor_id),
            )
            connection.commit()

        run_alembic(env, backend_dir, "0029_geo_evidence_management")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'geo_observation_publications'"
            )
            columns = {row[0] for row in cursor.fetchall()}
            assert "recommendation_status" not in columns
            assert "cited" not in columns
            assert {"discovered", "mentioned", "accuracy"} <= columns
            cursor.execute(
                "SELECT count(*) FROM pg_indexes WHERE indexname = 'ix_file_records_cleanup'"
            )
            assert cursor.fetchone() == (1,)

            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute("DELETE FROM geo_observations WHERE id = %s", (manual_id,))
            connection.rollback()

            cursor.execute(
                "SELECT set_config('partsignal.geo_observation_delete_id', %s, true)",
                (str(legacy_id),),
            )
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute("DELETE FROM geo_observations WHERE id = %s", (legacy_id,))
            connection.rollback()

            cursor.execute(
                "SELECT set_config('partsignal.geo_observation_delete_id', %s, true)",
                (str(manual_id),),
            )
            cursor.execute("DELETE FROM geo_observations WHERE id = %s", (manual_id,))
            connection.commit()

        subprocess.run(
            [
                sys.executable,
                "-m",
                "alembic",
                "downgrade",
                "0028_platform_logo_lifecycle",
            ],
            check=True,
            env=env,
            cwd=backend_dir,
        )
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'geo_observation_publications'"
            )
            columns = {row[0] for row in cursor.fetchall()}
            assert {"recommendation_status", "cited"} <= columns


@pytest.mark.integration
def test_publication_record_delete_migration_guards_target_and_public_history() -> None:
    """0030 仅放行声明目标的未公开聚合删除，降级恢复原追加式门禁。"""
    with temporary_database("partsignal_publication_delete") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0029_geo_evidence_management")
        seed_accounts(env, backend_dir)
        ids = {
            name: uuid.uuid4()
            for name in (
                "product",
                "fact",
                "platform_type",
                "profile",
                "account",
                "task",
                "content",
                "file",
                "pending_publication",
                "pending_event",
                "public_publication",
                "public_event",
                "orphan_publication",
            )
        }
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = 'admin'")
            actor_id = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO products "
                "(id, part_number, normalized_part_number, brand, normalized_brand, category, "
                "status, revision, facts_revision, facts_body_markdown, facts_classification) "
                "VALUES (%s, '0030-MIG', %s, 'PartSignal', %s, 'TEST', "
                "'ACTIVE', 0, 0, '迁移事实', 'PUBLIC')",
                (
                    ids["product"],
                    f"0030-{ids['product'].hex}",
                    f"partsignal-{ids['product'].hex}",
                ),
            )
            cursor.execute(
                "INSERT INTO fact_versions "
                "(id, product_id, version, status, body_markdown, classification, "
                "change_summary, revision, created_by, approved_by, approved_at) "
                "VALUES (%s, %s, 1, 'APPROVED', '迁移事实', 'PUBLIC', "
                "'0030 迁移测试', 0, %s, %s, now())",
                (ids["fact"], ids["product"], actor_id, actor_id),
            )
            cursor.execute(
                "INSERT INTO platform_types (id, name, slug, revision, created_by) "
                "VALUES (%s, '0030 迁移类型', %s, 0, %s)",
                (
                    ids["platform_type"],
                    f"0030-type-{ids['platform_type'].hex[:12]}",
                    actor_id,
                ),
            )
            cursor.execute(
                "INSERT INTO platform_profiles "
                "(id, name, slug, allowed_domains, platform_type_id, revision, is_active) "
                "VALUES (%s, '0030 迁移平台', %s, ARRAY['migration.invalid'], %s, 0, true)",
                (
                    ids["profile"],
                    f"0030-profile-{ids['profile'].hex[:12]}",
                    ids["platform_type"],
                ),
            )
            cursor.execute(
                "INSERT INTO platform_accounts "
                "(id, platform_profile_id, label, account_identifier, is_active, revision) "
                "VALUES (%s, %s, '0030 迁移账号', %s, true, 0)",
                (
                    ids["account"],
                    ids["profile"],
                    f"0030-account-{ids['account'].hex[:12]}",
                ),
            )
            cursor.execute(
                "INSERT INTO content_tasks "
                "(id, product_id, fact_version_id, platform_profile_id, status, revision, "
                "created_by) VALUES (%s, %s, %s, %s, 'OPEN', 0, %s)",
                (
                    ids["task"],
                    ids["product"],
                    ids["fact"],
                    ids["profile"],
                    actor_id,
                ),
            )
            cursor.execute(
                "INSERT INTO content_versions "
                "(id, task_id, fact_version_id, version, source_type, title, summary, "
                "body_markdown, tags, content_hash, status, revision, quality_issues, "
                "change_summary, created_by) "
                "VALUES (%s, %s, %s, 1, 'HUMAN', '0030 迁移内容', '迁移摘要', "
                "'迁移正文', ARRAY[]::text[], %s, 'APPROVED', 0, '[]'::jsonb, "
                "'0030 迁移测试', %s)",
                (ids["content"], ids["task"], ids["fact"], "3" * 64, actor_id),
            )
            cursor.execute(
                "INSERT INTO file_records "
                "(id, category, original_filename, object_key, content_type, size, sha256, "
                "access_level, status, uploader_id, upload_expires_at, verified_at) "
                "VALUES (%s, 'OPERATION_SCREENSHOT', '0030.png', %s, 'image/png', 10, %s, "
                "'INTERNAL', 'VERIFIED', %s, now(), now())",
                (
                    ids["file"],
                    f"test/publication-delete/{ids['file']}.png",
                    "4" * 64,
                    actor_id,
                ),
            )
            cursor.executemany(
                "INSERT INTO publication_records "
                "(id, idempotency_key, content_version_id, platform_account_id, section_url, "
                "actual_title, final_url, published_at, status, content_hash, created_by) "
                "VALUES (%s, %s, %s, %s, 'https://migration.invalid/section', "
                "%s, %s, %s, %s, %s, %s)",
                [
                    (
                        ids["pending_publication"],
                        f"0030-pending-{ids['pending_publication']}",
                        ids["content"],
                        ids["account"],
                        None,
                        None,
                        None,
                        "PENDING_MANUAL_PUBLISH",
                        "3" * 64,
                        actor_id,
                    ),
                    (
                        ids["public_publication"],
                        f"0030-public-{ids['public_publication']}",
                        ids["content"],
                        ids["account"],
                        "公开文章",
                        "https://migration.invalid/public",
                        "2026-07-28T00:00:00+00:00",
                        "PUBLISHED",
                        "3" * 64,
                        actor_id,
                    ),
                    (
                        ids["orphan_publication"],
                        f"0030-orphan-{ids['orphan_publication']}",
                        ids["content"],
                        ids["account"],
                        None,
                        None,
                        None,
                        "REJECTED",
                        "5" * 64,
                        actor_id,
                    ),
                ],
            )
            cursor.executemany(
                "INSERT INTO publication_status_events "
                "(id, publication_id, status, comment, actor_id) "
                "VALUES (%s, %s, %s, '0030 迁移事件', %s)",
                [
                    (
                        ids["pending_event"],
                        ids["pending_publication"],
                        "PENDING_MANUAL_PUBLISH",
                        actor_id,
                    ),
                    (
                        ids["public_event"],
                        ids["public_publication"],
                        "PUBLISHED",
                        actor_id,
                    ),
                ],
            )
            cursor.execute(
                "INSERT INTO publication_attachments (publication_id, file_id) VALUES (%s, %s)",
                (ids["pending_publication"], ids["file"]),
            )
            connection.commit()

        run_alembic(env, backend_dir, "0030_publication_record_delete")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "DELETE FROM publication_records WHERE id = %s",
                    (ids["pending_publication"],),
                )
            connection.rollback()

            cursor.execute(
                "SELECT set_config('partsignal.publication_record_delete_id', %s, true)",
                (str(ids["pending_publication"]),),
            )
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "UPDATE publication_status_events SET comment = '禁止修改' WHERE id = %s",
                    (ids["pending_event"],),
                )
            connection.rollback()

            cursor.execute(
                "SELECT set_config('partsignal.publication_record_delete_id', %s, true)",
                (str(ids["public_publication"]),),
            )
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "DELETE FROM publication_status_events WHERE id = %s",
                    (ids["public_event"],),
                )
            connection.rollback()

            cursor.execute(
                "SELECT set_config('partsignal.publication_record_delete_id', %s, true)",
                (str(ids["pending_publication"]),),
            )
            cursor.execute(
                "DELETE FROM publication_attachments WHERE publication_id = %s",
                (ids["pending_publication"],),
            )
            cursor.execute(
                "DELETE FROM publication_status_events WHERE publication_id = %s",
                (ids["pending_publication"],),
            )
            cursor.execute(
                "DELETE FROM publication_records WHERE id = %s",
                (ids["pending_publication"],),
            )
            connection.commit()
            cursor.execute(
                "SELECT count(*) FROM publication_records WHERE id = %s",
                (ids["pending_publication"],),
            )
            assert cursor.fetchone() == (0,)

            replacement_event_id = uuid.uuid4()
            cursor.execute(
                "INSERT INTO publication_status_events "
                "(id, publication_id, status, comment, actor_id) "
                "VALUES (%s, %s, 'REMOVED', '降级门禁验证', %s)",
                (replacement_event_id, ids["public_publication"], actor_id),
            )
            cursor.execute(
                "INSERT INTO publication_attachments (publication_id, file_id) VALUES (%s, %s)",
                (ids["public_publication"], ids["file"]),
            )
            connection.commit()

        subprocess.run(
            [
                sys.executable,
                "-m",
                "alembic",
                "downgrade",
                "0029_geo_evidence_management",
            ],
            check=True,
            env=env,
            cwd=backend_dir,
        )
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT set_config('partsignal.publication_record_delete_id', %s, true)",
                (str(ids["public_publication"]),),
            )
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "DELETE FROM publication_status_events WHERE id = %s",
                    (replacement_event_id,),
                )
            connection.rollback()

            cursor.execute(
                "SELECT set_config('partsignal.publication_record_delete_id', %s, true)",
                (str(ids["public_publication"]),),
            )
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "DELETE FROM publication_attachments WHERE publication_id = %s",
                    (ids["public_publication"],),
                )
            connection.rollback()

            cursor.execute(
                "DELETE FROM publication_records WHERE id = %s",
                (ids["orphan_publication"],),
            )
            connection.commit()
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0029_geo_evidence_management",)


@pytest.mark.integration
def test_reusable_platform_prompt_migration_preserves_rows_and_guards_downgrade() -> None:
    """0031 保留旧模板事实、回绑平台，并拒绝共享关系的有损降级。"""
    with temporary_database("partsignal_reusable_prompt") as (test_url, env, backend_dir):
        run_alembic(env, backend_dir, "0030_publication_record_delete")
        actor_id, type_id = uuid.uuid4(), uuid.uuid4()
        first_profile, second_profile = uuid.uuid4(), uuid.uuid4()
        created_at = "2026-07-20T01:02:03+00:00"
        updated_at = "2026-07-21T04:05:06+00:00"
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO users "
                "(id, username, display_name, password_hash, account_type, is_active, "
                "must_change_password, revision) "
                "VALUES (%s, %s, '0031 迁移管理员', 'hash', 'ADMIN', true, false, 0)",
                (actor_id, f"prompt-migration-{actor_id.hex[:12]}"),
            )
            cursor.execute(
                "INSERT INTO platform_types (id, name, slug, created_by) "
                "VALUES (%s, '0031 平台类型', %s, %s)",
                (type_id, f"prompt-type-{type_id.hex[:12]}", actor_id),
            )
            cursor.executemany(
                "INSERT INTO platform_profiles "
                "(id, name, slug, allowed_domains, platform_type_id, revision, is_active) "
                "VALUES (%s, %s, %s, ARRAY['migration.invalid'], %s, 0, true)",
                [
                    (first_profile, "迁移平台甲", "prompt-platform-a", type_id),
                    (second_profile, "迁移平台乙", "prompt-platform-b", type_id),
                ],
            )
            cursor.executemany(
                "INSERT INTO platform_prompts "
                "(platform_profile_id, template_markdown, revision, updated_by, "
                "created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s)",
                [
                    (
                        first_profile,
                        "相同正文不自动去重",
                        2,
                        actor_id,
                        created_at,
                        updated_at,
                    ),
                    (
                        second_profile,
                        "相同正文不自动去重",
                        5,
                        actor_id,
                        created_at,
                        updated_at,
                    ),
                ],
            )
            connection.commit()

        run_alembic(env, backend_dir, "0031_reusable_platform_prompts")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, name, template_markdown, revision, updated_by, "
                "created_at, updated_at FROM platform_prompts ORDER BY id"
            )
            rows = cursor.fetchall()
            assert {row[0] for row in rows} == {first_profile, second_profile}
            assert {row[1] for row in rows} == {
                "迁移平台甲（prompt-platform-a）",
                "迁移平台乙（prompt-platform-b）",
            }
            assert [row[2] for row in rows] == [
                "相同正文不自动去重",
                "相同正文不自动去重",
            ]
            assert {row[3] for row in rows} == {2, 5}
            assert {row[4] for row in rows} == {actor_id}
            assert {row[5].isoformat() for row in rows} == {created_at}
            assert {row[6].isoformat() for row in rows} == {updated_at}
            cursor.execute(
                "SELECT id, platform_prompt_id FROM platform_profiles "
                "WHERE id IN (%s, %s) ORDER BY id",
                (first_profile, second_profile),
            )
            assert set(cursor.fetchall()) == {
                (first_profile, first_profile),
                (second_profile, second_profile),
            }
            cursor.execute(
                "UPDATE platform_profiles SET platform_prompt_id = %s WHERE id = %s",
                (first_profile, second_profile),
            )
            connection.commit()

        downgrade = subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0030_publication_record_delete"],
            check=False,
            env=env,
            cwd=backend_dir,
            capture_output=True,
            text=True,
        )
        assert downgrade.returncode != 0
        assert "Prompt 已共享或未绑定，无法无损降级" in (
            downgrade.stdout + downgrade.stderr
        )
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0031_reusable_platform_prompts",)


@pytest.mark.integration
def test_content_task_creation_idempotency_migration_preserves_history_and_downgrades() -> None:
    """0032 保留历史空键，以唯一约束保护新请求键，并可无损降级。"""
    with temporary_database("partsignal_content_task_idempotency") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0031_reusable_platform_prompts")
        ids = {
            name: uuid.uuid4()
            for name in ("actor", "product", "fact", "platform_type", "profile", "first", "second")
        }
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO users "
                "(id, username, display_name, password_hash, account_type, is_active, "
                "must_change_password, revision) "
                "VALUES (%s, %s, '0032 迁移用户', 'hash', 'ENGINEER', true, false, 0)",
                (ids["actor"], f"task-idempotency-{ids['actor'].hex[:12]}"),
            )
            cursor.execute(
                "INSERT INTO products "
                "(id, part_number, normalized_part_number, brand, normalized_brand, category, "
                "status, revision, facts_revision, facts_body_markdown, facts_classification) "
                "VALUES (%s, '0032-MIG', %s, 'PartSignal', %s, 'TEST', "
                "'ACTIVE', 0, 0, '迁移事实', 'PUBLIC')",
                (
                    ids["product"],
                    f"0032-{ids['product'].hex}",
                    f"partsignal-{ids['product'].hex}",
                ),
            )
            cursor.execute(
                "INSERT INTO fact_versions "
                "(id, product_id, version, status, body_markdown, classification, "
                "change_summary, revision, created_by, approved_by, approved_at) "
                "VALUES (%s, %s, 1, 'APPROVED', '迁移事实', 'PUBLIC', "
                "'0032 迁移测试', 0, %s, %s, now())",
                (ids["fact"], ids["product"], ids["actor"], ids["actor"]),
            )
            cursor.execute(
                "INSERT INTO platform_types (id, name, slug, revision, created_by) "
                "VALUES (%s, '0032 迁移类型', %s, 0, %s)",
                (
                    ids["platform_type"],
                    f"0032-type-{ids['platform_type'].hex[:12]}",
                    ids["actor"],
                ),
            )
            cursor.execute(
                "INSERT INTO platform_profiles "
                "(id, name, slug, allowed_domains, platform_type_id, revision, is_active) "
                "VALUES (%s, '0032 迁移平台', %s, ARRAY['migration.invalid'], %s, 0, true)",
                (
                    ids["profile"],
                    f"0032-profile-{ids['profile'].hex[:12]}",
                    ids["platform_type"],
                ),
            )
            cursor.execute(
                "INSERT INTO content_tasks "
                "(id, product_id, fact_version_id, platform_profile_id, status, revision, "
                "created_by) VALUES (%s, %s, %s, %s, 'OPEN', 0, %s)",
                (
                    ids["first"],
                    ids["product"],
                    ids["fact"],
                    ids["profile"],
                    ids["actor"],
                ),
            )
            connection.commit()

        run_alembic(env, backend_dir, "0032_content_task_idempotency")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT idempotency_key FROM content_tasks WHERE id = %s",
                (ids["first"],),
            )
            assert cursor.fetchone() == (None,)
            cursor.execute(
                "SELECT constraint_name FROM information_schema.table_constraints "
                "WHERE table_schema = 'public' AND table_name = 'content_tasks' "
                "AND constraint_type = 'UNIQUE'"
            )
            assert "uq_content_tasks_idempotency_key" in {
                row[0] for row in cursor.fetchall()
            }
            cursor.execute(
                "INSERT INTO content_tasks "
                "(id, product_id, fact_version_id, platform_profile_id, status, revision, "
                "created_by) VALUES (%s, %s, %s, %s, 'OPEN', 0, %s)",
                (
                    ids["second"],
                    ids["product"],
                    ids["fact"],
                    ids["profile"],
                    ids["actor"],
                ),
            )
            cursor.execute(
                "UPDATE content_tasks SET idempotency_key = %s WHERE id = %s",
                ("content-task-migration-key", ids["first"]),
            )
            connection.commit()
            with pytest.raises(psycopg.errors.UniqueViolation):
                cursor.execute(
                    "UPDATE content_tasks SET idempotency_key = %s WHERE id = %s",
                    ("content-task-migration-key", ids["second"]),
                )
            connection.rollback()
            cursor.execute(
                "SELECT count(*) FROM content_tasks WHERE idempotency_key IS NULL"
            )
            assert cursor.fetchone() == (1,)

        subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0031_reusable_platform_prompts"],
            check=True,
            env=env,
            cwd=backend_dir,
        )
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = 'content_tasks'"
            )
            assert "idempotency_key" not in {row[0] for row in cursor.fetchall()}
            cursor.execute(
                "SELECT count(*) FROM content_tasks WHERE id IN (%s, %s)",
                (ids["first"], ids["second"]),
            )
            assert cursor.fetchone() == (2,)
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0031_reusable_platform_prompts",)


@pytest.mark.integration
def test_content_task_owned_history_delete_migration_is_reversible() -> None:
    """0033 只在升级态开放任务级清理窗口，降级后恢复绝对不可变守卫。"""
    with temporary_database("partsignal_task_owned_history") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0033_task_owned_history_delete")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_get_functiondef('partsignal_guard_content_version()'::regprocedure)"
            )
            assert "partsignal.content_task_delete_id" in cursor.fetchone()[0]
            cursor.execute(
                "SELECT pg_get_functiondef("
                "'partsignal_guard_content_review_record()'::regprocedure)"
            )
            assert "partsignal.content_task_delete_id" in cursor.fetchone()[0]

        subprocess.run(
            [
                sys.executable,
                "-m",
                "alembic",
                "downgrade",
                "0032_content_task_idempotency",
            ],
            check=True,
            env=env,
            cwd=backend_dir,
        )
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_get_functiondef('partsignal_guard_content_version()'::regprocedure)"
            )
            assert "partsignal.content_task_delete_id" not in cursor.fetchone()[0]
            cursor.execute(
                "SELECT pg_get_triggerdef(oid) FROM pg_trigger "
                "WHERE tgname = 'content_review_records_append_only'"
            )
            assert "partsignal_prevent_change()" in cursor.fetchone()[0]
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0032_content_task_idempotency",)


@pytest.mark.integration
def test_publication_redesign_migration_blocks_legacy_data_atomically() -> None:
    """0034 发现旧发布数据时汇总阻断，且不推进 revision。"""
    with temporary_database("partsignal_publication_redesign_blocked") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0012_ai_data_classification")
        task_id = seed_legacy_content_task(test_url)
        publication_id = seed_legacy_publication(
            test_url,
            task_id,
            cross_platform=False,
        )
        run_alembic(env, backend_dir, "0033_task_owned_history_delete")

        result = run_alembic(env, backend_dir, "0034_publication_redesign", check=False)
        output = result.stdout + result.stderr
        assert result.returncode != 0
        assert "0034 需要先完成已批准的环境重置" in output
        assert "publication_records=1" in output
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0033_task_owned_history_delete",)
            cursor.execute(
                "SELECT count(*) FROM publication_records WHERE id = %s",
                (publication_id,),
            )
            assert cursor.fetchone() == (1,)
            cursor.execute("SELECT to_regclass('public.publication_works')")
            assert cursor.fetchone() == (None,)


def _seed_business_workflow_base(test_url: str) -> dict[str, uuid.UUID]:
    """为 0035 迁移构造最小且真实的事实、内容和平台关系。"""
    ids = {
        name: uuid.uuid4()
        for name in (
            "actor",
            "product",
            "fact",
            "platform_type",
            "profile",
            "account",
            "task",
            "content",
        )
    }
    with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO users "
            "(id, username, display_name, password_hash, account_type, is_active, "
            "must_change_password, revision) "
            "VALUES (%s, %s, '0035 迁移用户', 'hash', 'ENGINEER', true, false, 0)",
            (ids["actor"], f"workflow-{ids['actor'].hex[:12]}"),
        )
        cursor.execute(
            "INSERT INTO products "
            "(id, part_number, normalized_part_number, brand, normalized_brand, category, "
            "status, revision, facts_revision, facts_body_markdown, facts_classification) "
            "VALUES (%s, '0035-MIG', %s, 'PartSignal', %s, 'TEST', "
            "'ACTIVE', 0, 0, '迁移事实', 'PUBLIC')",
            (
                ids["product"],
                f"0035-{ids['product'].hex}",
                f"partsignal-{ids['product'].hex}",
            ),
        )
        cursor.execute(
            "INSERT INTO fact_versions "
            "(id, product_id, version, status, body_markdown, classification, "
            "change_summary, revision, created_by, approved_by, approved_at) "
            "VALUES (%s, %s, 1, 'APPROVED', '迁移事实', 'PUBLIC', "
            "'0035 迁移测试', 0, %s, %s, now())",
            (ids["fact"], ids["product"], ids["actor"], ids["actor"]),
        )
        cursor.execute(
            "INSERT INTO platform_types (id, name, slug, revision, created_by) "
            "VALUES (%s, '0035 迁移类型', %s, 0, %s)",
            (
                ids["platform_type"],
                f"0035-type-{ids['platform_type'].hex[:12]}",
                ids["actor"],
            ),
        )
        cursor.execute(
            "INSERT INTO platform_profiles "
            "(id, name, slug, allowed_domains, platform_type_id, revision, is_active) "
            "VALUES (%s, '0035 迁移平台', %s, ARRAY['migration.invalid'], %s, 0, true)",
            (
                ids["profile"],
                f"0035-profile-{ids['profile'].hex[:12]}",
                ids["platform_type"],
            ),
        )
        cursor.execute(
            "INSERT INTO platform_accounts "
            "(id, platform_profile_id, label, account_identifier, is_active, revision) "
            "VALUES (%s, %s, '0035 迁移账号', %s, true, 0)",
            (ids["account"], ids["profile"], f"account-{ids['account'].hex[:12]}"),
        )
        cursor.execute(
            "INSERT INTO content_tasks "
            "(id, product_id, fact_version_id, platform_profile_id, status, revision, "
            "created_by) VALUES (%s, %s, %s, %s, 'OPEN', 0, %s)",
            (
                ids["task"],
                ids["product"],
                ids["fact"],
                ids["profile"],
                ids["actor"],
            ),
        )
        cursor.execute(
            "INSERT INTO content_versions "
            "(id, task_id, fact_version_id, version, source_type, title, summary, "
            "body_markdown, tags, content_hash, status, revision, quality_issues, "
            "change_summary, created_by) "
            "VALUES (%s, %s, %s, 1, 'HUMAN', '迁移内容', '迁移摘要', '迁移正文', "
            "ARRAY['迁移'], %s, 'APPROVED', 0, '[]'::jsonb, '0035 迁移内容', %s)",
            (
                ids["content"],
                ids["task"],
                ids["fact"],
                "a" * 64,
                ids["actor"],
            ),
        )
        connection.commit()
    return ids


@pytest.mark.integration
def test_business_workflow_migration_backfills_and_guards_authoritative_owners() -> None:
    """0035 确定性回填当前版本、发布来源与核验版本，并建立最终守卫。"""
    with temporary_database("partsignal_business_workflow") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0034_publication_redesign")
        ids = _seed_business_workflow_base(test_url)
        work_id, verification_id = uuid.uuid4(), uuid.uuid4()
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO publication_works "
                "(id, idempotency_key, content_version_id, platform_profile_id, "
                "platform_account_id, content_hash, section_url, actual_title, final_url, "
                "published_at, status, revision, created_by) "
                "VALUES (%s, %s, %s, %s, %s, %s, 'https://migration.invalid/section', "
                "NULL, NULL, NULL, 'PREPARING', 0, %s)",
                (
                    work_id,
                    f"work-{work_id.hex}",
                    ids["content"],
                    ids["profile"],
                    ids["account"],
                    "a" * 64,
                    ids["actor"],
                ),
            )
            cursor.execute(
                "UPDATE publication_works SET actual_title = '迁移内容', "
                "final_url = 'https://migration.invalid/article', published_at = now(), "
                "status = 'AWAITING_VERIFICATION', revision = 1 WHERE id = %s",
                (work_id,),
            )
            cursor.execute(
                "INSERT INTO publication_verifications "
                "(id, publication_work_id, outcome, actual_title_snapshot, "
                "final_url_snapshot, published_at_snapshot, comment, actor_id) "
                "SELECT %s, id, 'FAILED', actual_title, final_url, published_at, "
                "'迁移失败核验', %s FROM publication_works WHERE id = %s",
                (verification_id, ids["actor"], work_id),
            )
            connection.commit()

        run_alembic(env, backend_dir, "0035_business_workflow")
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT current_content_version_id FROM content_tasks WHERE id = %s",
                (ids["task"],),
            )
            assert cursor.fetchone() == (ids["content"],)
            cursor.execute(
                "SELECT content_task_id FROM publication_works WHERE id = %s",
                (work_id,),
            )
            assert cursor.fetchone() == (ids["task"],)
            cursor.execute(
                "SELECT content_version_id FROM publication_verifications WHERE id = %s",
                (verification_id,),
            )
            assert cursor.fetchone() == (ids["content"],)

            with pytest.raises(psycopg.errors.CheckViolation):
                cursor.execute(
                    "INSERT INTO fact_versions "
                    "(id, product_id, version, status, body_markdown, classification, "
                    "change_summary, revision, created_by) "
                    "VALUES (%s, %s, 2, 'DRAFT', '禁止草稿', 'PUBLIC', '禁止草稿', 0, %s)",
                    (uuid.uuid4(), ids["product"], ids["actor"]),
                )
            connection.rollback()

            downgrade = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "alembic",
                    "downgrade",
                    "0034_publication_redesign",
                ],
                check=False,
                env=env,
                cwd=backend_dir,
                capture_output=True,
                text=True,
            )
            assert downgrade.returncode != 0
            assert "0035 无法安全降级" in downgrade.stdout + downgrade.stderr


@pytest.mark.integration
def test_remove_publication_section_url_migration_preserves_work_and_guards() -> None:
    """0036 只删除栏目地址，并保留发布工作数据和最终守卫。"""
    with temporary_database("partsignal_remove_section_url") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0034_publication_redesign")
        ids = _seed_business_workflow_base(test_url)
        work_id = uuid.uuid4()
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO publication_works "
                "(id, idempotency_key, content_version_id, platform_profile_id, "
                "platform_account_id, content_hash, section_url, status, revision, created_by) "
                "VALUES (%s, %s, %s, %s, %s, %s, "
                "'https://migration.invalid/section', 'PREPARING', 0, %s)",
                (
                    work_id,
                    f"work-{work_id.hex}",
                    ids["content"],
                    ids["profile"],
                    ids["account"],
                    "a" * 64,
                    ids["actor"],
                ),
            )
            connection.commit()

        run_alembic(env, backend_dir, "0035_business_workflow")
        run_alembic(env, backend_dir, "0036_remove_section_url")

        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = 'publication_works' "
                "AND column_name = 'section_url'"
            )
            assert cursor.fetchone() is None
            cursor.execute(
                "SELECT content_task_id, content_version_id, platform_profile_id, "
                "platform_account_id, content_hash, status, revision, created_by "
                "FROM publication_works WHERE id = %s",
                (work_id,),
            )
            assert cursor.fetchone() == (
                ids["task"],
                ids["content"],
                ids["profile"],
                ids["account"],
                "a" * 64,
                "PREPARING",
                0,
                ids["actor"],
            )
            cursor.execute(
                "SELECT pg_get_functiondef("
                "'partsignal_guard_publication_work()'::regprocedure)"
            )
            assert "section_url" not in cursor.fetchone()[0]

            second_account_id = uuid.uuid4()
            cursor.execute(
                "INSERT INTO platform_accounts "
                "(id, platform_profile_id, label, account_identifier, is_active, revision) "
                "VALUES (%s, %s, '0036 迁移账号', %s, true, 0)",
                (
                    second_account_id,
                    ids["profile"],
                    f"account-{second_account_id.hex[:12]}",
                ),
            )
            cursor.execute(
                "UPDATE publication_works SET actual_title = '迁移内容', "
                "final_url = 'https://migration.invalid/article', published_at = now(), "
                "status = 'AWAITING_VERIFICATION', revision = 1 WHERE id = %s",
                (work_id,),
            )
            connection.commit()

            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute(
                    "UPDATE publication_works SET platform_account_id = %s, revision = 2 "
                    "WHERE id = %s",
                    (second_account_id, work_id),
                )
            connection.rollback()
            with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
                cursor.execute("DELETE FROM publication_works WHERE id = %s", (work_id,))
            connection.rollback()

        downgrade = subprocess.run(
            [
                sys.executable,
                "-m",
                "alembic",
                "downgrade",
                "0035_business_workflow",
            ],
            check=False,
            env=env,
            cwd=backend_dir,
            capture_output=True,
            text=True,
        )
        assert downgrade.returncode != 0
        assert "0036 无法安全降级" in downgrade.stdout + downgrade.stderr
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0036_remove_section_url",)


@pytest.mark.integration
def test_business_workflow_migration_blocks_ambiguous_fact_history_atomically() -> None:
    """0035 对事实草稿和同产品多条待审核记录返回 55000，且不推进 revision。"""
    with temporary_database("partsignal_business_workflow_blocked") as (
        test_url,
        env,
        backend_dir,
    ):
        run_alembic(env, backend_dir, "0034_publication_redesign")
        ids = _seed_business_workflow_base(test_url)
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO fact_versions "
                "(id, product_id, version, status, body_markdown, classification, "
                "change_summary, revision, created_by) "
                "VALUES (%s, %s, %s, %s, '歧义事实', 'PUBLIC', '歧义测试', 0, %s)",
                [
                    (uuid.uuid4(), ids["product"], 2, "DRAFT", ids["actor"]),
                    (uuid.uuid4(), ids["product"], 3, "PENDING_REVIEW", ids["actor"]),
                    (uuid.uuid4(), ids["product"], 4, "PENDING_REVIEW", ids["actor"]),
                ],
            )
            connection.commit()

        result = run_alembic(
            env,
            backend_dir,
            "0035_business_workflow",
            check=False,
        )
        output = result.stdout + result.stderr
        assert result.returncode != 0
        assert "0035 业务主线存在歧义" in output
        assert "fact_versions.DRAFT=1" in output
        assert "fact_versions.multiple_pending=1" in output
        with psycopg.connect(test_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0034_publication_redesign",)
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'content_tasks' AND column_name = 'current_content_version_id'"
            )
            assert cursor.fetchone() is None
