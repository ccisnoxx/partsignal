"""GEO-1004：旧 actor 与真实 PostgreSQL 权限写事务之间的竞态。"""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from time import monotonic, sleep
from uuid import UUID

import pytest
from sqlalchemy import delete, select, text, update
from sqlalchemy.orm import Session
from starlette.requests import Request

from app.deps import get_current_session
from app.errors import AppError
from app.models.identity import SessionRecord, User
from app.schemas.common import ChangePasswordRequest, ResetPasswordRequest, UserUpdate
from app.schemas.geo_catalog import GeoNamedSubjectUpdate, GeoSubjectAliasCreate
from app.security import hash_password
from app.services import geo_catalog as commands
from app.services.geo_catalog_locks import lock_subject
from app.services.identity import (
    change_password,
    delete_user,
    logout,
    reset_user_password,
    update_user,
)
from tests.integration.geo_catalog_support import PREFIX, CatalogAPI, actor, catalog_state
from tests.integration.geo_catalog_support import catalog_api as catalog_api
from tests.integration.geo_catalog_support import catalog_engine as catalog_engine
from tests.integration.test_geo_catalog_concurrency import start, wait_blocked

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ("demote", "PERMISSION_DENIED"),
        ("disable", "AUTH_REQUIRED"),
        ("reset", "PASSWORD_CHANGE_REQUIRED"),
    ],
)
def test_identity_change_committed_before_catalog_write_is_rejected(
    catalog_api: CatalogAPI,
    change: str,
    code: str,
) -> None:
    api = catalog_api
    row = api.create()
    sid = UUID(row["id"])
    before = catalog_state(api, row["id"])
    with api.factory() as db:
        other = db.get(User, api.engineer_id)
        assert other is not None
        other.account_type = "ADMIN"
        db.commit()
    with ThreadPoolExecutor(max_workers=1) as pool, api.factory() as first:
        target = first.scalar(select(User).where(User.id == api.admin_id).with_for_update())
        assert target is not None
        lock_subject(first, sid, 0)
        future, pid = start(
            pool,
            api,
            lambda db: commands.create_alias(
                db=db,
                subject_id=sid,
                payload=GeoSubjectAliasCreate(
                    expected_revision=0, alias="不得提交的别名", alias_kind="NAME"
                ),
                actor=actor(db, api),
                request_id="geo1004-demoted",
            ),
        )
        # 修复前 A 等待 Subject；修复后同一交错必须先等待 User。
        wait_blocked(api, pid)
        other = first.get(User, api.engineer_id)
        assert other is not None
        if change == "reset":
            reset_user_password(
                db=first,
                user_id=target.id,
                actor=other,
                request_id="geo1004-reset",
                payload=ResetPasswordRequest(
                    expected_revision=0,
                    temporary_password="geo1004-test-password",
                ),
            )
        else:
            update_user(
                db=first,
                user_id=target.id,
                payload=UserUpdate(
                    expected_revision=0,
                    display_name=target.display_name,
                    account_type="ENGINEER" if change == "demote" else "ADMIN",
                    is_active=change != "disable",
                ),
                actor=other,
                request_id="geo1004-change",
            )
        result = future.result(timeout=10)
    assert isinstance(result, AppError) and result.code == code
    assert catalog_state(api, row["id"]) == before


def snapshot(api: CatalogAPI) -> list:
    with api.factory() as db:
        return [
            db.execute(text(f"SELECT to_jsonb(t) FROM {table} t ORDER BY id")).all()
            for table in ("geo_subjects", "geo_subject_aliases", "geo_subject_domains")
        ] + [
            db.execute(
                text(
                    "SELECT to_jsonb(t) FROM audit_logs t "
                    "WHERE action LIKE 'geo_subject%' ORDER BY id"
                )
            ).all()
        ]


