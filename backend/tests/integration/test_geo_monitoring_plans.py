"""真实 PostgreSQL 的计划完整性、关系唯一、生命周期与并发最终防线。"""

import subprocess
import sys
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from psycopg import sql
from psycopg.types.json import Jsonb
from sqlalchemy import create_engine

from app.db import Base
from tests.integration.test_geo_catalog import insert_row
from tests.integration.test_migrations import run_alembic, temporary_database
from tests.unit.test_geo_surface_contract import capabilities

pytestmark = pytest.mark.integration
TABLES = {
    "geo_monitoring_plans",
    "geo_monitoring_plan_subjects",
    "geo_monitoring_plan_prompts",
    "geo_monitoring_plan_profiles",
}


@dataclass
class PlanDatabase:
    url: str
    env: dict[str, str]
    backend_dir: Path
    actor: UUID
    subjects: list[UUID]
    prompt: UUID
    profile: UUID
    before: list[Any]


def existing_rows(conn: psycopg.Connection[Any]) -> list[Any]:
    return [
        conn.execute(
            "SELECT to_jsonb(t)"
            + (
                "-ARRAY['last_test_error_code','last_test_error_summary',"
                "'test_attempt_id','session_revision']"
                if name == "geo_collection_profiles"
                else ""
            )
            + f" FROM {name} t ORDER BY id"
        ).fetchall()
        for name in [
            "users",
            "query_topics",
            "geo_subjects",
            "geo_prompt_variants",
            "geo_engine_surfaces",
            "geo_collection_profiles",
            "geo_observations",
        ]
    ]


@pytest.fixture(scope="module")
def plan_database() -> Iterator[PlanDatabase]:
    with temporary_database("partsignal_geo206") as (url, env, backend_dir):
        run_alembic(env, backend_dir, "0046_geo_surfaces_profiles")
        actor, topic, prompt, surface, profile = [uuid4() for _ in range(5)]
        subjects = [uuid4(), uuid4()]
        with psycopg.connect(url) as conn:
            insert_row(
                conn,
                "users",
                {
                    "id": actor,
                    "username": f"geo206-{actor}",
                    "display_name": "虚构用户",
                    "password_hash": "unused",
                    "account_type": "ADMIN",
                    "is_active": True,
                    "must_change_password": False,
                    "revision": 0,
                },
            )
            insert_row(
                conn,
                "query_topics",
                {
                    "id": topic,
                    "canonical_question": "虚构原问题",
                    "intent_type": "REPLACEMENT",
                    "variants": ["保留旧问题"],
                    "revision": 0,
                },
            )
            for subject in subjects:
                insert_row(
                    conn,
                    "geo_subjects",
                    {
                        "id": subject,
                        "subject_type": "OWN_BRAND",
                        "canonical_name": "虚构原品牌",
                        "normalized_name": "虚构原品牌",
                        "display_name": "虚构原品牌",
                        "created_by": actor,
                    },
                )
            insert_row(
                conn,
                "geo_prompt_variants",
                {
                    "id": prompt,
                    "query_topic_id": topic,
                    "prompt_text": "虚构测试问题",
                    "mention_mode": "UNBRANDED",
                    "language_code": "zh-hans",
                    "region_code": "CN",
                    "priority": "CORE",
                    "created_by": actor,
                },
            )
            insert_row(
                conn,
                "geo_engine_surfaces",
                {
                    "id": surface,
                    "name": "虚构平台",
                    "slug": "fictional-206",
                    "surface_kind": "MANUAL_SITE",
                    "provider_brand": "CUSTOM",
                    "capabilities": Jsonb(capabilities()),
                    "created_by": actor,
                },
            )
            insert_row(
                conn,
                "geo_collection_profiles",
                {
                    "id": profile,
                    "engine_surface_id": surface,
                    "name": "虚构人工配置",
                    "collection_mode": "MANUAL",
                    "adapter_key": "manual",
                    "language_code": "zh-hans",
                    "region_code": "CN",
                    "login_state": "ANONYMOUS",
                    "web_search_policy": "UNKNOWN",
                    "settings_json": Jsonb({}),
                    "created_by": actor,
                },
            )
            before = existing_rows(conn)
        run_alembic(env, backend_dir, "0047_geo_monitoring_plans")
        yield PlanDatabase(url, env, backend_dir, actor, subjects, prompt, profile, before)


