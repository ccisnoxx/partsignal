"""内容任务创建选项、资格与幂等边界的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Barrier, BrokenBarrierError, Lock
from types import SimpleNamespace
from typing import TypedDict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

import app.routers.planning as planning_routes
from app.db import get_db
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.models.configuration import PlatformProfile, PlatformType
from app.models.content import (
    ContentReviewRecord,
    ContentTask,
    ContentTaskGeoSource,
    ContentVersion,
)
from app.models.identity import AuditLog, User
from app.models.product_facts import FactVersion, Product
from app.routers.planning import _content_task_read_snapshot
from app.schemas.content import ContentTaskCreate
from app.security import hash_token
from app.services import content_planning as content_planning_service
from app.services.content_planning import create_content_task
from app.services.content_task_queries import get_content_task_creation_options
from tests.integration.test_publication_workflow import temporary_database


class CreationGraph(TypedDict):
    user: User
    product: Product
    fact: FactVersion
    platform: PlatformProfile


def _seed_creation_graph(
    db: Session,
    *,
    suffix: str,
    fact_status: str = "APPROVED",
    fact_body: str = "## 参数\n\n工作电压 3.3 V。",
) -> CreationGraph:
    user = User(
        username=f"content-create-{suffix}",
        display_name="内容创建测试用户",
        password_hash="not-used",
        account_type="ENGINEER",
    )
    product = Product(
        part_number=f"PS-{suffix}",
        normalized_part_number=f"ps-{suffix}",
        brand="PartSignal",
        normalized_brand=f"partsignal-{suffix}",
        category="MCU",
    )
    platform_type = PlatformType(
        name=f"技术社区-{suffix}", slug=f"community-{suffix}", created_by=user.id
    )
    db.add_all([user, product])
    db.flush()
    platform_type.created_by = user.id
    db.add(platform_type)
    db.flush()
    fact = FactVersion(
        product_id=product.id,
        version=1,
        status=fact_status,
        body_markdown=fact_body,
        classification="PUBLIC",
        change_summary="初始批准事实",
        created_by=user.id,
        approved_by=user.id,
    )
    platform = PlatformProfile(
        name=f"工程师社区-{suffix}",
        slug=f"engineer-{suffix}",
        allowed_domains=[f"{suffix}.example.invalid"],
        platform_type_id=platform_type.id,
    )
    db.add_all([fact, platform])
    db.commit()
    return {"user": user, "product": product, "fact": fact, "platform": platform}


def _statement_count(engine: Engine) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with Session(engine) as db:
            get_content_task_creation_options(db=db, requested_product_id=None)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


def _content_task_creation_snapshot(db: Session, key: str) -> tuple[object, ...]:
    task = db.scalar(select(ContentTask).where(ContentTask.idempotency_key == key))
    counts = [ContentTask, ContentVersion, FactVersion, ContentReviewRecord, AuditLog]
    return (*[int(db.scalar(select(func.count()).select_from(model)) or 0) for model in counts],
        None if task is None else (task.id, task.revision, task.current_content_version_id,
        task.status, db.get(ContentTaskGeoSource, task.id) is not None))


@pytest.mark.integration
def test_creation_options_are_filtered_sorted_and_constant_query_count() -> None:
    """读模型只暴露当前合格选项，不随产品数增加 SQL。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            _content_task_read_snapshot(db)
            assert db.scalar(text("SHOW transaction_isolation")) == "repeatable read"
            empty_options = get_content_task_creation_options(
                db=db, requested_product_id=None
            )
            assert empty_options.products == []
            assert empty_options.platforms == []

            first = _seed_creation_graph(db, suffix="b")
            initial_count = _statement_count(engine)
            _seed_creation_graph(db, suffix="a")
            inactive = _seed_creation_graph(db, suffix="inactive")
            empty = _seed_creation_graph(db, suffix="empty", fact_body="   ")
            inactive["product"].status = "RETIRED"
            inactive["platform"].is_active = False
            db.commit()

            options = get_content_task_creation_options(
                db=db, requested_product_id=first["product"].id
            )
            assert [item.part_number for item in options.products] == ["PS-a", "PS-b"]
            assert [item.version for item in options.products[0].approved_fact_versions] == [1]
            assert [item.name for item in options.platforms] == [
                "工程师社区-a",
                "工程师社区-b",
                "工程师社区-empty",
            ]
            assert options.requested_product is not None
            assert options.requested_product.eligibility == "ELIGIBLE"
            assert _statement_count(engine) == initial_count == 2

            inactive_requested = get_content_task_creation_options(
                db=db, requested_product_id=inactive["product"].id
            ).requested_product
            empty_requested = get_content_task_creation_options(
                db=db, requested_product_id=empty["product"].id
            ).requested_product
            missing_requested = get_content_task_creation_options(
                db=db, requested_product_id=uuid.uuid4()
            ).requested_product
            assert inactive_requested is not None
            assert empty_requested is not None
            assert missing_requested is not None
            assert inactive_requested.eligibility == "PRODUCT_INACTIVE"
            assert empty_requested.eligibility == "NO_APPROVED_FACTS"
            assert missing_requested.eligibility == "NOT_FOUND"

        engine.dispose()


