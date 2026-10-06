"""Content Editor Context 与人工内容主线的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import app.routers.planning as planning_routes
from app.db import get_db
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.models.ai_generation import GenerationJob
from app.models.content import ContentTask, ContentVersion
from app.models.identity import User
from app.models.product_facts import FactVersion
from app.schemas.content import ContentDraftUpdate, ContentRevisionCreate
from app.services.content_editor import content_editor_context_out
from app.services.content_production import (
    abandon_content_version,
    create_content_revision,
    create_manual_content_version,
    update_content_draft,
)
from app.services.generation import content_hash
from app.services.review import transition_content_version
from tests.integration.test_publication_workflow import _seed_graph, temporary_database


def _statement_count(engine: Engine, task_id: uuid.UUID, actor_id: uuid.UUID) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with Session(engine, expire_on_commit=False) as db:
            actor = db.get(User, actor_id)
            assert actor is not None
            content_editor_context_out(db, task_id, actor=actor)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


def _generation_snapshot(task: ContentTask, fact: FactVersion) -> dict[str, object]:
    return {
        "adapter_name": "openai-compatible-chat-completions",
        "contract_version": "content-markdown-v3",
        "channel": {
            "id": str(uuid.uuid4()),
            "name": "测试渠道",
            "protocol_type": "OPENAI_COMPATIBLE_CHAT_COMPLETIONS",
        },
        "model": {
            "id": str(uuid.uuid4()),
            "display_name": "测试模型",
            "model_id": "test-model",
        },
        "platform_profile": {
            "id": str(task.platform_profile_id),
            "name": task.platform_profile_name_snapshot,
            "slug": "test-platform",
        },
        "platform_prompt": {
            "id": str(uuid.uuid4()),
            "name": "测试平台 Prompt",
            "revision": 3,
        },
        "fact_version": {
            "id": str(fact.id),
            "product_id": str(fact.product_id),
            "version": fact.version,
            "classification": fact.classification,
        },
        "system_message": "系统 Prompt",
        "user_message": fact.body_markdown,
    }


@pytest.mark.integration
def test_editor_context_uses_current_pointer_and_compact_lineage() -> None:
    """高版本历史不得替代主线，AI 快照只投影 Editor 所需摘要。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            task = graph["task"]
            fact = graph["fact"]
            approved = graph["content"]
            assert isinstance(actor, User)
            assert isinstance(task, ContentTask)
            assert isinstance(fact, FactVersion)
            assert isinstance(approved, ContentVersion)

            approved_context = content_editor_context_out(db, task.id, actor=actor)
            assert approved_context.current_content is not None
            assert approved_context.current_content.id == approved.id
            assert approved_context.current_content.status == "APPROVED"
            assert "SAVE" not in approved_context.current_content.available_actions

            job = GenerationJob(
                content_task_id=task.id,
                idempotency_key=f"editor-context-{uuid.uuid4()}",
                job_type="GENERATE",
                status="SUCCEEDED",
                input_snapshot=_generation_snapshot(task, fact),
                adapter_name="openai-compatible-chat-completions",
                prompt_template_version="content-markdown-v3",
                prompt_hash="e" * 64,
                attempt_count=1,
                created_by=actor.id,
            )
            db.add(job)
            db.flush()
            ai_body = "# AI 当前主线\n\n只读内容。"
            ai = ContentVersion(
                task_id=task.id,
                fact_version_id=fact.id,
                source_job_id=job.id,
                version=2,
                source_type="AI",
                title="AI 当前主线",
                summary="AI 摘要",
                body_markdown=ai_body,
                tags=["AI"],
                content_hash=content_hash("AI 当前主线", "AI 摘要", ai_body, ["AI"]),
                status="DRAFT",
                quality_issues=[],
                change_summary="AI 生成",
                created_by=actor.id,
            )
            db.add(ai)
            db.flush()
            job.content_version_id = ai.id
            task.current_content_version_id = ai.id
            historical = ContentVersion(
                task_id=task.id,
                fact_version_id=fact.id,
                based_on_id=ai.id,
                version=99,
                source_type="HUMAN",
                title="更高但非当前的历史版本",
                summary="不得替代 pointer",
                body_markdown="# 历史",
                tags=["历史"],
                content_hash=content_hash(
                    "更高但非当前的历史版本", "不得替代 pointer", "# 历史", ["历史"]
                ),
                status="ABANDONED",
                quality_issues=[],
                change_summary="指针测试",
                created_by=actor.id,
            )
            db.add(historical)
            db.commit()

            context = content_editor_context_out(db, task.id, actor=actor)

            assert context.current_content is not None
            assert context.current_content.id == ai.id
            assert context.current_content.version == 2
            assert context.current_content.available_actions == [
                "CREATE_REVISION",
                "SUBMIT_REVIEW",
                "ABANDON",
            ]
            assert context.comparison_content is not None
            assert context.comparison_content.id == approved.id
            assert context.diff is not None
            assert (context.diff.left_id, context.diff.right_id) == (approved.id, ai.id)
            assert context.latest_generation is not None
            assert context.latest_generation.id == job.id
            assert context.current_lineage is not None
            assert context.current_lineage.generation.job_id == job.id
            assert context.current_lineage.generation.platform_prompt is not None
            assert context.current_lineage.generation.platform_prompt.revision == 3
            assert context.current_lineage.generation.model.model_id == "test-model"
            assert context.locked_fact_version.body_markdown == fact.body_markdown
            assert context.product.category == "MCU"

            abandoned = abandon_content_version(
                db=db,
                content_version_id=ai.id,
                expected_revision=ai.revision,
                comment="放弃 AI 草稿",
                actor=actor,
                request_id="editor-abandon-ai-draft",
            )
            assert abandoned.status == "ABANDONED"
            db.refresh(task)
            assert task.current_content_version_id == approved.id
            restored = content_editor_context_out(db, task.id, actor=actor)
            assert restored.current_content is not None
            assert restored.current_content.id == approved.id


