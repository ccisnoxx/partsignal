"""GEO-702机会聚合与追加证据；首次触发快照保留历史事实。"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base

OPEN_PREDICATE = "status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')"
RULE_CODES = (
    "'VISIBILITY_DROP','RECOMMENDATION_DROP','COMPETITOR_SURGE','TOPIC_COVERAGE_GAP',"
    "'OWN_CITATION_LOST','CRITICAL_FACT_ERROR','REPEATED_FACT_ERROR','UNSTABLE_RESULT',"
    "'DATA_QUALITY_PROBLEM','RUN_FAILURE'"
)


class GeoOpportunity(Base):
    __tablename__ = "geo_opportunities"
    __table_args__ = (
        CheckConstraint(
            "identity_key ~ '^[0-9a-f]{64}$'", name=conv("ck_geo_opportunity_identity")
        ),
        CheckConstraint(f"rule_code IN ({RULE_CODES})", name=conv("ck_geo_opportunity_rule")),
        CheckConstraint(
            "priority IN ('LOW','MEDIUM','HIGH','CRITICAL')",
            name=conv("ck_geo_opportunity_priority"),
        ),
        CheckConstraint(
            "status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','DISMISSED')",
            name=conv("ck_geo_opportunity_status"),
        ),
        CheckConstraint("revision >= 1", name=conv("ck_geo_opportunity_revision")),
        CheckConstraint(
            "source_date_from < source_date_to AND last_seen_at >= created_at",
            name=conv("ck_geo_opportunity_dates"),
        ),
        CheckConstraint(
            "geo_opportunity_snapshot_valid(trigger_snapshot) AND "
            "trigger_snapshot->>'triggered' = 'true'",
            name=conv("ck_geo_opportunity_snapshot"),
        ),
        CheckConstraint(
            "(status NOT IN ('ACKNOWLEDGED','IN_PROGRESS','RESOLVED') OR "
            "(acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL)) AND "
            "((status IN ('RESOLVED','DISMISSED') AND resolved_at IS NOT NULL AND "
            "resolved_by IS NOT NULL AND resolution_code IS NOT NULL AND "
            "resolution_comment IS NOT NULL AND length(btrim(resolution_code)) > 0 AND "
            "length(btrim(resolution_comment)) > 0) OR "
            "(status NOT IN ('RESOLVED','DISMISSED') AND resolved_at IS NULL AND "
            "resolved_by IS NULL AND resolution_code IS NULL AND resolution_comment IS NULL))",
            name=conv("ck_geo_opportunity_resolution"),
        ),
        Index(
            "uq_geo_opportunity_open_identity",
            "identity_key",
            unique=True,
            postgresql_where=text(OPEN_PREDICATE),
        ),
        Index("ix_geo_opportunity_subject", "subject_id"),
        Index("ix_geo_opportunity_period", "source_date_from", "source_date_to"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    identity_key: Mapped[str] = mapped_column(String(64), nullable=False)
    rule_code: Mapped[str] = mapped_column(String(100), nullable=False)
    priority: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="OPEN")
    subject_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("geo_subjects.id", ondelete="RESTRICT")
    )
    query_topic_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("query_topics.id", ondelete="RESTRICT")
    )
    prompt_variant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("geo_prompt_variants.id", ondelete="RESTRICT")
    )
    collection_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("geo_collection_profiles.id", ondelete="RESTRICT")
    )
    engine_surface_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("geo_engine_surfaces.id", ondelete="RESTRICT")
    )
    batch_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("geo_observation_batches.id", ondelete="RESTRICT", use_alter=True)
    )
    trigger_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    source_date_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_date_to: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    acknowledged_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    resolution_code: Mapped[str | None] = mapped_column(String(40))
    resolution_comment: Mapped[str | None] = mapped_column(Text)


class GeoOpportunitySource(Base):
    __tablename__ = "geo_opportunity_sources"
    __table_args__ = (
        CheckConstraint(
            "source_role IN ('TRIGGER','SUPPORTING','BASELINE','RETEST')",
            name=conv("ck_geo_opportunity_source_role"),
        ),
        Index(
            "uq_geo_opportunity_source",
            "opportunity_id",
            "run_id",
            "analysis_revision_id",
            "review_id",
            "source_role",
            unique=True,
            postgresql_nulls_not_distinct=True,
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    opportunity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("geo_opportunities.id", ondelete="RESTRICT"), nullable=False
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("geo_observation_runs.id", ondelete="RESTRICT"), nullable=False
    )
    analysis_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("geo_analysis_revisions.id", ondelete="RESTRICT")
    )
    review_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("geo_run_reviews.id", ondelete="RESTRICT")
    )
    source_role: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GeoOpportunityAction(Base):
    __tablename__ = "geo_opportunity_actions"
    __table_args__ = (
        CheckConstraint(
            "action_type IN ('FACT_REVISION','CONTENT_TASK','PUBLICATION_REPAIR',"
            "'ADDITIONAL_MONITORING','OTHER')",
            name=conv("ck_geo_opportunity_action_type"),
        ),
        CheckConstraint(
            "length(btrim(target_type)) > 0 AND length(btrim(status_snapshot)) > 0",
            name=conv("ck_geo_opportunity_action_target"),
        ),
        CheckConstraint(
            "(source_snapshot IS NULL AND request_key_sha256 IS NULL AND "
            "request_sha256 IS NULL AND opportunity_revision_after IS NULL) OR "
            "(source_snapshot IS NOT NULL AND request_key_sha256 IS NOT NULL AND "
            "request_sha256 IS NOT NULL AND opportunity_revision_after IS NOT NULL AND "
            "request_key_sha256 ~ '^[0-9a-f]{64}$' AND request_sha256 ~ '^[0-9a-f]{64}$' AND "
            "opportunity_revision_after >= 2)",
            name=conv("ck_geo_opportunity_action_receipt"),
        ),
        Index("ix_geo_opportunity_action_opportunity", "opportunity_id"),
        Index(
            "uq_geo_opportunity_action_request",
            "created_by",
            "request_key_sha256",
            unique=True,
            postgresql_where=text("request_key_sha256 IS NOT NULL"),
        ),
        Index("ix_geo_opportunity_action_target", "target_type", "target_id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    opportunity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("geo_opportunities.id", ondelete="RESTRICT"), nullable=False
    )
    action_type: Mapped[str] = mapped_column(String(32), nullable=False)
    target_type: Mapped[str] = mapped_column(String(80), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    status_snapshot: Mapped[str] = mapped_column(String(80), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    source_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    request_key_sha256: Mapped[str | None] = mapped_column(String(64))
    request_sha256: Mapped[str | None] = mapped_column(String(64))
    opportunity_revision_after: Mapped[int | None] = mapped_column(Integer)


class GeoOpportunityEvaluation(Base):
    __tablename__ = "geo_opportunity_evaluations"
    __table_args__ = (
        CheckConstraint(
            "evaluation_key ~ '^[0-9a-f]{64}$' AND identity_key ~ '^[0-9a-f]{64}$'",
            name=conv("ck_geo_opportunity_evaluation_keys"),
        ),
        CheckConstraint(
            "geo_opportunity_snapshot_valid(result_snapshot)",
            name=conv("ck_geo_opportunity_evaluation_snapshot"),
        ),
        CheckConstraint(
            "disposition IN ('CREATED','UPDATED','UNCHANGED','SUPPRESSED',"
            "'NO_TRIGGER','UNAVAILABLE')",
            name=conv("ck_geo_opportunity_disposition"),
        ),
        Index("uq_geo_opportunity_evaluation", "evaluation_key", unique=True),
        Index("ix_geo_opportunity_evaluation_identity", "identity_key", "created_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    evaluation_key: Mapped[str] = mapped_column(String(64), nullable=False)
    identity_key: Mapped[str] = mapped_column(String(64), nullable=False)
    rule_set_revision: Mapped[int] = mapped_column(
        ForeignKey("geo_rule_set_revisions.revision", ondelete="RESTRICT"), nullable=False
    )
    opportunity_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("geo_opportunities.id", ondelete="RESTRICT")
    )
    result_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    disposition: Mapped[str] = mapped_column(String(16), nullable=False)
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
