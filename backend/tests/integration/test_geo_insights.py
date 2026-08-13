"""GEO Insights 历史身份与动作投影的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from threading import Barrier

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.configuration import PlatformProfile
from app.models.content import ContentTask, ContentTaskGeoSource
from app.models.geo_files import GeoObservation, GeoObservationPublication
from app.models.identity import User
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


@pytest.mark.integration
def test_geo_insights_preserve_deleted_platform_identity_and_project_actions() -> None:
    """同一快照使用冻结平台身份，并直接返回可提交的异常来源。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
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
                item.id == profile.id
                for item in historical.filter_options.content_platforms
            )


@pytest.mark.integration
def test_geo_optimization_same_key_is_atomic_and_compares_full_payload() -> None:
    """同键并发只创建一个聚合，异目标重放在复算前冲突。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
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
