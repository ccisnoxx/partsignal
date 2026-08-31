"""GEO Insights 历史身份与动作投影的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, date, datetime
from threading import Barrier, Event
from time import monotonic

import pytest
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.configuration import PlatformProfile
from app.models.content import ContentTask, ContentTaskGeoSource
from app.models.geo_files import GeoObservation, GeoObservationPublication
from app.models.identity import AuditLog, User
from app.models.product_facts import FactVersion, Product
from app.routers.observation import _geo_observation_read_snapshot
from app.schemas.geo_files import GeoOptimizationContentTaskCreate
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
    assert db.scalar(
        select(func.count())
        .select_from(ContentTask)
        .where(ContentTask.idempotency_key == idempotency_key)
    ) == 0
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
        assert any(
            item.id == profile.id for item in historical.filter_options.content_platforms
        )


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

        barrier = Barrier(2)

        def create_once() -> uuid.UUID:
            with Session(engine, expire_on_commit=False) as db:
                current_actor = db.get(User, actor_id)
                assert current_actor is not None
                barrier.wait()
                return create_geo_optimization_content_task(
                    db=db,
                    payload=payload,
                    actor=current_actor,
                    request_id=f"geo-concurrent-{uuid.uuid4()}",
                    idempotency_key="geo-concurrent-key",
                ).id

        with ThreadPoolExecutor(max_workers=2) as executor:
            task_ids = list(executor.map(lambda _index: create_once(), range(2)))
        assert task_ids[0] == task_ids[1]

        with Session(engine, expire_on_commit=False) as db:
            assert db.scalar(
                select(func.count())
                .select_from(ContentTask)
                .where(ContentTask.idempotency_key == "geo-concurrent-key")
            ) == 1
            assert db.scalar(
                select(func.count())
                .select_from(ContentTaskGeoSource)
                .where(ContentTaskGeoSource.content_task_id == task_ids[0])
            ) == 1
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
                        GeoObservation.tested_at
                        >= datetime(2026, 7, 1, tzinfo=UTC),
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
                    select(Product)
                    .where(Product.id == payload.product_id)
                    .with_for_update()
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
