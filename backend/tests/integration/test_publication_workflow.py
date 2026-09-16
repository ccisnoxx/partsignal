"""新发布工作、首次核验成果和发布后内容问题的 PostgreSQL 集成测试。"""

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
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from sqlalchemy import create_engine, delete, event, func, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.models.ai_generation import GenerationJob
from app.models.configuration import PlatformProfile, PlatformPrompt, PlatformType, QueryTopic
from app.models.content import ContentTask, ContentTaskGeoSource, ContentVersion
from app.models.geo_files import (
    FileRecord,
    GeoObservation,
    GeoObservationCitation,
    GeoObservationPublication,
)
from app.models.identity import AuditLog, User
from app.models.product_facts import FactReviewRecord, FactVersion, Product
from app.models.publication import (
    PlatformAccount,
    PublicationAttachment,
    PublicationVerification,
    PublicationWork,
    PublicationWorkEvent,
    PublishedArticle,
    PublishedContentIssue,
)
from app.schemas.common import RevisionRequest
from app.schemas.content import (
    ContentDraftUpdate,
    ContentRevisionCreate,
    ContentTaskPermanentDeleteRequest,
)
from app.schemas.product_facts import (
    FactReviewSubmissionRequest,
    ProductCreate,
    ProductFactsDraftUpdate,
    ProductFactStatus,
    ProductSort,
    ProductWorkflowStage,
)
from app.schemas.publication import (
    PublicationContentVersionSwitchRequest,
    PublicationPlatformReviewRequest,
    PublicationPreparationUpdate,
    PublicationResultUpdate,
    PublicationVerificationCreate,
    PublicationWorkCloseRequest,
    PublicationWorkCreate,
    PublicationWorkOut,
    PublishedArticlePermanentDeleteRequest,
    PublishedArticleSort,
    PublishedContentIssueCreate,
    PublishedContentIssueResolveRequest,
    PublishedContentRepairTaskCreate,
)
from app.security import hash_token
from app.services import publication as publication_service
from app.services.content_planning import delete_query_topic, query_topics_out
from app.services.content_production import create_content_revision, update_content_draft
from app.services.geo_observation import geo_publication_candidates
from app.services.platform_configuration import (
    delete_platform_profile,
    delete_platform_prompt,
    set_platform_profile_enabled,
)
from app.services.product_facts import (
    create_product,
    delete_product,
    list_products,
    replace_product_facts,
    submit_fact_review,
)
from app.services.projections import content_task_out
from app.services.publication import (
    archive_content_task,
    close_publication_work,
    create_publication_work,
    create_repair_task,
    delete_content_task,
    delete_platform_account,
    mark_publication_platform_review,
    open_published_content_issue,
    permanently_delete_content_task,
    permanently_delete_published_article,
    preview_content_task_permanent_deletion,
    preview_published_article_permanent_deletion,
    register_publication_result,
    resolve_published_content_issue,
    restore_content_task,
    switch_publication_content_version,
    update_publication_preparation,
    verify_publication_work,
)
from app.services.publication_queries import (
    list_publication_ready_items,
    list_publication_works,
    list_published_articles,
    list_published_content_issues,
    publication_work_out,
    publication_workbench_summary,
    publication_workspace_context,
    published_article_out,
    published_content_issue_workspace_context,
)
from app.services.review import transition_content_version, transition_fact_version


def _psycopg_url(value: str) -> str:
    return value.replace("postgresql+psycopg://", "postgresql://", 1)


def _replace_database(value: str, database_name: str) -> str:
    parts = urlsplit(_psycopg_url(value))
    return urlunsplit(
        (parts.scheme, parts.netloc, f"/{database_name}", parts.query, parts.fragment)
    )


@contextmanager
def temporary_database() -> Iterator[str]:
    """创建独立 PostgreSQL 数据库并迁移到当前 head。"""
    source_url = os.getenv("PARTSIGNAL_TEST_DATABASE_URL")
    if source_url is None and os.getenv("APP_ENV") == "test":
        source_url = os.getenv("DATABASE_URL")
    if not source_url:
        pytest.skip("未设置 PostgreSQL 测试环境，不以 SQLite 替代 PostgreSQL")
    database_name = f"partsignal_publication_{uuid.uuid4().hex[:10]}"
    with psycopg.connect(_psycopg_url(source_url), autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
    test_url = _replace_database(source_url, database_name)
    sqlalchemy_url = test_url.replace("postgresql://", "postgresql+psycopg://", 1)
    backend_dir = Path(__file__).resolve().parents[2]
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        check=True,
        cwd=backend_dir,
        env={**os.environ, "DATABASE_URL": sqlalchemy_url},
    )
    try:
        yield sqlalchemy_url
    finally:
        with psycopg.connect(_psycopg_url(source_url), autocommit=True) as admin:
            admin.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database_name))
            )


def _seed_graph(db: Session, *, content_hash: str = "a" * 64) -> dict[str, object]:
    """创建发布闭环需要的最小真实业务图。"""
    user = User(
        username=f"publication-{uuid.uuid4().hex[:10]}",
        display_name="发布流程测试用户",
        password_hash="not-used",
        account_type="ENGINEER",
    )
    product = Product(
        part_number=f"PS-{uuid.uuid4().hex[:8]}",
        normalized_part_number=uuid.uuid4().hex,
        brand="PartSignal",
        normalized_brand=f"partsignal-{uuid.uuid4().hex[:8]}",
        category="MCU",
    )
    db.add_all([user, product])
    db.flush()
    fact = FactVersion(
        product_id=product.id,
        version=1,
        status="APPROVED",
        body_markdown="## 参数\n\n典型工作电压为 3.3 V。",
        classification="PUBLIC",
        change_summary="初始批准事实",
        created_by=user.id,
        approved_by=user.id,
    )
    topic = QueryTopic(
        canonical_question="如何选择测试器件？",
        intent_type="PRODUCT",
        variants=["测试器件选型"],
    )
    platform_type = PlatformType(
        name="技术社区",
        slug=f"community-{uuid.uuid4().hex[:8]}",
        created_by=user.id,
    )
    db.add_all([fact, topic, platform_type])
    db.flush()
    profile = PlatformProfile(
        name="工程师社区",
        slug=f"engineer-{uuid.uuid4().hex[:8]}",
        allowed_domains=["community.example.invalid"],
        platform_type_id=platform_type.id,
    )
    db.add(profile)
    db.flush()
    task = ContentTask(
        query_topic_id=topic.id,
        product_id=product.id,
        fact_version_id=fact.id,
        platform_profile_id=profile.id,
        platform_profile_name_snapshot=profile.name,
        platform_website_url_snapshot=profile.website_url,
        created_by=user.id,
    )
    db.add(task)
    db.flush()
    content = ContentVersion(
        task_id=task.id,
        fact_version_id=fact.id,
        version=1,
        source_type="HUMAN",
        title="测试器件选型",
        summary="冻结事实摘要",
        body_markdown="# 测试器件\n\n典型工作电压为 3.3 V。",
        tags=["PS"],
        content_hash=content_hash,
        status="APPROVED",
        quality_issues=[],
        change_summary="测试内容",
        created_by=user.id,
    )
    account = PlatformAccount(
        platform_profile_id=profile.id,
        label="运营账号",
        account_identifier=f"account-{uuid.uuid4().hex[:8]}",
    )
    db.add_all([content, account])
    db.flush()
    task.current_content_version_id = content.id
    db.commit()
    return {
        "user": user,
        "product": product,
        "fact": fact,
        "profile": profile,
        "topic": topic,
        "task": task,
        "content": content,
        "account": account,
    }


