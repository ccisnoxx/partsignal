"""Content Task Detail 单请求读模型的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import app.routers.planning as planning_routes
from app.db import get_db
from app.deps import get_current_session
from app.main import app
from app.models.ai_generation import GenerationJob
from app.models.configuration import PlatformProfile
from app.models.content import (
    ContentReviewRecord,
    ContentTask,
    ContentTaskGeoSource,
    ContentVersion,
)
from app.models.identity import User
from app.models.publication import PublishedContentIssue
from app.schemas.common import RevisionRequest
from app.schemas.publication import PublicationWorkCreate
from app.services.content_task_detail import content_task_detail_out
from app.services.platform_configuration import (
    delete_platform_profile,
    set_platform_profile_enabled,
)
from app.services.publication import cancel_content_task, create_publication_work
from tests.integration.test_publication_workflow import (
    _complete_publication,
    _seed_graph,
    temporary_database,
)


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
            content_task_detail_out(db, task_id, actor=actor)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


def _generation_job(
    *,
    task: ContentTask,
    actor: User,
    created_at: datetime,
    status: str = "SUCCEEDED",
) -> GenerationJob:
    return GenerationJob(
        content_task_id=task.id,
        idempotency_key=f"detail-{uuid.uuid4()}",
        job_type="GENERATE",
        status=status,
        input_snapshot={},
        adapter_name="detail-test",
        prompt_template_version="v1",
        prompt_hash="d" * 64,
        attempt_count=1,
        created_by=actor.id,
        created_at=created_at,
        started_at=created_at,
        finished_at=created_at,
    )


def _content_version(
    *,
    task: ContentTask,
    actor: User,
    version: int,
    status: str,
) -> ContentVersion:
    return ContentVersion(
        task_id=task.id,
        fact_version_id=task.fact_version_id,
        version=version,
        source_type="HUMAN",
        title=f"状态测试 {status}",
        summary="Content Task Detail 状态矩阵",
        body_markdown="# 状态矩阵",
        tags=["状态"],
        content_hash=uuid.uuid4().hex * 2,
        status=status,
        quality_issues=[],
        change_summary="状态矩阵",
        created_by=actor.id,
    )


@pytest.mark.integration
def test_content_task_detail_projects_server_workflow_matrix() -> None:
    """详情逐项消费服务端阶段和唯一主任务，不按关联摘要另行推导。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="a" * 64)
            actor = graph["user"]
            base_task = graph["task"]
            account = graph["account"]
            content = graph["content"]
            assert isinstance(actor, User)
            assert isinstance(base_task, ContentTask)
            assert isinstance(content, ContentVersion)

            def new_task(*, status: str = "OPEN") -> ContentTask:
                task = ContentTask(
                    product_id=base_task.product_id,
                    fact_version_id=base_task.fact_version_id,
                    platform_profile_id=base_task.platform_profile_id,
                    platform_profile_name_snapshot=base_task.platform_profile_name_snapshot,
                    platform_website_url_snapshot=base_task.platform_website_url_snapshot,
                    status=status,
                    created_by=actor.id,
                )
                db.add(task)
                db.flush()
                return task

            no_draft = new_task()
            generating = new_task()
            generation_failed = new_task()
            draft = new_task()
            review_pending = new_task()
            changes_requested = new_task()
            cancelled = new_task(status="CANCELLED")
            db.add_all(
                [
                    _generation_job(
                        task=generating,
                        actor=actor,
                        created_at=datetime.now(UTC),
                        status="PENDING",
                    ),
                    _generation_job(
                        task=generation_failed,
                        actor=actor,
                        created_at=datetime.now(UTC),
                        status="FAILED",
                    ),
                ]
            )
            for task, version_status in (
                (draft, "DRAFT"),
                (review_pending, "PENDING_REVIEW"),
                (changes_requested, "CHANGES_REQUESTED"),
            ):
                version = _content_version(
                    task=task,
                    actor=actor,
                    version=1,
                    status=version_status,
                )
                db.add(version)
                db.flush()
                task.current_content_version_id = version.id
            db.commit()

            expected = {
                no_draft.id: ("NO_DRAFT", "CREATE_FIRST_DRAFT"),
                generating.id: ("GENERATING", "VIEW_GENERATION_PROGRESS"),
                generation_failed.id: (
                    "GENERATION_FAILED",
                    "HANDLE_GENERATION_FAILURE",
                ),
                draft.id: ("DRAFT", "EDIT_AND_SUBMIT_REVIEW"),
                review_pending.id: ("REVIEW_PENDING", "REVIEW_CONTENT"),
                changes_requested.id: ("CHANGES_REQUESTED", "REVISE_CONTENT"),
                base_task.id: ("APPROVED", "START_PUBLICATION"),
                cancelled.id: ("CANCELLED", "VIEW_CANCELLATION"),
            }
            for task_id, projection in expected.items():
                detail = content_task_detail_out(db, task_id, actor=actor)
                assert (detail.task.workflow_stage, detail.task.primary_task) == projection
                if task_id == generating.id:
                    assert detail.task.deletion is not None
                    assert detail.task.deletion.blockers[0].type == "GENERATION_JOB"
                    assert detail.task.deletion.blockers[0].count == 1

            work = create_publication_work(
                db=db,
                payload=PublicationWorkCreate(
                    content_version_id=content.id,
                    platform_account_id=account.id,
                ),
                actor=actor,
                request_id="detail-matrix-publishing",
                idempotency_key="detail-matrix-publishing",
            )
            publishing = content_task_detail_out(db, base_task.id, actor=actor)
            assert publishing.task.workflow_stage == "PUBLISHING"
            assert publishing.task.primary_task == "CONTINUE_PUBLICATION"
            assert publishing.publishing is not None
            assert publishing.publishing.work.id == work.id

            verified_graph = _seed_graph(db, content_hash="b" * 64)
            verified_task = verified_graph["task"]
            assert isinstance(verified_task, ContentTask)
            _complete_publication(db, verified_graph, suffix="detail-matrix-verified")
            verified = content_task_detail_out(db, verified_task.id, actor=actor)
            assert verified.task.workflow_stage == "VERIFIED"
            assert verified.task.primary_task == "VIEW_FULL_LINEAGE"
            verified_task.archived_at = datetime.now(UTC)
            db.commit()
            archived = content_task_detail_out(db, verified_task.id, actor=actor)
            assert archived.task.archived_at is not None
            assert archived.task.available_actions == ["RESTORE"]


