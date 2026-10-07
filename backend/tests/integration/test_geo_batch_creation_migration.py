"""0049 非空历史前滚、引用回填与不可逆降级安全停止。"""

import subprocess
import sys

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from app.db import Base
from tests.integration.geo_runs_support import (
    RunDatabase,
    batch,
    run,
)
from tests.integration.geo_runs_support import (
    plan_database as plan_database,
)
from tests.integration.geo_runs_support import (
    run_database as run_database,
)
from tests.integration.test_migrations import run_alembic

pytestmark = pytest.mark.integration


def test_forward_preserves_nonempty_frozen_inputs_and_matches_metadata(run_database: RunDatabase):
    db = run_database
    with psycopg.connect(db.url) as conn:
        identity = batch(conn, db)
        run_id = run(conn, db, identity)
        before = conn.execute(
            "SELECT plan_snapshot, rule_snapshot FROM geo_observation_batches WHERE id=%s",
            (identity,),
        ).fetchone()
        input_before = conn.execute(
            "SELECT input_snapshot FROM geo_observation_runs WHERE id=%s", (run_id,)
        ).fetchone()[0]
    forward = run_alembic(db.plan.env, db.plan.backend_dir, "0049_geo_batch_creation")
    assert forward.returncode == 0
    with psycopg.connect(db.url) as conn:
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0049_geo_batch_creation"
        )
        assert (
            conn.execute(
                "SELECT plan_snapshot, rule_snapshot FROM geo_observation_batches WHERE id=%s",
                (identity,),
            ).fetchone()
            == before
        )
        assert (
            conn.execute(
                "SELECT input_snapshot FROM geo_observation_runs WHERE id=%s", (run_id,)
            ).fetchone()[0]
            == input_before
        )
        assert conn.execute(
            "SELECT subject_id::text, role FROM geo_batch_subjects WHERE batch_id=%s", (identity,)
        ).fetchall() == [(db.input["subjects"][0]["id"], "PRIMARY")]
        assert conn.execute("SELECT count(*) FROM geo_batch_creation_requests").fetchone()[0] == 0
        with pytest.raises(psycopg.errors.CheckViolation) as caught:
            conn.execute("DELETE FROM geo_batch_subjects WHERE batch_id=%s", (identity,))
        assert caught.value.diag.constraint_name == "ck_geo_creation_immutable"
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://", 1))
    tables = {"geo_batch_creation_requests", "geo_batch_subjects"}
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
        [sys.executable, "-m", "alembic", "downgrade", "0048_geo_batches_runs"],
        cwd=db.plan.backend_dir,
        env=db.plan.env,
        capture_output=True,
        text=True,
    )
    assert (
        stopped.returncode != 0
        and "0049 创建身份与历史引用不可安全降级" in stopped.stdout + stopped.stderr
    )
    with psycopg.connect(db.url) as conn:
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0049_geo_batch_creation"
        )
