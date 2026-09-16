"""GEO Insights 历史身份与动作投影的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, date, datetime
from threading import Event
from time import monotonic
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import db as db_module
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.models.configuration import PlatformProfile, QueryTopic
from app.models.content import (
    ContentReviewRecord,
    ContentTask,
    ContentTaskGeoSource,
    ContentVersion,
)
from app.models.geo_files import GeoObservation, GeoObservationPublication
from app.models.identity import AuditLog, User
from app.models.product_facts import FactVersion, Product
from app.routers.observation import _geo_observation_read_snapshot
from app.schemas.content import ContentTaskCreate
from app.schemas.geo_files import GeoOptimizationContentTaskCreate
from app.security import hash_token
from app.services import content_planning as planning_service
from app.services import geo_observation as geo_service
from app.services.geo_observation import (
    GeoInsightFilters,
    create_geo_optimization_content_task,
    get_geo_insights,
)
from tests.integration.test_publication_workflow import (
    _complete_publication,
    _seed_graph,
    temporary_database,
)


@contextmanager
def _temporary_engine() -> Iterator[Engine]:
    """在临时数据库删除前关闭连接池中的全部 PostgreSQL 连接。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        try:
            yield engine
        finally:
            engine.dispose()


def _add_decline_observations(
    db: Session,
    graph: dict[str, object],
    *,
    published_article_id: uuid.UUID,
) -> None:
    """写入三个上一周期命中和三个当前周期未命中观测。"""
    actor = graph["user"]
    product = graph["product"]
    topic = graph["topic"]
    assert isinstance(actor, User)
    for index in range(3):
        for tested_at, mentioned in (
            (datetime(2026, 6, 10 + index, tzinfo=UTC), True),
            (datetime(2026, 7, 10 + index, tzinfo=UTC), False),
        ):
            observation = GeoObservation(
                observation_kind="MANUAL_ARTICLE_SEARCH",
                query_topic_id=topic.id,
                product_id=product.id,
                search_platform="Perplexity",
                search_query="GEO 洞察集成测试",
                tested_at=tested_at,
                notes="",
                tested_by=actor.id,
            )
            db.add(observation)
            db.flush()
            db.add(
                GeoObservationPublication(
                    observation_id=observation.id,
                    published_article_id=published_article_id,
                    discovered=mentioned,
                    mentioned=mentioned,
                    accuracy="ACCURATE",
                )
            )
    db.commit()


def _wait_for_blocker(
    db: Session,
    *,
    blocked_pid: int,
    blocker_pid: int,
    timeout_seconds: float = 10,
) -> None:
    """只在 PostgreSQL 确认指定事务形成锁等待后返回。"""
    deadline = monotonic() + timeout_seconds
    while monotonic() < deadline:
        blockers = db.scalar(
            text("SELECT pg_blocking_pids(:blocked_pid)"),
            {"blocked_pid": blocked_pid},
        )
        if blockers is not None and blocker_pid in blockers:
            return
    raise AssertionError("优化事务未在期限内等待指定 PostgreSQL 锁")


def _run_geo_optimization(
    *,
    engine: Engine,
    actor_id: uuid.UUID,
    payload: GeoOptimizationContentTaskCreate,
    idempotency_key: str,
    started: Event,
    worker_pid: list[int],
    preload: tuple[type[object], uuid.UUID] | None = None,
) -> str:
    """在独立事务中执行真实优化命令，并暴露用于锁观测的 backend PID。"""
    with Session(engine, expire_on_commit=False) as db:
        db.execute(text("SET LOCAL statement_timeout = '8s'"))
        actor = db.get(User, actor_id)
        assert actor is not None
        if preload is not None:
            model, resource_id = preload
            assert db.get(model, resource_id) is not None
        pid = db.scalar(text("SELECT pg_backend_pid()"))
        assert isinstance(pid, int)
        worker_pid.append(pid)
        started.set()
        try:
            create_geo_optimization_content_task(
                db=db,
                payload=payload,
                actor=actor,
                request_id=f"geo-lock-{uuid.uuid4()}",
                idempotency_key=idempotency_key,
            )
        except AppError as error:
            db.rollback()
            return error.code
        return "CREATED"


def _seed_geo_optimization_case(
    db: Session,
    *,
    content_hash: str,
    suffix: str,
) -> tuple[uuid.UUID, GeoOptimizationContentTaskCreate, int, int]:
    """创建一个真实下降异常，并返回命令载荷和副作用基线。"""
    graph = _seed_graph(db, content_hash=content_hash)
    actor = graph["user"]
    product = graph["product"]
    fact = graph["fact"]
    profile = graph["profile"]
    assert isinstance(actor, User)
    assert isinstance(product, Product)
    assert isinstance(fact, FactVersion)
    assert isinstance(profile, PlatformProfile)
    work = _complete_publication(db, graph, suffix=suffix)
    _add_decline_observations(db, graph, published_article_id=work.id)
    payload = GeoOptimizationContentTaskCreate(
        rule_code="CONTENT_DECLINE",
        date_from=date(2026, 7, 1),
        date_to=date(2026, 7, 31),
        published_article_id=work.id,
        product_id=product.id,
        platform_profile_id=profile.id,
        fact_version_id=fact.id,
    )
    source_count = int(db.scalar(select(func.count()).select_from(ContentTaskGeoSource)) or 0)
    audit_count = int(db.scalar(select(func.count()).select_from(AuditLog)) or 0)
    return actor.id, payload, source_count, audit_count


def _run_after_confirmed_lock_wait(
    *,
    engine: Engine,
    mutator: Session,
    blocker_pid: int,
    actor_id: uuid.UUID,
    payload: GeoOptimizationContentTaskCreate,
    idempotency_key: str,
    preload: tuple[type[object], uuid.UUID] | None = None,
) -> str:
    """确认真实锁等待后提交持锁事务，再返回优化命令结果。"""
    started = Event()
    worker_pid: list[int] = []
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            _run_geo_optimization,
            engine=engine,
            actor_id=actor_id,
            payload=payload,
            idempotency_key=idempotency_key,
            started=started,
            worker_pid=worker_pid,
            preload=preload,
        )
        release_with_commit = False
        try:
            assert started.wait(timeout=5)
            _wait_for_blocker(
                mutator,
                blocked_pid=worker_pid[0],
                blocker_pid=blocker_pid,
            )
            release_with_commit = True
        finally:
            if release_with_commit:
                mutator.commit()
            else:
                mutator.rollback()
        return future.result(timeout=10)