@pytest.mark.integration
def test_content_task_detail_uses_pointer_stable_sources_and_fixed_query_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """详情保持主线、来源、Activity、查询次数和事务快照的单一权威。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="d" * 64)
            actor = graph["user"]
            task = graph["task"]
            current = graph["content"]
            topic = graph["topic"]
            profile = graph["profile"]
            assert isinstance(actor, User)
            assert isinstance(task, ContentTask)
            assert isinstance(current, ContentVersion)
            assert isinstance(profile, PlatformProfile)

            initial = content_task_detail_out(db, task.id, actor=actor)
            assert initial.current_content is not None
            assert initial.current_content.id == current.id
            assert initial.generation is None
            assert initial.review is not None
            assert initial.review.latest_result is None
            assert initial.publishing is None
            assert initial.source is not None
            assert initial.source.query_topic is not None
            assert initial.source.query_topic.id == topic.id

            sparse_count = _statement_count(engine, task.id, actor.id)
            historical = ContentVersion(
                task_id=task.id,
                fact_version_id=task.fact_version_id,
                version=99,
                source_type="HUMAN",
                title="非当前高版本",
                summary="不得替代 current_content_version_id",
                body_markdown="# 历史版本",
                tags=["历史"],
                content_hash="9" * 64,
                status="DRAFT",
                quality_issues=[],
                change_summary="主线指针测试",
                created_by=actor.id,
            )
            db.add(historical)
            db.flush()
            review_time = datetime(2026, 8, 10, tzinfo=UTC)
            db.add_all(
                [
                    ContentReviewRecord(
                        content_version_id=current.id,
                        action="approve",
                        comment="当前主线审核通过",
                        actor_id=actor.id,
                        created_at=review_time,
                    ),
                    ContentReviewRecord(
                        content_version_id=historical.id,
                        action="request-changes",
                        comment="历史版本审核结果",
                        actor_id=actor.id,
                        created_at=review_time + timedelta(days=1),
                    ),
                ]
            )
            activity_time = datetime(2030, 1, 1, tzinfo=UTC)
            jobs = [
                _generation_job(task=task, actor=actor, created_at=activity_time)
                for _ in range(12)
            ]
            db.add_all(jobs)
            db.add(
                ContentTaskGeoSource(
                    content_task_id=task.id,
                    rule_code="QUESTION_COVERAGE_GAP",
                    date_from=date(2026, 8, 1),
                    date_to=date(2026, 8, 10),
                    query_topic_id=topic.id,
                    geo_platform="DeepSeek",
                    basis_snapshot={
                        "rule_code": "QUESTION_COVERAGE_GAP",
                        "item": {
                            "query_topic_id": str(topic.id),
                            "canonical_question": topic.canonical_question,
                            "geo_platform": "DeepSeek",
                            "status": "UNCOVERED",
                            "observation_count": 1,
                            "mentioned_observation_count": 0,
                            "coverage_rate": {
                                "numerator": 0,
                                "denominator": 1,
                                "value": 0,
                            },
                            "primary_task": "CREATE_OPTIMIZATION_TASK",
                        },
                    },
                    created_by=actor.id,
                )
            )
            db.commit()

            detail = content_task_detail_out(db, task.id, actor=actor)
            assert detail.current_content is not None
            assert detail.current_content.id == current.id
            assert detail.current_content.version == 1
            assert detail.generation is not None
            assert detail.generation.id == max(job.id for job in jobs)
            assert detail.review is not None
            assert detail.review.latest_result is not None
            assert detail.review.latest_result.action == "approve"
            assert detail.source is not None
            assert detail.source.geo_optimization is not None
            assert detail.source.geo_optimization.rule_code == "QUESTION_COVERAGE_GAP"
            assert detail.source.geo_optimization.basis.model_dump(mode="json") == {
                "rule_code": "QUESTION_COVERAGE_GAP",
                "item": {
                    "canonical_question": topic.canonical_question,
                    "geo_platform": "DeepSeek",
                },
            }
            expected_activity_ids = sorted((job.id for job in jobs), reverse=True)[:10]
            assert [item.target.id for item in detail.activity] == expected_activity_ids
            assert all(item.kind == "GENERATION" for item in detail.activity)
            assert _statement_count(engine, task.id, actor.id) == sparse_count

            work = _complete_publication(db, graph, suffix="content-task-detail")
            published = content_task_detail_out(db, task.id, actor=actor)
            assert published.task.workflow_stage == "VERIFIED"
            assert published.task.primary_task == "VIEW_FULL_LINEAGE"
            assert published.publishing is not None
            assert published.publishing.work.id == work.id
            assert published.publishing.result is not None
            assert published.publishing.result.id == work.id

            issue = PublishedContentIssue(
                published_article_id=work.id,
                kind="CONTENT_CHANGED",
                description="页面内容发生变化",
                status="OPEN",
                opened_by=actor.id,
            )
            db.add(issue)
            db.flush()
            repair_task = ContentTask(
                product_id=task.product_id,
                fact_version_id=task.fact_version_id,
                platform_profile_id=task.platform_profile_id,
                platform_profile_name_snapshot=task.platform_profile_name_snapshot,
                platform_website_url_snapshot=task.platform_website_url_snapshot,
                source_published_content_issue_id=issue.id,
                created_by=actor.id,
            )
            db.add(repair_task)
            db.commit()
            repair = content_task_detail_out(db, repair_task.id, actor=actor)
            assert repair.source is not None
            assert repair.source.published_content_issue is not None
            assert repair.source.published_content_issue.id == issue.id

            cancel_content_task(
                db=db,
                task_id=repair_task.id,
                expected_revision=repair_task.revision,
                comment="构造平台删除后的历史详情",
                actor=actor,
                request_id="content-task-detail-cancel-repair",
            )
            profile = set_platform_profile_enabled(
                db=db,
                platform_profile_id=profile.id,
                payload=RevisionRequest(expected_revision=profile.revision),
                actor=actor,
                request_id="content-task-detail-disable-platform",
                enabled=False,
            )
            profile_id = profile.id
            delete_platform_profile(
                db=db,
                platform_profile_id=profile_id,
                actor=actor,
                request_id="content-task-detail-delete-platform",
            )
            db.expire_all()
            assert db.get(PlatformProfile, profile_id) is None
            assert task.platform_profile_id is None
            historical_platform = content_task_detail_out(db, task.id, actor=actor).platform
            assert historical_platform.id is None
            assert historical_platform.name == task.platform_profile_name_snapshot
            assert historical_platform.logo is None

        captured: dict[str, str] = {}
        real_projection = planning_routes.content_task_detail_out

        def inspected_projection(
            db: Session, task_id: uuid.UUID, *, actor: User
        ) -> object:
            captured["isolation"] = str(db.scalar(text("SHOW transaction_isolation")))
            return real_projection(db, task_id, actor=actor)

        monkeypatch.setattr(planning_routes, "content_task_detail_out", inspected_projection)

        def database_session() -> Iterator[Session]:
            with Session(engine, expire_on_commit=False) as db:
                yield db

        app.dependency_overrides[get_db] = database_session
        app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(user=actor)
        try:
            response = TestClient(app).get(f"/api/v1/content-tasks/{task.id}/detail")
            missing = TestClient(app).get(f"/api/v1/content-tasks/{uuid.uuid4()}/detail")
            app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
                user=SimpleNamespace(account_type="VIEWER")
            )
            viewer_response = TestClient(app).get(
                f"/api/v1/content-tasks/{task.id}/detail"
            )
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        assert captured["isolation"] == "repeatable read"
        assert missing.status_code == 404
        assert viewer_response.status_code == 200