@pytest.mark.integration
def test_fact_version_current_head_catalog_and_unique_diagnostics() -> None:
    """current-head PostgreSQL catalog 与两条事实版本唯一冲突保持精确。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            product = graph["product"]
            assert isinstance(actor, User)
            assert isinstance(product, Product)

            catalog = {
                row["index_name"]: row
                for row in db.execute(
                    text(
                        """
                        SELECT
                            index_class.relname AS index_name,
                            index_info.indisunique,
                            pg_get_indexdef(index_class.oid) AS index_definition,
                            pg_get_expr(index_info.indpred, index_info.indrelid) AS predicate,
                            constraint_info.conname AS constraint_name
                        FROM pg_class AS index_class
                        JOIN pg_index AS index_info ON index_info.indexrelid = index_class.oid
                        LEFT JOIN pg_constraint AS constraint_info
                            ON constraint_info.conindid = index_class.oid
                        WHERE index_class.relname IN (
                            'uq_fact_versions_product_id',
                            'uq_fact_versions_one_pending_per_product'
                        )
                        """
                    )
                ).mappings()
            }
            version_index = catalog["uq_fact_versions_product_id"]
            pending_index = catalog["uq_fact_versions_one_pending_per_product"]
            assert version_index["indisunique"] is True
            assert "product_id, version" in version_index["index_definition"]
            assert version_index["predicate"] is None
            assert version_index["constraint_name"] == "uq_fact_versions_product_id"
            assert pending_index["indisunique"] is True
            assert "product_id)" in pending_index["index_definition"]
            predicate = str(pending_index["predicate"]).lower()
            assert "status" in predicate
            assert "pending_review" in predicate
            assert pending_index["constraint_name"] is None

            version_conflict = FactVersion(
                id=uuid.uuid4(),
                product_id=product.id,
                version=1,
                status="CHANGES_REQUESTED",
                body_markdown="版本身份冲突",
                classification="PUBLIC",
                change_summary="测试版本身份",
                created_by=actor.id,
            )
            db.add(version_conflict)
            with pytest.raises(IntegrityError) as version_error:
                db.flush()
            assert version_error.value.orig.sqlstate == "23505"
            assert (
                version_error.value.orig.diag.constraint_name
                == "uq_fact_versions_product_id"
            )
            db.rollback()

            pending = FactVersion(
                id=uuid.uuid4(),
                product_id=product.id,
                version=2,
                status="PENDING_REVIEW",
                body_markdown="既有待审核事实",
                classification="PUBLIC",
                change_summary="建立待审核基线",
                created_by=actor.id,
            )
            db.add(pending)
            db.commit()
            pending_conflict = FactVersion(
                id=uuid.uuid4(),
                product_id=product.id,
                version=3,
                status="PENDING_REVIEW",
                body_markdown="待审核冲突",
                classification="PUBLIC",
                change_summary="测试待审核唯一约束",
                created_by=actor.id,
            )
            db.add(pending_conflict)
            with pytest.raises(IntegrityError) as pending_error:
                db.flush()
            assert pending_error.value.orig.sqlstate == "23505"
            assert (
                pending_error.value.orig.diag.constraint_name
                == "uq_fact_versions_one_pending_per_product"
            )
            db.rollback()
            assert db.get(FactVersion, pending.id) is not None
            assert db.get(FactVersion, pending_conflict.id) is None


def _work_payload(graph: dict[str, object]) -> PublicationWorkCreate:
    content, account = graph["content"], graph["account"]
    assert isinstance(content, ContentVersion)
    assert isinstance(account, PlatformAccount)
    return PublicationWorkCreate(content_version_id=content.id, platform_account_id=account.id)


def _additional_publication_content(
    db: Session,
    graph: dict[str, object],
    *,
    same_task: bool,
    content_hash: str,
    make_current: bool = True,
) -> ContentVersion:
    """建立共享平台的合法批准版本；同任务换版保留旧批准版本。"""
    original, task, actor = graph["content"], graph["task"], graph["user"]
    assert isinstance(original, ContentVersion)
    assert isinstance(task, ContentTask)
    assert isinstance(actor, User)
    if same_task and make_current:
        original.status = "SUPERSEDED"
        original.revision += 1
        db.flush()
    if not same_task:
        task = ContentTask(
            query_topic_id=task.query_topic_id,
            product_id=task.product_id,
            fact_version_id=task.fact_version_id,
            platform_profile_id=task.platform_profile_id,
            platform_profile_name_snapshot=task.platform_profile_name_snapshot,
            platform_website_url_snapshot=task.platform_website_url_snapshot,
            created_by=actor.id,
        )
        db.add(task)
        db.flush()
    content = ContentVersion(
        task_id=task.id,
        fact_version_id=original.fact_version_id,
        version=2 if same_task else 1,
        source_type="HUMAN",
        title=original.title,
        summary=original.summary,
        body_markdown=original.body_markdown,
        change_summary="唯一约束测试批准版本",
        tags=original.tags,
        content_hash=content_hash,
        status="APPROVED" if make_current else "PENDING_REVIEW",
        quality_issues=[],
        created_by=actor.id,
    )
    db.add(content)
    db.flush()
    if make_current:
        task.current_content_version_id = content.id
    db.commit()
    return content


def _publication_creation_snapshot(db: Session) -> dict[str, object]:
    """记录创建失败不得残留的持久对象及任务状态，不把 winner 增量算作 loser。"""
    db.expire_all()
    tables = (
        PublicationWork,
        PublicationWorkEvent,
        PublicationVerification,
        PublishedArticle,
        PublicationAttachment,
        GeoObservationPublication,
        GeoObservationCitation,
        ContentTaskGeoSource,
    )
    return {
        **{
            model.__tablename__: db.scalar(select(func.count()).select_from(model))
            for model in tables
        },
        "success_audit": db.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.outcome == "SUCCESS")
        ),
        "tasks": list(
            db.execute(
                select(
                    ContentTask.id,
                    ContentTask.status,
                    ContentTask.revision,
                    ContentTask.current_content_version_id,
                ).order_by(ContentTask.id)
            )
        ),
        "work_state": list(
            db.execute(
                select(
                    PublicationWork.id, PublicationWork.status, PublicationWork.revision
                ).order_by(PublicationWork.id)
            )
        ),
    }


def _open_issue_snapshot(db: Session) -> dict[str, object]:
    """Issue 失败原子性包含全部历史行、来源绑定和既有发布聚合。"""
    return {
        **_publication_creation_snapshot(db),
        "issues": list(
            db.execute(select(PublishedContentIssue.__table__).order_by(PublishedContentIssue.id))
        ),
        "article_bindings": list(
            db.execute(
                select(PublishedArticle.id, PublishedArticle.verification_id).order_by(
                    PublishedArticle.id
                )
            )
        ),
        "repair_sources": list(
            db.execute(
                select(ContentTask.id, ContentTask.source_published_content_issue_id).order_by(
                    ContentTask.id
                )
            )
        ),
    }


def _bypass_open_issue_precheck(patch: pytest.MonkeyPatch, db: Session) -> None:
    """只隐藏该 Session 首次 Issue 读取；存在性检查和全部数据库 guard 保留。"""
    real_scalars = db.scalars
    pending = True

    def scalars(statement: object, *args: object, **kwargs: object) -> object:
        nonlocal pending
        if pending and "FROM published_content_issues" in str(statement):
            pending = False
            return iter(())
        return real_scalars(statement, *args, **kwargs)

    patch.setattr(db, "scalars", scalars)


def _assert_open_issue_conflict(error: AppError) -> None:
    assert (error.status_code, error.code, error.message, error.details) == (
        409,
        "PUBLISHED_CONTENT_ISSUE_CONFLICT",
        "文章已有开放问题或已退役",
        {},
    )


@pytest.mark.parametrize(
    "state,name",
    [
        ("23505", "pk_published_content_issues"),
        ("23505", "uq_content_tasks_source_published_content_issue_id"),
        ("23505", "uq_publication_works_content_task_id"),
        ("23505", "uq_published_content_issues_one_open_suffix"),
        ("23505", " UQ_PUBLISHED_CONTENT_ISSUES_ONE_OPEN"),
        ("23505", b"uq_published_content_issues_one_open"),
        ("23505", ["uq_published_content_issues_one_open"]),
        ("23505", None),
        (None, "uq_published_content_issues_one_open"),
        ("23503", "uq_published_content_issues_one_open"),
        ("23514", "uq_published_content_issues_one_open"),
        ("23502", "uq_published_content_issues_one_open"),
        ("55000", "uq_published_content_issues_one_open"),
    ],
)
def test_open_issue_integrity_classifier_fails_closed(state: object, name: object) -> None:
    class DiagnosticsOnly:
        sqlstate = state
        diag = SimpleNamespace(constraint_name=name) if name is not None else None
        constraint_name = "uq_published_content_issues_one_open"

        def __str__(self) -> str:
            raise AssertionError("classifier 不得读取 driver message")

    assert not publication_service._is_open_issue_integrity_error(
        IntegrityError("uq_published_content_issues_one_open", {}, DiagnosticsOnly())
    )


@pytest.mark.integration
def test_open_issue_catalog_real_diagnostics_and_unknown_guards() -> None:
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            row = (
                db.execute(
                    text("""
                SELECT c.relname, t.relname AS table_name, i.indisunique,
                       pg_get_indexdef(c.oid, 1, true) AS key,
                       i.indnkeyatts, pg_get_expr(i.indpred, i.indrelid) AS predicate,
                       k.conname
                FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
                JOIN pg_class t ON t.oid = i.indrelid
                LEFT JOIN pg_constraint k ON k.conindid = c.oid
                WHERE c.relname = 'uq_published_content_issues_one_open'
            """)
                )
                .mappings()
                .one()
            )
            assert row["table_name"] == "published_content_issues"
            assert row["indisunique"] and row["conname"] is None
            assert row["indnkeyatts"] == 1 and row["key"] == "published_article_id"
            assert row["predicate"] == "((status)::text = 'OPEN'::text)"
            graph = _seed_graph(db)
            actor = graph["user"]
            assert isinstance(actor, User)
            issue = _open_repair_issue(db, graph, suffix="issue-catalog")
            article_id, actor_id = issue.published_article_id, actor.id
            baseline = _open_issue_snapshot(db)
            check_names = dict(
                db.execute(
                    text("""
                SELECT pg_get_constraintdef(oid), conname FROM pg_constraint
                WHERE conrelid = 'published_content_issues'::regclass AND contype = 'c'
            """)
                ).all()
            )
            kind_check = next(
                name for definition, name in check_names.items() if "kind" in definition
            )
            description_check = next(
                name for definition, name in check_names.items() if "description" in definition
            )
            cases = [
                ({}, "23505", "uq_published_content_issues_one_open"),
                ({"id": issue.id}, "23505", "pk_published_content_issues"),
                ({"kind": "INVALID"}, "23514", kind_check),
                ({"description": " "}, "23514", description_check),
                ({"description": None}, "23502", None),
                (
                    {"published_article_id": uuid.uuid4()},
                    "23503",
                    "fk_published_content_issues_article",
                ),
                ({"revision": 1}, "23514", None),
            ]
            for overrides, state, constraint in cases:
                values = dict(
                    published_article_id=article_id,
                    opened_by=actor_id,
                    kind="OTHER",
                    description="诊断哨兵",
                    status="OPEN",
                )
                values.update(overrides)
                db.add(PublishedContentIssue(**values))
                with pytest.raises(IntegrityError) as raised:
                    db.flush()
                assert (raised.value.orig.sqlstate, raised.value.orig.diag.constraint_name) == (
                    state,
                    constraint,
                )
                assert publication_service._is_open_issue_integrity_error(raised.value) == (
                    constraint == "uq_published_content_issues_one_open"
                )
                db.rollback()
                assert _open_issue_snapshot(db) == baseline
            for statement in (
                update(PublishedContentIssue)
                .where(PublishedContentIssue.id == issue.id)
                .values(description="非法改写"),
                delete(PublishedContentIssue).where(PublishedContentIssue.id == issue.id),
            ):
                with pytest.raises(DBAPIError) as guard:
                    db.execute(statement)
                assert guard.value.orig.sqlstate == "55000"
                db.rollback()
                assert _open_issue_snapshot(db) == baseline
        engine.dispose()


@pytest.mark.integration
@pytest.mark.parametrize("bypass", [False, True], ids=["article-lock", "unique-race"])
def test_open_issue_concurrency_waits_at_exact_owner_and_has_one_winner(
    monkeypatch: pytest.MonkeyPatch,
    bypass: bool,
) -> None:
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as seed:
            graph = _seed_graph(seed)
            actor = graph["user"]
            assert isinstance(actor, User)
            article_id = _complete_publication(seed, graph, suffix="issue-race").id
            actor_id = actor.id
            baseline = _open_issue_snapshot(seed)
        held, release, ready, sent = (threading.Event() for _ in range(4))
        pids: dict[str, int] = {}
        diagnostics: list[tuple[str, str]] = []
        real_classifier = publication_service._is_open_issue_integrity_error

        def classify(error: IntegrityError) -> bool:
            diagnostics.append((error.orig.sqlstate, error.orig.diag.constraint_name))
            return real_classifier(error)

        monkeypatch.setattr(publication_service, "_is_open_issue_integrity_error", classify)

        def request(first: bool) -> object:
            with Session(engine, expire_on_commit=False) as db, monkeypatch.context() as patch:
                connection = db.connection()
                pids["winner" if first else "loser"] = int(
                    db.scalar(text("SELECT pg_backend_pid()"))
                )
                db.execute(text("SET LOCAL statement_timeout = '12s'"))
                if bypass:
                    _bypass_open_issue_precheck(patch, db)

                def before(
                    conn: object,
                    cursor: object,
                    statement: str,
                    parameters: object,
                    context: object,
                    executemany: bool,
                ) -> tuple[str, object]:
                    if bypass and "FROM published_articles" in statement:
                        statement = statement.replace(" FOR UPDATE", "")
                    if not first and statement.startswith("INSERT INTO published_content_issues "):
                        sent.set()
                    return statement, parameters

                def after(
                    conn: object,
                    cursor: object,
                    statement: str,
                    parameters: object,
                    context: object,
                    executemany: bool,
                ) -> None:
                    target = (
                        statement.startswith("INSERT INTO published_content_issues ")
                        if bypass
                        else "FROM published_articles" in statement and "FOR UPDATE" in statement
                    )
                    if first and target:
                        held.set()
                        if not release.wait(10):
                            raise TimeoutError("等待释放 Issue winner 超时")

                event.listen(connection, "before_cursor_execute", before, retval=True)
                event.listen(connection, "after_cursor_execute", after)
                try:
                    user = db.get(User, actor_id)
                    assert user is not None
                    if not first:
                        ready.set()
                    return open_published_content_issue(
                        db=db,
                        article_id=article_id,
                        actor=user,
                        request_id="issue-race",
                        payload=PublishedContentIssueCreate(kind="OTHER", description="并发问题"),
                    )
                except AppError as error:
                    _assert_open_issue_conflict(error)
                    # exact mapper 必须已 rollback；precheck 不会使事务进入 failed 状态。
                    assert db.scalar(select(func.count()).select_from(PublishedContentIssue)) == 1
                    return error
                finally:
                    event.remove(connection, "before_cursor_execute", before)
                    event.remove(connection, "after_cursor_execute", after)

        try:
            with ThreadPoolExecutor(max_workers=2) as executor:
                winner = executor.submit(request, True)
                loser = None
                try:
                    assert held.wait(10)
                    loser = executor.submit(request, False)
                    assert ready.wait(10)
                    deadline = time.monotonic() + 8
                    while time.monotonic() < deadline:
                        with engine.connect() as monitor:
                            state = (
                                monitor.execute(
                                    text("""
                                SELECT query, wait_event_type, pg_blocking_pids(pid) AS blockers
                                FROM pg_stat_activity WHERE pid = :pid
                            """),
                                    {"pid": pids["loser"]},
                                )
                                .mappings()
                                .one()
                            )
                        if (
                            state["wait_event_type"] == "Lock"
                            and pids["winner"] in state["blockers"]
                        ):
                            if bypass:
                                assert state["query"].startswith(
                                    "INSERT INTO published_content_issues "
                                )
                                assert sent.is_set()
                            else:
                                assert "FROM published_articles" in state["query"]
                                assert "FOR UPDATE" in state["query"]
                                assert not sent.is_set()
                            break
                        release.wait(0.02)
                    else:
                        pytest.fail(
                            "未观察到目标 Issue INSERT / Article FOR UPDATE 的真实 winner 等待"
                        )
                    assert diagnostics == []
                finally:
                    release.set()
                winner_result = winner.result(timeout=15)
                assert loser is not None and isinstance(loser.result(timeout=15), AppError)
            assert diagnostics == (
                [("23505", "uq_published_content_issues_one_open")] if bypass else []
            )
            with Session(engine) as verify:
                after = _open_issue_snapshot(verify)
                rows = after.pop("issues")
                assert (
                    len(rows) == 1 and rows[0].id == winner_result.id and rows[0].status == "OPEN"
                )
                baseline.pop("issues")
                assert after == baseline
                assert (
                    published_article_out(
                        verify, verify.get(PublishedArticle, article_id)
                    ).workflow_stage
                    == "OPEN_ISSUE"
                )
        finally:
            release.set()
            engine.dispose()


@pytest.mark.integration
def test_open_issue_http_prechecks_exact_reuse_and_unknown_no_leak(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as seed:
            graph = _seed_graph(seed)
            actor = graph["user"]
            assert isinstance(actor, User)
            winner = _open_repair_issue(seed, graph, suffix="issue-http")
            article_id, actor_id = winner.published_article_id, actor.id
            healthy_graph = _seed_graph(seed, content_hash="b" * 64)
            healthy_id = _complete_publication(seed, healthy_graph, suffix="issue-healthy").id
            before = _open_issue_snapshot(seed)
            csrf = "issue-csrf-token-with-more-than-32-characters"
            auth = SimpleNamespace(
                user=SimpleNamespace(id=actor_id, account_type="ENGINEER"),
                csrf_hash=hash_token(csrf),
            )
        mode = "precheck"
        observed: list[tuple[str, str | None]] = []
        real_classifier = publication_service._is_open_issue_integrity_error

        def classify(error: IntegrityError) -> bool:
            observed.append((error.orig.sqlstate, error.orig.diag.constraint_name))
            return real_classifier(error)

        monkeypatch.setattr(publication_service, "_is_open_issue_integrity_error", classify)

        def database_session() -> Iterator[Session]:
            with Session(engine, expire_on_commit=False) as db, monkeypatch.context() as patch:
                if mode in {"exact", "retired-trigger"}:
                    _bypass_open_issue_precheck(patch, db)
                try:
                    yield db
                except Exception as error:
                    if isinstance(error, AppError) and mode == "exact":
                        # 在 dependency rollback 前证明 mapper 已恢复同一个 Session。
                        assert _open_issue_snapshot(db) == before
                        user = db.get(User, actor_id)
                        assert user is not None
                        open_published_content_issue(
                            db=db,
                            article_id=healthy_id,
                            actor=user,
                            request_id="issue-reuse",
                            payload=PublishedContentIssueCreate(
                                kind="OTHER", description="健康命令"
                            ),
                        )
                    db.rollback()
                    if isinstance(error, IntegrityError):
                        assert _open_issue_snapshot(db) == before
                        assert db.get(User, actor_id) is not None
                    raise

        def post(target: uuid.UUID, request_id: str) -> object:
            return TestClient(
                app, raise_server_exceptions=mode not in {"retired-trigger", "foreign-key"}
            ).post(
                f"/api/v1/published-articles/{target}/issues",
                headers={"X-CSRF-Token": csrf, "X-Request-ID": request_id},
                json={"kind": "OTHER", "description": "HTTP 问题"},
            )

        app.dependency_overrides[get_db] = database_session
        app.dependency_overrides[get_current_session] = lambda: auth
        try:
            for path in ("precheck", "exact", "retired"):
                mode = path
                if path == "retired":
                    with Session(engine, expire_on_commit=False) as db:
                        user = db.get(User, actor_id)
                        resolve_published_content_issue(
                            db=db,
                            issue_id=winner.id,
                            actor=user,
                            request_id="retire",
                            payload=PublishedContentIssueResolveRequest(
                                outcome="RETIRED",
                                comment="文章已退役",
                                expected_revision=0,
                            ),
                        )
                        before = _open_issue_snapshot(db)
                response = post(article_id, f"issue-{path}")
                assert response.status_code == 409, response.text
                assert response.json() == {
                    "error": {
                        "code": "PUBLISHED_CONTENT_ISSUE_CONFLICT",
                        "message": "文章已有开放问题或已退役",
                        "details": {},
                        "request_id": f"issue-{path}",
                    }
                }
                assert response.headers["X-Request-ID"] == f"issue-{path}"
            assert observed == [("23505", "uq_published_content_issues_one_open")]
            for unknown in ("retired-trigger", "foreign-key"):
                mode = unknown
                target = article_id
                if unknown == "foreign-key":
                    with Session(engine, expire_on_commit=False) as db:
                        healthy_issue = db.scalars(
                            select(PublishedContentIssue).where(
                                PublishedContentIssue.published_article_id == healthy_id
                            )
                        ).one()
                        resolve_published_content_issue(
                            db=db,
                            issue_id=healthy_issue.id,
                            actor=db.get(User, actor_id),
                            request_id="restore",
                            payload=PublishedContentIssueResolveRequest(
                                outcome="RESTORED",
                                comment="恢复后允许重开",
                                expected_revision=0,
                            ),
                        )
                        before = _open_issue_snapshot(db)
                    target = healthy_id
                    auth = SimpleNamespace(
                        user=SimpleNamespace(id=uuid.uuid4(), account_type="ENGINEER"),
                        csrf_hash=hash_token(csrf),
                    )
                response = post(target, f"issue-{unknown}")
                assert response.status_code == 500
                for secret in (
                    "INSERT INTO",
                    "published_content_issues",
                    "fk_",
                    "uq_",
                    "23514",
                    "23503",
                    "Traceback",
                    "ForeignKeyViolation",
                    "retired article",
                    "PUBLISHED_CONTENT_ISSUE_CONFLICT",
                    "REVISION_CONFLICT",
                    "violates foreign key",
                ):
                    assert secret.lower() not in response.text.lower()
            assert observed[-2:] == [
                ("23514", None),
                ("23503", "fk_published_content_issues_opened_by_users"),
            ]
            with Session(engine, expire_on_commit=False) as db:
                assert _open_issue_snapshot(db) == before
                restored = open_published_content_issue(
                    db=db,
                    article_id=healthy_id,
                    actor=db.get(User, actor_id),
                    request_id="restored-open",
                    payload=PublishedContentIssueCreate(
                        kind="OTHER",
                        description="RESTORED 后新问题",
                    ),
                )
                assert restored.status == "OPEN"
        finally:
            app.dependency_overrides.clear()
            engine.dispose()


@pytest.mark.integration
@pytest.mark.parametrize("boundary", ["projection", "commit", "deferred-trigger"])
def test_open_issue_late_exact_diagnostics_remain_unknown(
    monkeypatch: pytest.MonkeyPatch,
    boundary: str,
) -> None:
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            article_id = _complete_publication(db, graph, suffix="issue-late").id
            pending_work = None
            if boundary == "deferred-trigger":
                pending_graph = _seed_graph(db, content_hash="c" * 64)
                pending_work = create_publication_work(
                    db=db,
                    payload=_work_payload(pending_graph),
                    actor=pending_graph["user"],
                    request_id="deferred-work",
                    idempotency_key="deferred-work",
                )
            before = _open_issue_snapshot(db)
            error = IntegrityError(
                "INSERT",
                {},
                SimpleNamespace(
                    sqlstate="23505",
                    diag=SimpleNamespace(constraint_name="uq_published_content_issues_one_open"),
                ),
            )

            def fail(*args: object, **kwargs: object) -> None:
                raise error

            real_commit = db.commit

            def incomplete_close() -> None:
                # 真实 deferred guard：Work 关闭却未取消 Task；Issue flush 已完成。
                assert pending_work is not None
                db.execute(
                    update(PublicationWork)
                    .where(PublicationWork.id == pending_work.id)
                    .values(
                        status="CLOSED",
                        revision=1,
                        close_reason="OTHER",
                        close_comment="延迟约束负例",
                        closed_by=graph["user"].id,
                        closed_at=datetime.now(UTC),
                    )
                )
                real_commit()

            with monkeypatch.context() as patch:
                if boundary == "projection":
                    patch.setattr(publication_service, "published_content_issue_out", fail)
                elif boundary == "deferred-trigger":
                    patch.setattr(db, "commit", incomplete_close)
                else:
                    patch.setattr(db, "commit", fail)
                with pytest.raises(IntegrityError) as raised:
                    open_published_content_issue(
                        db=db,
                        article_id=article_id,
                        actor=graph["user"],
                        request_id="late",
                        payload=PublishedContentIssueCreate(kind="OTHER", description="边界"),
                    )
                if boundary == "deferred-trigger":
                    assert raised.value.orig.sqlstate == "23514"
                    assert raised.value.orig.diag.constraint_name is None
                    assert not publication_service._is_open_issue_integrity_error(raised.value)
                else:
                    assert raised.value is error
            db.rollback()
            assert _open_issue_snapshot(db) == before
        engine.dispose()


@pytest.mark.parametrize(
    ("sqlstate", "constraint_name"),
    [
        ("23505", "uq_publication_verifications_one_passed"),
        ("23505", "pk_published_articles"),
        ("23505", "uq_published_articles_verification_id"),
        ("23505", "pk_publication_attachments"),
        ("23505", "uq_unrelated_constraint"),
        ("23505", "uq_publication_works_content_version_id"),
        ("23505", "uq_publication_works_content_task_id_suffix"),
        ("23505", "UQ_PUBLICATION_WORKS_CONTENT_TASK_ID"),
        ("23505", b"uq_publication_works_content_task_id"),
        ("23505", ["uq_publication_works_content_task_id"]),
        ("23505", None),
        (None, "uq_publication_works_content_task_id"),
        ("23503", "uq_publication_works_content_task_id"),
        ("23514", "uq_publication_works_content_task_id"),
        ("23502", "uq_publication_works_content_task_id"),
        ("55000", "uq_publication_works_content_task_id"),
    ],
)
def test_publication_work_integrity_classifier_fails_closed(
    sqlstate: str | None,
    constraint_name: object,
) -> None:
    original = SimpleNamespace(
        sqlstate=sqlstate,
        diag=SimpleNamespace(constraint_name=constraint_name) if constraint_name else None,
        constraint_name="uq_publication_works_content_task_id",
    )
    error = IntegrityError("uq_publication_works_content_task_id", {}, original)
    assert publication_service._publication_work_integrity_constraint(error) is None


@pytest.mark.integration
@pytest.mark.parametrize("bypass", [False, True], ids=["precheck", "exact"])
def test_publication_work_replay_and_conflicts_preserve_session_and_aggregate(
    monkeypatch: pytest.MonkeyPatch,
    bypass: bool,
) -> None:
    """相同与不同 payload、task 换版和同平台 hash 的两条路径保持相同语义。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            assert isinstance(actor, User)
            actor_id = actor.id
            original_payload = _work_payload(graph)
            winner = create_publication_work(
                db=db,
                payload=original_payload,
                actor=actor,
                request_id="work-baseline",
                idempotency_key="work-baseline-key",
            )
            other = _seed_graph(db, content_hash="b" * 64)
            hash_content = _additional_publication_content(
                db,
                graph,
                same_task=False,
                content_hash="a" * 64,
            )
            scenarios = [
                (original_payload, "work-baseline-key", None),
                (_work_payload(other), "work-baseline-key", "IDEMPOTENCY_CONFLICT"),
                (
                    PublicationWorkCreate(
                        content_version_id=hash_content.id,
                        platform_account_id=original_payload.platform_account_id,
                    ),
                    "work-hash-key",
                    "PUBLICATION_IDENTITY_CONFLICT",
                ),
            ]
            for payload, key, code in scenarios:
                before = _publication_creation_snapshot(db)
                diagnostics: list[tuple[str, str]] = []
                with monkeypatch.context() as patch:
                    if bypass:
                        _bypass_publication_creation(patch, db, diagnostics)
                    if code is None:
                        result = create_publication_work(
                            db=db,
                            payload=payload,
                            actor=actor,
                            request_id="work-replay",
                            idempotency_key=key,
                        )
                        assert result.model_dump() == winner.model_dump()
                    else:
                        with pytest.raises(AppError) as raised:
                            create_publication_work(
                                db=db,
                                payload=payload,
                                actor=actor,
                                request_id="work-conflict",
                                idempotency_key=key,
                            )
                        assert raised.value.code == code
                        assert raised.value.status_code == 409 and raised.value.details == {}
                    if bypass:
                        assert len(diagnostics) == 1 and diagnostics[0][0] == "23505"
                    else:
                        assert diagnostics == []
                assert _publication_creation_snapshot(db) == before
                assert db.get(User, actor_id) is not None
                db.rollback()

            # current version/hash 已变化，旧 content-version 预检会漏掉这个永久 task identity。
            replacement = _additional_publication_content(
                db,
                graph,
                same_task=True,
                content_hash="c" * 64,
            )
            before = _publication_creation_snapshot(db)
            diagnostics = []
            with monkeypatch.context() as patch:
                if bypass:
                    _bypass_publication_creation(patch, db, diagnostics)
                with pytest.raises(AppError) as raised:
                    create_publication_work(
                        db=db,
                        payload=PublicationWorkCreate(
                            content_version_id=replacement.id,
                            platform_account_id=original_payload.platform_account_id,
                        ),
                        actor=db.get(User, actor_id),
                        request_id="work-task-conflict",
                        idempotency_key="work-task-key",
                    )
                assert raised.value.code == "PUBLICATION_IDENTITY_CONFLICT"
                assert raised.value.message == "该内容版本或同平台内容已存在发布工作"
                assert raised.value.status_code == 409 and raised.value.details == {}
                assert diagnostics == (
                    [("23505", "uq_publication_works_content_task_id")] if bypass else []
                )
            assert _publication_creation_snapshot(db) == before
        engine.dispose()


@pytest.mark.integration
def test_publication_work_recovery_prioritizes_key_for_every_exact_constraint() -> None:
    """数据库可报告任一同时冲突索引；三个 exact 名称必须使用相同 key 优先级。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            assert isinstance(actor, User)
            payload = _work_payload(graph)
            winner = create_publication_work(
                db=db,
                payload=payload,
                actor=actor,
                request_id="priority-winner",
                idempotency_key="priority-winner-key",
            )
            for name in publication_service._PUBLICATION_WORK_INTEGRITY_CONSTRAINTS:
                error = IntegrityError(
                    "not parsed",
                    {},
                    SimpleNamespace(
                        sqlstate="23505",
                        diag=SimpleNamespace(constraint_name=name),
                    ),
                )
                replay = publication_service._recover_publication_work_integrity_error(
                    db,
                    error=error,
                    payload=payload,
                    idempotency_key="priority-winner-key",
                )
                assert replay.model_dump() == winner.model_dump()
                for differing_payload in (
                    payload.model_copy(update={"content_version_id": uuid.uuid4()}),
                    payload.model_copy(update={"platform_account_id": uuid.uuid4()}),
                ):
                    with pytest.raises(AppError) as raised:
                        publication_service._recover_publication_work_integrity_error(
                            db,
                            error=error,
                            payload=differing_payload,
                            idempotency_key="priority-winner-key",
                        )
                    assert raised.value.code == "IDEMPOTENCY_CONFLICT"
                if name.endswith("idempotency_key"):
                    with pytest.raises(IntegrityError) as unknown:
                        publication_service._recover_publication_work_integrity_error(
                            db,
                            error=error,
                            payload=payload,
                            idempotency_key="missing-winner",
                        )
                    assert unknown.value is error
            db.refresh(actor)
            closed = close_publication_work(
                db=db,
                work_id=winner.id,
                payload=PublicationWorkCloseRequest(
                    expected_revision=0, reason="BUSINESS_CANCELLED", comment="测试终态账号清理"
                ),
                actor=actor,
                request_id="priority-close",
            )
            assert closed.status == "CLOSED"
            account = db.get(PlatformAccount, payload.platform_account_id)
            assert account is not None
            delete_platform_account(
                db=db,
                platform_account_id=account.id,
                expected_revision=account.revision,
                actor=actor,
                request_id="priority-delete-account",
            )
            error = IntegrityError(
                "not parsed",
                {},
                SimpleNamespace(
                    sqlstate="23505",
                    diag=SimpleNamespace(constraint_name="uq_publication_works_idempotency_key"),
                ),
            )
            # 真实 unique 失败仍持有 root transaction；直接调用恢复器也建立该前置状态。
            db.scalar(text("SELECT 1"))
            with pytest.raises(IntegrityError) as unknown:
                publication_service._recover_publication_work_integrity_error(
                    db,
                    error=error,
                    payload=payload,
                    idempotency_key="priority-winner-key",
                )
            assert unknown.value is error
        engine.dispose()


@pytest.mark.integration
def test_publication_work_mapper_does_not_cover_event_flush(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """即使 event flush 给出获准名字，也不扩大 Work INSERT mapper 的作用域。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            assert isinstance(actor, User)
            before = _publication_creation_snapshot(db)
            error = IntegrityError(
                "event insert",
                {},
                SimpleNamespace(
                    sqlstate="23505",
                    diag=SimpleNamespace(constraint_name="uq_publication_works_idempotency_key"),
                ),
            )
            real_flush = db.flush

            def fail_event(*args: object, **kwargs: object) -> None:
                if any(isinstance(value, PublicationWorkEvent) for value in db.new):
                    raise error
                real_flush(*args, **kwargs)  # type: ignore[arg-type]

            with monkeypatch.context() as patch:
                patch.setattr(db, "flush", fail_event)
                with pytest.raises(IntegrityError) as raised:
                    create_publication_work(
                        db=db,
                        payload=_work_payload(graph),
                        actor=actor,
                        request_id="late-failure",
                        idempotency_key="late-failure-key",
                    )
                assert raised.value is error
                db.rollback()
            assert _publication_creation_snapshot(db) == before
        engine.dispose()


