"""使用 PostgreSQL 和真实 FastAPI 路径验证阶段二发布与审核不变量。"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from pydantic import ValidationError
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.db import get_db
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.models.ai_generation import GenerationJob
from app.models.configuration import (
    ContentHumanizationPrompt,
    PlatformProfile,
    PlatformPrompt,
    PlatformType,
    QueryTopic,
)
from app.models.content import (
    ContentReviewRecord,
    ContentTask,
    ContentVersion,
)
from app.models.geo_files import (
    FileRecord,
    GeoObservation,
    GeoObservationAttachment,
    GeoObservationPublication,
)
from app.models.identity import AuditLog, User
from app.models.product_facts import (
    FactReviewRecord,
    FactVersion,
    Product,
)
from app.models.publication import (
    PlatformAccount,
    PublicationAttachment,
    PublicationAttention,
    PublicationRecord,
    PublicationStatusEvent,
)
from app.schemas.common import RevisionRequest
from app.schemas.configuration import (
    PlatformConfigurationStatus,
    PlatformProfileCreate,
    PlatformProfileStatus,
)
from app.schemas.content import ContentTaskCreate
from app.schemas.geo_files import GeoArticleResultCreate, GeoObservationCreate
from app.schemas.publication import (
    ManualPublicationCreate,
    PlatformAccountCreate,
    PlatformAccountUpdate,
    PublicationCommand,
    PublicationRepairTaskCreate,
    ResolvePublicationAttentionRequest,
)
from app.security import hash_token
from app.services.content_planning import (
    create_content_task,
    create_platform_profile,
)
from app.services.geo_observation import (
    GeoInsightFilters,
    GeoObservationFilters,
    create_geo_observation,
    geo_publication_candidates,
    get_geo_insights,
    get_geo_metrics,
    get_geo_observation,
    list_geo_observations,
)
from app.services.integrity import publication_integrity_issues
from app.services.platform_configuration import (
    delete_platform_profile,
    delete_platform_prompt,
    delete_platform_type,
    get_platform_profile_detail,
    list_platform_profiles,
    set_platform_profile_enabled,
)
from app.services.product_facts import delete_fact_version, delete_product
from app.services.projections import content_task_out, content_tasks_out
from app.services.publication import (
    cancel_content_task,
    command_publication,
    create_manual_publication,
    create_platform_account,
    create_repair_task,
    delete_content_task,
    delete_platform_account,
    resolve_attention,
    set_platform_account_enabled,
    update_platform_account,
)
from app.services.publication_queries import (
    get_repair_context,
    list_attentions,
    list_publication_candidates,
    list_publication_records,
    publication_workbench_summary,
)
from app.services.review import (
    get_content_review_context,
    get_fact_review_context,
    transition_content_version,
    transition_fact_version,
)


def _psycopg_url(value: str) -> str:
    return value.replace("postgresql+psycopg://", "postgresql://", 1)


def _replace_database(value: str, database_name: str) -> str:
    parts = urlsplit(_psycopg_url(value))
    return urlunsplit(
        (parts.scheme, parts.netloc, f"/{database_name}", parts.query, parts.fragment)
    )


@contextmanager
def temporary_database() -> Iterator[str]:
    """创建应用级隔离数据库并迁移到当前 head。"""
    source_url = os.getenv("PARTSIGNAL_TEST_DATABASE_URL")
    if source_url is None and os.getenv("APP_ENV") == "test":
        source_url = os.getenv("DATABASE_URL")
    if not source_url:
        pytest.skip("未设置 PostgreSQL 测试环境，不以 SQLite 替代 PostgreSQL")
    database_name = f"partsignal_stage2_{uuid.uuid4().hex[:10]}"
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


def fact_markdown(value: float = 3.3) -> str:
    """构造测试使用的不可变 Markdown 事实正文。"""
    return f"## 电气参数\n\n典型工作电压为 {value} V。\n\n仅限 3.3V 系统。"


def seed_graph(db: Session) -> dict[str, Any]:
    """创建发布、修复和审核测试共用的最小真实业务图。"""
    user = User(
        username=f"stage2-{uuid.uuid4().hex[:10]}",
        display_name="阶段二测试用户",
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
        body_markdown=fact_markdown(),
        classification="PUBLIC",
        change_summary="初始批准事实",
        created_by=user.id,
        approved_by=user.id,
    )
    topic = QueryTopic(
        canonical_question="如何选择 PS 测试器件？",
        intent_type="PRODUCT",
        variants=["PS 测试器件选型"],
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
    other_profile = PlatformProfile(
        name="其他社区",
        slug=f"other-{uuid.uuid4().hex[:8]}",
        allowed_domains=["other.example.invalid"],
        platform_type_id=platform_type.id,
    )
    db.add_all([profile, other_profile])
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
        title="PS 测试器件选型",
        summary="冻结事实摘要",
        body_markdown="# PS\n\n典型工作电压为 3.3V。",
        tags=["PS"],
        content_hash="a" * 64,
        status="APPROVED",
        quality_issues=[],
        change_summary="测试内容",
        created_by=user.id,
    )
    same_account = PlatformAccount(
        platform_profile_id=profile.id,
        label="同平台账号 A",
        account_identifier="same-a",
    )
    same_account_b = PlatformAccount(
        platform_profile_id=profile.id,
        label="同平台账号 B",
        account_identifier="same-b",
    )
    other_account = PlatformAccount(
        platform_profile_id=other_profile.id,
        label="跨平台账号",
        account_identifier="other",
    )
    db.add_all([content, same_account, same_account_b, other_account])
    db.commit()
    return {
        "user": user,
        "product": product,
        "fact": fact,
        "topic": topic,
        "platform_type": platform_type,
        "profile": profile,
        "other_profile": other_profile,
        "task": task,
        "content": content,
        "same_account": same_account,
        "same_account_b": same_account_b,
        "other_account": other_account,
    }


def publication_payload(content_id: uuid.UUID, account_id: uuid.UUID) -> ManualPublicationCreate:
    return ManualPublicationCreate(
        content_version_id=content_id,
        platform_account_id=account_id,
        section_url="https://community.example.invalid/section",
        attachment_file_ids=[],
    )


def replace_approved_content(
    db: Session,
    source_content_id: uuid.UUID,
    *,
    content_hash: str,
    title: str,
) -> ContentVersion:
    """退役当前批准版本并创建同任务的新批准版本。"""
    source = db.get(ContentVersion, source_content_id)
    assert source is not None
    source.status = "SUPERSEDED"
    content = ContentVersion(
        task_id=source.task_id,
        fact_version_id=source.fact_version_id,
        based_on_id=source.id,
        version=source.version + 1,
        source_type="HUMAN",
        title=title,
        summary=f"{title}摘要",
        body_markdown=f"# {title}\n\n这是另一篇测试文章。",
        tags=["PS"],
        content_hash=content_hash,
        status="APPROVED",
        quality_issues=[],
        change_summary="测试新批准内容",
        created_by=source.created_by,
    )
    db.add(content)
    db.commit()
    return content


def add_platform_content(
    db: Session,
    graph: dict[str, Any],
    *,
    platform_profile_id: uuid.UUID,
    content_hash: str,
    title: str,
) -> ContentVersion:
    """为指定具体平台创建一条独立任务及批准内容。"""
    task = ContentTask(
        query_topic_id=graph["topic"].id,
        product_id=graph["product"].id,
        fact_version_id=graph["fact"].id,
        platform_profile_id=platform_profile_id,
        created_by=graph["user"].id,
    )
    db.add(task)
    db.flush()
    content = ContentVersion(
        task_id=task.id,
        fact_version_id=graph["fact"].id,
        version=1,
        source_type="HUMAN",
        title=title,
        summary=f"{title}摘要",
        body_markdown=f"# {title}\n\n测试正文。",
        tags=["PS"],
        content_hash=content_hash,
        status="APPROVED",
        quality_issues=[],
        change_summary="测试平台内容",
        created_by=graph["user"].id,
    )
    db.add(content)
    db.commit()
    return content


@pytest.mark.integration
def test_content_humanization_prompt_api_lifecycle_and_audit() -> None:
    """全局自然化 Prompt 必须由管理员首次创建，并按修订号更新且不泄露正文。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            admin = User(
                username=f"humanization-admin-{uuid.uuid4().hex[:8]}",
                display_name="自然化配置管理员",
                password_hash="not-used",
                account_type="ADMIN",
            )
            engineer = User(
                username=f"humanization-engineer-{uuid.uuid4().hex[:8]}",
                display_name="自然化配置工程师",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            db.add_all([admin, engineer])
            db.commit()

        csrf_token = "humanization-csrf-token-with-more-than-32-characters"

        def override_db() -> Iterator[Session]:
            with session_factory() as db:
                yield db

        current_session = SimpleNamespace(
            user=engineer,
            csrf_hash=hash_token(csrf_token),
            last_seen_at=None,
        )
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: current_session
        client = TestClient(app)
        try:
            denied = client.get("/api/v1/content-humanization-prompt")
            assert denied.status_code == 403

            current_session.user = admin
            missing = client.get("/api/v1/content-humanization-prompt")
            assert missing.status_code == 204
            assert missing.content == b""

            blank = client.put(
                "/api/v1/content-humanization-prompt",
                headers={"X-CSRF-Token": csrf_token},
                json={"template_markdown": "   ", "expected_revision": None},
            )
            assert blank.status_code == 422
            assert blank.json()["error"]["code"] == "VALIDATION_ERROR"

            created = client.put(
                "/api/v1/content-humanization-prompt",
                headers={"X-CSRF-Token": csrf_token},
                json={"template_markdown": "  保留事实，只优化表达。  ", "expected_revision": None},
            )
            assert created.status_code == 200
            assert created.json()["template_markdown"] == "保留事实，只优化表达。"
            assert created.json()["revision"] == 0

            repeated_create = client.put(
                "/api/v1/content-humanization-prompt",
                headers={"X-CSRF-Token": csrf_token},
                json={"template_markdown": "重复首次创建", "expected_revision": None},
            )
            assert repeated_create.status_code == 409
            assert repeated_create.json()["error"]["code"] == "REVISION_CONFLICT"

            updated = client.put(
                "/api/v1/content-humanization-prompt",
                headers={"X-CSRF-Token": csrf_token},
                json={"template_markdown": "更新后的自然化规则", "expected_revision": 0},
            )
            assert updated.status_code == 200
            assert updated.json()["revision"] == 1

            stale = client.put(
                "/api/v1/content-humanization-prompt",
                headers={"X-CSRF-Token": csrf_token},
                json={"template_markdown": "过期写入", "expected_revision": 0},
            )
            assert stale.status_code == 409
            assert stale.json()["error"]["code"] == "REVISION_CONFLICT"

            loaded = client.get("/api/v1/content-humanization-prompt")
            assert loaded.status_code == 200
            assert loaded.json()["template_markdown"] == "更新后的自然化规则"
            assert loaded.json()["revision"] == 1
        finally:
            app.dependency_overrides.clear()

        with session_factory() as db:
            prompt = db.get(ContentHumanizationPrompt, 1)
            assert prompt is not None
            assert prompt.updated_by == admin.id
            audits = list(
                db.scalars(
                    select(AuditLog)
                    .where(AuditLog.action == "content_humanization_prompt.saved")
                    .order_by(AuditLog.created_at)
                )
            )
            assert [audit.details for audit in audits] == [
                {"facts": {"revision": 0}},
                {"facts": {"revision": 1}},
            ]
        engine.dispose()


@pytest.mark.integration
def test_publication_api_database_task_and_attention_closure() -> None:
    """API 与数据库共同保护平台，发布验证和失效保持原子闭环。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            graph = seed_graph(db)
            user_id = graph["user"].id
            content_id = graph["content"].id
            task_id = graph["task"].id
            same_account_id = graph["same_account"].id
            same_account_b_id = graph["same_account_b"].id
            other_account_id = graph["other_account"].id

        csrf_token = "stage2-csrf-token-with-more-than-32-characters"

        def override_db() -> Iterator[Session]:
            with session_factory() as db:
                yield db

        with session_factory() as db:
            api_user = db.get(User, user_id)
            assert api_user is not None
            current_session = SimpleNamespace(
                user=api_user,
                csrf_hash=hash_token(csrf_token),
                last_seen_at=None,
            )
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: current_session
        client = TestClient(app)
        try:
            csrf_rejected = client.post(
                "/api/v1/publication-records/manual",
                headers={
                    "X-CSRF-Token": "wrong-csrf-token-with-more-than-32-characters",
                    "X-Request-ID": "publication-csrf-rejected",
                    "Idempotency-Key": "stage2-csrf-rejected",
                },
                json=publication_payload(content_id, same_account_id).model_dump(mode="json"),
            )
            assert csrf_rejected.status_code == 403
            assert csrf_rejected.json()["error"]["code"] == "CSRF_INVALID"
            mismatch = client.post(
                "/api/v1/publication-records/manual",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "publication-mismatch",
                    "Idempotency-Key": "stage2-cross-platform",
                },
                json={
                    "content_version_id": str(content_id),
                    "platform_account_id": str(other_account_id),
                    "section_url": "https://other.example.invalid/section",
                    "attachment_file_ids": [],
                },
            )
            assert mismatch.status_code == 422
            assert mismatch.json()["error"]["code"] == "PUBLICATION_PLATFORM_MISMATCH"
            denied_delete = client.delete(
                f"/api/v1/platform-accounts/{same_account_id}",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "platform-account-delete-denied",
                },
            )
            assert denied_delete.status_code == 403
            assert denied_delete.json()["error"]["code"] == "PERMISSION_DENIED"

            first = client.post(
                "/api/v1/publication-records/manual",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "publication-created-a",
                    "Idempotency-Key": "stage2-same-platform-a",
                },
                json=publication_payload(content_id, same_account_id).model_dump(mode="json"),
            )
            assert first.status_code == 201
            with session_factory() as db:
                second_content = replace_approved_content(
                    db,
                    content_id,
                    content_hash="b" * 64,
                    title="PS 测试器件应用",
                )
                second_content_id = second_content.id
            second = client.post(
                "/api/v1/publication-records/manual",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "X-Request-ID": "publication-created-b",
                    "Idempotency-Key": "stage2-same-platform-b",
                },
                json=publication_payload(second_content_id, same_account_b_id).model_dump(
                    mode="json"
                ),
            )
            assert second.status_code == 201
            first_id = uuid.UUID(first.json()["id"])
            second_id = uuid.UUID(second.json()["id"])
        finally:
            app.dependency_overrides.clear()

        with session_factory() as db:
            assert (
                db.scalar(
                    select(func.count())
                    .select_from(AuditLog)
                    .where(AuditLog.request_id == "publication-csrf-rejected")
                )
                == 0
            )
            failed_audit = db.scalar(
                select(AuditLog).where(AuditLog.request_id == "publication-mismatch")
            )
            assert failed_audit is not None
            assert failed_audit.business_module == "PUBLICATION"
            assert failed_audit.action == "publication.created"
            assert failed_audit.target_id is None
            assert failed_audit.outcome == "FAILED"
            assert failed_audit.error_code == "PUBLICATION_PLATFORM_MISMATCH"
            assert failed_audit.details == {}
            denied_audit = db.scalar(
                select(AuditLog).where(AuditLog.request_id == "platform-account-delete-denied")
            )
            assert denied_audit is not None
            assert denied_audit.business_module == "PUBLICATION"
            assert denied_audit.action == "platform_account.deleted"
            assert denied_audit.target_id == str(same_account_id)
            assert denied_audit.outcome == "DENIED"
            assert denied_audit.error_code == "PERMISSION_DENIED"
            assert denied_audit.details == {}
            db.add(
                PublicationRecord(
                    idempotency_key="database-cross-platform",
                    content_version_id=content_id,
                    platform_account_id=other_account_id,
                    section_url="https://other.example.invalid/section",
                    status="PENDING_MANUAL_PUBLISH",
                    content_hash="a" * 64,
                    created_by=user_id,
                )
            )
            with pytest.raises(IntegrityError):
                db.flush()
            db.rollback()

        with session_factory() as db:
            actor = db.get(User, user_id)
            assert actor is not None
            with pytest.raises(AppError, match="进行中的发布"):
                cancel_content_task(
                    db=db,
                    task_id=task_id,
                    expected_revision=0,
                    comment="尝试取消",
                    actor=actor,
                    request_id="cancel-blocked",
                )
            db.rollback()
            for index, publication_id in enumerate((first_id, second_id), start=1):
                command_publication(
                    db=db,
                    publication_id=publication_id,
                    command="mark-platform-review",
                    payload=PublicationCommand(comment="平台审核"),
                    actor=actor,
                    request_id=f"review-{index}",
                )
                command_publication(
                    db=db,
                    publication_id=publication_id,
                    command="mark-published",
                    payload=PublicationCommand(
                        actual_title=f"已发布标题 {index}",
                        final_url=f"https://community.example.invalid/posts/{index}",
                        published_at="2026-07-11T00:00:00Z",
                        comment="发布完成",
                    ),
                    actor=actor,
                    request_id=f"published-{index}",
                )

        def verify_publication(publication_id: uuid.UUID) -> str:
            with session_factory() as db:
                actor = db.get(User, user_id)
                assert actor is not None
                result = command_publication(
                    db=db,
                    publication_id=publication_id,
                    command="verify",
                    payload=PublicationCommand(content_matches=True, comment="正文一致"),
                    actor=actor,
                    request_id=f"verified-{publication_id}",
                )
                return result.status.value

        with ThreadPoolExecutor(max_workers=2) as executor:
            verified_results = list(executor.map(verify_publication, (first_id, second_id)))
        assert sorted(verified_results) == ["VERIFIED", "VERIFIED"]

        with session_factory() as db:
            task = db.get(ContentTask, task_id)
            assert task is not None
            assert task.status == "COMPLETED"
            assert task.revision == 1
            actor = db.get(User, user_id)
            assert actor is not None
            with pytest.raises(AppError) as repeated_verify:
                command_publication(
                    db=db,
                    publication_id=first_id,
                    command="verify",
                    payload=PublicationCommand(content_matches=True, comment="重复验证"),
                    actor=actor,
                    request_id="verified-repeated",
                )
            assert repeated_verify.value.code == "INVALID_STATE_TRANSITION"
            db.rollback()

        def remove_verified() -> str:
            with session_factory() as db:
                actor = db.get(User, user_id)
                assert actor is not None
                try:
                    result = command_publication(
                        db=db,
                        publication_id=first_id,
                        command="remove",
                        payload=PublicationCommand(comment="页面下线"),
                        actor=actor,
                        request_id=f"remove-{uuid.uuid4()}",
                    )
                    return result.status.value
                except AppError as error:
                    db.rollback()
                    return error.code

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: remove_verified(), range(2)))
        assert sorted(results) == ["INVALID_STATE_TRANSITION", "REMOVED"]
        with session_factory() as db:
            task = db.get(ContentTask, task_id)
            assert task is not None and task.status == "COMPLETED"
            assert (
                db.scalar(
                    select(func.count())
                    .select_from(PublicationAttention)
                    .where(PublicationAttention.publication_record_id == first_id)
                )
                == 1
            )
            attention = db.scalar(
                select(PublicationAttention).where(
                    PublicationAttention.publication_record_id == first_id
                )
            )
            assert attention is not None and attention.status == "OPEN"
            created_audit = db.scalar(
                select(AuditLog).where(AuditLog.request_id == "publication-created-a")
            )
            assert created_audit is not None
            assert created_audit.business_module == "PUBLICATION"
            assert created_audit.outcome == "SUCCESS"
            assert created_audit.error_code is None
            assert created_audit.details["facts"]["status"] == "PENDING_MANUAL_PUBLISH"
            published_audit = db.scalar(
                select(AuditLog).where(AuditLog.request_id == "published-1")
            )
            assert published_audit is not None
            assert published_audit.details == {
                "changes": [
                    {
                        "field": "status",
                        "before": "PLATFORM_REVIEW",
                        "after": "PUBLISHED",
                    }
                ]
            }
            assert "已发布标题" not in str(published_audit.details)
            assert "community.example.invalid" not in str(published_audit.details)
            assert "发布完成" not in str(published_audit.details)
            assert db.get(PublicationRecord, second_id) is not None
            assert publication_integrity_issues(db) == []
        engine.dispose()


@pytest.mark.integration
def test_platform_account_normalization_revision_and_candidate_status() -> None:
    """账号标识按平台规范化唯一，启停受 revision 保护且不泄露内部标识。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            graph = seed_graph(db)
            actor = graph["user"]

            with pytest.raises(AppError) as duplicate_create:
                create_platform_account(
                    db=db,
                    payload=PlatformAccountCreate(
                        platform_profile_id=graph["profile"].id,
                        label="重复账号",
                        account_identifier="  SAME-A  ",
                    ),
                    actor=actor,
                    request_id="account-duplicate-create",
                )
            assert duplicate_create.value.code == "PLATFORM_ACCOUNT_IDENTIFIER_EXISTS"
            db.rollback()

            cross_platform = create_platform_account(
                db=db,
                payload=PlatformAccountCreate(
                    platform_profile_id=graph["other_profile"].id,
                    label="跨平台同标识",
                    account_identifier=" same-A ",
                ),
                actor=actor,
                request_id="account-cross-platform",
            )
            assert cross_platform.account_identifier == "same-A"

            with pytest.raises(AppError) as duplicate_update:
                update_platform_account(
                    db=db,
                    platform_account_id=graph["same_account_b"].id,
                    payload=PlatformAccountUpdate(
                        label="重复编辑",
                        account_identifier=" SAME-A ",
                        expected_revision=0,
                    ),
                    actor=actor,
                    request_id="account-duplicate-update",
                )
            assert duplicate_update.value.code == "PLATFORM_ACCOUNT_IDENTIFIER_EXISTS"
            db.rollback()

            private_identifier = "+86 13800000000 + 张三"
            updated = update_platform_account(
                db=db,
                platform_account_id=graph["same_account"].id,
                payload=PlatformAccountUpdate(
                    label="  手机号运营账号  ",
                    account_identifier=f"  {private_identifier}  ",
                    expected_revision=0,
                ),
                actor=actor,
                request_id="account-updated",
            )
            assert updated.label == "手机号运营账号"
            assert updated.account_identifier == private_identifier
            assert updated.revision == 1

            with pytest.raises(AppError) as stale:
                update_platform_account(
                    db=db,
                    platform_account_id=updated.id,
                    payload=PlatformAccountUpdate(
                        label="过期编辑",
                        account_identifier="stale",
                        expected_revision=0,
                    ),
                    actor=actor,
                    request_id="account-stale",
                )
            assert stale.value.code == "REVISION_CONFLICT"
            db.rollback()

            disabled = set_platform_account_enabled(
                db=db,
                platform_account_id=updated.id,
                payload=RevisionRequest(expected_revision=1),
                actor=actor,
                request_id="account-disabled",
                enabled=False,
            )
            assert disabled.is_active is False
            assert disabled.revision == 2
            candidates = list_publication_candidates(db)
            matching_ids = {
                account.id
                for candidate in candidates.items
                for account in candidate.matching_accounts
            }
            assert disabled.id not in matching_ids

            enabled = set_platform_account_enabled(
                db=db,
                platform_account_id=disabled.id,
                payload=RevisionRequest(expected_revision=2),
                actor=actor,
                request_id="account-enabled",
                enabled=True,
            )
            assert enabled.is_active is True
            assert enabled.revision == 3

            account_audits = list(
                db.scalars(
                    select(AuditLog).where(
                        AuditLog.request_id.in_(
                            ("account-updated", "account-disabled", "account-enabled")
                        )
                    )
                )
            )
            assert len(account_audits) == 3
            assert private_identifier not in str([audit.details for audit in account_audits])
        engine.dispose()


@pytest.mark.integration
@pytest.mark.parametrize(
    ("verify_first", "terminal_command"),
    [
        (False, "remove"),
        (False, "mark-verification-failed"),
        (True, "remove"),
    ],
)
def test_duplicate_platform_content_retry_and_public_history(
    verify_first: bool,
    terminal_command: str,
) -> None:
    """未公开拒绝可换账号；一旦公开，后续失效也永久阻止同平台重试。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            graph = seed_graph(db)
            actor = graph["user"]
            first = create_manual_publication(
                db=db,
                payload=publication_payload(
                    graph["content"].id,
                    graph["same_account"].id,
                ),
                actor=actor,
                request_id="dedup-first",
                idempotency_key=f"dedup-first-{uuid.uuid4()}",
            )
            with pytest.raises(AppError) as in_flight:
                create_manual_publication(
                    db=db,
                    payload=publication_payload(
                        graph["content"].id,
                        graph["same_account_b"].id,
                    ),
                    actor=actor,
                    request_id="dedup-in-flight",
                    idempotency_key=f"dedup-in-flight-{uuid.uuid4()}",
                )
            assert in_flight.value.code == "DUPLICATE_PLATFORM_CONTENT"
            db.rollback()

            command_publication(
                db=db,
                publication_id=first.id,
                command="reject",
                payload=PublicationCommand(comment="未公开拒绝"),
                actor=actor,
                request_id="dedup-rejected",
            )
            retry = create_manual_publication(
                db=db,
                payload=publication_payload(
                    graph["content"].id,
                    graph["same_account_b"].id,
                ),
                actor=actor,
                request_id="dedup-retry",
                idempotency_key=f"dedup-retry-{uuid.uuid4()}",
            )
            command_publication(
                db=db,
                publication_id=retry.id,
                command="mark-platform-review",
                payload=PublicationCommand(comment="进入平台审核"),
                actor=actor,
                request_id="dedup-review",
            )
            command_publication(
                db=db,
                publication_id=retry.id,
                command="mark-published",
                payload=PublicationCommand(
                    actual_title="公开文章",
                    final_url="https://community.example.invalid/dedup",
                    published_at=datetime.now(UTC),
                    comment="公开完成",
                ),
                actor=actor,
                request_id="dedup-published",
            )
            if verify_first:
                command_publication(
                    db=db,
                    publication_id=retry.id,
                    command="verify",
                    payload=PublicationCommand(
                        content_matches=True,
                        comment="公开页面验证通过",
                    ),
                    actor=actor,
                    request_id="dedup-verified",
                )
            command_publication(
                db=db,
                publication_id=retry.id,
                command=terminal_command,
                payload=PublicationCommand(comment="公开后失效"),
                actor=actor,
                request_id=f"dedup-{terminal_command}",
            )

            with pytest.raises(AppError) as public_history:
                create_manual_publication(
                    db=db,
                    payload=publication_payload(
                        graph["content"].id,
                        graph["same_account"].id,
                    ),
                    actor=actor,
                    request_id="dedup-after-public",
                    idempotency_key=f"dedup-after-public-{uuid.uuid4()}",
                )
            assert public_history.value.code == "DUPLICATE_PLATFORM_CONTENT"
            db.rollback()

            other_content = add_platform_content(
                db,
                graph,
                platform_profile_id=graph["other_profile"].id,
                content_hash=graph["content"].content_hash,
                title="另一个具体平台的同内容",
            )
            other_publication = create_manual_publication(
                db=db,
                payload=ManualPublicationCreate(
                    content_version_id=other_content.id,
                    platform_account_id=graph["other_account"].id,
                    section_url="https://other.example.invalid/section",
                    attachment_file_ids=[],
                ),
                actor=actor,
                request_id="dedup-other-platform",
                idempotency_key=f"dedup-other-platform-{uuid.uuid4()}",
            )
            assert other_publication.status.value == "PENDING_MANUAL_PUBLISH"
        engine.dispose()


@pytest.mark.integration
def test_concurrent_mark_published_rejects_legacy_duplicate_attempts() -> None:
    """并发登记已发布时，同平台旧重复在途记录不能绕过统一门禁。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            graph = seed_graph(db)
            actor_id = graph["user"].id
            content_id = graph["content"].id
            records = [
                PublicationRecord(
                    idempotency_key=f"legacy-duplicate-{index}-{uuid.uuid4()}",
                    content_version_id=content_id,
                    platform_account_id=account.id,
                    section_url="https://community.example.invalid/section",
                    status="PLATFORM_REVIEW",
                    content_hash=graph["content"].content_hash,
                    created_by=actor_id,
                )
                for index, account in enumerate(
                    (graph["same_account"], graph["same_account_b"]),
                    start=1,
                )
            ]
            db.add_all(records)
            db.flush()
            db.add_all(
                PublicationStatusEvent(
                    publication_id=record.id,
                    status="PLATFORM_REVIEW",
                    comment="迁移前遗留的重复在途记录",
                    actor_id=actor_id,
                )
                for record in records
            )
            db.commit()
            record_ids = [record.id for record in records]

        def publish(publication_id: uuid.UUID) -> str:
            with session_factory() as db:
                actor = db.get(User, actor_id)
                assert actor is not None
                try:
                    command_publication(
                        db=db,
                        publication_id=publication_id,
                        command="mark-published",
                        payload=PublicationCommand(
                            actual_title="遗留重复文章",
                            final_url=(
                                "https://community.example.invalid/legacy/"
                                f"{publication_id}"
                            ),
                            published_at=datetime.now(UTC),
                            comment="并发公开",
                        ),
                        actor=actor,
                        request_id=f"legacy-publish-{publication_id}",
                    )
                except AppError as error:
                    db.rollback()
                    return error.code
            return "PUBLISHED"

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(publish, record_ids))
        assert results == ["DUPLICATE_PLATFORM_CONTENT", "DUPLICATE_PLATFORM_CONTENT"]
        with session_factory() as db:
            assert set(
                db.scalars(
                    select(PublicationRecord.status).where(
                        PublicationRecord.id.in_(record_ids)
                    )
                )
            ) == {"PLATFORM_REVIEW"}
        engine.dispose()