@pytest.mark.integration
def test_create_content_task_revalidates_qualification_and_idempotency() -> None:
    """POST 在事务内重新校验三个关联，并冻结幂等语义。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_creation_graph(db, suffix="primary")
            other = _seed_creation_graph(db, suffix="other")
            retired_fact = _seed_creation_graph(
                db, suffix="retired-fact", fact_status="RETIRED"
            )
            blank_fact = _seed_creation_graph(db, suffix="blank-fact", fact_body="   ")
            retired_product = _seed_creation_graph(db, suffix="retired-product")
            retired_product["product"].status = "RETIRED"
            db.commit()
            actor = graph["user"]
            payload = ContentTaskCreate(
                product_id=graph["product"].id,
                fact_version_id=graph["fact"].id,
                platform_profile_id=graph["platform"].id,
            )
            options = get_content_task_creation_options(
                db=db, requested_product_id=graph["product"].id
            )
            assert graph["platform"].id in {item.id for item in options.platforms}
            key = f"content-create-{uuid.uuid4()}"
            first = create_content_task(
                db=db,
                payload=payload,
                actor=actor,
                request_id="test-request",
                idempotency_key=key,
            )
            replay = create_content_task(
                db=db,
                payload=payload,
                actor=actor,
                request_id="test-request",
                idempotency_key=key,
            )
            assert replay.id == first.id
            assert db.scalar(select(func.count()).select_from(ContentTask)) == 1

            with pytest.raises(AppError, match="幂等键") as conflict:
                create_content_task(
                    db=db,
                    payload=payload.model_copy(
                        update={"platform_profile_id": other["platform"].id}
                    ),
                    actor=actor,
                    request_id="test-request",
                    idempotency_key=key,
                )
            assert conflict.value.code == "IDEMPOTENCY_CONFLICT"

            cases = [
                (
                    payload.model_copy(update={"fact_version_id": other["fact"].id}),
                    "VALIDATION_ERROR",
                ),
                (
                    payload.model_copy(update={"platform_profile_id": uuid.uuid4()}),
                    "NOT_FOUND",
                ),
            ]
            for invalid_payload, expected_code in cases:
                with pytest.raises(AppError) as error:
                    create_content_task(
                        db=db,
                        payload=invalid_payload,
                        actor=actor,
                        request_id="test-request",
                        idempotency_key=f"content-create-{uuid.uuid4()}",
                    )
                assert error.value.code == expected_code

            graph["platform"].is_active = False
            db.commit()
            with pytest.raises(AppError) as platform_error:
                create_content_task(
                    db=db,
                    payload=payload,
                    actor=actor,
                    request_id="test-request",
                    idempotency_key=f"content-create-{uuid.uuid4()}",
                )
            assert platform_error.value.code == "PLATFORM_DISABLED"

            graph["platform"].is_active = True
            db.commit()
            with pytest.raises(AppError) as fact_error:
                create_content_task(
                    db=db,
                    payload=ContentTaskCreate(
                        product_id=retired_fact["product"].id,
                        fact_version_id=retired_fact["fact"].id,
                        platform_profile_id=graph["platform"].id,
                    ),
                    actor=actor,
                    request_id="test-request",
                    idempotency_key=f"content-create-{uuid.uuid4()}",
                )
            assert fact_error.value.code == "FACT_NOT_APPROVED"

            with pytest.raises(AppError) as blank_fact_error:
                create_content_task(
                    db=db,
                    payload=ContentTaskCreate(
                        product_id=blank_fact["product"].id,
                        fact_version_id=blank_fact["fact"].id,
                        platform_profile_id=graph["platform"].id,
                    ),
                    actor=actor,
                    request_id="test-request",
                    idempotency_key=f"content-create-{uuid.uuid4()}",
                )
            assert blank_fact_error.value.code == "FACT_NOT_APPROVED"

            with pytest.raises(AppError) as product_error:
                create_content_task(
                    db=db,
                    payload=ContentTaskCreate(
                        product_id=retired_product["product"].id,
                        fact_version_id=retired_product["fact"].id,
                        platform_profile_id=graph["platform"].id,
                    ),
                    actor=actor,
                    request_id="test-request",
                    idempotency_key=f"content-create-{uuid.uuid4()}",
                )
            assert product_error.value.code == "FACT_NOT_APPROVED"

        engine.dispose()


@pytest.mark.integration
@pytest.mark.parametrize("winner_kind", ["same", "different", "geo", "unknown"])
def test_exact_idempotency_constraint_race_recovers_only_verified_winner(
    monkeypatch: pytest.MonkeyPatch, winner_kind: str,
) -> None:
    """绕过 advisory lock 的真实旁路 writer 只能触发精确恢复分支。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            graph = _seed_creation_graph(db, suffix=f"race-{winner_kind}")
            other = _seed_creation_graph(db, suffix=f"race-other-{winner_kind}")
            actor_id = graph["user"].id
            payload = ContentTaskCreate(
                product_id=graph["product"].id,
                fact_version_id=graph["fact"].id,
                platform_profile_id=graph["platform"].id,
            )
            key = f"content-create-race-{uuid.uuid4()}"
            before = _content_task_creation_snapshot(db, key)
        def persist_bypass_winner() -> None:
            with session_factory() as competitor:
                winner_graph = other if winner_kind == "different" else graph
                winner = ContentTask(
                    product_id=winner_graph["product"].id,
                    fact_version_id=winner_graph["fact"].id,
                    platform_profile_id=winner_graph["platform"].id,
                    platform_profile_name_snapshot=winner_graph["platform"].name,
                    platform_website_url_snapshot=winner_graph["platform"].website_url,
                    idempotency_key=key,
                    created_by=actor_id,
                )
                competitor.add(winner)
                competitor.flush()
                if winner_kind == "geo":
                    competitor.add(ContentTaskGeoSource(content_task_id=winner.id,
                        rule_code="CONTENT_DECLINE", date_from=date(2026, 1, 1),
                        date_to=date(2026, 1, 31), basis_snapshot={"reason": "race"},
                        created_by=actor_id))
                competitor.commit()
        injected = False
        def inject_after_content_task_lookup(*statement_args: object) -> None:
            nonlocal injected
            statement = str(statement_args[2]).lower()
            if (
                injected
                or
                "select" not in statement
                or "from content_tasks" not in statement
                or "idempotency_key" not in statement
            ):
                return
            injected = True
            persist_bypass_winner()
        if winner_kind == "unknown":
            monkeypatch.setattr(content_planning_service,
                "_is_content_task_idempotency_integrity_error", lambda _error: False)
        event.listen(engine, "after_cursor_execute", inject_after_content_task_lookup)
        try:
            with session_factory() as db:
                actor = db.get(User, actor_id)
                if winner_kind == "same":
                    create_content_task(db=db, payload=payload, actor=actor,
                        request_id="race-same", idempotency_key=key)
                elif winner_kind == "unknown":
                    with pytest.raises(IntegrityError) as unknown:
                        create_content_task(db=db, payload=payload, actor=actor,
                            request_id="race-unknown", idempotency_key=key)
                    assert unknown.value.orig.sqlstate == "23505"
                    assert unknown.value.orig.diag.constraint_name == (
                        "uq_content_tasks_idempotency_key"
                    )
                    db.rollback()
                else:
                    with pytest.raises(AppError) as conflict:
                        create_content_task(
                            db=db, payload=payload, actor=actor,
                            request_id=f"race-{winner_kind}", idempotency_key=key,
                        )
                    assert conflict.value.code == "IDEMPOTENCY_CONFLICT"
                after = _content_task_creation_snapshot(db, key)
                assert after[:5] == (before[0] + 1, *before[1:5])
                assert after[5] is not None and after[5][-1] == (winner_kind == "geo")
                assert db.scalar(text(
                    "SELECT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = "
                    "'uq_content_tasks_idempotency_key' AND c.conrelid = "
                    "(current_schema() || '.content_tasks')::regclass AND c.contype = 'u' "
                    "AND pg_get_constraintdef(c.oid) = "
                    "'UNIQUE (idempotency_key)')"
                )) is True
        finally:
            event.remove(engine, "after_cursor_execute", inject_after_content_task_lookup)