@pytest.fixture
def connection(plan_database: PlanDatabase) -> Iterator[psycopg.Connection[Any]]:
    with psycopg.connect(plan_database.url) as conn:
        yield conn
        conn.rollback()


def insert_plan(
    conn: psycopg.Connection[Any],
    db: PlanDatabase,
    *,
    omit: str | None = None,
    two_primary: bool = False,
    **patch: Any,
) -> UUID:
    identity = uuid4()
    insert_row(
        conn,
        "geo_monitoring_plans",
        {
            "id": identity,
            "name": "虚构计划",
            "created_by": db.actor,
            "updated_by": db.actor,
            **patch,
        },
    )
    if omit != "subjects":
        for subject in db.subjects if two_primary else db.subjects[:1]:
            insert_row(
                conn,
                "geo_monitoring_plan_subjects",
                {"plan_id": identity, "subject_id": subject, "role": "PRIMARY"},
            )
    if omit != "prompts":
        insert_row(
            conn,
            "geo_monitoring_plan_prompts",
            {"plan_id": identity, "prompt_variant_id": db.prompt},
        )
    if omit != "profiles":
        insert_row(
            conn,
            "geo_monitoring_plan_profiles",
            {"plan_id": identity, "collection_profile_id": db.profile},
        )
    return identity


def test_forward_preserves_existing_data_and_metadata(plan_database: PlanDatabase) -> None:
    db = plan_database
    with psycopg.connect(db.url) as conn:
        assert existing_rows(conn) == db.before
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0047_geo_monitoring_plans"
        )
        names = {
            row[0]
            for row in conn.execute("SELECT tablename FROM pg_tables WHERE schemaname='public'")
        }
        assert names >= TABLES
        assert not {"geo_observation_batches", "geo_observation_runs"} & names
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://", 1))
    try:
        with engine.connect() as conn:
            context = MigrationContext.configure(
                conn,
                opts={
                    "compare_type": True,
                    "compare_server_default": True,
                    "include_object": lambda obj, name, kind, reflected, compared: (
                        obj.name in TABLES if kind == "table" else obj.table.name in TABLES
                    ),
                },
            )
            assert compare_metadata(context, Base.metadata) == []
    finally:
        engine.dispose()
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0046_geo_surfaces_profiles"],
        cwd=db.backend_dir,
        env=db.env,
        capture_output=True,
        text=True,
    )
    assert (
        result.returncode != 0
        and "0047 MonitoringPlan 无法安全降级" in result.stdout + result.stderr
    )
    with psycopg.connect(db.url) as conn:
        assert existing_rows(conn) == db.before
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0047_geo_monitoring_plans"
        )


def test_defaults_and_valid_configuration(
    connection: psycopg.Connection[Any], plan_database: PlanDatabase
) -> None:
    identity = insert_plan(
        connection,
        plan_database,
        schedule_kind="CRON",
        cron_expression="0 9 * * mon-fri",
        timezone="America/Los_Angeles",
        budget_limit="0.000001",
    )
    connection.execute("SET CONSTRAINTS ALL IMMEDIATE")
    row = connection.execute(
        "SELECT status,repeat_count,revision,rule_set_revision,budget_limit "
        "FROM geo_monitoring_plans WHERE id=%s",
        (identity,),
    ).fetchone()
    assert row[:4] == ("DISABLED", 3, 0, 1) and str(row[4]) == "0.000001"
    assert connection.execute(
        "SELECT first_referenced_at FROM geo_prompt_variants WHERE id=%s", (plan_database.prompt,)
    ).fetchone() == (None,)


@pytest.mark.parametrize(
    "omit,suffix", [("subjects", "primary"), ("prompts", "prompt"), ("profiles", "profile")]
)
def test_incomplete_plan_fails_at_commit(
    plan_database: PlanDatabase, omit: str, suffix: str
) -> None:
    with psycopg.connect(plan_database.url) as conn:
        identity = insert_plan(conn, plan_database, omit=omit)
        with pytest.raises(psycopg.errors.CheckViolation) as error:
            conn.commit()
        assert error.value.diag.constraint_name == f"ck_geo_monitoring_plans_{suffix}_required"
        conn.rollback()
        assert (
            conn.execute("SELECT 1 FROM geo_monitoring_plans WHERE id=%s", (identity,)).fetchone()
            is None
        )