def _assert_no_optimization_side_effects(
    db: Session,
    *,
    idempotency_key: str,
    source_count: int,
    audit_count: int,
) -> None:
    """断言失败命令没有留下 task、source 或 audit。"""
    assert (
        db.scalar(
            select(func.count())
            .select_from(ContentTask)
            .where(ContentTask.idempotency_key == idempotency_key)
        )
        == 0
    )
    assert db.scalar(select(func.count()).select_from(ContentTaskGeoSource)) == source_count
    assert db.scalar(select(func.count()).select_from(AuditLog)) == audit_count


@pytest.mark.integration
def test_geo_insights_preserve_deleted_platform_identity_and_project_actions() -> None:
    """同一快照使用冻结平台身份，并直接返回可提交的异常来源。"""
    with _temporary_engine() as engine, Session(engine, expire_on_commit=False) as db:
        graph = _seed_graph(db, content_hash="7" * 64)
        actor = graph["user"]
        profile = graph["profile"]
        assert isinstance(actor, User)
        assert isinstance(profile, PlatformProfile)
        work = _complete_publication(db, graph, suffix="geo-insights")
        _add_decline_observations(db, graph, published_article_id=work.id)

        _geo_observation_read_snapshot(db)
        assert db.connection().get_isolation_level() == "REPEATABLE READ"
        filters = GeoInsightFilters(
            date_from=date(2026, 7, 1),
            date_to=date(2026, 7, 31),
            content_platform_id=profile.id,
        )
        insights = get_geo_insights(db, filters=filters, actor=actor)
        decline = insights.content_rankings.declining[0]
        assert decline.content_platform_id == profile.id
        assert decline.primary_task == "CREATE_OPTIMIZATION_TASK"
        assert decline.optimization_action is not None
        assert decline.optimization_action.rule_code == "CONTENT_DECLINE"
        assert decline.optimization_action.published_article_id == work.id
        assert decline.optimization_action.query_topic_id is None
        assert decline.optimization_action.geo_platform is None

        db.commit()
        db.delete(profile)
        db.commit()

        historical = get_geo_insights(db, filters=filters, actor=actor)
        assert historical.content_rankings.declining[0].content_platform_id == profile.id
        assert any(item.id == profile.id for item in historical.filter_options.content_platforms)


@pytest.mark.integration
def test_geo_optimization_same_key_is_atomic_and_compares_full_payload() -> None:
    """同键并发只创建一个聚合，异目标重放在复算前冲突。"""
    with _temporary_engine() as engine:
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="8" * 64)
            actor = graph["user"]
            product = graph["product"]
            fact = graph["fact"]
            profile = graph["profile"]
            assert isinstance(actor, User)
            assert isinstance(profile, PlatformProfile)
            work = _complete_publication(db, graph, suffix="geo-optimization")
            _add_decline_observations(db, graph, published_article_id=work.id)
            actor_id = actor.id
            payload = GeoOptimizationContentTaskCreate(
                rule_code="CONTENT_DECLINE",
                date_from=date(2026, 7, 1),
                date_to=date(2026, 7, 31),
                published_article_id=work.id,
                product_id=product.id,
                platform_profile_id=profile.id,
                fact_version_id=fact.id,
            )

        winner_ready, loser_ready, release = Event(), Event(), Event()
        pids: dict[str, int] = {}
        inserts: list[str] = []

        def create_once(role: str) -> uuid.UUID:
            with Session(engine, expire_on_commit=False) as db:
                db.execute(text("SET LOCAL statement_timeout = '12s'"))
                db.execute(text("SET LOCAL lock_timeout = '10s'"))
                pids[role] = db.scalar(text("SELECT pg_backend_pid()"))
                current_actor = db.get(User, actor_id)
                assert current_actor is not None
                connection = db.connection()

                def record_insert(_conn, _cursor, statement, _params, _context, _many):
                    if statement.startswith("INSERT INTO content_tasks "):
                        inserts.append(role)

                def before_commit(_db):
                    winner_ready.set()
                    assert release.wait(10)

                event.listen(connection, "before_cursor_execute", record_insert)
                if role == "winner":
                    event.listen(db, "before_commit", before_commit)
                else:
                    loser_ready.set()
                try:
                    return create_geo_optimization_content_task(
                        db=db,
                        payload=payload,
                        actor=current_actor,
                        request_id=f"geo-concurrent-{uuid.uuid4()}",
                        idempotency_key="geo-concurrent-key",
                    ).id
                finally:
                    event.remove(connection, "before_cursor_execute", record_insert)
                    if role == "winner":
                        event.remove(db, "before_commit", before_commit)

        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(create_once, "winner")
            try:
                assert winner_ready.wait(5)
                second = executor.submit(create_once, "loser")
                assert loser_ready.wait(5)
                assert pids["winner"] != pids["loser"]
                _wait_for_geo_sql(
                    engine,
                    blocked_pid=pids["loser"],
                    blocker_pid=pids["winner"],
                    query_fragment="SELECT pg_advisory_xact_lock(hashtextextended",
                )
                assert inserts == ["winner"]
            finally:
                release.set()
            task_ids = [first.result(timeout=15), second.result(timeout=15)]
        assert task_ids[0] == task_ids[1]
        assert inserts == ["winner"]

        with Session(engine, expire_on_commit=False) as db:
            assert (
                db.scalar(
                    select(func.count())
                    .select_from(ContentTask)
                    .where(ContentTask.idempotency_key == "geo-concurrent-key")
                )
                == 1
            )
            assert (
                db.scalar(
                    select(func.count())
                    .select_from(ContentTaskGeoSource)
                    .where(ContentTaskGeoSource.content_task_id == task_ids[0])
                )
                == 1
            )
            current_actor = db.get(User, actor_id)
            assert current_actor is not None
            with pytest.raises(AppError) as captured:
                create_geo_optimization_content_task(
                    db=db,
                    payload=payload.model_copy(update={"fact_version_id": uuid.uuid4()}),
                    actor=current_actor,
                    request_id="geo-conflict",
                    idempotency_key="geo-concurrent-key",
                )
            assert captured.value.code == "IDEMPOTENCY_CONFLICT"


