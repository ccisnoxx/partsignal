"""Query Topic V2 列表与命令的 PostgreSQL 集成测试。"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.configuration import QueryTopic
from app.models.content import ContentTask, ContentTaskGeoSource
from app.models.geo_files import GeoObservation
from app.models.identity import AuditLog, User
from app.models.product_facts import Product
from app.schemas.configuration import QueryTopicCreate, QueryTopicListSort, QueryTopicUpdate
from app.services.content_planning import (
    create_query_topic,
    list_query_topic_items,
    update_query_topic,
)
from tests.integration.test_publication_workflow import _seed_graph, temporary_database


def _list_statement_count(engine: Engine, *, q: str | None) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with Session(engine) as db:
            list_query_topic_items(
                db=db,
                q=q,
                sort=QueryTopicListSort.QUESTION_ASC,
                page=1,
                page_size=10,
                can_delete=False,
            )
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


@pytest.mark.integration
def test_query_topic_list_is_server_filtered_paged_and_reference_authoritative() -> None:
    """列表批量投影搜索、分页、动作与三类业务引用。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            topic = graph["topic"]
            task = graph["task"]
            product = graph["product"]
            assert isinstance(actor, User)
            assert isinstance(topic, QueryTopic)
            assert isinstance(task, ContentTask)
            assert isinstance(product, Product)
            actor.account_type = "ADMIN"
            db.add_all(
                [
                    ContentTaskGeoSource(
                        content_task_id=task.id,
                        rule_code="QUESTION_COVERAGE_GAP",
                        date_from=date(2026, 8, 1),
                        date_to=date(2026, 8, 13),
                        query_topic_id=topic.id,
                        basis_snapshot={"source": "query-topic-list-test"},
                        created_by=actor.id,
                    ),
                    GeoObservation(
                        observation_kind="MANUAL_ARTICLE_SEARCH",
                        query_topic_id=topic.id,
                        product_id=product.id,
                        search_platform="测试搜索平台",
                        search_query=topic.canonical_question,
                        tested_at=datetime(2026, 8, 13, tzinfo=UTC),
                        notes="Query Topic 引用摘要测试",
                        tested_by=actor.id,
                    ),
                ]
            )
            db.add_all(
                QueryTopic(
                    canonical_question=f"分页问题 {index:02d}",
                    intent_type="PRODUCT",
                    variants=[f"分页变体 {index:02d}"],
                )
                for index in range(10)
            )
            db.commit()

            filtered = list_query_topic_items(
                db=db,
                q="测试器件选型",
                sort=QueryTopicListSort.QUESTION_ASC,
                page=1,
                page_size=10,
                can_delete=True,
            )
            assert filtered.total == 1
            assert filtered.items[0].id == topic.id
            assert filtered.items[0].primary_task == "USE_FOR_OBSERVATION"
            assert filtered.items[0].available_actions == ["UPDATE"]
            assert filtered.items[0].references.model_dump() == {
                "content_task_count": 1,
                "geo_optimization_count": 1,
                "observation_count": 1,
            }
            assert filtered.items[0].deletion is not None
            assert [blocker.type for blocker in filtered.items[0].deletion.blockers] == [
                "CONTENT_TASK",
                "GEO_OPTIMIZATION_SOURCE",
                "GEO_OBSERVATION",
            ]

            engineer_page = list_query_topic_items(
                db=db,
                q="如何选择测试器件",
                sort=QueryTopicListSort.QUESTION_ASC,
                page=1,
                page_size=10,
                can_delete=False,
            )
            assert engineer_page.items[0].references == filtered.items[0].references
            assert engineer_page.items[0].deletion is None
            assert engineer_page.items[0].available_actions == ["UPDATE"]

            second_page = list_query_topic_items(
                db=db,
                q=None,
                sort=QueryTopicListSort.QUESTION_DESC,
                page=2,
                page_size=10,
                can_delete=False,
            )
            assert second_page.total == 11
            assert len(second_page.items) == 1
            assert _list_statement_count(engine, q=None) == _list_statement_count(
                engine, q="分页变体"
            )


@pytest.mark.integration
def test_query_topic_create_update_audit_and_revision_conflict() -> None:
    """创建与更新写审计，revision 冲突不覆盖 canonical 数据。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            assert isinstance(actor, User)

            topic = create_query_topic(
                db=db,
                payload=QueryTopicCreate(
                    canonical_question="  如何验证 Query Topic？  ",
                    intent_type="TROUBLESHOOTING",
                    variants=["  Query Topic 验证  "],
                ),
                actor=actor,
                request_id="query-topic-create",
            )
            assert topic.canonical_question == "如何验证 Query Topic？"
            assert topic.variants == ["Query Topic 验证"]
            assert db.scalar(
                select(AuditLog).where(
                    AuditLog.action == "query_topic.created",
                    AuditLog.target_id == str(topic.id),
                )
            ) is not None

            original_revision = topic.revision
            with pytest.raises(AppError) as conflict:
                update_query_topic(
                    db=db,
                    query_topic_id=topic.id,
                    payload=QueryTopicUpdate(
                        canonical_question="不应覆盖的问题",
                        intent_type="PRODUCT",
                        variants=["不应覆盖的变体"],
                        expected_revision=original_revision + 1,
                    ),
                    actor=actor,
                    request_id="query-topic-conflict",
                )
            assert conflict.value.code == "REVISION_CONFLICT"
            assert topic.canonical_question == "如何验证 Query Topic？"

            updated = update_query_topic(
                db=db,
                query_topic_id=topic.id,
                payload=QueryTopicUpdate(
                    canonical_question="如何更新 Query Topic？",
                    intent_type="TROUBLESHOOTING",
                    variants=["Query Topic 更新"],
                    expected_revision=original_revision,
                ),
                actor=actor,
                request_id="query-topic-update",
            )
            assert updated.revision == original_revision + 1
            audit = db.scalar(
                select(AuditLog).where(
                    AuditLog.action == "query_topic.updated",
                    AuditLog.target_id == str(topic.id),
                )
            )
            assert audit is not None
            assert audit.details == {"facts": {"revision": updated.revision}}