@pytest.mark.parametrize(
    "column,value,constraint",
    [
        ("name", " ", "name"),
        ("status", "RUNNING", "status"),
        ("repeat_count", 0, "repeat"),
        ("repeat_count", 11, "repeat"),
        ("schedule_kind", "DAILY", "schedule"),
        ("schedule_kind", "CRON", "schedule"),
        ("cron_expression", "* * * * *", "schedule"),
        ("timezone", "Unknown/Zone", "timezone"),
        ("budget_limit", "-0.000001", "budget"),
        ("budget_limit", "NaN", "budget"),
        ("revision", -1, "revision"),
        ("rule_set_revision", 0, "rule_revision"),
    ],
)
def test_named_checks(
    connection: psycopg.Connection[Any],
    plan_database: PlanDatabase,
    column: str,
    value: Any,
    constraint: str,
) -> None:
    identity = insert_plan(connection, plan_database)
    with pytest.raises(psycopg.errors.CheckViolation) as error:
        connection.execute(
            sql.SQL("UPDATE geo_monitoring_plans SET {}=%s WHERE id=%s").format(
                sql.Identifier(column)
            ),
            (value, identity),
        )
    assert error.value.diag.constraint_name == f"ck_geo_monitoring_plans_{constraint}"


@pytest.mark.parametrize(
    "suffix,column",
    [
        ("subjects", "subject_id"),
        ("prompts", "prompt_variant_id"),
        ("profiles", "collection_profile_id"),
    ],
)
def test_relationship_unique_and_resource_delete_restricted(
    connection: psycopg.Connection[Any], plan_database: PlanDatabase, suffix: str, column: str
) -> None:
    db = plan_database
    identity = insert_plan(connection, db)
    resource = {"subjects": db.subjects[0], "prompts": db.prompt, "profiles": db.profile}[suffix]
    with pytest.raises(psycopg.errors.UniqueViolation) as error, connection.transaction():
        values = {"plan_id": identity, column: resource}
        if suffix == "subjects":
            values["role"] = "REFERENCE"
        insert_row(connection, f"geo_monitoring_plan_{suffix}", values)
    assert error.value.diag.constraint_name == f"pk_geo_monitoring_plan_{suffix}"
    target = {
        "subjects": "geo_subjects",
        "prompts": "geo_prompt_variants",
        "profiles": "geo_collection_profiles",
    }[suffix]
    with pytest.raises(psycopg.errors.ForeignKeyViolation) as error, connection.transaction():
        connection.execute(
            sql.SQL("DELETE FROM {} WHERE id=%s").format(sql.Identifier(target)), (resource,)
        )
    label = {"subjects": "subject", "prompts": "prompt", "profiles": "profile"}[suffix]
    assert error.value.diag.constraint_name == f"fk_geo_monitoring_plan_{suffix}_{label}"


@pytest.mark.parametrize(
    "statement,constraint",
    [
        (
            "UPDATE geo_monitoring_plan_subjects SET role='UNKNOWN' WHERE plan_id=%s",
            "subjects_role",
        ),
        (
            "UPDATE geo_monitoring_plan_subjects SET role='REFERENCE' WHERE plan_id=%s",
            "primary_required",
        ),
        ("DELETE FROM geo_monitoring_plan_prompts WHERE plan_id=%s", "prompt_required"),
        ("DELETE FROM geo_monitoring_plan_profiles WHERE plan_id=%s", "profile_required"),
    ],
)
def test_membership_changes_cannot_break_complete_plan(
    plan_database: PlanDatabase, statement: str, constraint: str
) -> None:
    with psycopg.connect(plan_database.url) as conn:
        identity = insert_plan(conn, plan_database)
        conn.commit()
        with pytest.raises(psycopg.errors.CheckViolation) as error:
            conn.execute(statement, (identity,))
            conn.commit()
        prefix = (
            "ck_geo_monitoring_plan_"
            if constraint == "subjects_role"
            else "ck_geo_monitoring_plans_"
        )
        assert error.value.diag.constraint_name == prefix + constraint
        conn.rollback()
        assert conn.execute(
            "SELECT role FROM geo_monitoring_plan_subjects WHERE plan_id=%s", (identity,)
        ).fetchone() == ("PRIMARY",)
        for suffix in ["prompts", "profiles"]:
            assert conn.execute(
                f"SELECT count(*) FROM geo_monitoring_plan_{suffix} WHERE plan_id=%s", (identity,)
            ).fetchone() == (1,)
        conn.execute("DELETE FROM geo_monitoring_plans WHERE id=%s", (identity,))


