"""新发布工作、首次核验成果和发布后内容问题的 PostgreSQL 集成测试。"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from psycopg import sql
from sqlalchemy import create_engine, delete, func, select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.errors import AppError
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
from app.schemas.content import ContentTaskPermanentDeleteRequest
from app.schemas.product_facts import FactReviewSubmissionRequest, ProductFactsDraftUpdate
from app.schemas.publication import (
    PublicationContentVersionSwitchRequest,
    PublicationResultUpdate,
    PublicationVerificationCreate,
    PublicationWorkCloseRequest,
    PublicationWorkCreate,
    PublishedArticlePermanentDeleteRequest,
    PublishedContentIssueCreate,
    PublishedContentIssueResolveRequest,
    PublishedContentRepairTaskCreate,
)
from app.services.content_planning import delete_query_topic, query_topics_out
from app.services.geo_observation import geo_publication_candidates
from app.services.platform_configuration import (
    delete_platform_profile,
    delete_platform_prompt,
    set_platform_profile_enabled,
)
from app.services.product_facts import replace_product_facts, submit_fact_review
from app.services.publication import (
    archive_content_task,
    close_publication_work,
    create_publication_work,
    create_repair_task,
    delete_content_task,
    delete_platform_account,
    open_published_content_issue,
    permanently_delete_content_task,
    permanently_delete_published_article,
    preview_content_task_permanent_deletion,
    preview_published_article_permanent_deletion,
    register_publication_result,
    resolve_published_content_issue,
    restore_content_task,
    switch_publication_content_version,
    verify_publication_work,
)
from app.services.publication_queries import (
    list_publication_ready_items,
    list_published_articles,
)
from app.services.review import transition_fact_version


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
    """失败核验不产生成果，复核成功才完成任务并允许发布后问题。"""
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

            content.status = "SUPERSEDED"
            content.revision += 1
            db.flush()
            revised_content = ContentVersion(
                task_id=content.task_id,
                fact_version_id=content.fact_version_id,
                based_on_id=content.id,
                version=2,
                source_type="HUMAN",
                title="测试器件选型（修订）",
                summary="冻结事实摘要",
                body_markdown="# 测试器件\n\n修订后的公开正文。",
                tags=["PS"],
                content_hash="c" * 64,
                status="APPROVED",
                quality_issues=[],
                change_summary="根据失败核验修订",
                created_by=user.id,
            )
            db.add(revised_content)
            db.flush()
            task = db.get(ContentTask, content.task_id)
            assert task is not None
            task.current_content_version_id = revised_content.id
            db.commit()

            switched = switch_publication_content_version(
                db=db,
                work_id=work.id,
                payload=PublicationContentVersionSwitchRequest(
                    content_version_id=revised_content.id,
                    expected_revision=failed.revision,
                    comment="切换到修订批准版本",
                ),
                actor=user,
                request_id="publication-version-switch",
            )
            assert switched.content_version_id == revised_content.id
            switch_event = db.scalar(
                select(PublicationWorkEvent).where(
                    PublicationWorkEvent.publication_work_id == work.id,
                    PublicationWorkEvent.action == "CONTENT_VERSION_CHANGED",
                )
            )
            assert switch_event is not None
            assert switch_event.from_content_version_id == content.id
            assert switch_event.to_content_version_id == revised_content.id
            completed = verify_publication_work(
                db=db,
                work_id=work.id,
                payload=PublicationVerificationCreate(
                    outcome="PASSED",
                    content_matches=True,
                    expected_revision=switched.revision,
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
                == 2
            )
            verification_versions = list(
                db.scalars(
                    select(PublicationVerification.content_version_id)
                    .where(PublicationVerification.publication_work_id == work.id)
                    .order_by(PublicationVerification.created_at)
                )
            )
            assert verification_versions == [content.id, revised_content.id]
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
def test_content_task_delete_and_archive_permanent_delete_lifecycle() -> None:
    """未发布任务直接聚合删除，成功任务归档后可立即永久删除。"""
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

            delete_content_task(
                db=db,
                task_id=ordinary_task.id,
                actor=actor,
                request_id="ordinary-task-delete",
            )
            assert db.get(ContentTask, ordinary_task.id) is None
            assert db.get(ContentVersion, ordinary_content.id) is None
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
            task = db.get(ContentTask, task.id)
            assert task is not None
            archived = archive_content_task(
                db=db,
                task_id=task.id,
                expected_revision=task.revision,
            )

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
            retained_task = db.get(ContentTask, archived.id)
            assert retained_task is not None
            assert retained_task.status == "OPEN"
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
