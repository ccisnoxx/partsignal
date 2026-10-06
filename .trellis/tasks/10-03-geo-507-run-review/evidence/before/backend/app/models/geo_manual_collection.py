"""Run 临时草稿与不可变人工提交身份；0051 拥有最终防线。"""

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
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base


class GeoManualDraft(Base):
    __tablename__ = "geo_manual_drafts"
    __table_args__ = (
        CheckConstraint("draft_revision >= 1", name=conv("ck_geo_manual_drafts_revision")),
        CheckConstraint("geo_manual_draft_valid(draft)", name=conv("ck_geo_manual_drafts_payload")),
        CheckConstraint(
            "(draft->>'screenshot_file_id')::uuid IS NOT DISTINCT FROM screenshot_file_id AND "
            "(draft->>'raw_payload_file_id')::uuid IS NOT DISTINCT FROM raw_payload_file_id AND "
            "(screenshot_file_id IS NULL OR raw_payload_file_id IS NULL OR "
            "screenshot_file_id <> raw_payload_file_id)",
            name=conv("ck_geo_manual_drafts_files"),
        ),
        Index("ix_geo_manual_drafts_screenshot_file", "screenshot_file_id"),
        Index("ix_geo_manual_drafts_raw_file", "raw_payload_file_id"),
        Index("ix_geo_manual_drafts_actor", "updated_by"),
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_observation_runs.id", name="fk_geo_manual_drafts_run", ondelete="RESTRICT"),
        primary_key=True,
    )
    draft_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    draft: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    screenshot_file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("file_records.id", name="fk_geo_manual_drafts_screenshot", ondelete="RESTRICT"),
    )
    raw_payload_file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("file_records.id", name="fk_geo_manual_drafts_raw", ondelete="RESTRICT"),
    )
    updated_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_geo_manual_drafts_actor", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class GeoManualSubmission(Base):
    __tablename__ = "geo_manual_submissions"
    __table_args__ = (
        UniqueConstraint("run_id", name="uq_geo_manual_submissions_run"),
        UniqueConstraint("answer_snapshot_id", name="uq_geo_manual_submissions_answer"),
        CheckConstraint(
            "identity_hash ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$'",
            name=conv("ck_geo_manual_submissions_hashes"),
        ),
        CheckConstraint(
            "run_revision >= 1 AND draft_revision >= 0",
            name=conv("ck_geo_manual_submissions_revisions"),
        ),
        Index("ix_geo_manual_submissions_actor", "submitted_by"),
    )
    identity_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_observation_runs.id", name="fk_geo_manual_submissions_run", ondelete="RESTRICT"
        ),
        nullable=False,
    )
    answer_snapshot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_answer_snapshots.id", name="fk_geo_manual_submissions_answer", ondelete="RESTRICT"
        ),
        nullable=False,
    )
    submitted_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_geo_manual_submissions_actor", ondelete="RESTRICT"),
        nullable=False,
    )
    run_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    draft_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