@pytest.mark.integration
def test_publication_work_http_conflicts_and_unknown_do_not_leak(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """真实 route 对账两个 409；无关真实 FK 由 request owner 回滚且默认 500 不泄漏。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            assert isinstance(actor, User)
            payload = _work_payload(graph)
            create_publication_work(
                db=db,
                payload=payload,
                actor=actor,
                request_id="http-winner",
                idempotency_key="http-winner-key",
            )
            other_payload = _work_payload(_seed_graph(db, content_hash="b" * 64))
            csrf_token = "work-http-csrf-token-with-more-than-32-characters"
            current_session = SimpleNamespace(user=actor, csrf_hash=hash_token(csrf_token))
            before = _publication_creation_snapshot(db)
            db.refresh(actor)
        bypass = False
        diagnostics: list[tuple[str, str]] = []
        unknown_diagnostics: list[tuple[str, str]] = []

        def database_session() -> Iterator[Session]:
            with (
                Session(engine, expire_on_commit=False) as request_db,
                monkeypatch.context() as patch,
            ):
                if bypass:
                    _bypass_publication_creation(patch, request_db, diagnostics)
                try:
                    yield request_db
                except Exception as error:
                    request_db.rollback()
                    if isinstance(error, IntegrityError):
                        unknown_diagnostics.append(
                            (error.orig.sqlstate, error.orig.diag.constraint_name)
                        )
                        assert _publication_creation_snapshot(request_db) == before
                    raise

        app.dependency_overrides[get_db] = database_session
        app.dependency_overrides[get_current_session] = lambda: current_session
        try:
            for bypass in (False, True):
                for code, request_payload, key, message in (
                    (
                        "IDEMPOTENCY_CONFLICT",
                        other_payload,
                        "http-winner-key",
                        "幂等键已用于另一发布工作",
                    ),
                    (
                        "PUBLICATION_IDENTITY_CONFLICT",
                        payload,
                        "http-other-key",
                        "该内容版本或同平台内容已存在发布工作",
                    ),
                ):
                    request_id = f"work-http-{code.lower()}-{bypass}"
                    response = TestClient(app).post(
                        "/api/v1/publication-works",
                        headers={
                            "X-CSRF-Token": csrf_token,
                            "X-Request-ID": request_id,
                            "Idempotency-Key": key,
                        },
                        json=request_payload.model_dump(mode="json"),
                    )
                    assert response.status_code == 409, response.text
                    assert response.headers["X-Request-ID"] == request_id
                    assert response.json() == {
                        "error": {
                            "code": code,
                            "message": message,
                            "details": {},
                            "request_id": request_id,
                        }
                    }
                    with Session(engine) as verify:
                        assert _publication_creation_snapshot(verify) == before
            assert len(diagnostics) == 2 and all(state == "23505" for state, _ in diagnostics)
            bypass = False
            current_session.user = SimpleNamespace(id=uuid.uuid4(), account_type="ENGINEER")
            response = TestClient(app, raise_server_exceptions=False).post(
                "/api/v1/publication-works",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "work-http-unknown",
                    "Idempotency-Key": "work-unknown-key",
                },
                json=other_payload.model_dump(mode="json"),
            )
            assert response.status_code == 500
            assert unknown_diagnostics == [("23503", "fk_publication_works_created_by_users")]
            for secret in (
                "INSERT INTO",
                "publication_works",
                "fk_publication_works_created_by_users",
                "ForeignKeyViolation",
                "psycopg",
                "Traceback",
                "REVISION_CONFLICT",
            ):
                assert secret not in response.text
            with Session(engine) as verify:
                assert _publication_creation_snapshot(verify) == before
        finally:
            app.dependency_overrides.clear()
            engine.dispose()


def _wait_for_publication_insert(engine: object, pid: int, winner_pid: int) -> None:
    """有界证明等待点确为 publication_works INSERT 的数据库唯一性裁决。"""
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        with engine.connect() as monitor:  # type: ignore[attr-defined]
            state = (
                monitor.execute(
                    text(
                        "SELECT query, wait_event_type, pg_blocking_pids(pid) AS blockers "
                        "FROM pg_stat_activity WHERE pid = :pid"
                    ),
                    {"pid": pid},
                )
                .mappings()
                .first()
            )
        if state is not None and state["wait_event_type"] == "Lock":
            assert "INSERT INTO publication_works" in state["query"], state["query"]
            if winner_pid in state["blockers"]:
                return
        threading.Event().wait(0.05)
    raise AssertionError("未观察到 loser 的真实 Work INSERT 等待 winner")


@pytest.mark.integration
@pytest.mark.parametrize(
    ("scenario", "bypass"),
    [
        ("replay", False),
        ("identity", False),
        ("replay", True),
        ("payload", True),
        ("task", True),
        ("hash", True),
    ],
)
def test_publication_work_concurrency_has_one_winner(
    monkeypatch: pytest.MonkeyPatch,
    scenario: str,
    bypass: bool,
) -> None:
    """合规锁和真实 unique race 都仅提交一个 Work；loser 不留聚合副作用。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as seed:
            graph = _seed_graph(seed)
            actor = graph["user"]
            assert isinstance(actor, User)
            actor_id = actor.id
            winner_payload = _work_payload(graph)
            loser_payload = winner_payload
            if scenario == "payload":
                loser_payload = _work_payload(_seed_graph(seed, content_hash="b" * 64))
            elif scenario in {"task", "hash"}:
                candidate = _additional_publication_content(
                    seed,
                    graph,
                    same_task=scenario == "task",
                    content_hash="c" * 64 if scenario == "task" else "a" * 64,
                    make_current=scenario != "task",
                )
                loser_payload = PublicationWorkCreate(
                    content_version_id=candidate.id,
                    platform_account_id=winner_payload.platform_account_id,
                )
            task = graph["task"]
            assert isinstance(task, ContentTask)
            task_id = task.id
            before = _publication_creation_snapshot(seed)

        inserted, release_winner = threading.Event(), threading.Event()
        loser_ready, loser_insert_sent = threading.Event(), threading.Event()
        pids: dict[str, int] = {}
        diagnostics: list[tuple[str, str]] = []

        def request(first: bool) -> PublicationWorkOut | AppError:
            with Session(engine, expire_on_commit=False) as db, monkeypatch.context() as patch:
                connection = db.connection()
                pids["winner" if first else "loser"] = int(
                    db.scalar(text("SELECT pg_backend_pid()"))
                )
                if bypass:
                    _bypass_publication_creation(patch, db, diagnostics, bypass_locks=True)

                def hold_insert(
                    _connection: object,
                    _cursor: object,
                    statement: str,
                    _parameters: object,
                    _context: object,
                    _executemany: bool,
                ) -> None:
                    if first and statement.startswith("INSERT INTO publication_works "):
                        inserted.set()
                        if not release_winner.wait(10):
                            raise TimeoutError("等待释放 winner Work INSERT 超时")

                def observe_loser(
                    _connection: object,
                    _cursor: object,
                    statement: str,
                    _parameters: object,
                    _context: object,
                    _executemany: bool,
                ) -> None:
                    if not first and statement.startswith("INSERT INTO publication_works "):
                        loser_insert_sent.set()

                event.listen(connection, "after_cursor_execute", hold_insert)
                event.listen(connection, "before_cursor_execute", observe_loser)
                if not first:
                    loser_ready.set()
                user = db.get(User, actor_id)
                assert user is not None
                try:
                    return create_publication_work(
                        db=db,
                        payload=winner_payload if first else loser_payload,
                        actor=user,
                        request_id="race-first" if first else "race-second",
                        idempotency_key=(
                            "work-race-key"
                            if first or scenario in {"replay", "payload"}
                            else "work-race-other-key"
                        ),
                    )
                except AppError as error:
                    # known mapper 自己 rollback；这里的查询直接证明 Session 已可复用。
                    assert db.get(User, actor_id) is not None
                    assert db.scalar(select(func.count()).select_from(PublicationWork)) == 1
                    return error

        try:
            with ThreadPoolExecutor(max_workers=2) as executor:
                first_future = executor.submit(request, True)
                second_future = None
                try:
                    assert inserted.wait(10)
                    if scenario == "task":
                        # winner 已按旧 current 通过真实 INSERT guard；模拟随后批准的新版本。
                        # 该更新不是 loser 副作用，明确纳入 winner 释放前的 fixture 基线。
                        with Session(engine) as advance:
                            advance.execute(
                                update(ContentVersion)
                                .where(ContentVersion.id == winner_payload.content_version_id)
                                .values(status="SUPERSEDED", revision=ContentVersion.revision + 1)
                            )
                            advance.execute(
                                update(ContentVersion)
                                .where(ContentVersion.id == loser_payload.content_version_id)
                                .values(status="APPROVED", revision=ContentVersion.revision + 1)
                            )
                            advance.execute(
                                update(ContentTask)
                                .where(ContentTask.id == task_id)
                                .values(current_content_version_id=loser_payload.content_version_id)
                            )
                            advance.commit()
                            before = _publication_creation_snapshot(advance)
                    second_future = executor.submit(request, False)
                    assert loser_ready.wait(10)
                    if bypass:
                        assert loser_insert_sent.wait(10)
                        _wait_for_publication_insert(engine, pids["loser"], pids["winner"])
                    else:
                        _wait_for_pg_lock(engine, pids["loser"])
                        assert not loser_insert_sent.is_set()
                finally:
                    release_winner.set()
                first_result = first_future.result(timeout=10)
                assert second_future is not None
                second_result = second_future.result(timeout=10)
            assert isinstance(first_result, PublicationWorkOut)
            if scenario == "replay":
                assert isinstance(second_result, PublicationWorkOut)
                assert second_result.model_dump() == first_result.model_dump()
            else:
                assert isinstance(second_result, AppError)
                assert second_result.code == (
                    "IDEMPOTENCY_CONFLICT"
                    if scenario == "payload"
                    else "PUBLICATION_IDENTITY_CONFLICT"
                )
                assert second_result.status_code == 409 and second_result.details == {}
            if bypass:
                assert len(diagnostics) == 1 and diagnostics[0][0] == "23505"
                expected = {
                    "payload": "idempotency_key",
                    "task": "content_task_id",
                    "hash": "active_platform_hash",
                }.get(scenario)
                if expected:
                    assert diagnostics[0][1] == f"uq_publication_works_{expected}"
                else:
                    assert (
                        diagnostics[0][1]
                        in publication_service._PUBLICATION_WORK_INTEGRITY_CONSTRAINTS
                    )
            else:
                assert diagnostics == []
            with Session(engine) as verify:
                after = _publication_creation_snapshot(verify)
                expected_snapshot = dict(before)
                expected_snapshot["publication_works"] = 1
                expected_snapshot["publication_work_events"] = 1
                expected_snapshot["work_state"] = [(first_result.id, "PREPARING", 0)]
                assert after == expected_snapshot
                assert verify.scalar(select(PublicationWorkEvent.action)) == "CREATED"
        finally:
            engine.dispose()


def _bypass_publication_creation(
    monkeypatch: pytest.MonkeyPatch,
    db: Session,
    diagnostics: list[tuple[str, str]],
    *,
    bypass_locks: bool = False,
) -> None:
    """仅该 Session 的首个 Work INSERT 前隐藏预检；恢复查询与生产校验照常执行。"""
    real_scalar, real_execute, real_flush = db.scalar, db.execute, db.flush
    pending = True

    def scalar(statement: object, *args: object, **kwargs: object) -> object:
        rendered = str(statement)
        if (
            pending
            and "FROM publication_works" in rendered
            and (
                "WHERE publication_works.idempotency_key" in rendered
                or rendered.startswith("SELECT publication_works.id \n")
            )
        ):
            return None
        return real_scalar(statement, *args, **kwargs)  # type: ignore[arg-type]

    def execute(statement: object, *args: object, **kwargs: object) -> object:
        if bypass_locks and pending and "pg_advisory_xact_lock" in str(statement):
            return None
        return real_execute(statement, *args, **kwargs)  # type: ignore[arg-type]

    def flush(*args: object, **kwargs: object) -> None:
        nonlocal pending
        inserting = any(isinstance(value, PublicationWork) for value in db.new)
        if inserting:
            pending = False
        try:
            real_flush(*args, **kwargs)  # type: ignore[arg-type]
        except IntegrityError as error:
            if inserting:
                diagnostics.append((error.orig.sqlstate, error.orig.diag.constraint_name))
            raise

    monkeypatch.setattr(db, "scalar", scalar)
    monkeypatch.setattr(db, "execute", execute)
    monkeypatch.setattr(db, "flush", flush)
    if bypass_locks:
        # 原 helper 仍执行全部存在性/active/current/approved 校验，只移除这个连接的行锁。
        def without_row_lock(
            _connection: object,
            _cursor: object,
            statement: str,
            parameters: object,
            _context: object,
            _executemany: bool,
        ) -> tuple[str, object]:
            if statement.lstrip().upper().startswith("SELECT "):
                statement = statement.replace(" FOR UPDATE", "")
            return statement, parameters

        event.listen(db.connection(), "before_cursor_execute", without_row_lock, retval=True)


@pytest.mark.integration
def test_publication_work_current_head_catalog_and_unique_diagnostics() -> None:
    """三条 current-head 唯一对象及真实 driver diagnostics 是 mapper 的前置哨兵。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            catalog = {
                row["name"]: row
                for row in db.execute(
                    text("""
                    SELECT c.relname AS name, i.indisunique,
                           pg_get_indexdef(c.oid) AS definition,
                           pg_get_expr(i.indpred, i.indrelid) AS predicate,
                           k.conname, k.condeferrable
                    FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
                    LEFT JOIN pg_constraint k ON k.conindid = c.oid
                    WHERE i.indrelid = 'publication_works'::regclass AND c.relname IN (
                        'uq_publication_works_idempotency_key',
                        'uq_publication_works_content_task_id',
                        'uq_publication_works_active_platform_hash')
                """)
                ).mappings()
            }
            assert len(catalog) == 3
            for suffix in ("idempotency_key", "content_task_id"):
                name = f"uq_publication_works_{suffix}"
                row = catalog[name]
                assert row["indisunique"] is True
                assert row["conname"] == name and row["condeferrable"] is False
                assert row["predicate"] is None and f"({suffix})" in row["definition"]
            active = catalog["uq_publication_works_active_platform_hash"]
            assert active["indisunique"] is True and active["conname"] is None
            assert "(platform_profile_id, content_hash)" in active["definition"]
            assert "status" in active["predicate"] and "<>" in active["predicate"]
            assert "'CLOSED'" in active["predicate"]

            graph = _seed_graph(db)
            actor = graph["user"]
            assert isinstance(actor, User)
            winner = create_publication_work(
                db=db,
                payload=_work_payload(graph),
                actor=actor,
                request_id="work-catalog",
                idempotency_key="work-catalog-winner",
            )
            unrelated = _seed_graph(db, content_hash="b" * 64)
            same_hash = _additional_publication_content(
                db,
                graph,
                same_task=False,
                content_hash="a" * 64,
            )
            same_task = _additional_publication_content(
                db,
                graph,
                same_task=True,
                content_hash="c" * 64,
            )
            scenarios = (
                (
                    unrelated,
                    _work_payload(unrelated).content_version_id,
                    "work-catalog-winner",
                    "idempotency_key",
                ),
                (graph, same_task.id, "work-catalog-task", "content_task_id"),
                (graph, same_hash.id, "work-catalog-hash", "active_platform_hash"),
            )
            before = _publication_creation_snapshot(db)
            for candidate_graph, content_id, key, suffix in scenarios:
                account, profile = candidate_graph["account"], candidate_graph["profile"]
                assert isinstance(account, PlatformAccount)
                assert isinstance(profile, PlatformProfile)
                content = db.get(ContentVersion, content_id)
                assert content is not None
                candidate = PublicationWork(
                    idempotency_key=key,
                    content_task_id=content.task_id,
                    content_version_id=content.id,
                    platform_profile_id=profile.id,
                    platform_profile_id_snapshot=profile.id,
                    platform_profile_name_snapshot=profile.name,
                    platform_account_id=account.id,
                    platform_account_label_snapshot=account.label,
                    account_identifier_snapshot=account.account_identifier,
                    content_hash=content.content_hash,
                    status="PREPARING",
                    created_by=actor.id,
                )
                db.add(candidate)
                with pytest.raises(IntegrityError) as raised:
                    db.flush()
                assert raised.value.orig.sqlstate == "23505"
                assert raised.value.orig.diag.constraint_name == f"uq_publication_works_{suffix}"
                db.rollback()
                assert _publication_creation_snapshot(db) == before
                assert db.get(PublicationWork, winner.id) is not None
        engine.dispose()


@pytest.mark.integration
def test_fact_review_same_product_concurrency_uses_product_lock_and_single_pending() -> None:
    """同产品并发由 Product 行锁串行，后到请求命中 pending 预检。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url, pool_size=5, max_overflow=2)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            product = graph["product"]
            assert isinstance(actor, User)
            assert isinstance(product, Product)
            actor_id = actor.id
            product_id = product.id
            product.facts_body_markdown = "## 并发事实"
            product.facts_classification = "PUBLIC"
            db.commit()

        first_session: list[Session] = []
        first_lock_acquired = threading.Event()
        release_first = threading.Event()
        second_pid_ready = threading.Event()
        second_started = threading.Event()
        second_pid: list[int] = []
        results: dict[str, object] = {}
        thread_errors: list[BaseException] = []

        def hold_first_product_lock(
            session: Session, _flush_context: object, _instances: object
        ) -> None:
            """只暂停首个请求的候选 flush，保留生产 Product 行锁。"""
            if first_session and session is first_session[0] and any(
                isinstance(item, FactVersion) and item.product_id == product_id
                for item in session.new
            ):
                first_lock_acquired.set()
                if not release_first.wait(10):
                    raise TimeoutError("等待并发测试释放首个 Product 锁超时")

        def first_request() -> None:
            try:
                with Session(engine, expire_on_commit=False) as db:
                    first_session.append(db)
                    actor = db.get(User, actor_id)
                    assert actor is not None
                    results["first"] = submit_fact_review(
                        db=db,
                        product_id=product_id,
                        payload=FactReviewSubmissionRequest(
                            expected_revision=0,
                            change_summary="并发首个提交",
                        ),
                        actor=actor,
                        request_id="fact-review-concurrency-first",
                    )
            except BaseException as error:
                thread_errors.append(error)

        def second_request() -> None:
            try:
                with Session(engine, expire_on_commit=False) as db:
                    second_pid.append(int(db.scalar(text("SELECT pg_backend_pid()"))))
                    actor = db.get(User, actor_id)
                    assert actor is not None
                    second_pid_ready.set()
                    second_started.set()
                    with pytest.raises(AppError) as raised:
                        submit_fact_review(
                            db=db,
                            product_id=product_id,
                            payload=FactReviewSubmissionRequest(
                                expected_revision=0,
                                change_summary="并发后续提交",
                            ),
                            actor=actor,
                            request_id="fact-review-concurrency-second",
                        )
                    results["second"] = raised.value
            except BaseException as error:
                thread_errors.append(error)

        event.listen(Session, "before_flush", hold_first_product_lock)
        first_thread = threading.Thread(target=first_request)
        second_thread = threading.Thread(target=second_request)
        second_started_thread = False
        try:
            first_thread.start()
            assert first_lock_acquired.wait(10)
            second_thread.start()
            second_started_thread = True
            assert second_pid_ready.wait(10)

            blocked = False
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and not blocked:
                with engine.connect() as monitor:
                    state = monitor.execute(
                        text(
                            """
                            SELECT wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers
                            FROM pg_stat_activity
                            WHERE pid = :pid
                            """
                        ),
                        {"pid": second_pid[0]},
                    ).mappings().first()
                if state is not None and (
                    state["wait_event_type"] == "Lock" or state["blockers"]
                ):
                    blocked = True
                if not blocked:
                    second_started.wait(0.05)
            assert blocked, "第二请求未观察到等待首个 Product 行锁"
        finally:
            release_first.set()
            first_thread.join(10)
            if second_started_thread:
                second_thread.join(10)
            event.remove(Session, "before_flush", hold_first_product_lock)
            engine.dispose()

        assert not first_thread.is_alive()
        assert not second_thread.is_alive()
        assert not thread_errors
        assert isinstance(results["first"], FactVersion)
        second_error = results["second"]
        assert isinstance(second_error, AppError)
        assert second_error.code == "FACT_REVIEW_PENDING"

        with Session(create_engine(database_url), expire_on_commit=False) as db:
            pending_versions = list(
                db.scalars(
                    select(FactVersion).where(
                        FactVersion.product_id == product_id,
                        FactVersion.status == "PENDING_REVIEW",
                    )
                )
            )
            assert len(pending_versions) == 1
            assert db.scalar(
                select(func.count(FactReviewRecord.id)).where(
                    FactReviewRecord.fact_version_id == pending_versions[0].id,
                    FactReviewRecord.action == "submit-review",
                )
            ) == 1