@pytest.mark.integration
def test_editor_context_supports_no_current_and_fixed_query_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """无主线返回空文档，版本链增长不增加查询次数且 endpoint 使用一致快照。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            base_task = graph["task"]
            fact = graph["fact"]
            assert isinstance(actor, User)
            assert isinstance(base_task, ContentTask)
            assert isinstance(fact, FactVersion)

            empty_task = ContentTask(
                product_id=base_task.product_id,
                fact_version_id=fact.id,
                platform_profile_id=base_task.platform_profile_id,
                platform_profile_name_snapshot=base_task.platform_profile_name_snapshot,
                platform_website_url_snapshot=base_task.platform_website_url_snapshot,
                created_by=actor.id,
            )
            db.add(empty_task)
            db.commit()
            empty = content_editor_context_out(db, empty_task.id, actor=actor)
            assert empty.current_content is None
            assert empty.comparison_content is None
            assert empty.diff is None
            assert empty.current_lineage is None
            assert "CREATE_MANUAL_VERSION" in empty.task.available_actions

            sparse_count = _statement_count(engine, base_task.id, actor.id)
            parent = graph["content"]
            assert isinstance(parent, ContentVersion)
            for version in range(2, 22):
                body = f"# 修订 {version}"
                revision = ContentVersion(
                    task_id=base_task.id,
                    fact_version_id=fact.id,
                    based_on_id=parent.id,
                    version=version,
                    source_type="HUMAN",
                    title=f"修订 {version}",
                    summary="查询次数测试",
                    body_markdown=body,
                    tags=["修订"],
                    content_hash=content_hash(f"修订 {version}", "查询次数测试", body, ["修订"]),
                    status="DRAFT" if version == 21 else "ABANDONED",
                    quality_issues=[],
                    change_summary="查询次数测试",
                    created_by=actor.id,
                )
                db.add(revision)
                db.flush()
                parent = revision
            base_task.current_content_version_id = parent.id
            db.commit()
            assert _statement_count(engine, base_task.id, actor.id) == sparse_count

            captured: dict[str, str] = {}
            real_projection = planning_routes.content_editor_context_out

            def inspected_projection(db: Session, task_id: uuid.UUID, *, actor: User) -> object:
                captured["isolation"] = str(db.scalar(text("SHOW transaction_isolation")))
                return real_projection(db, task_id, actor=actor)

            monkeypatch.setattr(
                planning_routes,
                "content_editor_context_out",
                inspected_projection,
            )

            def database_session() -> Iterator[Session]:
                with Session(engine, expire_on_commit=False) as session:
                    yield session

            app.dependency_overrides[get_db] = database_session
            app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(user=actor)
            try:
                response = TestClient(app).get(
                    f"/api/v1/content-tasks/{base_task.id}/editor-context"
                )
                missing = TestClient(app).get(
                    f"/api/v1/content-tasks/{uuid.uuid4()}/editor-context"
                )
            finally:
                app.dependency_overrides.clear()

            assert response.status_code == 200
            assert response.json()["current_content"]["id"] == str(parent.id)
            assert captured["isolation"] == "repeatable read"
            assert missing.status_code == 404


@pytest.mark.integration
def test_manual_draft_save_submit_and_changes_requested_revision() -> None:
    """人工首稿走 HUMAN DRAFT，可保存；冻结后只能创建新修订。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            base_task = graph["task"]
            fact = graph["fact"]
            assert isinstance(actor, User)
            assert isinstance(base_task, ContentTask)
            assert isinstance(fact, FactVersion)
            task = ContentTask(
                product_id=base_task.product_id,
                fact_version_id=fact.id,
                platform_profile_id=base_task.platform_profile_id,
                platform_profile_name_snapshot=base_task.platform_profile_name_snapshot,
                platform_website_url_snapshot=base_task.platform_website_url_snapshot,
                created_by=actor.id,
            )
            db.add(task)
            db.commit()

            manual = create_manual_content_version(
                db=db,
                content_task_id=task.id,
                payload=ContentRevisionCreate(
                    title="人工首稿",
                    summary="人工摘要",
                    body_markdown="# 人工首稿",
                    tags=["人工"],
                    change_summary="创建人工首稿",
                ),
                actor=actor,
                request_id="editor-manual",
            )
            assert (manual.source_type, manual.source_job_id, manual.based_on_id) == (
                "HUMAN",
                None,
                None,
            )
            assert (
                db.scalar(
                    select(func.count())
                    .select_from(GenerationJob)
                    .where(GenerationJob.content_task_id == task.id)
                )
                == 0
            )
            db.refresh(task)
            assert task.current_content_version_id == manual.id
            manual_context = content_editor_context_out(db, task.id, actor=actor)
            assert manual_context.current_content is not None
            assert manual_context.current_content.id == manual.id
            assert "SAVE" in manual_context.current_content.available_actions

            saved = update_content_draft(
                db=db,
                content_version_id=manual.id,
                payload=ContentDraftUpdate(
                    expected_revision=0,
                    title="已保存人工首稿",
                    summary="已保存摘要",
                    body_markdown="# 已保存人工首稿",
                    tags=["人工", "已保存"],
                ),
                actor=actor,
                request_id="editor-save",
            )
            submitted = transition_content_version(
                db=db,
                content_version_id=saved.id,
                expected_revision=saved.revision,
                comment="",
                actor=actor,
                request_id="editor-submit",
                action="submit-review",
            )
            assert submitted.status == "PENDING_REVIEW"
            submitted_context = content_editor_context_out(db, task.id, actor=actor)
            assert submitted_context.current_content is not None
            assert submitted_context.current_content.status == "PENDING_REVIEW"
            assert "SAVE" not in submitted_context.current_content.available_actions

            with pytest.raises(AppError) as frozen_error:
                update_content_draft(
                    db=db,
                    content_version_id=submitted.id,
                    payload=ContentDraftUpdate(
                        expected_revision=submitted.revision,
                        title="禁止覆盖",
                        summary=submitted.summary,
                        body_markdown=submitted.body_markdown,
                        tags=submitted.tags,
                    ),
                    actor=actor,
                    request_id="editor-frozen-save",
                )
            assert frozen_error.value.code == "INVALID_STATE_TRANSITION"
            db.rollback()

            returned = transition_content_version(
                db=db,
                content_version_id=submitted.id,
                expected_revision=submitted.revision,
                comment="请修订",
                actor=actor,
                request_id="editor-request-changes",
                action="request-changes",
            )
            returned_context = content_editor_context_out(db, task.id, actor=actor)
            assert returned_context.current_content is not None
            assert returned_context.current_content.status == "CHANGES_REQUESTED"
            assert "CREATE_REVISION" in returned_context.current_content.available_actions
            assert "SAVE" not in returned_context.current_content.available_actions
            revision = create_content_revision(
                db=db,
                content_version_id=returned.id,
                payload=ContentRevisionCreate(
                    title="人工修订",
                    summary="修订摘要",
                    body_markdown="# 人工修订",
                    tags=["人工", "修订"],
                    change_summary="按审核意见修订",
                ),
                actor=actor,
                request_id="editor-revision",
            )
            assert revision.source_type == "HUMAN"
            assert revision.status == "DRAFT"
            assert revision.based_on_id == returned.id
            returned_record = db.get(ContentVersion, returned.id)
            assert returned_record is not None
            db.refresh(task)
            assert returned_record.status == "CHANGES_REQUESTED"
            assert returned_record.title == "已保存人工首稿"
            assert task.current_content_version_id == revision.id
            revision_context = content_editor_context_out(db, task.id, actor=actor)
            assert revision_context.current_content is not None
            assert revision_context.current_content.id == revision.id
            assert revision_context.comparison_content is not None
            assert revision_context.comparison_content.id == returned.id
            assert "SAVE" in revision_context.current_content.available_actions
