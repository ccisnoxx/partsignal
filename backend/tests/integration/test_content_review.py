"""Content Review 当前主线读取与审核命令的 PostgreSQL 集成测试。"""

from __future__ import annotations

import copy
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

import app.routers.production as production_routes
from app.db import get_db
from app.deps import get_current_session
from app.main import app
from app.models.ai_generation import GenerationJob
from app.models.content import ContentReviewRecord, ContentTask, ContentVersion
from app.models.identity import User
from app.models.product_facts import FactVersion
from app.security import hash_token
from app.services.generation import content_hash
from tests.integration.test_content_editor_context import _generation_snapshot
from tests.integration.test_publication_workflow import _seed_graph, temporary_database


def _seed_pending_review(
    db: Session,
) -> tuple[User, ContentTask, FactVersion, ContentVersion, GenerationJob]:
    """在既有批准版本上追加一条 AI 待审核当前主线。"""
    graph = _seed_graph(db)
    actor = graph["user"]
    task = graph["task"]
    fact = graph["fact"]
    approved = graph["content"]
    assert isinstance(actor, User)
    assert isinstance(task, ContentTask)
    assert isinstance(fact, FactVersion)
    assert isinstance(approved, ContentVersion)

    job = GenerationJob(
        content_task_id=task.id,
        idempotency_key=f"content-review-{uuid.uuid4()}",
        job_type="GENERATE",
        status="SUCCEEDED",
        input_snapshot=_generation_snapshot(task, fact),
        adapter_name="openai-compatible-chat-completions",
        prompt_template_version="content-markdown-v3",
        prompt_hash="r" * 64,
        attempt_count=1,
        created_by=actor.id,
    )
    db.add(job)
    db.flush()
    body = "# 待审核内容\n\n典型工作电压为 3.3 V，适合工程师社区。"
    pending = ContentVersion(
        task_id=task.id,
        fact_version_id=fact.id,
        source_job_id=job.id,
        based_on_id=approved.id,
        version=2,
        source_type="AI",
        title="待审核内容",
        summary="当前主线审核摘要",
        body_markdown=body,
        tags=["审核"],
        content_hash=content_hash("待审核内容", "当前主线审核摘要", body, ["审核"]),
        status="PENDING_REVIEW",
        revision=1,
        quality_issues=[
            {"code": "PLATFORM_TONE", "severity": "WARNING", "message": "请人工核对平台语气"}
        ],
        change_summary="AI 生成并提交审核",
        created_by=actor.id,
    )
    db.add(pending)
    db.flush()
    job.content_version_id = pending.id
    task.current_content_version_id = pending.id
    first_review_at = datetime(2026, 8, 9, tzinfo=UTC)
    db.add_all(
        [
            ContentReviewRecord(
                content_version_id=approved.id,
                action="approve",
                comment="首版通过",
                actor_id=actor.id,
                created_at=first_review_at,
            ),
            ContentReviewRecord(
                content_version_id=pending.id,
                action="submit-review",
                comment="提交第二版",
                actor_id=actor.id,
                created_at=first_review_at + timedelta(seconds=1),
            ),
        ]
    )
    db.commit()
    return actor, task, fact, pending, job


def _client(engine: object, actor: User, csrf_token: str) -> TestClient:
    def database_session() -> Iterator[Session]:
        with Session(engine, expire_on_commit=False) as db:
            yield db

    app.dependency_overrides[get_db] = database_session
    app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
        user=actor,
        csrf_hash=hash_token(csrf_token),
    )
    return TestClient(app)