@pytest.mark.integration
def test_geo_optimization_recomputes_after_waiting_for_observation_commit() -> None:
    """观测更正先持有 Product 锁时，优化命令不得落库锁前旧 basis。"""
    with _temporary_engine() as engine:
        with Session(engine, expire_on_commit=False) as db:
            actor_id, payload, source_count, audit_count = _seed_geo_optimization_case(
                db,
                content_hash="9" * 64,
                suffix="geo-stale-basis",
            )

        key = "geo-stale-basis-key"
        with Session(engine, expire_on_commit=False) as mutator:
            locked_product = mutator.scalar(
                select(Product).where(Product.id == payload.product_id).with_for_update()
            )
            assert locked_product is not None
            current_observations = list(
                mutator.scalars(
                    select(GeoObservation)
                    .where(
                        GeoObservation.product_id == payload.product_id,
                        GeoObservation.tested_at >= datetime(2026, 7, 1, tzinfo=UTC),
                        GeoObservation.supersedes_id.is_(None),
                    )
                    .order_by(GeoObservation.tested_at, GeoObservation.id)
                )
            )
            assert len(current_observations) == 3
            for previous in current_observations:
                correction = GeoObservation(
                    observation_kind="MANUAL_ARTICLE_SEARCH",
                    query_topic_id=previous.query_topic_id,
                    product_id=previous.product_id,
                    search_platform=previous.search_platform,
                    search_query=previous.search_query,
                    tested_at=previous.tested_at,
                    notes="并发更正为已提及",
                    supersedes_id=previous.id,
                    tested_by=actor_id,
                )
                mutator.add(correction)
                mutator.flush()
                mutator.add(
                    GeoObservationPublication(
                        observation_id=correction.id,
                        published_article_id=payload.published_article_id,
                        discovered=True,
                        mentioned=True,
                        accuracy="ACCURATE",
                    )
                )
            mutator.flush()
            blocker_pid = mutator.scalar(text("SELECT pg_backend_pid()"))
            assert isinstance(blocker_pid, int)
            outcome = _run_after_confirmed_lock_wait(
                engine=engine,
                mutator=mutator,
                blocker_pid=blocker_pid,
                actor_id=actor_id,
                payload=payload,
                idempotency_key=key,
            )

        assert outcome == "GEO_INSIGHT_STALE"
        with Session(engine, expire_on_commit=False) as db:
            _assert_no_optimization_side_effects(
                db,
                idempotency_key=key,
                source_count=source_count,
                audit_count=audit_count,
            )


@pytest.mark.integration
@pytest.mark.parametrize(
    ("resource", "expected_code"),
    [
        ("platform", "PLATFORM_DISABLED"),
        ("product", "FACT_NOT_APPROVED"),
        ("fact", "FACT_NOT_APPROVED"),
    ],
)
def test_geo_optimization_uses_locked_target_state(
    resource: str,
    expected_code: str,
) -> None:
    """目标资源等待行锁后必须覆盖 identity map 中预载的旧状态。"""
    with _temporary_engine() as engine:
        with Session(engine, expire_on_commit=False) as db:
            actor_id, payload, source_count, audit_count = _seed_geo_optimization_case(
                db,
                content_hash=f"{resource[0]}" * 64,
                suffix=f"geo-lock-{resource}",
            )

        key = f"geo-locked-target-{resource}"
        with Session(engine, expire_on_commit=False) as mutator:
            if resource == "platform":
                locked = mutator.scalar(
                    select(PlatformProfile)
                    .where(PlatformProfile.id == payload.platform_profile_id)
                    .with_for_update()
                )
                assert locked is not None
                locked.is_active = False
                preload: tuple[type[object], uuid.UUID] = (
                    PlatformProfile,
                    payload.platform_profile_id,
                )
            elif resource == "product":
                locked = mutator.scalar(
                    select(Product).where(Product.id == payload.product_id).with_for_update()
                )
                assert locked is not None
                locked.status = "RETIRED"
                preload = (Product, payload.product_id)
            else:
                locked = mutator.scalar(
                    select(FactVersion)
                    .where(FactVersion.id == payload.fact_version_id)
                    .with_for_update()
                )
                assert locked is not None
                locked.status = "RETIRED"
                preload = (FactVersion, payload.fact_version_id)
            mutator.flush()
            blocker_pid = mutator.scalar(text("SELECT pg_backend_pid()"))
            assert isinstance(blocker_pid, int)
            outcome = _run_after_confirmed_lock_wait(
                engine=engine,
                mutator=mutator,
                blocker_pid=blocker_pid,
                actor_id=actor_id,
                payload=payload,
                idempotency_key=key,
                preload=preload,
            )

        assert outcome == expected_code
        with Session(engine, expire_on_commit=False) as db:
            _assert_no_optimization_side_effects(
                db,
                idempotency_key=key,
                source_count=source_count,
                audit_count=audit_count,
            )


@pytest.mark.integration
def test_geo_optimization_rolls_back_task_when_source_flush_fails() -> None:
    """GEO 来源 flush 失败时，已 flush 的 ContentTask 也必须整体回滚。"""
    with _temporary_engine() as engine:
        with Session(engine, expire_on_commit=False) as db:
            actor_id, payload, source_count, audit_count = _seed_geo_optimization_case(
                db,
                content_hash="f" * 64,
                suffix="geo-source-failure",
            )

        key = "geo-source-flush-failure"
        with Session(engine, expire_on_commit=False) as command_db:
            current_actor = command_db.get(User, actor_id)
            assert current_actor is not None

            def reject_source_flush(
                session: Session,
                _flush_context: object,
                _instances: object,
            ) -> None:
                if any(isinstance(item, ContentTaskGeoSource) for item in session.new):
                    raise RuntimeError("模拟 GEO 来源 flush 失败")

            event.listen(command_db, "before_flush", reject_source_flush)
            try:
                with pytest.raises(RuntimeError, match="模拟 GEO 来源 flush 失败"):
                    create_geo_optimization_content_task(
                        db=command_db,
                        payload=payload,
                        actor=current_actor,
                        request_id="geo-source-failure",
                        idempotency_key=key,
                    )
            finally:
                event.remove(command_db, "before_flush", reject_source_flush)
                command_db.rollback()

        with Session(engine, expire_on_commit=False) as db:
            _assert_no_optimization_side_effects(
                db,
                idempotency_key=key,
                source_count=source_count,
                audit_count=audit_count,
            )