@pytest.mark.integration
def test_publication_workbench_projection_and_atomic_result_evidence() -> None:
    """工作台聚合使用状态事件，结果证据与登记已发布在同一事务中落库。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            graph = seed_graph(db)
            actor = graph["user"]
            prepared_file = FileRecord(
                category="OPERATION_SCREENSHOT",
                original_filename="prepared.png",
                object_key=f"test/publication/{uuid.uuid4()}.png",
                content_type="image/png",
                size=64,
                sha256="a" * 64,
                access_level="INTERNAL",
                status="VERIFIED",
                uploader_id=actor.id,
                upload_expires_at=datetime.now(UTC),
                verified_at=datetime.now(UTC),
            )
            result_file = FileRecord(
                category="OPERATION_SCREENSHOT",
                original_filename="result.png",
                object_key=f"test/publication/{uuid.uuid4()}.png",
                content_type="image/png",
                size=64,
                sha256="b" * 64,
                access_level="INTERNAL",
                status="VERIFIED",
                uploader_id=actor.id,
                upload_expires_at=datetime.now(UTC),
                verified_at=datetime.now(UTC),
            )
            pending_file = FileRecord(
                category="OPERATION_SCREENSHOT",
                original_filename="pending.png",
                object_key=f"test/publication/{uuid.uuid4()}.png",
                content_type="image/png",
                size=64,
                sha256="c" * 64,
                access_level="INTERNAL",
                status="PENDING",
                uploader_id=actor.id,
                upload_expires_at=datetime.now(UTC),
            )
            wrong_category_file = FileRecord(
                category="EVIDENCE",
                original_filename="logo.png",
                object_key=f"test/publication/{uuid.uuid4()}.png",
                content_type="image/png",
                size=64,
                sha256="d" * 64,
                access_level="PUBLIC",
                status="VERIFIED",
                uploader_id=actor.id,
                upload_expires_at=datetime.now(UTC),
                verified_at=datetime.now(UTC),
            )
            db.add_all([prepared_file, result_file, pending_file, wrong_category_file])
            db.commit()

            candidate_statement_count = 0

            def count_candidate_statement(*_args: object) -> None:
                nonlocal candidate_statement_count
                candidate_statement_count += 1

            event.listen(engine, "before_cursor_execute", count_candidate_statement)
            try:
                candidates = list_publication_candidates(db)
            finally:
                event.remove(engine, "before_cursor_execute", count_candidate_statement)
            assert len(candidates.items) == 1
            assert len(candidates.items[0].matching_accounts) == 2
            assert candidate_statement_count == 2

            empty_summary = publication_workbench_summary(db, 7)
            assert empty_summary.period.registered_published_count == 0
            assert empty_summary.period.verified_count == 0
            assert empty_summary.period.verification_rate is None

            with pytest.raises(AppError) as invalid_prepared_evidence:
                create_manual_publication(
                    db=db,
                    payload=publication_payload(
                        graph["content"].id, graph["same_account"].id
                    ).model_copy(update={"attachment_file_ids": [wrong_category_file.id]}),
                    actor=actor,
                    request_id="workbench-create-invalid-evidence",
                    idempotency_key=f"workbench-invalid-evidence-{uuid.uuid4()}",
                )
            assert invalid_prepared_evidence.value.code == "VALIDATION_ERROR"
            db.rollback()
            assert db.scalar(select(func.count()).select_from(PublicationRecord)) == 0

            successful = create_manual_publication(
                db=db,
                payload=publication_payload(
                    graph["content"].id, graph["same_account"].id
                ).model_copy(update={"attachment_file_ids": [prepared_file.id]}),
                actor=actor,
                request_id="workbench-create-success",
                idempotency_key=f"workbench-success-{uuid.uuid4()}",
            )
            assert successful.content_title == graph["content"].title
            assert successful.content_version == graph["content"].version
            assert successful.platform_profile_id == graph["profile"].id
            assert successful.platform_profile_name == graph["profile"].name
            assert successful.platform_account_label == graph["same_account"].label
            assert successful.account_identifier == graph["same_account"].account_identifier
            failed_content = replace_approved_content(
                db,
                graph["content"].id,
                content_hash="b" * 64,
                title="PS 测试器件故障排查",
            )
            failed = create_manual_publication(
                db=db,
                payload=publication_payload(failed_content.id, graph["same_account_b"].id),
                actor=actor,
                request_id="workbench-create-failed",
                idempotency_key=f"workbench-failed-{uuid.uuid4()}",
            )
            for publication in (successful, failed):
                command_publication(
                    db=db,
                    publication_id=publication.id,
                    command="mark-platform-review",
                    payload=PublicationCommand(comment="平台处理中"),
                    actor=actor,
                    request_id=f"workbench-review-{publication.id}",
                )

            with pytest.raises(AppError) as incomplete_evidence:
                command_publication(
                    db=db,
                    publication_id=failed.id,
                    command="mark-published",
                    payload=PublicationCommand(
                        actual_title="失败发布",
                        final_url="https://community.example.invalid/posts/failed",
                        published_at=datetime.now(UTC),
                        comment="不应提交",
                        attachment_file_ids=[pending_file.id],
                    ),
                    actor=actor,
                    request_id="workbench-published-failed",
                )
            assert incomplete_evidence.value.code == "FILE_INTEGRITY_FAILED"
            db.rollback()
            failed_record = db.get(PublicationRecord, failed.id)
            assert failed_record is not None
            assert failed_record.status == "PLATFORM_REVIEW"
            assert failed_record.actual_title is None
            assert (
                db.scalar(
                    select(func.count())
                    .select_from(PublicationAttachment)
                    .where(PublicationAttachment.publication_id == failed.id)
                )
                == 0
            )

            with pytest.raises(AppError) as invalid_result_evidence:
                command_publication(
                    db=db,
                    publication_id=failed.id,
                    command="mark-published",
                    payload=PublicationCommand(
                        actual_title="错误类别证据",
                        final_url="https://community.example.invalid/posts/wrong-category",
                        published_at=datetime.now(UTC),
                        comment="不应提交",
                        attachment_file_ids=[wrong_category_file.id],
                    ),
                    actor=actor,
                    request_id="workbench-published-invalid-category",
                )
            assert invalid_result_evidence.value.code == "VALIDATION_ERROR"
            db.rollback()
            failed_record = db.get(PublicationRecord, failed.id)
            assert failed_record is not None
            assert failed_record.status == "PLATFORM_REVIEW"
            assert failed_record.actual_title is None
            assert (
                db.scalar(
                    select(func.count())
                    .select_from(PublicationAttachment)
                    .where(PublicationAttachment.publication_id == failed.id)
                )
                == 0
            )

            command_publication(
                db=db,
                publication_id=successful.id,
                command="mark-published",
                payload=PublicationCommand(
                    actual_title="真实发布标题",
                    final_url="https://community.example.invalid/posts/success",
                    published_at=datetime.now(UTC),
                    comment="人工发布完成",
                    attachment_file_ids=[result_file.id],
                ),
                actor=actor,
                request_id="workbench-published-success",
            )
            command_publication(
                db=db,
                publication_id=successful.id,
                command="verify",
                payload=PublicationCommand(content_matches=True, comment="页面正文一致"),
                actor=actor,
                request_id="workbench-verified",
            )
            command_publication(
                db=db,
                publication_id=successful.id,
                command="mark-verification-failed",
                payload=PublicationCommand(comment="页面内容后来发生变化"),
                actor=actor,
                request_id="workbench-verification-failed",
            )

            attachment_ids = set(
                db.scalars(
                    select(PublicationAttachment.file_id).where(
                        PublicationAttachment.publication_id == successful.id
                    )
                )
            )
            assert attachment_ids == {prepared_file.id, result_file.id}
            summary_7 = publication_workbench_summary(db, 7)
            summary_30 = publication_workbench_summary(db, 30)
            assert summary_7.current_status_counts.VERIFICATION_FAILED == 1
            assert summary_7.current_status_counts.PLATFORM_REVIEW == 1
            assert summary_7.period.registered_published_count == 1
            assert summary_7.period.verified_count == 1
            assert summary_7.period.verification_rate == 1
            assert summary_7.period.new_exception_count == 1
            assert summary_7.period.current_unresolved_attention_count == 1
            assert summary_7.exception_counts.verification_failed_open == 1
            assert summary_30.window_days == 30
            assert summary_7.recent_activity[0].publication_id == successful.id

            failed_records = list_publication_records(
                db, page=1, page_size=10, status_filter="VERIFICATION_FAILED"
            )
            assert failed_records.total == 1
            assert failed_records.items[0].content_title == graph["content"].title
            assert failed_records.items[0].available_actions == []
            review_records = list_publication_records(
                db, page=1, page_size=10, status_filter="PLATFORM_REVIEW"
            )
            assert review_records.total == 1
            assert review_records.items[0].id == failed.id
            attentions = list_attentions(db, "OPEN")
            assert len(attentions.items) == 1
            assert attentions.items[0].publication_record_id == successful.id
            assert attentions.items[0].content_title == graph["content"].title

            statement_count = 0

            def count_statement(*_args: object) -> None:
                nonlocal statement_count
                statement_count += 1

            event.listen(engine, "before_cursor_execute", count_statement)
            try:
                before = statement_count
                list_publication_records(db, page=1, page_size=10, status_filter=None)
                record_statements = statement_count - before

                before = statement_count
                list_attentions(db, "OPEN")
                attention_statements = statement_count - before

                before = statement_count
                publication_workbench_summary(db, 7)
                summary_statements = statement_count - before
            finally:
                event.remove(engine, "before_cursor_execute", count_statement)

            assert record_statements == 2
            assert attention_statements == 1
            assert summary_statements == 2
        engine.dispose()


@pytest.mark.integration
def test_controlled_deletion_reports_direct_references_and_allows_clean_targets() -> None:
    """删除服务汇总直接引用；清理后的对象可在同一公开流程中重试。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            graph = seed_graph(db)
            actor = graph["user"]
            db.add(
                GeoObservation(
                    observation_kind="LEGACY_MODEL_RESULT",
                    query_topic_id=graph["topic"].id,
                    product_id=graph["product"].id,
                    actual_prompt="测试问题",
                    model_name="测试模型",
                    model_version=None,
                    tested_at=datetime.now(UTC),
                    web_search_enabled=False,
                    answer_summary="测试回答",
                    mentioned=True,
                    recommendation="CANDIDATE",
                    accuracy="UNJUDGEABLE",
                    notes="测试观测",
                    tested_by=actor.id,
                )
            )
            db.commit()

            with pytest.raises(AppError) as product_conflict:
                delete_product(
                    db=db, product_id=graph["product"].id, actor=actor, request_id="delete-product"
                )
            assert product_conflict.value.code == "PRODUCT_IN_USE"
            assert {item["type"] for item in product_conflict.value.details["references"]} == {
                "FACT_VERSION",
                "CONTENT_TASK",
                "GEO_OBSERVATION",
            }
            db.rollback()

            with pytest.raises(AppError) as profile_conflict:
                delete_platform_profile(
                    db=db,
                    platform_profile_id=graph["profile"].id,
                    actor=actor,
                    request_id="delete-profile",
            )
            assert {item["type"] for item in profile_conflict.value.details["references"]} == {
                "CONTENT_TASK",
                "PLATFORM_ACCOUNT",
            }
            db.rollback()

            publication = create_manual_publication(
                db=db,
                payload=publication_payload(graph["content"].id, graph["same_account"].id),
                actor=actor,
                request_id="create-publication-before-delete",
                idempotency_key=f"delete-test-{uuid.uuid4()}",
            )
            with pytest.raises(AppError) as account_conflict:
                delete_platform_account(
                    db=db,
                    platform_account_id=graph["same_account"].id,
                    actor=actor,
                    request_id="delete-account",
                )
            assert account_conflict.value.details["references"] == [
                {"type": "PUBLICATION_RECORD", "count": 1}
            ]
            assert publication.id is not None
            db.rollback()

            clean_product = Product(
                part_number=f"CLEAN-{uuid.uuid4().hex[:8]}",
                normalized_part_number=uuid.uuid4().hex,
                brand="PartSignal",
                normalized_brand=f"clean-{uuid.uuid4().hex[:8]}",
                category="TEST",
            )
            clean_type = PlatformType(
                name="可清理类型",
                slug=f"clean-type-{uuid.uuid4().hex[:8]}",
                created_by=actor.id,
            )
            db.add_all([clean_product, clean_type])
            db.commit()
            clean_product_id, clean_type_id = clean_product.id, clean_type.id
            delete_product(
                db=db, product_id=clean_product_id, actor=actor, request_id="delete-clean-product"
            )
            prompt = PlatformPrompt(
                platform_profile_id=graph["profile"].id,
                template_markdown="仅使用已批准事实。",
                updated_by=actor.id,
            )
            db.add(prompt)
            db.commit()
            with pytest.raises(AppError) as stale_delete:
                delete_platform_prompt(
                    db=db,
                    platform_profile_id=graph["profile"].id,
                    expected_revision=prompt.revision + 1,
                    actor=actor,
                    request_id="delete-stale-prompt",
                )
            assert stale_delete.value.code == "REVISION_CONFLICT"
            db.rollback()
            assert db.get(PlatformPrompt, graph["profile"].id) is not None
            delete_platform_prompt(
                db=db,
                platform_profile_id=graph["profile"].id,
                expected_revision=prompt.revision,
                actor=actor,
                request_id="delete-clean-prompt",
            )
            delete_platform_account(
                db=db,
                platform_account_id=graph["other_account"].id,
                actor=actor,
                request_id="delete-clean-account",
            )
            clean_profile = PlatformProfile(
                name="无引用平台",
                slug=f"clean-profile-{uuid.uuid4().hex[:8]}",
                allowed_domains=["clean.example.invalid"],
                platform_type_id=clean_type_id,
            )
            db.add(clean_profile)
            db.flush()
            clean_prompt = PlatformPrompt(
                platform_profile_id=clean_profile.id,
                template_markdown="仅使用已批准事实。",
                updated_by=actor.id,
            )
            db.add(clean_prompt)
            db.commit()
            delete_platform_profile(
                db=db,
                platform_profile_id=clean_profile.id,
                actor=actor,
                request_id="delete-clean-profile",
            )
            delete_platform_type(
                db=db, platform_type_id=clean_type_id, actor=actor, request_id="delete-clean-type"
            )
            assert db.get(Product, clean_product_id) is None
            assert db.get(PlatformType, clean_type_id) is None
            actions = set(db.scalars(select(AuditLog.action)))
            assert {
                "product.deleted",
                "platform_prompt.deleted",
                "platform_account.deleted",
                "platform_profile.deleted",
                "platform_type.deleted",
            } <= actions
            deleted_prompt_audit = db.scalar(
                select(AuditLog).where(AuditLog.action == "platform_prompt.deleted")
            )
            assert deleted_prompt_audit is not None
            assert deleted_prompt_audit.details == {
                "changes": [{"field": "is_configured", "before": True, "after": False}],
                "facts": {"revision": prompt.revision},
            }
        engine.dispose()


