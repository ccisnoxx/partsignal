"""0062加法前滚保留0061历史，空库可安装，拒绝破坏性降级。"""

import subprocess
import sys

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from app.db import Base
from tests.integration.geo_runs_support import plan_database, run_database
from tests.integration.test_geo_insight_indexes import history
from tests.integration.test_geo_retest_migration import baseline, retest, source
from tests.integration.test_migrations import run_alembic, temporary_database

pytestmark = pytest.mark.integration
__all__ = ["plan_database", "run_database"]


def test_empty_database_installs_0062():
    with temporary_database("partsignal_geo706_empty") as (url, env, backend_dir):
        run_alembic(env, backend_dir, "head")
        with psycopg.connect(url) as conn:
            assert conn.execute("SELECT version_num FROM alembic_version").fetchone() == (
                "0063_geo_browser_sessions",
            )
            assert conn.execute("SELECT count(*) FROM geo_opportunity_decisions").fetchone() == (0,)
            assert conn.execute(
                "SELECT count(*) FROM pg_constraint "
                "WHERE conrelid='geo_opportunity_decisions'::regclass AND contype='f'"
            ).fetchone() == (4,)


def test_nonempty_0061_upgrade_keeps_every_history_and_matches_metadata(run_database):
    db = run_database
    run_alembic(db.plan.env, db.plan.backend_dir, "0061_geo_retests")
    with psycopg.connect(db.url) as conn:
        saved = source(conn, db)
        baseline_id = baseline(conn, db, saved)
        batch_id = retest(conn, db, saved, baseline_id, receipt_first=True)
        before = history(conn)
        extra = {
            table: conn.execute(f"SELECT to_jsonb(t) FROM {table} t ORDER BY 1").fetchall()
            for table in (
                "geo_opportunities",
                "geo_opportunity_sources",
                "geo_retest_baselines",
                "geo_retest_requests",
            )
        }
    run_alembic(db.plan.env, db.plan.backend_dir, "head")
    with psycopg.connect(db.url) as conn:
        assert history(conn) == before
        for table, rows in extra.items():
            assert conn.execute(f"SELECT to_jsonb(t) FROM {table} t ORDER BY 1").fetchall() == rows
        assert conn.execute("SELECT count(*) FROM geo_opportunity_decisions").fetchone() == (0,)
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://", 1))
    try:
        with engine.connect() as conn:
            context = MigrationContext.configure(
                conn,
                opts={
                    "compare_type": True,
                    "compare_server_default": True,
                    "include_object": lambda obj, name, kind, reflected, compared: (
                        obj.name == "geo_opportunity_decisions"
                        if kind == "table"
                        else obj.table.name == "geo_opportunity_decisions"
                    ),
                },
            )
            assert compare_metadata(context, Base.metadata) == []
    finally:
        engine.dispose()
    stopped = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0061_geo_retests"],
        cwd=db.plan.backend_dir,
        env=db.plan.env,
        capture_output=True,
        text=True,
    )
    assert stopped.returncode != 0 and "0063会话撤销历史" in stopped.stderr
    with psycopg.connect(db.url) as conn:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0063_geo_browser_sessions",
        )
        assert conn.execute(
            "SELECT id FROM geo_retest_baselines WHERE id=%s", (baseline_id,)
        ).fetchone() == (baseline_id,)
        assert conn.execute(
            "SELECT batch_id FROM geo_retest_requests WHERE batch_id=%s", (batch_id,)
        ).fetchone() == (batch_id,)
