"""revision 执行元数据与不可变引用分类；业务状态仍由 AnalysisRevision 拥有。"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base


class GeoAnalysisJob(Base):
    __tablename__ = "geo_analysis_jobs"
    __table_args__ = (
        CheckConstraint(
            "(lease_token IS NULL) = (lease_expires_at IS NULL) AND "
            "(lease_token IS NULL OR (claimed_at IS NOT NULL AND lease_expires_at > claimed_at))",
            name=conv("ck_geo_analysis_jobs_lease"),
        ),
        CheckConstraint(
            "dispatch_attempt_count >= 0 AND ((dispatch_attempt_count = 0) = "
            "(last_dispatch_attempt_at IS NULL))",
            name=conv("ck_geo_analysis_jobs_dispatch"),
        ),
        Index(
            "ix_geo_analysis_jobs_expiry",
            "lease_expires_at",
            postgresql_where=text("lease_token IS NOT NULL"),
        ),
        Index("ix_geo_analysis_jobs_dispatch", "last_dispatch_attempt_at", "analysis_revision_id"),
    )
    analysis_revision_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_analysis_revisions.id", name="fk_geo_analysis_jobs_revision", ondelete="RESTRICT"
        ),
        primary_key=True,
    )
    lease_token: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_dispatch_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dispatch_attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")


class GeoCitationClassification(Base):
    __tablename__ = "geo_citation_classifications"
    __table_args__ = (
        CheckConstraint(
            "source_category IN ('OWNED','COMPETITOR','INDUSTRY_MEDIA','DISTRIBUTOR','COMMUNITY',"
            "'SOCIAL','SEARCH_ENGINE','ACADEMIC_OR_INSTITUTIONAL','OTHER','UNKNOWN')",
            name=conv("ck_geo_citation_classifications_category"),
        ),
        Index("ix_geo_citation_classifications_citation", "citation_id"),
        Index("ix_geo_citation_classifications_subject", "subject_id"),
    )
    analysis_revision_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_analysis_revisions.id",
            name="fk_geo_citation_classifications_revision",
            ondelete="RESTRICT",
        ),
        primary_key=True,
    )
    citation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_answer_citations.id",
            name="fk_geo_citation_classifications_citation",
            ondelete="RESTRICT",
        ),
        primary_key=True,
    )
    source_category: Mapped[str] = mapped_column(String(32), nullable=False)
    subject_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_subjects.id", name="fk_geo_citation_classifications_subject", ondelete="RESTRICT"
        ),
    )