@pytest.mark.integration
def test_task_review_context_uses_current_pointer_and_one_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """task route 只解析当前指针，并原样返回差异、事实、快照与累计历史。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            actor, task, fact, pending, job = _seed_pending_review(db)
            empty_task = ContentTask(
                product_id=task.product_id,
                fact_version_id=fact.id,
                platform_profile_id=task.platform_profile_id,
                platform_profile_name_snapshot=task.platform_profile_name_snapshot,
                platform_website_url_snapshot=task.platform_website_url_snapshot,
                created_by=actor.id,
            )
            db.add(empty_task)
            db.commit()
            task_id = task.id
            empty_task_id = empty_task.id
            actor_id = actor.id
            pending_id = pending.id
            job_id = job.id

        captured: dict[str, str] = {}
        real_projection = production_routes.get_content_task_review_context

        def inspected_projection(
            db: Session, content_task_id: uuid.UUID, *, can_delete_fact: bool
        ) -> object:
            captured["isolation"] = str(db.scalar(text("SHOW transaction_isolation")))
            return real_projection(
                db,
                content_task_id,
                can_delete_fact=can_delete_fact,
            )

        monkeypatch.setattr(
            production_routes,
            "get_content_task_review_context",
            inspected_projection,
        )
        with Session(engine, expire_on_commit=False) as db:
            actor = db.get(User, actor_id)
            assert actor is not None
        client = _client(engine, actor, "content-review-read-csrf-token-over-32-characters")
        try:
            response = client.get(f"/api/v1/content-tasks/{task_id}/review-context")
            exact = client.get(f"/api/v1/content-versions/{pending_id}/review-context")
            empty = client.get(f"/api/v1/content-tasks/{empty_task_id}/review-context")
            missing = client.get(f"/api/v1/content-tasks/{uuid.uuid4()}/review-context")
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        payload = response.json()
        assert payload["content"]["id"] == str(pending_id)
        assert payload["content"]["quality_issues"][0]["severity"] == "WARNING"
        assert payload["fact_version"]["body_markdown"] == fact.body_markdown
        assert payload["diff"]["right_id"] == str(pending_id)
        assert payload["generation_trace"]["job_id"] == str(job_id)
        assert (
            payload["generation_trace"]["input_snapshot"]["contract_version"]
            == "content-markdown-v3"
        )
        assert payload["available_actions"] == ["APPROVE", "REQUEST_CHANGES"]
        assert [record["action"] for record in payload["review_history"]] == [
            "approve",
            "submit-review",
        ]
        assert exact.status_code == 200
        assert exact.json() == payload
        assert captured["isolation"] == "repeatable read"
        assert empty.status_code == 409
        assert empty.json()["error"]["code"] == "CONTENT_REVIEW_NOT_AVAILABLE"
        assert missing.status_code == 404


@pytest.mark.integration
def test_content_review_commands_revalidate_and_preserve_immutable_inputs() -> None:
    """批准与退回重验 CSRF/revision，追加历史且不改写正文或生成快照。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        csrf_token = "content-review-write-csrf-token-over-32-characters"
        with Session(engine, expire_on_commit=False) as db:
            actor, approve_task, _fact, approve_target, approve_job = _seed_pending_review(db)
            _other_actor, return_task, _other_fact, return_target, _return_job = (
                _seed_pending_review(db)
            )
            actor_id = actor.id
            approve_task_id = approve_task.id
            approve_target_id = approve_target.id
            return_task_id = return_task.id
            return_target_id = return_target.id
            original_body = approve_target.body_markdown
            original_snapshot = copy.deepcopy(approve_job.input_snapshot)

        with Session(engine, expire_on_commit=False) as db:
            actor = db.get(User, actor_id)
            assert actor is not None
        client = _client(engine, actor, csrf_token)
        try:
            invalid_csrf = client.post(
                f"/api/v1/content-versions/{approve_target_id}/approve",
                headers={"X-CSRF-Token": "wrong-csrf-token-with-more-than-32-characters"},
                json={"expected_revision": 1, "comment": ""},
            )
            stale = client.post(
                f"/api/v1/content-versions/{approve_target_id}/approve",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": 99, "comment": ""},
            )
            blank = client.post(
                f"/api/v1/content-versions/{return_target_id}/request-changes",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": 1, "comment": "   "},
            )
            approved = client.post(
                f"/api/v1/content-versions/{approve_target_id}/approve",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": 1, "comment": "审核通过"},
            )
            returned = client.post(
                f"/api/v1/content-versions/{return_target_id}/request-changes",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": 1, "comment": "  请补充平台适配说明  "},
            )
            approved_context = client.get(f"/api/v1/content-tasks/{approve_task_id}/review-context")
            returned_context = client.get(f"/api/v1/content-tasks/{return_task_id}/review-context")
        finally:
            app.dependency_overrides.clear()

        assert invalid_csrf.status_code == 403
        assert invalid_csrf.json()["error"]["code"] == "CSRF_INVALID"
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "REVISION_CONFLICT"
        assert stale.json()["error"]["request_id"]
        assert blank.status_code == 422
        assert blank.json()["error"]["code"] == "VALIDATION_ERROR"
        assert approved.status_code == 200
        assert approved.json()["status"] == "APPROVED"
        assert returned.status_code == 200
        assert returned.json()["status"] == "CHANGES_REQUESTED"
        assert approved_context.json()["available_actions"] == []
        assert returned_context.json()["available_actions"] == []
        assert returned_context.json()["review_history"][-1]["comment"] == "请补充平台适配说明"

        with Session(engine, expire_on_commit=False) as db:
            approved_version = db.get(ContentVersion, approve_target_id)
            approve_job = db.scalar(
                select(GenerationJob).where(GenerationJob.content_version_id == approve_target_id)
            )
            assert approved_version is not None
            assert approve_job is not None
            assert approved_version.body_markdown == original_body
            assert approve_job.input_snapshot == original_snapshot
            assert [
                record.action
                for record in db.scalars(
                    select(ContentReviewRecord)
                    .where(ContentReviewRecord.content_version_id == approve_target_id)
                    .order_by(ContentReviewRecord.created_at, ContentReviewRecord.id)
                )
            ] == ["submit-review", "approve"]
