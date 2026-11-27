"""目标问题与平台配置 ORM 映射。"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base
from app.models.base import new_uuid


class QueryTopic(Base):
    """供内容任务与 GEO 观测复用的目标问题。"""

    __tablename__ = "query_topics"
    __table_args__ = (
        CheckConstraint("length(description) <= 1000", name="ck_query_topics_description_length"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    canonical_question: Mapped[str] = mapped_column(Text, nullable=False)
    intent_type: Mapped[str] = mapped_column(String(40), nullable=False)
    variants: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PlatformType(Base):
    """管理员维护的平台分类。"""

    __tablename__ = "platform_types"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class PlatformPrompt(Base):
    """可由多个具体平台复用的 Markdown system Prompt。"""

    __tablename__ = "platform_prompts"
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=new_uuid
    )
    name: Mapped[str] = mapped_column(String(300), unique=True, nullable=False)
    template_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class PlatformPromptVersion(Base):
    """PlatformPrompt 的不可变版本历史（发布后正文只读，可绑定与回滚）。"""

    __tablename__ = "platform_prompt_versions"
    __table_args__ = (
        UniqueConstraint(
            "prompt_id",
            "version",
            name=conv("uq_platform_prompt_versions_prompt_version"),
        ),
        CheckConstraint("version >= 1", name=conv("ck_platform_prompt_versions_version_positive")),
        CheckConstraint(
            "revision >= 0", name=conv("ck_platform_prompt_versions_revision_nonnegative")
        ),
        CheckConstraint(
            "status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')",
            name=conv("ck_platform_prompt_versions_status"),
        ),
        CheckConstraint(
            "btrim(template_markdown) <> ''",
            name=conv("ck_platform_prompt_versions_markdown_nonempty"),
        ),
        CheckConstraint(
            "template_sha256 ~ '^[0-9a-f]{64}$'",
            name=conv("ck_platform_prompt_versions_sha256"),
        ),
        CheckConstraint(
            "length(change_summary) <= 500",
            name=conv("ck_platform_prompt_versions_change_summary_len"),
        ),
        CheckConstraint(
            "(status = 'DRAFT' AND published_at IS NULL AND published_by IS NULL) "
            "OR (status IN ('PUBLISHED', 'ARCHIVED') AND published_at IS NOT NULL "
            "AND published_by IS NOT NULL)",
            name=conv("ck_platform_prompt_versions_publish_pair"),
        ),
        Index(
            "uq_platform_prompt_versions_one_draft",
            "prompt_id",
            unique=True,
            postgresql_where=text("status = 'DRAFT'"),
        ),
        Index("ix_platform_prompt_versions_prompt_status", "prompt_id", "status"),
        Index("ix_platform_prompt_versions_created_by", "created_by"),
        Index(
            "ix_platform_prompt_versions_published_by",
            "published_by",
            postgresql_where=text("published_by IS NOT NULL"),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    prompt_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_prompts.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="DRAFT", server_default="DRAFT"
    )
    template_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    template_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    change_summary: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=""
    )
    revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ContentHumanizationPrompt(Base):
    """管理员显式维护的全局唯一自然化 Prompt。"""

    __tablename__ = "content_humanization_prompts"
    __table_args__ = (CheckConstraint("id = 1", name="ck_content_humanization_prompts_singleton"),)
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    template_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class PlatformProfile(Base):
    """平台稳定身份和允许域名集合。"""

    __tablename__ = "platform_profiles"
    __table_args__ = (
        CheckConstraint(
            "logo_file_id IS NULL OR logo_external_url IS NULL",
            name="ck_platform_profiles_logo_single_source",
        ),
        CheckConstraint(
            "platform_prompt_version_id IS NULL OR platform_prompt_id IS NOT NULL",
            name=conv("ck_platform_profiles_prompt_version_requires_prompt"),
        ),
        CheckConstraint(
            "health_check_interval_hours BETWEEN 1 AND 720",
            name=conv("ck_platform_profiles_health_interval"),
        ),
        CheckConstraint(
            "health_check_anomaly_threshold BETWEEN 1 AND 10",
            name=conv("ck_platform_profiles_health_threshold"),
        ),
        Index(
            "ix_platform_profiles_prompt_version",
            "platform_prompt_version_id",
            postgresql_where=text("platform_prompt_version_id IS NOT NULL"),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    allowed_domains: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    platform_type_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_types.id", ondelete="RESTRICT")
    )
    platform_prompt_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_prompts.id", ondelete="RESTRICT")
    )
    platform_prompt_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_prompt_versions.id", ondelete="RESTRICT")
    )
    website_url: Mapped[str | None] = mapped_column(Text)
    logo_file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("file_records.id", ondelete="RESTRICT")
    )
    logo_external_url: Mapped[str | None] = mapped_column(Text)
    health_check_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    health_check_interval_hours: Mapped[int] = mapped_column(
        Integer, nullable=False, default=24, server_default="24"
    )
    health_check_anomaly_threshold: Mapped[int] = mapped_column(
        Integer, nullable=False, default=2, server_default="2"
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
