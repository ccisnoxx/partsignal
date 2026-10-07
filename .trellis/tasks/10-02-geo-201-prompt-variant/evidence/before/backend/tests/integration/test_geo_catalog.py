"""Catalog 前滚、metadata 与直接 SQL 最终防线；只使用隔离 PostgreSQL。"""

from __future__ import annotations

import subprocess
import sys
import time
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from psycopg import sql
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session

from app.db import Base
from app.models.geo_catalog import GeoSubject, GeoSubjectAlias, GeoSubjectDomain
from tests.integration.test_migrations import run_alembic, temporary_database

pytestmark = pytest.mark.integration
CATALOG_TABLES = {"geo_subjects", "geo_subject_aliases", "geo_subject_domains"}


def insert_row(connection: psycopg.Connection[Any], table: str, values: dict[str, Any]) -> None:
    connection.execute(
        sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
            sql.Identifier(table),
            sql.SQL(", ").join(map(sql.Identifier, values)),
            sql.SQL(", ").join(sql.Placeholder() for _ in values),
        ),
        tuple(values.values()),
    )


def insert_subject(
    connection: psycopg.Connection[Any], actor: uuid.UUID, **patch: Any
) -> uuid.UUID:
    values = {
        "id": uuid.uuid4(),
        "subject_type": "COMPETITOR_PRODUCT",
        "created_by": actor,
        "canonical_name": "虚构 CP-102",
        "normalized_name": "虚构 cp-102",
        "display_name": "虚构竞品",
    }
    if patch.get("subject_type") == "OWN_PRODUCT":
        values.update(canonical_name=None, normalized_name=None, display_name=None)
    values.update(patch)
    insert_row(connection, "geo_subjects", values)
    return values["id"]


def legacy_snapshot(connection: psycopg.Connection[Any], ids: dict[str, uuid.UUID]) -> list[Any]:
    rows = [
        connection.execute(
            sql.SQL("SELECT to_jsonb(t) FROM {} t WHERE id = %s").format(sql.Identifier(table)),
            (ids[key],),
        ).fetchone()
        for table, key in [
            ("products", "product"),
            ("users", "actor"),
            ("geo_observations", "observation"),
        ]
    ]
    columns = connection.execute(
        "SELECT table_name, column_name, data_type, is_nullable, column_default "
        "FROM information_schema.columns WHERE table_schema = 'public' "
        "AND table_name <> ALL(%s) ORDER BY table_name, ordinal_position",
        (list(CATALOG_TABLES),),
    ).fetchall()
    return [*rows, columns]


@dataclass
class CatalogDatabase:
    url: str
    env: dict[str, str]
    backend_dir: Path
    ids: dict[str, uuid.UUID]
    before: list[Any]


@pytest.fixture(scope="module")
def catalog_database() -> Iterator[CatalogDatabase]:
    with temporary_database("partsignal_geo_catalog") as (url, env, backend_dir):
        run_alembic(env, backend_dir, "0043_geo_platform_identity")
        ids = {
            key: uuid.uuid4()
            for key in [
                "actor",
                "other_actor",
                "product",
                "other_product",
                "observation",
                "topic",
                "own_brand",
                "competitor_brand",
                "reference",
            ]
        }
        with psycopg.connect(url) as connection:
            for key in ["actor", "other_actor"]:
                connection.execute(
                    "INSERT INTO users (id, username, display_name, password_hash, account_type, "
                    "is_active, must_change_password, revision) "
                    "VALUES (%s, %s, '虚构迁移用户', 'not-used', 'ADMIN', true, false, 0)",
                    (ids[key], f"geo102-{key}"),
                )
            for key in ["product", "other_product"]:
                connection.execute(
                    "INSERT INTO products (id, part_number, normalized_part_number, brand, "
                    "normalized_brand, category, status, revision, facts_revision, "
                    "facts_body_markdown) "
                    "VALUES (%s, %s, %s, '虚构品牌', '虚构品牌', '测试类别', "
                    "'ACTIVE', 0, 0, '原有产品事实')",
                    (ids[key], f"PS-{key}", f"ps-{key}"),
                )
            connection.execute(
                "INSERT INTO query_topics "
                "(id, canonical_question, intent_type, variants, revision) "
                "VALUES (%s, '旧 GEO 主题', 'REPLACEMENT', ARRAY['旧问题'], 0)",
                (ids["topic"],),
            )
            connection.execute(
                "INSERT INTO geo_observations (id, observation_kind, query_topic_id, product_id, "
                "actual_prompt, model_name, answer_summary, web_search_enabled, mentioned, "
                "recommendation, accuracy, tested_at, notes, tested_by) "
                "VALUES (%s, 'LEGACY_MODEL_RESULT', %s, %s, '旧 GEO 问题', 'legacy-model', "
                "'旧回答保持原样', true, true, 'RECOMMENDED', 'ACCURATE', "
                "now(), '迁移前记录', %s)",
                (ids["observation"], ids["topic"], ids["product"], ids["actor"]),
            )
            before = legacy_snapshot(connection, ids)
        run_alembic(env, backend_dir, "head")
        with psycopg.connect(url) as connection:
            for key, kind in [
                ("own_brand", "OWN_BRAND"),
                ("competitor_brand", "COMPETITOR_BRAND"),
                ("reference", "REFERENCE_PART"),
            ]:
                insert_subject(connection, ids["actor"], id=ids[key], subject_type=kind)
        yield CatalogDatabase(url, env, backend_dir, ids, before)


