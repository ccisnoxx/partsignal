"""无法补造的旧采集事实应让前滚原子停止。"""

import psycopg
import pytest

from tests.integration.geo_runs_support import RunDatabase, batch, plan_database, run, run_database
from tests.integration.test_migrations import run_alembic

pytestmark = pytest.mark.integration
__all__ = ["plan_database", "run_database"]


def test_collected_history_without_original_evidence_stops_migration(run_database: RunDatabase):
    db = run_database
    with psycopg.connect(db.url) as conn:
        identity = run(conn, db, batch(conn, db))
        conn.execute(
            "UPDATE geo_observation_runs SET status='COLLECTED',started_at=now(),collected_at=now(),revision=revision+1 WHERE id=%s",
            (identity,),
        )
    run_alembic(db.plan.env, db.plan.backend_dir, "0049_geo_batch_creation")
    failed = run_alembic(db.plan.env, db.plan.backend_dir, "head", check=False)
    assert (
        failed.returncode != 0 and "0050 发现无原始证据的采集历史" in failed.stdout + failed.stderr
    )
    with psycopg.connect(db.url) as conn:
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0049_geo_batch_creation"
        )
        assert conn.execute("SELECT to_regclass('geo_answer_snapshots')").fetchone()[0] is None
        assert (
            conn.execute(
                "SELECT status FROM geo_observation_runs WHERE id=%s", (identity,)
            ).fetchone()[0]
            == "COLLECTED"
        )
