"""产品及其 Markdown 事实版本与审核记录 ORM 映射。"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
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
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    classification: Mapped[str] = mapped_column(String(16), nullable=False)
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
