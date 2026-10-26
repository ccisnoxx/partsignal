"""AUTO-02并发、授权撤销和回拨边界；所有同步点均为测试夹具。"""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta
from threading import Event
from uuid import uuid4

import pytest

from app.config import settings
from app.models.geo_opportunity_schedule import GeoOpportunitySchedule
from app.models.identity import User
from app.schemas.geo_opportunity_schedule import GeoOpportunityScheduleCommand
from app.services import geo_opportunity_schedule_commands as commands
from app.services import geo_opportunity_scheduler as service
from app.services.identity import _user_business_reference_counts
from tests.integration.geo_opportunity_schedule_support import (
    PATH,
    active,
    another_admin,
    execute,
    receipts,
    windows,
)
from tests.integration.geo_opportunity_schedule_support import (
    analysis_engine as analysis_engine,
)
from tests.integration.geo_opportunity_schedule_support import (
    answer_database as answer_database,
)
from tests.integration.geo_opportunity_schedule_support import (
    api as api,
)
from tests.integration.geo_opportunity_schedule_support import (
    harness as harness,
)
from tests.integration.geo_opportunity_schedule_support import (
    overview_api as overview_api,
)
from tests.integration.geo_opportunity_schedule_support import (
    plan_database as plan_database,
)
from tests.integration.geo_opportunity_schedule_support import (
    review_api as review_api,
)
from tests.integration.geo_opportunity_schedule_support import (
    run_database as run_database,
)

pytestmark = pytest.mark.integration


def test_two_scans_commit_one_receipt_and_one_window(api):
    value = active(api, scope="FILTERED", subject_ids=[str(uuid4())])
    before = receipts(api)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(execute, api, value) for _ in range(2)]
        results = [item.result(timeout=30) for item in futures]
    assert sum(item is not None for item in results) == 1
    assert receipts(api) == before + 1
    assert [row.status for row in windows(api, value["revision"])] == ["COMPLETED"]


def test_pause_holding_config_lock_wins_against_due_scan(api, monkeypatch):
    value = active(api, scope="FILTERED", subject_ids=[str(uuid4())])
    due = datetime.fromisoformat(value["next_run_at"])
    locked, scan_authorized = Event(), Event()
    original = service.current_actor_command

    def paused_clock(db):
        locked.set()
        assert scan_authorized.wait(15)
        return due + timedelta(seconds=1)

    @contextmanager
    def observe_authorization(*args, **kwargs):
        with original(*args, **kwargs) as actor:
            scan_authorized.set()
            yield actor

    monkeypatch.setattr(commands, "clock", paused_clock)
    monkeypatch.setattr(service, "current_actor_command", observe_authorization)
    before = receipts(api)

    def pause():
        with api.harness.factory() as db:
            actor = db.get(User, api.harness.database.runs.plan.actor)
            return commands.change(
                db,
                actor=actor,
                request_id="auto02-pause-race",
                payload=GeoOpportunityScheduleCommand(expected_revision=value["revision"]),
                operation="pause",
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(pause)
        assert locked.wait(15)
        scan = pool.submit(execute, api, value)
        assert pending.result(timeout=30).status == "PAUSED"
        assert scan.result(timeout=30) is None
    assert receipts(api) == before
    rows = windows(api, value["revision"])
    assert len(rows) == 1 and rows[0].status == "MISSED" and rows[0].error_code == "SUPERSEDED"
    assert api.admin.get(PATH).json()["status"] == "PAUSED"


def test_pause_after_failure_rollback_is_not_overwritten_by_failed_window(api, monkeypatch):
    value = active(api, scope="FILTERED", subject_ids=[str(uuid4())])
    due = datetime.fromisoformat(value["next_run_at"])
    original = service.record_failure
    monkeypatch.setattr(commands, "clock", lambda db: due + timedelta(seconds=1))

    def fail(*args, **kwargs):
        raise RuntimeError("虚构故障")

    def pause_then_record(db, attempt, code):
        response = api.admin.post(PATH + "/pause", json={"expected_revision": value["revision"]})
        assert response.status_code == 200, response.text
        original(db, attempt, code)

    monkeypatch.setattr(service, "run_scheduled_evaluation", fail)
    monkeypatch.setattr(service, "record_failure", pause_then_record)
    before = receipts(api)
    assert execute(api, value) is None
    assert receipts(api) == before
    assert [row.status for row in windows(api, value["revision"])] == ["MISSED"]
    assert api.admin.get(PATH).json()["status"] == "PAUSED"


@pytest.mark.parametrize(
    "patch,code",
    [
        ({"is_active": False}, "AUTH_REQUIRED"),
        ({"must_change_password": True}, "PASSWORD_CHANGE_REQUIRED"),
        ({"account_type": "ENGINEER"}, "PERMISSION_DENIED"),
    ],
)
def test_revoked_authorizer_never_evaluates_but_records_true_failure(api, patch, code):
    with another_admin(api) as (client, identity):
        value = active(api, client=client, scope="FILTERED", subject_ids=[str(uuid4())])
        with api.harness.factory.begin() as db:
            assert _user_business_reference_counts(db, [identity])[identity] >= 1
            actor = db.get(User, identity)
            for key, val in patch.items():
                setattr(actor, key, val)
        before = receipts(api)
        assert execute(api, value) is None
        assert receipts(api) == before
        rows = windows(api, value["revision"])
        assert len(rows) == 1 and rows[0].status == "FAILED" and rows[0].error_code == code
        assert api.admin.get(PATH).json()["blocked_reason"] == code


def test_global_switch_does_not_consume_window_and_clock_rollback_never_reuses_history(
    api, monkeypatch
):
    value = active(api, scope="FILTERED", subject_ids=[str(uuid4())])
    due = datetime.fromisoformat(value["next_run_at"])
    monkeypatch.setattr(settings, "geo_opportunity_evaluation_enabled", False)
    assert execute(api, value) is None
    with api.harness.factory() as db:
        assert db.get(GeoOpportunitySchedule, 1).next_run_at == due
    assert windows(api, value["revision"]) == []
    monkeypatch.setattr(settings, "geo_opportunity_evaluation_enabled", True)
    assert execute(api, value) is not None
    # 运行不改变配置revision；同人同配置保存不重设next。
    current = api.admin.get(PATH).json()
    saved = api.admin.put(
        PATH,
        json={"expected_revision": current["revision"], "configuration": current["configuration"]},
    )
    assert saved.status_code == 200 and saved.json() == current
    monkeypatch.setattr(commands, "clock", lambda db: due - timedelta(days=2))
    paused = api.admin.post(PATH + "/pause", json={"expected_revision": current["revision"]}).json()
    resumed = api.admin.post(PATH + "/resume", json={"expected_revision": paused["revision"]})
    assert resumed.status_code == 200, resumed.text
    assert datetime.fromisoformat(resumed.json()["next_run_at"]) > due
    assert execute(api, resumed.json(), now=due - timedelta(days=1)) is None
