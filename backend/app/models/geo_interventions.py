"""Slice 4A：GEO R6 之上的干预编排与归因聚合 ORM 映射。"""

from __future__ import annotations

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
from app.models.base import new_uuid


class GeoIntervention(Base):
    """围绕 GEO 机会与可选 Campaign 的干预假设、执行窗口与归因结论聚合。"""

    __tablename__ = "geo_interventions"
    __table_args__ = (
        CheckConstraint(
            "btrim(title) <> '' AND title = btrim(title)",
            name=conv("ck_geo_interventions_title_nonempty"),
        ),
        CheckConstraint(
            "btrim(hypothesis) <> '' AND length(hypothesis) <= 2000",
            name=conv("ck_geo_interventions_hypothesis_bounds"),
        ),
        CheckConstraint(
            "planned_action_type IN ('FACT_REVISION', 'CONTENT_TASK', "
            "'PUBLICATION_REPAIR', 'ADDITIONAL_MONITORING', 'OTHER')",
            name=conv("ck_geo_interventions_action_type"),
        ),
        CheckConstraint(
            "jsonb_typeof(target_metrics) = 'object'",
            name=conv("ck_geo_interventions_target_metrics_object"),
        ),
        CheckConstraint(
            "status IN ('PLANNED', 'ACTIVE', 'EVALUATING', 'CONCLUDED', 'CANCELLED')",
            name=conv("ck_geo_interventions_status"),
        ),
        CheckConstraint(
            "outcome_verdict IS NULL OR outcome_verdict IN "
            "('TARGET_MET', 'PARTIAL_IMPROVEMENT', 'NO_IMPROVEMENT', 'INSUFFICIENT_DATA')",
            name=conv("ck_geo_interventions_outcome_verdict"),
        ),
        CheckConstraint(
            "causal_claim = 'NOT_ESTABLISHED'",
            name=conv("ck_geo_interventions_causal_claim"),
        ),
        CheckConstraint(
            "length(conclusion_note) <= 2000",
            name=conv("ck_geo_interventions_conclusion_note_len"),
        ),
        CheckConstraint("revision >= 0", name=conv("ck_geo_interventions_revision_nonneg")),
        CheckConstraint(
            "retest_window_start IS NULL OR retest_window_end IS NULL "
            "OR retest_window_start <= retest_window_end",
            name=conv("ck_geo_interventions_retest_window"),
        ),
        CheckConstraint(
            "(status = 'CONCLUDED' AND outcome_verdict IS NOT NULL AND concluded_at IS NOT NULL "
            "AND length(btrim(conclusion_note)) > 0) OR "
            "(status <> 'CONCLUDED' AND outcome_verdict IS NULL AND concluded_at IS NULL)",
            name=conv("ck_geo_interventions_conclusion_pair"),
        ),
        Index(
            "ix_geo_interventions_opportunity",
            "opportunity_id",
            text("created_at DESC"),
            text("id DESC"),
        ),
        Index(
            "ix_geo_interventions_campaign",
            "campaign_id",
            text("created_at DESC"),
            text("id DESC"),
            postgresql_where=text("campaign_id IS NOT NULL"),
        ),
        Index(
            "ix_geo_interventions_status_updated",
            "status",
            text("updated_at DESC"),
            text("id DESC"),
        ),
        Index(
            "ix_geo_interventions_assignee",
            "assignee_id",
            postgresql_where=text("assignee_id IS NOT NULL"),
        ),
        Index("ix_geo_interventions_created_by", "created_by"),
        Index("ix_geo_interventions_updated_by", "updated_by"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    opportunity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_opportunities.id", ondelete="RESTRICT"),
        nullable=False,
    )
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("content_campaigns.id", ondelete="RESTRICT"),
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    hypothesis: Mapped[str] = mapped_column(Text, nullable=False)
    planned_action_type: Mapped[str] = mapped_column(String(40), nullable=False)
    target_metrics: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="PLANNED", server_default="PLANNED"
    )
    outcome_verdict: Mapped[str | None] = mapped_column(String(32))
    causal_claim: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="NOT_ESTABLISHED",
        server_default="NOT_ESTABLISHED",
    )
    baseline_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("geo_retest_baselines.id", ondelete="RESTRICT")
    )
    decision_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("geo_opportunity_decisions.id", ondelete="RESTRICT")
    )
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    intervened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retest_window_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retest_window_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    concluded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    conclusion_note: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=""
    )
    revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
