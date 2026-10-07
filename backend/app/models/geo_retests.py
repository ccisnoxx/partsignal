"""严格复测的不可变基线与请求回执；0061 保护实际历史和复制矩阵。"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base


class GeoRetestBaseline(Base):
    __tablename__ = "geo_retest_baselines"
    __table_args__ = (
        UniqueConstraint("opportunity_id", "baseline_batch_id", name="uq_geo_retest_baseline"),
        CheckConstraint(
            "geo_retest_snapshot_valid(snapshot)", name=conv("ck_geo_retest_baseline_snapshot")
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    opportunity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "geo_opportunities.id", name="fk_geo_retest_baseline_opportunity", ondelete="RESTRICT"
        ),
        nullable=False,
    )
    baseline_batch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "geo_observation_batches.id", name="fk_geo_retest_baseline_batch", ondelete="RESTRICT"
        ),
        nullable=False,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", name="fk_geo_retest_baseline_creator", ondelete="RESTRICT"),
        nullable=False,
    )
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class GeoRetestRequest(Base):
    __tablename__ = "geo_retest_requests"
    __table_args__ = (
        UniqueConstraint("created_by", "request_key_sha256", name="uq_geo_retest_request_key"),
        UniqueConstraint("batch_id", name="uq_geo_retest_request_batch"),
        CheckConstraint(
            "request_key_sha256 ~ '^[0-9a-f]{64}$' AND request_sha256 ~ '^[0-9a-f]{64}$'",
            name=conv("ck_geo_retest_request_hashes"),
        ),
        CheckConstraint(
            "opportunity_revision_after >= 1", name=conv("ck_geo_retest_request_revision")
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    baseline_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "geo_retest_baselines.id", name="fk_geo_retest_request_baseline", ondelete="RESTRICT"
        ),
        nullable=False,
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "geo_observation_batches.id", name="fk_geo_retest_request_batch", ondelete="RESTRICT"
        ),
        nullable=False,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", name="fk_geo_retest_request_creator", ondelete="RESTRICT"),
        nullable=False,
    )
    request_key_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    request_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    opportunity_revision_after: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
