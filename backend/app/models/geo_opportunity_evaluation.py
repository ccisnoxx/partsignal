"""管理员手动评估的不可变请求回执；只保存 key 的摘要。"""

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


class GeoOpportunityEvaluationRun(Base):
    __tablename__ = "geo_opportunity_evaluation_runs"
    __table_args__ = (
        UniqueConstraint("created_by", "request_key_sha256", name="uq_geo_evaluation_run_key"),
        CheckConstraint(
            "request_key_sha256 ~ '^[0-9a-f]{64}$' AND request_sha256 ~ '^[0-9a-f]{64}$'",
            name=conv("ck_geo_evaluation_run_hashes"),
        ),
        CheckConstraint(
            "jsonb_typeof(request_snapshot) = 'object' AND jsonb_typeof(receipt) = 'object'",
            name=conv("ck_geo_evaluation_run_snapshots"),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", name="fk_geo_evaluation_run_actor", ondelete="RESTRICT"),
        nullable=False,
    )
    request_key_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    request_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    rule_set_revision: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "geo_rule_set_revisions.revision",
            name="fk_geo_evaluation_run_rule",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    request_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    receipt: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
