"""当前指针与不可变 revision 历史；PostgreSQL 是规则配置唯一来源。"""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base


class GeoRuleSetRevision(Base):
    __tablename__ = "geo_rule_set_revisions"
    __table_args__ = (
        CheckConstraint("revision >= 1", name=conv("ck_geo_rule_revision_positive")),
        CheckConstraint(
            "geo_rule_configuration_valid(configuration)",
            name=conv("ck_geo_rule_configuration_valid"),
        ),
        CheckConstraint(
            "jsonb_typeof(configuration) = 'object'", name=conv("ck_geo_rule_configuration_object")
        ),
    )
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    configuration: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class GeoRuleSetCurrent(Base):
    __tablename__ = "geo_rule_set_current"
    __table_args__ = (CheckConstraint("id = 1", name=conv("ck_geo_rule_current_singleton")),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    revision: Mapped[int] = mapped_column(
        ForeignKey("geo_rule_set_revisions.revision", ondelete="RESTRICT"), nullable=False
    )
