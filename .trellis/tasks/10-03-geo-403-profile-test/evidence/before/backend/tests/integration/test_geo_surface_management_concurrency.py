"""GEO-205 两事务锁交错，依据 PG 阻塞事实验证 revision、权限与绑定重读。"""

from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from queue import Queue
from time import monotonic, sleep
from uuid import UUID

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.geo_surfaces import GeoCollectionProfile
from app.models.identity import SessionRecord, User
from app.schemas.geo_surfaces import GeoEngineSurfaceUpdate
from app.services import geo_surface_commands as commands
from app.services.geo_surface_locks import command, lock_surface
from tests.integration.geo_surface_management_support import SurfaceAPI, actor
from tests.integration.geo_surface_management_support import surface_api as surface_api
from tests.integration.geo_surface_management_support import surface_engine as surface_engine
from tests.integration.test_geo_surface_management_transactions import (
    api_registry,
    mark_profile_tested,
    model_binding,
    state,
)
from tests.unit.test_geo_surface_contract import surface_payload

pytestmark = pytest.mark.integration


def start(
    pool: ThreadPoolExecutor,
    api: SurfaceAPI,
    operation: Callable[[Session], object],
) -> tuple[Future, int]:
    ready: Queue[int] = Queue()

    def execute():
        with api.factory() as db:
            db.execute(text("SET LOCAL statement_timeout='8s'"))
            ready.put(db.execute(text("SELECT pg_backend_pid()")).scalar_one())
            try:
                return operation(db)
            except AppError as error:
                return error

    result = pool.submit(execute)
    return result, ready.get(timeout=5)


def wait_blocked(api: SurfaceAPI, pid: int) -> None:
    deadline = monotonic() + 5
    with api.engine.connect() as connection:
        while monotonic() < deadline:
            if connection.execute(
                text("SELECT cardinality(pg_blocking_pids(:pid))>0"), {"pid": pid}
            ).scalar_one():
                return
            sleep(0.01)
    pytest.fail("等待者没有进入预期 PostgreSQL 行锁阻塞")


def test_revision_is_compared_after_waiting_for_resource_lock(surface_api: SurfaceAPI) -> None:
    api = surface_api
    row = api.surface()
    sid = UUID(row["summary"]["id"])
    payload = GeoEngineSurfaceUpdate(
        **surface_payload(slug=row["summary"]["slug"], name="唯一赢家"), expected_revision=0
    )
    with ThreadPoolExecutor(max_workers=1) as pool, api.factory() as first:
        lock_surface(first, sid, 0)
        future, pid = start(
            pool,
            api,
            lambda db: commands.update_surface(
                db=db,
                surface_id=sid,
                payload=payload,
                actor=actor(db, api),
                request_id="geo205-loser",
            ),
        )
        wait_blocked(api, pid)
        # 第一事务不反向取得 User 锁；只模拟同资源写入并提交。
        first.execute(
            text(
                "UPDATE geo_engine_surfaces SET name='先提交', "
                "revision=revision+1, updated_at=now() WHERE id=:id"
            ),
            {"id": sid},
        )
        first.commit()
        loser = future.result(timeout=10)
    assert isinstance(loser, AppError) and loser.code == "REVISION_CONFLICT"
    after = state(api, "geo_engine_surfaces", str(sid))
    assert after[0]["revision"] == 1 and after[0]["name"] == "先提交"
    assert len(after[1]) == 1


def test_admin_authority_is_rechecked_after_user_lock(surface_api: SurfaceAPI) -> None:
    api = surface_api
    row = api.surface()
    sid = UUID(row["summary"]["id"])
    before = state(api, "geo_engine_surfaces", str(sid))
    with ThreadPoolExecutor(max_workers=1) as pool, api.factory() as first:
        first.execute(select(User.id).where(User.id == api.admin_id).with_for_update())
        future, pid = start(
            pool,
            api,
            lambda db: commands.set_surface_active(
                db=db,
                surface_id=sid,
                expected_revision=0,
                is_active=True,
                actor=actor(db, api),
                request_id="geo205-role-drift",
            ),
        )
        wait_blocked(api, pid)
        first.execute(
            text("UPDATE users SET account_type='ENGINEER', revision=revision+1 WHERE id=:id"),
            {"id": api.admin_id},
        )
        first.commit()
        denied = future.result(timeout=10)
    assert isinstance(denied, AppError) and denied.code == "PERMISSION_DENIED"
    assert state(api, "geo_engine_surfaces", str(sid)) == before


