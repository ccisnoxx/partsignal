"""旧v1非空历史前滚不变，新v2批次捕获实际current且幂等重放保持。"""

from copy import deepcopy
from uuid import UUID, uuid4

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from psycopg.types.json import Jsonb
from sqlalchemy import create_engine, select

from app.db import Base
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from tests.integration.geo_plans_support import PlansAPI
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine
from tests.integration.geo_runs_support import RunDatabase, batch, run
from tests.integration.geo_runs_support import plan_database as plan_database
from tests.integration.geo_runs_support import run_database as run_database
from tests.integration.test_geo_monitoring_plans import existing_rows
from tests.integration.test_migrations import run_alembic
from tests.unit.test_geo_surface_contract import contract as contract
from tests.unit.test_geo_surface_contract import validate

pytestmark = pytest.mark.integration


def test_forward_preserves_v1_nonempty_history_and_rule_metadata(run_database: RunDatabase) -> None:
    db = run_database
    with psycopg.connect(db.url) as conn:
        identity = batch(conn, db)
        run(conn, db, identity)
    run_alembic(db.plan.env, db.plan.backend_dir, "0057_geo_insight_indexes")
    with psycopg.connect(db.url) as conn:
        before = conn.execute("SELECT to_jsonb(b) FROM geo_observation_batches b").fetchall()
        runs_before = conn.execute("SELECT to_jsonb(r) FROM geo_observation_runs r").fetchall()
        legacy_before = existing_rows(conn)
    run_alembic(db.plan.env, db.plan.backend_dir, "head")
    with psycopg.connect(db.url) as conn:
        assert (
            conn.execute("SELECT to_jsonb(b) FROM geo_observation_batches b").fetchall() == before
        )
        assert (
            conn.execute("SELECT to_jsonb(r) FROM geo_observation_runs r").fetchall() == runs_before
        )
        assert existing_rows(conn) == legacy_before
        snapshot = conn.execute(
            "SELECT rule_snapshot FROM geo_observation_batches WHERE id=%s", (identity,)
        ).fetchone()[0]
        assert snapshot == {"schema_version": 1, "rule_set_revision": 1}
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://", 1))
    tables = {"geo_rule_set_revisions", "geo_rule_set_current"}
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


def test_new_batches_use_current_full_rules_and_replay_keeps_old(
    plans_api: PlansAPI, contract: dict
) -> None:
    api = plans_api
    plan = api.create(repeat_count=1)
    current = api.api.admin.get("/api/v1/geo/rules").json()
    payload = {"source": "PLAN", "plan_id": plan["id"], "expected_revision": plan["revision"]}
    key = str(uuid4())

    def create(identity: str) -> dict:
        result = api.api.engineer.post(
            "/api/v1/geo/observation-batches", json=payload, headers={"Idempotency-Key": identity}
        )
        assert result.status_code == 201, result.text
        return result.json()

    first = create(key)
    with api.api.factory() as db:
        first_batch = db.get(GeoObservationBatch, UUID(first["batch_id"]))
        frozen = deepcopy(first_batch.rule_snapshot)
        assert frozen == {
            "schema_version": 2,
            "rule_set_revision": current["revision"],
            "configuration": current["configuration"],
        }
        validate(contract, "GeoBatchRuleSnapshotV2", frozen)
    config = deepcopy(current["configuration"])
    config["visibility_drop_points"] = 0.25
    updated = api.api.admin.put(
        "/api/v1/geo/rules",
        json={"expected_revision": current["revision"], "configuration": config},
    )
    assert updated.status_code == 200, updated.text
    after = updated.json()
    assert create(key) == first
    second = create(str(uuid4()))
    with api.api.factory() as db:
        assert db.get(GeoObservationBatch, UUID(first["batch_id"])).rule_snapshot == frozen
        latest = db.get(GeoObservationBatch, UUID(second["batch_id"]))
        assert latest.rule_snapshot == {
            "schema_version": 2,
            "rule_set_revision": after["revision"],
            "configuration": after["configuration"],
        }
        assert latest.plan_snapshot["rule_set_revision"] == after["revision"]
        runs = db.scalars(
            select(GeoObservationRun).where(GeoObservationRun.batch_id == latest.id)
        ).all()
        assert all(row.input_snapshot["rule_set_revision"] == after["revision"] for row in runs)


def test_database_rejects_run_revision_different_from_v2_batch(run_database: RunDatabase) -> None:
    db = run_database
    run_alembic(db.plan.env, db.plan.backend_dir, "head")
    with psycopg.connect(db.url) as conn:
        revision, configuration = conn.execute(
            "SELECT r.revision,r.configuration FROM geo_rule_set_current c "
            "JOIN geo_rule_set_revisions r ON r.revision=c.revision WHERE c.id=1"
        ).fetchone()
        identity = batch(
            conn,
            db,
            rule_snapshot=Jsonb(
                {"schema_version": 2, "rule_set_revision": revision, "configuration": configuration}
            ),
        )
        snapshot = deepcopy(db.input)
        snapshot["rule_set_revision"] = revision + 1
        with pytest.raises(psycopg.errors.CheckViolation) as failure:
            run(conn, db, identity, input_snapshot=Jsonb(snapshot))
        assert failure.value.diag.constraint_name == "ck_geo_run_rule_revision"
        conn.rollback()
