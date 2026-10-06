"""Frontend V2 Workbench 聚合读模型的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import app.routers.workbench as workbench_routes
from app.db import get_db
from app.deps import get_current_session
from app.main import app
from app.models.configuration import QueryTopic
from app.models.content import ContentTask, ContentVersion
from app.models.geo_files import GeoObservation, GeoObservationPublication
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.models.publication import PublicationWork, PublishedContentIssue
from app.schemas.publication import (
    PublicationPlatformReviewRequest,
    PublicationResultUpdate,
    PublicationVerificationCreate,
    PublicationWorkCreate,
)
from app.services.publication import (
    create_publication_work,
    mark_publication_platform_review,
    register_publication_result,
    verify_publication_work,
)
from app.services.workbench import get_workbench_aggregate
from tests.integration.test_publication_workflow import (
    _complete_publication,
    _seed_graph,
    temporary_database,
)


def _database_session(engine: Engine) -> Iterator[Session]:
    with Session(engine, expire_on_commit=False) as db:
        yield db


def _create_work(
    db: Session,
    graph: dict[str, object],
    *,
    suffix: str,
    target_status: str,
) -> PublicationWork:
    actor = graph["user"]
    content = graph["content"]
    account = graph["account"]
    assert isinstance(actor, User)
    assert isinstance(content, ContentVersion)
    work = create_publication_work(
        db=db,
        payload=PublicationWorkCreate(
            content_version_id=content.id,
            platform_account_id=account.id,  # type: ignore[union-attr]
        ),
        actor=actor,
        request_id=f"workbench-{suffix}-create",
        idempotency_key=f"workbench-{suffix}-key",
    )
    if target_status == "PREPARING":
        return work
    if target_status == "PLATFORM_REVIEW":
        return mark_publication_platform_review(
            db=db,
            work_id=work.id,
            payload=PublicationPlatformReviewRequest(
                expected_revision=work.revision,
                comment="进入平台处理",
            ),
            actor=actor,
            request_id=f"workbench-{suffix}-platform-review",
        )
    work = register_publication_result(
        db=db,
        work_id=work.id,
        payload=PublicationResultUpdate(
            actual_title=f"Workbench 发布结果 {suffix}",
            final_url=f"https://community.example.invalid/workbench/{suffix}",
            published_at=datetime.now(UTC),
            expected_revision=work.revision,
            comment="登记 Workbench 测试结果",
        ),
        actor=actor,
        request_id=f"workbench-{suffix}-result",
    )
    if target_status == "AWAITING_VERIFICATION":
        return work
    assert target_status == "ACTION_REQUIRED"
    verify_publication_work(
        db=db,
        work_id=work.id,
        payload=PublicationVerificationCreate(
            outcome="FAILED",
            content_matches=False,
            expected_revision=work.revision,
            comment="结果需要修正",
        ),
        actor=actor,
        request_id=f"workbench-{suffix}-verify",
    )
    persisted = db.get(PublicationWork, work.id)
    assert persisted is not None
    return persisted


def _statement_count(engine: Engine) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    with Session(engine, expire_on_commit=False) as db:
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        event.listen(engine, "before_cursor_execute", record_statement)
        try:
            get_workbench_aggregate(db)
        finally:
            event.remove(engine, "before_cursor_execute", record_statement)
    return count


@pytest.mark.integration
def test_workbench_endpoint_is_authenticated_role_shared_and_repeatable_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """两类业务角色共用同一聚合，匿名拒绝且读取在一致快照内完成。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            actor = User(
                username=f"workbench-{uuid.uuid4().hex[:10]}",
                display_name="Workbench 测试用户",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            db.add(actor)
            db.commit()

        captured: list[str] = []
        real_projection = workbench_routes.get_workbench_aggregate

        def inspected_projection(db: Session) -> object:
            captured.append(str(db.scalar(text("SHOW transaction_isolation"))))
            return real_projection(db)

        monkeypatch.setattr(
            workbench_routes,
            "get_workbench_aggregate",
            inspected_projection,
        )
        def database_session() -> Iterator[Session]:
            yield from _database_session(engine)

        app.dependency_overrides[get_db] = database_session
        app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(user=actor)
        try:
            client = TestClient(app)
            engineer = client.get("/api/v1/workbench")
            actor.account_type = "ADMIN"
            admin = client.get("/api/v1/workbench")
            app.dependency_overrides.pop(get_current_session)
            anonymous = TestClient(app).get("/api/v1/workbench")
        finally:
            app.dependency_overrides.clear()

        assert engineer.status_code == admin.status_code == 200
        engineer_payload = engineer.json()
        admin_payload = admin.json()
        engineer_payload.pop("generated_at")
        admin_payload.pop("generated_at")
        assert engineer_payload == admin_payload
        assert captured == ["repeatable read", "repeatable read"]
        assert anonymous.status_code == 401
        payload = engineer.json()
        assert payload["recent_attention_items"] == []
        assert payload["geo_summary"]["discovery_rate"] == {
            "numerator": 0,
            "denominator": 0,
            "value": None,
        }
        assert all(
            item["status"] == "CLEAR"
            for item in payload["workflow_health"].values()
        )


@pytest.mark.integration
def test_workbench_projects_counts_rates_current_tails_and_safe_attention() -> None:
    """六类行动、链尾比率、稳定链接和安全摘要全部由服务端投影。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graphs = [
                _seed_graph(db, content_hash=f"{index:x}" * 64)
                for index in range(1, 9)
            ]
            fact_graph, content_graph = graphs[:2]
            fact_actor = fact_graph["user"]
            fact_product = fact_graph["product"]
            fact_task = fact_graph["task"]
            fact_content_fact = fact_graph["fact"]
            content_actor = content_graph["user"]
            content_task = content_graph["task"]
            content_fact = content_graph["fact"]
            assert isinstance(fact_actor, User)
            assert isinstance(fact_product, Product)
            assert isinstance(fact_task, ContentTask)
            assert isinstance(fact_content_fact, FactVersion)
            assert isinstance(content_actor, User)
            assert isinstance(content_task, ContentTask)
            assert isinstance(content_fact, FactVersion)
            db.add(
                FactVersion(
                    product_id=fact_product.id,
                    version=2,
                    status="PENDING_REVIEW",
                    body_markdown="PRIVATE_FACT_BODY",
                    classification="INTERNAL",
                    change_summary="待审核事实",
                    created_by=fact_actor.id,
                )
            )
            current_pending = ContentVersion(
                task_id=content_task.id,
                fact_version_id=content_fact.id,
                version=2,
                source_type="HUMAN",
                title="Workbench 待审核内容",
                summary="PRIVATE_CONTENT_SUMMARY",
                body_markdown="PRIVATE_CONTENT_BODY",
                tags=["Workbench"],
                content_hash="8" * 64,
                status="PENDING_REVIEW",
                quality_issues=[],
                change_summary="提交 Workbench 审核",
                created_by=content_actor.id,
            )
            noncurrent_pending = ContentVersion(
                task_id=fact_task.id,
                fact_version_id=fact_content_fact.id,
                version=2,
                source_type="HUMAN",
                title="不应进入 Workbench 的非当前内容",
                summary="非当前版本",
                body_markdown="非当前版本",
                tags=["Workbench"],
                content_hash="9" * 64,
                status="PENDING_REVIEW",
                quality_issues=[],
                change_summary="验证 current owner",
                created_by=fact_actor.id,
            )
            db.add_all([current_pending, noncurrent_pending])
            db.flush()
            content_task.current_content_version_id = current_pending.id
            db.commit()

            _create_work(db, graphs[2], suffix="preparing", target_status="PREPARING")
            _create_work(
                db,
                graphs[3],
                suffix="platform-review",
                target_status="PLATFORM_REVIEW",
            )
            _create_work(
                db,
                graphs[4],
                suffix="awaiting",
                target_status="AWAITING_VERIFICATION",
            )
            _create_work(
                db,
                graphs[5],
                suffix="action-required",
                target_status="ACTION_REQUIRED",
            )
            issue_article = _complete_publication(db, graphs[6], suffix="workbench-issue")
            issue_actor = graphs[6]["user"]
            assert isinstance(issue_actor, User)
            db.add(
                PublishedContentIssue(
                    published_article_id=issue_article.id,
                    kind="CONTENT_CHANGED",
                    description="PRIVATE_ISSUE_DESCRIPTION",
                    opened_by=issue_actor.id,
                )
            )

            geo_article = _complete_publication(db, graphs[7], suffix="workbench-geo")
            geo_actor = graphs[7]["user"]
            product = graphs[7]["product"]
            topic = graphs[7]["topic"]
            assert isinstance(geo_actor, User)
            assert isinstance(product, Product)
            now = datetime.now(UTC)
            parent = GeoObservation(
                observation_kind="MANUAL_ARTICLE_SEARCH",
                query_topic_id=topic.id,  # type: ignore[union-attr]
                product_id=product.id,
                search_platform="Perplexity",
                search_query="已纠正的旧搜索",
                tested_at=now - timedelta(days=4),
                notes="PRIVATE_PARENT_NOTES",
                tested_by=geo_actor.id,
            )
            current_bad = GeoObservation(
                observation_kind="MANUAL_ARTICLE_SEARCH",
                query_topic_id=topic.id,  # type: ignore[union-attr]
                product_id=product.id,
                search_platform="DeepSeek",
                search_query="当前不准确搜索",
                tested_at=now - timedelta(days=3),
                notes="PRIVATE_BAD_NOTES",
                tested_by=geo_actor.id,
            )
            current_unjudgeable = GeoObservation(
                observation_kind="MANUAL_ARTICLE_SEARCH",
                query_topic_id=topic.id,  # type: ignore[union-attr]
                product_id=product.id,
                search_platform="Gemini",
                search_query="当前未判断搜索",
                tested_at=now - timedelta(days=2),
                notes="PRIVATE_UNJUDGEABLE_NOTES",
                tested_by=geo_actor.id,
            )
            legacy_bad = GeoObservation(
                observation_kind="LEGACY_MODEL_RESULT",
                query_topic_id=topic.id,  # type: ignore[union-attr]
                product_id=product.id,
                actual_prompt="PRIVATE_LEGACY_PROMPT",
                model_name="Legacy Model",
                tested_at=now - timedelta(days=1),
                web_search_enabled=True,
                answer_summary="PRIVATE_LEGACY_ANSWER",
                mentioned=True,
                recommendation="NONE",
                accuracy="INCORRECT",
                notes="PRIVATE_LEGACY_NOTES",
                tested_by=geo_actor.id,
            )
            legacy_outside_window = GeoObservation(
                observation_kind="LEGACY_MODEL_RESULT",
                query_topic_id=topic.id,  # type: ignore[union-attr]
                product_id=product.id,
                actual_prompt="OUTSIDE_WINDOW_PROMPT",
                model_name="Old Model",
                tested_at=now - timedelta(days=30),
                web_search_enabled=True,
                answer_summary="OUTSIDE_WINDOW_ANSWER",
                mentioned=True,
                recommendation="NONE",
                accuracy="PARTIAL",
                notes="OUTSIDE_WINDOW_NOTES",
                tested_by=geo_actor.id,
            )
            db.add_all(
                [parent, current_bad, current_unjudgeable, legacy_bad, legacy_outside_window]
            )
            db.flush()
            corrected = GeoObservation(
                observation_kind="MANUAL_ARTICLE_SEARCH",
                query_topic_id=topic.id,  # type: ignore[union-attr]
                product_id=product.id,
                search_platform=parent.search_platform,
                search_query=parent.search_query,
                tested_at=now - timedelta(hours=12),
                notes="PRIVATE_CORRECTED_NOTES",
                supersedes_id=parent.id,
                tested_by=geo_actor.id,
            )
            db.add(corrected)
            db.flush()
            db.add_all(
                [
                    GeoObservationPublication(
                        observation_id=parent.id,
                        published_article_id=geo_article.id,
                        discovered=False,
                        mentioned=False,
                        accuracy="INCORRECT",
                    ),
                    GeoObservationPublication(
                        observation_id=corrected.id,
                        published_article_id=geo_article.id,
                        discovered=True,
                        mentioned=True,
                        accuracy="ACCURATE",
                    ),
                    GeoObservationPublication(
                        observation_id=current_bad.id,
                        published_article_id=geo_article.id,
                        discovered=True,
                        mentioned=False,
                        accuracy="PARTIAL",
                    ),
                    GeoObservationPublication(
                        observation_id=current_unjudgeable.id,
                        published_article_id=geo_article.id,
                        discovered=False,
                        mentioned=True,
                        accuracy="UNJUDGEABLE",
                    ),
                ]
            )
            db.commit()
            db.connection(execution_options={"isolation_level": "REPEATABLE READ"})

            aggregate = get_workbench_aggregate(db)

        counts = aggregate.actionable_counts
        assert counts.fact_reviews.value == 1
        assert counts.content_reviews.value == 1
        assert counts.publication_verifications.value == 1
        assert counts.publication_actions.value == 3
        assert counts.content_issues.value == 1
        assert counts.geo_accuracy_issues.value == 2
        assert counts.fact_reviews.href.endswith("workflowStage=FACT_REVIEW_PENDING")
        assert [link.label for link in counts.publication_actions.links] == [
            "继续准备",
            "平台处理中",
            "需要处理",
        ]
        assert aggregate.geo_summary.discovery_rate.model_dump() == {
            "numerator": 2,
            "denominator": 3,
            "value": 2 / 3,
        }
        assert aggregate.geo_summary.mention_rate.model_dump() == {
            "numerator": 2,
            "denominator": 3,
            "value": 2 / 3,
        }
        assert aggregate.geo_summary.accuracy_rate.model_dump() == {
            "numerator": 1,
            "denominator": 2,
            "value": 0.5,
        }
        assert len(aggregate.recent_attention_items) == 9
        assert {item.category for item in aggregate.recent_attention_items} == {
            "FACT_REVIEW",
            "CONTENT_REVIEW",
            "PUBLICATION_VERIFICATION",
            "PUBLICATION_ACTION",
            "CONTENT_ISSUE",
            "GEO_ACCURACY_ISSUE",
        }
        ordering = [
            (-item.occurred_at.timestamp(), item.category, str(item.resource_id))
            for item in aggregate.recent_attention_items
        ]
        assert ordering == sorted(ordering)
        encoded = aggregate.model_dump_json()
        for sensitive in (
            "PRIVATE_FACT_BODY",
            "PRIVATE_CONTENT_SUMMARY",
            "PRIVATE_CONTENT_BODY",
            "PRIVATE_ISSUE_DESCRIPTION",
            "PRIVATE_PARENT_NOTES",
            "PRIVATE_BAD_NOTES",
            "PRIVATE_UNJUDGEABLE_NOTES",
            "PRIVATE_LEGACY_PROMPT",
            "PRIVATE_LEGACY_ANSWER",
            "PRIVATE_LEGACY_NOTES",
            "PRIVATE_CORRECTED_NOTES",
        ):
            assert sensitive not in encoded


@pytest.mark.integration
def test_workbench_query_count_does_not_grow_with_attention_rows() -> None:
    """空集合与密集候选执行相同次数查询，不产生逐项读取。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        sparse_count = _statement_count(engine)
        with Session(engine, expire_on_commit=False) as db:
            actor = User(
                username=f"workbench-dense-{uuid.uuid4().hex[:10]}",
                display_name="Workbench 密集数据用户",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            db.add(actor)
            db.flush()
            topic = QueryTopic(
                canonical_question="密集观测查询次数测试",
                intent_type="PRODUCT",
                variants=[],
            )
            db.add(topic)
            db.flush()
            for index in range(12):
                product = Product(
                    part_number=f"WB-{index:02d}",
                    normalized_part_number=f"wb-{uuid.uuid4().hex}",
                    brand="PartSignal",
                    normalized_brand=f"partsignal-{uuid.uuid4().hex}",
                    category="Test",
                )
                db.add(product)
                db.flush()
                db.add(
                    FactVersion(
                        product_id=product.id,
                        version=1,
                        status="PENDING_REVIEW",
                        body_markdown=f"密集事实 {index}",
                        classification="INTERNAL",
                        change_summary="查询次数测试",
                        created_by=actor.id,
                    )
                )
                db.add(
                    GeoObservation(
                        observation_kind="LEGACY_MODEL_RESULT",
                        query_topic_id=topic.id,
                        product_id=product.id,
                        actual_prompt=f"密集观测 {index}",
                        model_name="Dense Model",
                        tested_at=datetime.now(UTC),
                        web_search_enabled=True,
                        answer_summary="查询次数测试",
                        mentioned=False,
                        recommendation="NONE",
                        accuracy="INCORRECT",
                        notes="",
                        tested_by=actor.id,
                    )
                )
            db.commit()
        dense_count = _statement_count(engine)

        assert sparse_count == dense_count == 7
        with Session(engine, expire_on_commit=False) as db:
            db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
            assert len(get_workbench_aggregate(db).recent_attention_items) == 10
