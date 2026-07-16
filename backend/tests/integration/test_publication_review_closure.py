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
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.db import get_db
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.models.configuration import (
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
from app.models.geo_files import GeoObservation
from app.models.identity import AuditLog, User
from app.models.product_facts import (
    FactReviewRecord,
    FactVersion,
    Product,
)
from app.models.publication import (
    PlatformAccount,
    PublicationAttention,
    PublicationRecord,
)
from app.schemas.common import CommandRequest
from app.schemas.configuration import (
    PlatformProfileCreate,
    PlatformProfileVersionCreate,
    PlatformProfileVersionUpdate,
)
from app.schemas.content import ContentTaskCreate
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
from app.services.integrity import publication_integrity_issues
from app.services.platform_configuration import (
    delete_platform_profile,
    delete_platform_profile_version,
    delete_platform_prompt,
    delete_platform_type,
)
from app.services.product_facts import delete_fact_version, delete_product
from app.services.projections import platform_profile_out
from app.services.publication import (
    cancel_content_task,
    command_publication,
    create_manual_publication,
    create_repair_task,
    delete_platform_account,
    resolve_attention,
)
from app.services.publication_queries import get_repair_context
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
def test_controlled_deletion_reports_direct_references_and_allows_clean_targets() -> None:
    """删除服务汇总直接引用；清理后的对象可在同一公开流程中重试。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            graph = seed_graph(db)
            actor = graph["user"]
            db.add(
                GeoObservation(
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
                query_topic_id=graph["topic"].id,
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

            for status, disposable_id in zip(
                disposable_statuses, disposable_ids, strict=True
            ):
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
def test_repair_context_resolution_and_review_history_are_immutable() -> None:
    """修复任务固定上下文，审核历史读取冻结事实且拒绝空退回意见。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            graph = seed_graph(db)
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
            assert repair.query_topic_id == graph["topic"].id
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
