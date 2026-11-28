"""产品及其 Markdown 事实版本与审核记录 ORM 映射。"""

from __future__ import annotations

import uuid
from datetime import datetime

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
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import new_uuid


class Product(Base):
    """公司产品的稳定身份。"""

    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("normalized_brand", "normalized_part_number"),
        CheckConstraint("revision >= 0", name="revision_nonnegative"),
        CheckConstraint(
            "facts_classification IN ('PUBLIC', 'INTERNAL', 'RESTRICTED')",
            name="ck_products_facts_classification",
        ),
        CheckConstraint(
            "source_owner IS NULL OR (length(btrim(source_owner)) BETWEEN 1 AND 160 "
            "AND source_owner !~ '^[[:space:]]|[[:space:]]$')",
            name="ck_products_source_owner_trimmed",
        ),
        CheckConstraint(
            "(last_reviewed_at IS NULL) = (last_reviewed_by IS NULL)",
            name="ck_products_last_review_pair",
        ),
        CheckConstraint(
            "facts_source_reference IS NULL OR (length(btrim(facts_source_reference)) "
            "BETWEEN 1 AND 500 AND facts_source_reference !~ '^[[:space:]]|[[:space:]]$')",
            name="ck_products_facts_source_reference_bounds",
        ),
        CheckConstraint(
            "facts_applicable_region IS NULL OR (length(btrim(facts_applicable_region)) "
            "BETWEEN 1 AND 160 AND facts_applicable_region !~ '^[[:space:]]|[[:space:]]$')",
            name="ck_products_facts_applicable_region_bounds",
        ),
        CheckConstraint(
            "facts_content_restrictions IS NULL OR (length(btrim(facts_content_restrictions)) "
            "BETWEEN 1 AND 4000 AND facts_content_restrictions !~ '^[[:space:]]|[[:space:]]$')",
            name="ck_products_facts_content_restrictions_bounds",
        ),
        CheckConstraint(
            "facts_approved_claims_summary IS NULL OR "
            "(length(btrim(facts_approved_claims_summary)) BETWEEN 1 AND 4000 "
            "AND facts_approved_claims_summary !~ '^[[:space:]]|[[:space:]]$')",
            name="ck_products_facts_approved_claims_summary_bounds",
        ),
        Index(
            "ix_products_next_review_at",
            "next_review_at",
            postgresql_where=text("next_review_at IS NOT NULL"),
        ),
        Index(
            "ix_products_last_reviewed_by",
            "last_reviewed_by",
            postgresql_where=text("last_reviewed_by IS NOT NULL"),
        ),
        CheckConstraint("length(summary) <= 2000", name="summary_len"),
        CheckConstraint(
            "datasheet_url IS NULL OR (length(datasheet_url) <= 2000 "
            "AND datasheet_url ~ '^https?://[^[:space:]]+$')",
            name="datasheet_url",
        ),
        CheckConstraint(
            "(facts_updated_at IS NULL) = (facts_updated_by IS NULL)",
            name="facts_updated_pair",
        ),
        Index(
            "ix_products_facts_updated_by",
            "facts_updated_by",
            postgresql_where=text("facts_updated_by IS NOT NULL"),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    part_number: Mapped[str] = mapped_column(String(160), nullable=False)
    normalized_part_number: Mapped[str] = mapped_column(String(160), nullable=False)
    brand: Mapped[str] = mapped_column(String(160), nullable=False)
    normalized_brand: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    facts_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    facts_body_markdown: Mapped[str] = mapped_column(Text, nullable=False, default="")
    facts_classification: Mapped[str] = mapped_column(
        String(16), nullable=False, default="RESTRICTED"
    )
    source_owner: Mapped[str | None] = mapped_column(String(160))
    next_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    facts_source_reference: Mapped[str | None] = mapped_column(Text)
    facts_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    facts_applicable_region: Mapped[str | None] = mapped_column(String(160))
    facts_content_restrictions: Mapped[str | None] = mapped_column(Text)
    facts_approved_claims_summary: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=text("''")
    )
    datasheet_url: Mapped[str | None] = mapped_column(Text)
    facts_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    facts_updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class FactVersion(Base):
    """冻结的 Markdown 事实版本；管理员可在无业务引用时物理删除。"""

    __tablename__ = "fact_versions"
    __table_args__ = (
        UniqueConstraint("product_id", "version"),
        CheckConstraint(
            "classification IN ('PUBLIC', 'INTERNAL', 'RESTRICTED')",
            name="ck_fact_versions_classification",
        ),
        CheckConstraint(
            "status IN ('PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'RETIRED')",
            name="ck_fact_versions_status_business_workflow",
        ),
        CheckConstraint(
            "source_reference IS NULL OR (length(btrim(source_reference)) BETWEEN 1 AND 500 "
            "AND source_reference !~ '^[[:space:]]|[[:space:]]$')",
            name="ck_fact_versions_source_reference_bounds",
        ),
        CheckConstraint(
            "applicable_region IS NULL OR (length(btrim(applicable_region)) BETWEEN 1 AND 160 "
            "AND applicable_region !~ '^[[:space:]]|[[:space:]]$')",
            name="ck_fact_versions_applicable_region_bounds",
        ),
        CheckConstraint(
            "content_restrictions IS NULL OR (length(btrim(content_restrictions)) "
            "BETWEEN 1 AND 4000 AND content_restrictions !~ '^[[:space:]]|[[:space:]]$')",
            name="ck_fact_versions_content_restrictions_bounds",
        ),
        CheckConstraint(
            "approved_claims_summary IS NULL OR (length(btrim(approved_claims_summary)) "
            "BETWEEN 1 AND 4000 AND approved_claims_summary !~ '^[[:space:]]|[[:space:]]$')",
            name="ck_fact_versions_approved_claims_summary_bounds",
        ),
        Index(
            "uq_fact_versions_one_pending_per_product",
            "product_id",
            unique=True,
            postgresql_where=text("status = 'PENDING_REVIEW'"),
        ),
        CheckConstraint(
            "priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')",
            name="priority",
        ),
        CheckConstraint(
            "blocked_reason IS NULL OR (length(btrim(blocked_reason)) BETWEEN 1 AND 500 "
            "AND blocked_reason !~ '^[[:space:]]|[[:space:]]$')",
            name="blocked_reason_bounds",
        ),
        CheckConstraint(
            "(assignee_id IS NULL AND assigned_by IS NULL AND assigned_at IS NULL) "
            "OR (assignee_id IS NOT NULL AND assigned_by IS NOT NULL AND assigned_at IS NOT NULL)",
            name="assignment_pair",
        ),
        Index(
            "ix_fact_versions_assignee_due",
            "assignee_id",
            "due_at",
            postgresql_where=text("assignee_id IS NOT NULL"),
        ),
        Index(
            "ix_fact_versions_assigned_by",
            "assigned_by",
            postgresql_where=text("assigned_by IS NOT NULL"),
        ),
        Index(
            "ix_fact_versions_due_at",
            "due_at",
            postgresql_where=text("due_at IS NOT NULL"),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING_REVIEW")
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    classification: Mapped[str] = mapped_column(String(16), nullable=False)
    source_reference: Mapped[str | None] = mapped_column(Text)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    applicable_region: Mapped[str | None] = mapped_column(String(160))
    content_restrictions: Mapped[str | None] = mapped_column(Text)
    approved_claims_summary: Mapped[str | None] = mapped_column(Text)
    change_summary: Mapped[str] = mapped_column(Text, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    priority: Mapped[str] = mapped_column(
        String(16), nullable=False, default="MEDIUM", server_default="MEDIUM"
    )
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    blocked_reason: Mapped[str | None] = mapped_column(Text)
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FactReviewRecord(Base):
    """追加式事实审核命令记录，随管理员删除父事实版本而清理。"""

    __tablename__ = "fact_review_records"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    fact_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_versions.id", ondelete="RESTRICT"), nullable=False
    )
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
