"""Slice 4B：人工与外采运营费用台账 ORM 模型（追加式可一次性作废）。"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base
from app.models.base import new_uuid


class OperatingCostEntry(Base):
    """关联 ContentCampaign 或 GeoIntervention 的人工/外采费用台账记录。"""

    __tablename__ = "operating_cost_entries"
    __table_args__ = (
        CheckConstraint(
            "category IN ('LABOR', 'EXTERNAL_PLACEMENT', 'OTHER')",
            name=conv("ck_operating_cost_entries_category"),
        ),
        CheckConstraint("amount >= 0", name=conv("ck_operating_cost_entries_amount_nonneg")),
        CheckConstraint(
            "currency ~ '^[A-Z]{3}$'", name=conv("ck_operating_cost_entries_currency")
        ),
        CheckConstraint(
            "campaign_id IS NOT NULL OR geo_intervention_id IS NOT NULL",
            name=conv("ck_operating_cost_entries_owner"),
        ),
        CheckConstraint(
            "(voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR "
            "(voided_at IS NOT NULL AND voided_by IS NOT NULL "
            "AND void_reason IS NOT NULL AND length(btrim(void_reason)) > 0)",
            name=conv("ck_operating_cost_entries_void_pair"),
        ),
        Index(
            "ix_operating_cost_entries_campaign",
            "campaign_id",
            text("incurred_on DESC"),
            text("id DESC"),
            postgresql_where=text("campaign_id IS NOT NULL"),
        ),
        Index(
            "ix_operating_cost_entries_intervention",
            "geo_intervention_id",
            text("incurred_on DESC"),
            text("id DESC"),
            postgresql_where=text("geo_intervention_id IS NOT NULL"),
        ),
        Index("ix_operating_cost_entries_incurred_on", text("incurred_on DESC"), text("id DESC")),
        Index("ix_operating_cost_entries_created_by", "created_by"),
        Index(
            "ix_operating_cost_entries_voided_by",
            "voided_by",
            postgresql_where=text("voided_by IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_campaigns.id", ondelete="RESTRICT")
    )
    geo_intervention_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("geo_interventions.id", ondelete="RESTRICT")
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False)
    incurred_on: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voided_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    void_reason: Mapped[str | None] = mapped_column(String(300))
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
