"""无法补造的旧采集事实应让前滚原子停止。"""

from concurrent.futures import ThreadPoolExecutor
from time import monotonic, sleep

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
    run_alembic(db.plan.env, db.plan.backend_dir, "0049_geo_batch_creation")
    env = db.plan.env | {
        "DATABASE_URL": db.plan.env["DATABASE_URL"] + "?application_name=geo304_lock_test"
    }
    with psycopg.connect(db.url) as writer, ThreadPoolExecutor(max_workers=1) as workers:
        writer.execute(
            "UPDATE geo_observation_runs SET status='COLLECTED',started_at=now(),"
            "collected_at=now(),revision=revision+1 WHERE id=%s",
            (identity,),
        )
        future = workers.submit(run_alembic, env, db.plan.backend_dir, "head", check=False)
        try:
            deadline = monotonic() + 10
            blocked = False
            with psycopg.connect(db.url, autocommit=True) as observer:
                while monotonic() < deadline and not future.done():
                    blocked = observer.execute(
                        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                        "WHERE datname=current_database() "
                        "AND application_name='geo304_lock_test' AND wait_event_type='Lock')"
                    ).fetchone()[0]
                    if blocked:
                        break
                    sleep(0.02)
            assert blocked, "迁移必须等待旧写事务，不能跨过预检窗口"
        finally:
            writer.commit()
        failed = future.result(timeout=20)
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
