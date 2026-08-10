"""Product Detail、Product Facts 读投影与产品基本信息命令的 PostgreSQL 集成测试。"""

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
from app.schemas.product_facts import (
    FactReviewSubmissionRequest,
    ProductCreate,
    ProductFactsDraftUpdate,
    ProductUpdate,
)
from app.security import hash_token
from app.services.product_detail import product_detail_out
from app.services.product_facts import (
    create_product,
    product_facts_draft_out,
    replace_product_facts,
    submit_fact_review,
    update_product,
)
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


def _facts_statement_count(engine: Engine, product_id: uuid.UUID) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with Session(engine, expire_on_commit=False) as db:
            product = db.get(Product, product_id)
            assert product is not None
            product_facts_draft_out(db, product)
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


@pytest.mark.integration
def test_fact_workspace_read_model_uses_one_snapshot_and_fixed_query_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """事实工作台在同一 repeatable-read 中返回上下文、版本与动作。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            actor = User(
                username=f"fact-workspace-read-{uuid.uuid4().hex[:10]}",
                display_name="事实工作台读取用户",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            product = Product(
                part_number="PS-READ",
                normalized_part_number=uuid.uuid4().hex,
                brand="PartSignal",
                normalized_brand=f"partsignal-{uuid.uuid4().hex[:8]}",
                category="MCU",
                facts_body_markdown="## 当前事实",
                facts_classification="INTERNAL",
                facts_revision=3,
            )
            db.add_all([actor, product])
            db.flush()
            db.add(
                FactVersion(
                    product_id=product.id,
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
            product_id = product.id
            actor_id = actor.id

        sparse_count = _facts_statement_count(engine, product_id)
        with Session(engine, expire_on_commit=False) as db:
            db.add_all(
                FactVersion(
                    product_id=product_id,
                    version=version,
                    status="RETIRED",
                    body_markdown=f"## 历史事实 {version}",
                    classification="PUBLIC",
                    change_summary="历史版本",
                    created_by=actor_id,
                )
                for version in range(2, 8)
            )
            db.commit()
        assert _facts_statement_count(engine, product_id) == sparse_count

        captured: dict[str, str] = {}
        real_projection = product_routes.product_facts_draft_out

        def inspected_projection(db: Session, product: Product) -> object:
            captured["isolation"] = str(db.scalar(text("SHOW transaction_isolation")))
            return real_projection(db, product)

        monkeypatch.setattr(product_routes, "product_facts_draft_out", inspected_projection)

        def database_session() -> Iterator[Session]:
            with Session(engine, expire_on_commit=False) as db:
                yield db

        with Session(engine, expire_on_commit=False) as db:
            actor = db.get(User, actor_id)
            assert actor is not None
        app.dependency_overrides[get_db] = database_session
        app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(user=actor)
        try:
            response = TestClient(app).get(f"/api/v1/products/{product_id}/facts")
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        payload = response.json()
        assert payload["product"]["part_number"] == "PS-READ"
        assert payload["approved_fact"] == {"version": 1, "status": "APPROVED"}
        assert payload["revision"] == 3
        assert captured["isolation"] == "repeatable read"


@pytest.mark.integration
def test_fact_history_returns_narrow_server_ordered_page_and_product_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """事实历史按服务端版本顺序分页，且不泄漏详情动作字段。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            actor = User(
                username=f"fact-history-{uuid.uuid4().hex[:10]}",
                display_name="事实历史读取用户",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            product = Product(
                part_number="PS-HISTORY",
                normalized_part_number=uuid.uuid4().hex,
                brand="PartSignal",
                normalized_brand=f"partsignal-{uuid.uuid4().hex[:8]}",
                category="MCU",
                facts_body_markdown="## 当前事实",
                facts_classification="INTERNAL",
            )
            db.add_all([actor, product])
            db.flush()
            db.add_all(
                FactVersion(
                    product_id=product.id,
                    version=version,
                    status="RETIRED",
                    body_markdown=f"## 不应进入列表 {version}",
                    classification="PUBLIC",
                    change_summary=f"历史版本 {version}",
                    created_by=actor.id,
                    created_at=datetime.now(UTC) + timedelta(seconds=version),
                )
                for version in range(1, 13)
            )
            db.commit()
            product_id = product.id

        captured: dict[str, str] = {}
        real_query = product_routes.list_product_fact_history_query

        def inspected_query(**kwargs: object) -> object:
            db = kwargs["db"]
            assert isinstance(db, Session)
            captured["isolation"] = str(db.scalar(text("SHOW transaction_isolation")))
            return real_query(**kwargs)

        monkeypatch.setattr(
            product_routes,
            "list_product_fact_history_query",
            inspected_query,
        )

        def database_session() -> Iterator[Session]:
            with Session(engine, expire_on_commit=False) as db:
                yield db

        app.dependency_overrides[get_db] = database_session
        app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(user=actor)
        try:
            response = TestClient(app).get(
                f"/api/v1/products/{product_id}/fact-history?page=2&page_size=10"
            )
            missing = TestClient(app).get(
                f"/api/v1/products/{uuid.uuid4()}/fact-history?page=1&page_size=20"
            )
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        payload = response.json()
        assert payload["product"]["id"] == str(product_id)
        assert payload["product"]["part_number"] == "PS-HISTORY"
        assert [item["version"] for item in payload["items"]] == [2, 1]
        assert payload["page"] == 2
        assert payload["page_size"] == 10
        assert payload["total"] == 12
        assert set(payload["items"][0]) == {
            "id",
            "product_id",
            "version",
            "status",
            "classification",
            "change_summary",
            "created_by",
            "created_at",
        }
        assert captured["isolation"] == "repeatable read"
        assert missing.status_code == 404


@pytest.mark.integration
def test_fact_review_context_locates_target_and_commands_refresh_canonical_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """产品级审核上下文定位唯一目标，命令保留 revision 与精确历史边界。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        csrf_token = "fact-review-csrf-token-more-than-32-characters"
        with Session(engine, expire_on_commit=False) as db:
            actor = User(
                username=f"fact-review-{uuid.uuid4().hex[:10]}",
                display_name="事实审核测试用户",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            product = Product(
                part_number="PS-REVIEW",
                normalized_part_number=uuid.uuid4().hex,
                brand="PartSignal",
                normalized_brand=f"partsignal-{uuid.uuid4().hex[:8]}",
                category="MCU",
                facts_body_markdown="# 当前事实\n\n新参数",
                facts_classification="PUBLIC",
            )
            empty_product = Product(
                part_number="PS-EMPTY-REVIEW",
                normalized_part_number=uuid.uuid4().hex,
                brand="PartSignal",
                normalized_brand=f"partsignal-{uuid.uuid4().hex[:8]}",
                category="MCU",
            )
            db.add_all([actor, product, empty_product])
            db.flush()
            previous = FactVersion(
                product_id=product.id,
                version=1,
                status="CHANGES_REQUESTED",
                body_markdown="# 当前事实\n\n旧参数",
                classification="PUBLIC",
                change_summary="初次提交",
                created_by=actor.id,
            )
            db.add(previous)
            db.flush()
            db.add(
                FactReviewRecord(
                    fact_version_id=previous.id,
                    action="request-changes",
                    comment="旧版本意见",
                    actor_id=actor.id,
                )
            )
            db.commit()
            target = submit_fact_review(
                db=db,
                product_id=product.id,
                payload=FactReviewSubmissionRequest(
                    expected_revision=product.facts_revision,
                    change_summary="修订参数",
                ),
                actor=actor,
                request_id="fact-review-submit",
            )
            actor_id = actor.id
            product_id = product.id
            empty_product_id = empty_product.id
            target_id = target.id

        captured: dict[str, str] = {}
        real_projection = product_routes.get_product_fact_review_context

        def inspected_projection(
            db: Session, product_id: uuid.UUID, *, can_delete: bool
        ) -> object:
            captured["isolation"] = str(db.scalar(text("SHOW transaction_isolation")))
            return real_projection(db, product_id, can_delete=can_delete)

        monkeypatch.setattr(
            product_routes,
            "get_product_fact_review_context",
            inspected_projection,
        )

        def database_session() -> Iterator[Session]:
            with Session(engine, expire_on_commit=False) as db:
                yield db

        with Session(engine, expire_on_commit=False) as db:
            actor = db.get(User, actor_id)
            assert actor is not None
        current_session = SimpleNamespace(user=actor, csrf_hash=hash_token(csrf_token))
        app.dependency_overrides[get_db] = database_session
        app.dependency_overrides[get_current_session] = lambda: current_session
        client = TestClient(app)
        try:
            response = client.get(f"/api/v1/products/{product_id}/fact-review-context")
            empty = client.get(
                f"/api/v1/products/{empty_product_id}/fact-review-context"
            )
            missing = client.get(
                f"/api/v1/products/{uuid.uuid4()}/fact-review-context"
            )
            blank = client.post(
                f"/api/v1/fact-versions/{target_id}/request-changes",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": 0, "comment": "   "},
            )
            stale = client.post(
                f"/api/v1/fact-versions/{target_id}/approve",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": 99, "comment": ""},
            )
            returned = client.post(
                f"/api/v1/fact-versions/{target_id}/request-changes",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": 0, "comment": "  请补充条件  "},
            )

            with Session(engine, expire_on_commit=False) as db:
                actor = db.get(User, actor_id)
                assert actor is not None
                workspace = replace_product_facts(
                    db=db,
                    product_id=product_id,
                    payload=ProductFactsDraftUpdate(
                        expected_revision=0,
                        body_markdown="# 当前事实\n\n最终参数",
                        classification="PUBLIC",
                    ),
                    actor=actor,
                    request_id="fact-review-revise",
                )
                approved_target = submit_fact_review(
                    db=db,
                    product_id=product_id,
                    payload=FactReviewSubmissionRequest(
                        expected_revision=workspace.revision,
                        change_summary="最终修订",
                    ),
                    actor=actor,
                    request_id="fact-review-resubmit",
                )
                approved_target_id = approved_target.id

            approved = client.post(
                f"/api/v1/fact-versions/{approved_target_id}/approve",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": 0, "comment": "审核通过"},
            )
            refreshed = client.get(
                f"/api/v1/products/{product_id}/fact-review-context"
            )
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        payload = response.json()
        assert payload["review"]["fact_version"]["id"] == str(target_id)
        assert payload["review"]["available_actions"] == ["APPROVE", "REQUEST_CHANGES"]
        assert payload["review"]["diff"]["left_id"] == str(previous.id)
        assert payload["review"]["diff"]["right_id"] == str(target_id)
        assert [item["comment"] for item in payload["review"]["review_history"]] == [
            "修订参数"
        ]
        assert captured["isolation"] == "repeatable read"
        assert empty.status_code == 200
        assert empty.json()["review"] is None
        assert missing.status_code == 404
        assert blank.status_code == 422
        assert blank.json()["error"]["code"] == "VALIDATION_ERROR"
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "REVISION_CONFLICT"
        assert returned.status_code == 200
        assert returned.json()["status"] == "CHANGES_REQUESTED"
        assert returned.json()["revision"] == 1
        assert approved.status_code == 200
        assert approved.json()["status"] == "APPROVED"
        assert refreshed.status_code == 200
        refreshed_review = refreshed.json()["review"]
        assert refreshed_review["fact_version"]["id"] == str(approved_target_id)
        assert refreshed_review["available_actions"] == []
        assert [item["action"] for item in refreshed_review["review_history"]] == [
            "submit-review",
            "approve",
        ]


@pytest.mark.integration
def test_fact_workspace_commands_preserve_conflicts_and_immutable_snapshot() -> None:
    """保存与提交复核 revision，待审核快照不随后续工作区修改。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            actor = User(
                username=f"fact-workspace-write-{uuid.uuid4().hex[:10]}",
                display_name="事实工作台写入用户",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            product = Product(
                part_number="PS-WRITE",
                normalized_part_number=uuid.uuid4().hex,
                brand="PartSignal",
                normalized_brand=f"partsignal-{uuid.uuid4().hex[:8]}",
                category="MCU",
            )
            db.add_all([actor, product])
            db.commit()

            saved = replace_product_facts(
                db=db,
                product_id=product.id,
                payload=ProductFactsDraftUpdate(
                    expected_revision=0,
                    body_markdown="## 已保存事实\n\n原样内容。",
                    classification="INTERNAL",
                ),
                actor=actor,
                request_id="fact-workspace-save",
            )
            assert saved.revision == 1
            assert saved.body_markdown == "## 已保存事实\n\n原样内容。"
            assert saved.available_actions == ["SAVE", "SUBMIT_REVIEW"]

            with pytest.raises(AppError) as stale_save:
                replace_product_facts(
                    db=db,
                    product_id=product.id,
                    payload=ProductFactsDraftUpdate(
                        expected_revision=0,
                        body_markdown="## 过期保存",
                        classification="PUBLIC",
                    ),
                    actor=actor,
                    request_id="fact-workspace-stale-save",
                )
            assert stale_save.value.code == "REVISION_CONFLICT"
            db.rollback()

            with pytest.raises(AppError) as stale_submit:
                submit_fact_review(
                    db=db,
                    product_id=product.id,
                    payload=FactReviewSubmissionRequest(
                        expected_revision=0,
                        change_summary="过期提交",
                    ),
                    actor=actor,
                    request_id="fact-workspace-stale-submit",
                )
            assert stale_submit.value.code == "REVISION_CONFLICT"
            db.rollback()

            snapshot = submit_fact_review(
                db=db,
                product_id=product.id,
                payload=FactReviewSubmissionRequest(
                    expected_revision=1,
                    change_summary="提交已保存事实",
                ),
                actor=actor,
                request_id="fact-workspace-submit",
            )
            assert snapshot.status == "PENDING_REVIEW"
            assert snapshot.body_markdown == saved.body_markdown
            assert snapshot.classification == saved.classification.value

            revised = replace_product_facts(
                db=db,
                product_id=product.id,
                payload=ProductFactsDraftUpdate(
                    expected_revision=1,
                    body_markdown="## 提交后的工作区修改",
                    classification="RESTRICTED",
                ),
                actor=actor,
                request_id="fact-workspace-save-after-submit",
            )
            assert revised.revision == 2
            assert revised.available_actions == ["SAVE"]
            db.refresh(snapshot)
            assert snapshot.body_markdown == "## 已保存事实\n\n原样内容。"
            assert snapshot.classification == "INTERNAL"

            product.status = "RETIRED"
            db.commit()
            with pytest.raises(AppError) as retired_save:
                replace_product_facts(
                    db=db,
                    product_id=product.id,
                    payload=ProductFactsDraftUpdate(
                        expected_revision=2,
                        body_markdown="## 不应保存",
                        classification="PUBLIC",
                    ),
                    actor=actor,
                    request_id="fact-workspace-retired-save",
                )
            assert retired_save.value.code == "INVALID_STATE_TRANSITION"
            db.rollback()
            with pytest.raises(AppError) as retired_submit:
                submit_fact_review(
                    db=db,
                    product_id=product.id,
                    payload=FactReviewSubmissionRequest(
                        expected_revision=2,
                        change_summary="不应提交",
                    ),
                    actor=actor,
                    request_id="fact-workspace-retired-submit",
                )
            assert retired_submit.value.code == "INVALID_STATE_TRANSITION"