def test_model_set_null_drift_after_initial_binding_read_cannot_pass_revision(
    surface_api: SurfaceAPI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = surface_api
    api_registry(monkeypatch)
    channel, model = model_binding(api)
    surface = api.surface(surface_kind="MODEL_API", compliance_status="APPROVED")
    row = api.profile(
        surface, "API", adapter_key="test-api", ai_channel_id=str(channel), ai_model_id=str(model)
    )
    pid = UUID(row["summary"]["id"])
    with ThreadPoolExecutor(max_workers=1) as pool, api.factory() as first:
        first.execute(text("SELECT id FROM ai_channels WHERE id=:id FOR UPDATE"), {"id": channel})
        future, backend = start(
            pool,
            api,
            lambda db: commands.set_profile_active(
                db=db,
                profile_id=pid,
                expected_revision=0,
                is_active=False,
                actor=actor(db, api),
                request_id="geo205-binding-drift",
            ),
        )
        wait_blocked(api, backend)
        first.execute(text("DELETE FROM ai_models WHERE id=:id"), {"id": model})
        first.commit()
        loser = future.result(timeout=10)
    assert isinstance(loser, AppError) and loser.code == "REVISION_CONFLICT"
    with api.factory() as db:
        current = db.get(GeoCollectionProfile, pid)
        assert current.ai_model_id is None and current.ai_channel_id is None
        assert current.revision == 0 and not current.is_active


def test_model_disable_while_enable_waits_is_rechecked_in_shared_eligibility(
    surface_api: SurfaceAPI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = surface_api
    api_registry(monkeypatch)
    channel, model = model_binding(api)
    surface = api.surface(surface_kind="MODEL_API", compliance_status="APPROVED")
    sid = surface["summary"]["id"]
    api.admin.post(f"/api/v1/geo/engine-surfaces/{sid}/enable", json={"expected_revision": 0})
    row = api.profile(
        surface, "API", adapter_key="test-api", ai_channel_id=str(channel), ai_model_id=str(model)
    )
    pid = UUID(row["summary"]["id"])
    mark_profile_tested(api, str(pid))
    before = state(api, "geo_collection_profiles", str(pid))
    with ThreadPoolExecutor(max_workers=1) as pool, api.factory() as first:
        first.execute(text("SELECT id FROM ai_channels WHERE id=:id FOR UPDATE"), {"id": channel})
        future, backend = start(
            pool,
            api,
            lambda db: commands.set_profile_active(
                db=db,
                profile_id=pid,
                expected_revision=1,
                is_active=True,
                actor=actor(db, api),
                request_id="geo205-model-disabled",
            ),
        )
        wait_blocked(api, backend)
        first.execute(text("UPDATE ai_models SET is_enabled=false WHERE id=:id"), {"id": model})
        first.commit()
        denied = future.result(timeout=10)
    assert isinstance(denied, AppError) and denied.code == "GEO_PROFILE_INELIGIBLE"
    assert {item["code"] for item in denied.details["blockers"]} == {"MODEL_DISABLED"}
    assert state(api, "geo_collection_profiles", str(pid)) == before


def test_authentication_heartbeat_is_discarded_before_user_lock(surface_api: SurfaceAPI) -> None:
    api = surface_api
    row = api.surface()
    statements: list[str] = []

    def record(conn, cursor, statement, params, context, many):
        statements.append(statement)

    with api.factory() as db:
        current = db.scalar(select(SessionRecord).where(SessionRecord.user_id == api.admin_id))
        before = current.last_seen_at
        current.last_seen_at = current.expires_at
        event.listen(api.engine, "before_cursor_execute", record)
        try:
            commands.set_surface_active(
                db=db,
                surface_id=UUID(row["summary"]["id"]),
                expected_revision=0,
                is_active=True,
                actor=actor(db, api),
                request_id="geo205-heartbeat",
            )
        finally:
            event.remove(api.engine, "before_cursor_execute", record)
        assert current.last_seen_at == before
    assert any("FOR NO KEY UPDATE" in sql for sql in statements)
    assert not any(sql.startswith("UPDATE sessions") for sql in statements)


def test_user_no_key_update_remains_compatible_with_success_audit_fk(
    surface_api: SurfaceAPI,
) -> None:
    from app.services.ai_configuration import delete_ai_model

    api = surface_api
    _, model = model_binding(api)
    with ThreadPoolExecutor(max_workers=1) as pool, api.factory() as first:
        with command(first, actor(first, api)):
            future, _ = start(
                pool,
                api,
                lambda db: delete_ai_model(
                    db=db,
                    model_id=model,
                    expected_revision=0,
                    actor=actor(db, api),
                    request_id="geo205-compatible-audit-fk",
                ),
            )
            assert future.result(timeout=5) is None
        first.rollback()
