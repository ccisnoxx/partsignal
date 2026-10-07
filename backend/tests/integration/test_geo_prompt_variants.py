"""真实 PostgreSQL 的迁移、唯一性、规范化、历史锁存和并发保护。"""

from __future__ import annotations

import hashlib
import subprocess
import sys
import time
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.errors import AppError
from app.geo_prompt_variants import normalize_prompt_text
from app.models.configuration import QueryTopic
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.identity import User
from app.services.content_planning import delete_query_topic, query_topics_out
from app.services.identity import delete_user, users_out
from tests.integration.test_geo_catalog import insert_row
from tests.integration.test_migrations import run_alembic, temporary_database

pytestmark = pytest.mark.integration


@dataclass
class VariantDatabase:
    url: str
    env: dict[str, str]
    backend_dir: Path
    actor: uuid.UUID
    admin: uuid.UUID
    topic: uuid.UUID
    before: list[Any]


def snapshot(connection: psycopg.Connection[Any]) -> list[Any]:
    return [
        connection.execute(f"SELECT to_jsonb(t) FROM {table} t ORDER BY id").fetchall()
        for table in ["query_topics", "users", "geo_subjects", "geo_observations"]
    ]


@contextmanager
def prepared_variant_database(target_revision: str) -> Iterator[VariantDatabase]:
    with temporary_database("partsignal_geo201") as (url, env, backend_dir):
        run_alembic(env, backend_dir, "0044_geo_catalog")
        actor, admin, topic = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        with psycopg.connect(url) as connection:
            for user, active in [(actor, False), (admin, True)]:
                insert_row(
                    connection,
                    "users",
                    {
                        "id": user,
                        "username": f"geo201-{user}",
                        "display_name": "虚构用户",
                        "password_hash": "not-used",
                        "account_type": "ADMIN",
                        "is_active": active,
                        "must_change_password": False,
                        "revision": 0,
                    },
                )
            insert_row(
                connection,
                "query_topics",
                {
                    "id": topic,
                    "canonical_question": "原主题",
                    "intent_type": "REPLACEMENT",
                    "variants": ["原问题数组"],
                    "revision": 0,
                },
            )
            insert_row(
                connection,
                "geo_subjects",
                {
                    "id": uuid.uuid4(),
                    "subject_type": "OWN_BRAND",
                    "canonical_name": "原品牌",
                    "normalized_name": "原品牌",
                    "display_name": "原品牌",
                    "created_by": admin,
                },
            )
            before = snapshot(connection)
        run_alembic(env, backend_dir, target_revision)
        yield VariantDatabase(url, env, backend_dir, actor, admin, topic, before)


@pytest.fixture(scope="module")
def variant_database() -> Iterator[VariantDatabase]:
    # 当前服务使用 head；历史迁移验收使用独立数据库，避免夹具相互污染。
    with prepared_variant_database("head") as database:
        yield database


@pytest.fixture(scope="module")
def variant_migration_database() -> Iterator[VariantDatabase]:
    with prepared_variant_database("0045_geo_prompt_variants") as database:
        yield database


@pytest.fixture
def connection(variant_database: VariantDatabase) -> Iterator[psycopg.Connection[Any]]:
    with psycopg.connect(variant_database.url) as connection:
        try:
            yield connection
        finally:
            connection.rollback()


def insert_variant(
    connection: psycopg.Connection[Any], database: VariantDatabase, **patch: Any
) -> uuid.UUID:
    values = {
        "id": uuid.uuid4(),
        "query_topic_id": database.topic,
        "prompt_text": f"虚构问题 {uuid.uuid4()}",
        "mention_mode": "UNBRANDED",
        "language_code": "zh-hans",
        "region_code": "CN",
        "priority": "STANDARD",
        "created_by": database.actor,
        **patch,
    }
    insert_row(connection, "geo_prompt_variants", values)
    return values["id"]


def mark_referenced(connection: psycopg.Connection[Any], variant: uuid.UUID) -> None:
    connection.execute(
        "UPDATE geo_prompt_variants SET first_referenced_at = now(), "
        "revision = revision + 1, updated_at = now() WHERE id = %s",
        (variant,),
    )


