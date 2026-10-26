"""人工运行取消的不可变业务记录，不复用错误字段或审计正文。"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base


class GeoManualRunCancellation(Base):
    __tablename__ = "geo_manual_run_cancellations"
    __table_args__ = (
        CheckConstraint(
            "run_revision>=1 AND draft_revision>=0", name=conv("ck_geo_manual_cancel_revision")
        ),
        CheckConstraint(
            "length(reason) BETWEEN 1 AND 2000 AND length(btrim(reason))>0",
            name=conv("ck_geo_manual_cancel_reason"),
        ),
    )
    run_id: Mapped[UUID] = mapped_column(
        ForeignKey("geo_observation_runs.id", ondelete="RESTRICT", name="fk_geo_manual_cancel_run"),
        primary_key=True,
    )
    cancelled_by: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT", name="fk_geo_manual_cancel_actor"), index=True
    )
    cancelled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str] = mapped_column(String(2000))
    run_revision: Mapped[int] = mapped_column(Integer)
    draft_revision: Mapped[int] = mapped_column(Integer)
