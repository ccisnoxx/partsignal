"""内容任务、版本与内容审核 ORM 映射。"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import new_uuid


class ContentTask(Base):
    """锁定事实版本和稳定平台身份的内容生产任务。"""

    __tablename__ = "content_tasks"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_content_tasks_idempotency_key"),
        Index("ix_content_tasks_platform_profile_created_at", "platform_profile_id", "created_at"),
        Index("ix_content_tasks_archived_at_created_at", "archived_at", "created_at"),
        CheckConstraint(
            "status <> 'OPEN' OR platform_profile_id IS NOT NULL",
            name="open_requires_platform",
        ),
        CheckConstraint(
            "archived_at IS NULL OR status = 'COMPLETED'",
            name="archive_completed",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    query_topic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("query_topics.id", ondelete="RESTRICT")
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    fact_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_versions.id", ondelete="RESTRICT"), nullable=False
    )
    current_content_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "content_versions.id",
            name="fk_content_tasks_current_content_version_id",
            ondelete="RESTRICT",
            use_alter=True,
        ),
    )
    platform_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform_profiles.id", ondelete="SET NULL"),
    )
    platform_profile_name_snapshot: Mapped[str] = mapped_column(String(160), nullable=False)
    platform_website_url_snapshot: Mapped[str | None] = mapped_column(Text)
    source_published_content_issue_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("published_content_issues.id", ondelete="SET NULL"),
        unique=True,
    )
    idempotency_key: Mapped[str | None] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="OPEN")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ContentVersion(Base):
    """正文不可原地编辑的 Markdown 内容版本。"""

    __tablename__ = "content_versions"
    __table_args__ = (
        UniqueConstraint("task_id", "version"),
        UniqueConstraint("source_job_id"),
        Index(
            "uq_content_versions_one_approved_per_task",
            "task_id",
            unique=True,
            postgresql_where="status = 'APPROVED'",
        ),
        Index(
            "uq_content_versions_one_pending_per_task",
            "task_id",
            unique=True,
            postgresql_where="status = 'PENDING_REVIEW'",
        ),
        CheckConstraint(
            "status IN ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', "
            "'APPROVED', 'SUPERSEDED', 'ABANDONED')",
            name="ck_content_versions_status_business_workflow",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_tasks.id", ondelete="RESTRICT"), nullable=False
    )
    fact_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_versions.id", ondelete="RESTRICT"), nullable=False
    )
    source_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("generation_jobs.id", ondelete="RESTRICT")
    )
    based_on_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_versions.id", ondelete="RESTRICT")
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    quality_issues: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    change_summary: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ContentReviewRecord(Base):
    """追加式内容审核记录。"""

    __tablename__ = "content_review_records"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    content_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_versions.id", ondelete="RESTRICT"), nullable=False
    )
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ContentTaskGeoSource(Base):
    """GEO 异常创建内容任务时冻结的来源依据。"""

    __tablename__ = "content_task_geo_sources"
    __table_args__ = (
        CheckConstraint(
            "rule_code IN ('CONTENT_DECLINE', 'LONG_UNMENTIONED', "
            "'QUESTION_COVERAGE_GAP')",
            name="ck_content_task_geo_sources_rule_code",
        ),
        CheckConstraint(
            "date_from <= date_to",
            name="ck_content_task_geo_sources_period",
        ),
        CheckConstraint(
            "jsonb_typeof(basis_snapshot) = 'object'",
            name="ck_content_task_geo_sources_snapshot_object",
        ),
    )
    content_task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("content_tasks.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    rule_code: Mapped[str] = mapped_column(String(48), nullable=False)
    date_from: Mapped[date] = mapped_column(Date, nullable=False)
    date_to: Mapped[date] = mapped_column(Date, nullable=False)
    published_article_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("published_articles.id", ondelete="SET NULL")
    )
    query_topic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("query_topics.id", ondelete="RESTRICT")
    )
    geo_platform: Mapped[str | None] = mapped_column(String(160))
    basis_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