def test_additive_migration_metadata_and_safe_stop(
    variant_migration_database: VariantDatabase,
) -> None:
    database = variant_migration_database
    with psycopg.connect(database.url) as connection:
        assert snapshot(connection) == database.before
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0045_geo_prompt_variants",
        )
        assert connection.execute("SELECT count(*) FROM geo_prompt_variants").fetchone() == (0,)
    engine = create_engine(database.url.replace("postgresql://", "postgresql+psycopg://", 1))
    try:
        with engine.connect() as connection:
            context = MigrationContext.configure(
                connection,
                opts={
                    "compare_type": True,
                    "compare_server_default": True,
                    "include_object": lambda obj, name, kind, reflected, compared: (
                        kind != "table" or name == "geo_prompt_variants"
                    ),
                },
            )
            assert compare_metadata(context, Base.metadata) == []
        with Session(engine) as session:
            variant = GeoPromptVariant(
                query_topic_id=database.topic,
                prompt_text="ORM 问题",
                mention_mode="BRANDED",
                language_code="en",
                region_code="US",
                priority="CORE",
                created_by=database.actor,
            )
            session.add(variant)
            session.flush()
            assert (
                variant.is_active and variant.revision == 0 and variant.first_referenced_at is None
            )
            assert variant.normalized_hash == hashlib.sha256(b"ORM " + "问题".encode()).hexdigest()
            session.rollback()
    finally:
        engine.dispose()
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0044_geo_catalog"],
        env=database.env,
        cwd=database.backend_dir,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "0045 GEO PromptVariant 无法安全降级" in result.stdout + result.stderr
    with psycopg.connect(database.url) as connection:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0045_geo_prompt_variants",
        )


def test_sql_normalization_matches_python_and_generated_hash(
    connection: psycopg.Connection[Any],
    variant_database: VariantDatabase,
) -> None:
    whitespace = "".join(chr(code) for code in range(0x110000) if chr(code).isspace())
    for value in [" ＰＳ-10Ａ\u00a0 e\u0301？ ", f"{whitespace}A{whitespace}B{whitespace}"]:
        canonical = normalize_prompt_text(value)
        assert connection.execute("SELECT geo_normalize_prompt_text(%s)", (value,)).fetchone() == (
            canonical,
        )
        variant = insert_variant(connection, variant_database, prompt_text=canonical)
        assert connection.execute(
            "SELECT normalized_hash FROM geo_prompt_variants WHERE id=%s", (variant,)
        ).fetchone() == (hashlib.sha256(canonical.encode()).hexdigest(),)
    with pytest.raises(psycopg.errors.GeneratedAlways), connection.transaction():
        insert_variant(connection, variant_database, normalized_hash="a" * 64)


def test_unique_key_includes_dimensions_and_disabled_rows(
    connection: psycopg.Connection[Any],
    variant_database: VariantDatabase,
) -> None:
    insert_variant(connection, variant_database, prompt_text="PS-10A?", is_active=False)
    with pytest.raises(psycopg.errors.UniqueViolation) as failure, connection.transaction():
        insert_variant(connection, variant_database, prompt_text="PS-10A?", priority="CORE")
    assert failure.value.diag.constraint_name == "uq_geo_prompt_variants_identity"
    for patch in [
        {"mention_mode": "BRANDED"},
        {"language_code": "en"},
        {"region_code": "US"},
        {"prompt_text": "ps-10a?"},
        {"prompt_text": "PS-10B?"},
    ]:
        insert_variant(connection, variant_database, **{"prompt_text": "PS-10A?", **patch})
    topic = uuid.uuid4()
    insert_row(
        connection,
        "query_topics",
        {
            "id": topic,
            "canonical_question": "另一个主题",
            "intent_type": "REPLACEMENT",
            "variants": [],
            "revision": 0,
        },
    )
    insert_variant(connection, variant_database, prompt_text="PS-10A?", query_topic_id=topic)