def _complete_publication(
    db: Session,
    graph: dict[str, object],
    *,
    suffix: str,
    attachment_file_ids: list[uuid.UUID] | None = None,
) -> PublicationWork:
    """通过公开服务完成一条可用于删除测试的发布聚合。"""
    actor = graph["user"]
    content = graph["content"]
    account = graph["account"]
    assert isinstance(actor, User)
    assert isinstance(content, ContentVersion)
    assert isinstance(account, PlatformAccount)
    work = create_publication_work(
        db=db,
        payload=PublicationWorkCreate(
            content_version_id=content.id,
            platform_account_id=account.id,
        ),
        actor=actor,
        request_id=f"{suffix}-create",
        idempotency_key=f"{suffix}-key",
    )
    work = register_publication_result(
        db=db,
        work_id=work.id,
        payload=PublicationResultUpdate(
            actual_title=f"删除测试文章 {suffix}",
            final_url=f"https://community.example.invalid/articles/{suffix}",
            published_at="2026-08-06T08:00:00Z",
            expected_revision=work.revision,
            comment="登记删除测试文章",
            attachment_file_ids=attachment_file_ids or [],
        ),
        actor=actor,
        request_id=f"{suffix}-result",
    )
    verify_publication_work(
        db=db,
        work_id=work.id,
        payload=PublicationVerificationCreate(
            outcome="PASSED",
            content_matches=True,
            expected_revision=work.revision,
            comment="",
        ),
        actor=actor,
        request_id=f"{suffix}-verify",
    )
    completed = db.get(PublicationWork, work.id)
    assert completed is not None
    return completed


def _open_repair_issue(
    db: Session,
    graph: dict[str, object],
    *,
    suffix: str,
) -> PublishedContentIssue:
    """创建带真实已发布成果的开放内容问题，供修复任务边界测试复用。"""
    actor = graph["user"]
    assert isinstance(actor, User)
    work = _complete_publication(db, graph, suffix=suffix)
    issue = open_published_content_issue(
        db=db,
        article_id=work.id,
        payload=PublishedContentIssueCreate(
            kind="CONTENT_CHANGED",
            description=f"修复任务完整性测试问题 {suffix}",
        ),
        actor=actor,
        request_id=f"{suffix}-issue",
    )
    return issue


def _wait_for_pg_lock(engine: object, pid: int) -> None:
    """在有界时间内确认指定 PostgreSQL 会话正在等待锁。"""
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        with engine.connect() as monitor:  # type: ignore[attr-defined]
            state = monitor.execute(
                text(
                    "SELECT wait_event_type, pg_blocking_pids(pid) AS blockers "
                    "FROM pg_stat_activity WHERE pid = :pid"
                ),
                {"pid": pid},
            ).mappings().first()
        if state is not None and (state["wait_event_type"] == "Lock" or state["blockers"]):
            return
        threading.Event().wait(0.05)
    raise AssertionError("未观察到目标 PostgreSQL 会话等待锁")


