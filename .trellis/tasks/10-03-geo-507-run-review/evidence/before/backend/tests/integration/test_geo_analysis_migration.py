"""0054 存量证据前滚与新表/Run metadata 一致性。"""

import subprocess
import sys
from uuid import uuid4

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from app.db import Base
from tests.integration.geo_analysis_support import collected_case
from tests.integration.geo_answers_support import AnswerDatabase, plan_database, run_database
from tests.integration.test_migrations import run_alembic

pytestmark = pytest.mark.integration
__all__ = ["plan_database", "run_database"]


def test_nonempty_0053_forward_preserves_evidence_and_matches_models(run_database):
    db = run_database
    run_alembic(db.plan.env, db.plan.backend_dir, "0053_geo_collection_admission")
    with psycopg.connect(db.url) as conn:
        case = collected_case(conn, AnswerDatabase(db, uuid4()), products=2)
        before_run = conn.execute(
            "SELECT to_jsonb(r) FROM geo_observation_runs r WHERE id=%s", (case.run_id,)
        ).fetchone()[0]
        before_answers = conn.execute(
            "SELECT to_jsonb(a) FROM geo_answer_snapshots a ORDER BY id"
        ).fetchall()
    run_alembic(db.plan.env, db.plan.backend_dir, "0054_geo_analysis_contract")
    with psycopg.connect(db.url) as conn:
        assert (
            conn.execute(
                "SELECT to_jsonb(r)-'current_analysis_revision_id' FROM "
                "geo_observation_runs r WHERE id=%s",
                (case.run_id,),
            ).fetchone()[0]
            == before_run
        )
        assert (
            conn.execute(
                "SELECT current_analysis_revision_id FROM geo_observation_runs WHERE id=%s",
                (case.run_id,),
            ).fetchone()[0]
            is None
        )
        assert (
            conn.execute("SELECT to_jsonb(a) FROM geo_answer_snapshots a ORDER BY id").fetchall()
            == before_answers
        )
        assert conn.execute("SELECT count(*) FROM geo_analysis_revisions").fetchone()[0] == 0
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://"))
    tables = {
        "geo_analysis_revisions",
        "geo_analysis_fact_versions",
        "geo_entity_mentions",
        "geo_recommendations",
        "geo_claim_assessments",
        "geo_run_reviews",
        "geo_observation_runs",
    }
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
        [sys.executable, "-m", "alembic", "downgrade", "0053_geo_collection_admission"],
        cwd=db.plan.backend_dir,
        env=db.plan.env,
        capture_output=True,
        text=True,
    )
    assert (
        stopped.returncode != 0 and "0054 分析与复核历史必须保留" in stopped.stdout + stopped.stderr
    )
    with psycopg.connect(db.url) as conn:
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0054_geo_analysis_contract"
        )