def authenticated(db: Session, api: CatalogAPI) -> SessionRecord:
    return get_current_session(
        db,
        Request({"type": "http", "method": "PATCH", "path": PREFIX}),
        f"geo104-session-{api.admin_id}",
    )


@pytest.mark.parametrize(
    "state,code,status",
    [
        ({"is_active": False}, "AUTH_REQUIRED", 401),
        ({"account_type": "ENGINEER"}, "PERMISSION_DENIED", 403),
        ({"must_change_password": True}, "PASSWORD_CHANGE_REQUIRED", 403),
    ],
)
@pytest.mark.parametrize(
    "operation",
    [
        "create_subject",
        "update_subject",
        "enable",
        "disable",
        "delete_subject",
        "create_alias",
        "update_alias",
        "delete_alias",
        "create_domain",
        "delete_domain",
    ],
)
def test_every_router_write_rechecks_current_actor_atomically(
    catalog_api: CatalogAPI,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
    state: dict,
    code: str,
    status: int,
) -> None:
    api = catalog_api
    row = api.create()
    path = f"{PREFIX}/{row['id']}"
    row = api.admin.post(
        f"{path}/aliases",
        json={
            "expected_revision": 0,
            "alias": "原别名",
            "alias_kind": "NAME",
        },
    ).json()
    row = api.admin.post(
        f"{path}/domains",
        json={
            "expected_revision": 1,
            "hostname": "example.test",
            "relation_type": "OFFICIAL",
        },
    ).json()
    if operation == "enable":
        row = api.admin.post(f"{path}/disable", json={"expected_revision": 2}).json()
    rev = row["revision"]
    aid, did = row["aliases"][0]["id"], row["domains"][0]["id"]
    requests = {
        "create_subject": (
            "POST",
            PREFIX,
            {
                "subject_type": "COMPETITOR_BRAND",
                "canonical_name": "不得新增",
                "display_name": "不得新增",
            },
        ),
        "update_subject": (
            "PATCH",
            path,
            {
                "subject_type": "COMPETITOR_PRODUCT",
                "expected_revision": rev,
                "description": "不得更新",
            },
        ),
        "enable": ("POST", f"{path}/enable", {"expected_revision": rev}),
        "disable": ("POST", f"{path}/disable", {"expected_revision": rev}),
        "delete_subject": ("DELETE", f"{path}?expected_revision={rev}", None),
        "create_alias": (
            "POST",
            f"{path}/aliases",
            {"expected_revision": rev, "alias": "不得新增", "alias_kind": "NAME"},
        ),
        "update_alias": (
            "PATCH",
            f"{path}/aliases/{aid}",
            {"expected_revision": rev, "alias": "不得更新"},
        ),
        "delete_alias": ("DELETE", f"{path}/aliases/{aid}?expected_revision={rev}", None),
        "create_domain": (
            "POST",
            f"{path}/domains",
            {"expected_revision": rev, "hostname": "rejected.test", "relation_type": "OTHER"},
        ),
        "delete_domain": ("DELETE", f"{path}/domains/{did}?expected_revision={rev}", None),
    }
    name = "set_subject_active" if operation in {"enable", "disable"} else operation
    original = getattr(commands, name)
    before = snapshot(api)

    def changed_before_command(**kwargs):
        # Router 的 ADMIN/CSRF 校验已完成；B 在权威命令前提交新用户状态。
        with api.factory() as db:
            db.execute(
                update(User)
                .where(User.id == api.admin_id)
                .values(
                    **state,
                    revision=User.revision + 1,
                )
            )
            db.commit()
        try:
            return original(**kwargs)
        finally:
            # 命令负责 rollback，原请求 Session 可立即继续查询。
            assert kwargs["db"].scalar(select(User.id).where(User.id == api.admin_id))

    monkeypatch.setattr(commands, name, changed_before_command)
    method, url, payload = requests[operation]
    response = api.admin.request(method, url, json=payload)
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    assert snapshot(api) == before