def _bypass_next_repair_precheck(
    monkeypatch: pytest.MonkeyPatch,
    db: Session,
) -> None:
    """仅隐藏下一次修复来源查询，让真实数据库约束接管测试判定。"""
    real_scalar = db.scalar
    pending = True

    def bypass(statement: object, *args: object, **kwargs: object) -> object:
        nonlocal pending
        rendered = str(statement)
        if (
            pending
            and "SELECT content_tasks.id" in rendered
            and "source_published_content_issue_id" in rendered
        ):
            pending = False
            return None
        return real_scalar(statement, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(db, "scalar", bypass)


def _publication_verification_snapshot(
    db: Session,
    work_id: uuid.UUID,
) -> dict[str, object]:
    """冻结核验拒绝路径不得改变的发布聚合业务状态。"""
    db.expire_all()
    work = db.get(PublicationWork, work_id)
    assert work is not None
    task = db.get(ContentTask, work.content_task_id)
    assert task is not None
    return {
        "verification_count": db.scalar(
            select(func.count(PublicationVerification.id)).where(
                PublicationVerification.publication_work_id == work_id
            )
        ),
        "event_count": db.scalar(
            select(func.count(PublicationWorkEvent.id)).where(
                PublicationWorkEvent.publication_work_id == work_id
            )
        ),
        "article_count": db.scalar(
            select(func.count(PublishedArticle.id)).where(PublishedArticle.id == work_id)
        ),
        "audit_count": db.scalar(
            select(func.count(AuditLog.id)).where(
                AuditLog.target_type == "PublicationWork",
                AuditLog.target_id == str(work_id),
            )
        ),
        "work": (
            work.status,
            work.revision,
            work.content_task_id,
            work.content_version_id,
            work.content_hash,
            work.actual_title,
            work.final_url,
            work.published_at,
        ),
        "task": (
            task.status,
            task.revision,
            task.current_content_version_id,
        ),
    }


@pytest.mark.integration
def test_published_article_list_and_detail_read_models() -> None:
    """成果列表由服务端搜索排序，详情一次返回冻结正文与发布时间线。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            first_graph = _seed_graph(db, content_hash="1" * 64)
            second_graph = _seed_graph(db, content_hash="2" * 64)
            first_work = _complete_publication(db, first_graph, suffix="zulu")
            second_work = _complete_publication(db, second_graph, suffix="alpha")
            first_profile = first_graph["profile"]
            first_account = first_graph["account"]
            assert isinstance(first_profile, PlatformProfile)
            assert isinstance(first_account, PlatformAccount)

            frozen_profile_name = first_profile.name
            frozen_account_label = first_account.label
            first_profile.name = "已修改平台名称"
            first_account.label = "已修改账号标签"
            db.commit()

            by_title = list_published_articles(
                db,
                page=1,
                page_size=20,
                sort=PublishedArticleSort.TITLE_ASC,
            )
            assert by_title.total == 2
            assert [item.id for item in by_title.items] == [second_work.id, first_work.id]
            first_item = next(item for item in by_title.items if item.id == first_work.id)
            assert first_item.platform_profile_name == frozen_profile_name
            assert first_item.platform_account_label == frozen_account_label

            searched = list_published_articles(
                db,
                page=1,
                page_size=1,
                search=" ZULU ",
            )
            assert searched.total == 1
            assert searched.items[0].id == first_work.id
            assert (
                list_published_articles(
                    db,
                    page=1,
                    page_size=20,
                    search="%",
                ).items
                == []
            )

            stable_ids = [first_work.id, second_work.id]
            same_published_at = list_published_articles(
                db,
                page=1,
                page_size=20,
                sort=PublishedArticleSort.PUBLISHED_DESC,
            )
            assert [item.id for item in same_published_at.items] == sorted(stable_ids)

            article = db.get(PublishedArticle, first_work.id)
            assert article is not None
            detail = published_article_out(db, article)
            content = first_graph["content"]
            assert isinstance(content, ContentVersion)
            assert detail.id == first_work.id == article.id
            assert detail.verification.outcome == "PASSED"
            assert detail.source_content.content.id == content.id
            assert detail.source_content.content.body_markdown == content.body_markdown
            assert detail.source_content.content.content_hash == detail.content_hash
            assert [event.action for event in detail.events] == [
                "CREATED",
                "RESULT_REGISTERED",
                "COMPLETED",
            ]


@pytest.mark.integration
def test_publication_work_read_surfaces_use_state_aware_identity() -> None:
    """三个读取面统一使用非终态实时身份与终态冻结快照。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            def assert_identity(
                work_id: uuid.UUID,
                expected: tuple[str, str, str],
                *,
                live_ids_present: bool,
            ) -> None:
                with Session(engine, expire_on_commit=False) as read_db:
                    persisted = read_db.get(PublicationWork, work_id)
                    assert persisted is not None
                    listed = list_publication_works(
                        read_db,
                        page=1,
                        page_size=20,
                        status_filter=None,
                        content_task_id=persisted.content_task_id,
                    )
                    assert listed.total == 1
                    detail = publication_work_out(read_db, persisted)
                    workspace = publication_workspace_context(read_db, work_id)
                    for projected in (listed.items[0], detail, workspace.work):
                        assert (
                            projected.platform_profile_name,
                            projected.platform_account_label,
                            projected.account_identifier,
                        ) == expected
                        assert (projected.platform_profile_id is not None) is live_ids_present
                        assert (projected.platform_account_id is not None) is live_ids_present
                    assert workspace.platform.name == expected[0]

            closed_graph = _seed_graph(db, content_hash="3" * 64)
            closed_actor = closed_graph["user"]
            closed_content = closed_graph["content"]
            closed_profile = closed_graph["profile"]
            closed_account = closed_graph["account"]
            assert isinstance(closed_actor, User)
            assert isinstance(closed_content, ContentVersion)
            assert isinstance(closed_profile, PlatformProfile)
            assert isinstance(closed_account, PlatformAccount)
            closed_snapshot = (
                closed_profile.name,
                closed_account.label,
                closed_account.account_identifier,
            )
            active_work = create_publication_work(
                db=db,
                payload=PublicationWorkCreate(
                    content_version_id=closed_content.id,
                    platform_account_id=closed_account.id,
                ),
                actor=closed_actor,
                request_id="identity-live-create",
                idempotency_key="identity-live-create-key",
            )
            live_identity = ("实时平台名称", "实时账号标签", "live-account")
            (
                closed_profile.name,
                closed_account.label,
                closed_account.account_identifier,
            ) = live_identity
            db.commit()
            assert_identity(active_work.id, live_identity, live_ids_present=True)

            persisted_active = db.get(PublicationWork, active_work.id)
            assert persisted_active is not None
            closed_work = close_publication_work(
                db=db,
                work_id=persisted_active.id,
                payload=PublicationWorkCloseRequest(
                    reason="BUSINESS_CANCELLED",
                    comment="验证关闭工作冻结身份",
                    expected_revision=persisted_active.revision,
                ),
                actor=closed_actor,
                request_id="identity-close",
            )
            assert_identity(closed_work.id, closed_snapshot, live_ids_present=True)

            closed_account_id = closed_account.id
            closed_profile_id = closed_profile.id
            delete_platform_account(
                db=db,
                platform_account_id=closed_account_id,
                expected_revision=closed_account.revision,
                actor=closed_actor,
                request_id="identity-closed-account-delete",
            )
            disabled_closed_profile = set_platform_profile_enabled(
                db=db,
                platform_profile_id=closed_profile_id,
                payload=RevisionRequest(expected_revision=closed_profile.revision),
                actor=closed_actor,
                request_id="identity-closed-profile-disable",
                enabled=False,
            )
            delete_platform_profile(
                db=db,
                platform_profile_id=disabled_closed_profile.id,
                expected_revision=disabled_closed_profile.revision,
                actor=closed_actor,
                request_id="identity-closed-profile-delete",
            )
            assert_identity(closed_work.id, closed_snapshot, live_ids_present=False)

            completed_graph = _seed_graph(db, content_hash="4" * 64)
            completed_actor = completed_graph["user"]
            completed_profile = completed_graph["profile"]
            completed_account = completed_graph["account"]
            assert isinstance(completed_actor, User)
            assert isinstance(completed_profile, PlatformProfile)
            assert isinstance(completed_account, PlatformAccount)
            completed_snapshot = (
                completed_profile.name,
                completed_account.label,
                completed_account.account_identifier,
            )
            completed_work = _complete_publication(
                db,
                completed_graph,
                suffix="identity-completed",
            )
            completed_profile.name = "完成后实时平台名称"
            completed_account.label = "完成后实时账号标签"
            completed_account.account_identifier = "completed-live-account"
            db.commit()
            assert_identity(completed_work.id, completed_snapshot, live_ids_present=True)

            completed_account_id = completed_account.id
            completed_profile_id = completed_profile.id
            delete_platform_account(
                db=db,
                platform_account_id=completed_account_id,
                expected_revision=completed_account.revision,
                actor=completed_actor,
                request_id="identity-completed-account-delete",
            )
            disabled_completed_profile = set_platform_profile_enabled(
                db=db,
                platform_profile_id=completed_profile_id,
                payload=RevisionRequest(expected_revision=completed_profile.revision),
                actor=completed_actor,
                request_id="identity-completed-profile-disable",
                enabled=False,
            )
            delete_platform_profile(
                db=db,
                platform_profile_id=disabled_completed_profile.id,
                expected_revision=disabled_completed_profile.revision,
                actor=completed_actor,
                request_id="identity-completed-profile-delete",
            )
            assert_identity(completed_work.id, completed_snapshot, live_ids_present=False)


@pytest.mark.integration
def test_publication_work_list_malformed_context_returns_structured_409() -> None:
    """列表遇到缺失状态事件的工作时通过真实 HTTP 返回 ErrorEnvelope。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="5" * 64)
            actor = graph["user"]
            task = graph["task"]
            content = graph["content"]
            profile = graph["profile"]
            account = graph["account"]
            assert isinstance(actor, User)
            assert isinstance(task, ContentTask)
            assert isinstance(content, ContentVersion)
            assert isinstance(profile, PlatformProfile)
            assert isinstance(account, PlatformAccount)
            malformed_work = PublicationWork(
                idempotency_key="malformed-list-context-key",
                content_task_id=task.id,
                content_version_id=content.id,
                platform_profile_id=profile.id,
                platform_profile_id_snapshot=profile.id,
                platform_profile_name_snapshot=profile.name,
                platform_account_id=account.id,
                platform_account_label_snapshot=account.label,
                account_identifier_snapshot=account.account_identifier,
                content_hash=content.content_hash,
                status="PREPARING",
                created_by=actor.id,
            )
            db.add(malformed_work)
            db.commit()

            def database_session() -> Iterator[Session]:
                with Session(engine, expire_on_commit=False) as request_db:
                    yield request_db

            app.dependency_overrides[get_db] = database_session
            app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(user=actor)
            try:
                response = TestClient(app).get(
                    f"/api/v1/publication-works?content_task_id={task.id}"
                )
            finally:
                app.dependency_overrides.clear()

            assert response.status_code == 409
            error = response.json()["error"]
            assert error["code"] == "PUBLICATION_CONTEXT_INCOMPLETE"
            assert error["message"] == "发布工作缺少状态事件"
            assert error["request_id"]


@pytest.mark.integration
def test_publication_work_list_read_model_and_start_boundary() -> None:
    """发布列表一次返回所需投影，开始发布仍由命令重新校验。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            product = graph["product"]
            fact = graph["fact"]
            task = graph["task"]
            content = graph["content"]
            account = graph["account"]
            assert isinstance(actor, User)
            assert isinstance(product, Product)
            assert isinstance(fact, FactVersion)
            assert isinstance(task, ContentTask)
            assert isinstance(content, ContentVersion)
            assert isinstance(account, PlatformAccount)

            account.is_active = False
            db.commit()
            ready_without_account = list_publication_ready_items(db, can_delete_accounts=False)
            assert len(ready_without_account.items) == 1
            assert ready_without_account.items[0].matching_accounts == []
            assert ready_without_account.items[0].available_actions == []
            assert publication_workbench_summary(db).ready_count == 1

            with pytest.raises(AppError) as disabled_account:
                create_publication_work(
                    db=db,
                    payload=PublicationWorkCreate(
                        content_version_id=content.id,
                        platform_account_id=account.id,
                    ),
                    actor=actor,
                    request_id="publication-disabled-account",
                    idempotency_key="publication-disabled-account-key",
                )
            assert disabled_account.value.code == "PLATFORM_ACCOUNT_DISABLED"
            db.rollback()

            account.is_active = True
            draft = ContentVersion(
                task_id=task.id,
                fact_version_id=fact.id,
                version=2,
                source_type="HUMAN",
                title="未批准测试内容",
                summary="仅用于命令边界测试",
                body_markdown="# 未批准内容",
                tags=["PS"],
                content_hash="b" * 64,
                status="DRAFT",
                quality_issues=[],
                change_summary="创建未批准测试版本",
                created_by=actor.id,
            )
            db.add(draft)
            db.flush()
            task.current_content_version_id = draft.id
            db.commit()

            with pytest.raises(AppError) as not_approved:
                create_publication_work(
                    db=db,
                    payload=PublicationWorkCreate(
                        content_version_id=draft.id,
                        platform_account_id=account.id,
                    ),
                    actor=actor,
                    request_id="publication-not-approved",
                    idempotency_key="publication-not-approved-key",
                )
            assert not_approved.value.code == "CONTENT_NOT_APPROVED"
            db.rollback()
            with pytest.raises(AppError) as not_current:
                create_publication_work(
                    db=db,
                    payload=PublicationWorkCreate(
                        content_version_id=content.id,
                        platform_account_id=account.id,
                    ),
                    actor=actor,
                    request_id="publication-not-current",
                    idempotency_key="publication-not-current-key",
                )
            assert not_current.value.code == "CONTENT_VERSION_NOT_CURRENT"
            db.rollback()

            task.current_content_version_id = content.id
            db.commit()
            ready = list_publication_ready_items(db, can_delete_accounts=False)
            assert ready.items[0].available_actions == ["START"]
            work = create_publication_work(
                db=db,
                payload=PublicationWorkCreate(
                    content_version_id=content.id,
                    platform_account_id=account.id,
                ),
                actor=actor,
                request_id="publication-create-list",
                idempotency_key="publication-create-list-key",
            )
            assert work.product.model_dump() == {
                "id": product.id,
                "brand": product.brand,
                "part_number": product.part_number,
            }
            assert work.latest_event.action == "CREATED"
            assert work.latest_event.to_status == "PREPARING"

            replayed = create_publication_work(
                db=db,
                payload=PublicationWorkCreate(
                    content_version_id=content.id,
                    platform_account_id=account.id,
                ),
                actor=actor,
                request_id="publication-create-list-replay",
                idempotency_key="publication-create-list-key",
            )
            assert replayed.id == work.id
            with pytest.raises(AppError) as duplicate:
                create_publication_work(
                    db=db,
                    payload=PublicationWorkCreate(
                        content_version_id=content.id,
                        platform_account_id=account.id,
                    ),
                    actor=actor,
                    request_id="publication-create-list-duplicate",
                    idempotency_key="publication-create-list-other-key",
                )
            assert duplicate.value.code == "PUBLICATION_IDENTITY_CONFLICT"
            db.rollback()

            statements: list[str] = []

            def count_statement(
                _connection: object,
                _cursor: object,
                statement: str,
                _parameters: object,
                _context: object,
                _executemany: bool,
            ) -> None:
                statements.append(statement)

            event.listen(engine, "before_cursor_execute", count_statement)
            try:
                first_page = list_publication_works(
                    db,
                    page=1,
                    page_size=20,
                    status_filter="PREPARING",
                )
                one_work_queries = len(statements)
                assert first_page.total == 1
                assert first_page.items[0].product.id == product.id
                assert first_page.items[0].latest_event.action == "CREATED"

                second_graph = _seed_graph(db, content_hash="c" * 64)
                second_actor = second_graph["user"]
                second_content = second_graph["content"]
                second_account = second_graph["account"]
                assert isinstance(second_actor, User)
                assert isinstance(second_content, ContentVersion)
                assert isinstance(second_account, PlatformAccount)
                second_work = create_publication_work(
                    db=db,
                    payload=PublicationWorkCreate(
                        content_version_id=second_content.id,
                        platform_account_id=second_account.id,
                    ),
                    actor=second_actor,
                    request_id="publication-create-list-second",
                    idempotency_key="publication-create-list-second-key",
                )
                db.add_all(
                    [
                        PublicationWorkEvent(
                            publication_work_id=work.id,
                            action="PREPARATION_UPDATED",
                            from_status="PREPARING",
                            to_status="PREPARING",
                            comment=f"列表批量历史 {index}",
                            actor_id=actor.id,
                            created_at=datetime.now(UTC) + timedelta(seconds=index + 1),
                        )
                        for index in range(12)
                    ]
                )
                db.commit()
                statements.clear()
                two_items = list_publication_works(
                    db,
                    page=1,
                    page_size=20,
                    status_filter="PREPARING",
                )
                many_work_queries = len(statements)
            finally:
                event.remove(engine, "before_cursor_execute", count_statement)

            assert one_work_queries == many_work_queries == 4
            assert two_items.total == 2
            assert {item.id for item in two_items.items} == {work.id, second_work.id}


@pytest.mark.integration
def test_publication_workspace_context_is_consistent_and_bounded() -> None:
    """工作台 Context 用固定查询返回批准正文、合法账号和换版候选。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            task = graph["task"]
            content = graph["content"]
            profile = graph["profile"]
            account = graph["account"]
            assert isinstance(actor, User)
            assert isinstance(task, ContentTask)
            assert isinstance(content, ContentVersion)
            assert isinstance(profile, PlatformProfile)
            assert isinstance(account, PlatformAccount)
            profile.website_url = "https://community.example.invalid"
            alternate_account = PlatformAccount(
                platform_profile_id=profile.id,
                label="备用运营账号",
                account_identifier=f"alternate-{uuid.uuid4().hex[:8]}",
            )
            disabled_account = PlatformAccount(
                platform_profile_id=profile.id,
                label="停用账号",
                account_identifier=f"disabled-{uuid.uuid4().hex[:8]}",
                is_active=False,
            )
            db.add_all([alternate_account, disabled_account])
            db.commit()
            work = create_publication_work(
                db=db,
                payload=PublicationWorkCreate(
                    content_version_id=content.id,
                    platform_account_id=account.id,
                ),
                actor=actor,
                request_id="workspace-create",
                idempotency_key="workspace-create-key",
            )

            content.status = "SUPERSEDED"
            content.revision += 1
            replacement = ContentVersion(
                task_id=task.id,
                fact_version_id=content.fact_version_id,
                based_on_id=content.id,
                version=2,
                source_type="HUMAN",
                title="测试器件选型（修订）",
                summary="修订后的冻结摘要",
                body_markdown="# 修订正文\n\n典型工作电压仍为 3.3 V。",
                tags=["PS", "修订"],
                content_hash="d" * 64,
                status="APPROVED",
                quality_issues=[],
                change_summary="发布前修订",
                created_by=actor.id,
            )
            db.add(replacement)
            db.flush()
            task.current_content_version_id = replacement.id
            db.commit()
            db.connection(execution_options={"isolation_level": "REPEATABLE READ"})

            statements: list[str] = []

            def count_statement(
                _connection: object,
                _cursor: object,
                statement: str,
                _parameters: object,
                _context: object,
                _executemany: bool,
            ) -> None:
                statements.append(statement)

            event.listen(engine, "before_cursor_execute", count_statement)
            try:
                context = publication_workspace_context(db, work.id)
            finally:
                event.remove(engine, "before_cursor_execute", count_statement)

            assert len(statements) == 5
            assert context.work.id == work.id
            assert context.content.id == content.id
            assert context.content.body_markdown == content.body_markdown
            assert context.platform.id == profile.id
            assert str(context.platform.website_url).rstrip("/") == profile.website_url
            assert [option.id for option in context.eligible_accounts] == [
                alternate_account.id,
                account.id,
            ]
            assert context.switch_candidate is not None
            assert context.switch_candidate.id == replacement.id
            assert context.switch_candidate.content_hash == replacement.content_hash

            db.commit()
            db.add_all(
                [
                    PlatformAccount(
                        platform_profile_id=profile.id,
                        label=f"批量账号 {index:02d}",
                        account_identifier=f"bulk-{index:02d}-{uuid.uuid4().hex[:8]}",
                    )
                    for index in range(12)
                ]
            )
            db.add_all(
                [
                    PublicationWorkEvent(
                        publication_work_id=work.id,
                        action="PREPARATION_UPDATED",
                        from_status="PREPARING",
                        to_status="PREPARING",
                        comment=f"工作台批量历史 {index}",
                        actor_id=actor.id,
                        created_at=datetime.now(UTC) + timedelta(seconds=index + 1),
                    )
                    for index in range(12)
                ]
            )
            db.commit()
            db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
            statements.clear()
            event.listen(engine, "before_cursor_execute", count_statement)
            try:
                expanded_context = publication_workspace_context(db, work.id)
            finally:
                event.remove(engine, "before_cursor_execute", count_statement)
            assert len(statements) == 5
            assert len(expanded_context.eligible_accounts) == 14
            assert len(expanded_context.work.events) == 13

            with pytest.raises(AppError) as missing:
                publication_workspace_context(db, uuid.uuid4())
            assert missing.value.status_code == 404


@pytest.mark.integration
def test_publication_workspace_core_commands_evidence_and_close() -> None:
    """准备、平台审核、证据结果和独立关闭均沿用真实服务端状态机。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            content = graph["content"]
            profile = graph["profile"]
            account = graph["account"]
            assert isinstance(actor, User)
            assert isinstance(content, ContentVersion)
            assert isinstance(profile, PlatformProfile)
            assert isinstance(account, PlatformAccount)
            alternate_account = PlatformAccount(
                platform_profile_id=profile.id,
                label="结果登记账号",
                account_identifier=f"result-{uuid.uuid4().hex[:8]}",
            )
            now = datetime.now(UTC)
            evidence = FileRecord(
                category="OPERATION_SCREENSHOT",
                original_filename="publication-proof.png",
                object_key=f"integration/{uuid.uuid4()}/publication-proof.png",
                content_type="image/png",
                size=256,
                sha256="2" * 64,
                access_level="INTERNAL",
                status="VERIFIED",
                uploader_id=actor.id,
                upload_expires_at=now + timedelta(days=1),
                verified_at=now,
            )
            db.add_all([alternate_account, evidence])
            db.commit()
            work = create_publication_work(
                db=db,
                payload=PublicationWorkCreate(
                    content_version_id=content.id,
                    platform_account_id=account.id,
                ),
                actor=actor,
                request_id="workspace-core-create",
                idempotency_key="workspace-core-create-key",
            )
            prepared = update_publication_preparation(
                db=db,
                work_id=work.id,
                payload=PublicationPreparationUpdate(
                    platform_account_id=alternate_account.id,
                    expected_revision=work.revision,
                    comment="改用结果登记账号",
                ),
                actor=actor,
                request_id="workspace-core-preparation",
            )
            reviewed = mark_publication_platform_review(
                db=db,
                work_id=work.id,
                payload=PublicationPlatformReviewRequest(
                    expected_revision=prepared.revision,
                    comment="已提交外部平台审核",
                ),
                actor=actor,
                request_id="workspace-core-review",
            )
            result = register_publication_result(
                db=db,
                work_id=work.id,
                payload=PublicationResultUpdate(
                    actual_title="公开测试器件选型",
                    final_url="https://community.example.invalid/articles/workspace-core",
                    published_at="2026-08-11T08:00:00Z",
                    expected_revision=reviewed.revision,
                    comment="登记真实公开结果",
                    attachment_file_ids=[evidence.id],
                ),
                actor=actor,
                request_id="workspace-core-result",
            )
            assert result.status == "AWAITING_VERIFICATION"
            assert [attachment.id for attachment in result.attachments] == [evidence.id]
            assert [item.action for item in result.events] == [
                "CREATED",
                "PREPARATION_UPDATED",
                "PLATFORM_REVIEW_MARKED",
                "RESULT_REGISTERED",
            ]

            closing_graph = _seed_graph(db, content_hash="e" * 64)
            closing_actor = closing_graph["user"]
            closing_content = closing_graph["content"]
            closing_account = closing_graph["account"]
            assert isinstance(closing_actor, User)
            assert isinstance(closing_content, ContentVersion)
            assert isinstance(closing_account, PlatformAccount)
            closing_work = create_publication_work(
                db=db,
                payload=PublicationWorkCreate(
                    content_version_id=closing_content.id,
                    platform_account_id=closing_account.id,
                ),
                actor=closing_actor,
                request_id="workspace-close-create",
                idempotency_key="workspace-close-create-key",
            )
            closed = close_publication_work(
                db=db,
                work_id=closing_work.id,
                payload=PublicationWorkCloseRequest(
                    reason="BUSINESS_CANCELLED",
                    comment="业务决定停止发布",
                    expected_revision=closing_work.revision,
                ),
                actor=closing_actor,
                request_id="workspace-close",
            )
            assert closed.status == "CLOSED"
            assert db.get(ContentTask, closing_content.task_id).status == "CANCELLED"


@pytest.mark.integration
def test_query_topic_delete_requires_no_direct_business_references() -> None:
    """问题删除必须复核三类直接引用、revision 和成功审计。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            product = graph["product"]
            task = graph["task"]
            topic = graph["topic"]
            assert isinstance(actor, User)
            assert isinstance(product, Product)
            assert isinstance(task, ContentTask)
            assert isinstance(topic, QueryTopic)
            actor.account_type = "ADMIN"
            db.commit()

            db.add_all(
                [
                    ContentTaskGeoSource(
                        content_task_id=task.id,
                        rule_code="QUESTION_COVERAGE_GAP",
                        date_from=date(2026, 8, 1),
                        date_to=date(2026, 8, 6),
                        query_topic_id=topic.id,
                        basis_snapshot={"source": "integration-test"},
                        created_by=actor.id,
                    ),
                    GeoObservation(
                        observation_kind="MANUAL_ARTICLE_SEARCH",
                        query_topic_id=topic.id,
                        product_id=product.id,
                        search_platform="测试搜索平台",
                        search_query=topic.canonical_question,
                        tested_at=datetime(2026, 8, 6, tzinfo=UTC),
                        notes="删除阻断测试",
                        tested_by=actor.id,
                    ),
                ]
            )
            db.commit()

            projected = query_topics_out(db, [topic], can_delete=True)[0]
            assert projected.available_actions == ["UPDATE"]
            assert projected.deletion.model_dump() == {
                "blockers": [
                    {"type": "CONTENT_TASK", "count": 1},
                    {"type": "GEO_OPTIMIZATION_SOURCE", "count": 1},
                    {"type": "GEO_OBSERVATION", "count": 1},
                ]
            }
            with pytest.raises(AppError) as blocked:
                delete_query_topic(
                    db=db,
                    query_topic_id=topic.id,
                    expected_revision=topic.revision,
                    actor=actor,
                    request_id="query-topic-blocked",
                )
            assert blocked.value.code == "QUERY_TOPIC_IN_USE"
            assert blocked.value.details == {
                "references": [
                    {"type": "CONTENT_TASK", "count": 1},
                    {"type": "GEO_OPTIMIZATION_SOURCE", "count": 1},
                    {"type": "GEO_OBSERVATION", "count": 1},
                ]
            }
            assert db.get(QueryTopic, topic.id) is not None
            assert (
                db.scalar(
                    select(AuditLog).where(
                        AuditLog.action == "query_topic.deleted",
                        AuditLog.target_id == str(topic.id),
                    )
                )
                is None
            )

            race_topic = QueryTopic(
                canonical_question="读取后才产生引用的问题",
                intent_type="PRODUCT",
                variants=["并发引用测试"],
            )
            db.add(race_topic)
            db.commit()
            assert query_topics_out(db, [race_topic], can_delete=True)[0].available_actions == [
                "UPDATE",
                "DELETE",
            ]
            db.add(
                GeoObservation(
                    observation_kind="MANUAL_ARTICLE_SEARCH",
                    query_topic_id=race_topic.id,
                    product_id=product.id,
                    search_platform="测试搜索平台",
                    search_query=race_topic.canonical_question,
                    tested_at=datetime(2026, 8, 6, tzinfo=UTC),
                    notes="读取投影后新增引用",
                    tested_by=actor.id,
                )
            )
            db.commit()
            with pytest.raises(AppError) as raced:
                delete_query_topic(
                    db=db,
                    query_topic_id=race_topic.id,
                    expected_revision=race_topic.revision,
                    actor=actor,
                    request_id="query-topic-raced",
                )
            assert raced.value.code == "QUERY_TOPIC_IN_USE"
            assert raced.value.details == {"references": [{"type": "GEO_OBSERVATION", "count": 1}]}
            assert db.get(QueryTopic, race_topic.id) is not None

            stale_topic = QueryTopic(
                canonical_question="revision 变化的问题",
                intent_type="PRODUCT",
                variants=["revision 测试"],
            )
            db.add(stale_topic)
            db.commit()
            with pytest.raises(AppError) as stale:
                delete_query_topic(
                    db=db,
                    query_topic_id=stale_topic.id,
                    expected_revision=stale_topic.revision + 1,
                    actor=actor,
                    request_id="query-topic-stale",
                )
            assert stale.value.code == "REVISION_CONFLICT"
            assert db.get(QueryTopic, stale_topic.id) is not None

            deletable_topic = QueryTopic(
                canonical_question="尚未使用的问题",
                intent_type="PRODUCT",
                variants=["待删除测试问题"],
            )
            db.add(deletable_topic)
            db.commit()
            deleted_id = deletable_topic.id
            deleted_revision = deletable_topic.revision
            delete_query_topic(
                db=db,
                query_topic_id=deleted_id,
                expected_revision=deleted_revision,
                actor=actor,
                request_id="query-topic-delete",
            )
            assert db.get(QueryTopic, deleted_id) is None
            audit = db.scalar(
                select(AuditLog).where(
                    AuditLog.action == "query_topic.deleted",
                    AuditLog.target_id == str(deleted_id),
                )
            )
            assert audit is not None
            assert audit.details == {"facts": {"revision": deleted_revision}}
            with pytest.raises(AppError) as repeated:
                delete_query_topic(
                    db=db,
                    query_topic_id=deleted_id,
                    expected_revision=deleted_revision,
                    actor=actor,
                    request_id="query-topic-delete-repeat",
                )
            assert repeated.value.code == "NOT_FOUND"


@pytest.mark.integration
def test_failed_verification_remains_pending_then_completes_and_opens_issue() -> None:
    """失败记录可追加；换版后必须重新登记结果，复核成功才产生成果。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            user = graph["user"]
            content = graph["content"]
            account = graph["account"]
            product = graph["product"]
            fact = graph["fact"]
            assert isinstance(user, User)
            assert isinstance(content, ContentVersion)
            assert isinstance(account, PlatformAccount)
            assert isinstance(product, Product)
            assert isinstance(fact, FactVersion)
            ready = list_publication_ready_items(db, can_delete_accounts=False)
            assert [item.content_version.id for item in ready.items] == [content.id]
            work = create_publication_work(
                db=db,
                payload=PublicationWorkCreate(
                    content_version_id=content.id,
                    platform_account_id=account.id,
                ),
                actor=user,
                request_id="publication-create",
                idempotency_key="publication-create-key",
            )
            repeated = create_publication_work(
                db=db,
                payload=PublicationWorkCreate(
                    content_version_id=content.id,
                    platform_account_id=account.id,
                ),
                actor=user,
                request_id="publication-create-repeat",
                idempotency_key="publication-create-key",
            )
            assert repeated.id == work.id
            with pytest.raises(AppError) as invalid_result:
                register_publication_result(
                    db=db,
                    work_id=work.id,
                    payload=PublicationResultUpdate(
                        actual_title="公开测试器件选型",
                        final_url="https://wrong.example.invalid/articles/ps",
                        published_at="2026-08-03T08:00:00Z",
                        expected_revision=work.revision,
                        comment="登记错误域名",
                    ),
                    actor=user,
                    request_id="publication-result-invalid-domain",
                )
            assert invalid_result.value.code == "VALIDATION_ERROR"
            work = register_publication_result(
                db=db,
                work_id=work.id,
                payload=PublicationResultUpdate(
                    actual_title="公开测试器件选型",
                    final_url="https://community.example.invalid/articles/ps",
                    published_at="2026-08-03T08:00:00Z",
                    expected_revision=work.revision,
                    comment="登记公开结果",
                ),
                actor=user,
                request_id="publication-result",
            )
            failed = verify_publication_work(
                db=db,
                work_id=work.id,
                payload=PublicationVerificationCreate(
                    outcome="FAILED",
                    content_matches=False,
                    expected_revision=work.revision,
                    comment="页面正文尚未完整同步",
                ),
                actor=user,
                request_id="publication-verification-failed",
            )
            assert failed.status == "ACTION_REQUIRED"
            assert db.get(PublishedArticle, work.id) is None
            assert db.get(ContentTask, content.task_id).status == "OPEN"
            no_candidate = publication_workspace_context(db, work.id)
            assert no_candidate.switch_candidate is None
            assert "VERIFY" in no_candidate.work.available_actions

            repeated_failed = verify_publication_work(
                db=db,
                work_id=work.id,
                payload=PublicationVerificationCreate(
                    outcome="FAILED",
                    content_matches=False,
                    expected_revision=failed.revision,
                    comment="复查后页面正文仍未同步",
                ),
                actor=user,
                request_id="publication-verification-failed-repeat",
            )
            assert repeated_failed.status == "ACTION_REQUIRED"
            task = db.get(ContentTask, content.task_id)
            assert task is not None
            action_required_task = content_task_out(db, task)
            assert (
                action_required_task.workflow_stage,
                action_required_task.primary_task,
            ) == ("PUBLISHING", "REVISE_CONTENT")

            first_revision = create_content_revision(
                db=db,
                content_version_id=content.id,
                payload=ContentRevisionCreate(
                    title="测试器件选型（初次修订）",
                    summary="冻结事实摘要",
                    body_markdown="# 测试器件\n\n初次修订后的公开正文。",
                    tags=["PS"],
                    change_summary="根据失败核验创建修订",
                ),
                actor=user,
                request_id="publication-content-revision-first",
            )
            db.refresh(task)
            draft_task = content_task_out(db, task)
            assert (draft_task.workflow_stage, draft_task.primary_task) == (
                "DRAFT",
                "EDIT_AND_SUBMIT_REVIEW",
            )
            saved_revision = update_content_draft(
                db=db,
                content_version_id=first_revision.id,
                payload=ContentDraftUpdate(
                    expected_revision=first_revision.revision,
                    title=first_revision.title,
                    summary=first_revision.summary,
                    body_markdown="# 测试器件\n\n已保存的初次修订正文。",
                    tags=first_revision.tags,
                ),
                actor=user,
                request_id="publication-content-revision-save",
            )
            submitted_revision = transition_content_version(
                db=db,
                content_version_id=saved_revision.id,
                expected_revision=saved_revision.revision,
                comment="提交失败核验修订",
                actor=user,
                request_id="publication-content-revision-submit",
                action="submit-review",
            )
            db.refresh(task)
            review_task = content_task_out(db, task)
            assert (review_task.workflow_stage, review_task.primary_task) == (
                "REVIEW_PENDING",
                "REVIEW_CONTENT",
            )
            returned_revision = transition_content_version(
                db=db,
                content_version_id=submitted_revision.id,
                expected_revision=submitted_revision.revision,
                comment="补充失败核验修正说明",
                actor=user,
                request_id="publication-content-revision-return",
                action="request-changes",
            )
            db.refresh(task)
            returned_task = content_task_out(db, task)
            assert (returned_task.workflow_stage, returned_task.primary_task) == (
                "CHANGES_REQUESTED",
                "REVISE_CONTENT",
            )
            final_draft = create_content_revision(
                db=db,
                content_version_id=returned_revision.id,
                payload=ContentRevisionCreate(
                    title="测试器件选型（修订）",
                    summary="冻结事实摘要",
                    body_markdown="# 测试器件\n\n修订后的公开正文。",
                    tags=["PS"],
                    change_summary="根据审核意见完成修订",
                ),
                actor=user,
                request_id="publication-content-revision-final",
            )
            final_submitted = transition_content_version(
                db=db,
                content_version_id=final_draft.id,
                expected_revision=final_draft.revision,
                comment="重新提交失败核验修订",
                actor=user,
                request_id="publication-content-revision-resubmit",
                action="submit-review",
            )
            revised_content = transition_content_version(
                db=db,
                content_version_id=final_submitted.id,
                expected_revision=final_submitted.revision,
                comment="批准失败核验替代版本",
                actor=user,
                request_id="publication-content-revision-approve",
                action="approve",
            )
            db.refresh(task)
            approved_task = content_task_out(db, task)
            assert (approved_task.workflow_stage, approved_task.primary_task) == (
                "PUBLISHING",
                "CONTINUE_PUBLICATION",
            )
            db.refresh(content)
            assert content.status == "SUPERSEDED"
            assert revised_content.status == "APPROVED"
            assert revised_content.based_on_id == returned_revision.id

            candidate_context = publication_workspace_context(db, work.id)
            assert candidate_context.switch_candidate is not None
            assert candidate_context.switch_candidate.id == revised_content.id
            assert candidate_context.switch_candidate.content_hash == revised_content.content_hash

            switched = switch_publication_content_version(
                db=db,
                work_id=work.id,
                payload=PublicationContentVersionSwitchRequest(
                    content_version_id=revised_content.id,
                    expected_revision=repeated_failed.revision,
                    comment="切换到修订批准版本",
                ),
                actor=user,
                request_id="publication-version-switch",
            )
            assert switched.content_version_id == revised_content.id
            db.refresh(task)
            switched_task = content_task_out(db, task)
            assert (switched_task.workflow_stage, switched_task.primary_task) == (
                "PUBLISHING",
                "CONTINUE_PUBLICATION",
            )
            switch_event = db.scalar(
                select(PublicationWorkEvent).where(
                    PublicationWorkEvent.publication_work_id == work.id,
                    PublicationWorkEvent.action == "CONTENT_VERSION_CHANGED",
                )
            )
            assert switch_event is not None
            assert switch_event.from_content_version_id == content.id
            assert switch_event.to_content_version_id == revised_content.id
            switched_context = publication_workspace_context(db, work.id)
            assert switched_context.content.id == revised_content.id
            assert switched_context.switch_candidate is None
            assert "VERIFY" not in switched_context.work.available_actions
            assert switched_context.work.primary_task == "REGISTER_RESULT"
            assert [item.content_version_id for item in switched_context.work.verifications] == [
                content.id,
                content.id,
            ]
            before_rejected_verification = _publication_verification_snapshot(db, work.id)
            with pytest.raises(AppError) as stale_result_verification:
                verify_publication_work(
                    db=db,
                    work_id=work.id,
                    payload=PublicationVerificationCreate(
                        outcome="PASSED",
                        content_matches=True,
                        expected_revision=switched.revision,
                        comment="",
                    ),
                    actor=user,
                    request_id="publication-verification-stale-result",
                )
            assert stale_result_verification.value.code == "INVALID_STATE_TRANSITION"
            assert stale_result_verification.value.message == (
                "当前发布工作不能核验，请先重新登记发布结果"
            )
            assert _publication_verification_snapshot(db, work.id) == (
                before_rejected_verification
            )
            reregistered = register_publication_result(
                db=db,
                work_id=work.id,
                payload=PublicationResultUpdate(
                    actual_title="公开测试器件选型（修订）",
                    final_url="https://community.example.invalid/articles/ps-revised",
                    published_at="2026-08-03T09:00:00Z",
                    expected_revision=switched.revision,
                    comment="换版后重新登记公开结果",
                ),
                actor=user,
                request_id="publication-result-reregistered",
            )
            assert reregistered.status == "AWAITING_VERIFICATION"
            assert "VERIFY" in reregistered.available_actions
            completed = verify_publication_work(
                db=db,
                work_id=work.id,
                payload=PublicationVerificationCreate(
                    outcome="PASSED",
                    content_matches=True,
                    expected_revision=reregistered.revision,
                    comment="页面修正后复核通过",
                ),
                actor=user,
                request_id="publication-verification-passed",
            )
            assert completed.status == "COMPLETED"
            assert db.get(PublishedArticle, work.id) is not None
            assert db.get(ContentTask, content.task_id).status == "COMPLETED"
            assert (
                db.scalar(
                    select(func.count(PublicationVerification.id)).where(
                        PublicationVerification.publication_work_id == work.id
                    )
                )
                == 3
            )
            verification_versions = list(
                db.scalars(
                    select(PublicationVerification.content_version_id)
                    .where(PublicationVerification.publication_work_id == work.id)
                    .order_by(PublicationVerification.created_at)
                )
            )
            assert verification_versions == [content.id, content.id, revised_content.id]
            with pytest.raises(AppError) as terminal_switch:
                switch_publication_content_version(
                    db=db,
                    work_id=work.id,
                    payload=PublicationContentVersionSwitchRequest(
                        content_version_id=content.id,
                        expected_revision=completed.revision,
                        comment="终态禁止切换",
                    ),
                    actor=user,
                    request_id="publication-terminal-switch",
                )
            assert terminal_switch.value.code == "INVALID_STATE_TRANSITION"
            assert [
                candidate.published_article_id
                for candidate in geo_publication_candidates(db, product.id)
            ] == [work.id]
            issue = open_published_content_issue(
                db=db,
                article_id=work.id,
                payload=PublishedContentIssueCreate(
                    kind="CONTENT_CHANGED",
                    description="页面后来出现与批准正文不一致的修改",
                ),
                actor=user,
                request_id="publication-issue-open",
            )
            assert issue.status == "OPEN"
            assert geo_publication_candidates(db, product.id) == []
            issue_list = list_published_content_issues(
                db,
                page=1,
                page_size=20,
                status_filter="OPEN",
            )
            assert [item.id for item in issue_list.items] == [issue.id]
            assert issue_list.items[0].primary_task == "HANDLE_CONTENT_ISSUE"
            issue_workspace = published_content_issue_workspace_context(db, issue.id)
            assert issue_workspace.issue.article.id == issue_workspace.article.id == work.id
            assert issue_workspace.repair_task is None
            repair_task = create_repair_task(
                db=db,
                issue_id=issue.id,
                payload=PublishedContentRepairTaskCreate(
                    fact_version_id=fact.id,
                    expected_issue_revision=issue.revision,
                ),
                actor=user,
                request_id="publication-repair-task",
            )
            assert repair_task.source_published_content_issue_id == issue.id
            repair_workspace = published_content_issue_workspace_context(db, issue.id)
            assert repair_workspace.issue.status == "OPEN"
            assert repair_workspace.issue.primary_task == "CONTINUE_REPAIR"
            assert repair_workspace.repair_task is not None
            assert repair_workspace.repair_task.id == repair_task.id
            resolved = resolve_published_content_issue(
                db=db,
                issue_id=issue.id,
                payload=PublishedContentIssueResolveRequest(
                    outcome="RESTORED",
                    comment="页面已恢复为批准正文",
                    expected_revision=issue.revision,
                ),
                actor=user,
                request_id="publication-issue-resolve",
            )
            assert resolved.status == "RESOLVED"
            resolved_workspace = published_content_issue_workspace_context(db, issue.id)
            assert resolved_workspace.issue.primary_task == "VIEW_RESOLUTION"
            assert resolved_workspace.repair_task is not None
            assert resolved_workspace.repair_task.status == "OPEN"
            assert [
                candidate.published_article_id
                for candidate in geo_publication_candidates(db, product.id)
            ] == [work.id]
            with pytest.raises(DBAPIError):
                db.execute(
                    update(PublicationWork)
                    .where(PublicationWork.id == work.id)
                    .values(status="ACTION_REQUIRED")
                )
            db.rollback()


@pytest.mark.integration
def test_publication_verification_final_authority_rejects_awaiting_switch_over_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AWAITING 换版后真实 HTTP 核验被拒绝，缺事件同样显式失败。"""
    class ForbiddenApplicationClock:
        @classmethod
        def now(cls, *_args: object, **_kwargs: object) -> datetime:
            raise AssertionError("发布事件不得读取应用进程时钟")

    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="6" * 64)
            actor = graph["user"]
            content = graph["content"]
            account = graph["account"]
            assert isinstance(actor, User)
            assert isinstance(content, ContentVersion)
            assert isinstance(account, PlatformAccount)

            work = create_publication_work(
                db=db,
                payload=PublicationWorkCreate(
                    content_version_id=content.id,
                    platform_account_id=account.id,
                ),
                actor=actor,
                request_id="verification-authority-create",
                idempotency_key="verification-authority-create-key",
            )
            registered = register_publication_result(
                db=db,
                work_id=work.id,
                payload=PublicationResultUpdate(
                    actual_title="换版前公开标题",
                    final_url="https://community.example.invalid/articles/authority-old",
                    published_at="2026-08-03T10:00:00Z",
                    expected_revision=work.revision,
                    comment="登记换版前结果",
                ),
                actor=actor,
                request_id="verification-authority-result",
            )
            failed = verify_publication_work(
                db=db,
                work_id=work.id,
                payload=PublicationVerificationCreate(
                    outcome="FAILED",
                    content_matches=False,
                    expected_revision=registered.revision,
                    comment="页面正文需要修订",
                ),
                actor=actor,
                request_id="verification-authority-failed",
            )
            revision = create_content_revision(
                db=db,
                content_version_id=content.id,
                payload=ContentRevisionCreate(
                    title="换版后的批准标题",
                    summary="换版后的批准摘要",
                    body_markdown="# 换版正文\n\n这是重新批准的公开正文。",
                    tags=["PS"],
                    change_summary="根据核验失败修订正文",
                ),
                actor=actor,
                request_id="verification-authority-revision",
            )
            submitted = transition_content_version(
                db=db,
                content_version_id=revision.id,
                expected_revision=revision.revision,
                comment="提交换版正文审核",
                actor=actor,
                request_id="verification-authority-submit",
                action="submit-review",
            )
            replacement = transition_content_version(
                db=db,
                content_version_id=submitted.id,
                expected_revision=submitted.revision,
                comment="批准换版正文",
                actor=actor,
                request_id="verification-authority-approve",
                action="approve",
            )
            actor_id = actor.id
            work_id = work.id
            failed_revision = failed.revision
            replacement_id = replacement.id

        with Session(engine, expire_on_commit=False) as switch_db:
            switch_actor = switch_db.get(User, actor_id)
            assert switch_actor is not None
            switch_transaction_started_at = switch_db.scalar(select(func.now()))
            assert switch_transaction_started_at is not None
            switch_db.execute(select(func.pg_sleep(0.001)))
            with Session(engine, expire_on_commit=False) as register_db:
                register_actor = register_db.get(User, actor_id)
                assert register_actor is not None
                with monkeypatch.context() as patch:
                    patch.setattr(publication_service, "datetime", ForbiddenApplicationClock)
                    awaiting = register_publication_result(
                        db=register_db,
                        work_id=work_id,
                        payload=PublicationResultUpdate(
                            actual_title="仍属于旧内容的公开标题",
                            final_url=(
                                "https://community.example.invalid/articles/authority-old-result"
                            ),
                            published_at="2026-08-03T10:30:00Z",
                            expected_revision=failed_revision,
                            comment="换版前修正旧内容结果",
                        ),
                        actor=register_actor,
                        request_id="verification-authority-reregister-old",
                    )
                result_registered_event = register_db.scalar(
                    select(PublicationWorkEvent)
                    .where(
                        PublicationWorkEvent.publication_work_id == work_id,
                        PublicationWorkEvent.action == "RESULT_REGISTERED",
                    )
                    .order_by(
                        PublicationWorkEvent.created_at.desc(),
                        PublicationWorkEvent.id.desc(),
                    )
                    .limit(1)
                )
                assert result_registered_event is not None
                assert switch_transaction_started_at < result_registered_event.created_at
            assert awaiting.status == "AWAITING_VERIFICATION"
            with monkeypatch.context() as patch:
                patch.setattr(publication_service, "datetime", ForbiddenApplicationClock)
                switched = switch_publication_content_version(
                    db=switch_db,
                    work_id=work_id,
                    payload=PublicationContentVersionSwitchRequest(
                        content_version_id=replacement_id,
                        expected_revision=awaiting.revision,
                        comment="等待核验阶段切换到新批准版本",
                    ),
                    actor=switch_actor,
                    request_id="verification-authority-switch",
                )
            assert switched.status == "AWAITING_VERIFICATION"
            assert switched.content_version_id == replacement_id
            assert "VERIFY" not in switched.available_actions
            assert switched.primary_task == "REGISTER_RESULT"
            latest_event = switch_db.scalar(
                select(PublicationWorkEvent)
                .where(PublicationWorkEvent.publication_work_id == work_id)
                .order_by(
                    PublicationWorkEvent.created_at.desc(),
                    PublicationWorkEvent.id.desc(),
                )
                .limit(1)
            )
            assert latest_event is not None
            assert latest_event.action == "CONTENT_VERSION_CHANGED"
            assert result_registered_event.created_at < latest_event.created_at
            before_http_rejection = _publication_verification_snapshot(switch_db, work_id)
            switched_revision = switched.revision

        csrf_token = "publication-verification-authority-csrf-token"

        def database_session() -> Iterator[Session]:
            with Session(engine, expire_on_commit=False) as request_db:
                yield request_db

        with Session(engine, expire_on_commit=False) as db:
            current_actor = db.get(User, actor_id)
            assert current_actor is not None
        app.dependency_overrides[get_db] = database_session
        app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
            user=current_actor,
            csrf_hash=hash_token(csrf_token),
        )
        try:
            response = TestClient(app).post(
                f"/api/v1/publication-works/{work_id}/verifications",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "outcome": "PASSED",
                    "content_matches": True,
                    "expected_revision": switched_revision,
                    "comment": "",
                },
            )
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 409
        error = response.json()["error"]
        assert error["code"] == "INVALID_STATE_TRANSITION"
        assert error["message"] == "当前发布工作不能核验，请先重新登记发布结果"
        assert error["request_id"]
        with Session(engine, expire_on_commit=False) as db:
            assert _publication_verification_snapshot(db, work_id) == before_http_rejection

            malformed_graph = _seed_graph(db, content_hash="7" * 64)
            malformed_actor = malformed_graph["user"]
            malformed_task = malformed_graph["task"]
            malformed_content = malformed_graph["content"]
            malformed_profile = malformed_graph["profile"]
            malformed_account = malformed_graph["account"]
            assert isinstance(malformed_actor, User)
            assert isinstance(malformed_task, ContentTask)
            assert isinstance(malformed_content, ContentVersion)
            assert isinstance(malformed_profile, PlatformProfile)
            assert isinstance(malformed_account, PlatformAccount)
            malformed_work = PublicationWork(
                idempotency_key="verification-authority-missing-event",
                content_task_id=malformed_task.id,
                content_version_id=malformed_content.id,
                platform_profile_id=malformed_profile.id,
                platform_profile_id_snapshot=malformed_profile.id,
                platform_profile_name_snapshot=malformed_profile.name,
                platform_account_id=malformed_account.id,
                platform_account_label_snapshot=malformed_account.label,
                account_identifier_snapshot=malformed_account.account_identifier,
                content_hash=malformed_content.content_hash,
                created_by=malformed_actor.id,
            )
            db.add(malformed_work)
            db.commit()
            before_missing_event = _publication_verification_snapshot(db, malformed_work.id)
            with pytest.raises(AppError) as missing_event:
                verify_publication_work(
                    db=db,
                    work_id=malformed_work.id,
                    payload=PublicationVerificationCreate(
                        outcome="PASSED",
                        content_matches=True,
                        expected_revision=malformed_work.revision,
                        comment="",
                    ),
                    actor=malformed_actor,
                    request_id="verification-authority-missing-event",
                )
            assert missing_event.value.code == "PUBLICATION_CONTEXT_INCOMPLETE"
            assert missing_event.value.message == "发布工作缺少状态事件"
            assert _publication_verification_snapshot(db, malformed_work.id) == (
                before_missing_event
            )


@pytest.mark.integration
def test_publication_event_timestamp_uses_strict_database_clock_floor() -> None:
    """数据库时钟落后于历史事件时，后续事件仍严格递增一微秒。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="8" * 64)
            actor = graph["user"]
            content = graph["content"]
            account = graph["account"]
            assert isinstance(actor, User)
            assert isinstance(content, ContentVersion)
            assert isinstance(account, PlatformAccount)
            work = create_publication_work(
                db=db,
                payload=PublicationWorkCreate(
                    content_version_id=content.id,
                    platform_account_id=account.id,
                ),
                actor=actor,
                request_id="event-clock-floor-create",
                idempotency_key="event-clock-floor-create-key",
            )

            database_now = db.scalar(select(func.clock_timestamp()))
            assert database_now is not None
            previous_max = database_now + timedelta(days=1)
            assert previous_max > database_now
            db.add(
                PublicationWorkEvent(
                    publication_work_id=work.id,
                    action="PREPARATION_UPDATED",
                    from_status="PREPARING",
                    to_status="PREPARING",
                    comment="未来时间的合法历史事件",
                    actor_id=actor.id,
                    created_at=previous_max,
                )
            )
            db.commit()

            updated = update_publication_preparation(
                db=db,
                work_id=work.id,
                payload=PublicationPreparationUpdate(
                    platform_account_id=account.id,
                    expected_revision=work.revision,
                    comment="追加数据库时钟下限回归事件",
                ),
                actor=actor,
                request_id="event-clock-floor-append",
            )
            events = db.scalars(
                select(PublicationWorkEvent)
                .where(PublicationWorkEvent.publication_work_id == work.id)
                .order_by(PublicationWorkEvent.created_at, PublicationWorkEvent.id)
            ).all()
            assert events[-1].action == "PREPARATION_UPDATED"
            assert events[-1].created_at == previous_max + timedelta(microseconds=1)
            assert updated.latest_event.action == "PREPARATION_UPDATED"


