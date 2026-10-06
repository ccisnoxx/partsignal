"""0048 加法前滚、真实历史保留、唯一约束与并发提交反例。"""

import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from psycopg.types.json import Jsonb
from sqlalchemy import create_engine

from app.db import Base
from tests.integration.geo_runs_support import (
    BATCH,
    RUN,
    RunDatabase,
    batch,
    connection,
    plan_database,
    run,
    run_database,
)
from tests.integration.test_geo_monitoring_plans import existing_rows, insert_plan
from tests.unit.test_geo_run_contract import plan_snapshot

pytestmark = pytest.mark.integration
__all__ = ["plan_database", "run_database", "connection"]


def test_forward_preserves_nonempty_old_geo_and_matches_metadata(run_database: RunDatabase) -> None:
    db = run_database
    with psycopg.connect(db.url) as conn:
        assert existing_rows(conn) == db.before
        assert len(db.before[-1]) == 1
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0048_geo_batches_runs"
        )
        assert (
            conn.execute(
                f"SELECT (SELECT count(*) FROM {BATCH}) + (SELECT count(*) FROM {RUN})"
            ).fetchone()[0]
            == 0
        )
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://", 1))
    try:
        with engine.connect() as conn:
            context = MigrationContext.configure(
                conn,
                opts={
                    "compare_type": True,
                    "compare_server_default": True,
                    "include_object": lambda obj, name, kind, reflected, compared: (
                        obj.name in {BATCH, RUN}
                        if kind == "table"
                        else obj.table.name in {BATCH, RUN}
                        and (
                            kind != "column"
                            or name not in {"provider_status", "retry_after_seconds"}
                        )
                    ),
                },
            )
            assert compare_metadata(context, Base.metadata) == []
    finally:
        engine.dispose()
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0047_geo_monitoring_plans"],
        cwd=db.plan.backend_dir,
        env=db.plan.env,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0 and "0048 Batch/Run 无法安全降级" in result.stdout + result.stderr
    with psycopg.connect(db.url) as conn:
        assert existing_rows(conn) == db.before


def test_schedule_window_unique_even_with_different_plan_revisions(
    run_database: RunDatabase,
) -> None:
    db = run_database
    with psycopg.connect(db.url) as conn:
        plan_id = insert_plan(conn, db.plan)
        now = conn.execute("SELECT now()").fetchone()[0]
    barrier = Barrier(2)

    def create(revision: int) -> str:
        try:
            with psycopg.connect(db.url) as conn:
                barrier.wait(timeout=5)
                identity = batch(
                    conn,
                    db,
                    trigger_type="SCHEDULED",
                    plan_id=plan_id,
                    scheduled_for=now,
                    schedule_identity=str(revision) * 64,
                    plan_snapshot=Jsonb(
                        plan_snapshot(db.input, plan_id=str(plan_id), plan_revision=revision)
                    ),
                )
                run(conn, db, identity)
            return "created"
        except psycopg.errors.UniqueViolation as error:
            return error.diag.constraint_name

    with ThreadPoolExecutor(max_workers=2) as workers:
        assert sorted(workers.map(create, [0, 1])) == ["created", "uq_geo_batches_schedule_window"]


@pytest.mark.parametrize("isolation", ["READ COMMITTED", "REPEATABLE READ"])
def test_committed_initial_matrix_cannot_expand_concurrently(
    run_database: RunDatabase, isolation: str
) -> None:
    db = run_database
    with psycopg.connect(db.url) as conn:
        identity = batch(conn, db)
        run(conn, db, identity)
    barrier = Barrier(2)

    def expand(index: int) -> str:
        try:
            with psycopg.connect(db.url) as conn:
                conn.execute(f"SET TRANSACTION ISOLATION LEVEL {isolation}")
                conn.execute(f"SELECT id FROM {BATCH} WHERE id=%s", (identity,)).fetchone()
                barrier.wait(timeout=5)
                run(conn, db, identity, repeat_index=index)
            return "unexpected-success"
        except psycopg.errors.CheckViolation as error:
            return error.diag.constraint_name
        except psycopg.errors.SerializationFailure:
            return "serialization-conflict"

    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(expand, [2, 3]))
    assert set(results) <= {"ck_geo_batches_run_count", "serialization-conflict"}
    with psycopg.connect(db.url) as conn:
        assert (
            conn.execute(f"SELECT count(*) FROM {RUN} WHERE batch_id=%s", (identity,)).fetchone()[0]
            == 1
        )
