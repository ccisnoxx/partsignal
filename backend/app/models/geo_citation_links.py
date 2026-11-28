"""Slice 1C：引用到文章发布记录的分级归因模型（绝不原地篡改 geo_answer_citations）。"""

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
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base
from app.models.base import new_uuid


class GeoCitationPublicationLink(Base):
    """回答引用 URL 与统一文章发布台账的分级归因关系。"""

    __tablename__ = "geo_citation_publication_links"
    __table_args__ = (
        UniqueConstraint("citation_id", "article_publication_id", name="uq_geo_cpl_citation_pub"),
        CheckConstraint(
            "match_method IN ('EXACT_NORMALIZED_URL','STRIPPED_TRACKING_CANDIDATE',"
            "'SAME_DOMAIN_CANDIDATE','MANUAL_SELECTED')",
            name=conv("ck_geo_cpl_method"),
        ),
        CheckConstraint(
            "link_status IN ('AUTO_EXACT','CANDIDATE','CONFIRMED','REJECTED')",
            name=conv("ck_geo_cpl_status"),
        ),
        CheckConstraint("length(match_reason) <= 500", name=conv("ck_geo_cpl_reason_len")),
        CheckConstraint("revision >= 0", name=conv("ck_geo_cpl_rev")),
        CheckConstraint(
            "(link_status IN ('CONFIRMED','REJECTED') AND confirmed_by IS NOT NULL "
            "AND confirmed_at IS NOT NULL) "
            "OR (link_status IN ('AUTO_EXACT','CANDIDATE') AND confirmed_by IS NULL "
            "AND confirmed_at IS NULL)",
            name=conv("ck_geo_cpl_confirm_pair"),
        ),
        CheckConstraint(
            "(match_method = 'EXACT_NORMALIZED_URL' "
            "AND link_status IN ('AUTO_EXACT','CONFIRMED','REJECTED')) "
            "OR (match_method IN ('STRIPPED_TRACKING_CANDIDATE','SAME_DOMAIN_CANDIDATE') "
            "AND link_status IN ('CANDIDATE','CONFIRMED','REJECTED')) "
            "OR (match_method = 'MANUAL_SELECTED' AND link_status IN ('CONFIRMED','REJECTED'))",
            name=conv("ck_geo_cpl_method_status"),
        ),
        Index(
            "uq_geo_cpl_one_effective_per_citation",
            "citation_id",
            unique=True,
            postgresql_where=text("link_status IN ('AUTO_EXACT','CONFIRMED')"),
        ),
        Index("ix_geo_cpl_article_pub", "article_publication_id", "link_status"),
        Index(
            "ix_geo_cpl_confirmed_by",
            "confirmed_by",
            postgresql_where=text("confirmed_by IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    citation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_answer_citations.id", name="fk_geo_cpl_citation", ondelete="RESTRICT"),
        nullable=False,
    )
    article_publication_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("article_publications.id", name="fk_geo_cpl_article_pub", ondelete="RESTRICT"),
        nullable=False,
    )
    match_method: Mapped[str] = mapped_column(String(32), nullable=False)
    link_status: Mapped[str] = mapped_column(String(24), nullable=False)
    match_reason: Mapped[str] = mapped_column(
        String(500), nullable=False, default="", server_default=text("''")
    )
    confirmed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_geo_cpl_confirmed_by", ondelete="RESTRICT"),
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
