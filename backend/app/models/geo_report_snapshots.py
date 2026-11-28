"""Slice 1D：不可变冻结周/月报快照 ORM 模型。"""

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
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base
from app.models.base import new_uuid


class GeoReportSnapshot(Base):
    """冻结周报/月报/自定义区间报告快照，支持显式更正新版链，禁止原地修改或删除。"""

    __tablename__ = "geo_report_snapshots"
    __table_args__ = (
        CheckConstraint(
            "report_kind IN ('WEEKLY', 'MONTHLY', 'CUSTOM')",
            name=conv("ck_geo_report_snapshots_kind"),
        ),
        CheckConstraint(
            "length(btrim(title)) BETWEEN 1 AND 200",
            name=conv("ck_geo_report_snapshots_title"),
        ),
        CheckConstraint(
            "length(summary_notes) <= 8000",
            name=conv("ck_geo_report_snapshots_notes"),
        ),
        CheckConstraint("revision_no >= 1", name=conv("ck_geo_report_snapshots_rev")),
        CheckConstraint("period_to > period_from", name=conv("ck_geo_report_snapshots_period")),
        CheckConstraint(
            "(supersedes_snapshot_id IS NULL AND revision_no = 1 AND correction_reason IS NULL) "
            "OR (supersedes_snapshot_id IS NOT NULL AND revision_no > 1 "
            "AND supersedes_snapshot_id <> id "
            "AND length(btrim(COALESCE(correction_reason, ''))) BETWEEN 1 AND 1000)",
            name=conv("ck_geo_report_snapshots_supersedes_chain"),
        ),
        Index(
            "uq_geo_report_snapshots_supersedes_once",
            "supersedes_snapshot_id",
            unique=True,
            postgresql_where=text("supersedes_snapshot_id IS NOT NULL"),
        ),
        Index(
            "ix_geo_report_snapshots_period_created",
            text("period_from DESC"),
            text("created_at DESC"),
            "id",
        ),
        Index("ix_geo_report_snapshots_creator", "created_by"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    report_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    period_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_to: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    data_cutoff_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    filter_scope: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    core_cohort_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    dashboard_payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    evidence_run_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, default=list, server_default=text("'{}'::uuid[]")
    )
    summary_notes: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=text("''")
    )
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    supersedes_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_report_snapshots.id",
            name="fk_geo_report_snapshots_supersedes",
            ondelete="RESTRICT",
        ),
    )
    correction_reason: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_geo_report_snapshots_creator", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