def _bypass_task(
    db: Session,
    payload: GeoOptimizationContentTaskCreate,
    actor_id: uuid.UUID,
    key: str,
    *,
    geo: bool = True,
) -> ContentTask:
    """旁路 writer 只跳过命令协议，仍使用真实外键、task INSERT 和完整来源。"""
    profile = db.get(PlatformProfile, payload.platform_profile_id)
    assert profile is not None
    task = ContentTask(
        product_id=payload.product_id,
        fact_version_id=payload.fact_version_id,
        platform_profile_id=profile.id,
        platform_profile_name_snapshot=profile.name,
        platform_website_url_snapshot=profile.website_url,
        idempotency_key=key,
        created_by=actor_id,
    )
    db.add(task)
    db.flush()
    if geo:
        db.add(
            ContentTaskGeoSource(
                content_task_id=task.id,
                rule_code=payload.rule_code,
                date_from=payload.date_from,
                date_to=payload.date_to,
                published_article_id=payload.published_article_id,
                query_topic_id=payload.query_topic_id,
                geo_platform=payload.geo_platform,
                basis_snapshot={"sentinel": "不可覆盖的 winner 依据"},
                created_by=actor_id,
            )
        )
        db.flush()
    return task


@pytest.mark.integration
def test_geo_task_current_head_catalog_and_real_duplicate_diagnostics() -> None:
    """运行时 catalog 与真实 duplicate INSERT 共同证明唯一可恢复的精确约束。"""
    with _temporary_engine() as engine, Session(engine, expire_on_commit=False) as db:
        actor_id, payload, _, _ = _seed_geo_optimization_case(
            db,
            content_hash="1" * 64,
            suffix="geo-catalog",
        )
        catalog = (
            db.execute(
                text("""
            SELECT c.conname, r.relname, c.contype, c.condeferrable,
                   pg_get_constraintdef(c.oid) AS definition,
                   ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(attnum, n)
                         JOIN pg_attribute a ON a.attrelid = c.conrelid
                              AND a.attnum = k.attnum ORDER BY k.n) AS columns
            FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
            WHERE c.conrelid = 'content_tasks'::regclass
              AND c.conname = 'uq_content_tasks_idempotency_key'
        """)
            )
            .mappings()
            .one()
        )
        assert dict(catalog) == {
            "conname": "uq_content_tasks_idempotency_key",
            "relname": "content_tasks",
            "contype": "u",
            "condeferrable": False,
            "definition": "UNIQUE (idempotency_key)",
            "columns": ["idempotency_key"],
        }
        _bypass_task(db, payload, actor_id, "geo-catalog-key")
        db.commit()
        with pytest.raises(IntegrityError) as captured:
            _bypass_task(db, payload, actor_id, "geo-catalog-key")
        assert captured.value.orig.sqlstate == "23505"
        assert captured.value.orig.diag.constraint_name == "uq_content_tasks_idempotency_key"
        db.rollback()
        assert db.scalar(text("SELECT 1")) == 1


def _geo_integrity_snapshot(db: Session) -> dict[str, object]:
    """冻结聚合完整行与不应发生变化的历史，避免仅计数遗漏 winner 被覆盖。"""
    models = (
        ContentTask,
        ContentTaskGeoSource,
        ContentVersion,
        ContentReviewRecord,
        GeoObservation,
        GeoObservationPublication,
        AuditLog,
    )
    return {
        model.__tablename__: sorted(
            (dict(row) for row in db.execute(select(model.__table__)).mappings()),
            key=lambda row: str(next(iter(row.values()))),
        )
        for model in models
    }


def _wait_for_geo_sql(
    engine: Engine,
    *,
    blocked_pid: int,
    blocker_pid: int,
    query_fragment: str,
) -> None:
    """有界检查指定连接的目标 SQL、Lock wait 与实际阻塞者。"""
    deadline = monotonic() + 8
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as monitor:
        monitor.execute(text("SET statement_timeout = '2s'"))
        while monotonic() < deadline:
            row = (
                monitor.execute(
                    text("""
                SELECT query, wait_event_type, pg_blocking_pids(pid) AS blockers
                FROM pg_stat_activity WHERE pid = :pid
            """),
                    {"pid": blocked_pid},
                )
                .mappings()
                .one()
            )
            if (
                query_fragment.lower() in row["query"].lower()
                and row["wait_event_type"] == "Lock"
                and blocker_pid in row["blockers"]
            ):
                return
    raise AssertionError(f"连接未等待指定 SQL：{query_fragment}")


