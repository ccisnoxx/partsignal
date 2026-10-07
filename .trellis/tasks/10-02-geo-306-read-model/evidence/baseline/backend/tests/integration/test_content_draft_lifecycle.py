"""人工未审核草稿保存与彻底删除的 PostgreSQL 集成测试。"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from psycopg import sql
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app import db as app_db
from app.errors import AppError, app_error_handler
from app.main import request_context
from app.models.configuration import PlatformProfile, PlatformType
from app.models.content import ContentReviewRecord, ContentTask, ContentVersion
from app.models.identity import AuditLog, User
from app.models.product_facts import FactVersion, Product
from app.schemas.content import ContentDraftUpdate, ContentRevisionCreate
from app.services.content_production import (
    create_content_revision,
    create_manual_content_version,
    delete_content_draft,
    update_content_draft,
)
from app.services.generation import content_hash


def _psycopg_url(value: str) -> str:
    return value.replace("postgresql+psycopg://", "postgresql://", 1)


@contextmanager
def temporary_database() -> Iterator[str]:
    """为草稿生命周期测试创建迁移到 head 的独立数据库。"""
    source_url = os.getenv("PARTSIGNAL_TEST_DATABASE_URL")
    if source_url is None and os.getenv("APP_ENV") == "test":
        source_url = os.getenv("DATABASE_URL")
    if not source_url:
        pytest.skip("未设置 PostgreSQL 测试环境，不以 SQLite 替代 PostgreSQL")
    parts = urlsplit(_psycopg_url(source_url))
    database_name = f"partsignal_content_draft_{uuid.uuid4().hex[:10]}"
    with psycopg.connect(_psycopg_url(source_url), autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
    test_url = urlunsplit(
        (parts.scheme, parts.netloc, f"/{database_name}", parts.query, parts.fragment)
    ).replace("postgresql://", "postgresql+psycopg://", 1)
    backend_dir = Path(__file__).resolve().parents[2]
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        check=True,
        cwd=backend_dir,
        env={**os.environ, "DATABASE_URL": test_url},
    )
    try:
        yield test_url
    finally:
        with psycopg.connect(_psycopg_url(source_url), autocommit=True) as admin:
            admin.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database_name))
            )


def _seed_draft(
    db: Session, *, draft_source_type: str = "HUMAN"
) -> tuple[User, ContentTask, ContentVersion, ContentVersion]:
    """创建批准父版本和当前人工草稿。"""
    actor = User(
        username=f"draft-{uuid.uuid4().hex[:10]}",
        display_name="草稿测试用户",
        password_hash="not-used",
        account_type="ENGINEER",
    )
    product = Product(
        part_number=f"DRAFT-{uuid.uuid4().hex[:8]}",
        normalized_part_number=uuid.uuid4().hex,
        brand="PartSignal",
        normalized_brand=f"partsignal-{uuid.uuid4().hex[:8]}",
        category="TEST",
    )
    db.add_all([actor, product])
    db.flush()
    platform_type = PlatformType(
        name="草稿测试平台类型",
        slug=f"draft-type-{uuid.uuid4().hex[:8]}",
        created_by=actor.id,
    )
    db.add(platform_type)
    db.flush()
    fact = FactVersion(
        product_id=product.id,
        version=1,
        status="APPROVED",
        body_markdown="批准事实",
        classification="PUBLIC",
        change_summary="批准事实",
        created_by=actor.id,
        approved_by=actor.id,
    )
    profile = PlatformProfile(
        name="草稿测试平台",
        slug=f"draft-platform-{uuid.uuid4().hex[:8]}",
        allowed_domains=["draft.example.invalid"],
        platform_type_id=platform_type.id,
    )
    db.add_all([fact, profile])
    db.flush()
    task = ContentTask(
        product_id=product.id,
        fact_version_id=fact.id,
        platform_profile_id=profile.id,
        platform_profile_name_snapshot=profile.name,
        created_by=actor.id,
    )
    db.add(task)
    db.flush()
    approved = ContentVersion(
        task_id=task.id,
        fact_version_id=fact.id,
        version=1,
        source_type="HUMAN",
        title="批准版本",
        summary="批准摘要",
        body_markdown="批准正文",
        tags=["批准"],
        content_hash="a" * 64,
        status="APPROVED",
        quality_issues=[],
        change_summary="批准版本",
        created_by=actor.id,
    )
    db.add(approved)
    db.flush()
    draft = ContentVersion(
        task_id=task.id,
        fact_version_id=fact.id,
        based_on_id=approved.id,
        version=2,
        source_type=draft_source_type,
        title="人工草稿",
        summary="草稿摘要",
        body_markdown="草稿正文",
        tags=["草稿"],
        content_hash="b" * 64,
        status="DRAFT",
        quality_issues=[],
        change_summary="人工草稿",
        created_by=actor.id,
    )
    db.add(draft)
    db.flush()
    task.current_content_version_id = draft.id
    db.commit()
    return actor, task, approved, draft


def _seed_manual_task(db: Session) -> tuple[User, ContentTask, ContentVersion]:
    """保留一个版本但清空当前指针，作为人工首稿 allocator 的基线。"""
    actor, task, approved, draft = _seed_draft(db)
    task.current_content_version_id = None
    db.flush()
    db.execute(
        text("SELECT set_config('partsignal.content_version_delete_id', :id, true)"),
        {"id": str(draft.id)},
    )
    db.delete(draft)
    db.commit()
    return actor, task, approved


def _revision_payload() -> ContentRevisionCreate:
    return ContentRevisionCreate(
        title="新修订",
        summary="新修订摘要",
        body_markdown="新修订正文",
        tags=["修订"],
        change_summary="测试修订",
    )


def _task_persistence_state(database_url: str, task_id: uuid.UUID) -> tuple[object, ...]:
    """读取任务、版本、审核、审计和作业计数，作为 rollback 的完整基线。"""
    with psycopg.connect(_psycopg_url(database_url)) as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT current_content_version_id, revision FROM content_tasks WHERE id = %s",
            (task_id,),
        )
        task_state = cursor.fetchone()
        cursor.execute(
            "SELECT id, version, title, summary, body_markdown, tags, status, revision, "
            "source_job_id FROM content_versions WHERE task_id = %s ORDER BY version",
            (task_id,),
        )
        versions = tuple(cursor.fetchall())
        cursor.execute(
            "SELECT count(*) FROM content_review_records r JOIN content_versions v "
            "ON v.id = r.content_version_id WHERE v.task_id = %s",
            (task_id,),
        )
        reviews = cursor.fetchone()[0]
        cursor.execute("SELECT count(*) FROM audit_logs")
        audits = cursor.fetchone()[0]
        cursor.execute(
            "SELECT count(*) FROM generation_jobs WHERE content_task_id = %s", (task_id,)
        )
        jobs = cursor.fetchone()[0]
    return (*task_state, versions, reviews, audits, jobs)


def _insert_duplicate_task_version(db: Session, candidate_id: uuid.UUID) -> None:
    """在当前事务中用参数绑定复制版本，真实触发 task/version 唯一约束。"""
    db.execute(
        text(
            "INSERT INTO content_versions "
            "(id, task_id, fact_version_id, source_job_id, based_on_id, version, source_type, "
            "title, summary, body_markdown, tags, content_hash, status, revision, quality_issues, "
            "change_summary, created_by) "
            "SELECT :new_id, task_id, fact_version_id, source_job_id, based_on_id, version, "
            "source_type, title, summary, body_markdown, tags, content_hash, status, revision, "
            "quality_issues, change_summary, created_by FROM content_versions "
            "WHERE id = :candidate_id"
        ),
        {"new_id": uuid.uuid4(), "candidate_id": candidate_id},
    )


@pytest.mark.integration
def test_human_draft_can_be_saved_then_deleted_with_parent_pointer_restored() -> None:
    """保存只更新正文载荷和 revision，删除恢复直接父版本并写最小审计。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            actor, task, approved, draft = _seed_draft(db)
            saved = update_content_draft(
                db=db,
                content_version_id=draft.id,
                payload=ContentDraftUpdate(
                    expected_revision=0,
                    title="已保存草稿",
                    summary="已保存摘要",
                    body_markdown="已保存正文",
                    tags=["草稿", "已保存"],
                ),
                actor=actor,
                request_id="save-content-draft",
            )
            assert (saved.version, saved.based_on_id, saved.revision) == (2, approved.id, 1)
            assert saved.content_hash == content_hash(
                saved.title, saved.summary, saved.body_markdown, saved.tags
            )

            with pytest.raises(AppError, match="内容版本已被其他请求修改") as stale_error:
                update_content_draft(
                    db=db,
                    content_version_id=draft.id,
                    payload=ContentDraftUpdate(
                        expected_revision=0,
                        title="过期修改",
                        summary="过期摘要",
                        body_markdown="过期正文",
                        tags=["过期"],
                    ),
                    actor=actor,
                    request_id="stale-save-content-draft",
                )
            assert stale_error.value.code == "REVISION_CONFLICT"
            assert stale_error.value.status_code == 409
            db.rollback()

            delete_content_draft(
                db=db,
                content_version_id=draft.id,
                expected_revision=1,
                actor=actor,
                request_id="delete-content-draft",
            )
            db.expire_all()
            assert db.get(ContentVersion, draft.id) is None
            assert db.get(ContentTask, task.id).current_content_version_id == approved.id  # type: ignore[union-attr]
            audit = db.scalar(select(AuditLog).where(AuditLog.request_id == "delete-content-draft"))
            assert audit is not None
            assert audit.action == "content_version.deleted"
            assert audit.details == {"facts": {"task_id": str(task.id), "version": 2}}