class _ScalarSequenceSession:
    """为异常恢复矩阵提供最小的 Session 行为替身。"""

    def __init__(self, scalar_values: list[object]) -> None:
        self.scalar_values, self.rollback_count, self.scalar_call_count = scalar_values, 0, 0
    def scalar(self, *_args: object, **_kwargs: object) -> object:
        self.scalar_call_count += 1
        return self.scalar_values.pop(0)
    def rollback(self) -> None:
        self.rollback_count += 1
    def __getattr__(self, _name: str):
        return lambda *_args, **_kwargs: None
def _content_task_integrity_error(sqlstate: str, constraint_name: str | None) -> IntegrityError:
    original = SimpleNamespace(
        sqlstate=sqlstate,
        diag=SimpleNamespace(constraint_name=constraint_name),
        message_primary="sensitive database detail",
    )
    return IntegrityError("INSERT INTO content_tasks ...", {}, original)
@pytest.mark.parametrize(
    ("case", "sqlstate", "constraint_name"),
    [
        ("missing-diagnostics", "23505", None),
        ("other-constraint", "23505", "uq_content_tasks_other"),
        ("other-sqlstate", "23514", "uq_content_tasks_idempotency_key"),
        ("winner-missing", "23505", "uq_content_tasks_idempotency_key"),
        ("winner-incomplete", "23505", "uq_content_tasks_idempotency_key"),
    ],
)
def test_content_task_integrity_unknown_and_unverifiable_are_rethrown(
    monkeypatch: pytest.MonkeyPatch, case: str, sqlstate: str, constraint_name: str | None,
) -> None:
    """未知 diagnostics 或不可验证 winner 都保留原异常和 Session 边界。"""
    original = _content_task_integrity_error(sqlstate, constraint_name)
    winner = (
        SimpleNamespace(
            id=uuid.uuid4(),
            product_id=None,
            fact_version_id=uuid.uuid4(),
            platform_profile_id=uuid.uuid4(),
        )
        if case == "winner-incomplete"
        else None
    )
    is_exact = case.startswith("winner-")
    db = _ScalarSequenceSession([None, winner] if is_exact else [None])
    payload = ContentTaskCreate(product_id=uuid.uuid4(), fact_version_id=uuid.uuid4(),
        platform_profile_id=uuid.uuid4())
    monkeypatch.setattr(content_planning_service, "lock_content_task_creation_resources",
        lambda _db, _payload: SimpleNamespace(id=payload.platform_profile_id))
    monkeypatch.setattr(content_planning_service, "add_locked_content_task",
        lambda **_kwargs: (_ for _ in ()).throw(original))
    with pytest.raises(IntegrityError) as raised:
        content_planning_service.create_content_task(db=db, payload=payload,
            actor=SimpleNamespace(id=uuid.uuid4()), request_id="unverifiable-winner",
            idempotency_key=f"content-create-{uuid.uuid4()}")
    assert raised.value is original
    assert db.rollback_count == int(is_exact)
    assert db.scalar_call_count == (2 if is_exact else 1)