@pytest.mark.integration
@pytest.mark.parametrize(
    "case",
    [
        "same",
        "date_from",
        "date_to",
        "rule_code",
        "ordinary-winner",
        "ordinary-loser",
        "missing-article",
        "missing-topic",
        "missing-platform",
        "coverage-same",
        "coverage-topic",
        "coverage-platform",
        "missing-date_from",
        "missing-date_to",
        "unknown-rule",
        "malformed-content-topic",
        "malformed-content-platform",
        "malformed-coverage-article",
    ],
)
def test_geo_exact_race_revalidates_source_kind_and_reuses_session(case: str) -> None:
    """共享资源 race 使用数据库 latch 排序，随后真实 INSERT 触发 exact diagnostics。"""
    with _temporary_engine() as engine:
        with Session(engine, expire_on_commit=False) as seed:
            actor_id, payload, _, _ = _seed_geo_optimization_case(
                seed,
                content_hash="2" * 64,
                suffix=f"geo-race-{case}",
            )
            topic_id = seed.scalar(select(GeoObservation.query_topic_id).limit(1))
            article_id = payload.published_article_id
            if case.startswith("coverage-") or case == "malformed-coverage-article":
                payload = payload.model_copy(
                    update={
                        "rule_code": "QUESTION_COVERAGE_GAP",
                        "published_article_id": None,
                        "query_topic_id": topic_id,
                        "geo_platform": "Perplexity",
                    }
                )
            other_topic_id = None
            if case == "coverage-topic":
                other_topic = QueryTopic(
                    canonical_question="另一个覆盖型竞态主题？",
                    intent_type="PRODUCT",
                    variants=[],
                )
                seed.add(other_topic)
                seed.commit()
                other_topic_id = other_topic.id
        winner_payload = payload
        if case == "date_from":
            winner_payload = payload.model_copy(update={"date_from": date(2026, 7, 2)})
        elif case == "date_to":
            winner_payload = payload.model_copy(update={"date_to": date(2026, 7, 30)})
        elif case == "rule_code":
            winner_payload = payload.model_copy(update={"rule_code": "LONG_UNMENTIONED"})
        elif case == "missing-article":
            winner_payload = payload.model_copy(update={"published_article_id": None})
        elif case in {"missing-topic", "missing-platform"}:
            winner_payload = payload.model_copy(
                update={
                    "rule_code": "QUESTION_COVERAGE_GAP",
                    "published_article_id": None,
                    "query_topic_id": None if case == "missing-topic" else topic_id,
                    "geo_platform": None if case == "missing-platform" else "Perplexity",
                }
            )
        elif case == "coverage-topic":
            winner_payload = payload.model_copy(update={"query_topic_id": other_topic_id})
        elif case == "coverage-platform":
            winner_payload = payload.model_copy(update={"geo_platform": "DeepSeek"})
        # 异常读形状只替换 exact rollback 后的来源结果，不改已提交 winner 或约束。
        source_read_changes = {
            "missing-date_from": {"date_from": None},
            "missing-date_to": {"date_to": None},
            "unknown-rule": {"rule_code": "UNKNOWN_RULE"},
            "malformed-content-topic": {"query_topic_id": topic_id},
            "malformed-content-platform": {"geo_platform": "Perplexity"},
            "malformed-coverage-article": {"published_article_id": article_id},
        }.get(case)
        key = f"geo-exact-{case}"
        latch = uuid.uuid4().int % (2**62)
        ready = Event()
        worker_pid: list[int] = []
        errors: list[IntegrityError] = []
        unknown = case.startswith("missing-") or source_read_changes is not None

        def run_loser() -> tuple[str, uuid.UUID | None]:
            with (
                Session(engine, expire_on_commit=False) as db,
                pytest.MonkeyPatch.context() as patch,
            ):
                db.execute(text("SET LOCAL statement_timeout = '12s'"))
                db.execute(text("SET LOCAL lock_timeout = '10s'"))
                actor = db.get(User, actor_id)
                assert actor is not None
                connection = db.connection()
                worker_pid.append(db.scalar(text("SELECT pg_backend_pid()")))
                gated = False
                original_get = db.get

                def recovery_get(model, identity, *args, **kwargs):
                    source = original_get(model, identity, *args, **kwargs)
                    if source_read_changes is not None and errors and model is ContentTaskGeoSource:
                        assert db.is_active and source is not None
                        values = {
                            column.name: getattr(source, column.name)
                            for column in ContentTaskGeoSource.__table__.columns
                        }
                        values.update(source_read_changes)
                        return ContentTaskGeoSource(**values)
                    return source

                patch.setattr(db, "get", recovery_get)

                def after_lookup(_conn, _cursor, statement, _params, _context, _many):
                    nonlocal gated
                    if (
                        not gated
                        and "FROM content_tasks" in statement
                        and "idempotency_key =" in statement
                    ):
                        gated = True
                        ready.set()
                        connection.execute(
                            text("SELECT pg_advisory_xact_lock(:latch)"), {"latch": latch}
                        )

                def capture_error(context):
                    if isinstance(context.sqlalchemy_exception, IntegrityError):
                        errors.append(context.sqlalchemy_exception)

                event.listen(connection, "after_cursor_execute", after_lookup)
                event.listen(engine, "handle_error", capture_error)
                try:
                    try:
                        if case == "ordinary-loser":
                            task = planning_service.create_content_task(
                                db=db,
                                payload=ContentTaskCreate(
                                    product_id=payload.product_id,
                                    fact_version_id=payload.fact_version_id,
                                    platform_profile_id=payload.platform_profile_id,
                                ),
                                actor=actor,
                                request_id="geo-reverse-race",
                                idempotency_key=key,
                            )
                        else:
                            task = create_geo_optimization_content_task(
                                db=db,
                                payload=payload,
                                actor=actor,
                                request_id="geo-exact-race",
                                idempotency_key=key,
                            )
                        result = ("replay", task.id)
                    except AppError as error:
                        assert error.code == "IDEMPOTENCY_CONFLICT"
                        assert error.message == "幂等键已用于另一内容任务创建请求"
                        assert error.details == {}
                        result = ("conflict", None)
                    except IntegrityError as error:
                        assert unknown and error is errors[0]
                        db.rollback()
                        result = ("unknown", None)
                    assert db.scalar(text("SELECT 1")) == 1
                    assert (
                        db.scalar(select(ContentTask).where(ContentTask.idempotency_key == key))
                        is not None
                    )
                    # 已知恢复路径在没有测试补 rollback 的情况下能执行健康命令。
                    healthy = planning_service.create_content_task(
                        db=db,
                        payload=ContentTaskCreate(
                            product_id=payload.product_id,
                            fact_version_id=payload.fact_version_id,
                            platform_profile_id=payload.platform_profile_id,
                        ),
                        actor=actor,
                        request_id="geo-reuse",
                        idempotency_key=f"{key}-healthy",
                        commit=False,
                    )
                    assert healthy.id is not None
                    db.rollback()
                    return result
                finally:
                    event.remove(connection, "after_cursor_execute", after_lookup)
                    event.remove(engine, "handle_error", capture_error)

        with engine.connect() as coordinator, ThreadPoolExecutor(max_workers=1) as executor:
            coordinator.execute(text("SELECT pg_advisory_lock(:latch)"), {"latch": latch})
            blocker_pid = coordinator.scalar(text("SELECT pg_backend_pid()"))
            future = executor.submit(run_loser)
            try:
                assert ready.wait(5)
                _wait_for_geo_sql(
                    engine,
                    blocked_pid=worker_pid[0],
                    blocker_pid=blocker_pid,
                    query_fragment="SELECT pg_advisory_xact_lock",
                )
                with Session(engine, expire_on_commit=False) as winner_db:
                    winner = _bypass_task(
                        winner_db, winner_payload, actor_id, key, geo=case != "ordinary-winner"
                    )
                    winner_db.commit()
                    winner_id = winner.id
                    before = _geo_integrity_snapshot(winner_db)
            finally:
                coordinator.execute(text("SELECT pg_advisory_unlock(:latch)"), {"latch": latch})
            result = future.result(timeout=15)
        assert result == (
            ("replay", winner_id)
            if case in {"same", "coverage-same"}
            else ("unknown" if unknown else "conflict", None)
        )
        assert len(errors) == 1
        assert errors[0].orig.sqlstate == "23505"
        assert errors[0].orig.diag.constraint_name == "uq_content_tasks_idempotency_key"
        with Session(engine) as verify:
            assert _geo_integrity_snapshot(verify) == before