@pytest.mark.integration
def test_content_task_delete_and_archive_permanent_delete_lifecycle() -> None:
    """带 AI 版本的未发布任务可聚合删除，成功任务归档后可立即永久删除。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            ordinary = _seed_graph(db, content_hash="c" * 64)
            ordinary_task = ordinary["task"]
            ordinary_content = ordinary["content"]
            actor = ordinary["user"]
            assert isinstance(ordinary_task, ContentTask)
            assert isinstance(ordinary_content, ContentVersion)
            assert isinstance(actor, User)

            ordinary_job = GenerationJob(
                content_task_id=ordinary_task.id,
                idempotency_key=f"ordinary-delete-{uuid.uuid4()}",
                job_type="GENERATE",
                status="SUCCEEDED",
                input_snapshot={},
                adapter_name="integration-test",
                prompt_template_version="content-markdown-v3",
                prompt_hash="e" * 64,
                attempt_count=1,
                created_by=actor.id,
            )
            db.add(ordinary_job)
            db.flush()
            ordinary_ai_content = ContentVersion(
                task_id=ordinary_task.id,
                fact_version_id=ordinary_content.fact_version_id,
                source_job_id=ordinary_job.id,
                version=2,
                source_type="AI",
                title="待删除 AI 草稿",
                summary="验证任务聚合删除可断开作业引用",
                body_markdown="# 待删除 AI 草稿\n\n仅用于删除生命周期集成测试。",
                tags=["删除回归"],
                content_hash="e" * 64,
                status="DRAFT",
                quality_issues=[],
                change_summary="创建删除回归数据",
                created_by=actor.id,
            )
            db.add(ordinary_ai_content)
            db.flush()
            ordinary_job.content_version_id = ordinary_ai_content.id
            ordinary_task.current_content_version_id = ordinary_ai_content.id
            db.commit()

            with pytest.raises(AppError) as conflict:
                delete_content_task(
                    db=db,
                    task_id=ordinary_task.id,
                    expected_revision=ordinary_task.revision + 1,
                    actor=actor,
                    request_id="ordinary-task-stale-delete",
                )
            assert conflict.value.code == "REVISION_CONFLICT"
            db.rollback()

            delete_content_task(
                db=db,
                task_id=ordinary_task.id,
                expected_revision=ordinary_task.revision,
                actor=actor,
                request_id="ordinary-task-delete",
            )
            assert db.get(ContentTask, ordinary_task.id) is None
            assert db.get(ContentVersion, ordinary_content.id) is None
            assert db.get(ContentVersion, ordinary_ai_content.id) is None
            assert db.get(GenerationJob, ordinary_job.id) is None
            assert (
                db.scalar(
                    select(AuditLog).where(
                        AuditLog.action == "content_task.deleted",
                        AuditLog.target_id == str(ordinary_task.id),
                    )
                )
                is not None
            )

            permanent = _seed_graph(db, content_hash="d" * 64)
            task = permanent["task"]
            content = permanent["content"]
            account = permanent["account"]
            actor = permanent["user"]
            assert isinstance(task, ContentTask)
            assert isinstance(content, ContentVersion)
            assert isinstance(account, PlatformAccount)
            assert isinstance(actor, User)
            work = create_publication_work(
                db=db,
                payload=PublicationWorkCreate(
                    content_version_id=content.id,
                    platform_account_id=account.id,
                ),
                actor=actor,
                request_id="permanent-work-create",
                idempotency_key="permanent-work-key",
            )
            work = register_publication_result(
                db=db,
                work_id=work.id,
                payload=PublicationResultUpdate(
                    actual_title="待永久删除文章",
                    final_url="https://community.example.invalid/articles/delete",
                    published_at="2026-08-06T08:00:00Z",
                    expected_revision=work.revision,
                    comment="登记测试文章",
                ),
                actor=actor,
                request_id="permanent-work-result",
            )
            verify_publication_work(
                db=db,
                work_id=work.id,
                payload=PublicationVerificationCreate(
                    outcome="PASSED",
                    content_matches=True,
                    expected_revision=work.revision,
                    comment="",
                ),
                actor=actor,
                request_id="permanent-work-verify",
            )
            task = db.get(ContentTask, task.id)
            assert task is not None
            archived = archive_content_task(
                db=db,
                task_id=task.id,
                expected_revision=task.revision,
            )
            preview = preview_content_task_permanent_deletion(db=db, task_id=task.id)
            assert preview.counts.published_articles == 1
            assert [str(url) for url in preview.external_urls] == [
                "https://community.example.invalid/articles/delete"
            ]
            permanently_delete_content_task(
                db=db,
                task_id=task.id,
                payload=ContentTaskPermanentDeleteRequest(
                    expected_revision=archived.revision,
                    confirmation_text="永久删除",
                ),
                actor=actor,
                request_id="permanent-task-delete",
            )
            assert db.get(ContentTask, task.id) is None
            assert db.get(PublishedArticle, work.id) is None
            tombstone = db.scalar(
                select(AuditLog).where(
                    AuditLog.action == "content_task.permanently_deleted",
                    AuditLog.target_id == str(task.id),
                )
            )
            assert tombstone is not None
            assert tombstone.details == {}


@pytest.mark.integration
def test_published_article_permanent_delete_restores_source_task_and_owned_history() -> None:
    """成果删除清理自有历史、保留修复任务和批准内容，并遵守归档可见性。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="f" * 64)
            actor = graph["user"]
            task = graph["task"]
            content = graph["content"]
            fact = graph["fact"]
            assert isinstance(actor, User)
            assert isinstance(task, ContentTask)
            assert isinstance(content, ContentVersion)
            assert isinstance(fact, FactVersion)
            actor.account_type = "ADMIN"
            now = datetime.now(UTC)
            evidence = FileRecord(
                category="OPERATION_SCREENSHOT",
                original_filename="delete-proof.png",
                object_key=f"integration/{uuid.uuid4()}/delete-proof.png",
                content_type="image/png",
                size=128,
                sha256="1" * 64,
                access_level="INTERNAL",
                status="VERIFIED",
                uploader_id=actor.id,
                upload_expires_at=now + timedelta(days=1),
                verified_at=now,
            )
            db.add(evidence)
            db.commit()
            work = _complete_publication(
                db,
                graph,
                suffix="article-delete-owned",
                attachment_file_ids=[evidence.id],
            )
            issue = open_published_content_issue(
                db=db,
                article_id=work.id,
                payload=PublishedContentIssueCreate(
                    kind="CONTENT_CHANGED",
                    description="删除前保留修复任务的测试问题",
                ),
                actor=actor,
                request_id="article-delete-issue",
            )
            repair_task = create_repair_task(
                db=db,
                issue_id=issue.id,
                payload=PublishedContentRepairTaskCreate(
                    fact_version_id=fact.id,
                    expected_issue_revision=issue.revision,
                ),
                actor=actor,
                request_id="article-delete-repair",
            )
            repair_state = (
                repair_task.status,
                repair_task.revision,
                repair_task.archived_at,
            )
            task = db.get(ContentTask, task.id)
            assert task is not None
            archived = archive_content_task(
                db=db,
                task_id=task.id,
                expected_revision=task.revision,
            )
            archived_revision = archived.revision

            non_admin = list_published_articles(
                db,
                page=1,
                page_size=20,
                can_delete=False,
            ).items[0]
            admin = list_published_articles(
                db,
                page=1,
                page_size=20,
                can_delete=True,
            ).items[0]
            assert non_admin.deletion is None
            assert "PERMANENT_DELETE" not in non_admin.available_actions
            assert admin.deletion is not None and admin.deletion.blockers == []
            assert "PERMANENT_DELETE" in admin.available_actions

            preview = preview_published_article_permanent_deletion(
                db=db,
                article_id=work.id,
            )
            assert preview.revision == work.revision
            assert preview.counts.model_dump() == {
                "publication_events": 3,
                "publication_verifications": 1,
                "published_content_issues": 1,
                "detached_repair_tasks": 1,
                "attachment_relations": 1,
            }

            with pytest.raises(DBAPIError):
                db.execute(
                    delete(PublicationWorkEvent).where(
                        PublicationWorkEvent.publication_work_id == work.id
                    )
                )
                db.commit()
            db.rollback()
            with pytest.raises(AppError) as stale:
                permanently_delete_published_article(
                    db=db,
                    article_id=work.id,
                    payload=PublishedArticlePermanentDeleteRequest(
                        expected_revision=work.revision + 1,
                        confirmation_text="永久删除",
                    ),
                    actor=actor,
                    request_id="article-delete-stale",
                )
            assert stale.value.code == "REVISION_CONFLICT"
            db.rollback()
            assert db.get(PublishedArticle, work.id) is not None
            assert (
                db.scalar(
                    select(AuditLog).where(
                        AuditLog.action == "published_article.permanently_deleted",
                        AuditLog.target_id == str(work.id),
                    )
                )
                is None
            )

            permanently_delete_published_article(
                db=db,
                article_id=work.id,
                payload=PublishedArticlePermanentDeleteRequest(
                    expected_revision=work.revision,
                    confirmation_text="永久删除",
                ),
                actor=actor,
                request_id="article-delete-success",
            )
            assert db.get(PublicationWork, work.id) is None
            assert db.get(PublishedArticle, work.id) is None
            assert db.get(PublishedContentIssue, issue.id) is None
            assert (
                db.scalar(
                    select(func.count(PublicationWorkEvent.id)).where(
                        PublicationWorkEvent.publication_work_id == work.id
                    )
                )
                == 0
            )
            assert (
                db.scalar(
                    select(func.count(PublicationVerification.id)).where(
                        PublicationVerification.publication_work_id == work.id
                    )
                )
                == 0
            )
            assert db.get(PublicationAttachment, (work.id, evidence.id)) is None
            retained_repair = db.get(ContentTask, repair_task.id)
            assert retained_repair is not None
            assert retained_repair.source_published_content_issue_id is None
            assert (
                retained_repair.status,
                retained_repair.revision,
                retained_repair.archived_at,
            ) == repair_state
            retained_task = db.get(ContentTask, archived.id)
            assert retained_task is not None
            assert retained_task.status == "OPEN"
            assert retained_task.revision == archived_revision + 1
            assert retained_task.archived_at == archived.archived_at
            assert retained_task.current_content_version_id == content.id
            assert db.get(ContentVersion, content.id) is not None
            db.refresh(evidence)
            assert evidence.cleanup_after is not None
            assert list_publication_ready_items(db, can_delete_accounts=False).items == []
            restored = restore_content_task(
                db=db,
                task_id=retained_task.id,
                expected_revision=retained_task.revision,
            )
            ready_ids = [
                item.content_version.id
                for item in list_publication_ready_items(
                    db,
                    can_delete_accounts=False,
                ).items
            ]
            assert restored.status == "OPEN"
            assert ready_ids == [content.id]
            tombstone = db.scalar(
                select(AuditLog).where(
                    AuditLog.action == "published_article.permanently_deleted",
                    AuditLog.target_id == str(work.id),
                )
            )
            assert tombstone is not None
            assert tombstone.details == {}


