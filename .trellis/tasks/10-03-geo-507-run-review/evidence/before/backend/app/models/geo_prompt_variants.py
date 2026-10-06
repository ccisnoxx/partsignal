"""QueryTopic 下的问题变体；历史语义由数据库引用锁存保护。"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
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
from sqlalchemy.schema import conv

from app.db import Base
from app.models.base import new_uuid


class GeoPromptVariant(Base):
    __tablename__ = "geo_prompt_variants"
    __table_args__ = (
        UniqueConstraint(
            "query_topic_id",
            "normalized_hash",
            "mention_mode",
            "language_code",
            "region_code",
            name="uq_geo_prompt_variants_identity",
        ),
        CheckConstraint(
            "length(prompt_text) BETWEEN 1 AND 8000 "
            "AND prompt_text = geo_normalize_prompt_text(prompt_text)",
            name=conv("ck_geo_prompt_variants_prompt"),
        ),
        CheckConstraint(
            "mention_mode IN ('BRANDED', 'UNBRANDED')",
            name=conv("ck_geo_prompt_variants_mention_mode"),
        ),
        CheckConstraint(
            "length(language_code) BETWEEN 2 AND 16 "
            "AND language_code ~ '^[a-z]{2,8}(-[a-z0-9]{1,8})*$'",
            name=conv("ck_geo_prompt_variants_language"),
        ),
        CheckConstraint(
            "region_code ~ '^[A-Z]{2}$' AND length(region_code) = 2",
            name=conv("ck_geo_prompt_variants_region"),
        ),
        CheckConstraint(
            "priority IN ('CORE', 'STANDARD', 'EXPLORATORY')",
            name=conv("ck_geo_prompt_variants_priority"),
        ),
        CheckConstraint("revision >= 0", name=conv("ck_geo_prompt_variants_revision_nonnegative")),
        CheckConstraint(
            "first_referenced_at IS NULL OR first_referenced_at >= created_at",
            name=conv("ck_geo_prompt_variants_reference_time"),
        ),
        Index("ix_geo_prompt_variants_topic_active", "query_topic_id", "is_active"),
        Index("ix_geo_prompt_variants_created_by", "created_by"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    query_topic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("query_topics.id", name="fk_geo_prompt_variants_topic", ondelete="RESTRICT"),
        nullable=False,
    )
    prompt_text: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_hash: Mapped[str] = mapped_column(
        String(64),
        Computed("geo_prompt_text_hash(prompt_text)", persisted=True),
        nullable=False,
    )
    mention_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    language_code: Mapped[str] = mapped_column(String(16), nullable=False)
    region_code: Mapped[str] = mapped_column(String(16), nullable=False)
    priority: Mapped[str] = mapped_column(String(16), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    first_referenced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_geo_prompt_variants_creator", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