@pytest.mark.integration
def test_geo_different_target_race_waits_at_real_unique_insert() -> None:
    """不共享目标资源的 loser 真正在 task INSERT 等待 winner 唯一性仲裁。"""
    with _temporary_engine() as engine:
        with Session(engine, expire_on_commit=False) as seed:
            actor_id, payload, _, _ = _seed_geo_optimization_case(
                seed,
                content_hash="3" * 64,
                suffix="geo-unique-loser",
            )
            _, winner_payload, _, _ = _seed_geo_optimization_case(
                seed,
                content_hash="4" * 64,
                suffix="geo-unique-winner",
            )
        ready = Event()
        worker_pid: list[int] = []
        errors: list[IntegrityError] = []
        key = "geo-unique-wait-key"

        def run_loser() -> str:
            with Session(engine, expire_on_commit=False) as db:
                db.execute(text("SET LOCAL statement_timeout = '12s'"))
                db.execute(text("SET LOCAL lock_timeout = '10s'"))
                actor = db.get(User, actor_id)
                worker_pid.append(db.scalar(text("SELECT pg_backend_pid()")))
                connection = db.connection()

                def capture_error(context):
                    if context.connection is connection:
                        errors.append(context.sqlalchemy_exception)

                event.listen(engine, "handle_error", capture_error)
                ready.set()
                try:
                    with pytest.raises(AppError) as captured:
                        create_geo_optimization_content_task(
                            db=db,
                            payload=payload,
                            actor=actor,
                            request_id="geo-unique-wait",
                            idempotency_key=key,
                        )
                    assert db.scalar(text("SELECT 1")) == 1
                    assert db.scalar(select(ContentTask).where(ContentTask.idempotency_key == key))
                    return captured.value.code
                finally:
                    event.remove(engine, "handle_error", capture_error)

        with Session(engine, expire_on_commit=False) as winner_db:
            _bypass_task(winner_db, winner_payload, actor_id, key)
            blocker_pid = winner_db.scalar(text("SELECT pg_backend_pid()"))
            before = _geo_integrity_snapshot(winner_db)
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(run_loser)
                try:
                    assert ready.wait(5)
                    _wait_for_geo_sql(
                        engine,
                        blocked_pid=worker_pid[0],
                        blocker_pid=blocker_pid,
                        query_fragment="INSERT INTO content_tasks",
                    )
                    winner_db.commit()
                finally:
                    winner_db.rollback()
                assert future.result(timeout=15) == "IDEMPOTENCY_CONFLICT"
        assert len(errors) == 1
        assert errors[0].orig.sqlstate == "23505"
        assert errors[0].orig.diag.constraint_name == "uq_content_tasks_idempotency_key"
        with Session(engine) as verify:
            assert _geo_integrity_snapshot(verify) == before


def _geo_diagnostic_error(sqlstate: object, constraint: object) -> IntegrityError:
    """只用于无法由正常驱动返回的 diagnostics 结构负例。"""
    driver = Exception("sensitive database detail uq_content_tasks_idempotency_key")
    driver.sqlstate = sqlstate
    driver.diag = SimpleNamespace(constraint_name=constraint)
    return IntegrityError("INSERT INTO content_tasks", {}, driver)


