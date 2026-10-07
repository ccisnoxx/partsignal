"""GEO-104 多 Session 锁交错；等待以 PostgreSQL 阻塞事实而非猜测时长为准。"""

from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from queue import Queue
from time import monotonic, sleep
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.geo_catalog import GeoSubject
from app.schemas.geo_catalog import (
    GeoNamedSubjectCreate,
    GeoNamedSubjectUpdate,
    GeoOwnProductSubjectCreate,
    GeoSubjectAliasCreate,
)
from app.services import geo_catalog as commands
from app.services.geo_catalog_locks import lock_brands, lock_product, lock_subject
from app.services.geo_catalog_policy import SubjectReferenceCounts
from tests.integration.geo_catalog_support import PREFIX, CatalogAPI, actor, catalog_state
from tests.integration.geo_catalog_support import catalog_api as catalog_api
from tests.integration.geo_catalog_support import catalog_engine as catalog_engine

pytestmark = pytest.mark.integration


def start(
    pool: ThreadPoolExecutor, api: CatalogAPI, operation: Callable[[Session], object]
) -> tuple[Future, int]:
    ready: Queue[int] = Queue()

    def execute() -> object:
        with api.factory() as db:
            db.execute(text("SET LOCAL statement_timeout = '8s'"))
            ready.put(db.execute(text("SELECT pg_backend_pid()")).scalar_one())
            try:
                return operation(db)
            except AppError as error:
                return error

    future = pool.submit(execute)
    return future, ready.get(timeout=5)


def wait_blocked(api: CatalogAPI, pid: int) -> None:
    deadline = monotonic() + 5
    with api.engine.connect() as connection:
        while monotonic() < deadline:
            if connection.execute(
                text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": pid}
            ).scalar_one():
                return
            sleep(0.01)
    pytest.fail("等待者未进入预期 PostgreSQL 行锁阻塞")


def test_concurrent_own_product_create_has_one_winner(catalog_api: CatalogAPI) -> None:
    api = catalog_api
    payload = GeoOwnProductSubjectCreate(subject_type="OWN_PRODUCT", product_id=api.product_id)
    with ThreadPoolExecutor(max_workers=1) as pool, api.factory() as first:
        lock_product(first, api.product_id)
        future, pid = start(
            pool,
            api,
            lambda db: commands.create_subject(
                db=db, payload=payload, actor=actor(db, api), request_id="geo104-waiter"
            ),
        )
        wait_blocked(api, pid)
        winner = commands.create_subject(
            db=first, payload=payload, actor=actor(first, api), request_id="geo104-winner"
        )
        loser = future.result(timeout=10)
    assert isinstance(loser, AppError) and loser.code == "GEO_SUBJECT_PRODUCT_EXISTS"
    with api.factory() as db:
        assert list(
            db.scalars(select(GeoSubject.id).where(GeoSubject.product_id == api.product_id))
        ) == [winner.id]


def test_concurrent_child_commands_compare_revision_after_lock(catalog_api: CatalogAPI) -> None:
    api = catalog_api
    row = api.create()
    sid = UUID(row["id"])
    payload = GeoSubjectAliasCreate(expected_revision=0, alias="并发别名", alias_kind="NAME")
    with ThreadPoolExecutor(max_workers=1) as pool, api.factory() as first:
        lock_subject(first, sid, 0)
        future, pid = start(
            pool,
            api,
            lambda db: commands.create_alias(
                db=db,
                subject_id=sid,
                payload=payload,
                actor=actor(db, api),
                request_id="geo104-loser",
            ),
        )
        wait_blocked(api, pid)
        winner = commands.create_alias(
            db=first,
            subject_id=sid,
            payload=payload,
            actor=actor(first, api),
            request_id="geo104-win",
        )
        loser = future.result(timeout=10)
    assert winner.revision == 1
    assert isinstance(loser, AppError) and loser.code == "REVISION_CONFLICT"
    after = api.admin.get(f"{PREFIX}/{sid}").json()
    assert after["revision"] == 1 and len(after["aliases"]) == 1


@pytest.mark.parametrize("child_wins", [True, False])
def test_brand_delete_and_child_create_share_parent_lock(
    catalog_api: CatalogAPI, child_wins: bool
) -> None:
    api = catalog_api
    brand = api.create(subject_type="COMPETITOR_BRAND")
    bid = UUID(brand["id"])
    payload = GeoNamedSubjectCreate(
        subject_type="COMPETITOR_PRODUCT",
        canonical_name="并发竞品",
        display_name="并发竞品",
        parent_subject_id=bid,
    )

    def create(db: Session):
        return commands.create_subject(
            db=db, payload=payload, actor=actor(db, api), request_id="geo104-child"
        )

    def delete(db: Session):
        return commands.delete_subject(
            db=db,
            subject_id=bid,
            expected_revision=0,
            actor=actor(db, api),
            request_id="geo104-parent-delete",
        )

    with ThreadPoolExecutor(max_workers=1) as pool, api.factory() as first:
        lock_brands(first, {bid})
        future, pid = start(pool, api, delete if child_wins else create)
        wait_blocked(api, pid)
        (create if child_wins else delete)(first)
        result = future.result(timeout=10)
    assert isinstance(result, AppError)
    assert result.code == ("GEO_SUBJECT_IN_USE" if child_wins else "NOT_FOUND")
    listing = api.admin.get(PREFIX).json()
    assert listing["total"] == (2 if child_wins else 0)


