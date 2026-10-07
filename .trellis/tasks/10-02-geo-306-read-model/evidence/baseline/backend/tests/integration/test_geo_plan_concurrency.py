"""两个真实事务：等待后重验版本、资格、资源绑定及当前身份。"""

from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from queue import Queue
from time import monotonic, sleep
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.identity import User
from app.schemas.geo_monitoring_plans import GeoMonitoringPlanUpdate
from app.services import geo_plan_commands as commands
from app.services.geo_plan_locks import lock_plan
from tests.integration.geo_plans_support import PlansAPI
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine
from tests.integration.test_geo_plan_transactions import state

pytestmark = pytest.mark.integration


def start(
    pool: ThreadPoolExecutor, api: PlansAPI, operation: Callable[[Session], object]
) -> tuple[Future, int]:
    ready: Queue[int] = Queue()

    def execute():
        with api.api.factory() as db:
            db.execute(text("SET LOCAL statement_timeout='8s'"))
            ready.put(db.execute(text("SELECT pg_backend_pid()")).scalar_one())
            try:
                return operation(db)
            except AppError as error:
                return error

    future = pool.submit(execute)
    return future, ready.get(timeout=5)


def wait_blocked(api: PlansAPI, pid: int) -> None:
    deadline = monotonic() + 5
    with api.api.engine.connect() as conn:
        while monotonic() < deadline:
            if conn.execute(
                text("SELECT cardinality(pg_blocking_pids(:pid))>0"), {"pid": pid}
            ).scalar_one():
                return
            sleep(0.01)
    pytest.fail("没有观测到预期 PostgreSQL 行锁等待")


def test_revision_rechecked_after_resource_lock_wait(plans_api: PlansAPI) -> None:
    api = plans_api
    row = api.create()
    identity = UUID(row["id"])
    with ThreadPoolExecutor(max_workers=1) as pool, api.api.factory() as first:
        lock_plan(first, identity, 0)
        future, pid = start(
            pool,
            api,
            lambda db: commands.update_plan(
                db=db,
                plan_id=identity,
                payload=GeoMonitoringPlanUpdate.model_validate(
                    api.payload(name="失败者", expected_revision=0)
                ),
                actor=db.get(User, api.api.engineer_id),
                request_id="geo208-cas-loser",
            ),
        )
        wait_blocked(api, pid)
        commands.update_plan(
            db=first,
            plan_id=identity,
            payload=GeoMonitoringPlanUpdate.model_validate(
                api.payload(name="赢家", expected_revision=0)
            ),
            actor=first.get(User, api.api.admin_id),
            request_id="geo208-cas-winner",
        )
        loser = future.result(timeout=10)
    assert isinstance(loser, AppError) and loser.code == "REVISION_CONFLICT"
    after = state(api, row["id"])
    assert after[0]["revision"] == 1 and after[0]["name"] == "赢家" and len(after[1]) == 2


@pytest.mark.parametrize("resource", ["surface", "profile"])
def test_profile_disable_or_edit_while_activation_waits_is_rejected(
    plans_api: PlansAPI, resource: str
) -> None:
    api = plans_api
    row = api.create()
    before = state(api, row["id"])
    with ThreadPoolExecutor(max_workers=1) as pool, api.api.factory() as first:
        # 真实Profile命令先锁Surface；Plan必须遵循同序且重读当前事实。
        first.execute(
            text("SELECT id FROM geo_engine_surfaces WHERE id=:id FOR UPDATE"), {"id": api.surface}
        )
        future, pid = start(
            pool,
            api,
            lambda db: commands.change_status(
                db=db,
                plan_id=UUID(row["id"]),
                expected_revision=0,
                operation="activate",
                actor=db.get(User, api.api.engineer_id),
                request_id="geo208-profile-wait",
            ),
        )
        wait_blocked(api, pid)
        table = "geo_engine_surfaces" if resource == "surface" else "geo_collection_profiles"
        first.execute(
            text(f"UPDATE {table} SET is_active=false, revision=revision+1 WHERE id=:id"),
            {"id": api.surface if resource == "surface" else api.profile},
        )
        first.commit()
        denied = future.result(timeout=10)
    assert isinstance(denied, AppError)
    assert denied.code == (
        "REVISION_CONFLICT" if resource == "profile" else "GEO_PLAN_PROFILE_INELIGIBLE"
    )
    assert state(api, row["id"]) == before


def test_account_disabled_while_command_waits_cannot_write(plans_api: PlansAPI) -> None:
    api = plans_api
    row = api.create()
    before = state(api, row["id"])
    with ThreadPoolExecutor(max_workers=1) as pool, api.api.factory() as first:
        first.execute(select(User.id).where(User.id == api.api.engineer_id).with_for_update())
        future, pid = start(
            pool,
            api,
            lambda db: commands.change_status(
                db=db,
                plan_id=UUID(row["id"]),
                expected_revision=0,
                operation="activate",
                actor=db.get(User, api.api.engineer_id),
                request_id="geo208-actor-wait",
            ),
        )
        wait_blocked(api, pid)
        first.execute(
            text("UPDATE users SET is_active=false, revision=revision+1 WHERE id=:id"),
            {"id": api.api.engineer_id},
        )
        first.commit()
        denied = future.result(timeout=10)
    assert isinstance(denied, AppError) and denied.code == "AUTH_REQUIRED"
    assert state(api, row["id"]) == before