@pytest.mark.integration
def test_geo_unknown_diagnostics_and_unverifiable_winner_rethrow_original(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """异常身份与 winner 不足以证明已知结果时保留原异常，不借 message 猜测。"""
    with _temporary_engine() as engine, Session(engine, expire_on_commit=False) as db:
        actor_id, payload, _, _ = _seed_geo_optimization_case(
            db,
            content_hash="5" * 64,
            suffix="geo-negative",
        )
        actor = db.get(User, actor_id)
        baseline = _geo_integrity_snapshot(db)
        target = "uq_content_tasks_idempotency_key"
        negatives = [
            ("23505", None),
            (None, target),
            ("23503", target),
            ("23514", target),
            ("23502", target),
            ("55000", target),
            ("P0001", target),
            (23505, target),
            ("23505", 42),
            ("23505", target.upper()),
            ("23505", f"{target}_other"),
            ("23505", f"prefix_{target}"),
            ("23505", "pk_content_tasks"),
            ("23505", "uq_content_tasks_other"),
        ]
        originals = [_geo_diagnostic_error(*pair) for pair in negatives]
        no_diag = _geo_diagnostic_error("23505", target)
        del no_diag.orig.diag
        no_diag.orig.constraint_name = target
        originals.append(no_diag)
        malformed = _geo_diagnostic_error("23505", target)
        malformed.orig.diag = target
        originals.append(malformed)
        for index, original in enumerate(originals):
            with monkeypatch.context() as patch:

                def fail_task(_original=original, **_kwargs):
                    raise _original

                patch.setattr(geo_service, "add_locked_content_task", fail_task)
                with pytest.raises(IntegrityError) as captured:
                    create_geo_optimization_content_task(
                        db=db,
                        payload=payload,
                        actor=actor,
                        request_id="geo-negative",
                        idempotency_key=f"geo-negative-{index}",
                    )
                assert captured.value is original
                db.rollback()
                assert db.scalar(text("SELECT 1")) == 1
        # 合法 schema 不可能返回缺少必填 task 字段；仅模拟恢复时不可证明的读结果。
        for field in ("missing", "product_id", "fact_version_id", "platform_profile_id"):
            original = _geo_diagnostic_error("23505", target)
            winner = (
                None
                if field == "missing"
                else ContentTask(
                    id=uuid.uuid4(),
                    product_id=payload.product_id,
                    fact_version_id=payload.fact_version_id,
                    platform_profile_id=payload.platform_profile_id,
                )
            )
            if winner is not None:
                setattr(winner, field, None)
            original_scalar = db.scalar
            looked_up = False

            def recovery_scalar(
                statement, *args, _winner=winner, _scalar=original_scalar, **kwargs
            ):
                nonlocal looked_up
                if "content_tasks.idempotency_key =" in str(statement):
                    if looked_up:
                        assert db.is_active
                        return _winner
                    looked_up = True
                return _scalar(statement, *args, **kwargs)

            with monkeypatch.context() as patch:

                def fail_exact(_original=original, **_kwargs):
                    raise _original

                patch.setattr(geo_service, "add_locked_content_task", fail_exact)
                patch.setattr(db, "scalar", recovery_scalar)
                with pytest.raises(IntegrityError) as captured:
                    create_geo_optimization_content_task(
                        db=db,
                        payload=payload,
                        actor=actor,
                        request_id="geo-unverifiable",
                        idempotency_key=f"geo-unverifiable-{field}",
                    )
                assert captured.value is original
            assert db.scalar(text("SELECT 1")) == 1
            db.rollback()
        assert _geo_integrity_snapshot(db) == baseline


@pytest.mark.integration
def test_geo_precheck_compares_each_identity_field_and_both_source_kinds() -> None:
    """已提交 canonical 聚合只对相同规则的完整九字段身份重放。"""
    with _temporary_engine() as engine, Session(engine, expire_on_commit=False) as db:
        actor_id, payload, _, _ = _seed_geo_optimization_case(
            db,
            content_hash="6" * 64,
            suffix="geo-precheck",
        )
        actor = db.get(User, actor_id)
        winner = create_geo_optimization_content_task(
            db=db,
            payload=payload,
            actor=actor,
            request_id="geo-precheck",
            idempotency_key="geo-precheck-key",
        )
        before = _geo_integrity_snapshot(db)
        changes = {
            "product_id": uuid.uuid4(),
            "fact_version_id": uuid.uuid4(),
            "platform_profile_id": uuid.uuid4(),
            "published_article_id": uuid.uuid4(),
            "date_from": date(2026, 7, 2),
            "date_to": date(2026, 7, 30),
            "rule_code": "LONG_UNMENTIONED",
        }
        for field, value in changes.items():
            with pytest.raises(AppError) as error:
                create_geo_optimization_content_task(
                    db=db,
                    payload=payload.model_copy(update={field: value}),
                    actor=actor,
                    request_id="geo-precheck-field",
                    idempotency_key="geo-precheck-key",
                )
            assert error.value.code == "IDEMPOTENCY_CONFLICT"
        assert (
            create_geo_optimization_content_task(
                db=db,
                payload=payload,
                actor=actor,
                request_id="another-actor-context",
                idempotency_key="geo-precheck-key",
            ).id
            == winner.id
        )
        ordinary = ContentTaskCreate(
            product_id=payload.product_id,
            fact_version_id=payload.fact_version_id,
            platform_profile_id=payload.platform_profile_id,
        )
        with pytest.raises(AppError) as reverse:
            planning_service.create_content_task(
                db=db,
                payload=ordinary,
                actor=actor,
                request_id="geo-precheck-reverse",
                idempotency_key="geo-precheck-key",
            )
        assert reverse.value.code == "IDEMPOTENCY_CONFLICT"
        assert _geo_integrity_snapshot(db) == before
        planning_service.create_content_task(
            db=db,
            payload=ordinary,
            actor=actor,
            request_id="ordinary-first",
            idempotency_key="ordinary-first-key",
        )
        with pytest.raises(AppError) as cross_kind:
            create_geo_optimization_content_task(
                db=db,
                payload=payload,
                actor=actor,
                request_id="geo-second",
                idempotency_key="ordinary-first-key",
            )
        assert cross_kind.value.code == "IDEMPOTENCY_CONFLICT"
        topic_id = db.scalar(select(GeoObservation.query_topic_id).limit(1))
        coverage = payload.model_copy(
            update={
                "rule_code": "QUESTION_COVERAGE_GAP",
                "published_article_id": None,
                "query_topic_id": topic_id,
                "geo_platform": "Perplexity",
            }
        )
        coverage_task = _bypass_task(db, coverage, actor_id, "coverage-precheck-key")
        db.commit()
        assert (
            create_geo_optimization_content_task(
                db=db,
                payload=coverage,
                actor=actor,
                request_id="coverage-replay",
                idempotency_key="coverage-precheck-key",
            ).id
            == coverage_task.id
        )
        for field, value in {"query_topic_id": uuid.uuid4(), "geo_platform": "Other"}.items():
            with pytest.raises(AppError) as error:
                create_geo_optimization_content_task(
                    db=db,
                    payload=coverage.model_copy(update={field: value}),
                    actor=actor,
                    request_id="coverage-conflict",
                    idempotency_key="coverage-precheck-key",
                )
            assert error.value.code == "IDEMPOTENCY_CONFLICT"


@pytest.mark.integration
@pytest.mark.parametrize("failure", ["source-check", "late-exact"])
def test_geo_source_commit_failure_is_outside_mapper_and_atomic(failure: str) -> None:
    """来源 CHECK 或 commit 内同名真实 unique 都保持 unknown，并回滚已 flush 的 task。"""
    with _temporary_engine() as engine, Session(engine, expire_on_commit=False) as db:
        actor_id, payload, _, _ = _seed_geo_optimization_case(
            db,
            content_hash="a" * 64,
            suffix=f"geo-late-{failure}",
        )
        _bypass_task(db, payload, actor_id, "geo-late-existing")
        db.commit()
        baseline = _geo_integrity_snapshot(db)
        actor = db.get(User, actor_id)
        errors: list[IntegrityError] = []

        def fail_source(session, _context, _instances):
            sources = [item for item in session.new if isinstance(item, ContentTaskGeoSource)]
            if not sources:
                return
            if failure == "source-check":
                sources[0].date_to = date(2000, 1, 1)
            else:
                session.execute(
                    text("""
                    INSERT INTO content_tasks
                      (id, product_id, fact_version_id, platform_profile_id,
                       platform_profile_name_snapshot, idempotency_key,
                       status, revision, created_by)
                    SELECT gen_random_uuid(), product_id, fact_version_id, platform_profile_id,
                           platform_profile_name_snapshot, idempotency_key, 'OPEN', 0, created_by
                    FROM content_tasks WHERE idempotency_key = 'geo-late-existing'
                """)
                )

        def capture_error(context):
            errors.append(context.sqlalchemy_exception)

        event.listen(db, "before_flush", fail_source)
        event.listen(engine, "handle_error", capture_error)
        try:
            with pytest.raises(IntegrityError) as captured:
                create_geo_optimization_content_task(
                    db=db,
                    payload=payload,
                    actor=actor,
                    request_id="geo-late",
                    idempotency_key=f"geo-late-{failure}",
                )
            assert captured.value is errors[0]
            assert captured.value.orig.sqlstate == (
                "23514" if failure == "source-check" else "23505"
            )
            if failure == "late-exact":
                assert (
                    captured.value.orig.diag.constraint_name == "uq_content_tasks_idempotency_key"
                )
        finally:
            event.remove(db, "before_flush", fail_source)
            event.remove(engine, "handle_error", capture_error)
            db.rollback()
        assert db.scalar(text("SELECT 1")) == 1
        with Session(engine) as verify:
            assert _geo_integrity_snapshot(verify) == baseline
        healthy = create_geo_optimization_content_task(
            db=db,
            payload=payload,
            actor=actor,
            request_id="geo-late-reuse",
            idempotency_key=f"geo-late-{failure}-healthy",
        )
        assert db.get(ContentTaskGeoSource, healthy.id) is not None


@pytest.mark.integration
def test_geo_http_precheck_exact_conflict_and_real_unknown_no_leak(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """真实 route 与请求 Session owner 保持 409 wire 和未知数据库错误 500/no-leak。"""
    with _temporary_engine() as engine:
        with Session(engine, expire_on_commit=False) as seed:
            actor_id, payload, _, _ = _seed_geo_optimization_case(
                seed,
                content_hash="b" * 64,
                suffix="geo-http",
            )
            actor = seed.get(User, actor_id)
            _bypass_task(seed, payload, actor_id, "geo-http-precheck", geo=False)
            seed.commit()
        mode = "precheck"
        listeners: list[tuple[object, str, object]] = []
        errors: list[IntegrityError] = []
        rolled_back: list[str] = []

        def request_session():
            db = Session(engine, expire_on_commit=False)
            connection = db.connection()
            injected = False

            def inject_winner(_conn, _cursor, statement, _params, _context, _many):
                nonlocal injected
                if (
                    mode == "exact"
                    and not injected
                    and "FROM content_tasks" in statement
                    and "idempotency_key =" in statement
                ):
                    injected = True
                    with Session(engine) as competitor:
                        _bypass_task(competitor, payload, actor_id, "geo-http-exact", geo=False)
                        competitor.commit()

            def corrupt_source(session, _context, _instances):
                if mode == "unknown":
                    for item in session.new:
                        if isinstance(item, ContentTaskGeoSource):
                            item.date_to = date(2000, 1, 1)

            def after_rollback(session, _transaction):
                if session.is_active:
                    assert session.scalar(text("SELECT 1")) == 1
                    rolled_back.append(mode)

            for target, name, callback in (
                (connection, "after_cursor_execute", inject_winner),
                (db, "before_flush", corrupt_source),
                (db, "after_soft_rollback", after_rollback),
            ):
                event.listen(target, name, callback)
                listeners.append((target, name, callback))
            return db

        def capture_error(context):
            errors.append(context.sqlalchemy_exception)

        csrf = "geo-http-csrf-token-with-more-than-32-characters"
        auth = SimpleNamespace(user=actor, csrf_hash=hash_token(csrf))
        monkeypatch.setattr(db_module, "SessionLocal", request_session)
        app.dependency_overrides[get_current_session] = lambda: auth
        event.listen(engine, "handle_error", capture_error)
        try:
            assert app.debug is False
            for mode in ("precheck", "exact", "unknown"):
                with Session(engine) as verify:
                    baseline = _geo_integrity_snapshot(verify)
                request_id = f"geo-http-{mode}-request"
                response = TestClient(app, raise_server_exceptions=False).post(
                    "/api/v1/geo-insights/optimization-content-tasks",
                    json=payload.model_dump(mode="json"),
                    headers={
                        "Idempotency-Key": f"geo-http-{mode}",
                        "X-CSRF-Token": csrf,
                        "X-Request-ID": request_id,
                    },
                )
                if mode != "unknown":
                    assert response.status_code == 409, response.text
                    assert response.headers["X-Request-ID"] == request_id
                    assert response.json() == {
                        "error": {
                            "code": "IDEMPOTENCY_CONFLICT",
                            "message": "幂等键已用于另一内容任务创建请求",
                            "details": {},
                            "request_id": request_id,
                        }
                    }
                else:
                    assert response.status_code == 500
                    for secret in (
                        "INSERT INTO",
                        "content_tasks",
                        "content_task_geo_sources",
                        "period",
                        "psycopg",
                        "Traceback",
                        "violates check constraint",
                    ):
                        assert secret not in response.text
                    with Session(engine) as verify:
                        assert _geo_integrity_snapshot(verify) == baseline
            assert [error.orig.sqlstate for error in errors] == ["23505", "23514"]
            assert errors[0].orig.diag.constraint_name == "uq_content_tasks_idempotency_key"
            assert "exact" in rolled_back and "unknown" in rolled_back
        finally:
            app.dependency_overrides.pop(get_current_session, None)
            event.remove(engine, "handle_error", capture_error)
            for target, name, callback in reversed(listeners):
                event.remove(target, name, callback)
