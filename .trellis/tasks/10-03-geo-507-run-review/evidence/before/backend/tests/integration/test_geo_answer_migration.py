"""0050/0051 加法前滚、ORM 一致与有意不可逆降级。"""

import subprocess
import sys

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from app.db import Base
from tests.integration.geo_answers_support import (
    AnswerDatabase,
    answer_database,
    plan_database,
    run_database,
)
from tests.integration.test_geo_monitoring_plans import existing_rows

pytestmark = pytest.mark.integration
__all__ = ["answer_database", "plan_database", "run_database"]


def test_forward_keeps_nonempty_history_and_matches_models(answer_database: AnswerDatabase):
    db = answer_database
    with psycopg.connect(db.url) as conn:
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0055_geo_analysis_worker"
        )
        assert existing_rows(conn) == db.runs.before
        assert (
            conn.execute(
                "SELECT input_snapshot FROM geo_observation_runs WHERE id=%s", (db.legacy_run,)
            ).fetchone()[0]
            == db.runs.input
        )
        assert conn.execute("SELECT count(*) FROM geo_answer_snapshots").fetchone()[0] == 0
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://"))
    tables = {"geo_answer_snapshots", "geo_answer_citations"}
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
        [sys.executable, "-m", "alembic", "downgrade", "0049_geo_batch_creation"],
        cwd=db.runs.plan.backend_dir,
        env=db.runs.plan.env,
        capture_output=True,
        text=True,
    )
    assert (
        stopped.returncode != 0
        and "0055 分析执行与引用历史必须保留" in stopped.stdout + stopped.stderr
    )
    with psycopg.connect(db.url) as conn:
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0055_geo_analysis_worker"
        )