@pytest.mark.integration
@pytest.mark.parametrize("mode", ["manual", "revision"])
def test_content_version_task_identity_violation_rolls_back_and_reuses_session(
    mode: str,
) -> None:
    """人工 allocator 命中真实 task/version 约束后同一 Session 可继续查询。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            if mode == "manual":
                actor, task, existing = _seed_manual_task(db)
                duplicate_version = existing.version
                source_id = None
            else:
                actor, task, existing, source = _seed_draft(db, draft_source_type="AI")
                duplicate_version = source.version
                source_id = source.id

            def force_task_identity(
                session: Session, _flush_context: object, _instances: object
            ) -> None:
                for pending in session.new:
                    if isinstance(pending, ContentVersion):
                        pending.version = duplicate_version

            event.listen(Session, "before_flush", force_task_identity)
            try:
                with pytest.raises(IntegrityError) as captured:
                    if mode == "manual":
                        create_manual_content_version(
                            db=db,
                            content_task_id=task.id,
                            payload=_revision_payload(),
                            actor=actor,
                            request_id=f"{mode}-identity",
                        )
                    else:
                        assert source_id is not None
                        create_content_revision(
                            db=db,
                            content_version_id=source_id,
                            payload=_revision_payload(),
                            actor=actor,
                            request_id=f"{mode}-identity",
                        )
            finally:
                event.remove(Session, "before_flush", force_task_identity)

            assert captured.value.orig.sqlstate == "23505"
            assert captured.value.orig.diag.constraint_name == "uq_content_versions_task_id"
            db.rollback()
            assert db.get(ContentTask, task.id) is not None
            assert db.query(ContentVersion).filter(ContentVersion.task_id == task.id).count() == (
                1 if mode == "manual" else 2
            )
            refreshed_task = db.get(ContentTask, task.id)
            assert refreshed_task is not None
            assert refreshed_task.revision == 0


@pytest.mark.integration
@pytest.mark.parametrize("mode", ["manual", "revision"])
def test_human_content_late_identity_failure_rolls_back_after_flush(
    mode: str,
) -> None:
    """人工首稿和修订在候选已 flush 后命中真实约束仍完整回滚。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            if mode == "manual":
                actor, task, _existing = _seed_manual_task(db)
                source_id = None
            else:
                actor, task, _approved, source = _seed_draft(db, draft_source_type="AI")
                source_id = source.id
            baseline = _task_persistence_state(database_url, task.id)
            flushed: list[tuple[uuid.UUID, uuid.UUID | None, int]] = []
            observed: list[IntegrityError] = []
            baseline_pointer = task.current_content_version_id

            def fail_after_service_flush(session: Session) -> None:
                candidate_id = next(
                    (
                        item.current_content_version_id
                        for item in session.identity_map.values()
                        if isinstance(item, ContentTask)
                        and item.id == task.id
                        and item.current_content_version_id != baseline_pointer
                    ),
                    None,
                )
                if candidate_id is None or observed:
                    return
                session.flush()
                candidate = session.get(ContentVersion, candidate_id)
                current_task = session.get(ContentTask, task.id)
                assert candidate is not None and current_task is not None
                flushed.append(
                    (candidate.id, current_task.current_content_version_id, current_task.revision)
                )
                try:
                    _insert_duplicate_task_version(session, candidate.id)
                except IntegrityError as error:
                    observed.append(error)
                    raise

            event.listen(Session, "before_commit", fail_after_service_flush)
            try:
                with pytest.raises(IntegrityError):
                    if mode == "manual":
                        create_manual_content_version(
                            db=db,
                            content_task_id=task.id,
                            payload=_revision_payload(),
                            actor=actor,
                            request_id=f"{mode}-late-identity",
                        )
                    else:
                        assert source_id is not None
                        create_content_revision(
                            db=db,
                            content_version_id=source_id,
                            payload=_revision_payload(),
                            actor=actor,
                            request_id=f"{mode}-late-identity",
                        )
            finally:
                event.remove(Session, "before_commit", fail_after_service_flush)
            db.rollback()
            assert db.get(ContentTask, task.id) is not None
            assert (
                db.query(ContentVersion).filter(ContentVersion.task_id == task.id).count()
                == len(baseline[2])
            )

        assert len(observed) == 1
        assert observed[0].orig.sqlstate == "23505"
        assert observed[0].orig.diag.constraint_name == "uq_content_versions_task_id"
        assert len(flushed) == 1
        assert flushed[0][1] == flushed[0][0]
        assert flushed[0][2] == baseline[1] + 1
        assert _task_persistence_state(database_url, task.id) == baseline


