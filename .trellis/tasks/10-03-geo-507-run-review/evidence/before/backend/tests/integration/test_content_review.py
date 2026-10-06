"""Content Review 当前主线读取与审核命令的 PostgreSQL 集成测试。"""

from __future__ import annotations

import copy
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import app.routers.production as production_routes
from app.db import get_db
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.models.ai_generation import GenerationJob
from app.models.content import ContentReviewRecord, ContentTask, ContentVersion
from app.models.identity import AuditLog, User
from app.models.product_facts import FactVersion
from app.security import hash_token
from app.services import content_production as content_production_service
from app.services import review as review_service
from app.services.generation import content_hash
from tests.integration.test_content_editor_context import _generation_snapshot
from tests.integration.test_publication_workflow import _seed_graph, temporary_database


def _seed_pending_review(
    db: Session,
    *,
    pending_quality_issues: list[dict[str, str]] | None = None,
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
        quality_issues=(
            pending_quality_issues
            if pending_quality_issues is not None
            else [
                {
                    "code": "PLATFORM_TONE",
                    "severity": "WARNING",
                    "message": "请人工核对平台语气",
                }
            ]
        ),
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


def _content_review_integrity_error(
    sqlstate: str | None,
    constraint_name: str | None,
    *,
    diagnostics: bool = True,
    original: bool = True,
) -> IntegrityError:
    """构造只用于 classifier 矩阵的驱动 diagnostics；不替代真实数据库冲突。"""
    original_error = SimpleNamespace(
        sqlstate=sqlstate,
        diag=(SimpleNamespace(constraint_name=constraint_name) if diagnostics else None),
        message_primary=(
            "duplicate key violates uq_content_versions_one_pending_per_task"
        ),
    )
    return IntegrityError(
        "INSERT INTO content_versions ...", {}, original_error if original else None
    )


@pytest.mark.parametrize(
    ("case", "error", "expected"),
    [
        (
            "exact-pending",
            _content_review_integrity_error(
                "23505", "uq_content_versions_one_pending_per_task"
            ),
            True,
        ),
        (
            "approved-constraint",
            _content_review_integrity_error(
                "23505", "uq_content_versions_one_approved_per_task"
            ),
            False,
        ),
        (
            "other-unique-constraint",
            _content_review_integrity_error("23505", "uq_content_versions_task_id_version_key"),
            False,
        ),
        (
            "check-violation",
            _content_review_integrity_error("23514", "uq_content_versions_one_pending_per_task"),
            False,
        ),
        (
            "foreign-key-violation",
            _content_review_integrity_error("23503", "uq_content_versions_one_pending_per_task"),
            False,
        ),
        (
            "not-null-violation",
            _content_review_integrity_error("23502", "uq_content_versions_one_pending_per_task"),
            False,
        ),
        (
            "trigger-like-raise",
            _content_review_integrity_error("P0001", "uq_content_versions_one_pending_per_task"),
            False,
        ),
        (
            "trigger-like-admin-shutdown",
            _content_review_integrity_error("55000", "uq_content_versions_one_pending_per_task"),
            False,
        ),
        (
            "missing-diagnostics",
            _content_review_integrity_error(
                "23505", "uq_content_versions_one_pending_per_task", diagnostics=False
            ),
            False,
        ),
        (
            "missing-original",
            _content_review_integrity_error(
                "23505", "uq_content_versions_one_pending_per_task", original=False
            ),
            False,
        ),
        (
            "missing-constraint-name",
            IntegrityError(
                "duplicate key violates uq_content_versions_one_pending_per_task",
                {},
                SimpleNamespace(sqlstate="23505", diag=SimpleNamespace()),
            ),
            False,
        ),
        (
            "message-only",
            IntegrityError(
                "duplicate key violates uq_content_versions_one_pending_per_task",
                {},
                SimpleNamespace(sqlstate=None, diag=None),
            ),
            False,
        ),
    ],
)
def test_content_review_pending_classifier_is_exact(
    case: str, error: IntegrityError, expected: bool
) -> None:
    """review classifier 只接受 23505 与 pending constraint 的精确组合。"""
    assert review_service._is_content_review_pending_integrity_error(error) is expected, case


@pytest.mark.integration
def test_content_review_partial_unique_catalog_and_diagnostics() -> None:
    """从 current-head PostgreSQL catalog 与真实冲突确认两条 partial unique。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            _actor, task, fact, pending, _job = _seed_pending_review(db)
            indexes = dict(
                db.execute(
                    text(
                        """
                        SELECT indexname, indexdef
                        FROM pg_indexes
                        WHERE schemaname = current_schema()
                          AND tablename = 'content_versions'
                          AND indexname IN (
                              'uq_content_versions_one_pending_per_task',
                              'uq_content_versions_one_approved_per_task'
                          )
                        """
                    )
                ).all()
            )
            assert set(indexes) == {
                "uq_content_versions_one_pending_per_task",
                "uq_content_versions_one_approved_per_task",
            }
            for index_name, status in (
                ("uq_content_versions_one_pending_per_task", "PENDING_REVIEW"),
                ("uq_content_versions_one_approved_per_task", "APPROVED"),
            ):
                definition = indexes[index_name]
                assert "CREATE UNIQUE INDEX" in definition
                assert "(task_id)" in definition
                assert f"'{status}'" in definition

            pending_conflict = ContentVersion(
                task_id=task.id,
                fact_version_id=fact.id,
                based_on_id=pending.id,
                version=3,
                source_type="HUMAN",
                title="pending diagnostics",
                summary="pending diagnostics",
                body_markdown="pending diagnostics",
                tags=["diagnostics"],
                content_hash="c" * 64,
                status="PENDING_REVIEW",
                revision=1,
                quality_issues=[],
                change_summary="diagnostics",
                created_by=pending.created_by,
            )
            db.add(pending_conflict)
            with pytest.raises(IntegrityError) as pending_error:
                db.flush()
            assert pending_error.value.orig.sqlstate == "23505"
            assert (
                pending_error.value.orig.diag.constraint_name
                == "uq_content_versions_one_pending_per_task"
            )
            db.rollback()

            approved_conflict = ContentVersion(
                task_id=task.id,
                fact_version_id=fact.id,
                based_on_id=pending.id,
                version=4,
                source_type="HUMAN",
                title="approved diagnostics",
                summary="approved diagnostics",
                body_markdown="approved diagnostics",
                tags=["diagnostics"],
                content_hash="d" * 64,
                status="APPROVED",
                revision=1,
                quality_issues=[],
                change_summary="diagnostics",
                created_by=pending.created_by,
            )
            db.add(approved_conflict)
            with pytest.raises(IntegrityError) as approved_error:
                db.flush()
            assert approved_error.value.orig.sqlstate == "23505"
            assert (
                approved_error.value.orig.diag.constraint_name
                == "uq_content_versions_one_approved_per_task"
            )


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


@pytest.mark.integration
def test_submit_review_pending_constraint_rolls_back_and_preserves_request_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """真实 pending partial unique 冲突返回领域错误，并回滚整个 submit command。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        csrf_token = "content-review-pending-csrf-token-over-32-characters"
        with Session(engine, expire_on_commit=False) as db:
            actor, task, fact, pending, _job = _seed_pending_review(db)
            target = ContentVersion(
                task_id=task.id,
                fact_version_id=fact.id,
                based_on_id=pending.id,
                version=3,
                source_type="HUMAN",
                title="新的人工草稿",
                summary="新的草稿摘要",
                body_markdown="新的草稿正文",
                tags=["草稿"],
                content_hash="b" * 64,
                status="DRAFT",
                revision=4,
                quality_issues=[],
                change_summary="为 pending 冲突准备的草稿",
                created_by=actor.id,
            )
            db.add(target)
            db.flush()
            task.current_content_version_id = target.id
            db.commit()
            actor_id = actor.id
            task_id = task.id
            target_id = target.id
            pending_id = pending.id
            expected_target_revision = target.revision
            expected_task_revision = task.revision
            expected_versions = {
                version.id: (version.status, version.revision)
                for version in db.scalars(
                    select(ContentVersion).where(ContentVersion.task_id == task.id)
                )
            }
            expected_review_count = db.scalar(
                select(text("count(*)")).select_from(ContentReviewRecord).where(
                    ContentReviewRecord.content_version_id.in_(expected_versions)
                )
            )
            expected_audit_count = db.scalar(select(text("count(*)")).select_from(AuditLog))
            expected_job_count = db.scalar(
                select(text("count(*)")).select_from(GenerationJob).where(
                    GenerationJob.content_task_id == task.id
                )
            )

        with Session(engine, expire_on_commit=False) as actor_db:
            actor = actor_db.get(User, actor_id)
            assert actor is not None

        request_db = Session(engine, expire_on_commit=False)
        dispatch_calls: list[GenerationJob] = []
        monkeypatch.setattr(
            content_production_service,
            "_dispatch_job",
            lambda job: dispatch_calls.append(job),
        )

        def database_session() -> Iterator[Session]:
            """让 HTTP 请求结束后仍能直接观察同一 Session 的 rollback 状态。"""
            yield request_db

        app.dependency_overrides[get_db] = database_session
        app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
            user=actor,
            csrf_hash=hash_token(csrf_token),
        )
        request_id = "content-review-pending-request"
        try:
            response = TestClient(app).post(
                f"/api/v1/content-versions/{target_id}/submit-review",
                headers={"X-CSRF-Token": csrf_token, "X-Request-ID": request_id},
                json={
                    "expected_revision": expected_target_revision,
                    "comment": "请审核新的草稿",
                },
            )
            assert response.status_code == 409, response.text
            assert response.headers["X-Request-ID"] == request_id
            assert response.json()["error"] == {
                "code": "CONTENT_REVIEW_PENDING",
                "message": "该任务已有待审核内容版本",
                "details": {},
                "request_id": request_id,
            }

            # get_db 未替换成新连接；直接复用 request Session 证明 rollback 后仍可查询。
            rolled_back_target = request_db.get(ContentVersion, target_id)
            rolled_back_pending = request_db.get(ContentVersion, pending_id)
            rolled_back_task = request_db.get(ContentTask, task_id)
            assert rolled_back_target is not None
            assert rolled_back_pending is not None
            assert rolled_back_task is not None
            assert (rolled_back_target.status, rolled_back_target.revision) == (
                "DRAFT",
                expected_target_revision,
            )
            assert rolled_back_pending.status == "PENDING_REVIEW"
            assert (rolled_back_task.current_content_version_id, rolled_back_task.revision) == (
                target_id,
                expected_task_revision,
            )
            assert {
                version.id: (version.status, version.revision)
                for version in request_db.scalars(
                    select(ContentVersion).where(ContentVersion.task_id == task_id)
                )
            } == expected_versions
            assert request_db.scalar(
                select(text("count(*)")).select_from(ContentReviewRecord).where(
                    ContentReviewRecord.content_version_id.in_(expected_versions)
                )
            ) == expected_review_count
            assert request_db.scalar(select(text("count(*)")).select_from(AuditLog)) == (
                expected_audit_count
            )
            assert request_db.scalar(
                select(text("count(*)")).select_from(GenerationJob).where(
                    GenerationJob.content_task_id == task_id
                )
            ) == expected_job_count
            assert dispatch_calls == []
            assert request_db.scalar(
                select(ContentReviewRecord.id).where(
                    ContentReviewRecord.content_version_id == target_id,
                    ContentReviewRecord.action == "submit-review",
                )
            ) is None
        finally:
            app.dependency_overrides.clear()
            request_db.close()
            engine.dispose()


