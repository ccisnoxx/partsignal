"""Frontend V2 GEO 观测紧凑列表的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.configuration import PlatformProfile, QueryTopic
from app.models.content import ContentTask, ContentVersion
from app.models.geo_files import (
    FileRecord,
    GeoObservation,
    GeoObservationAttachment,
    GeoObservationPublication,
)
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.models.publication import PlatformAccount
from app.services.geo_observation import (
    GeoObservationFilters,
    GeoObservationListFilters,
    list_geo_observation_items,
    list_geo_observations,
)
from tests.integration.test_publication_workflow import (
    _complete_publication,
    _seed_graph,
    temporary_database,
)


def _additional_publication_graph(
    db: Session,
    graph: dict[str, object],
    *,
    suffix: str,
) -> dict[str, object]:
    """为同一产品创建另一条合法内容与发布路径。"""
    actor = graph["user"]
    product = graph["product"]
    fact = graph["fact"]
    profile = graph["profile"]
    topic = graph["topic"]
    assert isinstance(actor, User)
    assert isinstance(product, Product)
    assert isinstance(fact, FactVersion)
    assert isinstance(profile, PlatformProfile)
    assert isinstance(topic, QueryTopic)
    task = ContentTask(
        query_topic_id=topic.id,
        product_id=product.id,
        fact_version_id=fact.id,
        platform_profile_id=profile.id,
        platform_profile_name_snapshot=profile.name,
        platform_website_url_snapshot=profile.website_url,
        created_by=actor.id,
    )
    account = PlatformAccount(
        platform_profile_id=profile.id,
        label=f"GEO 账号 {suffix}",
        account_identifier=f"geo-{suffix}-{uuid.uuid4().hex[:8]}",
    )
    db.add_all([task, account])
    db.flush()
    content = ContentVersion(
        task_id=task.id,
        fact_version_id=fact.id,
        version=1,
        source_type="HUMAN",
        title=f"GEO 成果 {suffix}",
        summary="GEO 列表集成测试",
        body_markdown="# GEO 成果",
        tags=["GEO"],
        content_hash=suffix[0] * 64,
        status="APPROVED",
        quality_issues=[],
        change_summary="建立列表关系",
        created_by=actor.id,
    )
    db.add(content)
    db.flush()
    task.current_content_version_id = content.id
    db.commit()
    return {**graph, "task": task, "content": content, "account": account}


def _evidence_file(db: Session, actor: User, *, suffix: str) -> FileRecord:
    file = FileRecord(
        category="EVIDENCE",
        original_filename=f"{suffix}.png",
        object_key=f"geo-list/{uuid.uuid4()}/{suffix}.png",
        content_type="image/png",
        size=128,
        sha256=suffix[0] * 64,
        access_level="INTERNAL",
        status="VERIFIED",
        uploader_id=actor.id,
        upload_expires_at=datetime.now(UTC) + timedelta(hours=1),
        verified_at=datetime.now(UTC),
    )
    db.add(file)
    db.flush()
    return file


def _list_statement_count(
    engine: Engine,
    *,
    actor_id: uuid.UUID,
    filters: GeoObservationListFilters,
) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with Session(engine) as db:
            actor = db.get(User, actor_id)
            assert actor is not None
            list_geo_observation_items(
                db,
                filters=filters,
                actor=actor,
                page=1,
                page_size=10,
                sort="OBSERVED_DESC",
            )
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


@pytest.mark.integration
def test_geo_observation_list_is_compact_server_filtered_and_actor_projected() -> None:
    """两类观测统一投影，纠正链、筛选、分页和动作均由服务端决定。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            manual_graph = _seed_graph(db, content_hash="a" * 64)
            legacy_graph = _seed_graph(db, content_hash="b" * 64)
            actor = manual_graph["user"]
            manual_product = manual_graph["product"]
            manual_topic = manual_graph["topic"]
            legacy_product = legacy_graph["product"]
            legacy_topic = QueryTopic(
                canonical_question="如何选择另一种测试器件？",
                intent_type="PRODUCT",
                variants=["另一种测试器件选型"],
            )
            db.add(legacy_topic)
            db.flush()
            assert isinstance(actor, User)
            assert isinstance(manual_product, Product)
            assert isinstance(manual_topic, QueryTopic)
            assert isinstance(legacy_product, Product)
            assert isinstance(legacy_topic, QueryTopic)
            actor.account_type = "ADMIN"
            db.commit()

            publication_graphs = [
                manual_graph,
                _additional_publication_graph(db, manual_graph, suffix="b-result"),
                _additional_publication_graph(db, manual_graph, suffix="c-result"),
            ]
            publications = [
                _complete_publication(db, graph, suffix=f"geo-list-{index}")
                for index, graph in enumerate(publication_graphs, start=1)
            ]

            parent = GeoObservation(
                observation_kind="MANUAL_ARTICLE_SEARCH",
                query_topic_id=manual_topic.id,
                product_id=manual_product.id,
                search_platform="DeepSeek",
                search_query="raw-special-query",
                tested_at=datetime(2026, 8, 9, 8, tzinfo=UTC),
                notes="父观测",
                tested_by=actor.id,
            )
            db.add(parent)
            db.flush()
            child = GeoObservation(
                observation_kind="MANUAL_ARTICLE_SEARCH",
                query_topic_id=manual_topic.id,
                product_id=manual_product.id,
                search_platform="DeepSeek",
                search_query="raw-special-query",
                tested_at=datetime(2026, 8, 10, 8, tzinfo=UTC),
                notes="当前观测",
                supersedes_id=parent.id,
                tested_by=actor.id,
            )
            db.add(child)
            db.flush()
            parent_file = _evidence_file(db, actor, suffix="a-parent")
            child_file = _evidence_file(db, actor, suffix="b-child")
            db.add_all(
                [
                    GeoObservationAttachment(observation_id=parent.id, file_id=parent_file.id),
                    GeoObservationAttachment(observation_id=child.id, file_id=child_file.id),
                    GeoObservationPublication(
                        observation_id=parent.id,
                        published_article_id=publications[0].id,
                        discovered=False,
                        mentioned=False,
                        accuracy="PARTIAL",
                    ),
                    GeoObservationPublication(
                        observation_id=child.id,
                        published_article_id=publications[0].id,
                        discovered=True,
                        mentioned=True,
                        accuracy="ACCURATE",
                    ),
                    GeoObservationPublication(
                        observation_id=child.id,
                        published_article_id=publications[1].id,
                        discovered=False,
                        mentioned=False,
                        accuracy="UNJUDGEABLE",
                    ),
                    GeoObservationPublication(
                        observation_id=child.id,
                        published_article_id=publications[2].id,
                        discovered=True,
                        mentioned=False,
                        accuracy=None,
                    ),
                ]
            )

            legacy_file: FileRecord | None = None
            legacy_observations: list[GeoObservation] = []
            for index in range(10):
                observation = GeoObservation(
                    observation_kind="LEGACY_MODEL_RESULT",
                    query_topic_id=legacy_topic.id,
                    product_id=legacy_product.id,
                    actual_prompt=f"额外问题 {index}",
                    model_name="ChatGPT",
                    model_version="legacy",
                    tested_at=datetime(2026, 8, 8, 8, tzinfo=UTC)
                    - timedelta(days=max(index - 1, 0)),
                    web_search_enabled=False,
                    answer_summary="旧模型回答",
                    mentioned=index % 2 == 0,
                    recommendation="NONE",
                    accuracy="PARTIAL",
                    notes="旧观测",
                    tested_by=actor.id,
                )
                db.add(observation)
                db.flush()
                legacy_observations.append(observation)
                if index == 0:
                    legacy_file = _evidence_file(db, actor, suffix="c-legacy")
                    db.add(
                        GeoObservationAttachment(
                            observation_id=observation.id,
                            file_id=legacy_file.id,
                        )
                    )
            db.commit()

            page = list_geo_observation_items(
                db,
                filters=GeoObservationListFilters(),
                actor=actor,
                page=1,
                page_size=10,
                sort="OBSERVED_DESC",
            )
            assert page.total == 11
            assert len(page.items) == 10
            assert page.items[0].id == child.id
            assert [item.id for item in page.items[1:3]] == sorted(
                [legacy_observations[0].id, legacy_observations[1].id]
            )
            assert parent.id not in {item.id for item in page.items}
            current = page.items[0]
            assert current.query_text == manual_topic.canonical_question
            assert current.product.model_dump() == {
                "id": manual_product.id,
                "label": f"{manual_product.brand} {manual_product.part_number}",
            }
            assert current.geo_platform == "DeepSeek"
            assert current.outcomes.model_dump() == {
                "discovered": {"positive_count": 2, "assessed_count": 3, "total_count": 3},
                "mentioned": {"positive_count": 1, "assessed_count": 3, "total_count": 3},
                "accuracy": {"positive_count": 1, "assessed_count": 1, "total_count": 3},
            }
            assert current.related_achievement_count == 3
            assert current.evidence_count == 2
            assert current.recorder.id == actor.id
            assert current.available_actions == ["CORRECT", "DELETE"]

            second_page = list_geo_observation_items(
                db,
                filters=GeoObservationListFilters(),
                actor=actor,
                page=2,
                page_size=10,
                sort="OBSERVED_DESC",
            )
            assert second_page.total == 11
            assert len(second_page.items) == 1
            assert second_page.items[0].outcomes.discovered is None

            for filters in (
                GeoObservationListFilters(search="raw-special-query"),
                GeoObservationListFilters(search=manual_topic.canonical_question),
                GeoObservationListFilters(search=manual_product.part_number),
                GeoObservationListFilters(product_id=manual_product.id),
                GeoObservationListFilters(geo_platform="deepseek"),
                GeoObservationListFilters(accuracy="ACCURATE"),
                GeoObservationListFilters(date_from=datetime(2026, 8, 10, tzinfo=UTC).date()),
            ):
                filtered = list_geo_observation_items(
                    db,
                    filters=filters,
                    actor=actor,
                    page=1,
                    page_size=10,
                    sort="OBSERVED_ASC",
                )
                assert filtered.total == 1
                assert filtered.items[0].id == child.id

            legacy_filtered = list_geo_observation_items(
                db,
                filters=GeoObservationListFilters(
                    geo_platform="CHATGPT",
                    accuracy="PARTIAL",
                    product_id=legacy_product.id,
                ),
                actor=actor,
                page=1,
                page_size=10,
                sort="OBSERVED_DESC",
            )
            assert legacy_filtered.total == 10
            assert next(
                item.evidence_count
                for item in legacy_filtered.items
                if item.id == legacy_observations[0].id
            ) == 1
            assert legacy_filtered.items[0].available_actions == []

            actor.account_type = "ENGINEER"
            engineer_page = list_geo_observation_items(
                db,
                filters=GeoObservationListFilters(product_id=manual_product.id),
                actor=actor,
                page=1,
                page_size=10,
                sort="OBSERVED_DESC",
            )
            assert engineer_page.items[0].available_actions == ["CORRECT"]

            old_list = list_geo_observations(
                db,
                filters=GeoObservationFilters(product_id=manual_product.id),
                actor=actor,
                page=1,
                page_size=20,
                sort_order="DESC",
            )
            assert old_list.total == 1
            assert old_list.items[0].observation_kind == "MANUAL_ARTICLE_SEARCH"
            assert len(old_list.items[0].article_results) == 3

            assert _list_statement_count(
                engine,
                actor_id=actor.id,
                filters=GeoObservationListFilters(product_id=legacy_product.id),
            ) == _list_statement_count(
                engine,
                actor_id=actor.id,
                filters=GeoObservationListFilters(
                    product_id=legacy_product.id,
                    search="额外问题 0",
                ),
            )

            incomplete = GeoObservation(
                observation_kind="MANUAL_ARTICLE_SEARCH",
                query_topic_id=manual_topic.id,
                product_id=manual_product.id,
                search_platform="DeepSeek",
                search_query="缺少成果事实的观测",
                tested_at=datetime(2026, 8, 11, 8, tzinfo=UTC),
                notes="只用于验证 read model invariant",
                tested_by=actor.id,
            )
            db.add(incomplete)
            db.commit()
            with pytest.raises(AppError) as raised:
                list_geo_observation_items(
                    db,
                    filters=GeoObservationListFilters(product_id=manual_product.id),
                    actor=actor,
                    page=1,
                    page_size=10,
                    sort="OBSERVED_DESC",
                )
            assert raised.value.code == "GEO_OBSERVATION_CONTEXT_INCOMPLETE"
            assert raised.value.status_code == 409
