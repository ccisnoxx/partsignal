"""Product Detail 一致读投影与产品基本信息命令的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import app.routers.product_facts as product_routes
from app.db import get_db
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.models.configuration import QueryTopic
from app.models.content import ContentReviewRecord, ContentTask, ContentVersion
from app.models.geo_files import GeoObservation, GeoObservationPublication
from app.models.identity import AuditLog, User
from app.models.product_facts import FactReviewRecord, FactVersion, Product
from app.schemas.product_facts import ProductCreate, ProductUpdate
from app.services.product_detail import product_detail_out
from app.services.product_facts import create_product, update_product
from tests.integration.test_publication_workflow import (
    _complete_publication,
    _seed_graph,
    temporary_database,
)


def _statement_count(engine: Engine, product_id: uuid.UUID, actor_id: uuid.UUID) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with Session(engine, expire_on_commit=False) as db:
            actor = db.get(User, actor_id)
            assert actor is not None
            product_detail_out(db, product_id, actor=actor)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


@pytest.mark.integration
def test_product_detail_projects_compact_summaries_activity_and_fixed_query_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """详情一次形成摘要，Activity 已排序，查询次数不随关联行数增长。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            product = graph["product"]
            approved = graph["fact"]
            task = graph["task"]
            content = graph["content"]
            topic = graph["topic"]
            assert isinstance(actor, User)
            assert isinstance(product, Product)
            assert isinstance(approved, FactVersion)
            assert isinstance(task, ContentTask)
            assert isinstance(content, ContentVersion)
            assert isinstance(topic, QueryTopic)
            pending = FactVersion(
                product_id=product.id,
                version=2,
                status="CHANGES_REQUESTED",
                body_markdown="## 待修订事实",
                classification="INTERNAL",
                change_summary="补充参数来源",
                created_by=actor.id,
            )
            db.add(pending)
            db.flush()
            db.add_all(
                [
                    FactReviewRecord(
                        fact_version_id=pending.id,
                        action="request-changes",
                        comment="请补充参数来源",
                        actor_id=actor.id,
                    ),
                    ContentReviewRecord(
                        content_version_id=content.id,
                        action="approve",
                        comment="内容通过",
                        actor_id=actor.id,
                    ),
                ]
            )
            db.commit()
            work = _complete_publication(db, graph, suffix="product-detail")
            observation = GeoObservation(
                observation_kind="MANUAL_ARTICLE_SEARCH",
                query_topic_id=topic.id,
                product_id=product.id,
                search_platform="DeepSeek",
                search_query="PS 测试",
                tested_at=datetime.now(UTC),
                notes="人工核对",
                tested_by=actor.id,
            )
            db.add(observation)
            db.flush()
            db.add(
                GeoObservationPublication(
                    observation_id=observation.id,
                    published_article_id=work.id,
                    discovered=True,
                    mentioned=True,
                    accuracy="ACCURATE",
                )
            )
            db.commit()
            update_product(
                db=db,
                product_id=product.id,
                payload=ProductUpdate(
                    expected_revision=product.revision,
                    part_number=product.part_number,
                    brand=product.brand,
                    category=product.category,
                    status="ACTIVE",
                ),
                actor=actor,
                request_id="product-detail-update",
            )

            detail = product_detail_out(db, product.id, actor=actor)

            assert detail.approved_fact is not None
            assert detail.approved_fact.version == 1
            assert detail.pending_fact is not None
            assert detail.pending_fact.version == 2
            assert detail.content.task_count == 1
            assert detail.content.latest_task is not None
            assert detail.content.latest_task.task_id == task.id
            assert detail.publishing.published_article_count == 1
            assert detail.publishing.latest is not None
            assert detail.publishing.latest.article_id == work.id
            assert detail.geo.model_dump() == {
                "observation_count": 1,
                "article_result_count": 1,
                "discovery_rate": 1.0,
                "mention_rate": 1.0,
                "accuracy_rate": 1.0,
            }
            assert len(detail.activity) <= 10
            assert [item.timestamp for item in detail.activity] == sorted(
                (item.timestamp for item in detail.activity), reverse=True
            )
            assert {item.kind for item in detail.activity} >= {
                "PRODUCT",
                "FACT_REVIEW",
                "CONTENT_TASK",
                "CONTENT_REVIEW",
                "PUBLICATION",
                "GEO_OBSERVATION",
            }
            assert all(item.target.id and item.label for item in detail.activity)

        sparse_count = _statement_count(engine, product.id, actor.id)
        with Session(engine, expire_on_commit=False) as db:
            db.add_all(
                FactReviewRecord(
                    fact_version_id=pending.id,
                    action="request-changes",
                    comment=f"稳定排序 {index}",
                    actor_id=actor.id,
                    created_at=datetime.now(UTC) + timedelta(seconds=index),
                )
                for index in range(12)
            )
            db.commit()
        dense_count = _statement_count(engine, product.id, actor.id)
        assert dense_count == sparse_count

        captured: dict[str, str] = {}
        real_projection = product_routes.product_detail_out

        def inspected_projection(
            db: Session, product_id: uuid.UUID, *, actor: User
        ) -> object:
            captured["isolation"] = str(db.scalar(text("SHOW transaction_isolation")))
            return real_projection(db, product_id, actor=actor)

        monkeypatch.setattr(product_routes, "product_detail_out", inspected_projection)

        def database_session() -> Iterator[Session]:
            with Session(engine, expire_on_commit=False) as db:
                yield db

        app.dependency_overrides[get_db] = database_session
        app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(user=actor)
        try:
            response = TestClient(app).get(f"/api/v1/products/{product.id}/detail")
            missing = TestClient(app).get(f"/api/v1/products/{uuid.uuid4()}/detail")
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        assert captured["isolation"] == "repeatable read"
        assert missing.status_code == 404