@pytest.mark.integration
def test_content_task_http_known_conflict_and_unknown_no_leak(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """真实 HTTP 冲突保持 ErrorEnvelope、409 和 request ID 合同。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            graph = _seed_creation_graph(db, suffix="http-conflict")
            winner_payload = ContentTaskCreate(product_id=graph["product"].id,
                fact_version_id=graph["fact"].id, platform_profile_id=graph["platform"].id)
            key = f"content-create-http-{uuid.uuid4()}"
            create_content_task(db=db, payload=winner_payload, actor=graph["user"],
                request_id="http-winner", idempotency_key=key)
            csrf_token = "content-task-http-csrf-token-with-more-than-32-characters"
            current_session = SimpleNamespace(user=graph["user"], csrf_hash=hash_token(csrf_token))

        def override_db() -> object:
            with session_factory() as db:
                yield db
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: current_session
        try:
            response = TestClient(app).post("/api/v1/content-tasks", headers={
                "Idempotency-Key": key, "X-CSRF-Token": csrf_token,
                "X-Request-ID": "content-task-http-conflict"}, json={
                "product_id": str(winner_payload.product_id),
                "fact_version_id": str(winner_payload.fact_version_id),
                "platform_profile_id": str(uuid.uuid4())})
            assert response.status_code == 409, response.text
            assert response.headers["X-Request-ID"] == "content-task-http-conflict"
            assert response.json()["error"] == {"code": "IDEMPOTENCY_CONFLICT",
                "message": "幂等键已用于另一内容任务创建请求", "details": {},
                "request_id": "content-task-http-conflict"}
            unknown = _content_task_integrity_error("23514", "content_tasks_bad_check")
            monkeypatch.setattr(planning_routes, "create_content_task_command",
                lambda **_kwargs: (_ for _ in ()).throw(unknown))
            leaked = TestClient(app, raise_server_exceptions=False).post(
                "/api/v1/content-tasks", headers={"Idempotency-Key": key,
                "X-CSRF-Token": csrf_token, "X-Request-ID": "content-task-http-unknown"},
                json={"product_id": str(winner_payload.product_id),
                "fact_version_id": str(winner_payload.fact_version_id),
                "platform_profile_id": str(uuid.uuid4())})
            assert leaked.status_code == 500
            for secret in ("INSERT INTO", "content_tasks", "content_tasks_bad_check",
                "sensitive database detail", "Traceback"):
                assert secret not in leaked.text
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_current_session, None)
            engine.dispose()
@pytest.mark.integration
def test_concurrent_idempotent_submissions_create_one_task() -> None:
    """并发的同键同载荷必须返回同一任务。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            graph = _seed_creation_graph(db, suffix="concurrent")
            product_id = graph["product"].id
            fact_id = graph["fact"].id
            platform_id = graph["platform"].id
            actor_id = graph["user"].id
        key = f"content-create-{uuid.uuid4()}"
        barrier = Barrier(2, timeout=10)
        insert_count = 0
        insert_count_lock = Lock()

        def count_content_task_insert(*statement_args: object) -> None:
            nonlocal insert_count
            statement = str(statement_args[2]).lower()
            if "insert into content_tasks" in statement:
                with insert_count_lock:
                    insert_count += 1

        event.listen(engine, "before_cursor_execute", count_content_task_insert)
        def submit() -> uuid.UUID:
            try:
                with session_factory() as db:
                    actor = db.get(User, actor_id)
                    barrier.wait()
                    task = create_content_task(
                        db=db,
                        payload=ContentTaskCreate(
                            product_id=product_id,
                            fact_version_id=fact_id,
                            platform_profile_id=platform_id,
                        ),
                        actor=actor,
                        request_id="concurrent-test",
                        idempotency_key=key,
                    )
                    return task.id
            except (BrokenBarrierError, TimeoutError):
                barrier.abort()
                raise
        try:
            with ThreadPoolExecutor(max_workers=2) as executor:
                futures = [executor.submit(submit) for _ in range(2)]
                task_ids = [future.result(timeout=20) for future in futures]
            assert task_ids[0] == task_ids[1]
            assert insert_count == 1
        except BaseException:
            barrier.abort()
            raise
        finally:
            event.remove(engine, "before_cursor_execute", count_content_task_insert)
            engine.dispose()
