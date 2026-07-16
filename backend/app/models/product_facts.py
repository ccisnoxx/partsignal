"""产品、规范化事实与事实审核 ORM 映射。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import new_uuid


class Product(Base):
    """公司产品的稳定身份。"""

    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("normalized_brand", "normalized_part_number"),
        CheckConstraint("revision >= 0", name="revision_nonnegative"),
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ReferencePart(Base):
    """事实工作区中的外部参考型号。"""

    __tablename__ = "reference_parts"
    __table_args__ = (
        UniqueConstraint("product_id", "client_key", name="uq_reference_parts_product_client_key"),
        UniqueConstraint(
            "product_id",
            "normalized_manufacturer",
            "normalized_part_number",
            name="uq_reference_parts_product_identity",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    client_key: Mapped[str] = mapped_column(String(120), nullable=False)
    part_number: Mapped[str] = mapped_column(String(160), nullable=False)
    normalized_part_number: Mapped[str] = mapped_column(String(160), nullable=False)
    manufacturer: Mapped[str] = mapped_column(String(160), nullable=False)
    normalized_manufacturer: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(160), nullable=False)


class Evidence(Base):
    """事实证据元数据，文件内容由文件模块持有。"""

    __tablename__ = "evidences"
    __table_args__ = (UniqueConstraint("product_id", "client_key"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    client_key: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    version: Mapped[str] = mapped_column(String(100), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    # use_alter 允许 0008 在文件表创建后补加跨里程碑外键。
    file_record_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "file_records.id",
            ondelete="RESTRICT",
            use_alter=True,
            name="fk_evidences_file_record_id_file_records",
        ),
    )
    confidentiality: Mapped[str] = mapped_column(String(32), nullable=False)


class PartParameter(Base):
    """公司产品或一个参考型号的结构化参数。"""

    __tablename__ = "part_parameters"
    __table_args__ = (
        UniqueConstraint("product_id", "client_key"),
        CheckConstraint(
            "(owner_product_id IS NOT NULL)::int + (reference_part_id IS NOT NULL)::int = 1",
            name="exactly_one_owner",
        ),
        CheckConstraint(
            "owner_product_id IS NULL OR owner_product_id = product_id",
            name="product_owner_matches_aggregate",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    owner_product_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE")
    )
    reference_part_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reference_parts.id", ondelete="CASCADE")
    )
    client_key: Mapped[str] = mapped_column(String(120), nullable=False)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    value_type: Mapped[str] = mapped_column(String(24), nullable=False)
    min_value: Mapped[float | None] = mapped_column(Float)
    typical_value: Mapped[float | None] = mapped_column(Float)
    max_value: Mapped[float | None] = mapped_column(Float)
    text_value: Mapped[str | None] = mapped_column(Text)
    unit: Mapped[str] = mapped_column(String(80), nullable=False)
    test_conditions: Mapped[str] = mapped_column(Text, nullable=False)
    is_critical: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class ReplacementRelation(Base):
    """公司产品对参考型号的人工判定替代关系。"""

    __tablename__ = "replacement_relations"
    __table_args__ = (UniqueConstraint("product_id", "client_key"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    reference_part_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reference_parts.id", ondelete="CASCADE"), nullable=False
    )
    client_key: Mapped[str] = mapped_column(String(120), nullable=False)
    replacement_level: Mapped[str] = mapped_column(String(60), nullable=False)
    conditions: Mapped[str] = mapped_column(Text, nullable=False)
    exclusions: Mapped[str] = mapped_column(Text, nullable=False)


class FactClaim(Base):
    """允许、禁止或强制披露的事实表达。"""

    __tablename__ = "fact_claims"
    __table_args__ = (UniqueConstraint("product_id", "client_key"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    client_key: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)


class ParameterEvidenceLink(Base):
    """参数与证据的关联。"""

    __tablename__ = "parameter_evidence_links"
    parameter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("part_parameters.id", ondelete="CASCADE"), primary_key=True
    )
    evidence_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidences.id", ondelete="CASCADE"), primary_key=True
    )


class ReplacementEvidenceLink(Base):
    """替代关系与证据的关联。"""

    __tablename__ = "replacement_evidence_links"
    replacement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("replacement_relations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    evidence_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidences.id", ondelete="CASCADE"), primary_key=True
    )


class ClaimEvidenceLink(Base):
    """事实表达与证据的关联。"""

    __tablename__ = "claim_evidence_links"
    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_claims.id", ondelete="CASCADE"), primary_key=True
    )
    evidence_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidences.id", ondelete="CASCADE"), primary_key=True
    )


class FactVersion(Base):
    """服务端构造的冻结事实快照；管理员可在无业务引用时物理删除。"""

    __tablename__ = "fact_versions"
    __table_args__ = (UniqueConstraint("product_id", "version"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
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