@pytest.mark.integration
@pytest.mark.parametrize("mode", ["manual", "revision"])
def test_content_version_task_identity_violation_reaches_unknown_http_500(
    monkeypatch: pytest.MonkeyPatch, mode: str
) -> None:
    """人工首稿和修订的未知唯一约束保持默认 500 且不泄露数据库细节。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        sessions = sessionmaker(bind=engine, expire_on_commit=False, class_=Session)
        monkeypatch.setattr(app_db, "SessionLocal", sessions)
        with sessions() as db:
            if mode == "manual":
                actor, task, existing = _seed_manual_task(db)
                source_id = None
                duplicate_version = existing.version
            else:
                actor, task, existing, source = _seed_draft(db, draft_source_type="AI")
                source_id = source.id
                duplicate_version = source.version
            baseline = _task_persistence_state(database_url, task.id)

        rollback_reused: list[tuple[object, ...]] = []
        original_rollback = Session.rollback

        def observe_rollback(session: Session, *args: object, **kwargs: object) -> object:
            result = original_rollback(session, *args, **kwargs)
            restored_task = session.get(ContentTask, task.id)
            assert restored_task is not None
            rollback_reused.append(
                (
                    restored_task.current_content_version_id,
                    restored_task.revision,
                    session.query(ContentVersion)
                    .filter(ContentVersion.task_id == task.id)
                    .count(),
                )
            )
            return result

        monkeypatch.setattr(Session, "rollback", observe_rollback)

        def force_task_identity(
            session: Session, _flush_context: object, _instances: object
        ) -> None:
            for pending in session.new:
                if isinstance(pending, ContentVersion):
                    pending.version = duplicate_version

        event.listen(Session, "before_flush", force_task_identity)
        try:
            api = FastAPI(debug=False)
            api.add_exception_handler(AppError, app_error_handler)
            api.middleware("http")(request_context)
            db_dependency = Depends(app_db.get_db)

            @api.post("/invoke")
            def invoke(db: Session = db_dependency) -> dict[str, str]:
                current_actor = db.get(User, actor.id)
                assert current_actor is not None
                if mode == "manual":
                    create_manual_content_version(
                        db=db,
                        content_task_id=task.id,
                        payload=_revision_payload(),
                        actor=current_actor,
                        request_id="content-identity-http",
                    )
                else:
                    assert source_id is not None
                    create_content_revision(
                        db=db,
                        content_version_id=source_id,
                        payload=_revision_payload(),
                        actor=current_actor,
                        request_id="content-identity-http",
                    )
                return {"status": "ok"}

            with TestClient(api, raise_server_exceptions=False) as client:
                response = client.post("/invoke", headers={"X-Request-ID": f"{mode}-500"})
        finally:
            event.remove(Session, "before_flush", force_task_identity)
            engine.dispose()

        assert response.status_code == 500
        assert "uq_content_versions_task_id" not in response.text
        assert "duplicate key" not in response.text
        assert "content_versions" not in response.text
        assert "REVISION_CONFLICT" not in response.text
        forbidden = (
            "sql",
            "constraint",
            "duplicate key",
            "content_versions",
            "traceback",
            "psycopg",
            "sqlalchemy",
        )
        response_metadata = " ".join(
            f"{key}:{value}" for key, value in response.headers.items()
        ).lower()
        assert not any(token in response_metadata for token in forbidden)
        assert len(rollback_reused) == 1
        assert _task_persistence_state(database_url, task.id) == baseline


@pytest.mark.integration
def test_expected_revision_conflict_remains_real_http_409(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """真实草稿保存的旧 revision 仍返回既有 REVISION_CONFLICT 合同。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        sessions = sessionmaker(bind=engine, expire_on_commit=False, class_=Session)
        with sessions() as db:
            actor, task, _approved, draft = _seed_draft(db)

        api = FastAPI(debug=False)
        api.add_exception_handler(AppError, app_error_handler)
        api.middleware("http")(request_context)
        db_dependency = Depends(app_db.get_db)

        @api.post("/invoke")
        def invoke(expected_revision: int, db: Session = db_dependency) -> dict[str, int]:
            actor_obj = db.get(User, actor.id)
            assert actor_obj is not None
            saved = update_content_draft(
                db=db,
                content_version_id=draft.id,
                payload=ContentDraftUpdate(
                    expected_revision=expected_revision,
                    title="第一次保存",
                    summary="第一次摘要",
                    body_markdown="第一次正文",
                    tags=["revision"],
                ),
                actor=actor_obj,
                request_id="http-revision-conflict",
            )
            return {"revision": saved.revision}

        monkeypatch.setattr(app_db, "SessionLocal", sessions)
        with TestClient(api, raise_server_exceptions=False) as client:
            first = client.post("/invoke", params={"expected_revision": 0})
            stale = client.post("/invoke", params={"expected_revision": 0})
        engine.dispose()

        assert first.status_code == 200
        assert first.json() == {"revision": 1}
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "REVISION_CONFLICT"


