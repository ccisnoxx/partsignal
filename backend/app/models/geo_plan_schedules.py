"""显式登记的计划游标和不可变窗口；历史CRON无自动登记。"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base


class GeoPlanSchedule(Base):
    __tablename__ = "geo_plan_schedules"
    __table_args__ = (Index("ix_geo_plan_schedules_due", "next_run_at", "plan_id"),)
    plan_id: Mapped[UUID] = mapped_column(
        ForeignKey("geo_monitoring_plans.id", ondelete="CASCADE", name="fk_geo_schedule_plan"),
        primary_key=True,
    )
    registered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GeoPlanScheduleWindow(Base):
    __tablename__ = "geo_plan_schedule_windows"
    __table_args__ = (
        CheckConstraint("plan_revision >= 0", name=conv("ck_geo_schedule_window_revision")),
        CheckConstraint(
            "(status='CREATED' AND batch_id IS NOT NULL AND error_code IS NULL "
            "AND covered_until IS NULL) OR (status='FAILED' AND batch_id IS NULL "
            "AND error_code IS NOT NULL AND covered_until IS NULL) OR "
            "(status='MISSED' AND batch_id IS NULL "
            "AND error_code IN ('LATE_WINDOW','PLAN_CHANGED') "
            "AND covered_until IS NOT NULL AND error_code IS NOT NULL "
            "AND covered_until > scheduled_for)",
            name=conv("ck_geo_schedule_window_result"),
        ),
    )
    plan_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "geo_plan_schedules.plan_id", ondelete="RESTRICT", name="fk_geo_window_schedule"
        ),
        primary_key=True,
    )
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    plan_revision: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16))
    batch_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("geo_observation_batches.id", ondelete="RESTRICT", name="fk_geo_window_batch")
    )
    error_code: Mapped[str | None] = mapped_column(String(100))
    covered_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