@pytest.mark.integration
def test_approve_approved_constraint_rolls_back_without_leakage() -> None:
    """approved partial unique 的真实 late failure 保持 unknown 500 且全量回滚。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        csrf_token = "content-review-approved-csrf-token-over-32-characters"
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            task = graph["task"]
            fact = graph["fact"]
            previous = graph["content"]
            assert isinstance(actor, User)
            assert isinstance(task, ContentTask)
            assert isinstance(fact, FactVersion)
            assert isinstance(previous, ContentVersion)
            target = ContentVersion(
                task_id=task.id,
                fact_version_id=fact.id,
                based_on_id=previous.id,
                version=2,
                source_type="HUMAN",
                title="待批准目标",
                summary="待批准目标摘要",
                body_markdown="待批准目标正文",
                tags=["目标"],
                content_hash="e" * 64,
                status="PENDING_REVIEW",
                revision=3,
                quality_issues=[],
                change_summary="待批准目标",
                created_by=actor.id,
            )
            db.add(target)
            db.flush()
            task.current_content_version_id = target.id
            db.commit()
            actor_id = actor.id
            task_id = task.id
            previous_id = previous.id
            target_id = target.id
            expected_previous_revision = previous.revision
            expected_target_revision = target.revision
            expected_task_revision = task.revision

        with Session(engine, expire_on_commit=False) as actor_db:
            actor = actor_db.get(User, actor_id)
            assert actor is not None

        request_db = Session(engine, expire_on_commit=False)
        competitor_ids = [uuid.uuid4()]
        injected = False
        captured_errors: list[IntegrityError] = []

        def inject_approved_competitor(
            session: Session, _flush_context: object, _instances: object
        ) -> None:
            """仅在最终 command flush 前注入真实 approved 唯一冲突。"""
            nonlocal injected
            if injected or session is not request_db:
                return
            target_object = next(
                (
                    item
                    for item in session.dirty
                    if isinstance(item, ContentVersion) and item.id == target_id
                ),
                None,
            )
            has_review = any(
                isinstance(item, ContentReviewRecord)
                and item.content_version_id == target_id
                and item.action == "approve"
                for item in session.new
            )
            has_success_audit = any(
                isinstance(item, AuditLog)
                and item.target_id == str(target_id)
                and item.action == "content_version.approve"
                and item.outcome == "SUCCESS"
                for item in session.new
            )
            if target_object is None or target_object.status != "APPROVED":
                return
            if not has_review or not has_success_audit:
                return
            injected = True
            session.add(
                ContentVersion(
                    id=competitor_ids[0],
                    task_id=task_id,
                    fact_version_id=fact.id,
                    based_on_id=previous_id,
                    version=3,
                    source_type="HUMAN",
                    title="并发批准版本",
                    summary="并发批准版本摘要",
                    body_markdown="并发批准版本正文",
                    tags=["竞态"],
                    content_hash="f" * 64,
                    status="APPROVED",
                    revision=1,
                    quality_issues=[],
                    change_summary="测试竞态注入",
                    created_by=actor.id,
                )
            )

        event.listen(Session, "before_flush", inject_approved_competitor)

        def capture_approved_integrity_error(exception_context: object) -> None:
            """捕获真实 DBAPI 约束异常，仅用于确认 service bare re-raise identity。"""
            error = getattr(exception_context, "sqlalchemy_exception", None)
            if isinstance(error, IntegrityError) and (
                getattr(getattr(error.orig, "diag", None), "constraint_name", None)
                == "uq_content_versions_one_approved_per_task"
            ):
                captured_errors.append(error)

        event.listen(engine, "handle_error", capture_approved_integrity_error)

        try:
            with pytest.raises(IntegrityError) as reraised:
                review_service.transition_content_version(
                    db=request_db,
                    content_version_id=target_id,
                    expected_revision=expected_target_revision,
                    comment="批准",
                    actor=actor,
                    request_id="approved-reraise-identity",
                    action="approve",
                )
            assert captured_errors
            assert reraised.value is captured_errors[-1]
            assert injected is True
            direct_error_count = len(captured_errors)
            injected = False
            competitor_ids[0] = uuid.uuid4()

            def database_session() -> Iterator[Session]:
                """复用 command request Session 观察 root rollback。"""
                yield request_db

            app.dependency_overrides[get_db] = database_session
            app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
                user=actor,
                csrf_hash=hash_token(csrf_token),
            )
            request_id = "content-review-approved-unknown"
            response = TestClient(app, raise_server_exceptions=False).post(
                f"/api/v1/content-versions/{target_id}/approve",
                headers={"X-CSRF-Token": csrf_token, "X-Request-ID": request_id},
                json={"expected_revision": expected_target_revision, "comment": "批准"},
            )
            assert response.status_code == 500, response.text
            assert injected is True
            assert len(captured_errors) == direct_error_count + 1
            http_error = captured_errors[-1]
            assert http_error.orig.sqlstate == "23505"
            assert (
                http_error.orig.diag.constraint_name
                == "uq_content_versions_one_approved_per_task"
            )
            for secret in (
                "INSERT INTO",
                "content_versions",
                "uq_content_versions_one_approved_per_task",
                "duplicate key",
                "UniqueViolation",
                "psycopg",
                "violates unique constraint",
                "Key (task_id)",
                "Traceback",
            ):
                assert secret not in response.text

            rolled_back_previous = request_db.get(ContentVersion, previous_id)
            rolled_back_target = request_db.get(ContentVersion, target_id)
            rolled_back_task = request_db.get(ContentTask, task_id)
            assert rolled_back_previous is not None
            assert rolled_back_target is not None
            assert rolled_back_task is not None
            assert (rolled_back_previous.status, rolled_back_previous.revision) == (
                "APPROVED",
                expected_previous_revision,
            )
            assert (rolled_back_target.status, rolled_back_target.revision) == (
                "PENDING_REVIEW",
                expected_target_revision,
            )
            assert (rolled_back_task.current_content_version_id, rolled_back_task.revision) == (
                target_id,
                expected_task_revision,
            )
            assert request_db.get(ContentVersion, competitor_ids[0]) is None
            assert request_db.scalar(
                select(ContentReviewRecord.id).where(
                    ContentReviewRecord.content_version_id == target_id,
                    ContentReviewRecord.action == "approve",
                )
            ) is None
            assert request_db.scalar(
                select(AuditLog.id).where(
                    AuditLog.target_id == str(target_id),
                    AuditLog.action == "content_version.approve",
                    AuditLog.outcome == "SUCCESS",
                )
            ) is None
        finally:
            app.dependency_overrides.clear()
            event.remove(Session, "before_flush", inject_approved_competitor)
            event.remove(engine, "handle_error", capture_approved_integrity_error)
            request_db.close()
            engine.dispose()


@pytest.mark.integration
def test_content_review_prechecks_and_permission_keep_priority(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """非当前、非法状态、质量门禁和权限拒绝均在数据库写入前保持原合同。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        csrf_token = "content-review-precheck-csrf-token-over-32-characters"
        with Session(engine, expire_on_commit=False) as db:
            actor, task, _fact, pending, _job = _seed_pending_review(
                db,
                pending_quality_issues=[{"severity": "BLOCKING", "code": "TEST_BLOCKING"}],
            )
            approved = db.scalar(
                select(ContentVersion).where(
                    ContentVersion.task_id == task.id,
                    ContentVersion.status == "APPROVED",
                )
            )
            assert approved is not None
            actor_id = actor.id
            pending_id = pending.id
            pending_revision = pending.revision
            approved_id = approved.id
            approved_revision = approved.revision

        with Session(engine, expire_on_commit=False) as actor_db:
            actor = actor_db.get(User, actor_id)
            assert actor is not None
        client = _client(engine, actor, csrf_token)
        try:
            non_current = client.post(
                f"/api/v1/content-versions/{approved_id}/submit-review",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": approved_revision, "comment": "非当前"},
            )
            invalid_state = client.post(
                f"/api/v1/content-versions/{pending_id}/submit-review",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": pending_revision, "comment": "重复提交"},
            )
        finally:
            app.dependency_overrides.clear()

        assert non_current.status_code == 409
        assert non_current.json()["error"]["code"] == "CONTENT_VERSION_NOT_CURRENT"
        assert invalid_state.status_code == 409
        assert invalid_state.json()["error"]["code"] == "INVALID_STATE_TRANSITION"

        with Session(engine, expire_on_commit=False) as actor_db:
            actor = actor_db.get(User, actor_id)
            assert actor is not None
        client = _client(engine, actor, csrf_token)
        try:
            quality_blocked = client.post(
                f"/api/v1/content-versions/{pending_id}/approve",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": pending_revision, "comment": "批准"},
            )
        finally:
            app.dependency_overrides.clear()
        assert quality_blocked.status_code == 409
        assert quality_blocked.json()["error"]["code"] == "INVALID_STATE_TRANSITION"

        def deny_review_permission(*_args: object, **_kwargs: object) -> None:
            """模拟 router 的已有账号类型门禁，不写入无效账号类型。"""
            raise AppError("PERMISSION_DENIED", "当前账号没有执行此操作的权限", 403)

        monkeypatch.setattr(production_routes, "assert_account_types", deny_review_permission)
        calls: list[object] = []
        real_transition = production_routes.transition_content_version

        def counted_transition(**kwargs: object) -> object:
            calls.append(kwargs)
            return real_transition(**kwargs)

        monkeypatch.setattr(production_routes, "transition_content_version", counted_transition)
        with Session(engine, expire_on_commit=False) as actor_db:
            actor = actor_db.get(User, actor_id)
            assert actor is not None
        client = _client(engine, actor, csrf_token)
        try:
            denied = client.post(
                f"/api/v1/content-versions/{pending_id}/approve",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": pending_revision, "comment": "批准"},
            )
        finally:
            app.dependency_overrides.clear()
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "PERMISSION_DENIED"
        assert calls == []