def test_replace_membership_then_archive_and_delete_rules(
    connection: psycopg.Connection[Any], plan_database: PlanDatabase
) -> None:
    identity = insert_plan(connection, plan_database)
    connection.execute("DELETE FROM geo_monitoring_plan_subjects WHERE plan_id=%s", (identity,))
    insert_row(
        connection,
        "geo_monitoring_plan_subjects",
        {"plan_id": identity, "subject_id": plan_database.subjects[1], "role": "PRIMARY"},
    )
    connection.execute("SET CONSTRAINTS ALL IMMEDIATE")
    connection.execute(
        "UPDATE geo_monitoring_plans SET status='ARCHIVED', revision=revision+1 WHERE id=%s",
        (identity,),
    )
    for statement in [
        "UPDATE geo_monitoring_plans SET name='新名称' WHERE id=%s",
        "DELETE FROM geo_monitoring_plans WHERE id=%s",
        "DELETE FROM geo_monitoring_plan_subjects WHERE plan_id=%s",
    ]:
        with pytest.raises(psycopg.errors.CheckViolation) as error, connection.transaction():
            connection.execute(statement, (identity,))
        assert error.value.diag.constraint_name == "ck_geo_monitoring_plans_archived"
    connection.execute("SET CONSTRAINTS ALL DEFERRED")
    unused = insert_plan(connection, plan_database)
    connection.execute("DELETE FROM geo_monitoring_plans WHERE id=%s", (unused,))
    for suffix in ["subjects", "prompts", "profiles"]:
        assert (
            connection.execute(
                f"SELECT 1 FROM geo_monitoring_plan_{suffix} WHERE plan_id=%s", (unused,)
            ).fetchone()
            is None
        )


@pytest.mark.parametrize("isolation", ["READ COMMITTED", "REPEATABLE READ"])
def test_concurrent_last_primary_removal_cannot_write_skew(
    plan_database: PlanDatabase, isolation: str
) -> None:
    db = plan_database
    with psycopg.connect(db.url) as seed:
        identity = insert_plan(seed, db, two_primary=True)
    with (
        psycopg.connect(db.url) as first,
        psycopg.connect(db.url) as second,
        ThreadPoolExecutor(max_workers=1) as pool,
    ):
        first.execute(f"SET TRANSACTION ISOLATION LEVEL {isolation}")
        second.execute(f"SET TRANSACTION ISOLATION LEVEL {isolation}")
        second.execute("SET LOCAL statement_timeout = '5s'")
        second.execute(
            "SELECT count(*) FROM geo_monitoring_plan_subjects WHERE plan_id=%s", (identity,)
        )
        first.execute(
            "DELETE FROM geo_monitoring_plan_subjects WHERE plan_id=%s AND subject_id=%s",
            (identity, db.subjects[0]),
        )
        pid = second.info.backend_pid

        def remove() -> str:
            try:
                second.execute(
                    "DELETE FROM geo_monitoring_plan_subjects WHERE plan_id=%s AND subject_id=%s",
                    (identity, db.subjects[1]),
                )
                second.commit()
                return "committed"
            except psycopg.Error as error:
                second.rollback()
                return error.sqlstate

        future = pool.submit(remove)
        deadline = time.monotonic() + 4
        with psycopg.connect(db.url, autocommit=True) as observer:
            while not observer.execute(
                "SELECT cardinality(pg_blocking_pids(%s))", (pid,)
            ).fetchone()[0]:
                assert time.monotonic() < deadline, "未观测到数据库锁等待"
                time.sleep(0.02)
        first.commit()
        assert future.result(timeout=6) == ("23514" if isolation == "READ COMMITTED" else "40001")
    with psycopg.connect(db.url) as conn:
        assert conn.execute(
            "SELECT count(*) FROM geo_monitoring_plan_subjects WHERE plan_id=%s AND role='PRIMARY'",
            (identity,),
        ).fetchone() == (1,)
        conn.execute("DELETE FROM geo_monitoring_plans WHERE id=%s", (identity,))
