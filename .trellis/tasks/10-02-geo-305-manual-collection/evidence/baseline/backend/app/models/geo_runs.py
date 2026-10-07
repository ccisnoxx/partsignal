"""独立回答级 Batch/Run；0048 负责不可变和尝试链最终防线。"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base
from app.models.base import new_uuid


class GeoObservationBatch(Base):
    __tablename__ = "geo_observation_batches"
    __table_args__ = (
        UniqueConstraint("plan_id", "scheduled_for", name="uq_geo_batches_schedule_window"),
        CheckConstraint(
            "trigger_type IN ('SCHEDULED','MANUAL','RETEST')", name=conv("ck_geo_batches_trigger")
        ),
        CheckConstraint(
            "status IN ('PLANNED','QUEUED','RUNNING','COMPLETED','PARTIAL','FAILED',"
            "'CANCELLED','BUDGET_BLOCKED')",
            name=conv("ck_geo_batches_status"),
        ),
        CheckConstraint(
            "(trigger_type = 'SCHEDULED' AND plan_id IS NOT NULL AND scheduled_for IS "
            "NOT NULL AND schedule_identity IS NOT NULL AND schedule_identity ~ "
            "'^[0-9a-f]{64}$') OR (trigger_type <> 'SCHEDULED' AND scheduled_for IS "
            "NULL AND schedule_identity IS NULL)",
            name=conv("ck_geo_batches_schedule"),
        ),
        CheckConstraint(
            "(trigger_type = 'RETEST' AND source_opportunity_id IS NOT NULL AND "
            "baseline_batch_id IS NOT NULL AND baseline_batch_id <> id) OR "
            "(trigger_type <> 'RETEST' AND source_opportunity_id IS NULL AND "
            "baseline_batch_id IS NULL)",
            name=conv("ck_geo_batches_retest"),
        ),
        CheckConstraint(
            "trigger_type = 'SCHEDULED' OR created_by IS NOT NULL",
            name=conv("ck_geo_batches_actor"),
        ),
        CheckConstraint("requested_run_count >= 1", name=conv("ck_geo_batches_count")),
        CheckConstraint("revision >= 0", name=conv("ck_geo_batches_revision")),
        CheckConstraint(
            "geo_batch_snapshots_valid(plan_snapshot, rule_snapshot, plan_id)",
            name=conv("ck_geo_batches_snapshots"),
        ),
        CheckConstraint(
            "(started_at IS NULL OR started_at >= created_at) AND (finished_at IS NULL "
            "OR finished_at >= COALESCE(started_at,created_at)) AND ((status IN "
            "('COMPLETED','PARTIAL','FAILED','CANCELLED','BUDGET_BLOCKED')) = "
            "(finished_at IS NOT NULL))",
            name=conv("ck_geo_batches_time"),
        ),
        Index(
            "uq_geo_batches_schedule_identity",
            "schedule_identity",
            unique=True,
            postgresql_where=text("schedule_identity IS NOT NULL"),
        ),
        Index("ix_geo_batches_status_created", "status", "created_at", "id"),
        Index("ix_geo_batches_plan_created", "plan_id", "created_at", "id"),
        Index("ix_geo_batches_creator", "created_by"),
        Index("ix_geo_batches_baseline", "baseline_batch_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_monitoring_plans.id", name="fk_geo_batches_plan", ondelete="RESTRICT"),
    )
    trigger_type: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="PLANNED", server_default="PLANNED"
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    schedule_identity: Mapped[str | None] = mapped_column(String(64))
    plan_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    rule_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    requested_run_count: Mapped[int] = mapped_column(Integer, nullable=False)
    source_opportunity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    baseline_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_observation_batches.id", name="fk_geo_batches_baseline", ondelete="RESTRICT"
        ),
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_geo_batches_creator", ondelete="RESTRICT"),
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class GeoObservationRun(Base):
    __tablename__ = "geo_observation_runs"
    __table_args__ = (
        UniqueConstraint("batch_id", "run_cell_key", "attempt_no", name="uq_geo_runs_cell_attempt"),
        CheckConstraint(
            "status IN ('PENDING','RUNNING','COLLECTED','ANALYZING','NEEDS_REVIEW',"
            "'COMPLETED','FAILED','CANCELLED','BUDGET_BLOCKED')",
            name=conv("ck_geo_runs_status"),
        ),
        CheckConstraint("repeat_index BETWEEN 1 AND 10", name=conv("ck_geo_runs_repeat")),
        CheckConstraint("attempt_no >= 1", name=conv("ck_geo_runs_attempt")),
        CheckConstraint(
            "(attempt_no = 1 AND previous_attempt_id IS NULL) OR (attempt_no > 1 AND "
            "previous_attempt_id IS NOT NULL AND previous_attempt_id <> id)",
            name=conv("ck_geo_runs_previous"),
        ),
        CheckConstraint("revision >= 0", name=conv("ck_geo_runs_revision")),
        CheckConstraint(
            "geo_run_input_valid(input_snapshot) AND input_snapshot->'prompt'->>'id' = "
            "prompt_variant_id::text AND input_snapshot->'profile'->>'id' = "
            "collection_profile_id::text",
            name=conv("ck_geo_runs_input"),
        ),
        CheckConstraint(
            "external_call_state IN ('NOT_STARTED','SENT','UNKNOWN','COMPLETED') AND "
            "(status NOT IN ('PENDING','CANCELLED','BUDGET_BLOCKED') OR "
            "external_call_state = 'NOT_STARTED')",
            name=conv("ck_geo_runs_external"),
        ),
        CheckConstraint(
            "(lease_token IS NULL) = (lease_expires_at IS NULL) AND ((status IN "
            "('RUNNING','ANALYZING')) = (lease_token IS NOT NULL)) AND "
            "(lease_expires_at IS NULL OR lease_expires_at > started_at)",
            name=conv("ck_geo_runs_lease"),
        ),
        CheckConstraint(
            "dispatch_attempt_count >= 0 AND ((dispatch_attempt_count = 0) = "
            "(last_dispatch_attempt_at IS NULL)) AND (last_dispatch_attempt_at IS NULL "
            "OR last_dispatch_attempt_at >= created_at)",
            name=conv("ck_geo_runs_dispatch"),
        ),
        CheckConstraint(
            "(status IN ('FAILED','BUDGET_BLOCKED') AND error_stage IS NOT NULL AND "
            "error_code IS NOT NULL AND error_stage IN ('COLLECTION','ANALYSIS',"
            "'REVIEW') AND error_code IN ('COLLECTOR_CONFIGURATION_INVALID',"
            "'COLLECTOR_DISABLED','PROVIDER_AUTH_FAILED','PROVIDER_RATE_LIMITED',"
            "'PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE','PROVIDER_RESPONSE_INVALID',"
            "'PROVIDER_RESPONSE_TOO_LARGE','COLLECTOR_UNKNOWN_OUTCOME',"
            "'DATA_CLASSIFICATION_FORBIDDEN','PROFILE_NEEDS_REAUTH','WORKER_LOST',"
            "'BUDGET_EXCEEDED','ANALYSIS_FAILED','REVIEW_FAILED') AND error_summary IS "
            "NOT NULL AND length(btrim(error_summary)) > 0) OR (status NOT IN ('FAILED',"
            "'BUDGET_BLOCKED') AND error_stage IS NULL AND error_code IS NULL AND "
            "error_summary IS NULL)",
            name=conv("ck_geo_runs_error"),
        ),
        CheckConstraint(
            "provider_request_id IS NULL OR (length(provider_request_id) > 0 AND "
            "provider_request_id !~ '^[[:space:]]|[[:space:]]$')",
            name=conv("ck_geo_runs_provider"),
        ),
        CheckConstraint(
            "duration_ms IS NULL OR duration_ms >= 0", name=conv("ck_geo_runs_duration")
        ),
        CheckConstraint(
            "(cost_amount IS NULL AND cost_currency IS NULL) OR (cost_amount IS NOT "
            "NULL AND cost_currency IS NOT NULL AND cost_amount >= 0 AND cost_amount < "
            "'Infinity'::numeric AND cost_currency ~ '^[A-Z]{3}$')",
            name=conv("ck_geo_runs_cost"),
        ),
        CheckConstraint(
            "(prompt_tokens IS NULL OR prompt_tokens >= 0) AND (completion_tokens IS "
            "NULL OR completion_tokens >= 0) AND (total_tokens IS NULL OR total_tokens "
            ">= 0)",
            name=conv("ck_geo_runs_usage"),
        ),
        CheckConstraint(
            "(started_at IS NULL OR started_at >= created_at) AND (collected_at IS NULL "
            "OR (started_at IS NOT NULL AND collected_at >= started_at)) AND "
            "(finished_at IS NULL OR finished_at >= COALESCE(collected_at,started_at,"
            "created_at)) AND ((status IN ('COMPLETED','FAILED','CANCELLED',"
            "'BUDGET_BLOCKED')) = (finished_at IS NOT NULL)) AND (status NOT IN "
            "('PENDING','CANCELLED','BUDGET_BLOCKED') OR started_at IS NULL) AND "
            "(status NOT IN ('RUNNING','COLLECTED','ANALYZING','NEEDS_REVIEW',"
            "'COMPLETED') OR started_at IS NOT NULL) AND (status NOT IN ('COLLECTED',"
            "'ANALYZING','NEEDS_REVIEW','COMPLETED') OR collected_at IS NOT NULL) AND "
            "(status NOT IN ('PENDING','RUNNING','CANCELLED','BUDGET_BLOCKED') OR "
            "collected_at IS NULL)",
            name=conv("ck_geo_runs_time"),
        ),
        Index(
            "uq_geo_runs_successor",
            "previous_attempt_id",
            unique=True,
            postgresql_where=text("previous_attempt_id IS NOT NULL"),
        ),
        Index("ix_geo_runs_status_created", "status", "created_at", "id"),
        Index(
            "ix_geo_runs_pending_dispatch_due",
            text("COALESCE(last_dispatch_attempt_at, created_at)"),
            "id",
            postgresql_where=text("status = 'PENDING'"),
        ),
        Index(
            "ix_geo_runs_running_lease",
            "lease_expires_at",
            "id",
            postgresql_where=text("status IN ('RUNNING','ANALYZING')"),
        ),
        Index("ix_geo_runs_batch_status", "batch_id", "status", "id"),
        Index("ix_geo_runs_profile_created", "collection_profile_id", "created_at", "id"),
        Index("ix_geo_runs_prompt", "prompt_variant_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_observation_batches.id", name="fk_geo_runs_batch", ondelete="RESTRICT"),
        nullable=False,
    )
    prompt_variant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_prompt_variants.id", name="fk_geo_runs_prompt", ondelete="RESTRICT"),
        nullable=False,
    )
    collection_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_collection_profiles.id", name="fk_geo_runs_profile", ondelete="RESTRICT"),
        nullable=False,
    )
    repeat_index: Mapped[int] = mapped_column(Integer, nullable=False)
    run_cell_key: Mapped[str] = mapped_column(
        String(64),
        Computed(
            "geo_run_cell_key(prompt_variant_id, collection_profile_id, repeat_index)",
            persisted=True,
        ),
        nullable=False,
    )
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    previous_attempt_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_observation_runs.id", name="fk_geo_runs_previous", ondelete="RESTRICT"),
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="PENDING", server_default="PENDING"
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    input_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    external_call_state: Mapped[str] = mapped_column(
        String(24), nullable=False, default="NOT_STARTED", server_default="NOT_STARTED"
    )
    lease_token: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dispatch_attempt_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    last_dispatch_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_stage: Mapped[str | None] = mapped_column(String(24))
    error_code: Mapped[str | None] = mapped_column(String(100))
    error_summary: Mapped[str | None] = mapped_column(String(500))
    provider_request_id: Mapped[str | None] = mapped_column(String(200))
    duration_ms: Mapped[int | None] = mapped_column(BigInteger)
    cost_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 6))
    cost_currency: Mapped[str | None] = mapped_column(String(8))
    prompt_tokens: Mapped[int | None] = mapped_column(Integer)
    completion_tokens: Mapped[int | None] = mapped_column(Integer)
    total_tokens: Mapped[int | None] = mapped_column(Integer)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    collected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
