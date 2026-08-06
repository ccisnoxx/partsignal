"""人工未审核草稿保存与彻底删除的 PostgreSQL 集成测试。"""

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
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.configuration import PlatformProfile, PlatformType
from app.models.content import ContentReviewRecord, ContentTask, ContentVersion
from app.models.identity import AuditLog, User
from app.models.product_facts import FactVersion, Product
from app.schemas.content import ContentDraftUpdate
from app.services.content_production import delete_content_draft, update_content_draft
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


def _seed_draft(db: Session) -> tuple[User, ContentTask, ContentVersion, ContentVersion]:
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
        source_type="HUMAN",
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

            with pytest.raises(AppError, match="内容版本已被其他请求修改"):
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
