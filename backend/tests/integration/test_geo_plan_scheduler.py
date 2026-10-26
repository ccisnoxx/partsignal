"""AUTO-01真实PG/HTTP、窗口幂等、暂停竞态与原批次冻结。"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Barrier, Event
from uuid import UUID

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from app.config import settings
from app.errors import AppError
from app.models.geo_plan_schedules import GeoPlanSchedule, GeoPlanScheduleWindow
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.geo_surfaces import GeoCollectionProfile
from app.services import geo_plan_scheduler as service
from app.services import geo_schedule_management as management
from tests.integration.geo_cron_support import historical_cron
from tests.integration.geo_plans_support import PREFIX
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine
from tests.unit.test_geo_run_contract import contract as contract
from tests.unit.test_geo_run_contract import validate

pytestmark = pytest.mark.integration
__all__ = ["plans_api", "questions_api", "questions_engine"]


@pytest.fixture
def api(plans_api, monkeypatch):
    monkeypatch.setattr(service, "SessionLocal", plans_api.api.factory)
    sent = []

    def dispatch(db, identity):
        with plans_api.api.factory() as independent:
            assert independent.get(GeoObservationBatch, identity) is not None
            assert (
                independent.scalar(
                    select(GeoPlanScheduleWindow).where(GeoPlanScheduleWindow.batch_id == identity)
                )
                is not None
            )
        sent.append(identity)

    monkeypatch.setattr(service, "dispatch_created_batch", dispatch)
    plans_api.sent = sent
    return plans_api


def active(api, **patch):
    plan = api.create(schedule_kind="CRON", cron_expression="* * * * *", timezone="UTC", **patch)
    assert plan["status"] == "DISABLED" and plan["schedule"]["next_run_at"] is None
    result = api.action(plan, "activate")
    assert result.status_code == 200, result.text
    plan = result.json()
    return plan, datetime.fromisoformat(plan["schedule"]["next_run_at"])


def invoke(api, plan, due, *, now=None):
    with api.api.factory() as db:
        return service.create_scheduled_batch(
            db=db,
            plan_id=UUID(plan["id"]),
            scheduled_for=due,
            now=now or due + timedelta(seconds=1),
        )


def test_registered_cron_real_matrix_receipt_history_and_commit_before_dispatch(api, contract):
    plan, due = active(api, repeat_count=2)
    first = invoke(api, plan, due)
    assert first.requested_run_count == 2
    assert invoke(api, plan, due) == first
    assert len(api.sent) == 1
    current = api.api.engineer.get(f"{PREFIX}/{plan['id']}").json()
    assert current["revision"] == plan["revision"]  # 运行进展不假装配置变化。
    assert current["schedule"]["latest_window"]["status"] == "CREATED"
    assert current["schedule"]["latest_window"]["batch_id"] == str(first.batch_id)
    validate(contract, "GeoMonitoringPlanDetail", current)
    with api.api.factory() as db:
        batch = db.get(GeoObservationBatch, first.batch_id)
        assert batch.trigger_type == "SCHEDULED" and batch.scheduled_for == due
        assert batch.created_by is None and batch.plan_snapshot["plan_revision"] == plan["revision"]
        runs = list(
            db.scalars(select(GeoObservationRun).where(GeoObservationRun.batch_id == batch.id))
        )
        assert len(runs) == 2 and all(
            r.status == "PENDING" and r.external_call_state == "NOT_STARTED" for r in runs
        )
        assert all(r.input_snapshot["profile"]["collection_mode"] == "MANUAL" for r in runs)
        with pytest.raises(DBAPIError):
            db.execute(
                text("UPDATE geo_plan_schedule_windows SET status=status WHERE plan_id=:id"),
                {"id": plan["id"]},
            )
        db.rollback()


def test_parallel_due_scans_only_build_one_batch(api):
    plan, due = active(api)
    gate = Barrier(2)

    def run():
        gate.wait(timeout=10)
        return invoke(api, plan, due)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: run(), range(2)))
    assert results[0].batch_id == results[1].batch_id
    assert len(api.sent) == 1
    with api.api.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoPlanScheduleWindow)
                .where(GeoPlanScheduleWindow.plan_id == UUID(plan["id"]))
            )
            == 1
        )


def test_pause_wins_pending_scan_then_resume_starts_future_window(api, monkeypatch):
    plan, due = active(api)
    paused = Event()
    release = Event()
    reading = Event()
    original_clock = management.clock
    original_lock = service.lock_plan

    def pause_clock(db):
        paused.set()
        assert release.wait(10)
        return original_clock(db)

    def scheduler_lock(*args, **kwargs):
        reading.set()
        return original_lock(*args, **kwargs)

    monkeypatch.setattr(management, "clock", pause_clock)
    monkeypatch.setattr(service, "lock_plan", scheduler_lock)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pause = pool.submit(api.action, plan, "pause")
        assert paused.wait(10)
        scan = pool.submit(invoke, api, plan, due)
        assert reading.wait(10)
        release.set()
        response = pause.result(timeout=10)
        assert response.status_code == 200, response.text
        with pytest.raises(AppError) as caught:
            scan.result(timeout=10)
        assert caught.value.code == "REVISION_CONFLICT"
    monkeypatch.setattr(management, "clock", original_clock)
    latest = response.json()
    assert latest["schedule"]["next_run_at"] is None and not api.sent
    resumed = api.action(latest, "resume").json()
    assert resumed["status"] == "ACTIVE" and resumed["schedule"]["next_run_at"] is not None


def test_eligibility_failure_is_recorded_without_partial_batch_or_same_window_retry(api):
    plan, due = active(api)
    with api.api.factory.begin() as db:
        profile = db.get(GeoCollectionProfile, api.profile)
        profile.is_active = False
        profile.revision += 1
    assert invoke(api, plan, due) is None
    with api.api.factory() as db:
        window = db.get(GeoPlanScheduleWindow, (UUID(plan["id"]), due))
        assert window.status == "FAILED" and window.error_code == "GEO_PLAN_PROFILE_INELIGIBLE"
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoObservationBatch)
                .where(GeoObservationBatch.plan_id == UUID(plan["id"]))
            )
            == 0
        )
        assert db.get(GeoPlanSchedule, UUID(plan["id"])).next_run_at > due
    assert not api.sent
    with pytest.raises(AppError):
        invoke(api, plan, due)


def test_late_window_is_one_missed_range_and_global_off_does_not_advance(api, monkeypatch):
    plan, due = active(api)
    observed = due + timedelta(hours=2)
    monkeypatch.setattr(service, "clock", lambda db: observed)
    monkeypatch.setattr(settings, "geo_monitoring_enabled", False)
    assert service.create_due_plan_batches() == 0
    with api.api.factory() as db:
        assert db.get(GeoPlanSchedule, UUID(plan["id"])).next_run_at == due
    monkeypatch.setattr(settings, "geo_monitoring_enabled", True)
    assert service.create_due_plan_batches() == 0
    with api.api.factory() as db:
        window = db.get(GeoPlanScheduleWindow, (UUID(plan["id"]), due))
        assert window.status == "MISSED" and window.covered_until > observed
        assert db.get(GeoPlanSchedule, UUID(plan["id"])).next_run_at == window.covered_until
    assert not api.sent


def test_new_cron_invalid_date_rolls_back_and_legacy_stays_unregistered(api):
    legacy = historical_cron(api)
    assert legacy["schedule"] is None and legacy["workflow_stage"] == "UNSUPPORTED_SCHEDULE"
    bad = api.api.engineer.post(
        PREFIX, json=api.payload(schedule_kind="CRON", cron_expression="0 0 31 2 *")
    )
    assert bad.status_code == 422, bad.text
    assert api.api.engineer.get(f"{PREFIX}/{legacy['id']}").json() == legacy
    assert api.action(legacy, "resume").json()["error"]["code"] == "GEO_PLAN_CRON_UNSUPPORTED"
    with api.api.factory() as db:
        assert db.get(GeoPlanSchedule, UUID(legacy["id"])) is None


def test_database_rejects_active_cursor_with_paused_plan_at_commit(api):
    plan, _ = active(api)
    with api.api.factory() as db:
        db.execute(
            text(
                "UPDATE geo_monitoring_plans SET status='PAUSED',revision=revision+1 WHERE id=:id"
            ),
            {"id": plan["id"]},
        )
        with pytest.raises(DBAPIError) as caught:
            db.commit()
        assert caught.value.orig.sqlstate == "23514"
        db.rollback()


@pytest.mark.parametrize("target", ["clear_active_cursor", "activate_without_cursor"])
def test_database_rejects_registered_active_plan_without_next_window(api, target):
    if target == "clear_active_cursor":
        plan, _ = active(api)
        statement = "UPDATE geo_plan_schedules SET next_run_at=NULL WHERE plan_id=:id"
    else:
        plan = api.create(schedule_kind="CRON", cron_expression="0 9 * * *")
        statement = (
            "UPDATE geo_monitoring_plans SET status='ACTIVE',revision=revision+1 WHERE id=:id"
        )
    with api.api.factory() as db:
        with pytest.raises(DBAPIError) as caught:
            db.execute(text(statement), {"id": plan["id"]})
            db.commit()
        assert caught.value.orig.sqlstate == "23514"
        db.rollback()


def test_clock_rollback_resume_never_selects_processed_window(api, monkeypatch):
    plan, due = active(api)
    first = invoke(api, plan, due)
    monkeypatch.setattr(management, "clock", lambda db: due - timedelta(seconds=20))
    paused = api.action(plan, "pause").json()
    resumed = api.action(paused, "resume").json()
    following = datetime.fromisoformat(resumed["schedule"]["next_run_at"])
    assert following > due
    assert invoke(api, plan, due) == first
    with api.api.factory() as db:
        assert db.get(GeoPlanSchedule, UUID(plan["id"])).next_run_at == following
    second = invoke(api, resumed, following)
    assert second.batch_id != first.batch_id


@pytest.mark.parametrize("stage", ["freeze", "dispatch"])
def test_partial_failure_keeps_cursor_and_window_commit_boundary(api, monkeypatch, stage):
    plan, due = active(api)
    original = service.freeze_batch
    if stage == "freeze":

        def fail(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError("虚构冻结后故障")

        monkeypatch.setattr(service, "freeze_batch", fail)
    else:

        def fail(*args, **kwargs):
            raise RuntimeError("虚构commit后派发故障")

        monkeypatch.setattr(service, "dispatch_created_batch", fail)
    with pytest.raises(RuntimeError):
        invoke(api, plan, due)
    with api.api.factory() as db:
        cursor = db.get(GeoPlanSchedule, UUID(plan["id"]))
        window = db.get(GeoPlanScheduleWindow, (UUID(plan["id"]), due))
        if stage == "freeze":
            assert cursor.next_run_at == due and window is None
            assert (
                db.scalar(
                    select(func.count())
                    .select_from(GeoObservationBatch)
                    .where(GeoObservationBatch.plan_id == UUID(plan["id"]))
                )
                == 0
            )
        else:
            assert window.status == "CREATED" and cursor.next_run_at > due
            # 已提交状态是真实权威，旧回执只读返回，不重复尝试Broker。
            receipt = invoke(api, plan, due)
            assert receipt.batch_id == window.batch_id


def test_additive_schema_metadata_and_unsafe_downgrade_stops(api):
    import importlib.util
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import inspect

    path = Path(__file__).resolve().parents[2] / "alembic/versions/0067_geo_plan_schedules.py"
    spec = importlib.util.spec_from_file_location("auto01_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with api.api.engine.connect() as conn:
        inspector = inspect(conn)
        for model in (GeoPlanSchedule, GeoPlanScheduleWindow):
            actual = {c["name"]: c["nullable"] for c in inspector.get_columns(model.__tablename__)}
            assert actual == {c.name: c.nullable for c in model.__table__.columns}
            assert set(
                inspector.get_pk_constraint(model.__tablename__)["constrained_columns"]
            ) == set(model.__table__.primary_key.columns.keys())
        conn.rollback()
        with (
            pytest.raises(DBAPIError) as caught,
            conn.begin(),
            Operations.context(MigrationContext.configure(conn)),
        ):
            module.downgrade()
        assert caught.value.orig.sqlstate == "55000"
        assert (
            conn.scalar(text("SELECT version_num FROM alembic_version"))
            == "0070_geo_citation_observation"
        )
        assert "geo_plan_schedule_windows" in inspect(conn).get_table_names()


@pytest.mark.parametrize("eligible", [True, False])
def test_elapsed_windows_inside_grace_are_recorded_before_advancing(api, eligible):
    plan, due = active(api)
    if not eligible:
        with api.api.factory.begin() as db:
            profile = db.get(GeoCollectionProfile, api.profile)
            profile.is_active = False
            profile.revision += 1
    result = invoke(api, plan, due, now=due + timedelta(minutes=2, seconds=10))
    assert (result is not None) == eligible
    with api.api.factory() as db:
        rows = list(
            db.scalars(
                select(GeoPlanScheduleWindow)
                .where(GeoPlanScheduleWindow.plan_id == UUID(plan["id"]))
                .order_by(GeoPlanScheduleWindow.scheduled_for)
            )
        )
        assert len(rows) == 2
        assert rows[0].scheduled_for == due
        assert rows[0].status == ("CREATED" if eligible else "FAILED")
        assert rows[1].status == "MISSED"
        assert rows[1].scheduled_for == due + timedelta(minutes=1)
        assert rows[1].covered_until == due + timedelta(minutes=3)
        assert db.get(GeoPlanSchedule, UUID(plan["id"])).next_run_at == rows[1].covered_until