@pytest.mark.parametrize(
    "patch,constraint",
    [
        ({"prompt_text": "  未规范  "}, "ck_geo_prompt_variants_prompt"),
        ({"prompt_text": "   "}, "ck_geo_prompt_variants_prompt"),
        ({"mention_mode": "AUTO"}, "ck_geo_prompt_variants_mention_mode"),
        ({"language_code": "ZH"}, "ck_geo_prompt_variants_language"),
        ({"region_code": "cn"}, "ck_geo_prompt_variants_region"),
        ({"priority": "P0"}, "ck_geo_prompt_variants_priority"),
        ({"revision": 1}, "ck_geo_prompt_variants_initial"),
    ],
)
def test_database_rejects_noncanonical_contract(
    connection: psycopg.Connection[Any],
    variant_database: VariantDatabase,
    patch: dict[str, Any],
    constraint: str,
) -> None:
    with pytest.raises(psycopg.errors.CheckViolation) as failure, connection.transaction():
        insert_variant(connection, variant_database, **patch)
    assert failure.value.diag.constraint_name == constraint


def test_history_only_allows_disable_and_mark_rolls_back(
    connection: psycopg.Connection[Any],
    variant_database: VariantDatabase,
) -> None:
    variant = insert_variant(connection, variant_database)
    with connection.transaction():
        mark_referenced(connection, variant)
        raise psycopg.Rollback()
    assert connection.execute(
        "SELECT revision, first_referenced_at FROM geo_prompt_variants WHERE id=%s", (variant,)
    ).fetchone() == (0, None)
    mark_referenced(connection, variant)
    for assignment in [
        "prompt_text='新问题'",
        "mention_mode='BRANDED'",
        "language_code='en'",
        "region_code='US'",
        "priority='CORE'",
        "first_referenced_at=NULL",
        "first_referenced_at=first_referenced_at + interval '1 second'",
    ]:
        with pytest.raises(psycopg.errors.CheckViolation) as failure, connection.transaction():
            connection.execute(
                f"UPDATE geo_prompt_variants SET {assignment}, revision=revision+1 WHERE id=%s",
                (variant,),
            )
        assert failure.value.diag.constraint_name == "ck_geo_prompt_variants_history"
    with pytest.raises(psycopg.errors.CheckViolation), connection.transaction():
        connection.execute("DELETE FROM geo_prompt_variants WHERE id=%s", (variant,))
    connection.execute(
        "UPDATE geo_prompt_variants SET is_active=false, revision=revision+1, "
        "updated_at=now() WHERE id=%s",
        (variant,),
    )
    with pytest.raises(psycopg.errors.CheckViolation), connection.transaction():
        connection.execute(
            "UPDATE geo_prompt_variants SET is_active=true, revision=revision+1 WHERE id=%s",
            (variant,),
        )
    assert connection.execute(
        "SELECT revision, is_active FROM geo_prompt_variants WHERE id=%s", (variant,)
    ).fetchone() == (2, False)


def test_revision_and_identity_guards(
    connection: psycopg.Connection[Any], variant_database: VariantDatabase
) -> None:
    variant = insert_variant(connection, variant_database)
    for assignment, constraint in [
        ("priority='CORE'", "ck_geo_prompt_variants_revision_step"),
        ("revision=2", "ck_geo_prompt_variants_revision_step"),
        ("revision=1", "ck_geo_prompt_variants_revision_step"),
        (f"created_by='{variant_database.admin}'", "ck_geo_prompt_variants_identity"),
    ]:
        with pytest.raises(psycopg.errors.CheckViolation) as failure, connection.transaction():
            connection.execute(
                f"UPDATE geo_prompt_variants SET {assignment} WHERE id=%s", (variant,)
            )
        assert failure.value.diag.constraint_name == constraint
    connection.execute(
        "UPDATE geo_prompt_variants SET priority='CORE', revision=1, updated_at=now() WHERE id=%s",
        (variant,),
    )
    connection.execute("UPDATE geo_prompt_variants SET priority='CORE' WHERE id=%s", (variant,))
    connection.execute("DELETE FROM geo_prompt_variants WHERE id=%s", (variant,))


