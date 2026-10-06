"""GEO-1005：真实 PG/API 的版本边界，拒绝不产生执行或 Broker 副作用。"""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier
from uuid import UUID, uuid4

import pytest
import redis
from sqlalchemy import text

from app.errors import AppError
from app.services import geo_batches
from tests.integration.geo_cron_support import historical_cron
from tests.integration.geo_plans_support import PREFIX, PlansAPI
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine
from tests.unit.test_geo_surface_contract import contract as contract
from tests.unit.test_geo_surface_contract import validate

pytestmark = pytest.mark.integration
BATCHES = "/api/v1/geo/observation-batches"
TABLES = (
    "geo_monitoring_plans",
    "geo_monitoring_plan_subjects",
    "geo_monitoring_plan_prompts",
    "geo_monitoring_plan_profiles",
    "geo_observation_batches",
    "geo_observation_runs",
    "geo_batch_creation_requests",
    "geo_batch_subjects",
    "geo_prompt_variants",
    "geo_engine_surfaces",
    "geo_collection_profiles",
    "geo_rule_set_revisions",
    "geo_rule_set_current",
    "audit_logs",
)


def snapshot(api: PlansAPI) -> dict[str, str]:
    with api.api.factory() as db:
        return {
            table: db.scalar(
                text(
                    "SELECT md5(COALESCE(string_agg(row::text, ',' ORDER BY row::text), '')) "
                    f"FROM (SELECT to_jsonb(t) AS row FROM {table} t) source"
                )
            )
            for table in TABLES
        }


def rejected(response) -> None:
    assert response.status_code == 409, response.text
    error = response.json()["error"]
    assert error["code"] == "GEO_PLAN_CRON_UNSUPPORTED"
    assert error["message"] == "V1.0 不支持 CRON 计划；历史计划只读，请新建人工计划或人工批次"
    assert error["details"] == {}
    assert error["request_id"] == response.headers["X-Request-ID"]