@pytest.mark.integration
def test_manual_geo_observation_requires_complete_articles_and_screenshot() -> None:
    """人工观测必须覆盖产品全部公开文章，并保存逐篇结果和截图证据。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            graph = seed_graph(db)
            first_publication = create_manual_publication(
                db=db,
                payload=publication_payload(
                    graph["content"].id,
                    graph["same_account"].id,
                ),
                actor=graph["user"],
                request_id="geo-publication-1",
                idempotency_key=f"geo-publication-1-{uuid.uuid4()}",
            )
            second_content = replace_approved_content(
                db,
                graph["content"].id,
                content_hash="b" * 64,
                title="PS 测试器件进阶应用",
            )
            second_publication = create_manual_publication(
                db=db,
                payload=publication_payload(
                    second_content.id,
                    graph["same_account_b"].id,
                ),
                actor=graph["user"],
                request_id="geo-publication-2",
                idempotency_key=f"geo-publication-2-{uuid.uuid4()}",
            )
            publications = [first_publication, second_publication]
            for index, publication in enumerate(publications, start=1):
                command_publication(
                    db=db,
                    publication_id=publication.id,
                    command="mark-platform-review",
                    payload=PublicationCommand(comment="平台审核"),
                    actor=graph["user"],
                    request_id=f"geo-review-{index}",
                )
                command_publication(
                    db=db,
                    publication_id=publication.id,
                    command="mark-published",
                    payload=PublicationCommand(
                        actual_title=f"GEO 文章 {index}",
                        final_url=f"https://community.example.invalid/geo/{index}",
                        published_at="2026-07-18T00:00:00Z",
                        comment="人工发布完成",
                    ),
                    actor=graph["user"],
                    request_id=f"geo-published-{index}",
                )
            screenshot = FileRecord(
                category="OPERATION_SCREENSHOT",
                original_filename="geo-result.png",
                object_key=f"test/geo/{uuid.uuid4()}.png",
                content_type="image/png",
                size=128,
                sha256="d" * 64,
                access_level="INTERNAL",
                status="VERIFIED",
                uploader_id=graph["user"].id,
                upload_expires_at=datetime.now(UTC),
                verified_at=datetime.now(UTC),
            )
            evidence = FileRecord(
                category="EVIDENCE",
                original_filename="product-evidence.png",
                object_key=f"test/geo/{uuid.uuid4()}.png",
                content_type="image/png",
                size=128,
                sha256="e" * 64,
                access_level="INTERNAL",
                status="VERIFIED",
                uploader_id=graph["user"].id,
                upload_expires_at=datetime.now(UTC),
                verified_at=datetime.now(UTC),
            )
            db.add_all([screenshot, evidence])
            db.commit()

            candidates = geo_publication_candidates(db, graph["product"].id)
            assert {item.publication_record_id for item in candidates} == {
                item.id for item in publications
            }
            with pytest.raises(ValidationError):
                GeoArticleResultCreate(
                    publication_record_id=publications[0].id,
                    discovered=False,
                    mentioned=True,
                    recommendation_status="NOT_RECOMMENDED",
                    cited=False,
                    accuracy="UNJUDGEABLE",
                )
            incomplete = GeoObservationCreate(
                product_id=graph["product"].id,
                query_topic_id=graph["topic"].id,
                search_platform="DeepSeek",
                search_query=graph["product"].part_number,
                tested_at=datetime(2026, 7, 20, 10, tzinfo=UTC),
                article_results=[
                    GeoArticleResultCreate(
                        publication_record_id=publications[0].id,
                        discovered=True,
                        mentioned=True,
                        recommendation_status="RECOMMENDED",
                        cited=True,
                        accuracy="ACCURATE",
                    )
                ],
                attachment_file_ids=[screenshot.id],
                notes="人工搜索",
            )
            with pytest.raises(AppError) as changed:
                create_geo_observation(
                    db=db,
                    payload=incomplete,
                    actor=graph["user"],
                    request_id="geo-incomplete",
                )
            assert changed.value.code == "GEO_PUBLICATIONS_CHANGED"
            db.rollback()

            complete = incomplete.model_copy(
                update={
                    "article_results": [
                        GeoArticleResultCreate(
                            publication_record_id=publication.id,
                            discovered=index == 0,
                            mentioned=index == 0,
                            recommendation_status=(
                                "RECOMMENDED" if index == 0 else "NOT_RECOMMENDED"
                            ),
                            cited=index == 0,
                            accuracy="ACCURATE" if index == 0 else "UNJUDGEABLE",
                        )
                        for index, publication in enumerate(publications)
                    ]
                }
            )
            with pytest.raises(AppError) as invalid_attachment:
                create_geo_observation(
                    db=db,
                    payload=complete.model_copy(update={"attachment_file_ids": [evidence.id]}),
                    actor=graph["user"],
                    request_id="geo-invalid-attachment",
                )
            assert invalid_attachment.value.code == "VALIDATION_ERROR"
            db.rollback()

            observation = create_geo_observation(
                db=db,
                payload=complete,
                actor=graph["user"],
                request_id="geo-complete",
            )
            results = list(
                db.scalars(
                    select(GeoObservationPublication)
                    .where(GeoObservationPublication.observation_id == observation.id)
                    .order_by(GeoObservationPublication.publication_record_id)
                )
            )
            assert observation.observation_kind == "MANUAL_ARTICLE_SEARCH"
            assert {item.recommendation_status for item in results} == {
                "RECOMMENDED",
                "NOT_RECOMMENDED",
            }
            assert (
                db.scalar(
                    select(GeoObservationAttachment.file_id).where(
                        GeoObservationAttachment.observation_id == observation.id
                    )
                )
                == screenshot.id
            )
            metrics = get_geo_metrics(
                db=db,
                actor=graph["user"],
                filters=GeoObservationFilters(product_id=graph["product"].id),
            )
            assert metrics.manual_observation_count == 1
            assert metrics.article_result_count == 2
            assert metrics.article_recommendation_rate == 0.5
            audit = db.scalar(select(AuditLog).where(AuditLog.request_id == "geo-complete"))
            assert audit is not None
            assert audit.business_module == "GEO_OBSERVATION"
            assert audit.outcome == "SUCCESS"
            assert audit.details == {
                "facts": {
                    "product_id": str(graph["product"].id),
                    "supersedes_id": None,
                    "article_count": 2,
                    "attachment_count": 1,
                }
            }
            assert complete.search_query not in str(audit.details)
            assert complete.notes not in str(audit.details)

            correction = create_geo_observation(
                db=db,
                payload=complete.model_copy(
                    update={
                        "tested_at": complete.tested_at + timedelta(hours=1),
                        "notes": "纠正后的人工搜索",
                        "supersedes_id": observation.id,
                    }
                ),
                actor=graph["user"],
                request_id="geo-correction",
            )
            with pytest.raises(AppError) as changed_query:
                create_geo_observation(
                    db=db,
                    payload=complete.model_copy(
                        update={
                            "search_query": "不得改写的问题",
                            "supersedes_id": correction.id,
                        }
                    ),
                    actor=graph["user"],
                    request_id="geo-correction-changed-query",
                )
            assert changed_query.value.code == "VALIDATION_ERROR"
            db.rollback()

            other_user = User(
                username=f"geo-other-{uuid.uuid4().hex[:8]}",
                display_name="其他记录人",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            db.add(other_user)
            db.commit()
            tied_time = complete.tested_at + timedelta(hours=2)
            other_observation = create_geo_observation(
                db=db,
                payload=complete.model_copy(
                    update={"tested_at": tied_time, "notes": "其他用户的人工搜索"}
                ),
                actor=other_user,
                request_id="geo-other-user",
            )
            third_observation = create_geo_observation(
                db=db,
                payload=complete.model_copy(
                    update={
                        "tested_at": tied_time + timedelta(hours=1),
                        "notes": "第三次完整人工搜索",
                    }
                ),
                actor=other_user,
                request_id="geo-third-observation",
            )
            unobserved_topic = QueryTopic(
                canonical_question="尚未观测的问题？",
                intent_type="PRODUCT",
                variants=[],
            )
            db.add(unobserved_topic)
            legacy = GeoObservation(
                observation_kind="LEGACY_MODEL_RESULT",
                query_topic_id=graph["topic"].id,
                product_id=graph["product"].id,
                actual_prompt="如何选择 PS 测试器件？",
                model_name="历史模型",
                tested_at=tied_time,
                web_search_enabled=True,
                answer_summary="历史模型回答摘要",
                mentioned=True,
                recommendation="RECOMMENDED",
                accuracy="ACCURATE",
                notes="只读历史记录",
                tested_by=graph["user"].id,
            )
            db.add(legacy)
            db.commit()

            current = list_geo_observations(
                db,
                filters=GeoObservationFilters(product_id=graph["product"].id),
                actor=graph["user"],
                page=1,
                page_size=20,
                sort_order="DESC",
            )
            assert current.total == 4
            assert current.page == 1
            assert current.page_size == 20
            tied_ids = [item.id for item in current.items if item.tested_at == tied_time]
            assert tied_ids == sorted(tied_ids)
            assert {item.id for item in current.items} == {
                correction.id,
                other_observation.id,
                third_observation.id,
                legacy.id,
            }
            correction_out = next(item for item in current.items if item.id == correction.id)
            assert correction_out.product_label == (
                f"{graph['product'].brand} {graph['product'].part_number}"
            )
            assert correction_out.recorder.display_name == graph["user"].display_name
            assert correction_out.is_current is True
            assert correction_out.available_actions == ["CORRECT"]

            history = list_geo_observations(
                db,
                filters=GeoObservationFilters(product_id=graph["product"].id, include_history=True),
                actor=graph["user"],
                page=1,
                page_size=20,
                sort_order="ASC",
            )
            assert history.total == 5
            original_out = next(item for item in history.items if item.id == observation.id)
            assert original_out.is_current is False
            assert original_out.available_actions == []
            assert [item.tested_at for item in history.items] == sorted(
                item.tested_at for item in history.items
            )

            mine = list_geo_observations(
                db,
                filters=GeoObservationFilters(product_id=graph["product"].id, only_mine=True),
                actor=graph["user"],
                page=1,
                page_size=20,
                sort_order="DESC",
            )
            assert mine.total == 2
            assert {item.id for item in mine.items} == {correction.id, legacy.id}
            recorded_by_other = list_geo_observations(
                db,
                filters=GeoObservationFilters(recorder_search="其他记录人"),
                actor=graph["user"],
                page=1,
                page_size=20,
                sort_order="DESC",
            )
            assert {item.id for item in recorded_by_other.items} == {
                other_observation.id,
                third_observation.id,
            }
            legacy_only = list_geo_observations(
                db,
                filters=GeoObservationFilters(mentioned=True),
                actor=graph["user"],
                page=1,
                page_size=20,
                sort_order="DESC",
            )
            assert [item.id for item in legacy_only.items] == [legacy.id]
            recommended_articles = list_geo_observations(
                db,
                filters=GeoObservationFilters(article_recommendation="RECOMMENDED"),
                actor=graph["user"],
                page=1,
                page_size=20,
                sort_order="DESC",
            )
            assert recommended_articles.total == 3
            publication_match = list_geo_observations(
                db,
                filters=GeoObservationFilters(publication_search="GEO 文章 1"),
                actor=graph["user"],
                page=1,
                page_size=20,
                sort_order="DESC",
            )
            assert publication_match.total == 3

            second_page = list_geo_observations(
                db,
                filters=GeoObservationFilters(product_id=graph["product"].id),
                actor=graph["user"],
                page=2,
                page_size=1,
                sort_order="DESC",
            )
            assert second_page.total == 4
            assert len(second_page.items) == 1
            assert get_geo_observation(db, correction.id, actor=graph["user"]).id == correction.id
            with pytest.raises(AppError) as missing_observation:
                get_geo_observation(db, uuid.uuid4(), actor=graph["user"])
            assert missing_observation.value.status_code == 404

            current_metrics = get_geo_metrics(
                db=db,
                actor=graph["user"],
                filters=GeoObservationFilters(product_id=graph["product"].id),
            )
            assert current_metrics.legacy_sample_count == 1
            assert current_metrics.manual_observation_count == 3
            assert current_metrics.article_result_count == 6
            assert current_metrics.article_recommendation_rate == 0.5

            observed_date = complete.tested_at.date()
            insights = get_geo_insights(
                db,
                filters=GeoInsightFilters(
                    date_from=observed_date,
                    date_to=observed_date,
                ),
            )
            assert insights.analysis_unit == "MANUAL_OBSERVATION_PUBLICATION_RELATION"
            assert insights.data_quality.eligible_observation_count == 3
            assert insights.data_quality.excluded_incomplete_observation_count == 0
            assert insights.trends.mention_rate.current.model_dump() == {
                "numerator": 3,
                "denominator": 6,
                "value": 0.5,
            }
            assert insights.trends.recommendation_rate.current.value == 0.5
            assert insights.trends.citation_rate.current.value == 0.5
            assert insights.trends.accuracy_rate.current.value == 0.5
            assert insights.trends.not_recommended_content_count.current == 1
            assert [stage.count for stage in insights.funnel] == [6, 3, 3, 3, 3, 3]
            assert insights.platform_performance[0].observation_count == 3
            assert insights.content_rankings.best[0].publication_record_id == publications[0].id

            coverage = {item.query_topic_id: item for item in insights.question_coverage.matrix}
            assert coverage[graph["topic"].id].status == "STABLE"
            assert coverage[graph["topic"].id].observation_count == 3
            assert coverage[unobserved_topic.id].status == "INSUFFICIENT_DATA"
            insufficient = next(
                item
                for item in insights.recommendations
                if item.rule_code == "QUESTION_INSUFFICIENT_DATA"
                and item.query_topic_ids == [unobserved_topic.id]
            )
            assert insufficient.basis_values[0].model_dump() == {
                "metric": "observation_count",
                "value": 0.0,
                "threshold": 3.0,
                "unit": "COUNT",
            }
            assert any(
                item.rule_code == "CONTENT_NEVER_RECOMMENDED"
                and item.publication_record_ids == [publications[1].id]
                for item in insights.recommendations
            )
            assert {item.code for item in insights.data_quality.unavailable_sections} >= {
                "NO_COMPLETE_PREVIOUS_OBSERVATIONS",
                "LONG_UNMENTIONED_PERIOD_TOO_SHORT",
            }

            shared_filters = (
                ("content_platform_id", graph["profile"].id, 6),
                ("geo_platform", "DeepSeek", 6),
                ("publication_record_id", publications[1].id, 3),
                ("query_topic_id", graph["topic"].id, 6),
            )
            for field, value, expected_denominator in shared_filters:
                filtered = get_geo_insights(
                    db,
                    filters=GeoInsightFilters(
                        date_from=observed_date,
                        date_to=observed_date,
                        **{field: value},
                    ),
                )
                assert filtered.trends.mention_rate.current.denominator == expected_denominator
            with pytest.raises(AppError) as unknown_publication:
                get_geo_insights(
                    db,
                    filters=GeoInsightFilters(
                        date_from=observed_date,
                        date_to=observed_date,
                        publication_record_id=uuid.uuid4(),
                    ),
                )
            assert unknown_publication.value.status_code == 404

            command_publication(
                db=db,
                publication_id=publications[0].id,
                command="remove",
                payload=PublicationCommand(comment="验证历史洞察仍可筛选"),
                actor=graph["user"],
                request_id="geo-insight-removed-publication",
            )
            removed_publication_insights = get_geo_insights(
                db,
                filters=GeoInsightFilters(
                    date_from=observed_date,
                    date_to=observed_date,
                    publication_record_id=publications[0].id,
                ),
            )
            assert removed_publication_insights.trends.mention_rate.current.denominator == 3
            assert publications[0].id in {
                item.id for item in removed_publication_insights.filter_options.publications
            }
        engine.dispose()


@pytest.mark.integration
def test_content_task_list_uses_current_platform_and_latest_generate_only() -> None:
    """列表批量展示当前品牌，且只按确定顺序读取最新 GENERATE。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            graph = seed_graph(db)
            profile = graph["profile"]
            profile.website_url = "https://community.example.invalid/platform"
            profile.logo_external_url = "https://cdn.example.invalid/community.webp"
            db.commit()

            without_jobs = content_tasks_out(db, [graph["task"]])[0]
            assert without_jobs.latest_generation_status is None

            newer_humanize = GenerationJob(
                content_task_id=graph["task"].id,
                idempotency_key=f"humanize-newer-{uuid.uuid4()}",
                job_type="HUMANIZE",
                source_content_version_id=graph["content"].id,
                status="SUCCEEDED",
                input_snapshot={},
                adapter_name="test",
                prompt_template_version="v1",
                prompt_hash="c" * 64,
                created_by=graph["user"].id,
                created_at=datetime(2026, 7, 19, 10, tzinfo=UTC),
            )
            db.add(newer_humanize)
            db.commit()
            humanize_only = content_tasks_out(db, [graph["task"]])[0]
            assert humanize_only.latest_generation_status is None

            tied_at = datetime(2026, 7, 19, 9, tzinfo=UTC)
            old_generate = GenerationJob(
                id=uuid.UUID(int=1),
                content_task_id=graph["task"].id,
                idempotency_key=f"generate-old-{uuid.uuid4()}",
                job_type="GENERATE",
                status="FAILED",
                input_snapshot={},
                adapter_name="test",
                prompt_template_version="v1",
                prompt_hash="a" * 64,
                created_by=graph["user"].id,
                created_at=tied_at,
            )
            latest_generate = GenerationJob(
                id=uuid.UUID(int=2),
                content_task_id=graph["task"].id,
                idempotency_key=f"generate-latest-{uuid.uuid4()}",
                job_type="GENERATE",
                status="RUNNING",
                input_snapshot={},
                adapter_name="test",
                prompt_template_version="v1",
                prompt_hash="b" * 64,
                created_by=graph["user"].id,
                created_at=tied_at,
            )
            db.add_all([old_generate, latest_generate])
            db.commit()

            item = content_tasks_out(db, [graph["task"]])[0]
            assert item.latest_generation_status == "RUNNING"
            assert item.product.part_number == graph["product"].part_number
            assert item.platform.name == profile.name
            assert str(item.platform.website_url) == profile.website_url
            assert item.platform.logo is not None
            assert item.platform.logo.source == "EXTERNAL"

            statement_count = 0

            def count_statement(*_args: object) -> None:
                nonlocal statement_count
                statement_count += 1

            event.listen(engine, "before_cursor_execute", count_statement)
            try:
                content_tasks_out(db, [graph["task"]])
                single_count = statement_count
                statement_count = 0
                repeated = content_tasks_out(db, [graph["task"]] * 20)
                assert len(repeated) == 20
                assert statement_count == single_count
            finally:
                event.remove(engine, "before_cursor_execute", count_statement)
        engine.dispose()