@pytest.mark.parametrize("change", ["revoked", "expired", "deleted", "wrong_user"])
def test_authenticated_session_drift_is_rejected(
    catalog_api: CatalogAPI,
    change: str,
) -> None:
    api = catalog_api
    row = api.create()
    before = snapshot(api)
    with api.factory() as db:
        current = authenticated(db, api)
        with api.factory() as other:
            if change == "deleted":
                other.execute(delete(SessionRecord).where(SessionRecord.id == current.id))
            else:
                values = {
                    "revoked": {"revoked_at": datetime.now(UTC)},
                    "expired": {"expires_at": datetime.now(UTC) - timedelta(seconds=1)},
                    "wrong_user": {"user_id": api.engineer_id},
                }[change]
                other.execute(
                    update(SessionRecord).where(SessionRecord.id == current.id).values(**values)
                )
            other.commit()
        with pytest.raises(AppError) as caught:
            commands.update_subject(
                db=db,
                actor=current.user,
                subject_id=UUID(row["id"]),
                payload=GeoNamedSubjectUpdate(
                    subject_type="COMPETITOR_PRODUCT", expected_revision=0, description="不得提交"
                ),
                request_id="geo1004-invalid-session",
            )
        assert caught.value.code == "AUTH_REQUIRED"
        assert db.scalar(select(User.id).where(User.id == api.admin_id)) == api.admin_id
    assert snapshot(api) == before


def test_harmless_user_revision_drift_keeps_qualified_session(
    catalog_api: CatalogAPI,
) -> None:
    api = catalog_api
    row = api.create()
    with api.factory() as db:
        current = authenticated(db, api)
        with api.factory() as other:
            other.execute(
                update(User)
                .where(User.id == api.admin_id)
                .values(
                    display_name="新的显示名",
                    revision=User.revision + 1,
                )
            )
            other.commit()
        result = commands.update_subject(
            db=db,
            actor=current.user,
            subject_id=UUID(row["id"]),
            payload=GeoNamedSubjectUpdate(
                subject_type="COMPETITOR_PRODUCT", expected_revision=0, description="允许提交"
            ),
            request_id="geo1004-valid-revision",
        )
        assert result.revision == 1 and current.user.revision == 1


def test_deleted_actor_cannot_use_stale_loaded_user(catalog_api: CatalogAPI) -> None:
    api = catalog_api
    row = api.create()
    before = snapshot(api)
    with api.factory() as db:
        stale = db.get(User, api.engineer_id)
        assert stale is not None
        with api.factory() as other:
            other.execute(update(User).where(User.id == stale.id).values(is_active=False))
            other.commit()
            delete_user(
                db=other,
                user_id=stale.id,
                expected_revision=0,
                actor=actor(other, api),
                request_id="geo1004-delete-user",
            )
        with pytest.raises(AppError, match="账号已停用或不存在") as caught:
            commands.delete_subject(
                db=db,
                actor=stale,
                subject_id=UUID(row["id"]),
                expected_revision=0,
                request_id="geo1004-deleted",
            )
        assert caught.value.code == "AUTH_REQUIRED"
        assert db.get(User, api.admin_id) is not None
    assert snapshot(api) == before


def test_current_session_does_not_bypass_catalog_revision(catalog_api: CatalogAPI) -> None:
    api = catalog_api
    row = api.create()
    api.admin.post(
        f"{PREFIX}/{row['id']}/aliases",
        json={
            "expected_revision": 0,
            "alias": "已经提交",
            "alias_kind": "NAME",
        },
    ).raise_for_status()
    before = snapshot(api)
    with api.factory() as db:
        current = authenticated(db, api)
        with pytest.raises(AppError) as caught:
            commands.delete_subject(
                db=db,
                actor=current.user,
                subject_id=UUID(row["id"]),
                expected_revision=0,
                request_id="geo1004-stale-resource",
            )
        assert caught.value.code == "REVISION_CONFLICT"
    assert snapshot(api) == before


