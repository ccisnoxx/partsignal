"""Content Version Detail 紧凑只读投影的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import app.routers.production as production_routes
from app.db import get_db
from app.deps import get_current_session
from app.main import app
from app.models.content import ContentVersion
from app.models.identity import User
from app.security import hash_token
from app.services.content_version_detail import get_content_version_detail
from tests.integration.test_content_review import _seed_pending_review
from tests.integration.test_publication_workflow import _seed_graph, temporary_database


def _client(engine: Engine, actor: User) -> TestClient:
    def database_session() -> Iterator[Session]:
        with Session(engine, expire_on_commit=False) as db:
            yield db

    app.dependency_overrides[get_db] = database_session
    app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
        user=actor,
        csrf_hash=hash_token("content-version-detail-csrf-token-over-32-characters"),
    )
    return TestClient(app)


def _statement_count(engine: Engine, content_version_id: uuid.UUID) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with Session(engine, expire_on_commit=False) as db:
            get_content_version_detail(db, content_version_id)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


@pytest.mark.integration
def test_content_version_detail_returns_one_readonly_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """详情 route 在 repeatable read 中返回目标 lineage、审核和 canonical owner。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            actor, task, fact, pending, job = _seed_pending_review(db)
            actor_id = actor.id
            task_id = task.id
            product_id = fact.product_id
            pending_id = pending.id
            job_id = job.id

        captured: dict[str, str] = {}
        real_projection = production_routes.get_content_version_detail

        def inspected_projection(db: Session, content_version_id: uuid.UUID) -> object:
            captured["isolation"] = str(
                db.connection().exec_driver_sql("SHOW transaction_isolation").scalar_one()
            )
            return real_projection(db, content_version_id)

        monkeypatch.setattr(production_routes, "get_content_version_detail", inspected_projection)
        with Session(engine, expire_on_commit=False) as db:
            actor = db.get(User, actor_id)
            assert actor is not None
        client = _client(engine, actor)
        try:
            response = client.get(f"/api/v1/content-versions/{pending_id}/detail")
            missing = client.get(f"/api/v1/content-versions/{uuid.uuid4()}/detail")
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        payload = response.json()
        assert captured["isolation"] == "repeatable read"
        assert payload["content"]["id"] == str(pending_id)
        assert payload["content"]["task_id"] == str(task_id)
        assert payload["content"]["is_current"] is True
        assert payload["content"]["change_summary"] == "AI 生成并提交审核"
        assert payload["content"]["creator"]["id"] == str(actor_id)
        assert payload["fact_version"]["product_id"] == str(product_id)
        assert payload["generation_lineage"]["original_generation"]["job_id"] == str(job_id)
        assert (
            payload["generation_lineage"]["original_generation"]["prompt"]["name"]
            == "测试平台 Prompt"
        )
        assert payload["review_result"]["action"] == "submit-review"
        assert [item["action"] for item in payload["review_timeline"]] == [
            "approve",
            "submit-review",
        ]
        assert "available_actions" not in payload["content"]
        assert "primary_task" not in payload["content"]
        assert "quality_issues" not in payload["content"]
        assert missing.status_code == 404


@pytest.mark.integration
def test_content_version_detail_human_history_has_no_lineage_and_fixed_queries() -> None:
    """纯人工历史不伪造快照，且查询次数不随任务版本数量增长。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            task = graph["task"]
            fact = graph["fact"]
            actor = graph["user"]
            content = graph["content"]
            assert isinstance(content, ContentVersion)
            base_count = _statement_count(engine, content.id)
            for version in range(2, 22):
                db.add(
                    ContentVersion(
                        task_id=task.id,
                        fact_version_id=fact.id,
                        based_on_id=content.id,
                        version=version,
                        source_type="HUMAN",
                        title=f"历史版本 {version}",
                        summary="查询规模测试",
                        body_markdown="# 历史",
                        tags=["历史"],
                        content_hash=f"{version:064x}",
                        status="ABANDONED",
                        quality_issues=[],
                        change_summary="查询规模测试",
                        created_by=actor.id,
                    )
                )
            db.commit()

        detail = None
        with Session(engine, expire_on_commit=False) as db:
            detail = get_content_version_detail(db, content.id)
        assert detail.generation_lineage is None
        assert detail.review_result is None
        assert detail.review_timeline == []
        assert _statement_count(engine, content.id) == base_count
