"""采集 admission 事实；金额结算仍引用 Run 的实际报告值。"""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Numeric, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base


class GeoCollectionReservation(Base):
    __tablename__ = "geo_collection_reservations"
    __table_args__ = (
        CheckConstraint(
            "state IN ('RESERVED','SENT','SETTLED','UNKNOWN','RELEASED')",
            name=conv("ck_geo_reservations_state"),
        ),
        CheckConstraint(
            "(estimated_amount IS NULL AND estimated_currency IS NULL) OR "
            "(estimated_amount IS NOT NULL AND estimated_currency IS NOT NULL AND "
            "estimated_amount >= 0 AND estimated_amount < 'Infinity'::numeric AND "
            "estimated_currency ~ '^[A-Z]{3}$')",
            name=conv("ck_geo_reservations_cost"),
        ),
        CheckConstraint(
            "((state IN ('SENT','SETTLED','UNKNOWN')) = (sent_at IS NOT NULL)) AND "
            "((state IN ('SETTLED','UNKNOWN','RELEASED')) = (settled_at IS NOT NULL)) AND "
            "(sent_at IS NULL OR sent_at >= reserved_at) AND "
            "(settled_at IS NULL OR settled_at >= COALESCE(sent_at,reserved_at))",
            name=conv("ck_geo_reservations_time"),
        ),
        CheckConstraint(
            "budget_day=(COALESCE(sent_at,reserved_at) AT TIME ZONE 'UTC')::date",
            name=conv("ck_geo_reservations_day"),
        ),
        Index("ix_geo_reservations_day", "budget_day"),
        Index("ix_geo_reservations_sent", "sent_at"),
    )

    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("geo_observation_runs.id", name="fk_geo_reservations_run", ondelete="RESTRICT"),
        primary_key=True,
    )
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    estimated_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 6))
    estimated_currency: Mapped[str | None] = mapped_column(String(3))
    budget_day: Mapped[date] = mapped_column(Date, nullable=False)
    reserved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