@pytest.mark.integration
def test_published_article_delete_cancels_source_task_when_platform_was_deleted() -> None:
    """原平台已删除时，成果删除保留归档与批准内容并取消来源任务。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="6" * 64)
            actor = graph["user"]
            profile = graph["profile"]
            task = graph["task"]
            content = graph["content"]
            assert isinstance(actor, User)
            assert isinstance(profile, PlatformProfile)
            assert isinstance(task, ContentTask)
            assert isinstance(content, ContentVersion)
            actor.account_type = "ADMIN"
            db.commit()

            work = _complete_publication(db, graph, suffix="article-delete-missing-platform")
            task = db.get(ContentTask, task.id)
            assert task is not None
            archived = archive_content_task(
                db=db,
                task_id=task.id,
                expected_revision=task.revision,
            )
            archived_at = archived.archived_at
            archived_revision = archived.revision
            profile = set_platform_profile_enabled(
                db=db,
                platform_profile_id=profile.id,
                payload=RevisionRequest(expected_revision=profile.revision),
                actor=actor,
                request_id="article-delete-platform-disable",
                enabled=False,
            )
            delete_platform_profile(
                db=db,
                platform_profile_id=profile.id,
                expected_revision=profile.revision,
                actor=actor,
                request_id="article-delete-platform-delete",
            )
            db.expire_all()
            detached_task = db.get(ContentTask, task.id)
            assert detached_task is not None
            assert detached_task.platform_profile_id is None

            permanently_delete_published_article(
                db=db,
                article_id=work.id,
                payload=PublishedArticlePermanentDeleteRequest(
                    expected_revision=work.revision,
                    confirmation_text="永久删除",
                ),
                actor=actor,
                request_id="article-delete-missing-platform-success",
            )

            assert db.get(PublicationWork, work.id) is None
            assert db.get(PublishedArticle, work.id) is None
            assert (
                db.scalar(
                    select(func.count(PublicationWorkEvent.id)).where(
                        PublicationWorkEvent.publication_work_id == work.id
                    )
                )
                == 0
            )
            assert (
                db.scalar(
                    select(func.count(PublicationVerification.id)).where(
                        PublicationVerification.publication_work_id == work.id
                    )
                )
                == 0
            )
            retained_task = db.get(ContentTask, task.id)
            assert retained_task is not None
            assert retained_task.status == "CANCELLED"
            assert retained_task.revision == archived_revision + 1
            assert retained_task.archived_at == archived_at
            assert retained_task.current_content_version_id == content.id
            assert db.get(ContentVersion, content.id) is not None
            assert list_publication_ready_items(db, can_delete_accounts=False).items == []

            restored = restore_content_task(
                db=db,
                task_id=retained_task.id,
                expected_revision=retained_task.revision,
            )
            assert restored.status == "CANCELLED"
            assert restored.archived_at is None
            tombstone = db.scalar(
                select(AuditLog).where(
                    AuditLog.action == "published_article.permanently_deleted",
                    AuditLog.target_id == str(work.id),
                )
            )
            assert tombstone is not None
            assert tombstone.result_message.endswith("来源任务因原平台已删除而取消")


@pytest.mark.integration
def test_published_article_delete_blocks_distinct_geo_history_and_optimization_source() -> None:
    """两张观测关系按观测去重，优化来源独立计数，数据库最终守卫不解绑历史。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="7" * 64)
            source_graph = _seed_graph(db, content_hash="8" * 64)
            actor = graph["user"]
            product = graph["product"]
            topic = graph["topic"]
            source_task = source_graph["task"]
            assert isinstance(actor, User)
            assert isinstance(product, Product)
            assert isinstance(topic, QueryTopic)
            assert isinstance(source_task, ContentTask)
            actor.account_type = "ADMIN"
            db.commit()
            work = _complete_publication(db, graph, suffix="article-delete-blocked")
            before_reference = next(
                item
                for item in list_published_articles(
                    db,
                    page=1,
                    page_size=20,
                    can_delete=True,
                ).items
                if item.id == work.id
            )
            assert "PERMANENT_DELETE" in before_reference.available_actions
            observation = GeoObservation(
                observation_kind="MANUAL_ARTICLE_SEARCH",
                query_topic_id=topic.id,
                product_id=product.id,
                search_platform="测试搜索平台",
                search_query=topic.canonical_question,
                tested_at=datetime(2026, 8, 6, tzinfo=UTC),
                notes="同一观测同时命中发布集合和引用",
                tested_by=actor.id,
            )
            db.add(observation)
            db.flush()
            db.add_all(
                [
                    GeoObservationPublication(
                        observation_id=observation.id,
                        published_article_id=work.id,
                        discovered=True,
                        mentioned=True,
                        accuracy="ACCURATE",
                    ),
                    GeoObservationCitation(
                        observation_id=observation.id,
                        url="https://community.example.invalid/articles/article-delete-blocked",
                        source_type="PUBLISHED_ARTICLE",
                        published_article_id=work.id,
                    ),
                    ContentTaskGeoSource(
                        content_task_id=source_task.id,
                        rule_code="CONTENT_DECLINE",
                        date_from=date(2026, 8, 1),
                        date_to=date(2026, 8, 6),
                        published_article_id=work.id,
                        basis_snapshot={"source": "integration-test"},
                        created_by=actor.id,
                    ),
                ]
            )
            db.commit()

            projected = list_published_articles(
                db,
                page=1,
                page_size=20,
                can_delete=True,
            ).items
            target = next(item for item in projected if item.id == work.id)
            assert "PERMANENT_DELETE" not in target.available_actions
            assert target.deletion is not None
            assert [item.model_dump() for item in target.deletion.blockers] == [
                {"type": "GEO_OBSERVATION", "count": 1},
                {"type": "GEO_OPTIMIZATION_SOURCE", "count": 1},
            ]
            with pytest.raises(AppError) as blocked:
                preview_published_article_permanent_deletion(
                    db=db,
                    article_id=work.id,
                )
            assert blocked.value.code == "PUBLISHED_ARTICLE_IN_USE"
            assert blocked.value.details == {
                "references": [
                    {"type": "GEO_OBSERVATION", "count": 1},
                    {"type": "GEO_OPTIMIZATION_SOURCE", "count": 1},
                ]
            }
            db.rollback()
            with pytest.raises(AppError) as raced:
                permanently_delete_published_article(
                    db=db,
                    article_id=work.id,
                    payload=PublishedArticlePermanentDeleteRequest(
                        expected_revision=work.revision,
                        confirmation_text="永久删除",
                    ),
                    actor=actor,
                    request_id="article-delete-raced",
                )
            assert raced.value.code == "PUBLISHED_ARTICLE_IN_USE"
            assert raced.value.details == blocked.value.details
            db.rollback()
            db.scalar(
                select(
                    func.set_config(
                        "partsignal.published_article_delete_id",
                        str(work.id),
                        True,
                    )
                )
            )
            with pytest.raises(DBAPIError):
                db.execute(delete(PublishedArticle).where(PublishedArticle.id == work.id))
                db.commit()
            db.rollback()
            assert db.get(PublishedArticle, work.id) is not None
            assert db.get(GeoObservation, observation.id) is not None
            assert (
                db.get(
                    GeoObservationPublication,
                    (observation.id, work.id),
                )
                is not None
            )
            assert (
                db.scalar(
                    select(func.count(GeoObservationCitation.id)).where(
                        GeoObservationCitation.published_article_id == work.id
                    )
                )
                == 1
            )
            assert db.get(ContentTaskGeoSource, source_task.id) is not None
            assert (
                db.scalar(
                    select(AuditLog).where(
                        AuditLog.action == "published_article.permanently_deleted",
                        AuditLog.target_id == str(work.id),
                    )
                )
                is None
            )


@pytest.mark.integration
def test_platform_prompt_platform_profile_and_platform_account_deletion_lifecycle() -> None:
    """配置删除自动解绑，但不级联删除任务或终态发布历史。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="e" * 64)
            actor = graph["user"]
            profile = graph["profile"]
            task = graph["task"]
            content = graph["content"]
            account = graph["account"]
            assert isinstance(actor, User)
            assert isinstance(profile, PlatformProfile)
            assert isinstance(task, ContentTask)
            assert isinstance(content, ContentVersion)
            assert isinstance(account, PlatformAccount)

            prompt = PlatformPrompt(
                name=f"删除测试 Prompt {uuid.uuid4().hex[:8]}",
                template_markdown="只使用已批准事实。",
                updated_by=actor.id,
            )
            db.add(prompt)
            db.flush()
            profile.platform_prompt_id = prompt.id
            profile.revision += 1
            db.commit()
            bound_revision = profile.revision
            delete_platform_prompt(
                db=db,
                platform_prompt_id=prompt.id,
                expected_revision=prompt.revision,
                actor=actor,
                request_id="bound-prompt-delete",
            )
            assert db.get(PlatformPrompt, prompt.id) is None
            db.refresh(profile)
            assert profile.platform_prompt_id is None
            assert profile.revision == bound_revision + 1

            work = create_publication_work(
                db=db,
                payload=PublicationWorkCreate(
                    content_version_id=content.id,
                    platform_account_id=account.id,
                ),
                actor=actor,
                request_id="configuration-work-create",
                idempotency_key="configuration-work-key",
            )
            profile = set_platform_profile_enabled(
                db=db,
                platform_profile_id=profile.id,
                payload=RevisionRequest(expected_revision=profile.revision),
                actor=actor,
                request_id="configuration-platform-disable",
                enabled=False,
            )
            with pytest.raises(AppError) as blocked:
                delete_platform_profile(
                    db=db,
                    platform_profile_id=profile.id,
                    expected_revision=profile.revision,
                    actor=actor,
                    request_id="configuration-platform-blocked",
                )
            assert blocked.value.code == "PLATFORM_PROFILE_IN_USE"
            db.rollback()
            db.refresh(actor)

            closed = close_publication_work(
                db=db,
                work_id=work.id,
                payload=PublicationWorkCloseRequest(
                    reason="BUSINESS_CANCELLED",
                    comment="配置删除测试",
                    expected_revision=work.revision,
                ),
                actor=actor,
                request_id="configuration-work-close",
            )
            delete_platform_account(
                db=db,
                platform_account_id=account.id,
                expected_revision=account.revision,
                actor=actor,
                request_id="configuration-account-delete",
            )
            assert db.get(PlatformAccount, account.id) is None
            retained_work = db.get(PublicationWork, closed.id)
            assert retained_work is not None
            assert retained_work.platform_account_id is None
            assert retained_work.platform_account_label_snapshot == account.label

            profile_id = profile.id
            profile_name = profile.name
            delete_platform_profile(
                db=db,
                platform_profile_id=profile_id,
                expected_revision=profile.revision,
                actor=actor,
                request_id="configuration-platform-delete",
            )
            assert db.get(PlatformProfile, profile_id) is None
            db.expire_all()
            retained_task = db.get(ContentTask, task.id)
            retained_work = db.get(PublicationWork, work.id)
            assert retained_task is not None
            assert retained_task.platform_profile_id is None
            assert retained_task.platform_profile_name_snapshot == profile_name
            assert retained_work is not None
            assert retained_work.platform_profile_id is None
            assert retained_work.platform_profile_name_snapshot == profile_name


@pytest.mark.integration
def test_close_work_cancels_source_task_without_published_article() -> None:
    """显式关闭是未完成发布的唯一业务终止方式。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="b" * 64)
            user = graph["user"]
            content = graph["content"]
            account = graph["account"]
            assert isinstance(user, User)
            assert isinstance(content, ContentVersion)
            assert isinstance(account, PlatformAccount)
            work = create_publication_work(
                db=db,
                payload=PublicationWorkCreate(
                    content_version_id=content.id,
                    platform_account_id=account.id,
                ),
                actor=user,
                request_id="publication-close-create",
                idempotency_key="publication-close-key",
            )
            closed = close_publication_work(
                db=db,
                work_id=work.id,
                payload=PublicationWorkCloseRequest(
                    reason="PLATFORM_REJECTED",
                    comment="平台明确拒绝该内容",
                    expected_revision=work.revision,
                ),
                actor=user,
                request_id="publication-close",
            )
            assert closed.status == "CLOSED"
            assert closed.close_reason == "PLATFORM_REJECTED"
            assert db.get(ContentTask, content.task_id).status == "CANCELLED"
            assert db.get(PublishedArticle, work.id) is None