@pytest.mark.parametrize("operation", ["password", "logout"])
def test_catalog_resource_wait_serializes_identity_without_heartbeat_lock_cycle(
    catalog_api: CatalogAPI,
    operation: str,
) -> None:
    api = catalog_api
    row = api.create()
    sid = UUID(row["id"])
    with api.factory() as db:
        db.execute(
            update(User)
            .where(User.id == api.admin_id)
            .values(password_hash=hash_password("geo1004-old-password"))
        )
        db.commit()

    def write(db: Session):
        current = authenticated(db, api)
        return commands.create_alias(
            db=db,
            actor=current.user,
            subject_id=sid,
            payload=GeoSubjectAliasCreate(expected_revision=0, alias="先提交", alias_kind="NAME"),
            request_id="geo1004-first",
        )

    def identity(db: Session):
        current = authenticated(db, api)
        if operation == "logout":
            return logout(db, current)
        return change_password(
            db=db,
            current=current,
            request_id="geo1004-password",
            payload=ChangePasswordRequest(
                old_password="geo1004-old-password", new_password="geo1004-new-password"
            ),
        )

    with ThreadPoolExecutor(max_workers=2) as pool, api.factory() as resource:
        lock_subject(resource, sid, 0)
        writer, pid = start(pool, api, write)
        wait_blocked(api, pid)
        changer, identity_pid = start(pool, api, identity)
        wait_blocked(api, identity_pid)
        with api.engine.connect() as observer:
            query = observer.execute(
                text("SELECT query FROM pg_stat_activity WHERE pid=:pid"), {"pid": identity_pid}
            ).scalar_one()
        # 改密必须直接等待 User；logout 只撤销 Session，不获取 User。
        assert ("FROM users" if operation == "password" else "UPDATE sessions") in query
        resource.commit()
        result = writer.result(timeout=10)
        assert not isinstance(result, AppError) and result.revision == 1
        assert changer.result(timeout=10) is None
    with api.factory() as db:
        current = db.scalar(select(SessionRecord).where(SessionRecord.user_id == api.admin_id))
        assert current is not None
        assert (current.revoked_at is not None) == (operation == "logout")
    assert catalog_state(api, row["id"])[0]["revision"] == 1


def test_session_expiry_during_resource_wait_rolls_back_all_catalog_changes(
    catalog_api: CatalogAPI,
) -> None:
    api = catalog_api
    row = api.create()
    before = snapshot(api)
    expires = datetime.now(UTC) + timedelta(seconds=2)
    with api.factory() as db:
        db.execute(
            update(SessionRecord)
            .where(SessionRecord.user_id == api.admin_id)
            .values(expires_at=expires)
        )
        db.commit()

    def write(db: Session):
        current = authenticated(db, api)
        try:
            return commands.create_alias(
                db=db,
                actor=current.user,
                subject_id=UUID(row["id"]),
                payload=GeoSubjectAliasCreate(
                    expected_revision=0, alias="必须回滚", alias_kind="NAME"
                ),
                request_id="geo1004-expired-in-command",
            )
        finally:
            assert db.scalar(select(User.id).where(User.id == api.admin_id)) == api.admin_id

    with ThreadPoolExecutor(max_workers=1) as pool, api.factory() as resource:
        lock_subject(resource, UUID(row["id"]), 0)
        writer, pid = start(pool, api, write)
        wait_blocked(api, pid)
        deadline = monotonic() + 4
        with api.engine.connect() as observer:
            while not observer.execute(
                text("SELECT clock_timestamp() >= :expires"), {"expires": expires}
            ).scalar_one():
                assert monotonic() < deadline, "数据库会话到期等待超限"
                sleep(0.01)
        resource.commit()
        result = writer.result(timeout=10)
    assert isinstance(result, AppError) and result.code == "AUTH_REQUIRED"
    assert snapshot(api) == before