@pytest.mark.integration
def test_submit_review_success_regression() -> None:
    """无既有 pending 版本时，DRAFT 仍能成功提交审核。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        csrf_token = "content-review-submit-success-csrf-token-over-32-characters"
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            task = graph["task"]
            fact = graph["fact"]
            previous = graph["content"]
            assert isinstance(actor, User)
            assert isinstance(task, ContentTask)
            assert isinstance(fact, FactVersion)
            assert isinstance(previous, ContentVersion)
            target = ContentVersion(
                task_id=task.id,
                fact_version_id=fact.id,
                based_on_id=previous.id,
                version=2,
                source_type="HUMAN",
                title="提交审核草稿",
                summary="提交审核摘要",
                body_markdown="提交审核正文",
                tags=["提交"],
                content_hash="g" * 64,
                status="DRAFT",
                revision=1,
                quality_issues=[],
                change_summary="提交审核回归",
                created_by=actor.id,
            )
            db.add(target)
            db.flush()
            task.current_content_version_id = target.id
            db.commit()
            actor_id = actor.id
            target_id = target.id
            target_revision = target.revision
        with Session(engine, expire_on_commit=False) as actor_db:
            actor = actor_db.get(User, actor_id)
            assert actor is not None
        client = _client(engine, actor, csrf_token)
        try:
            response = client.post(
                f"/api/v1/content-versions/{target_id}/submit-review",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": target_revision, "comment": "请审核"},
            )
        finally:
            app.dependency_overrides.clear()
            engine.dispose()
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "PENDING_REVIEW"
