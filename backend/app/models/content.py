"""内容任务、版本与内容审核 ORM 映射。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
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
    """锁定事实和平台规则版本的内容生产任务。"""

    __tablename__ = "content_tasks"
    __table_args__ = (
        CheckConstraint(
            "generation_data_classification IS NULL OR "
            "generation_data_classification IN ('PUBLIC', 'INTERNAL', 'RESTRICTED')",
            name="ck_content_tasks_generation_data_classification",
        ),
        CheckConstraint(
            "(generation_data_classification IS NULL "
            "AND generation_data_classified_by IS NULL "
            "AND generation_data_classified_at IS NULL) OR "
            "(generation_data_classification IS NOT NULL "
            "AND generation_data_classified_by IS NOT NULL "
            "AND generation_data_classified_at IS NOT NULL)",
            name="ck_content_tasks_generation_data_classification_complete",
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
    platform_profile_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform_profile_versions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    platform_type_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_types.id", ondelete="SET NULL")
    )
    platform_type_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    user_prompt_markdown: Mapped[str] = mapped_column(Text, nullable=False, default="")
    generation_data_classification: Mapped[str | None] = mapped_column(String(16))
    generation_data_classified_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
    )
    generation_data_classified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    source_publication_attention_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("publication_attentions.id", ondelete="RESTRICT"),
        unique=True,
    )
    target_audience: Mapped[str] = mapped_column(Text, nullable=False)
    content_angle: Mapped[str] = mapped_column(Text, nullable=False)
    conversion_goal: Mapped[str] = mapped_column(Text, nullable=False)
    desired_format: Mapped[str] = mapped_column(String(120), nullable=False)
    desired_length_min: Mapped[int] = mapped_column(Integer, nullable=False)
    desired_length_max: Mapped[int] = mapped_column(Integer, nullable=False)
    canonical_url: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="OPEN")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


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
