"""0063 加法前滚、空库安装、现有数据保留与 ORM 合同一致。"""

import subprocess
import sys

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from app.db import Base
from tests.integration.geo_runs_support import plan_database, run_database
from tests.integration.test_geo_monitoring_plans import existing_rows
from tests.integration.test_migrations import run_alembic, temporary_database

pytestmark = pytest.mark.integration
__all__ = ["plan_database", "run_database"]


def compare_schema(url):
    engine = create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1))
    tables = {"geo_browser_sessions", "geo_collection_profiles"}
    try:
        with engine.connect() as conn:
            context = MigrationContext.configure(
                conn,
                opts={
                    "compare_type": True,
                    "compare_server_default": True,
                    "include_object": lambda obj, name, kind, reflected, compared: (
                        obj.name in tables if kind == "table" else obj.table.name in tables
                    ),
                },
            )
            assert compare_metadata(context, Base.metadata) == []
    finally:
        engine.dispose()


def test_empty_database_installs_0063_and_matches_models():
    with temporary_database("partsignal_geo802_empty") as (url, env, backend_dir):
        run_alembic(env, backend_dir, "head")
        with psycopg.connect(url) as conn:
            assert conn.execute("SELECT version_num FROM alembic_version").fetchone() == (
                "0064_geo_retention",
            )
            assert conn.execute("SELECT count(*) FROM geo_browser_sessions").fetchone() == (0,)
        compare_schema(url)


def test_nonempty_0062_forward_keeps_history_and_refuses_destructive_downgrade(run_database):
    db = run_database
    run_alembic(db.plan.env, db.plan.backend_dir, "0062_geo_opportunity_decisions")
    with psycopg.connect(db.url) as conn:
        before = existing_rows(conn)
        runs = conn.execute("SELECT to_jsonb(r) FROM geo_observation_runs r ORDER BY id").fetchall()
    run_alembic(db.plan.env, db.plan.backend_dir, "head")
    with psycopg.connect(db.url) as conn:
        assert existing_rows(conn) == before
        assert (
            conn.execute("SELECT to_jsonb(r) FROM geo_observation_runs r ORDER BY id").fetchall()
            == runs
        )
        assert conn.execute("SELECT count(*) FROM geo_browser_sessions").fetchone() == (0,)
        assert conn.execute(
            "SELECT count(*) FROM geo_collection_profiles WHERE session_revision <> 0"
        ).fetchone() == (0,)
    compare_schema(db.url)
    stopped = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0062_geo_opportunity_decisions"],
        cwd=db.plan.backend_dir,
        env=db.plan.env,
        capture_output=True,
        text=True,
    )
    assert stopped.returncode != 0 and "0064 清理墓碑不可安全降级" in stopped.stderr
    with psycopg.connect(db.url) as conn:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0064_geo_retention",
        )
