"""GEO 监测身份及当前别名、域名字典的持久化映射。"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
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
from sqlalchemy.schema import conv

from app.db import Base
from app.models.base import new_uuid


class GeoSubject(Base):
    """监测身份聚合；自有产品名称从 Product 读取，子字典共享此 revision。"""

    __tablename__ = "geo_subjects"
    __table_args__ = (
        CheckConstraint(
            "subject_type IN ('OWN_BRAND', 'OWN_PRODUCT', 'COMPETITOR_BRAND', "
            "'COMPETITOR_PRODUCT', 'REFERENCE_PART')",
            name=conv("ck_geo_subjects_type"),
        ),
        CheckConstraint(
            "(subject_type = 'OWN_PRODUCT' AND product_id IS NOT NULL "
            "AND canonical_name IS NULL AND normalized_name IS NULL AND display_name IS NULL) "
            "OR (subject_type <> 'OWN_PRODUCT' AND product_id IS NULL "
            "AND canonical_name IS NOT NULL AND normalized_name IS NOT NULL "
            "AND display_name IS NOT NULL)",
            name=conv("ck_geo_subjects_product_identity"),
        ),
        CheckConstraint(
            "(canonical_name IS NULL OR (length(btrim(canonical_name)) > 0 "
            "AND length(canonical_name) BETWEEN 1 AND 240)) "
            "AND (normalized_name IS NULL OR (length(btrim(normalized_name)) > 0 "
            "AND length(normalized_name) BETWEEN 1 AND 240)) "
            "AND (display_name IS NULL OR (length(btrim(display_name)) > 0 "
            "AND length(display_name) BETWEEN 1 AND 240)) "
            "AND length(description) <= 4000",
            name=conv("ck_geo_subjects_names"),
        ),
        CheckConstraint("revision >= 0", name=conv("ck_geo_subjects_revision_nonnegative")),
        CheckConstraint(
            "(parent_subject_id IS NULL AND parent_subject_type IS NULL) "
            "OR (parent_subject_id IS NOT NULL AND parent_subject_type IS NOT NULL "
            "AND ((subject_type = 'OWN_PRODUCT' AND parent_subject_type = 'OWN_BRAND') "
            "OR (subject_type = 'COMPETITOR_PRODUCT' "
            "AND parent_subject_type = 'COMPETITOR_BRAND')))",
            name=conv("ck_geo_subjects_parent_type"),
        ),
        CheckConstraint(
            "parent_subject_id IS NULL OR parent_subject_id <> id",
            name=conv("ck_geo_subjects_parent_not_self"),
        ),
        UniqueConstraint("id", "subject_type", name="uq_geo_subjects_id_type"),
        ForeignKeyConstraint(
            ["parent_subject_id", "parent_subject_type"],
            ["geo_subjects.id", "geo_subjects.subject_type"],
            name="fk_geo_subjects_parent_identity",
            match="FULL",
            ondelete="RESTRICT",
            onupdate="RESTRICT",
        ),
        Index(
            "uq_geo_subjects_active_own_product",
            "product_id",
            unique=True,
            postgresql_where=text("subject_type = 'OWN_PRODUCT' AND is_active"),
        ),
        Index(
            "ix_geo_subjects_type_active_name_id",
            "subject_type",
            "is_active",
            "normalized_name",
            "id",
        ),
        Index(
            "ix_geo_subjects_product_id",
            "product_id",
            postgresql_where=text("product_id IS NOT NULL"),
        ),
        Index("ix_geo_subjects_parent_id", "parent_subject_id"),
        Index("ix_geo_subjects_created_by", "created_by"),
        Index("ix_geo_subjects_updated_id", "updated_at", "id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    subject_type: Mapped[str] = mapped_column(String(32), nullable=False)
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", name="fk_geo_subjects_product_id_products", ondelete="RESTRICT"),
    )
    parent_subject_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    parent_subject_type: Mapped[str | None] = mapped_column(String(32))
    canonical_name: Mapped[str | None] = mapped_column(String(240))
    normalized_name: Mapped[str | None] = mapped_column(String(240))
    display_name: Mapped[str | None] = mapped_column(String(240))
    description: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=text("''")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_geo_subjects_created_by_users", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class GeoSubjectAlias(Base):
    """当前识别字典；停用别名仍占有同一 Subject 的规范键。"""

    __tablename__ = "geo_subject_aliases"
    __table_args__ = (
        UniqueConstraint(
            "subject_id", "normalized_alias", name="uq_geo_subject_aliases_subject_normalized"
        ),
        CheckConstraint(
            "alias_kind IN ('NAME', 'PART_NUMBER', 'ABBREVIATION', 'LEGACY')",
            name=conv("ck_geo_subject_aliases_kind"),
        ),
        CheckConstraint(
            "length(btrim(alias)) > 0 AND length(alias) BETWEEN 1 AND 240 "
            "AND length(btrim(normalized_alias)) > 0 "
            "AND length(normalized_alias) BETWEEN 1 AND 240",
            name=conv("ck_geo_subject_aliases_text"),
        ),
        CheckConstraint(
            "language_code IS NULL OR (length(language_code) BETWEEN 2 AND 16 "
            "AND language_code ~ '^[a-z]{2,8}(-[a-z0-9]{1,8})*$')",
            name=conv("ck_geo_subject_aliases_language"),
        ),
        Index(
            "ix_geo_subject_aliases_normalized_active",
            "normalized_alias",
            "is_active",
            "subject_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_subjects.id", name="fk_geo_subject_aliases_subject_id_subjects", ondelete="CASCADE"
        ),
        nullable=False,
    )
    alias: Mapped[str] = mapped_column(String(240), nullable=False)
    normalized_alias: Mapped[str] = mapped_column(String(240), nullable=False)
    alias_kind: Mapped[str] = mapped_column(String(24), nullable=False)
    language_code: Mapped[str | None] = mapped_column(String(16))
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class GeoSubjectDomain(Base):
    """精确主机名归属字典；配置关系不证明域名所有权。"""

    __tablename__ = "geo_subject_domains"
    __table_args__ = (
        UniqueConstraint("subject_id", "hostname", name="uq_geo_subject_domains_subject_hostname"),
        CheckConstraint(
            "relation_type IN ('OWNED', 'OFFICIAL', 'DISTRIBUTOR', 'OTHER')",
            name=conv("ck_geo_subject_domains_relation"),
        ),
        CheckConstraint(
            "length(hostname) BETWEEN 3 AND 253 "
            "AND hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+"
            "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' "
            "AND hostname !~ '^([0-9]+[.]){3}[0-9]+$'",
            name=conv("ck_geo_subject_domains_hostname"),
        ),
        CheckConstraint("is_active = true", name=conv("ck_geo_subject_domains_active")),
        Index("ix_geo_subject_domains_hostname", "hostname", "subject_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_subjects.id", name="fk_geo_subject_domains_subject_id_subjects", ondelete="CASCADE"
        ),
        nullable=False,
    )
    hostname: Mapped[str] = mapped_column(String(253), nullable=False)
    relation_type: Mapped[str] = mapped_column(String(24), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
