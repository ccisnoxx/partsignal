"""0056非空历史前滚与复核发布限定字段；不回填、不降级删除历史。"""

import subprocess
import sys
from uuid import uuid4

import psycopg
import pytest

from tests.integration.geo_analysis_support import (
    bind,
    collected_case,
    finish,
    pending,
    publish,
    review,
)
from tests.integration.geo_answers_support import AnswerDatabase, plan_database, run_database
from tests.integration.test_geo_analysis_worker_migration import history
from tests.integration.test_migrations import run_alembic

pytestmark = pytest.mark.integration
__all__ = ["plan_database", "run_database"]


def test_0056_nonempty_forward_keeps_every_history_row(run_database):
    db = run_database
    run_alembic(db.plan.env, db.plan.backend_dir, "0055_geo_analysis_worker")
    with psycopg.connect(db.url) as conn:
        case = collected_case(conn, AnswerDatabase(db, uuid4()), products=1)
        analysis = pending(conn, case)
        bind(conn, case, analysis)
        finish(conn, analysis)
        publish(conn, case, analysis)
        review(conn, case, analysis, db.plan.actor)
        conn.execute(
            "UPDATE geo_observation_runs SET status='COMPLETED',finished_at=clock_timestamp(),"
            "revision=revision+1 WHERE id=%s",
            (case.run_id,),
        )
        before = history(conn)
    run_alembic(db.plan.env, db.plan.backend_dir, "0056_geo_run_review")
    with psycopg.connect(db.url) as conn:
        assert history(conn) == before
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0056_geo_run_review"
        )
        # 旧review不能充当本事务发布新revision的凭证。
        with pytest.raises(psycopg.errors.CheckViolation) as failure:
            conn.execute(
                "UPDATE geo_observation_runs SET revision=revision+1 WHERE id=%s", (case.run_id,)
            )
        assert failure.value.diag.constraint_name == "ck_geo_runs_review_publication"
        conn.rollback()
        review(conn, case, analysis, db.plan.actor)
        conn.execute(
            "UPDATE geo_observation_runs SET revision=revision+1 WHERE id=%s", (case.run_id,)
        )
    stopped = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0055_geo_analysis_worker"],
        cwd=db.plan.backend_dir,
        env=db.plan.env,
        capture_output=True,
        text=True,
    )
    assert stopped.returncode != 0
    assert "0056人工复核历史必须保留" in stopped.stdout + stopped.stderr
    with psycopg.connect(db.url) as conn:
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0056_geo_run_review"
        )
        assert (
            conn.execute(
                "SELECT count(*) FROM geo_run_reviews WHERE run_id=%s", (case.run_id,)
            ).fetchone()[0]
            == 2
        )