@pytest.fixture
def no_redis(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("拒绝路径不得到达批次派发或 Redis")

    monkeypatch.setattr(redis.Redis, "execute_command", forbidden)
    monkeypatch.setattr(geo_batches, "dispatch_created_batch", forbidden)


def test_cron_create_rejected_without_writes(plans_api: PlansAPI, no_redis):
    api = plans_api
    before = snapshot(api)
    rejected(
        api.api.engineer.post(
            PREFIX, json=api.payload(schedule_kind="CRON", cron_expression="0 * * * *")
        )
    )
    # 版本拒绝先于资源资格，未知资源不应促成保存一个 CRON 草稿。
    rejected(
        api.api.admin.post(
            PREFIX,
            json=api.payload(
                schedule_kind="CRON",
                cron_expression="0 * * * *",
                collection_profile_ids=[str(uuid4())],
            ),
        )
    )
    assert snapshot(api) == before


@pytest.mark.parametrize("status", ["DISABLED", "ACTIVE", "PAUSED", "ARCHIVED"])
def test_historical_cron_is_readonly_for_all_commands(
    plans_api: PlansAPI, status, contract, no_redis
):
    api = plans_api
    row = historical_cron(api, status)
    before = snapshot(api)
    path = f"{PREFIX}/{row['id']}"
    assert row["status"] == status and row["schedule_kind"] == "CRON"
    assert row["workflow_stage"] == "UNSUPPORTED_SCHEDULE"
    assert row["primary_task"] == "VIEW_HISTORY" and row["available_actions"] == []
    assert row["run_entry"] == {"available": False, "reason_code": "GEO_PLAN_CRON_UNSUPPORTED"}
    assert row["deletion"]["blockers"] == ["SCHEDULE_UNSUPPORTED"]
    validate(contract, "GeoMonitoringPlanDetail", row)
    for op in ("activate", "resume", "pause", "archive", "copy"):
        rejected(api.action(row, op, **({"name": "不得创建的副本"} if op == "copy" else {})))
    # CRON->MANUAL 的显式更新同样修改历史，因此拒绝。
    rejected(api.api.engineer.patch(path, json=api.payload(expected_revision=row["revision"])))
    rejected(
        api.api.engineer.patch(
            path,
            json=api.payload(
                expected_revision=row["revision"], schedule_kind="CRON", cron_expression="1 * * * *"
            ),
        )
    )
    rejected(api.api.engineer.delete(path, params={"expected_revision": row["revision"]}))
    rejected(
        api.api.engineer.post(
            f"{path}/run",
            json={"expected_revision": row["revision"]},
            headers={"Idempotency-Key": "cron-run"},
        )
    )
    rejected(
        api.api.engineer.post(
            BATCHES,
            json={"source": "PLAN", "plan_id": row["id"], "expected_revision": row["revision"]},
            headers={"Idempotency-Key": "cron-batch"},
        )
    )
    with api.api.factory() as db:
        with pytest.raises(AppError) as caught:
            geo_batches.create_scheduled_batch(
                db=db, plan_id=UUID(row["id"]), scheduled_for=datetime(2026, 10, 5, tzinfo=UTC)
            )
        assert caught.value.code == "GEO_PLAN_CRON_UNSUPPORTED"
    assert api.api.engineer.get(path).json() == row
    listed = api.api.engineer.get(PREFIX, params={"q": api.name, "schedule_kind": "CRON"}).json()
    assert row in listed["items"]
    assert snapshot(api) == before


@pytest.mark.parametrize("state", ["DISABLED", "ACTIVE", "PAUSED"])
def test_manual_cannot_be_changed_to_cron(plans_api: PlansAPI, state, no_redis):
    api = plans_api
    row = api.create()
    if state != "DISABLED":
        row = api.action(row, "activate").json()
    if state == "PAUSED":
        row = api.action(row, "pause").json()
    before = snapshot(api)
    rejected(
        api.api.engineer.patch(
            f"{PREFIX}/{row['id']}",
            json=api.payload(
                expected_revision=row["revision"], schedule_kind="CRON", cron_expression="0 * * * *"
            ),
        )
    )
    assert api.api.engineer.get(f"{PREFIX}/{row['id']}").json() == row
    assert snapshot(api) == before


def test_parallel_legacy_cron_first_windows_are_rejected(plans_api: PlansAPI, no_redis):
    api = plans_api
    row = historical_cron(api)
    before = snapshot(api)
    barrier = Barrier(2)

    def attempt(_):
        barrier.wait(timeout=5)
        with api.api.factory() as db:
            with pytest.raises(AppError) as caught:
                geo_batches.create_scheduled_batch(
                    db=db, plan_id=UUID(row["id"]), scheduled_for=datetime(2026, 10, 5, tzinfo=UTC)
                )
            return caught.value.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(attempt, range(2))) == ["GEO_PLAN_CRON_UNSUPPORTED"] * 2
    assert snapshot(api) == before


def test_manual_create_activate_run_and_adhoc_remain_available(plans_api: PlansAPI, monkeypatch):
    api = plans_api

    def forbidden(*args, **kwargs):
        raise AssertionError("MANUAL 采集不应访问 Redis")

    monkeypatch.setattr(redis.Redis, "execute_command", forbidden)
    row = api.create(repeat_count=2)
    row = api.action(row, "activate").json()
    assert row["status"] == "ACTIVE" and row["workflow_stage"] == "ACTIVE"
    assert row["schedule_kind"] == "MANUAL_ONLY"
    response = api.api.engineer.post(
        f"{PREFIX}/{row['id']}/run",
        json={"expected_revision": row["revision"]},
        headers={"Idempotency-Key": "manual-supported"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["requested_run_count"] == 2
    response = api.api.engineer.post(
        BATCHES,
        json={"source": "AD_HOC", "configuration": api.payload(repeat_count=1)},
        headers={"Idempotency-Key": "adhoc-supported"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["requested_run_count"] == 1
    assert api.api.engineer.get(f"{PREFIX}/{row['id']}").json()["revision"] == row["revision"]
