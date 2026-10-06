"""显式处理历史；0062 在数据库裁决身份、修订和不可变性。"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base


class GeoOpportunityDecision(Base):
    __tablename__ = "geo_opportunity_decisions"
    __table_args__ = (
        UniqueConstraint(
            "opportunity_id", "revision_after", name="uq_geo_opportunity_decision_revision"
        ),
        CheckConstraint(
            "decision IN ('MANUAL_RESOLVE','RETEST_RESOLVE','CONTINUE')",
            name=conv("ck_geo_opportunity_decision_kind"),
        ),
        CheckConstraint(
            "revision_before >= 1 AND revision_after = revision_before + 1",
            name=conv("ck_geo_opportunity_decision_revision"),
        ),
        CheckConstraint(
            "length(btrim(reason_code)) > 0 AND length(btrim(reason_comment)) > 0",
            name=conv("ck_geo_opportunity_decision_reason"),
        ),
        CheckConstraint(
            "(baseline_id IS NULL AND retest_batch_id IS NULL AND "
            "comparison_fingerprint IS NULL AND comparison_snapshot IS NULL AND "
            "decision <> 'RETEST_RESOLVE') OR (baseline_id IS NOT NULL AND "
            "retest_batch_id IS NOT NULL AND comparison_fingerprint ~ '^[0-9a-f]{64}$' "
            "AND comparison_snapshot IS NOT NULL AND decision <> 'MANUAL_RESOLVE')",
            name=conv("ck_geo_opportunity_decision_comparison"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    opportunity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("geo_opportunities.id", name="fk_geo_decision_opportunity", ondelete="RESTRICT"),
        nullable=False,
    )
    decision: Mapped[str] = mapped_column(String(20), nullable=False)
    reason_code: Mapped[str] = mapped_column(String(40), nullable=False)
    reason_comment: Mapped[str] = mapped_column(Text, nullable=False)
    revision_before: Mapped[int] = mapped_column(Integer, nullable=False)
    revision_after: Mapped[int] = mapped_column(Integer, nullable=False)
    baseline_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("geo_retest_baselines.id", name="fk_geo_decision_baseline", ondelete="RESTRICT")
    )
    retest_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("geo_observation_batches.id", name="fk_geo_decision_retest", ondelete="RESTRICT")
    )
    comparison_fingerprint: Mapped[str | None] = mapped_column(String(64))
    # 无比较必须保存SQL NULL；JSON null会被身份守卫视作存在快照并拒绝。
    comparison_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", name="fk_geo_decision_creator", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
