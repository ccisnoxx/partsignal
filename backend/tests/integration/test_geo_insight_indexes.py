"""0057 前滚/撤销只改变索引，原始及复核历史完全保留。"""

import subprocess
import sys

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from app.db import Base
from tests.integration.geo_answers_support import AnswerDatabase
from tests.integration.geo_reviews_support import (
    analysis_engine,
    harness,
    plan_database,
    review_api,
    run_database,
)
from tests.integration.geo_runs_support import batch, run
from tests.integration.test_migrations import run_alembic

__all__ = [
    "analysis_engine", "answer_database", "harness", "plan_database", "review_api", "run_database",
]
pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def answer_database(run_database):
    """0057索引往返只在该冻结revision验证，不穿越后续不可逆业务迁移。"""
    db = run_database
    with psycopg.connect(db.url) as conn:
        legacy = run(conn, db, batch(conn, db))
    run_alembic(db.plan.env, db.plan.backend_dir, "0057_geo_insight_indexes")
    yield AnswerDatabase(db, legacy)


def history(conn):
    return {
        table: conn.execute(f"SELECT to_jsonb(t) FROM {table} t ORDER BY 1").fetchall()
        for table in ("geo_observation_batches", "geo_observation_runs", "geo_answer_snapshots",
                      "geo_answer_citations", "geo_analysis_revisions", "geo_analysis_jobs",
                      "geo_analysis_fact_versions", "geo_entity_mentions", "geo_recommendations",
                      "geo_claim_assessments", "geo_citation_classifications", "geo_run_reviews")
    }


def test_0057_forward_and_index_only_rollback_preserve_history(review_api, analysis_engine):
    api = review_api
    case = api.create()
    assert api.submit(case).status_code == 201
    db = api.harness.database.runs.plan
    with psycopg.connect(db.url) as conn:
        before = history(conn)
    subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0056_geo_run_review"],
        cwd=db.backend_dir, env=db.env, check=True, capture_output=True, text=True,
    )
    with psycopg.connect(db.url) as conn:
        index = conn.execute("SELECT to_regclass('ix_geo_runs_insight_created')").fetchone()[0]
        assert index is None
        assert history(conn) == before
    run_alembic(db.env, db.backend_dir, "0057_geo_insight_indexes")
    with psycopg.connect(db.url) as conn:
        assert history(conn) == before
        definition = conn.execute(
            "SELECT indexdef FROM pg_indexes WHERE indexname='ix_geo_runs_insight_created'"
        ).fetchone()[0]
        assert "(created_at DESC, id)" in definition
    with analysis_engine.connect() as conn:
        def include_object(obj, _name, _type, _reflected, _compare_to):
            table = getattr(obj, "table", obj)
            return getattr(table, "name", None) == "geo_observation_runs"

        context = MigrationContext.configure(conn, opts={"include_object": include_object})
        assert compare_metadata(context, Base.metadata) == []