@pytest.fixture
def catalog_connection(catalog_database: CatalogDatabase) -> Iterator[psycopg.Connection[Any]]:
    with psycopg.connect(catalog_database.url) as connection:
        try:
            yield connection
        finally:
            connection.rollback()


def test_current_head_forward_preserves_existing_schema_and_geo(
    catalog_database: CatalogDatabase,
) -> None:
    with psycopg.connect(catalog_database.url) as connection:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0044_geo_catalog",
        )
        assert legacy_snapshot(connection, catalog_database.ids) == catalog_database.before


def test_catalog_metadata_matches_migrated_postgresql(catalog_database: CatalogDatabase) -> None:
    engine = create_engine(
        catalog_database.url.replace("postgresql://", "postgresql+psycopg://", 1)
    )
    try:
        with engine.connect() as connection:
            context = MigrationContext.configure(
                connection,
                opts={
                    "compare_type": True,
                    "compare_server_default": True,
                    "include_object": lambda obj, name, kind, reflected, compared: (
                        kind != "table" or name in CATALOG_TABLES
                    ),
                },
            )
            assert compare_metadata(context, Base.metadata) == []
            inspector = inspect(connection)
            for name in CATALOG_TABLES:
                table = Base.metadata.tables[name]
                assert inspector.get_pk_constraint(name)["name"] == table.primary_key.name
                assert {c["name"] for c in inspector.get_check_constraints(name)} == {
                    c.name for c in table.constraints if c.__class__.__name__ == "CheckConstraint"
                }
    finally:
        engine.dispose()


def test_orm_round_trip_and_database_defaults(catalog_database: CatalogDatabase) -> None:
    engine = create_engine(
        catalog_database.url.replace("postgresql://", "postgresql+psycopg://", 1)
    )
    try:
        with Session(engine) as session:
            subject = GeoSubject(
                subject_type="OWN_PRODUCT",
                product_id=catalog_database.ids["other_product"],
                created_by=catalog_database.ids["actor"],
            )
            session.add(subject)
            session.flush()
            alias = GeoSubjectAlias(
                subject_id=subject.id,
                alias="虚构型号",
                normalized_alias="虚构型号",
                alias_kind="PART_NUMBER",
            )
            domain = GeoSubjectDomain(
                subject_id=subject.id, hostname="example.test", relation_type="OWNED"
            )
            session.add_all([alias, domain])
            session.flush()
            session.expire_all()
            assert session.get(GeoSubject, subject.id) is subject
            assert (
                subject.revision,
                subject.description,
                subject.is_active,
                subject.canonical_name,
            ) == (0, "", True, None)
            assert subject.created_at.tzinfo is not None and subject.updated_at.tzinfo is not None
            assert alias.is_active and domain.is_active
            assert alias.created_at.tzinfo is not None and domain.created_at.tzinfo is not None
            session.rollback()
    finally:
        engine.dispose()


def test_downgrade_refuses_data_loss_atomically(catalog_database: CatalogDatabase) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0043_geo_platform_identity"],
        cwd=catalog_database.backend_dir,
        env=catalog_database.env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0 and "0044 GEO Catalog 无法安全降级" in result.stderr
    with psycopg.connect(catalog_database.url) as connection:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0044_geo_catalog",
        )
        assert connection.execute("SELECT count(*) FROM geo_subjects").fetchone() == (3,)


def test_two_transactions_compete_for_one_active_product(catalog_database: CatalogDatabase) -> None:
    ids = catalog_database.ids
    winner_id, loser_id = uuid.uuid4(), uuid.uuid4()
    with (
        psycopg.connect(catalog_database.url) as winner,
        psycopg.connect(catalog_database.url) as loser,
    ):
        loser.execute("SET lock_timeout = '10s'")
        pid = loser.execute("SELECT pg_backend_pid()").fetchone()[0]
        insert_subject(
            winner,
            ids["actor"],
            id=winner_id,
            subject_type="OWN_PRODUCT",
            product_id=ids["other_product"],
        )

        def compete() -> tuple[str | None, str | None]:
            try:
                insert_subject(
                    loser,
                    ids["actor"],
                    id=loser_id,
                    subject_type="OWN_PRODUCT",
                    product_id=ids["other_product"],
                )
                loser.commit()
                return ("COMMITTED", None)
            except psycopg.Error as error:
                loser.rollback()
                return error.sqlstate, error.diag.constraint_name

        try:
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(compete)
                try:
                    deadline = time.monotonic() + 8
                    with psycopg.connect(catalog_database.url, autocommit=True) as observer:
                        while time.monotonic() < deadline:
                            if observer.execute(
                                "SELECT wait_event_type = 'Lock' "
                                "FROM pg_stat_activity WHERE pid = %s",
                                (pid,),
                            ).fetchone() == (True,):
                                break
                        else:
                            pytest.fail("败者未进入可观察的 PostgreSQL 唯一索引锁等待")
                    winner.commit()
                    assert future.result(timeout=12) == (
                        "23505",
                        "uq_geo_subjects_active_own_product",
                    )
                finally:
                    winner.rollback()
            with psycopg.connect(catalog_database.url) as observer:
                assert observer.execute(
                    "SELECT id FROM geo_subjects WHERE product_id = %s AND is_active",
                    (ids["other_product"],),
                ).fetchall() == [(winner_id,)]
        finally:
            with psycopg.connect(catalog_database.url) as cleanup:
                cleanup.execute(
                    "DELETE FROM geo_subjects WHERE id = ANY(%s)", ([winner_id, loser_id],)
                )