@pytest.mark.integration
def test_fact_workspace_submission_creates_one_pending_snapshot_and_new_revision_after_return() -> (
    None
):
    """事实提交一步冻结待审核版本，退回后只能从工作区创建新版本。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            actor = User(
                username=f"fact-{uuid.uuid4().hex[:10]}",
                display_name="事实流程测试用户",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            product = Product(
                part_number="PS-FACT",
                normalized_part_number=uuid.uuid4().hex,
                brand="PartSignal",
                normalized_brand=f"partsignal-{uuid.uuid4().hex[:8]}",
                category="MCU",
                facts_body_markdown="## 初始事实",
                facts_classification="PUBLIC",
            )
            db.add_all([actor, product])
            db.commit()

            first = submit_fact_review(
                db=db,
                product_id=product.id,
                payload=FactReviewSubmissionRequest(
                    expected_revision=product.facts_revision,
                    change_summary="提交初始事实",
                ),
                actor=actor,
                request_id="fact-submit-first",
            )
            assert first.status == "PENDING_REVIEW"
            assert first.body_markdown == "## 初始事实"
            with pytest.raises(AppError) as duplicate:
                submit_fact_review(
                    db=db,
                    product_id=product.id,
                    payload=FactReviewSubmissionRequest(
                        expected_revision=product.facts_revision,
                        change_summary="重复提交",
                    ),
                    actor=actor,
                    request_id="fact-submit-duplicate",
                )
            assert duplicate.value.code == "FACT_REVIEW_PENDING"
            db.rollback()

            returned = transition_fact_version(
                db=db,
                fact_version_id=first.id,
                expected_revision=first.revision,
                comment="补充参数来源",
                actor=actor,
                request_id="fact-request-changes",
                action="request-changes",
            )
            assert returned.status == "CHANGES_REQUESTED"
            draft = replace_product_facts(
                db=db,
                product_id=product.id,
                payload=ProductFactsDraftUpdate(
                    body_markdown="## 修订事实\n\n补充参数来源。",
                    classification="PUBLIC",
                    expected_revision=product.facts_revision,
                ),
                actor=actor,
                request_id="fact-workspace-revise",
            )
            second = submit_fact_review(
                db=db,
                product_id=product.id,
                payload=FactReviewSubmissionRequest(
                    expected_revision=draft.revision,
                    change_summary="根据意见创建修订",
                ),
                actor=actor,
                request_id="fact-submit-second",
            )
            assert second.version == 2
            assert second.status == "PENDING_REVIEW"
            assert first.status == "CHANGES_REQUESTED"
            assert (
                db.scalar(
                    select(func.count(FactReviewRecord.id)).where(
                        FactReviewRecord.fact_version_id.in_([first.id, second.id])
                    )
                )
                == 3
            )


@pytest.mark.integration
def test_product_create_maps_normalized_duplicate_to_stable_field_error() -> None:
    """数据库唯一约束竞态必须在服务边界映射为可定位的产品重复错误。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            actor = User(
                username=f"product-create-{uuid.uuid4().hex[:10]}",
                display_name="产品创建测试用户",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            db.add(actor)
            db.commit()

            created = create_product(
                db=db,
                payload=ProductCreate(
                    part_number="PS-001",
                    brand="Part Signal",
                    category="MCU",
                ),
                actor=actor,
                request_id="product-create-first",
            )

            with pytest.raises(AppError) as raised:
                create_product(
                    db=db,
                    payload=ProductCreate(
                        part_number=" ps 001 ",
                        brand="part-signal",
                        category="处理器",
                    ),
                    actor=actor,
                    request_id="product-create-duplicate",
                )

            error = raised.value
            assert error.code == "PRODUCT_ALREADY_EXISTS"
            assert error.status_code == 409
            assert [item["loc"] for item in error.details["errors"]] == [
                ["body", "part_number"],
                ["body", "brand"],
            ]
            assert db.scalar(select(func.count(Product.id))) == 1
            assert db.get(Product, created.id) is not None


@pytest.mark.integration
def test_product_list_projects_filters_sorts_and_paginates_current_fact() -> None:
    """产品列表由一个 read model 返回事实摘要，并在分页前完成派生筛选。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            actor = User(
                username=f"product-list-{uuid.uuid4().hex[:10]}",
                display_name="产品列表测试用户",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            empty = Product(
                part_number="PS-EMPTY",
                normalized_part_number=f"empty-{uuid.uuid4().hex}",
                brand="PartSignal",
                normalized_brand=f"partsignal-{uuid.uuid4().hex}",
                category="MCU",
                facts_body_markdown="",
                updated_at=datetime(2026, 8, 1, tzinfo=UTC),
            )
            approved = Product(
                part_number="PS-APPROVED",
                normalized_part_number=f"approved-{uuid.uuid4().hex}",
                brand="PartSignal",
                normalized_brand=f"partsignal-{uuid.uuid4().hex}",
                category="MCU",
                facts_body_markdown="## 已批准事实",
                facts_classification="PUBLIC",
                updated_at=datetime(2026, 8, 2, tzinfo=UTC),
            )
            pending = Product(
                part_number="PS-PENDING",
                normalized_part_number=f"pending-{uuid.uuid4().hex}",
                brand="PartSignal",
                normalized_brand=f"partsignal-{uuid.uuid4().hex}",
                category="MCU",
                facts_body_markdown="## 待审核事实",
                facts_classification="PUBLIC",
                updated_at=datetime(2026, 8, 3, tzinfo=UTC),
            )
            literal = Product(
                part_number="PS%LITERAL",
                normalized_part_number=f"literal-{uuid.uuid4().hex}",
                brand="PartSignal",
                normalized_brand=f"partsignal-{uuid.uuid4().hex}",
                category="MCU",
                facts_body_markdown="",
                updated_at=datetime(2026, 8, 4, tzinfo=UTC),
            )
            db.add_all([actor, empty, approved, pending, literal])
            db.flush()
            approved_fact = FactVersion(
                product_id=approved.id,
                version=1,
                status="APPROVED",
                body_markdown=approved.facts_body_markdown,
                classification="PUBLIC",
                change_summary="批准",
                revision=1,
                created_by=actor.id,
                approved_by=actor.id,
                created_at=datetime(2026, 8, 5, tzinfo=UTC),
                approved_at=datetime(2026, 8, 6, tzinfo=UTC),
            )
            pending_fact = FactVersion(
                product_id=pending.id,
                version=2,
                status="PENDING_REVIEW",
                body_markdown=pending.facts_body_markdown,
                classification="PUBLIC",
                change_summary="提交审核",
                revision=0,
                created_by=actor.id,
                created_at=datetime(2026, 8, 7, tzinfo=UTC),
            )
            db.add_all([approved_fact, pending_fact])
            db.flush()
            db.add_all(
                [
                    FactReviewRecord(
                        fact_version_id=approved_fact.id,
                        action="approve",
                        comment="批准",
                        actor_id=actor.id,
                        created_at=datetime(2026, 8, 6, tzinfo=UTC),
                    ),
                    FactReviewRecord(
                        fact_version_id=pending_fact.id,
                        action="submit-review",
                        comment="提交审核",
                        actor_id=actor.id,
                        created_at=datetime(2026, 8, 8, tzinfo=UTC),
                    ),
                ]
            )
            db.commit()

            filtered = list_products(
                db=db,
                can_delete=False,
                page=1,
                page_size=1,
                search=None,
                sort=ProductSort.MODEL_ASC,
                fact_status=ProductFactStatus.PENDING_REVIEW,
                workflow_stage=ProductWorkflowStage.FACT_REVIEW_PENDING,
            )
            assert filtered.total == 1
            assert filtered.items[0].id == pending.id
            assert filtered.items[0].current_fact is not None
            assert filtered.items[0].current_fact.version == 2
            assert filtered.items[0].updated_at == datetime(2026, 8, 8, tzinfo=UTC)

            ordered = list_products(
                db=db,
                can_delete=False,
                page=1,
                page_size=2,
                search=None,
                sort=ProductSort.UPDATED_DESC,
                fact_status=None,
                workflow_stage=None,
            )
            assert ordered.total == 4
            assert [item.id for item in ordered.items] == [pending.id, approved.id]

            updated_asc = list_products(
                db=db,
                can_delete=False,
                page=1,
                page_size=20,
                search=None,
                sort=ProductSort.UPDATED_ASC,
                fact_status=None,
                workflow_stage=None,
            )
            updated_desc = list_products(
                db=db,
                can_delete=False,
                page=1,
                page_size=20,
                search=None,
                sort=ProductSort.UPDATED_DESC,
                fact_status=None,
                workflow_stage=None,
            )
            assert [item.id for item in updated_desc.items] == list(
                reversed([item.id for item in updated_asc.items])
            )

            model_asc = list_products(
                db=db,
                can_delete=False,
                page=1,
                page_size=20,
                search=None,
                sort=ProductSort.MODEL_ASC,
                fact_status=None,
                workflow_stage=None,
            )
            model_desc = list_products(
                db=db,
                can_delete=False,
                page=1,
                page_size=20,
                search=None,
                sort=ProductSort.MODEL_DESC,
                fact_status=None,
                workflow_stage=None,
            )
            assert [item.id for item in model_desc.items] == list(
                reversed([item.id for item in model_asc.items])
            )

            literal_search = list_products(
                db=db,
                can_delete=False,
                page=1,
                page_size=20,
                search="%",
                sort=ProductSort.MODEL_ASC,
                fact_status=None,
                workflow_stage=None,
            )
            assert [item.id for item in literal_search.items] == [literal.id]


@pytest.mark.integration
def test_product_delete_checks_revision_then_revalidates_references() -> None:
    """产品删除先拒绝过期 revision，再拒绝读投影后新增的业务引用。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            admin = User(
                username=f"product-delete-{uuid.uuid4().hex[:10]}",
                display_name="产品删除测试管理员",
                password_hash="not-used",
                account_type="ADMIN",
            )
            stale = Product(
                part_number="PS-STALE",
                normalized_part_number=f"stale-{uuid.uuid4().hex}",
                brand="PartSignal",
                normalized_brand=f"partsignal-{uuid.uuid4().hex}",
                category="MCU",
                revision=1,
            )
            referenced = Product(
                part_number="PS-REFERENCED",
                normalized_part_number=f"referenced-{uuid.uuid4().hex}",
                brand="PartSignal",
                normalized_brand=f"partsignal-{uuid.uuid4().hex}",
                category="MCU",
                facts_body_markdown="## 待审核事实",
                facts_classification="PUBLIC",
            )
            clean = Product(
                part_number="PS-CLEAN",
                normalized_part_number=f"clean-{uuid.uuid4().hex}",
                brand="PartSignal",
                normalized_brand=f"partsignal-{uuid.uuid4().hex}",
                category="MCU",
            )
            db.add_all([admin, stale, referenced, clean])
            db.flush()
            db.add(
                FactVersion(
                    product_id=referenced.id,
                    version=1,
                    status="PENDING_REVIEW",
                    body_markdown=referenced.facts_body_markdown,
                    classification="PUBLIC",
                    change_summary="读后新增引用",
                    revision=0,
                    created_by=admin.id,
                )
            )
            db.commit()

            with pytest.raises(AppError) as stale_error:
                delete_product(
                    db=db,
                    product_id=stale.id,
                    expected_revision=0,
                    actor=admin,
                    request_id="product-delete-stale",
                )
            assert stale_error.value.code == "REVISION_CONFLICT"
            db.rollback()
            assert db.get(Product, stale.id) is not None

            with pytest.raises(AppError) as referenced_error:
                delete_product(
                    db=db,
                    product_id=referenced.id,
                    expected_revision=referenced.revision,
                    actor=admin,
                    request_id="product-delete-referenced",
                )
            assert referenced_error.value.code == "PRODUCT_IN_USE"
            assert referenced_error.value.details == {
                "references": [{"type": "FACT_VERSION", "count": 1}]
            }
            db.rollback()
            assert db.get(Product, referenced.id) is not None

            clean_id = clean.id
            delete_product(
                db=db,
                product_id=clean_id,
                expected_revision=clean.revision,
                actor=admin,
                request_id="product-delete-clean",
            )
            assert db.get(Product, clean_id) is None


@pytest.mark.integration
def test_repair_task_competing_issue_commands_wait_for_issue_lock_and_precheck_winner() -> None:
    """同一问题的合规并发命令由 Issue 行锁串行，后者只能看到已提交 winner。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="8" * 64)
            actor = graph["user"]
            fact = graph["fact"]
            assert isinstance(actor, User)
            assert isinstance(fact, FactVersion)
            issue = _open_repair_issue(db, graph, suffix="repair-lock")
            issue_id = issue.id
            issue_revision = issue.revision
            actor_id = actor.id
            fact_id = fact.id

        first_lock_acquired, release_first = threading.Event(), threading.Event()
        second_pid_ready = threading.Event()
        first_connection: list[object] = []
        second_pid: list[int] = []

        def hold_first_issue_lock(
            connection: object,
            _cursor: object,
            statement: object,
            _parameters: object,
            _context: object,
            _executemany: bool,
        ) -> None:
            """在首个 SELECT FOR UPDATE 返回后暂停，确保第二连接真实等待。"""
            if (
                first_connection
                and connection is first_connection[0]
                and "for update" in str(statement).lower()
                and "published_content_issues" in str(statement).lower()
            ):
                first_lock_acquired.set()
                if not release_first.wait(10):
                    raise TimeoutError("等待并发测试释放首个 Issue 锁超时")

        def request(*, first: bool) -> object:
            with Session(engine, expire_on_commit=False) as db:
                if first:
                    db.scalar(text("SELECT pg_backend_pid()"))
                    first_connection.append(db.connection())
                else:
                    second_pid.append(int(db.scalar(text("SELECT pg_backend_pid()"))))
                    second_pid_ready.set()
                actor = db.get(User, actor_id)
                assert actor is not None
                try:
                    return create_repair_task(
                        db=db,
                        issue_id=issue_id,
                        payload=PublishedContentRepairTaskCreate(
                            fact_version_id=fact_id,
                            expected_issue_revision=issue_revision,
                        ),
                        actor=actor,
                        request_id=f"repair-lock-{'first' if first else 'second'}",
                    )
                except AppError as error:
                    return error

        event.listen(engine, "after_cursor_execute", hold_first_issue_lock)
        try:
            with ThreadPoolExecutor(max_workers=2) as executor:
                first_future = executor.submit(request, first=True)
                second_future = None
                try:
                    assert first_lock_acquired.wait(10)
                    second_future = executor.submit(request, first=False)
                    assert second_pid_ready.wait(10)
                    _wait_for_pg_lock(engine, second_pid[0])
                finally:
                    release_first.set()
                first_result = first_future.result(timeout=10)
                assert second_future is not None
                second_result = second_future.result(timeout=10)
        finally:
            event.remove(engine, "after_cursor_execute", hold_first_issue_lock)
            engine.dispose()

        assert isinstance(first_result, ContentTask)
        assert isinstance(second_result, AppError)
        assert second_result.code == "REPAIR_TASK_EXISTS"
        with Session(create_engine(database_url), expire_on_commit=False) as db:
            assert (
                db.scalar(
                    select(func.count(ContentTask.id)).where(
                        ContentTask.source_published_content_issue_id == issue_id
                    )
                )
                == 1
            )


@pytest.mark.integration
def test_repair_task_unique_diagnostics_map_and_rollback_preserves_session_reuse(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """测试专用旁路让 service flush 命中真实 unique，并验证精确映射与复用。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="9" * 64)
            actor = graph["user"]
            fact = graph["fact"]
            assert isinstance(actor, User)
            assert isinstance(fact, FactVersion)
            issue = _open_repair_issue(db, graph, suffix="repair-bypass")
            issue_id = issue.id
            issue_revision = issue.revision
            actor_id, fact_id = actor.id, fact.id
            winner_id = create_repair_task(
                db=db,
                issue_id=issue_id,
                payload=PublishedContentRepairTaskCreate(
                    fact_version_id=fact.id,
                    expected_issue_revision=issue_revision,
                ),
                actor=actor,
                request_id="repair-bypass-winner",
            ).id

        with Session(engine, expire_on_commit=False) as db:
            actor = db.get(User, actor_id)
            assert actor is not None
            diagnostics: dict[str, object] = {}
            real_classifier = publication_service._is_repair_task_source_integrity_error

            def capture_diagnostics(error: IntegrityError) -> bool:
                diagnostics.update(
                    sqlstate=error.orig.sqlstate,
                    constraint_name=error.orig.diag.constraint_name,
                )
                return real_classifier(error)

            _bypass_next_repair_precheck(monkeypatch, db)
            monkeypatch.setattr(
                publication_service,
                "_is_repair_task_source_integrity_error",
                capture_diagnostics,
            )
            with pytest.raises(AppError) as raised:
                create_repair_task(
                    db=db,
                    issue_id=issue_id,
                    payload=PublishedContentRepairTaskCreate(
                        fact_version_id=fact_id,
                        expected_issue_revision=issue_revision,
                    ),
                    actor=actor,
                    request_id="repair-bypass-replay",
                )

            assert diagnostics == {
                "sqlstate": "23505",
                "constraint_name": "uq_content_tasks_source_published_content_issue_id",
            }
            assert raised.value.code == "REPAIR_TASK_EXISTS"
            assert raised.value.message == "该问题已经创建修复任务"
            assert raised.value.details == {}
            issue_after = db.get(PublishedContentIssue, issue_id)
            assert issue_after is not None and (issue_after.status, issue_after.revision) == (
                "OPEN",
                issue_revision,
            )
            assert db.scalar(
                select(ContentTask.id).where(ContentTask.id == winner_id)
            ) == winner_id
        engine.dispose()


@pytest.mark.parametrize(
    ("sqlstate", "constraint_name"),
    [
        ("23505", "uq_content_tasks_idempotency_key"),
        ("23503", "uq_content_tasks_source_published_content_issue_id"),
        ("55000", "uq_content_tasks_source_published_content_issue_id"),
        ("23505", None),
    ],
)
def test_repair_task_integrity_classifier_fails_closed(
    sqlstate: str,
    constraint_name: str | None,
) -> None:
    """合成负例只验证 fail-closed 分类，不替代真实 PostgreSQL 正例。"""
    original = SimpleNamespace(
        sqlstate=sqlstate,
        diag=SimpleNamespace(constraint_name=constraint_name) if constraint_name else None,
        constraint_name="uq_content_tasks_source_published_content_issue_id",
    )
    error = IntegrityError("INSERT", {}, original)
    assert not publication_service._is_repair_task_source_integrity_error(error)


@pytest.mark.integration
def test_repair_task_http_envelope_and_unknown_foreign_key_do_not_leak_database_details(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HTTP known 409 对账 request ID；未知 FK 仍为不泄漏的 default 500。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="a" * 64)
            actor = graph["user"]
            fact = graph["fact"]
            assert isinstance(actor, User)
            assert isinstance(fact, FactVersion)
            issue = _open_repair_issue(db, graph, suffix="repair-http")
            create_repair_task(
                db=db,
                issue_id=issue.id,
                payload=PublishedContentRepairTaskCreate(
                    fact_version_id=fact.id,
                    expected_issue_revision=issue.revision,
                ),
                actor=actor,
                request_id="repair-http-winner",
            )
            csrf_token = "repair-http-csrf-token-with-more-than-32-characters"
            current_session = SimpleNamespace(
                user=actor,
                csrf_hash=hash_token(csrf_token),
            )

            second_graph = _seed_graph(db, content_hash="b" * 64)
            second_actor = second_graph["user"]
            second_fact = second_graph["fact"]
            assert isinstance(second_actor, User)
            assert isinstance(second_fact, FactVersion)
            second_issue = _open_repair_issue(db, second_graph, suffix="repair-http-unknown")
            second_issue_id, second_revision, second_fact_id = (
                second_issue.id,
                second_issue.revision,
                second_fact.id,
            )
            invalid_session = SimpleNamespace(
                user=SimpleNamespace(id=uuid.uuid4(), account_type="ENGINEER"),
                csrf_hash=hash_token(csrf_token),
            )

        bypass_http_precheck = True
        known_diagnostics: dict[str, object] = {}
        unknown_diagnostics: dict[str, object] = {}
        real_classifier = publication_service._is_repair_task_source_integrity_error

        def capture_known_diagnostics(error: IntegrityError) -> bool:
            classified = real_classifier(error)
            if classified:
                known_diagnostics.update(
                    sqlstate=error.orig.sqlstate,
                    constraint_name=error.orig.diag.constraint_name,
                )
            return classified

        monkeypatch.setattr(
            publication_service,
            "_is_repair_task_source_integrity_error",
            capture_known_diagnostics,
        )

        def database_session() -> Iterator[Session]:
            with Session(engine, expire_on_commit=False) as request_db:
                if bypass_http_precheck:
                    _bypass_next_repair_precheck(monkeypatch, request_db)
                try:
                    yield request_db
                except Exception as error:
                    request_db.rollback()
                    if isinstance(error, IntegrityError):
                        issue_after = request_db.get(PublishedContentIssue, second_issue_id)
                        unknown_diagnostics.update(
                            type=type(error).__name__,
                            sqlstate=error.orig.sqlstate,
                            constraint_name=error.orig.diag.constraint_name,
                            reused_revision=(
                                issue_after.revision if issue_after is not None else None
                            ),
                        )
                    raise

        app.dependency_overrides[get_db] = database_session
        app.dependency_overrides[get_current_session] = lambda: current_session
        try:
            response = TestClient(app).post(
                f"/api/v1/published-content-issues/{issue.id}/repair-task",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "repair-http-known",
                },
                json={
                    "fact_version_id": str(fact.id),
                    "expected_issue_revision": issue.revision,
                },
            )
            bypass_http_precheck = False
            precheck_response = TestClient(app).post(
                f"/api/v1/published-content-issues/{issue.id}/repair-task",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "repair-http-precheck",
                },
                json={
                    "fact_version_id": str(fact.id),
                    "expected_issue_revision": issue.revision,
                },
            )
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 409, response.text
        assert known_diagnostics == {
            "sqlstate": "23505",
            "constraint_name": "uq_content_tasks_source_published_content_issue_id",
        }
        assert response.headers["X-Request-ID"] == "repair-http-known"
        exact_error = response.json()["error"]
        assert exact_error == {
            "code": "REPAIR_TASK_EXISTS",
            "message": "该问题已经创建修复任务",
            "details": {},
            "request_id": "repair-http-known",
        }
        assert precheck_response.status_code == 409
        precheck_error = precheck_response.json()["error"]
        assert {key: exact_error[key] for key in ("code", "message", "details")} == {
            key: precheck_error[key] for key in ("code", "message", "details")
        }
        assert precheck_error["request_id"] == "repair-http-precheck"

        app.dependency_overrides[get_db] = database_session
        app.dependency_overrides[get_current_session] = lambda: invalid_session
        try:
            leaked = TestClient(app, raise_server_exceptions=False).post(
                f"/api/v1/published-content-issues/{second_issue_id}/repair-task",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "repair-http-unknown",
                },
                json={
                    "fact_version_id": str(second_fact_id),
                    "expected_issue_revision": second_revision,
                },
            )
        finally:
            app.dependency_overrides.clear()

        assert leaked.status_code == 500
        assert leaked.text == "Internal Server Error"
        assert unknown_diagnostics == {
            "type": "IntegrityError",
            "sqlstate": "23503",
            "constraint_name": "fk_content_tasks_created_by_users",
            "reused_revision": second_revision,
        }
        for secret in (
            "INSERT INTO",
            "content_tasks",
            "fk_content_tasks_created_by",
            "ForeignKeyViolation",
            "Traceback",
        ):
            assert secret not in leaked.text
        with Session(engine, expire_on_commit=False) as db:
            assert db.scalar(
                select(ContentTask.id).where(
                    ContentTask.source_published_content_issue_id == second_issue_id
                )
            ) is None
        engine.dispose()
