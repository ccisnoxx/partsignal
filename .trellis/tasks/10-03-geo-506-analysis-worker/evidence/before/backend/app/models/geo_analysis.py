"""分析输入与子结果独立于原始回答；0054 保护版本和当前指针。"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base
from app.models.base import new_uuid


class GeoAnalysisRevision(Base):
    __tablename__ = "geo_analysis_revisions"
    __table_args__ = (
        UniqueConstraint("run_id", "revision", name="uq_geo_analysis_run_revision"),
        UniqueConstraint("id", "run_id", name="uq_geo_analysis_id_run"),
        CheckConstraint("revision >= 1", name=conv("ck_geo_analysis_revision")),
        CheckConstraint(
            "status IN ('PENDING','COMPLETED','FAILED')", name=conv("ck_geo_analysis_status")
        ),
        CheckConstraint(
            "analyzer_type IN ('DETERMINISTIC','HYBRID','EXTERNAL_MODEL') AND "
            "analyzer_version ~ '[^[:space:]]'",
            name=conv("ck_geo_analysis_analyzer"),
        ),
        CheckConstraint(
            "geo_analysis_input_valid(input_snapshot)", name=conv("ck_geo_analysis_input")
        ),
        CheckConstraint(
            "geo_analysis_summary_valid(confidence_summary, review_required_reasons)",
            name=conv("ck_geo_analysis_summary"),
        ),
        CheckConstraint(
            "(status = 'FAILED' AND error_code IS NOT NULL AND error_code = "
            "'ANALYSIS_FAILED' AND error_summary IS NOT NULL "
            "AND error_summary ~ '[^[:space:]]') OR (status <> 'FAILED' AND error_code IS NULL "
            "AND error_summary IS NULL)",
            name=conv("ck_geo_analysis_error"),
        ),
        CheckConstraint(
            "(status = 'PENDING') = (finished_at IS NULL) AND "
            "(finished_at IS NULL OR finished_at >= created_at) AND "
            "(status = 'COMPLETED' OR (confidence_summary IS NULL AND "
            "review_required_reasons = '[]'::jsonb))",
            name=conv("ck_geo_analysis_finish"),
        ),
        Index(
            "uq_geo_analysis_success_input",
            "run_id",
            "input_sha256",
            unique=True,
            postgresql_where=text("status = 'COMPLETED'"),
        ),
        Index("ix_geo_analysis_answer", "answer_snapshot_id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_observation_runs.id", name="fk_geo_analysis_run", ondelete="RESTRICT"),
        nullable=False,
    )
    answer_snapshot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_answer_snapshots.id", name="fk_geo_analysis_answer", ondelete="RESTRICT"),
        nullable=False,
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="PENDING")
    analyzer_type: Mapped[str] = mapped_column(String(40), nullable=False)
    analyzer_version: Mapped[str] = mapped_column(String(100), nullable=False)
    input_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    input_sha256: Mapped[str] = mapped_column(
        String(64),
        Computed(
            "geo_analysis_input_sha256(input_snapshot, analyzer_type, analyzer_version)",
            persisted=True,
        ),
        nullable=False,
    )
    confidence_summary: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    review_required_reasons: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    error_code: Mapped[str | None] = mapped_column(String(100))
    error_summary: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GeoAnalysisFactVersion(Base):
    """每个自有产品一份冻结的核验依据，RESTRICT 保存完整历史事实。"""

    __tablename__ = "geo_analysis_fact_versions"
    __table_args__ = (
        UniqueConstraint(
            "analysis_revision_id",
            "subject_id",
            "fact_version_id",
            name="uq_geo_analysis_fact_binding",
        ),
        Index("ix_geo_analysis_facts_subject", "subject_id"),
        Index("ix_geo_analysis_facts_version", "fact_version_id"),
    )
    analysis_revision_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_analysis_revisions.id", name="fk_geo_analysis_facts_analysis", ondelete="RESTRICT"
        ),
        primary_key=True,
    )
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_subjects.id", name="fk_geo_analysis_facts_subject", ondelete="RESTRICT"),
        primary_key=True,
    )
    fact_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("fact_versions.id", name="fk_geo_analysis_facts_version", ondelete="RESTRICT"),
        nullable=False,
    )


class GeoEntityMention(Base):
    __tablename__ = "geo_entity_mentions"
    __table_args__ = (
        UniqueConstraint(
            "analysis_revision_id", "subject_id", name="uq_geo_mentions_analysis_subject"
        ),
        CheckConstraint(
            "mention_count >= 1 AND (first_character_offset IS NULL OR "
            "first_character_offset >= 0)",
            name=conv("ck_geo_mentions_count"),
        ),
        CheckConstraint(
            "geo_analysis_strings_valid(matched_aliases, 240, 1, NULL)",
            name=conv("ck_geo_mentions_aliases"),
        ),
        CheckConstraint(
            "confidence IS NULL OR confidence BETWEEN 0 AND 1",
            name=conv("ck_geo_mentions_confidence"),
        ),
        Index("ix_geo_mentions_subject", "subject_id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    analysis_revision_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_analysis_revisions.id", name="fk_geo_mentions_analysis", ondelete="RESTRICT"
        ),
        nullable=False,
    )
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_subjects.id", name="fk_geo_mentions_subject", ondelete="RESTRICT"),
        nullable=False,
    )
    mention_count: Mapped[int] = mapped_column(Integer, nullable=False)
    first_character_offset: Mapped[int | None] = mapped_column(Integer)
    matched_aliases: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))


class GeoRecommendation(Base):
    __tablename__ = "geo_recommendations"
    __table_args__ = (
        UniqueConstraint(
            "analysis_revision_id", "subject_id", name="uq_geo_recommendations_analysis_subject"
        ),
        CheckConstraint(
            "recommendation IN "
            "('RECOMMENDED','CONSIDERED','NOT_RECOMMENDED','UNKNOWN') AND (rank IS "
            "NULL OR rank >= 1)",
            name=conv("ck_geo_recommendations_kind"),
        ),
        CheckConstraint(
            "rationale_excerpt IS NULL OR (length(rationale_excerpt) <= 2000 AND "
            "rationale_excerpt ~ '[^[:space:]]')",
            name=conv("ck_geo_recommendations_excerpt"),
        ),
        CheckConstraint(
            "confidence IS NULL OR confidence BETWEEN 0 AND 1",
            name=conv("ck_geo_recommendations_confidence"),
        ),
        Index("ix_geo_recommendations_subject", "subject_id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    analysis_revision_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_analysis_revisions.id", name="fk_geo_recommendations_analysis", ondelete="RESTRICT"
        ),
        nullable=False,
    )
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_subjects.id", name="fk_geo_recommendations_subject", ondelete="RESTRICT"),
        nullable=False,
    )
    recommendation: Mapped[str] = mapped_column(String(20), nullable=False)
    rank: Mapped[int | None] = mapped_column(Integer)
    rationale_excerpt: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))


class GeoClaimAssessment(Base):
    __tablename__ = "geo_claim_assessments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["analysis_revision_id", "subject_id", "fact_version_id"],
            [
                "geo_analysis_fact_versions.analysis_revision_id",
                "geo_analysis_fact_versions.subject_id",
                "geo_analysis_fact_versions.fact_version_id",
            ],
            name="fk_geo_claims_fact_binding",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "claim_kind IN "
            "('IDENTITY','PARAMETER','PACKAGE','TEMPERATURE_GRADE','CERTIFICATION','LIFECYCLE_STATUS','APPLICATION','REPLACEMENT_RELATION','COMPATIBILITY_CONDITION','OTHER')",
            name=conv("ck_geo_claims_kind"),
        ),
        CheckConstraint(
            "verdict IN ('ACCURATE','PARTIAL','INCORRECT','UNJUDGEABLE') AND "
            "severity IN ('LOW','MEDIUM','HIGH','CRITICAL')",
            name=conv("ck_geo_claims_result"),
        ),
        CheckConstraint(
            "fact_version_id IS NOT NULL OR (verdict = 'UNJUDGEABLE' AND fact_excerpt IS NULL)",
            name=conv("ck_geo_claims_evidence"),
        ),
        CheckConstraint(
            "length(claim_text) <= 2000 AND claim_text ~ '[^[:space:]]' AND "
            "length(explanation) <= 2000 AND explanation ~ '[^[:space:]]' AND "
            "(fact_excerpt IS NULL OR (length(fact_excerpt) <= 2000 AND "
            "fact_excerpt ~ '[^[:space:]]'))",
            name=conv("ck_geo_claims_text"),
        ),
        CheckConstraint(
            "confidence IS NULL OR confidence BETWEEN 0 AND 1",
            name=conv("ck_geo_claims_confidence"),
        ),
        Index("ix_geo_claims_subject_result", "subject_id", "verdict", "severity", "id"),
        Index("ix_geo_claims_analysis", "analysis_revision_id"),
        Index("ix_geo_claims_fact", "fact_version_id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    analysis_revision_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_analysis_revisions.id", name="fk_geo_claims_analysis", ondelete="RESTRICT"),
        nullable=False,
    )
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_subjects.id", name="fk_geo_claims_subject", ondelete="RESTRICT"),
        nullable=False,
    )
    fact_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("fact_versions.id", name="fk_geo_claims_fact", ondelete="RESTRICT"),
    )
    claim_kind: Mapped[str] = mapped_column(String(40), nullable=False)
    claim_text: Mapped[str] = mapped_column(Text, nullable=False)
    claim_sha256: Mapped[str] = mapped_column(
        String(64), Computed("geo_answer_sha256(claim_text)", persisted=True), nullable=False
    )
    verdict: Mapped[str] = mapped_column(String(16), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    fact_excerpt: Mapped[str | None] = mapped_column(Text)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))


class GeoRunReview(Base):
    __tablename__ = "geo_run_reviews"
    __table_args__ = (
        ForeignKeyConstraint(
            ["analysis_revision_id", "run_id"],
            ["geo_analysis_revisions.id", "geo_analysis_revisions.run_id"],
            name="fk_geo_reviews_analysis_run",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "(decision = 'CONFIRMED' AND correction_payload IS NULL) OR (decision ="
            " 'CORRECTED' AND correction_payload IS NOT NULL AND "
            "geo_review_corrections_valid(correction_payload) AND comment ~ "
            "'[^[:space:]]')",
            name=conv("ck_geo_reviews_decision"),
        ),
        CheckConstraint("length(comment) <= 2000", name=conv("ck_geo_reviews_comment")),
        Index(
            "ix_geo_reviews_current",
            "run_id",
            "analysis_revision_id",
            text("created_at DESC"),
            text("id DESC"),
        ),
        Index("ix_geo_reviews_reviewer", "reviewer_id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_observation_runs.id", name="fk_geo_reviews_run", ondelete="RESTRICT"),
        nullable=False,
    )
    analysis_revision_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    decision: Mapped[str] = mapped_column(String(16), nullable=False)
    correction_payload: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    reviewer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_geo_reviews_reviewer", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