@pytest.mark.integration
def test_product_update_maps_duplicate_and_writes_audit_only_on_success() -> None:
    """更新复用真实唯一约束，失败不追加成功审计。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            actor = User(
                username=f"product-detail-update-{uuid.uuid4().hex[:10]}",
                display_name="产品详情更新测试用户",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            db.add(actor)
            db.commit()
            first = create_product(
                db=db,
                payload=ProductCreate(part_number="PS-001", brand="PartSignal", category="MCU"),
                actor=actor,
                request_id="create-first",
            )
            second = create_product(
                db=db,
                payload=ProductCreate(part_number="PS-002", brand="PartSignal", category="MCU"),
                actor=actor,
                request_id="create-second",
            )
            updated = update_product(
                db=db,
                product_id=first.id,
                payload=ProductUpdate(
                    expected_revision=first.revision,
                    part_number=first.part_number,
                    brand=first.brand,
                    category="Processor",
                    status="ACTIVE",
                ),
                actor=actor,
                request_id="update-success",
            )
            assert updated.revision == 1
            db.add(
                FactVersion(
                    product_id=first.id,
                    version=1,
                    status="APPROVED",
                    body_markdown="## 已批准事实",
                    classification="PUBLIC",
                    change_summary="初次批准",
                    created_by=actor.id,
                    approved_at=datetime.now(UTC),
                )
            )
            db.commit()

            with pytest.raises(AppError) as immutable:
                update_product(
                    db=db,
                    product_id=first.id,
                    payload=ProductUpdate(
                        expected_revision=updated.revision,
                        part_number=first.part_number,
                        brand=first.brand,
                        category="不可原地修改的分类",
                        status="ACTIVE",
                    ),
                    actor=actor,
                    request_id="update-immutable",
                )
            assert immutable.value.code == "IMMUTABLE_VERSION"

            with pytest.raises(AppError) as raised:
                update_product(
                    db=db,
                    product_id=second.id,
                    payload=ProductUpdate(
                        expected_revision=second.revision,
                        part_number=first.part_number,
                        brand=first.brand,
                        category=second.category,
                        status="ACTIVE",
                    ),
                    actor=actor,
                    request_id="update-duplicate",
                )

            assert raised.value.code == "PRODUCT_ALREADY_EXISTS"
            assert db.scalar(
                select(func.count(AuditLog.id)).where(AuditLog.action == "product.updated")
            ) == 1
