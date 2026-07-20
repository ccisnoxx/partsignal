"""使用 PostgreSQL 和真实 FastAPI 路径验证阶段二发布与审核不变量。"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
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
    PlatformProfileVersion,
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
)
from app.routers.observation import get_geo_metrics
from app.schemas.common import CommandRequest
from app.schemas.configuration import (
    PlatformProfileCreate,
    PlatformProfileVersionCreate,
    PlatformProfileVersionUpdate,
)
from app.schemas.content import ContentTaskCreate
from app.schemas.geo_files import GeoArticleResultCreate, GeoObservationCreate
from app.schemas.publication import (
    ManualPublicationCreate,
    PublicationCommand,
    PublicationRepairTaskCreate,
    ResolvePublicationAttentionRequest,
)
from app.security import hash_token
from app.services.content_planning import (
    activate_platform_profile_version,
    create_content_task,
    create_platform_profile,
    create_platform_profile_version,
    retire_platform_profile_version,
    update_platform_profile_version,
)
from app.services.geo_observation import create_geo_observation, geo_publication_candidates
from app.services.integrity import publication_integrity_issues
from app.services.platform_configuration import (
    delete_platform_profile,
    delete_platform_profile_version,
    delete_platform_prompt,
    delete_platform_type,
)
from app.services.product_facts import delete_fact_version, delete_product
from app.services.projections import content_tasks_out, platform_profile_out
from app.services.publication import (
    cancel_content_task,
    command_publication,
    create_manual_publication,
    create_repair_task,
    delete_platform_account,
    resolve_attention,
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


def fact_snapshot(value: float = 3.3) -> dict[str, Any]:
    """构造包含关键参数、测试条件、边界和证据的不可变事实快照。"""
    return {
        "reference_parts": [
            {
                "client_key": "ref-1",
                "part_number": "REF-001",
                "manufacturer": "TEST",
                "category": "MCU",
            }
        ],
        "parameters": [
            {
                "client_key": "voltage",
                "owner_key": "product",
                "key": "voltage",
                "name": "工作电压",
                "value_type": "NUMERIC",
                "min_value": None,
                "typical_value": value,
                "max_value": None,
                "text_value": None,
                "unit": "V",
                "test_conditions": "25 摄氏度",
                "is_critical": True,
                "evidence_keys": ["datasheet"],
            }
        ],
        "replacement_relations": [
            {
                "client_key": "replacement",
                "reference_part_key": "ref-1",
                "replacement_level": "PARAMETER_COMPATIBLE",
                "conditions": "仅限 3.3V 系统",
                "exclusions": "不适用于 5V 系统",
                "evidence_keys": ["datasheet"],
            }
        ],
        "evidences": [
            {
                "client_key": "datasheet",
                "type": "DATASHEET",
                "title": "公开数据手册",
                "version": "1.0",
                "source_url": "https://docs.example.invalid/datasheet.pdf",
                "file_id": None,
                "confidentiality": "PUBLIC",
            }
        ],
        "claims": [
            {
                "client_key": "claim",
                "type": "APPROVED",
                "text": "典型工作电压为 3.3V",
                "evidence_keys": ["datasheet"],
            }
        ],
    }


def platform_rules(body_max: int = 2000) -> dict[str, Any]:
    return {
        "target_audience": "工程师",
        "title_min": 1,
        "title_max": 120,
        "body_min": 1,
        "body_max": body_max,
        "tone": "技术说明",
        "allow_external_links": True,
        "allow_tables": True,
        "allow_contact": False,
        "prohibited_phrases": [],
        "sections": [],
    }


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
        snapshot_json=fact_snapshot(),
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
    profile_version = PlatformProfileVersion(
        platform_profile_id=profile.id,
        version=1,
        status="ACTIVE",
        rules=platform_rules(),
    )
    task = ContentTask(
        query_topic_id=topic.id,
        product_id=product.id,
        fact_version_id=fact.id,
        platform_profile_version_id=uuid.uuid4(),
        platform_type_id=platform_type.id,
        platform_type_snapshot={
            "id": str(platform_type.id),
            "name": platform_type.name,
            "slug": platform_type.slug,
        },
        user_prompt_markdown="",
        target_audience="硬件工程师",
        content_angle="选型指南",
        conversion_goal="阅读数据手册",
        desired_format="MARKDOWN",
        desired_length_min=300,
        desired_length_max=1200,
        canonical_url="https://product.example.invalid/ps",
        created_by=user.id,
    )
    db.add(profile_version)
    db.flush()
    task.platform_profile_version_id = profile_version.id
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
        "profile_version": profile_version,
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
            assert missing.status_code == 404

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
            assert [audit.details for audit in audits] == [{"revision": 0}, {"revision": 1}]
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
            mismatch = client.post(
                "/api/v1/publication-records/manual",
                headers={
                    "X-CSRF-Token": csrf_token,
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

            first = client.post(
                "/api/v1/publication-records/manual",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "Idempotency-Key": "stage2-same-platform-a",
                },
                json=publication_payload(content_id, same_account_id).model_dump(mode="json"),
            )
            second = client.post(
                "/api/v1/publication-records/manual",
                headers={
                    "X-CSRF-Token": csrf_token,
                    "Idempotency-Key": "stage2-same-platform-b",
                },
                json=publication_payload(content_id, same_account_b_id).model_dump(mode="json"),
            )
            assert first.status_code == 201
            assert second.status_code == 201
            first_id = uuid.UUID(first.json()["id"])
            second_id = uuid.UUID(second.json()["id"])
        finally:
            app.dependency_overrides.clear()

        with session_factory() as db:
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
            assert db.get(PublicationRecord, second_id) is not None
            assert publication_integrity_issues(db) == []
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
            failed = create_manual_publication(
                db=db,
                payload=publication_payload(graph["content"].id, graph["same_account_b"].id),
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

            with pytest.raises(AppError) as version_conflict:
                delete_platform_profile_version(
                    db=db,
                    platform_profile_version_id=graph["profile_version"].id,
                    actor=actor,
                    request_id="delete-version",
                )
            assert version_conflict.value.details["references"] == [
                {"type": "CONTENT_TASK", "count": 1}
            ]
            db.rollback()

            with pytest.raises(AppError) as profile_conflict:
                delete_platform_profile(
                    db=db,
                    platform_profile_id=graph["profile"].id,
                    actor=actor,
                    request_id="delete-profile",
                )
            assert {item["type"] for item in profile_conflict.value.details["references"]} == {
                "PLATFORM_PROFILE_VERSION",
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
            delete_platform_prompt(
                db=db,
                platform_profile_id=graph["profile"].id,
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
            active_version = PlatformProfileVersion(
                platform_profile_id=clean_profile.id,
                version=1,
                status="ACTIVE",
                rules=platform_rules(),
            )
            clean_prompt = PlatformPrompt(
                platform_profile_id=clean_profile.id,
                template_markdown="仅使用已批准事实。",
                updated_by=actor.id,
            )
            db.add_all([active_version, clean_prompt])
            db.commit()
            deleted_version_id = active_version.id
            delete_platform_profile_version(
                db=db,
                platform_profile_version_id=deleted_version_id,
                actor=actor,
                request_id="delete-active-version",
            )
            assert platform_profile_out(db, clean_profile).active_version is None
            task_payload = ContentTaskCreate(
                product_id=graph["product"].id,
                fact_version_id=graph["fact"].id,
                platform_profile_version_id=deleted_version_id,
                target_audience="测试工程师",
                content_angle="规则恢复验证",
                conversion_goal="查看资料",
                desired_format="工程说明",
                desired_length_min=1,
                desired_length_max=500,
                canonical_url="https://product.example.invalid/recovery",
            )
            with pytest.raises(AppError) as unavailable:
                create_content_task(
                    db=db,
                    payload=task_payload,
                    actor=actor,
                    request_id="create-without-active-rule",
                )
            assert unavailable.value.code == "INVALID_STATE_TRANSITION"
            db.rollback()
            replacement_version = PlatformProfileVersion(
                platform_profile_id=clean_profile.id,
                version=2,
                status="ACTIVE",
                rules=platform_rules(),
            )
            db.add(replacement_version)
            db.commit()
            recovered_task = create_content_task(
                db=db,
                payload=task_payload.model_copy(
                    update={"platform_profile_version_id": replacement_version.id}
                ),
                actor=actor,
                request_id="create-after-rule-recovery",
            )
            assert recovered_task.query_topic_id is None
            db.delete(recovered_task)
            db.flush()
            db.delete(replacement_version)
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
                "platform_profile_version.deleted",
                "platform_profile.deleted",
                "platform_type.deleted",
            } <= actions
        engine.dispose()


@pytest.mark.integration
def test_manual_geo_observation_requires_complete_articles_and_screenshot() -> None:
    """人工观测必须覆盖产品全部公开文章，并保存逐篇结果和截图证据。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            graph = seed_graph(db)
            publications = [
                create_manual_publication(
                    db=db,
                    payload=publication_payload(graph["content"].id, account.id),
                    actor=graph["user"],
                    request_id=f"geo-publication-{index}",
                    idempotency_key=f"geo-publication-{index}-{uuid.uuid4()}",
                )
                for index, account in enumerate(
                    (graph["same_account"], graph["same_account_b"]), start=1
                )
            ]
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
            incomplete = GeoObservationCreate(
                product_id=graph["product"].id,
                search_platform="DeepSeek",
                search_query=graph["product"].part_number,
                tested_at=datetime.now(UTC),
                article_results=[
                    GeoArticleResultCreate(
                        publication_record_id=publications[0].id,
                        recommendation_status="RECOMMENDED",
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
                            recommendation_status=(
                                "RECOMMENDED" if index == 0 else "NOT_RECOMMENDED"
                            ),
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
                _user=graph["user"],
                product_id=graph["product"].id,
            )
            assert metrics.manual_observation_count == 1
            assert metrics.article_result_count == 2
            assert metrics.article_recommendation_rate == 0.5
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
def test_platform_rule_lifecycle_and_fact_version_deletion() -> None:
    """平台规则独立维护；事实版本仅在无内容引用时连同审核记录删除。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            graph = seed_graph(db)
            actor = graph["user"]
            actor.account_type = "ADMIN"
            db.commit()

            alpha = create_platform_profile(
                db=db,
                payload=PlatformProfileCreate(
                    name="Alpha 平台",
                    slug=f"alpha-{uuid.uuid4().hex[:8]}",
                    allowed_domains=["alpha.example.invalid"],
                    platform_type_id=graph["platform_type"].id,
                ),
                actor=actor,
                request_id="create-alpha-platform",
            )
            zeta = create_platform_profile(
                db=db,
                payload=PlatformProfileCreate(
                    name="Zeta 平台",
                    slug=f"zeta-{uuid.uuid4().hex[:8]}",
                    allowed_domains=["zeta.example.invalid"],
                    platform_type_id=graph["platform_type"].id,
                ),
                actor=actor,
                request_id="create-zeta-platform",
            )
            assert platform_profile_out(db, alpha).active_version is None
            assert not db.scalars(
                select(PlatformProfileVersion).where(
                    PlatformProfileVersion.platform_profile_id.in_([alpha.id, zeta.id])
                )
            ).all()

            alpha_version = create_platform_profile_version(
                db=db,
                platform_profile_id=alpha.id,
                payload=PlatformProfileVersionCreate(rules=platform_rules()),
                actor=actor,
                request_id="create-alpha-rule",
            )
            zeta_version = create_platform_profile_version(
                db=db,
                platform_profile_id=zeta.id,
                payload=PlatformProfileVersionCreate(rules=platform_rules()),
                actor=actor,
                request_id="create-zeta-rule",
            )
            updated = update_platform_profile_version(
                db=db,
                platform_profile_version_id=alpha_version.id,
                payload=PlatformProfileVersionUpdate(
                    expected_revision=0,
                    rules=platform_rules(2500),
                ),
                actor=actor,
                request_id="update-alpha-rule",
            )
            assert updated.rules["body_max"] == 2500
            assert updated.revision == 1
            with pytest.raises(AppError) as revision_conflict:
                update_platform_profile_version(
                    db=db,
                    platform_profile_version_id=alpha_version.id,
                    payload=PlatformProfileVersionUpdate(
                        expected_revision=0,
                        rules=platform_rules(2600),
                    ),
                    actor=actor,
                    request_id="update-alpha-rule-with-stale-revision",
                )
            assert revision_conflict.value.code == "REVISION_CONFLICT"
            db.rollback()
            activated = activate_platform_profile_version(
                db=db,
                platform_profile_version_id=alpha_version.id,
                payload=CommandRequest(expected_revision=1, comment="启用规则"),
                actor=actor,
                request_id="activate-alpha-rule",
            )
            assert activated.status == "ACTIVE"
            with pytest.raises(AppError) as immutable:
                update_platform_profile_version(
                    db=db,
                    platform_profile_version_id=alpha_version.id,
                    payload=PlatformProfileVersionUpdate(
                        expected_revision=2,
                        rules=platform_rules(3000),
                    ),
                    actor=actor,
                    request_id="update-active-rule",
                )
            assert immutable.value.code == "INVALID_STATE_TRANSITION"
            db.rollback()

            replacement = create_platform_profile_version(
                db=db,
                platform_profile_id=alpha.id,
                payload=PlatformProfileVersionCreate(rules=platform_rules(2600)),
                actor=actor,
                request_id="create-alpha-replacement-rule",
            )
            replacement = activate_platform_profile_version(
                db=db,
                platform_profile_version_id=replacement.id,
                payload=CommandRequest(expected_revision=0, comment="替换当前规则"),
                actor=actor,
                request_id="activate-alpha-replacement-rule",
            )
            db.refresh(alpha_version)
            assert replacement.status == "ACTIVE"
            assert alpha_version.status == "RETIRED"
            with pytest.raises(AppError) as retired_immutable:
                update_platform_profile_version(
                    db=db,
                    platform_profile_version_id=alpha_version.id,
                    payload=PlatformProfileVersionUpdate(
                        expected_revision=alpha_version.revision,
                        rules=platform_rules(2700),
                    ),
                    actor=actor,
                    request_id="update-retired-rule",
                )
            assert retired_immutable.value.code == "INVALID_STATE_TRANSITION"
            db.rollback()

            retired_draft = create_platform_profile_version(
                db=db,
                platform_profile_id=zeta.id,
                payload=PlatformProfileVersionCreate(rules=platform_rules(2800)),
                actor=actor,
                request_id="create-zeta-retired-rule",
            )
            retired_draft = retire_platform_profile_version(
                db=db,
                platform_profile_version_id=retired_draft.id,
                payload=CommandRequest(expected_revision=0, comment="不再使用"),
                actor=actor,
                request_id="retire-zeta-rule",
            )
            with pytest.raises(AppError) as explicitly_retired_immutable:
                update_platform_profile_version(
                    db=db,
                    platform_profile_version_id=retired_draft.id,
                    payload=PlatformProfileVersionUpdate(
                        expected_revision=retired_draft.revision,
                        rules=platform_rules(2900),
                    ),
                    actor=actor,
                    request_id="update-explicitly-retired-rule",
                )
            assert explicitly_retired_immutable.value.code == "INVALID_STATE_TRANSITION"
            db.rollback()
            ordered_versions = list(
                db.scalars(
                    select(PlatformProfileVersion)
                    .join(PlatformProfile)
                    .where(
                        PlatformProfileVersion.id.in_(
                            [alpha_version.id, replacement.id, zeta_version.id]
                        )
                    )
                    .order_by(PlatformProfile.name, PlatformProfileVersion.version.desc())
                )
            )
            assert [(item.platform_profile_id, item.version) for item in ordered_versions] == [
                (alpha.id, 2),
                (alpha.id, 1),
                (zeta.id, 1),
            ]

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
                    snapshot_json=fact_snapshot(float(version_number)),
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
                assert audit.details == {
                    "product_id": str(graph["product"].id),
                    "version": disposable_statuses.index(status) + 2,
                    "status": status,
                    "review_record_count": 1,
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
                snapshot_json=fact_snapshot(9.9),
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
                snapshot_json=fact_snapshot(12.0),
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
                snapshot_json=fact_snapshot(5.0),
                change_summary="更新电压",
                created_by=user_id,
                approved_by=user_id,
            )
            graph["profile_version"].status = "RETIRED"
            new_platform = PlatformProfileVersion(
                platform_profile_id=graph["profile"].id,
                version=2,
                status="ACTIVE",
                rules=platform_rules(3000),
            )
            db.add_all([new_fact, new_platform])
            db.commit()
            context = get_repair_context(db, attention.id)
            assert (context.query_topic is not None) is with_query_topic
            assert [item.version.id for item in context.fact_candidates] == [
                new_fact.id,
                graph["fact"].id,
            ]
            assert [item.version.id for item in context.platform_candidates] == [new_platform.id]
            assert context.fact_candidates[0].difference.changes
            repair = create_repair_task(
                db=db,
                attention_id=attention.id,
                payload=PublicationRepairTaskCreate(
                    expected_attention_revision=0,
                    fact_version_id=new_fact.id,
                    platform_profile_version_id=new_platform.id,
                    target_audience="维修工程师",
                    content_angle="修复说明",
                    conversion_goal="重新发布",
                    desired_format="MARKDOWN",
                    desired_length_min=400,
                    desired_length_max=1500,
                    canonical_url="https://product.example.invalid/repair",
                ),
                actor=graph["user"],
                request_id="repair-task",
            )
            assert repair.product_id == graph["product"].id
            assert repair.query_topic_id == (graph["topic"].id if with_query_topic else None)
            assert repair.fact_version_id == new_fact.id
            assert repair.platform_profile_version_id == new_platform.id
            assert repair.target_audience == "维修工程师"
            db.refresh(attention)
            assert attention.status == "OPEN"
            with pytest.raises(AppError, match="已经创建修复任务"):
                create_repair_task(
                    db=db,
                    attention_id=attention.id,
                    payload=PublicationRepairTaskCreate(
                        expected_attention_revision=0,
                        fact_version_id=new_fact.id,
                        platform_profile_version_id=new_platform.id,
                        target_audience="重复",
                        content_angle="重复",
                        conversion_goal="重复",
                        desired_format="MARKDOWN",
                        desired_length_min=1,
                        desired_length_max=2,
                        canonical_url="https://product.example.invalid/repeat",
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
                snapshot_json=fact_snapshot(1.8),
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
            assert content_context.fact_version.snapshot.parameters[0].typical_value == 3.3
            assert content_context.diff is not None and content_context.diff.lines
            assert [item.comment for item in content_context.review_history[-4:]] == [
                "提交内容",
                "请调整标题",
                "重新提交",
                "",
            ]
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
            assert retired_context.fact_version.snapshot.parameters[0].typical_value == 3.3

            missing_evidence_snapshot = fact_snapshot()
            missing_evidence_snapshot["evidences"][0]["file_id"] = str(uuid.uuid4())
            missing_evidence_fact = FactVersion(
                product_id=graph["product"].id,
                version=4,
                status="DRAFT",
                snapshot_json=missing_evidence_snapshot,
                change_summary="缺失证据文件测试",
                created_by=user_id,
            )
            db.add(missing_evidence_fact)
            db.commit()
            with pytest.raises(AppError) as missing_evidence:
                get_fact_review_context(db, missing_evidence_fact.id)
            assert missing_evidence.value.code == "REVIEW_CONTEXT_INCOMPLETE"

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
