"""原始回答与引用；0050 保护完整提交和不可变文件引用。"""

import uuid
from datetime import datetime
from typing import Any

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
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base
from app.models.base import new_uuid


class GeoAnswerSnapshot(Base):
    __tablename__ = "geo_answer_snapshots"
    __table_args__ = (
        UniqueConstraint("run_id", name="uq_geo_answers_run"),
        CheckConstraint(
            "prompt_text ~ '[^[:space:]]' AND answer_text ~ '[^[:space:]]' "
            "AND length(answer_text) <= 1048576",
            name=conv("ck_geo_answers_text"),
        ),
        CheckConstraint(
            "answer_format IN ('TEXT','MARKDOWN','HTML_TEXT')",
            name=conv("ck_geo_answers_format"),
        ),
        CheckConstraint(
            "(source_product IS NULL OR length(btrim(source_product)) > 0) AND "
            "(source_model IS NULL OR length(btrim(source_model)) > 0) AND "
            "(source_version IS NULL OR length(btrim(source_version)) > 0)",
            name=conv("ck_geo_answers_sources"),
        ),
        CheckConstraint(
            "geo_raw_summary_valid(raw_payload_summary)", name=conv("ck_geo_answers_summary")
        ),
        CheckConstraint(
            "citation_count BETWEEN 0 AND 1000", name=conv("ck_geo_answers_citation_count")
        ),
        CheckConstraint(
            "raw_payload_file_id IS NULL OR screenshot_file_id IS NULL OR "
            "raw_payload_file_id <> screenshot_file_id",
            name=conv("ck_geo_answers_files"),
        ),
        Index("ix_geo_answers_raw_file", "raw_payload_file_id"),
        Index("ix_geo_answers_screenshot_file", "screenshot_file_id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_observation_runs.id", name="fk_geo_answers_run", ondelete="RESTRICT"),
        nullable=False,
    )
    prompt_text: Mapped[str] = mapped_column(Text, nullable=False)
    answer_text: Mapped[str] = mapped_column(Text, nullable=False)
    answer_sha256: Mapped[str] = mapped_column(
        String(64),
        Computed("geo_answer_sha256(answer_text)", persisted=True),
        nullable=False,
    )
    answer_format: Mapped[str] = mapped_column(String(16), nullable=False)
    source_product: Mapped[str | None] = mapped_column(String(160))
    source_model: Mapped[str | None] = mapped_column(String(200))
    source_version: Mapped[str | None] = mapped_column(String(200))
    web_search_observed: Mapped[bool | None] = mapped_column(Boolean)
    raw_payload_summary: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    raw_payload_file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("file_records.id", name="fk_geo_answers_raw_file", ondelete="RESTRICT"),
    )
    screenshot_file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("file_records.id", name="fk_geo_answers_screenshot_file", ondelete="RESTRICT"),
    )
    citation_count: Mapped[int] = mapped_column(Integer, nullable=False)
    collected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class GeoAnswerCitation(Base):
    __tablename__ = "geo_answer_citations"
    __table_args__ = (
        UniqueConstraint("answer_snapshot_id", "normalized_url", name="uq_geo_citations_url"),
        UniqueConstraint("answer_snapshot_id", "position", name="uq_geo_citations_position"),
        CheckConstraint(
            "geo_citation_url_valid(original_url, normalized_url, hostname)",
            name=conv("ck_geo_citations_url"),
        ),
        CheckConstraint(
            "geo_citation_occurrences_valid(position, occurrences)",
            name=conv("ck_geo_citations_occurrences"),
        ),
        CheckConstraint(
            "extraction_source IN ('STRUCTURED','DOM','TEXT','MANUAL')",
            name=conv("ck_geo_citations_source"),
        ),
        CheckConstraint(
            "title IS NULL OR length(title) <= 2000", name=conv("ck_geo_citations_title")
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    answer_snapshot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_answer_snapshots.id", name="fk_geo_citations_answer", ondelete="RESTRICT"),
        nullable=False,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    occurrences: Mapped[list[int]] = mapped_column(ARRAY(Integer), nullable=False)
    original_url: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_url: Mapped[str] = mapped_column(Text, nullable=False)
    hostname: Mapped[str] = mapped_column(String(253), nullable=False)
    title: Mapped[str | None] = mapped_column(Text)
    extraction_source: Mapped[str] = mapped_column(String(24), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
