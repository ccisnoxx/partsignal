"""0051 从已有正式证据前滚，数据库与ORM一致，降级明确停止。"""

import subprocess
import sys

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from app.db import Base
from tests.integration.geo_answers_support import AnswerDatabase, collect, new_run, snapshot
from tests.integration.geo_runs_support import plan_database as plan_database
from tests.integration.geo_runs_support import run_database as run_database
from tests.integration.test_migrations import run_alembic

pytestmark = pytest.mark.integration
__all__ = ["plan_database", "run_database"]


def test_0051_preserves_nonempty_0050_evidence_and_safe_stop(run_database):
    runs = run_database
    run_alembic(runs.plan.env, runs.plan.backend_dir, "0049_geo_batch_creation")
    run_alembic(runs.plan.env, runs.plan.backend_dir, "0050_geo_answer_evidence")
    db = AnswerDatabase(runs, runs.plan.prompt)
    with psycopg.connect(db.url) as conn:
        run = new_run(conn, db)
        answer = snapshot(conn, db, run)
        collect(conn, run)
        before = conn.execute(
            "SELECT to_jsonb(a) FROM geo_answer_snapshots a WHERE id=%s", (answer,)
        ).fetchone()[0]
        run_before = conn.execute(
            "SELECT to_jsonb(r) FROM geo_observation_runs r WHERE id=%s", (run,)
        ).fetchone()[0]
    run_alembic(runs.plan.env, runs.plan.backend_dir, "0052_geo_profile_tests")
    with psycopg.connect(db.url) as conn:
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0052_geo_profile_tests"
        )
        assert (
            conn.execute(
                "SELECT to_jsonb(a) FROM geo_answer_snapshots a WHERE id=%s", (answer,)
            ).fetchone()[0]
            == before
        )
        assert (
            conn.execute(
                "SELECT to_jsonb(r) FROM geo_observation_runs r WHERE id=%s", (run,)
            ).fetchone()[0]
            == run_before
        )
        assert conn.execute("SELECT count(*) FROM geo_manual_drafts").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM geo_manual_submissions").fetchone()[0] == 0
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://"))
    tables = {"geo_manual_drafts", "geo_manual_submissions"}
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
    stopped = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0050_geo_answer_evidence"],
        cwd=runs.plan.backend_dir,
        env=runs.plan.env,
        capture_output=True,
        text=True,
    )
    assert (
        stopped.returncode != 0
        and "0052 资格失效不可恢复为旧测试事实" in stopped.stdout + stopped.stderr
    )
    with psycopg.connect(db.url) as conn:
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0052_geo_profile_tests"
        )
        assert (
            conn.execute(
                "SELECT to_jsonb(a) FROM geo_answer_snapshots a WHERE id=%s", (answer,)
            ).fetchone()[0]
            == before
        )