@pytest.mark.integration
@pytest.mark.parametrize("mode", ["manual", "revision"])
def test_revision_allocator_waits_for_task_lock_before_max_version(mode: str) -> None:
    """修订与首稿一样先等待 Task 锁，再读取版本号。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            if mode == "manual":
                actor, task, existing = _seed_manual_task(db)
                source_id = None
                existing_version = existing.version
            else:
                actor, task, _approved, source = _seed_draft(db, draft_source_type="AI")
                source_id = source.id
                existing_version = source.version
            task_id, actor_id = task.id, actor.id

        blocker = psycopg.connect(_psycopg_url(database_url))
        blocker_cursor = blocker.cursor()
        blocker_cursor.execute("SELECT id FROM content_tasks WHERE id = %s FOR UPDATE", (task_id,))
        started = threading.Event()

        def create_after_lock() -> tuple[uuid.UUID, int]:
            started.set()
            with Session(engine) as db:
                actor_obj = db.get(User, actor_id)
                assert actor_obj is not None
                if mode == "manual":
                    result = create_manual_content_version(
                        db=db, content_task_id=task_id, payload=_revision_payload(),
                        actor=actor_obj, request_id="manual-revision-lock",
                    )
                else:
                    assert source_id is not None
                    result = create_content_revision(
                        db=db, content_version_id=source_id, payload=_revision_payload(),
                        actor=actor_obj, request_id="content-revision-lock",
                    )
                return result.id, result.version

        executor = ThreadPoolExecutor(max_workers=1)
        future = executor.submit(create_after_lock)
        waiting = False
        try:
            assert started.wait(timeout=5)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                with (
                    psycopg.connect(_psycopg_url(database_url)) as observer,
                    observer.cursor() as cursor,
                ):
                    cursor.execute(
                        "SELECT count(*) FROM pg_stat_activity "
                        "WHERE wait_event_type = 'Lock' AND state = 'active' "
                        "AND query ILIKE '%content_tasks%'"
                    )
                    waiting = cursor.fetchone()[0] > 0
                if waiting:
                    break
                time.sleep(0.05)
        finally:
            blocker.commit()
            blocker_cursor.close()
            blocker.close()
            created_id, created_version = future.result(timeout=10)
            executor.shutdown(wait=True)

        assert waiting
        assert created_version == existing_version + 1
        with Session(engine) as db:
            refreshed = db.get(ContentTask, task_id)
            assert refreshed is not None
            assert refreshed.current_content_version_id == created_id
            assert refreshed.revision == 1
        engine.dispose()


@pytest.mark.integration
def test_two_legal_manual_creations_serialize_and_second_hits_mainline_guard() -> None:
    """两个合法首稿竞争依靠 Task 锁串行化，后到请求命中主线守卫。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            actor, task, _approved = _seed_manual_task(db)
            task_id, actor_id = task.id, actor.id

        def create() -> object:
            with Session(engine) as db:
                actor_obj = db.get(User, actor_id)
                assert actor_obj is not None
                try:
                    created = create_manual_content_version(
                        db=db, content_task_id=task_id, payload=_revision_payload(),
                        actor=actor_obj, request_id="legal-manual-race",
                    )
                    return created.id
                except AppError as error:
                    return error

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(create) for _ in range(2)]
            results = [future.result(timeout=10) for future in futures]

        assert sum(isinstance(result, uuid.UUID) for result in results) == 1
        winner_id = next(result for result in results if isinstance(result, uuid.UUID))
        errors = [result for result in results if isinstance(result, AppError)]
        assert len(errors) == 1
        assert errors[0].code == "CONTENT_MAINLINE_EXISTS"
        with Session(engine) as db:
            assert db.query(ContentVersion).filter(ContentVersion.task_id == task_id).count() == 2
            current_task = db.get(ContentTask, task_id)
            assert current_task is not None
            assert current_task.current_content_version_id == winner_id
        engine.dispose()


