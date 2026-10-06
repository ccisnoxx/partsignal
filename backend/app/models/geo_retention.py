"""GEO 临时草稿删除的永久低敏墓碑。"""

from datetime import datetime
from uuid import UUID as UUIDType

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base


class GeoManualDraftTombstone(Base):
    __tablename__ = "geo_manual_draft_tombstones"
    __table_args__ = (
        CheckConstraint(
            "draft_revision >= 1 AND retention_days BETWEEN 1 AND 3650",
            name=conv("ck_geo_draft_tombstones_policy"),
        ),
        CheckConstraint(
            "purged_at >= draft_updated_at + retention_days * interval '24 hours'",
            name=conv("ck_geo_draft_tombstones_age"),
        ),
    )
    run_id: Mapped[UUIDType] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_observation_runs.id", name="fk_geo_draft_tombstones_run", ondelete="RESTRICT"
        ),
        primary_key=True,
    )
    draft_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    draft_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    retention_days: Mapped[int] = mapped_column(Integer, nullable=False)
    purged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.clock_timestamp()
    )
