"""GEO 观测与文件记录 ORM 映射。"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import new_uuid


class GeoObservation(Base):
    """追加式 GEO 观测根，承载只读旧记录与人工文章搜索记录。"""

    __tablename__ = "geo_observations"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    observation_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    query_topic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("query_topics.id", ondelete="RESTRICT")
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    actual_prompt: Mapped[str | None] = mapped_column(Text)
    model_name: Mapped[str | None] = mapped_column(String(160))
    model_version: Mapped[str | None] = mapped_column(String(160))
    search_platform: Mapped[str | None] = mapped_column(String(160))
    search_query: Mapped[str | None] = mapped_column(Text)
    tested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    web_search_enabled: Mapped[bool | None] = mapped_column(Boolean)
    answer_summary: Mapped[str | None] = mapped_column(Text)
    mentioned: Mapped[bool | None] = mapped_column(Boolean)
    recommendation: Mapped[str | None] = mapped_column(String(32))
    accuracy: Mapped[str | None] = mapped_column(String(32))
    notes: Mapped[str] = mapped_column(Text, nullable=False)
    supersedes_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("geo_observations.id", ondelete="RESTRICT")
    )
    tested_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class GeoObservationCitation(Base):
    """观测回答中的引用来源。"""

    __tablename__ = "geo_observation_citations"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    observation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("geo_observations.id", ondelete="RESTRICT"), nullable=False
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(String(40), nullable=False)
    publication_record_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("publication_records.id", ondelete="RESTRICT")
    )


class GeoObservationPublication(Base):
    """旧观测发布关联，或人工观测中的逐篇推荐结果。"""

    __tablename__ = "geo_observation_publications"
    observation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("geo_observations.id", ondelete="RESTRICT"), primary_key=True
    )
    publication_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("publication_records.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    recommendation_status: Mapped[str | None] = mapped_column(String(24))


class FileRecord(Base):
    """对象上传生命周期与可信元数据。"""

    __tablename__ = "file_records"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    object_key: Mapped[str] = mapped_column(String(500), unique=True, nullable=False)
    content_type: Mapped[str] = mapped_column(String(160), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    access_level: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="PENDING")
    uploader_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    upload_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GeoObservationAttachment(Base):
    """GEO 观测与已验证截图的关联。"""

    __tablename__ = "geo_observation_attachments"
    observation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("geo_observations.id", ondelete="RESTRICT"), primary_key=True
    )
    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("file_records.id", ondelete="RESTRICT"), primary_key=True
    )