@pytest.mark.integration
def test_review_reference_blocks_human_draft_save_and_delete() -> None:
    """一旦存在审核记录，应用层保存和删除都必须显式拒绝。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            actor, _task, _approved, draft = _seed_draft(db)
            db.add(
                ContentReviewRecord(
                    content_version_id=draft.id,
                    action="SUBMIT_REVIEW",
                    comment="已进入审核",
                    actor_id=actor.id,
                )
            )
            db.commit()

            with pytest.raises(AppError) as save_error:
                update_content_draft(
                    db=db,
                    content_version_id=draft.id,
                    payload=ContentDraftUpdate(
                        expected_revision=0,
                        title=draft.title,
                        summary=draft.summary,
                        body_markdown=draft.body_markdown,
                        tags=draft.tags,
                    ),
                    actor=actor,
                    request_id="reviewed-save-content-draft",
                )
            assert save_error.value.code == "INVALID_STATE_TRANSITION"
            db.rollback()

            with pytest.raises(AppError) as delete_error:
                delete_content_draft(
                    db=db,
                    content_version_id=draft.id,
                    expected_revision=0,
                    actor=actor,
                    request_id="reviewed-delete-content-draft",
                )
            assert delete_error.value.code == "CONTENT_VERSION_IN_USE"
            assert delete_error.value.details == {
                "references": [{"type": "CONTENT_REVIEW_RECORD", "count": 1}]
            }
            db.rollback()