def test_parent_drift_while_waiting_is_rejected_even_if_revision_matches(
    catalog_api: CatalogAPI,
) -> None:
    api = catalog_api
    old = api.create(subject_type="COMPETITOR_BRAND")
    new = api.create(subject_type="COMPETITOR_BRAND")
    child = api.create(parent_subject_id=old["id"])
    sid = UUID(child["id"])
    with ThreadPoolExecutor(max_workers=1) as pool, api.factory() as first:
        lock_brands(first, {UUID(old["id"])})
        future, pid = start(
            pool,
            api,
            lambda db: commands.set_subject_active(
                db=db,
                subject_id=sid,
                expected_revision=1,
                is_active=False,
                actor=actor(db, api),
                request_id="geo104-stale-lock-set",
            ),
        )
        wait_blocked(api, pid)
        commands.update_subject(
            db=first,
            subject_id=sid,
            actor=actor(first, api),
            request_id="geo104-reparent",
            payload=GeoNamedSubjectUpdate(
                subject_type="COMPETITOR_PRODUCT",
                expected_revision=0,
                parent_subject_id=UUID(new["id"]),
            ),
        )
        result = future.result(timeout=10)
    assert isinstance(result, AppError) and result.code == "REVISION_CONFLICT"
    current = api.admin.get(f"{PREFIX}/{sid}").json()
    assert current["is_active"] and current["parent_subject_id"] == new["id"]


def test_partial_unique_constraint_is_final_guard_with_exact_field_mapping(
    catalog_api: CatalogAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = catalog_api
    payload = GeoOwnProductSubjectCreate(subject_type="OWN_PRODUCT", product_id=api.product_id)
    with api.factory() as db:
        disabled = commands.create_subject(
            db=db, actor=actor(db, api), payload=payload, request_id="geo104-disabled-identity"
        )
        commands.set_subject_active(
            db=db,
            subject_id=disabled.id,
            expected_revision=0,
            is_active=False,
            actor=actor(db, api),
            request_id="geo104-disable-identity",
        )
        first = commands.create_subject(
            db=db, actor=actor(db, api), payload=payload, request_id="geo104-first-identity"
        )
    before = catalog_state(api, str(first.id))
    # 仅测试绕过友好预检查，证明真实 SQLSTATE/partial index 是最终裁决。
    monkeypatch.setattr(commands, "_require_product_available", lambda *args: None)
    with api.factory() as db, pytest.raises(AppError) as caught:
        commands.create_subject(
            db=db, actor=actor(db, api), payload=payload, request_id="geo104-duplicate-identity"
        )
    assert caught.value.code == "GEO_SUBJECT_PRODUCT_EXISTS"
    assert caught.value.details["errors"][0]["loc"] == ["body", "product_id"]
    assert catalog_state(api, str(first.id)) == before
    before_disabled = catalog_state(api, str(disabled.id))
    with api.factory() as db, pytest.raises(AppError) as enable_conflict:
        commands.set_subject_active(
            db=db,
            subject_id=disabled.id,
            expected_revision=1,
            is_active=True,
            actor=actor(db, api),
            request_id="geo104-enable-final-guard",
        )
    assert enable_conflict.value.code == "GEO_SUBJECT_PRODUCT_EXISTS"
    assert enable_conflict.value.details["subject_id"] == str(disabled.id)
    assert enable_conflict.value.details["product_id"] == str(api.product_id)
    assert catalog_state(api, str(disabled.id)) == before_disabled
    assert api.admin.get(PREFIX).json()["total"] == 2


def test_delete_fk_guard_is_precise_and_does_not_requery_failed_transaction(
    catalog_api: CatalogAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = catalog_api
    brand = api.create(subject_type="COMPETITOR_BRAND")
    api.create(parent_subject_id=brand["id"])
    before = catalog_state(api, brand["id"])
    # 模拟预检查之后出现引用；0044 的 RESTRICT FK 必须保留业务与审计。
    monkeypatch.setattr(
        commands,
        "subject_references",
        lambda db, ids: {key: SubjectReferenceCounts(0, 0, 0, 0, 0) for key in ids},
    )
    with api.factory() as db, pytest.raises(AppError) as caught:
        commands.delete_subject(
            db=db,
            subject_id=UUID(brand["id"]),
            expected_revision=0,
            actor=actor(db, api),
            request_id="geo104-fk-guard",
        )
    assert caught.value.code == "GEO_SUBJECT_IN_USE" and caught.value.details == {}
    assert catalog_state(api, brand["id"]) == before
