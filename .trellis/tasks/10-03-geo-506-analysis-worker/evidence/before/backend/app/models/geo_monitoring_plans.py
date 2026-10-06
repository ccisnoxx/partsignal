"""计划配置及三类关系；完整性与归档由 0047 提供最终数据库防线。"""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base
from app.models.base import new_uuid


class GeoMonitoringPlan(Base):
    __tablename__ = "geo_monitoring_plans"
    __table_args__ = (
        CheckConstraint(
            "length(name) BETWEEN 1 AND 200 AND name !~ '^[[:space:]]|[[:space:]]$'",
            name=conv("ck_geo_monitoring_plans_name"),
        ),
        CheckConstraint(
            "status IN ('DISABLED','ACTIVE','PAUSED','ARCHIVED')",
            name=conv("ck_geo_monitoring_plans_status"),
        ),
        CheckConstraint(
            "repeat_count BETWEEN 1 AND 10", name=conv("ck_geo_monitoring_plans_repeat")
        ),
        CheckConstraint(
            "(schedule_kind = 'MANUAL_ONLY' AND cron_expression IS NULL) OR "
            "(schedule_kind = 'CRON' AND cron_expression IS NOT NULL "
            "AND length(cron_expression) BETWEEN 9 AND 120 "
            "AND cron_expression ~ '^[!-~]+( [!-~]+){4}$')",
            name=conv("ck_geo_monitoring_plans_schedule"),
        ),
        CheckConstraint(
            "geo_plan_timezone_valid(timezone)", name=conv("ck_geo_monitoring_plans_timezone")
        ),
        CheckConstraint(
            "budget_limit IS NULL OR (budget_limit >= 0 AND budget_limit < 'Infinity'::numeric)",
            name=conv("ck_geo_monitoring_plans_budget"),
        ),
        CheckConstraint("revision >= 0", name=conv("ck_geo_monitoring_plans_revision")),
        CheckConstraint(
            "rule_set_revision >= 1", name=conv("ck_geo_monitoring_plans_rule_revision")
        ),
        Index("ix_geo_monitoring_plans_status_updated", "status", "updated_at", "id"),
        Index("ix_geo_monitoring_plans_creator", "created_by"),
        Index("ix_geo_monitoring_plans_updater", "updated_by"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="DISABLED", server_default="DISABLED"
    )
    repeat_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=3, server_default="3"
    )
    schedule_kind: Mapped[str] = mapped_column(
        String(16), nullable=False, default="MANUAL_ONLY", server_default="MANUAL_ONLY"
    )
    cron_expression: Mapped[str | None] = mapped_column(String(120))
    timezone: Mapped[str] = mapped_column(
        String(64), nullable=False, default="Asia/Shanghai", server_default="Asia/Shanghai"
    )
    budget_limit: Mapped[Decimal | None] = mapped_column(Numeric(14, 6))
    rule_set_revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_geo_monitoring_plans_creator", ondelete="RESTRICT"),
        nullable=False,
    )
    updated_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_geo_monitoring_plans_updater", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class GeoMonitoringPlanSubject(Base):
    __tablename__ = "geo_monitoring_plan_subjects"
    __table_args__ = (
        CheckConstraint(
            "role IN ('PRIMARY','COMPETITOR','REFERENCE')",
            name=conv("ck_geo_monitoring_plan_subjects_role"),
        ),
        Index("ix_geo_monitoring_plan_subjects_subject", "subject_id", "plan_id"),
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_monitoring_plans.id",
            name="fk_geo_monitoring_plan_subjects_plan",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_subjects.id", name="fk_geo_monitoring_plan_subjects_subject", ondelete="RESTRICT"
        ),
        primary_key=True,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)


class GeoMonitoringPlanPrompt(Base):
    __tablename__ = "geo_monitoring_plan_prompts"
    __table_args__ = (
        Index("ix_geo_monitoring_plan_prompts_prompt", "prompt_variant_id", "plan_id"),
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_monitoring_plans.id",
            name="fk_geo_monitoring_plan_prompts_plan",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )
    prompt_variant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_prompt_variants.id",
            name="fk_geo_monitoring_plan_prompts_prompt",
            ondelete="RESTRICT",
        ),
        primary_key=True,
    )


class GeoMonitoringPlanProfile(Base):
    __tablename__ = "geo_monitoring_plan_profiles"
    __table_args__ = (
        Index("ix_geo_monitoring_plan_profiles_profile", "collection_profile_id", "plan_id"),
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_monitoring_plans.id",
            name="fk_geo_monitoring_plan_profiles_plan",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )
    collection_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_collection_profiles.id",
            name="fk_geo_monitoring_plan_profiles_profile",
            ondelete="RESTRICT",
        ),
        primary_key=True,
    )