def test_topic_and_user_deletion_respect_variant_references(
    variant_database: VariantDatabase,
) -> None:
    database = variant_database
    with psycopg.connect(database.url) as connection:
        variant = insert_variant(connection, database, is_active=False)
    engine = create_engine(database.url.replace("postgresql://", "postgresql+psycopg://", 1))
    try:
        with Session(engine) as session:
            topic, actor, admin = (
                session.get(QueryTopic, database.topic),
                session.get(User, database.actor),
                session.get(User, database.admin),
            )
            assert topic and actor and admin
            projection = query_topics_out(session, [topic], can_delete=True)[0]
            assert "DELETE" not in projection.available_actions
            assert (
                projection.deletion and projection.deletion.blockers[0].type == "GEO_PROMPT_VARIANT"
            )
            assert "DELETE" not in users_out(session, [actor], actor=admin)[0].available_actions
            with pytest.raises(AppError) as failure:
                delete_query_topic(
                    db=session,
                    actor=admin,
                    query_topic_id=topic.id,
                    expected_revision=0,
                    request_id="geo201-topic-delete",
                )
            assert failure.value.code == "QUERY_TOPIC_IN_USE"
            session.rollback()
            with pytest.raises(AppError) as failure:
                delete_user(
                    db=session,
                    actor=admin,
                    user_id=actor.id,
                    expected_revision=0,
                    request_id="geo201-user-delete",
                )
            assert failure.value.code == "USER_IN_USE"
            session.rollback()
    finally:
        engine.dispose()
        with psycopg.connect(database.url) as connection:
            connection.execute("DELETE FROM geo_prompt_variants WHERE id=%s", (variant,))


def test_noop_timestamp_and_backward_time_are_rejected(
    connection: psycopg.Connection[Any], variant_database: VariantDatabase
) -> None:
    variant = insert_variant(connection, variant_database)
    for assignment in [
        "updated_at=updated_at + interval '1 second'",
        "priority='CORE', revision=1, updated_at=updated_at - interval '1 second'",
    ]:
        with pytest.raises(psycopg.errors.CheckViolation) as failure, connection.transaction():
            connection.execute(
                f"UPDATE geo_prompt_variants SET {assignment} WHERE id=%s", (variant,)
            )
        assert failure.value.diag.constraint_name == "ck_geo_prompt_variants_updated_at"
    assert connection.execute(
        "SELECT revision, priority, updated_at=created_at FROM geo_prompt_variants WHERE id=%s",
        (variant,),
    ).fetchone() == (0, "STANDARD", True)


def test_concurrent_reference_serializes_edit(variant_database: VariantDatabase) -> None:
    database = variant_database
    with psycopg.connect(database.url) as setup:
        variant = insert_variant(setup, database)

    def edit() -> str:
        with psycopg.connect(database.url, application_name="geo201-edit") as writer:
            writer.execute("SET lock_timeout='5s'")
            try:
                writer.execute(
                    "UPDATE geo_prompt_variants SET priority='CORE', revision=revision+1 "
                    "WHERE id=%s",
                    (variant,),
                )
            except psycopg.errors.CheckViolation as error:
                return str(error.diag.constraint_name)
        return "unexpected-success"

    with psycopg.connect(database.url) as locker, ThreadPoolExecutor(max_workers=1) as executor:
        locker.execute("SELECT id FROM geo_prompt_variants WHERE id=%s FOR UPDATE", (variant,))
        mark_referenced(locker, variant)
        pending = executor.submit(edit)
        deadline = time.monotonic() + 4
        with psycopg.connect(database.url, autocommit=True) as observer:
            while time.monotonic() < deadline:
                blocked = observer.execute(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE application_name='geo201-edit' AND cardinality(pg_blocking_pids(pid))>0"
                ).fetchone()
                if blocked == (1,):
                    break
                time.sleep(0.02)
            else:
                pytest.fail("未观察到真实行锁等待")
        locker.commit()
        assert pending.result(timeout=5) == "ck_geo_prompt_variants_history"
