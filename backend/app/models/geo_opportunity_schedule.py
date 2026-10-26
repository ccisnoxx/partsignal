"""周期机会评估的单份配置与不可变窗口；机会与规则仍由原领域拥有。"""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base


class GeoOpportunitySchedule(Base):
    __tablename__ = "geo_opportunity_schedule"
    __table_args__ = (
        CheckConstraint("id=1", name=conv("ck_geo_opportunity_schedule_singleton")),
        CheckConstraint("revision >= 1", name=conv("ck_geo_opportunity_schedule_revision")),
        CheckConstraint(
            "status IN ('DISABLED','ACTIVE','PAUSED') AND "
            "((status='ACTIVE') = (next_run_at IS NOT NULL))",
            name=conv("ck_geo_opportunity_schedule_state"),
        ),
        CheckConstraint(
            "jsonb_typeof(configuration)='object' AND NOT configuration ? 'rule_set_revision'",
            name=conv("ck_geo_opportunity_schedule_configuration"),
        ),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    configuration: Mapped[dict[str, Any]] = mapped_column(JSONB)
    rule_set_revision: Mapped[int] = mapped_column(
        ForeignKey(
            "geo_rule_set_revisions.revision", ondelete="RESTRICT", name="fk_geo_opp_schedule_rule"
        )
    )
    authorizer_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT", name="fk_geo_opp_schedule_authorizer")
    )
    status: Mapped[str] = mapped_column(String(16))
    revision: Mapped[int] = mapped_column(Integer)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GeoOpportunityScheduleWindow(Base):
    __tablename__ = "geo_opportunity_schedule_windows"
    __table_args__ = (
        CheckConstraint("configuration_revision >= 1", name=conv("ck_geo_opp_window_revision")),
        CheckConstraint(
            "jsonb_typeof(configuration_snapshot)='object' "
            "AND NOT configuration_snapshot ? 'rule_set_revision'",
            name=conv("ck_geo_opp_window_configuration"),
        ),
        CheckConstraint(
            "(status='COMPLETED' AND evaluation_run_id IS NOT NULL AND error_code IS NULL "
            "AND covered_until IS NULL) OR (status='FAILED' AND evaluation_run_id IS NULL "
            "AND error_code IS NOT NULL AND covered_until IS NULL) OR "
            "(status='MISSED' AND evaluation_run_id IS NULL "
            "AND error_code IS NOT NULL AND error_code IN ('SUPERSEDED','SKIPPED_OLDER_WINDOWS') "
            "AND covered_until IS NOT NULL AND covered_until > scheduled_for)",
            name=conv("ck_geo_opp_window_result"),
        ),
    )
    schedule_id: Mapped[int] = mapped_column(
        ForeignKey(
            "geo_opportunity_schedule.id", ondelete="RESTRICT", name="fk_geo_opp_window_schedule"
        ),
        primary_key=True,
    )
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    configuration_revision: Mapped[int] = mapped_column(Integer)
    configuration_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    rule_set_revision: Mapped[int] = mapped_column(
        ForeignKey(
            "geo_rule_set_revisions.revision", ondelete="RESTRICT", name="fk_geo_opp_window_rule"
        )
    )
    status: Mapped[str] = mapped_column(String(16))
    evaluation_run_id: Mapped[UUID | None] = mapped_column(
        ForeignKey(
            "geo_opportunity_evaluation_runs.id", ondelete="RESTRICT", name="fk_geo_opp_window_run"
        )
    )
    error_code: Mapped[str | None] = mapped_column(String(100))
    covered_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
