"""新发布工作、首次核验成果和发布后内容问题的 PostgreSQL 集成测试。"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from psycopg import sql
from sqlalchemy import create_engine, func, select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.models.configuration import PlatformProfile, PlatformType, QueryTopic
from app.models.content import ContentTask, ContentVersion
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.models.publication import (
    PlatformAccount,
    PublicationVerification,
    PublicationWork,
    PublishedArticle,
)
from app.schemas.publication import (
    PublicationResultUpdate,
    PublicationVerificationCreate,
    PublicationWorkCloseRequest,
    PublicationWorkCreate,
    PublishedContentIssueCreate,
    PublishedContentIssueResolveRequest,
    PublishedContentRepairTaskCreate,
)
from app.services.geo_observation import geo_publication_candidates
from app.services.publication import (
    close_publication_work,
    create_publication_work,
    create_repair_task,
    open_published_content_issue,
    register_publication_result,
    resolve_published_content_issue,
    verify_publication_work,
)
from app.services.publication_queries import list_publication_ready_items


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
    db.commit()
    return {
        "user": user,
        "product": product,
        "fact": fact,
        "profile": profile,
        "task": task,
        "content": content,
        "account": account,
    }


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
                    section_url="https://community.example.invalid/section",
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
                    section_url="https://community.example.invalid/section",
                ),
                actor=user,
                request_id="publication-create-repeat",
                idempotency_key="publication-create-key",
            )
            assert repeated.id == work.id
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
            completed = verify_publication_work(
                db=db,
                work_id=work.id,
                payload=PublicationVerificationCreate(
                    outcome="PASSED",
                    content_matches=True,
                    expected_revision=failed.revision,
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
            persisted_work = db.get(PublicationWork, work.id)
            assert persisted_work is not None
            db.delete(persisted_work)
            with pytest.raises(DBAPIError):
                db.commit()
            db.rollback()
            with pytest.raises(DBAPIError):
                db.execute(
                    update(PublicationWork)
                    .where(PublicationWork.id == work.id)
                    .values(status="ACTION_REQUIRED")
                )
            db.rollback()
            article = db.get(PublishedArticle, work.id)
            assert article is not None
            db.delete(article)
            with pytest.raises(DBAPIError):
                db.commit()
            db.rollback()


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
                    section_url="https://community.example.invalid/section",
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
