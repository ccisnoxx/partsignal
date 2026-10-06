"""0055 保留非空分析历史；新增执行/引用表与 ORM 一致，降级安全停止。"""

import subprocess
import sys
from uuid import uuid4

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from psycopg import sql
from sqlalchemy import create_engine

from app.db import Base
from tests.integration.geo_analysis_support import (
    bind,
    collected_case,
    finish,
    pending,
    publish,
    review,
)
from tests.integration.geo_answers_support import AnswerDatabase, plan_database, run_database
from tests.integration.test_migrations import run_alembic

pytestmark = pytest.mark.integration
__all__ = ["plan_database", "run_database"]

HISTORY_TABLES = (
    "geo_observation_batches",
    "geo_observation_runs",
    "geo_answer_snapshots",
    "geo_answer_citations",
    "geo_analysis_revisions",
    "geo_analysis_fact_versions",
    "geo_entity_mentions",
    "geo_recommendations",
    "geo_claim_assessments",
    "geo_run_reviews",
)


def history(conn):
    return {
        name: conn.execute(
            sql.SQL("SELECT to_jsonb(t) FROM {} t ORDER BY to_jsonb(t)::text").format(
                sql.Identifier(name)
            )
        ).fetchall()
        for name in HISTORY_TABLES
    }


def test_0055_nonempty_forward_preserves_analysis_and_review_history(run_database):
    db = run_database
    run_alembic(db.plan.env, db.plan.backend_dir, "0054_geo_analysis_contract")
    with psycopg.connect(db.url) as conn:
        evidence = AnswerDatabase(db, uuid4())
        for status in ("PENDING", "COMPLETED", "FAILED"):
            case = collected_case(
                conn, evidence, products=1, citation_urls=("https://example.com/fixture",)
            )
            identity = pending(conn, case)
            bind(conn, case, identity)
            if status != "PENDING":
                finish(conn, identity, failed=status == "FAILED")
            if status == "COMPLETED":
                publish(conn, case, identity)
                review(conn, case, identity, db.plan.actor)
        # 0054 允许无执行元数据的历史 ANALYZING；0055 不伪造机器 claim。
        legacy = collected_case(conn, evidence)
        conn.execute(
            "UPDATE geo_observation_runs SET status='ANALYZING',lease_token=%s,"
            "lease_expires_at=now()+interval '5 minutes',revision=revision+1 WHERE id=%s",
            (uuid4(), legacy.run_id),
        )
        before = history(conn)
    run_alembic(db.plan.env, db.plan.backend_dir, "0055_geo_analysis_worker")
    with psycopg.connect(db.url) as conn:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == (
            "0055_geo_analysis_worker"
        )
        assert history(conn) == before
        assert conn.execute("SELECT count(*) FROM geo_analysis_jobs").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM geo_citation_classifications").fetchone()[0] == 0
        conn.execute(
            "UPDATE geo_observation_runs SET status='COMPLETED',finished_at=clock_timestamp(),"
            "lease_token=NULL,lease_expires_at=NULL,revision=revision+1 WHERE id=%s",
            (legacy.run_id,),
        )
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://"))
    tables = {"geo_analysis_jobs", "geo_citation_classifications"}
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
        [sys.executable, "-m", "alembic", "downgrade", "0054_geo_analysis_contract"],
        cwd=db.plan.backend_dir,
        env=db.plan.env,
        capture_output=True,
        text=True,
    )
    assert stopped.returncode != 0
    assert "0055 分析执行与引用历史必须保留" in stopped.stdout + stopped.stderr
    with psycopg.connect(db.url) as conn:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == (
            "0055_geo_analysis_worker"
        )