@pytest.mark.integration
def test_cancelled_content_task_deletion_requires_no_production_history() -> None:
    """已取消任务只有在无生成作业和内容版本时才可删除。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            graph = seed_graph(db)
            actor = graph["user"]
            task_values = {
                "product_id": graph["product"].id,
                "fact_version_id": graph["fact"].id,
                "platform_profile_id": graph["profile"].id,
                "created_by": actor.id,
            }
            open_task = ContentTask(**task_values)
            completed_task = ContentTask(**task_values, status="COMPLETED")
            empty_task = ContentTask(**task_values, status="CANCELLED")
            route_task = ContentTask(**task_values, status="CANCELLED")
            generation_task = ContentTask(**task_values, status="CANCELLED")
            content_task = ContentTask(**task_values, status="CANCELLED")
            db.add_all(
                [
                    open_task,
                    completed_task,
                    empty_task,
                    route_task,
                    generation_task,
                    content_task,
                ]
            )
            db.flush()
            db.add(
                GenerationJob(
                    content_task_id=generation_task.id,
                    idempotency_key=f"delete-task-{uuid.uuid4()}",
                    job_type="GENERATE",
                    status="FAILED",
                    input_snapshot={},
                    adapter_name="test",
                    prompt_template_version="content-markdown-v2",
                    prompt_hash="d" * 64,
                    created_by=actor.id,
                )
            )
            db.add(
                ContentVersion(
                    task_id=content_task.id,
                    fact_version_id=graph["fact"].id,
                    version=1,
                    source_type="HUMAN",
                    title="删除门禁内容",
                    summary="删除门禁摘要",
                    body_markdown="删除门禁正文",
                    tags=[],
                    content_hash="e" * 64,
                    status="DRAFT",
                    quality_issues=[],
                    change_summary="验证任务删除引用",
                    created_by=actor.id,
                )
            )
            db.commit()
            actor_id = actor.id
            open_task_id = open_task.id
            completed_task_id = completed_task.id
            empty_task_id = empty_task.id
            route_task_id = route_task.id
            generation_task_id = generation_task.id
            content_task_id = content_task.id

            assert content_task_out(db, empty_task).available_actions == ["DELETE"]
            assert content_task_out(db, open_task).available_actions == ["CANCEL"]
            assert content_task_out(db, generation_task).available_actions == []
            assert content_task_out(db, content_task).available_actions == []
            list_actions = {
                item.id: item.available_actions
                for item in content_tasks_out(
                    db,
                    [empty_task, generation_task, content_task],
                )
            }
            assert list_actions == {
                empty_task_id: ["DELETE"],
                generation_task_id: [],
                content_task_id: [],
            }

            for blocked_task_id in (open_task_id, completed_task_id):
                with pytest.raises(AppError) as invalid_state:
                    delete_content_task(
                        db=db,
                        task_id=blocked_task_id,
                        actor=actor,
                        request_id=f"delete-state-{blocked_task_id}",
                    )
                assert invalid_state.value.code == "INVALID_STATE_TRANSITION"
                db.rollback()

            with pytest.raises(AppError) as generation_reference:
                delete_content_task(
                    db=db,
                    task_id=generation_task_id,
                    actor=actor,
                    request_id="delete-generation-task",
                )
            assert generation_reference.value.code == "CONTENT_TASK_IN_USE"
            assert generation_reference.value.details["references"] == [
                {"type": "GENERATION_JOB", "count": 1}
            ]
            db.rollback()

            with pytest.raises(AppError) as content_reference:
                delete_content_task(
                    db=db,
                    task_id=content_task_id,
                    actor=actor,
                    request_id="delete-content-task",
                )
            assert content_reference.value.code == "CONTENT_TASK_IN_USE"
            assert content_reference.value.details["references"] == [
                {"type": "CONTENT_VERSION", "count": 1}
            ]
            db.rollback()

            delete_content_task(
                db=db,
                task_id=empty_task_id,
                actor=actor,
                request_id="delete-empty-task",
            )
            assert db.get(ContentTask, empty_task_id) is None
            deletion_audit = db.scalar(
                select(AuditLog).where(AuditLog.request_id == "delete-empty-task")
            )
            assert deletion_audit is not None
            assert deletion_audit.action == "content_task.deleted"
            assert deletion_audit.target_id == str(empty_task_id)

        csrf_token = "content-task-delete-csrf-more-than-32-characters"

        def override_db() -> Iterator[Session]:
            with session_factory() as db:
                yield db

        with session_factory() as db:
            route_actor = db.get(User, actor_id)
            assert route_actor is not None
        current_session = SimpleNamespace(
            user=route_actor,
            csrf_hash=hash_token(csrf_token),
            last_seen_at=None,
        )
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: current_session
        client = TestClient(app)
        try:
            missing_csrf = client.delete(f"/api/v1/content-tasks/{route_task_id}")
            assert missing_csrf.status_code == 422
            invalid_csrf = client.delete(
                f"/api/v1/content-tasks/{route_task_id}",
                headers={"X-CSRF-Token": "wrong-token-more-than-32-characters"},
            )
            assert invalid_csrf.status_code == 403
            deleted = client.delete(
                f"/api/v1/content-tasks/{route_task_id}",
                headers={"X-CSRF-Token": csrf_token},
            )
            assert deleted.status_code == 204, deleted.text
        finally:
            app.dependency_overrides.clear()
            client.close()

        with session_factory() as db:
            assert db.get(ContentTask, route_task_id) is None
        engine.dispose()


@pytest.mark.integration
def test_fact_version_deletion_requires_no_content_reference() -> None:
    """事实版本仅在无内容引用时连同审核记录删除。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            graph = seed_graph(db)
            actor = graph["user"]
            actor.account_type = "ADMIN"
            db.commit()

            with pytest.raises(AppError) as referenced:
                delete_fact_version(
                    db=db,
                    fact_version_id=graph["fact"].id,
                    actor=actor,
                    request_id="delete-referenced-fact",
                )
            assert referenced.value.code == "FACT_VERSION_IN_USE"
            assert {item["type"] for item in referenced.value.details["references"]} == {
                "CONTENT_TASK",
                "CONTENT_VERSION",
            }
            db.rollback()

            disposable_statuses = [
                "DRAFT",
                "PENDING_REVIEW",
                "CHANGES_REQUESTED",
                "APPROVED",
                "RETIRED",
            ]
            disposable_ids: list[uuid.UUID] = []
            review_ids: list[uuid.UUID] = []
            for version_number, status in enumerate(disposable_statuses, start=2):
                disposable = FactVersion(
                    product_id=graph["product"].id,
                    version=version_number,
                    status=status,
                    body_markdown=fact_markdown(float(version_number)),
                    classification="PUBLIC",
                    change_summary=f"待物理删除的 {status} 事实",
                    created_by=actor.id,
                    approved_by=actor.id if status == "APPROVED" else None,
                )
                db.add(disposable)
                db.flush()
                review = FactReviewRecord(
                    fact_version_id=disposable.id,
                    action="TEST_RECORD",
                    comment=f"{status} 测试审核记录",
                    actor_id=actor.id,
                )
                db.add(review)
                db.flush()
                disposable_ids.append(disposable.id)
                review_ids.append(review.id)
            db.commit()

            for status, disposable_id in zip(disposable_statuses, disposable_ids, strict=True):
                delete_fact_version(
                    db=db,
                    fact_version_id=disposable_id,
                    actor=actor,
                    request_id=f"delete-{status.lower()}-fact",
                )
                audit = db.scalar(
                    select(AuditLog).where(
                        AuditLog.action == "fact_version.deleted",
                        AuditLog.target_id == str(disposable_id),
                    )
                )
                assert audit is not None
                assert audit.business_module == "PRODUCT_FACTS"
                assert audit.outcome == "SUCCESS"
                assert audit.details == {
                    "facts": {
                        "product_id": str(graph["product"].id),
                        "version": disposable_statuses.index(status) + 2,
                        "status": status,
                        "review_record_count": 1,
                    }
                }
            assert not db.scalars(
                select(FactVersion).where(FactVersion.id.in_(disposable_ids))
            ).all()
            assert not db.scalars(
                select(FactReviewRecord).where(FactReviewRecord.id.in_(review_ids))
            ).all()

            clean_product = Product(
                part_number=f"FACT-CLEAN-{uuid.uuid4().hex[:8]}",
                normalized_part_number=uuid.uuid4().hex,
                brand="PartSignal",
                normalized_brand=f"fact-clean-{uuid.uuid4().hex[:8]}",
                category="TEST",
            )
            db.add(clean_product)
            db.flush()
            clean_fact = FactVersion(
                product_id=clean_product.id,
                version=1,
                status="DRAFT",
                body_markdown=fact_markdown(9.9),
                classification="PUBLIC",
                change_summary="删除后允许清理产品",
                created_by=actor.id,
            )
            db.add(clean_fact)
            db.commit()
            clean_product_id = clean_product.id
            delete_fact_version(
                db=db,
                fact_version_id=clean_fact.id,
                actor=actor,
                request_id="delete-clean-product-fact",
            )
            delete_product(
                db=db,
                product_id=clean_product_id,
                actor=actor,
                request_id="delete-product-after-facts",
            )
            assert db.get(Product, clean_product_id) is None

            engineer = User(
                username=f"fact-engineer-{uuid.uuid4().hex[:8]}",
                display_name="事实删除权限测试工程师",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            api_product = Product(
                part_number=f"FACT-API-{uuid.uuid4().hex[:8]}",
                normalized_part_number=uuid.uuid4().hex,
                brand="PartSignal",
                normalized_brand=f"fact-api-{uuid.uuid4().hex[:8]}",
                category="TEST",
            )
            db.add_all([engineer, api_product])
            db.flush()
            api_fact = FactVersion(
                product_id=api_product.id,
                version=1,
                status="DRAFT",
                body_markdown=fact_markdown(12.0),
                classification="PUBLIC",
                change_summary="API 权限验证事实",
                created_by=actor.id,
            )
            db.add(api_fact)
            db.commit()
            admin_id, engineer_id = actor.id, engineer.id
            api_product_id, api_fact_id = api_product.id, api_fact.id

        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        csrf_token = "fact-delete-csrf-token-with-more-than-32-characters"

        def override_db() -> Iterator[Session]:
            with session_factory() as db:
                yield db

        with session_factory() as db:
            admin_user = db.get(User, admin_id)
            engineer_user = db.get(User, engineer_id)
            assert admin_user is not None
            assert engineer_user is not None
        current_session = SimpleNamespace(
            user=engineer_user,
            csrf_hash=hash_token(csrf_token),
            last_seen_at=None,
        )
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: current_session
        client = TestClient(app)
        try:
            denied = client.delete(
                f"/api/v1/fact-versions/{api_fact_id}",
                headers={"X-CSRF-Token": csrf_token},
            )
            assert denied.status_code == 403
            current_session.user = admin_user
            deleted = client.delete(
                f"/api/v1/fact-versions/{api_fact_id}",
                headers={"X-CSRF-Token": csrf_token},
            )
            assert deleted.status_code == 204
        finally:
            app.dependency_overrides.clear()

        with session_factory() as db:
            assert db.get(FactVersion, api_fact_id) is None
            assert db.get(Product, api_product_id) is not None
        engine.dispose()

@pytest.mark.integration
@pytest.mark.parametrize("with_query_topic", [True, False])
def test_repair_context_resolution_and_review_history_are_immutable(
    with_query_topic: bool,
) -> None:
    """修复任务固定上下文，审核历史读取冻结事实且拒绝空退回意见。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            graph = seed_graph(db)
            if not with_query_topic:
                graph["task"].query_topic_id = None
                db.commit()
            user_id = graph["user"].id
            task_id = graph["task"].id
            content_id = graph["content"].id
            publication = create_manual_publication(
                db=db,
                payload=publication_payload(content_id, graph["same_account"].id),
                actor=graph["user"],
                request_id="repair-create-publication",
                idempotency_key="repair-publication",
            )
            command_publication(
                db=db,
                publication_id=publication.id,
                command="mark-platform-review",
                payload=PublicationCommand(comment="审核"),
                actor=graph["user"],
                request_id="repair-review",
            )
            command_publication(
                db=db,
                publication_id=publication.id,
                command="mark-published",
                payload=PublicationCommand(
                    actual_title="修复前标题",
                    final_url="https://community.example.invalid/posts/repair",
                    published_at="2026-07-11T00:00:00Z",
                    comment="发布",
                ),
                actor=graph["user"],
                request_id="repair-published",
            )
            command_publication(
                db=db,
                publication_id=publication.id,
                command="mark-verification-failed",
                payload=PublicationCommand(comment="页面内容不匹配"),
                actor=graph["user"],
                request_id="repair-failed",
            )
            attention = db.scalar(
                select(PublicationAttention).where(
                    PublicationAttention.publication_record_id == publication.id
                )
            )
            assert attention is not None
            new_fact = FactVersion(
                product_id=graph["product"].id,
                version=2,
                status="APPROVED",
                body_markdown=fact_markdown(5.0),
                classification="PUBLIC",
                change_summary="更新电压",
                created_by=user_id,
                approved_by=user_id,
            )
            db.add(new_fact)
            db.commit()
            context = get_repair_context(db, attention.id)
            assert (context.query_topic is not None) is with_query_topic
            assert [item.version.id for item in context.fact_candidates] == [
                new_fact.id,
                graph["fact"].id,
            ]
            assert context.platform_profile_id == graph["profile"].id
            assert context.fact_candidates[0].difference.changes
            repair = create_repair_task(
                db=db,
                attention_id=attention.id,
                payload=PublicationRepairTaskCreate(
                    expected_attention_revision=0,
                    fact_version_id=new_fact.id,
                ),
                actor=graph["user"],
                request_id="repair-task",
            )
            assert repair.product_id == graph["product"].id
            assert repair.query_topic_id == (graph["topic"].id if with_query_topic else None)
            assert repair.fact_version_id == new_fact.id
            assert repair.platform_profile_id == graph["profile"].id
            db.refresh(attention)
            assert attention.status == "OPEN"
            with pytest.raises(AppError, match="已经创建修复任务"):
                create_repair_task(
                    db=db,
                    attention_id=attention.id,
                    payload=PublicationRepairTaskCreate(
                        expected_attention_revision=0,
                        fact_version_id=new_fact.id,
                    ),
                    actor=graph["user"],
                    request_id="repair-task-repeat",
                )
            db.rollback()
            with pytest.raises(ValidationError, match="处置说明不能为空"):
                ResolvePublicationAttentionRequest(
                    expected_revision=0,
                    resolution_comment="   ",
                )
            resolved = resolve_attention(
                db=db,
                attention_id=attention.id,
                payload=ResolvePublicationAttentionRequest(
                    expected_revision=0,
                    resolution_comment="已确认修复任务进入后续生产",
                ),
                actor=graph["user"],
                request_id="repair-resolved",
            )
            assert resolved.status == "RESOLVED"

            review_fact = FactVersion(
                product_id=graph["product"].id,
                version=3,
                status="DRAFT",
                body_markdown=fact_markdown(1.8),
                classification="PUBLIC",
                change_summary="待审核事实",
                created_by=user_id,
            )
            db.add(review_fact)
            db.commit()
            transition_fact_version(
                db=db,
                fact_version_id=review_fact.id,
                expected_revision=0,
                comment="提交事实",
                actor=graph["user"],
                request_id="fact-submit-0",
                action="submit",
            )
            db.refresh(review_fact)
            with pytest.raises(AppError, match="退回意见不能为空"):
                transition_fact_version(
                    db=db,
                    fact_version_id=review_fact.id,
                    expected_revision=1,
                    comment="   ",
                    actor=graph["user"],
                    request_id="fact-empty-reject",
                    action="request-changes",
                )
            db.rollback()
            for action, comment in (
                ("request-changes", "请补充测试条件"),
                ("submit", "已补充"),
                ("approve", ""),
            ):
                transition_fact_version(
                    db=db,
                    fact_version_id=review_fact.id,
                    expected_revision=review_fact.revision,
                    comment=comment,
                    actor=graph["user"],
                    request_id=f"fact-{action}-{review_fact.revision}",
                    action=action,  # type: ignore[arg-type]
                )
                db.refresh(review_fact)
            fact_context = get_fact_review_context(db, review_fact.id)
            assert fact_context.available_actions == ["RETIRE"]
            assert [item.comment for item in fact_context.review_history[-4:]] == [
                "提交事实",
                "请补充测试条件",
                "已补充",
                "",
            ]
            fact_submit_audit = db.scalar(
                select(AuditLog).where(AuditLog.request_id == "fact-submit-0")
            )
            assert fact_submit_audit is not None
            assert fact_submit_audit.business_module == "PRODUCT_FACTS"
            assert fact_submit_audit.outcome == "SUCCESS"
            assert fact_submit_audit.details == {
                "changes": [
                    {
                        "field": "status",
                        "before": "DRAFT",
                        "after": "PENDING_REVIEW",
                    }
                ],
                "facts": {"revision": 1},
            }
            assert "提交事实" not in str(fact_submit_audit.details)

            source = ContentVersion(
                task_id=task_id,
                fact_version_id=graph["fact"].id,
                based_on_id=content_id,
                version=2,
                source_type="HUMAN",
                title="修订前",
                summary="修订前摘要",
                body_markdown="# 修订前",
                tags=["review"],
                content_hash="b" * 64,
                status="DRAFT",
                quality_issues=[],
                change_summary="人工修订",
                created_by=user_id,
            )
            db.add(source)
            db.commit()
            transition_content_version(
                db=db,
                content_version_id=source.id,
                expected_revision=0,
                comment="提交内容",
                actor=graph["user"],
                request_id="content-submit",
                action="submit-review",
            )
            with pytest.raises(AppError, match="退回意见不能为空"):
                transition_content_version(
                    db=db,
                    content_version_id=source.id,
                    expected_revision=1,
                    comment="   ",
                    actor=graph["user"],
                    request_id="content-empty-reject",
                    action="request-changes",
                )
            db.rollback()
            transition_content_version(
                db=db,
                content_version_id=source.id,
                expected_revision=1,
                comment="请调整标题",
                actor=graph["user"],
                request_id="content-reject",
                action="request-changes",
            )
            transition_content_version(
                db=db,
                content_version_id=source.id,
                expected_revision=2,
                comment="重新提交",
                actor=graph["user"],
                request_id="content-resubmit",
                action="submit-review",
            )
            transition_content_version(
                db=db,
                content_version_id=source.id,
                expected_revision=3,
                comment="",
                actor=graph["user"],
                request_id="content-approve",
                action="approve",
            )
            content_context = get_content_review_context(db, source.id)
            assert content_context.available_actions == []
            assert content_context.fact_version.id == graph["fact"].id
            assert "3.3 V" in content_context.fact_version.body_markdown
            assert content_context.diff is not None and content_context.diff.lines
            assert [item.comment for item in content_context.review_history[-4:]] == [
                "提交内容",
                "请调整标题",
                "重新提交",
                "",
            ]
            content_reject_audit = db.scalar(
                select(AuditLog).where(AuditLog.request_id == "content-reject")
            )
            assert content_reject_audit is not None
            assert content_reject_audit.business_module == "CONTENT_REVIEW"
            assert content_reject_audit.outcome == "SUCCESS"
            assert content_reject_audit.details == {
                "changes": [
                    {
                        "field": "status",
                        "before": "PENDING_REVIEW",
                        "after": "CHANGES_REQUESTED",
                    }
                ],
                "facts": {"revision": 2},
            }
            assert "请调整标题" not in str(content_reject_audit.details)
            transition_fact_version(
                db=db,
                fact_version_id=graph["fact"].id,
                expected_revision=graph["fact"].revision,
                comment="旧事实退役",
                actor=graph["user"],
                request_id="fact-retire-after-content",
                action="retire",
            )
            retired_context = get_content_review_context(db, source.id)
            assert retired_context.fact_version.status == "RETIRED"
            assert "3.3 V" in retired_context.fact_version.body_markdown

            blocking = ContentVersion(
                task_id=repair.id,
                fact_version_id=new_fact.id,
                version=1,
                source_type="HUMAN",
                title="阻断内容",
                summary="阻断",
                body_markdown="阻断",
                tags=[],
                content_hash="c" * 64,
                status="PENDING_REVIEW",
                quality_issues=[{"code": "BLOCKED", "severity": "BLOCKING", "message": "阻断问题"}],
                change_summary="阻断测试",
                created_by=user_id,
            )
            db.add(blocking)
            db.commit()
            with pytest.raises(AppError, match="阻断质量问题"):
                transition_content_version(
                    db=db,
                    content_version_id=blocking.id,
                    expected_revision=0,
                    comment="",
                    actor=graph["user"],
                    request_id="content-blocking",
                    action="approve",
                )
            db.rollback()
            assert get_content_review_context(db, blocking.id).available_actions == [
                "REQUEST_CHANGES"
            ]
            assert db.scalar(select(func.count()).select_from(FactReviewRecord)) >= 4
            assert db.scalar(select(func.count()).select_from(ContentReviewRecord)) >= 4
        engine.dispose()


@pytest.mark.integration
def test_platform_management_projection_status_gates_and_permissions() -> None:
    """平台管理实时投影、独立启停和全部新建门禁共享同一数据库事实。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        as_of = datetime(2026, 7, 22, 8, 0, tzinfo=UTC)
        with session_factory() as db:
            graph = seed_graph(db)
            admin = User(
                username=f"platform-admin-{uuid.uuid4().hex[:8]}",
                display_name="平台管理测试管理员",
                password_hash="not-used",
                account_type="ADMIN",
            )
            prompt = PlatformPrompt(
                platform_profile_id=graph["profile"].id,
                template_markdown="平台管理测试 Prompt",
                updated_by=graph["user"].id,
            )
            db.add_all([admin, prompt])
            graph["task"].created_at = as_of - timedelta(days=30)

            def add_reference(created_at: datetime) -> None:
                db.add(
                    ContentTask(
                        query_topic_id=graph["topic"].id,
                        product_id=graph["product"].id,
                        fact_version_id=graph["fact"].id,
                        platform_profile_id=graph["profile"].id,
                        created_by=graph["user"].id,
                        created_at=created_at,
                    )
                )

            add_reference(as_of)
            add_reference(as_of - timedelta(days=30, microseconds=1))
            db.commit()

            detail = get_platform_profile_detail(db, graph["profile"].id, as_of=as_of)
            assert detail.reference_summary.recent_30_days == 1
            assert detail.reference_summary.all_time == 3
            assert detail.account_summary.model_dump() == {
                "total": 2,
                "enabled": 2,
                "disabled": 0,
            }
            assert detail.profile.prompt_updated_at == prompt.updated_at
            assert detail.prompt_updated_at == prompt.updated_at
            assert detail.profile.updated_at is None

            listed = list_platform_profiles(
                db=db,
                q="技术社区",
                platform_type_id=None,
                profile_status=None,
                configuration_status=None,
                page=1,
                page_size=10,
            )
            assert listed.total == 2
            assert listed.summary.model_dump() == {
                "platform_total": 2,
                "enabled_total": 2,
                "missing_prompt_total": 1,
                "configuration_complete_total": 1,
            }
            listed_by_id = {item.id: item for item in listed.items}
            assert listed_by_id[graph["profile"].id].prompt_updated_at == prompt.updated_at
            assert (
                listed_by_id[graph["other_account"].platform_profile_id].prompt_updated_at is None
            )

            with pytest.raises(AppError) as duplicate_slug:
                create_platform_profile(
                    db=db,
                    payload=PlatformProfileCreate(
                        name="重复平台标识",
                        slug=graph["profile"].slug,
                        allowed_domains=["duplicate.example.invalid"],
                        platform_type_id=graph["platform_type"].id,
                    ),
                    actor=graph["user"],
                    request_id="duplicate-platform-slug",
                )
            assert duplicate_slug.value.code == "PLATFORM_SLUG_EXISTS"
            db.rollback()

            publication = create_manual_publication(
                db=db,
                payload=publication_payload(graph["content"].id, graph["same_account"].id),
                actor=graph["user"],
                request_id="platform-management-publication",
                idempotency_key=f"platform-management-{uuid.uuid4()}",
            )
            command_publication(
                db=db,
                publication_id=publication.id,
                command="mark-platform-review",
                payload=PublicationCommand(comment="进入平台审核"),
                actor=graph["user"],
                request_id="platform-management-review",
            )
            command_publication(
                db=db,
                publication_id=publication.id,
                command="mark-published",
                payload=PublicationCommand(
                    actual_title="平台管理测试发布",
                    final_url="https://community.example.invalid/platform-management",
                    published_at=as_of - timedelta(days=1),
                    comment="已发布",
                ),
                actor=graph["user"],
                request_id="platform-management-published",
            )
            command_publication(
                db=db,
                publication_id=publication.id,
                command="remove",
                payload=PublicationCommand(comment="页面已下线"),
                actor=graph["user"],
                request_id="platform-management-removed",
            )
            attention = db.scalar(
                select(PublicationAttention).where(
                    PublicationAttention.publication_record_id == publication.id
                )
            )
            assert attention is not None

            prompt_revision = prompt.revision
            account_statuses = [graph["same_account"].is_active, graph["same_account_b"].is_active]
            disabled = set_platform_profile_enabled(
                db=db,
                platform_profile_id=graph["profile"].id,
                payload=RevisionRequest(expected_revision=0),
                actor=admin,
                request_id="platform-management-disable",
                enabled=False,
            )
            assert disabled.is_active is False
            disabled_audit = db.scalar(
                select(AuditLog).where(AuditLog.request_id == "platform-management-disable")
            )
            assert disabled_audit is not None
            assert disabled_audit.outcome == "SUCCESS"
            assert disabled_audit.details == {
                "changes": [{"field": "is_active", "before": True, "after": False}],
                "facts": {"revision": 1},
            }
            assert prompt.revision == prompt_revision
            assert [
                graph["same_account"].is_active,
                graph["same_account_b"].is_active,
            ] == account_statuses

            complete_disabled = list_platform_profiles(
                db=db,
                q=None,
                platform_type_id=None,
                profile_status=PlatformProfileStatus.DISABLED,
                configuration_status=PlatformConfigurationStatus.COMPLETE,
                page=1,
                page_size=10,
            )
            assert [item.id for item in complete_disabled.items] == [graph["profile"].id]
            assert complete_disabled.summary.enabled_total == 1
            assert all(
                item.platform_profile_id != graph["profile"].id
                for item in list_publication_candidates(db).items
            )

            with pytest.raises(AppError) as account_error:
                create_platform_account(
                    db=db,
                    payload=PlatformAccountCreate(
                        platform_profile_id=graph["profile"].id,
                        label="停用平台账号",
                        account_identifier="disabled-platform",
                    ),
                    actor=graph["user"],
                    request_id="disabled-account",
                )
            assert account_error.value.code == "PLATFORM_DISABLED"
            db.rollback()

            with pytest.raises(AppError) as task_error:
                create_content_task(
                    db=db,
                    payload=ContentTaskCreate(
                        product_id=graph["product"].id,
                        fact_version_id=graph["fact"].id,
                        platform_profile_id=graph["profile"].id,
                    ),
                    actor=graph["user"],
                    request_id="disabled-task",
                )
            assert task_error.value.code == "PLATFORM_DISABLED"
            db.rollback()

            with pytest.raises(AppError) as publication_error:
                create_manual_publication(
                    db=db,
                    payload=publication_payload(graph["content"].id, graph["same_account_b"].id),
                    actor=graph["user"],
                    request_id="disabled-publication",
                    idempotency_key=f"disabled-publication-{uuid.uuid4()}",
                )
            assert publication_error.value.code == "PLATFORM_DISABLED"
            db.rollback()

            with pytest.raises(AppError) as repair_error:
                create_repair_task(
                    db=db,
                    attention_id=attention.id,
                    payload=PublicationRepairTaskCreate(
                        expected_attention_revision=0,
                        fact_version_id=graph["fact"].id,
                    ),
                    actor=graph["user"],
                    request_id="disabled-repair",
                )
            assert repair_error.value.code == "PLATFORM_DISABLED"
            db.rollback()

            with pytest.raises(AppError) as delete_error:
                delete_platform_profile(
                    db=db,
                    platform_profile_id=graph["profile"].id,
                    actor=admin,
                    request_id="disabled-delete",
                )
            assert delete_error.value.code == "PLATFORM_PROFILE_IN_USE"
            assert db.get(PlatformProfile, graph["profile"].id).is_active is False
            db.rollback()
            admin_id = admin.id
            engineer_id = graph["user"].id
            profile_id = graph["profile"].id

        csrf_token = "platform-management-csrf-token-more-than-32-characters"

        def override_db() -> Iterator[Session]:
            with session_factory() as db:
                yield db

        with session_factory() as db:
            admin_user = db.get(User, admin_id)
            engineer_user = db.get(User, engineer_id)
            assert admin_user is not None and engineer_user is not None
        current_session = SimpleNamespace(
            user=engineer_user,
            csrf_hash=hash_token(csrf_token),
            last_seen_at=None,
        )
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: current_session
        client = TestClient(app)
        try:
            assert client.get(f"/api/v1/platform-profiles/{profile_id}").status_code == 403
            assert client.get("/api/v1/platform-profiles/export").status_code == 403
            paired = client.get("/api/v1/platform-profiles?page=1")
            assert paired.status_code == 422
            denied = client.post(
                f"/api/v1/platform-profiles/{profile_id}/enable",
                json={"expected_revision": 1},
                headers={"X-CSRF-Token": csrf_token},
            )
            assert denied.status_code == 403
            denied_delete = client.delete(
                f"/api/v1/platform-profiles/{profile_id}/prompt?expected_revision=0",
                headers={"X-CSRF-Token": csrf_token},
            )
            assert denied_delete.status_code == 403

            current_session.user = admin_user
            missing_revision = client.delete(
                f"/api/v1/platform-profiles/{profile_id}/prompt",
                headers={"X-CSRF-Token": csrf_token},
            )
            assert missing_revision.status_code == 422
            stale_delete = client.delete(
                f"/api/v1/platform-profiles/{profile_id}/prompt?expected_revision=1",
                headers={"X-CSRF-Token": csrf_token},
            )
            assert stale_delete.status_code == 409
            assert stale_delete.json()["error"]["code"] == "REVISION_CONFLICT"
            csrf_denied = client.post(
                f"/api/v1/platform-profiles/{profile_id}/enable",
                json={"expected_revision": 1},
                headers={"X-CSRF-Token": "wrong-token-with-more-than-32-characters"},
            )
            assert csrf_denied.status_code == 403
            enabled = client.post(
                f"/api/v1/platform-profiles/{profile_id}/enable",
                json={"expected_revision": 1},
                headers={"X-CSRF-Token": csrf_token},
            )
            assert enabled.status_code == 200
            assert enabled.json()["is_active"] is True
            deleted_prompt = client.delete(
                f"/api/v1/platform-profiles/{profile_id}/prompt?expected_revision=0",
                headers={"X-CSRF-Token": csrf_token},
            )
            assert deleted_prompt.status_code == 204
            assert client.get(f"/api/v1/platform-profiles/{profile_id}/prompt").status_code == 404
        finally:
            app.dependency_overrides.clear()
        engine.dispose()


@pytest.mark.integration
def test_platform_disable_lock_serializes_account_creation() -> None:
    """停用事务持有平台行锁时，账号创建必须等待并读取提交后的停用状态。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            graph = seed_graph(db)
            profile_id = graph["profile"].id
            actor_id = graph["user"].id

        started = Event()

        def create_after_lock() -> str:
            with session_factory() as db:
                actor = db.get(User, actor_id)
                assert actor is not None
                started.set()
                try:
                    create_platform_account(
                        db=db,
                        payload=PlatformAccountCreate(
                            platform_profile_id=profile_id,
                            label="并发账号",
                            account_identifier="concurrent-account",
                        ),
                        actor=actor,
                        request_id="concurrent-account",
                    )
                except AppError as error:
                    db.rollback()
                    return error.code
            return "CREATED"

        with session_factory() as disabling, ThreadPoolExecutor(max_workers=1) as executor:
            profile = disabling.scalar(
                select(PlatformProfile).where(PlatformProfile.id == profile_id).with_for_update()
            )
            assert profile is not None
            profile.is_active = False
            disabling.flush()
            future = executor.submit(create_after_lock)
            assert started.wait(timeout=5)
            with pytest.raises(FutureTimeoutError):
                future.result(timeout=0.2)
            disabling.commit()
            assert future.result(timeout=5) == "PLATFORM_DISABLED"

        with session_factory() as db:
            assert (
                db.scalar(
                    select(func.count())
                    .select_from(PlatformAccount)
                    .where(PlatformAccount.account_identifier == "concurrent-account")
                )
                == 0
            )
        engine.dispose()
