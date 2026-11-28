"""Slice 1B：统一文章与多 URL 发布台账、产品资料附件及轻量 AI 生成快照 ORM 映射。"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base
from app.models.base import new_uuid


class ProductMaterialAttachment(Base):
    """产品数据手册等资料附件关联。"""

    __tablename__ = "product_material_attachments"
    __table_args__ = (
        CheckConstraint("length(display_label) <= 200", name=conv("ck_product_materials_label")),
        Index("ix_product_materials_creator", "created_by"),
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", name="fk_product_materials_product", ondelete="RESTRICT"),
        primary_key=True,
    )
    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("file_records.id", name="fk_product_materials_file", ondelete="RESTRICT"),
        primary_key=True,
    )
    display_label: Mapped[str] = mapped_column(
        String(200), nullable=False, default="", server_default=text("''")
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_product_materials_creator", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Article(Base):
    """统一文章台账：承载外部 AI/人工直录与系统内 AI 确认稿，支持 1:N 多平台 URL。"""

    __tablename__ = "articles"
    __table_args__ = (
        CheckConstraint("length(btrim(title)) BETWEEN 1 AND 300", name=conv("ck_articles_title")),
        CheckConstraint("length(summary) <= 2000", name=conv("ck_articles_summary")),
        CheckConstraint(
            "body_markdown ~ '[^[:space:]]' AND length(body_markdown) <= 524288",
            name=conv("ck_articles_body"),
        ),
        CheckConstraint(
            "origin_type IN ('EXTERNAL_AI', 'HUMAN', 'SYSTEM_AI', 'OTHER')",
            name=conv("ck_articles_origin_type"),
        ),
        CheckConstraint(
            "(origin_type = 'EXTERNAL_AI' AND (external_model_name IS NULL "
            "OR length(btrim(external_model_name)) BETWEEN 1 AND 160)) "
            "OR (origin_type <> 'EXTERNAL_AI' AND external_model_name IS NULL)",
            name=conv("ck_articles_external_model"),
        ),
        CheckConstraint(
            "status IN ('DRAFT', 'READY', 'PUBLISHED', 'ARCHIVED')",
            name=conv("ck_articles_status"),
        ),
        CheckConstraint("current_revision >= 1", name=conv("ck_articles_current_rev")),
        CheckConstraint("revision >= 0", name=conv("ck_articles_opt_rev")),
        CheckConstraint(
            "parent_article_id IS NULL OR parent_article_id <> id",
            name=conv("ck_articles_parent_not_self"),
        ),
        CheckConstraint(
            "origin_type IN ('SYSTEM_AI', 'HUMAN') "
            "OR (source_content_task_id IS NULL AND source_content_version_id IS NULL)",
            name=conv("ck_articles_source_task_origin"),
        ),
        Index(
            "uq_articles_source_task",
            "source_content_task_id",
            unique=True,
            postgresql_where=text("source_content_task_id IS NOT NULL"),
        ),
        Index(
            "ix_articles_product_status",
            "product_id",
            "status",
            text("updated_at DESC"),
            "id",
        ),
        Index("ix_articles_owner", "owner_id"),
        Index("ix_articles_creator", "created_by"),
        Index("ix_articles_updater", "updated_by"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", name="fk_articles_product", ondelete="RESTRICT"),
        nullable=False,
    )
    parent_article_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("articles.id", name="fk_articles_parent", ondelete="RESTRICT"),
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=text("''")
    )
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    target_keywords: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default=text("'{}'::text[]")
    )
    origin_type: Mapped[str] = mapped_column(String(24), nullable=False)
    external_model_name: Mapped[str | None] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="DRAFT", server_default="DRAFT"
    )
    current_revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_articles_owner", ondelete="RESTRICT"),
        nullable=False,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_articles_creator", ondelete="RESTRICT"),
        nullable=False,
    )
    updated_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_articles_updater", ondelete="RESTRICT"),
        nullable=False,
    )
    source_content_task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("content_tasks.id", name="fk_articles_content_task", ondelete="SET NULL"),
    )
    source_content_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("content_versions.id", name="fk_articles_content_version", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ArticleRevision(Base):
    """追加式不可变文章正文历史快照。"""

    __tablename__ = "article_revisions"
    __table_args__ = (
        UniqueConstraint("article_id", "revision_no", name="uq_article_revisions_article_no"),
        CheckConstraint("revision_no >= 1", name=conv("ck_article_revisions_no")),
        Index("ix_article_revisions_creator", "created_by"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    article_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("articles.id", name="fk_article_revisions_article", ondelete="RESTRICT"),
        nullable=False,
    )
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    change_summary: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=text("''")
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_article_revisions_creator", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ArticlePublication(Base):
    """统一 1:N 发布台账，区分“已人工登记”与“已核验通过”并作为引用归因唯一目标。"""

    __tablename__ = "article_publications"
    __table_args__ = (
        CheckConstraint(
            "length(btrim(platform_name_snapshot)) BETWEEN 1 AND 160",
            name=conv("ck_article_publications_platform_name"),
        ),
        CheckConstraint(
            "length(btrim(actual_title)) BETWEEN 1 AND 300",
            name=conv("ck_article_publications_title"),
        ),
        CheckConstraint(
            "length(final_url) <= 2083 AND final_url ~ '^https?://[^[:space:]]+$'",
            name=conv("ck_article_publications_url"),
        ),
        CheckConstraint(
            "registration_status IN ('REGISTERED', 'REMOVED')",
            name=conv("ck_article_publications_reg_status"),
        ),
        CheckConstraint(
            "verification_status IN ('UNVERIFIED', 'VERIFIED', 'ISSUE_OPEN')",
            name=conv("ck_article_publications_ver_status"),
        ),
        CheckConstraint("length(notes) <= 2000", name=conv("ck_article_publications_notes")),
        CheckConstraint("revision >= 0", name=conv("ck_article_publications_rev")),
        CheckConstraint(
            "(verification_status = 'UNVERIFIED' AND verified_at IS NULL AND verified_by IS NULL) "
            "OR (verification_status IN ('VERIFIED', 'ISSUE_OPEN') "
            "AND verified_at IS NOT NULL AND verified_by IS NOT NULL)",
            name=conv("ck_article_publications_verified_fact"),
        ),
        Index(
            "uq_article_publications_source_published",
            "source_published_article_id",
            unique=True,
            postgresql_where=text("source_published_article_id IS NOT NULL"),
        ),
        Index(
            "uq_article_publications_active_url",
            "normalized_url",
            unique=True,
            postgresql_where=text("registration_status = 'REGISTERED'"),
        ),
        Index("ix_article_publications_hostname_active", "hostname", "registration_status"),
        Index(
            "ix_article_publications_article_published",
            "article_id",
            text("published_at DESC"),
            "id",
        ),
        Index("ix_article_publications_registrar", "registered_by"),
        Index(
            "ix_article_publications_verifier",
            "verified_by",
            postgresql_where=text("verified_by IS NOT NULL"),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    article_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("articles.id", name="fk_article_publications_article", ondelete="RESTRICT"),
        nullable=False,
    )
    article_revision_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "article_revisions.id", name="fk_article_publications_article_rev", ondelete="RESTRICT"
        ),
        nullable=False,
    )
    platform_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "platform_profiles.id", name="fk_article_publications_platform", ondelete="SET NULL"
        ),
    )
    platform_name_snapshot: Mapped[str] = mapped_column(String(160), nullable=False)
    platform_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "platform_accounts.id", name="fk_article_publications_account", ondelete="SET NULL"
        ),
    )
    platform_account_label_snapshot: Mapped[str | None] = mapped_column(String(160))
    actual_title: Mapped[str] = mapped_column(Text, nullable=False)
    final_url: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_url: Mapped[str] = mapped_column(Text, nullable=False)
    hostname: Mapped[str] = mapped_column(String(253), nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    registration_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="REGISTERED", server_default="REGISTERED"
    )
    verification_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="UNVERIFIED", server_default="UNVERIFIED"
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_article_publications_verifier", ondelete="RESTRICT"),
    )
    source_published_article_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "published_articles.id", name="fk_article_publications_legacy_pub", ondelete="SET NULL"
        ),
    )
    screenshot_file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "file_records.id", name="fk_article_publications_screenshot", ondelete="RESTRICT"
        ),
    )
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    registered_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_article_publications_registrar", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ArticlePublicationEvent(Base):
    """发布台账追加式不可变变更事件。"""

    __tablename__ = "article_publication_events"
    __table_args__ = (
        CheckConstraint(
            "action IN ('REGISTERED', 'UPDATED', 'MARKED_REMOVED', "
            "'VERIFIED_SYNCED', 'ISSUE_SYNCED')",
            name=conv("ck_article_pub_events_action"),
        ),
        Index(
            "ix_article_pub_events_pub_created",
            "article_publication_id",
            text("created_at DESC"),
            "id",
        ),
        Index("ix_article_pub_events_actor", "actor_id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    article_publication_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "article_publications.id", name="fk_article_pub_events_pub", ondelete="RESTRICT"
        ),
        nullable=False,
    )
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    snapshot_payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    comment: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=text("''")
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_article_pub_events_actor", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ArticleAiGenerationSnapshot(Base):
    """基于产品 PUBLIC 资料直接 AI 生成草稿的后台不可变追溯快照。"""

    __tablename__ = "article_ai_generation_snapshots"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_article_ai_snap_idempotency"),
        CheckConstraint(
            "product_facts_classification = 'PUBLIC'",
            name=conv("ck_article_ai_snap_public"),
        ),
        CheckConstraint(
            "(cost_amount IS NULL AND cost_currency IS NULL) "
            "OR (cost_amount IS NOT NULL AND cost_currency IS NOT NULL "
            "AND cost_amount >= 0 AND cost_currency ~ '^[A-Z]{3}$')",
            name=conv("ck_article_ai_snap_cost_pair"),
        ),
        Index("ix_article_ai_snap_article", "article_id"),
        Index("ix_article_ai_snap_creator", "created_by"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    article_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("articles.id", name="fk_article_ai_snap_article", ondelete="RESTRICT"),
        nullable=False,
    )
    article_revision_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("article_revisions.id", name="fk_article_ai_snap_rev", ondelete="RESTRICT"),
        nullable=False,
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", name="fk_article_ai_snap_product", ondelete="RESTRICT"),
        nullable=False,
    )
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    product_facts_classification: Mapped[str] = mapped_column(String(16), nullable=False)
    product_facts_markdown_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_template_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "platform_prompt_versions.id", name="fk_article_ai_snap_prompt", ondelete="SET NULL"
        ),
    )
    rendered_messages_snapshot: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    ai_channel_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ai_channels.id", name="fk_article_ai_snap_channel", ondelete="SET NULL"),
    )
    ai_model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ai_models.id", name="fk_article_ai_snap_model", ondelete="SET NULL"),
    )
    provider_model_snapshot: Mapped[str] = mapped_column(String(200), nullable=False)
    cost_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 6))
    cost_currency: Mapped[str | None] = mapped_column(String(8))
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_article_ai_snap_creator", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
