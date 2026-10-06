"""0053 非空旧 API 历史前滚：账本回填、ORM 一致、历史不可变与安全停止。"""

import subprocess
import sys
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from psycopg.types.json import Jsonb
from sqlalchemy import create_engine

from app.db import Base
from tests.integration.geo_runs_support import batch, plan_database, run, run_database
from tests.integration.test_geo_catalog import insert_row
from tests.integration.test_geo_surfaces_profiles import insert_profile
from tests.integration.test_migrations import run_alembic
from tests.unit.test_geo_run_contract import input_snapshot, plan_snapshot

pytestmark = pytest.mark.integration
__all__ = ["plan_database", "run_database"]


def test_0053_preserves_run_history_and_backfills_unknown(run_database):
    db = run_database
    run_alembic(db.plan.env, db.plan.backend_dir, "0052_geo_profile_tests")
    # 历史冻结输入允许当前配置已失效；模拟当时 API 已发送而 Worker 丢失的事实。
    value = input_snapshot("API")
    value["profile"]["settings"].pop("max_concurrency")
    value["profile"]["settings"].pop("requests_per_minute")
    value["prompt"] = db.input["prompt"]
    value["subjects"] = db.input["subjects"]
    value["profile"]["id"] = db.input["profile"]["id"]
    value["profile"]["surface"]["id"] = db.input["profile"]["surface"]["id"]
    with psycopg.connect(db.url) as conn:
        profile = insert_profile(
            conn,
            db.plan,
            db.input["profile"]["surface"]["id"],
            "API",
            ai_channel_id=None,
            ai_model_id=None,
        )
        value["profile"]["id"] = str(profile)
        identities = []
        created = datetime.now(UTC) - timedelta(days=2)
        midnight = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        for external in ["NOT_STARTED", "UNKNOWN", "SENT"]:
            batch_id = batch(conn, db, plan_snapshot=Jsonb(plan_snapshot(value)))
            insert_row(
                conn,
                "geo_batch_subjects",
                {"batch_id": batch_id, "subject_id": db.plan.subjects[0], "role": "PRIMARY"},
            )
            identity = run(
                conn,
                db,
                batch_id,
                collection_profile_id=profile,
                input_snapshot=Jsonb(value),
                created_at=created,
            )
            conn.execute(
                "UPDATE geo_observation_runs SET status='RUNNING', started_at=%s, "
                "lease_token=%s,lease_expires_at=now()+interval '5 minutes',revision=1 WHERE id=%s",
                (midnight - timedelta(seconds=1), uuid4(), identity),
            )
            if external != "NOT_STARTED":
                conn.execute(
                    "UPDATE geo_observation_runs SET external_call_state='SENT',revision=2 "
                    "WHERE id=%s",
                    (identity,),
                )
            if external == "UNKNOWN":
                conn.execute(
                    "UPDATE geo_observation_runs SET status='FAILED',external_call_state='UNKNOWN',"
                    "error_stage='COLLECTION',error_code='COLLECTOR_UNKNOWN_OUTCOME',"
                    "error_summary='虚构旧采集丢失',finished_at=now(),lease_token=NULL,"
                    "lease_expires_at=NULL,revision=3 WHERE id=%s",
                    (identity,),
                )
            identities.append(identity)
        before = conn.execute(
            "SELECT to_jsonb(r) FROM geo_observation_runs r ORDER BY id"
        ).fetchall()
    run_alembic(db.plan.env, db.plan.backend_dir, "head")
    with psycopg.connect(db.url) as conn:
        after = conn.execute(
            'SELECT '
            "to_jsonb(r)-ARRAY['provider_status','retry_after_seconds','current_analysis_revision_id']"
            ' '
            "FROM geo_observation_runs r ORDER BY id"
        ).fetchall()
        assert after == before
        states = dict(
            conn.execute("SELECT run_id,state FROM geo_collection_reservations").fetchall()
        )
        assert states == {
            identities[0]: "RESERVED",
            identities[1]: "UNKNOWN",
            identities[2]: "SENT",
        }
        assert (
            conn.execute(
                "SELECT count(*) FROM geo_collection_reservations WHERE estimated_amount IS NULL "
                "AND estimated_currency IS NULL"
            ).fetchone()[0]
            == 3
        )
        days = dict(
            conn.execute("SELECT run_id,budget_day FROM geo_collection_reservations").fetchall()
        )
        assert days[identities[1]] == days[identities[2]] == midnight.date()
        assert days[identities[0]] == (midnight - timedelta(seconds=1)).date()
        with pytest.raises(psycopg.errors.CheckViolation) as caught, conn.transaction():
            conn.execute(
                "DELETE FROM geo_collection_reservations WHERE run_id=%s", (identities[1],)
            )
        assert caught.value.diag.constraint_name == "ck_geo_reservations_immutable"
        for invalid in [
            {"max_concurrency": 0},
            {"requests_per_minute": True},
            {"requests_per_minute": None},
        ]:
            assert not conn.execute(
                "SELECT geo_profile_settings_valid('API',%s)", (Jsonb(invalid),)
            ).fetchone()[0]
        assert conn.execute(
            "SELECT geo_profile_settings_valid('API',%s)",
            (Jsonb({"max_concurrency": 100, "requests_per_minute": 60000}),),
        ).fetchone()[0]
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://"))
    tables = {"geo_observation_runs", "geo_collection_reservations"}
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
        [sys.executable, "-m", "alembic", "downgrade", "0052_geo_profile_tests"],
        cwd=db.plan.backend_dir,
        env=db.plan.env,
        capture_output=True,
        text=True,
    )
    assert stopped.returncode != 0
    assert "0064 清理墓碑不可安全降级" in stopped.stdout + stopped.stderr
    with psycopg.connect(db.url) as conn:
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0064_geo_retention"
        )
