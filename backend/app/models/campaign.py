"""内容活动策划聚合与多对多范围关联 ORM 映射。"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import new_uuid


class ContentCampaign(Base):
    """组织一轮多平台 GEO 内容策划与归因的活动聚合。"""

    __tablename__ = "content_campaigns"
    __table_args__ = (
        Index("ix_content_campaigns_status_updated", "status", "updated_at", "id"),
        Index("ix_content_campaigns_owner_id", "owner_id"),
        Index("ix_content_campaigns_created_by", "created_by"),
        Index("ix_content_campaigns_updated_by", "updated_by"),
        CheckConstraint(
            "btrim(name) <> '' AND name = btrim(name)",
            name="ck_content_campaigns_name_nonempty",
        ),
        CheckConstraint(
            "length(description) <= 4000",
            name="ck_content_campaigns_description_length",
        ),
        CheckConstraint(
            "length(target_audience) <= 500",
            name="ck_content_campaigns_target_audience_length",
        ),
        CheckConstraint(
            "priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')",
            name="ck_content_campaigns_priority",
        ),
        CheckConstraint(
            "status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED')",
            name="ck_content_campaigns_status",
        ),
        CheckConstraint(
            "start_date IS NULL OR end_date IS NULL OR start_date <= end_date",
            name="ck_content_campaigns_date_range",
        ),
        CheckConstraint(
            "jsonb_typeof(target_metrics) = 'object'",
            name="ck_content_campaigns_target_metrics_object",
        ),
        CheckConstraint(
            "(budget_amount IS NULL AND budget_currency IS NULL) "
            "OR (budget_amount IS NOT NULL AND budget_currency IS NOT NULL "
            "AND budget_amount >= 0 AND budget_currency ~ '^[A-Z]{3}$')",
            name="ck_content_campaigns_budget_pair",
        ),
        CheckConstraint("revision >= 0", name="ck_content_campaigns_revision_nonneg"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    target_audience: Mapped[str] = mapped_column(Text, nullable=False, default="")
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="MEDIUM")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT")
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    target_metrics: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    budget_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    budget_currency: Mapped[str | None] = mapped_column(String(8))
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ContentCampaignProduct(Base):
    """活动目标产品关联。"""

    __tablename__ = "content_campaign_products"
    __table_args__ = (
        Index("ix_content_campaign_products_product_id", "product_id", "campaign_id"),
    )

    campaign_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("content_campaigns.id", ondelete="CASCADE"),
        primary_key=True,
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", ondelete="RESTRICT"),
        primary_key=True,
    )


class ContentCampaignTopic(Base):
    """活动目标问题主题关联。"""

    __tablename__ = "content_campaign_topics"
    __table_args__ = (
        Index("ix_content_campaign_topics_topic_id", "query_topic_id", "campaign_id"),
    )

    campaign_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("content_campaigns.id", ondelete="CASCADE"),
        primary_key=True,
    )
    query_topic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("query_topics.id", ondelete="RESTRICT"),
        primary_key=True,
    )


class ContentCampaignPlatform(Base):
    """活动目标内容平台关联。"""

    __tablename__ = "content_campaign_platforms"
    __table_args__ = (
        Index("ix_content_campaign_platforms_platform_id", "platform_profile_id", "campaign_id"),
    )

    campaign_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("content_campaigns.id", ondelete="CASCADE"),
        primary_key=True,
    )
    platform_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform_profiles.id", ondelete="RESTRICT"),
        primary_key=True,
    )


class ContentCampaignMonitoringPlan(Base):
    """活动关联的 GEO 监测计划。"""

    __tablename__ = "content_campaign_monitoring_plans"
    __table_args__ = (
        Index("ix_content_campaign_monitoring_plans_plan_id", "plan_id", "campaign_id"),
    )

    campaign_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("content_campaigns.id", ondelete="CASCADE"),
        primary_key=True,
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_monitoring_plans.id", ondelete="RESTRICT"),
        primary_key=True,
    )
