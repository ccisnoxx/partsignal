"""0059非空前滚保留历史；旧悬空复测引用明确停止，不猜测回填。"""

from uuid import uuid4

import psycopg
import pytest

from tests.integration.geo_answers_support import AnswerDatabase, new_run
from tests.integration.geo_runs_support import batch, plan_database, run, run_database
from tests.integration.test_geo_catalog import insert_row
from tests.integration.test_geo_insight_indexes import history
from tests.integration.test_migrations import run_alembic

pytestmark = pytest.mark.integration
__all__ = ["plan_database", "run_database"]


def test_orphan_reference_stops_0059_without_partial_ddl_or_history_changes(run_database):
    db = run_database
    run_alembic(db.plan.env, db.plan.backend_dir, "0058_geo_rule_configuration")
    orphan = uuid4()
    with psycopg.connect(db.url) as conn:
        baseline_run = new_run(conn, AnswerDatabase(db, uuid4()))
        baseline = conn.execute(
            "SELECT batch_id FROM geo_observation_runs WHERE id=%s", (baseline_run,)
        ).fetchone()[0]
        retest = batch(
            conn,
            db,
            trigger_type="RETEST",
            source_opportunity_id=orphan,
            baseline_batch_id=baseline,
        )
        insert_row(
            conn,
            "geo_batch_subjects",
            {"batch_id": retest, "subject_id": db.plan.subjects[0], "role": "PRIMARY"},
        )
        run(conn, db, retest)
        before = history(conn)
    stopped = run_alembic(db.plan.env, db.plan.backend_dir, "head", check=False)
    assert stopped.returncode != 0
    assert "fk_geo_batches_opportunity" in stopped.stdout + stopped.stderr
    with psycopg.connect(db.url) as conn:
        assert history(conn) == before
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == (
            "0058_geo_rule_configuration"
        )
        assert conn.execute("SELECT to_regclass('geo_opportunities')").fetchone()[0] is None
