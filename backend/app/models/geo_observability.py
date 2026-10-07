"""有界运维执行事实；不拥有业务状态或业务审计。"""

from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base

OPERATIONS = (
    "scheduler_tick",
    "scheduler_publish",
    "worker_heartbeat",
    "collect_task",
    "analyze_task",
    "collection_dispatch",
    "collection_recovery",
    "analysis_dispatch",
    "analysis_recovery",
    "retention",
    "batch_build",
    "opportunity_evaluate",
    "storage_write",
)


class GeoOperationHealth(Base):
    __tablename__ = "geo_operation_health"
    __table_args__ = (
        CheckConstraint(
            "operation IN (" + ",".join(f"'{value}'" for value in OPERATIONS) + ")",
            name=conv("ck_geo_operation_health_operation"),
        ),
        CheckConstraint(
            "success_count >= 0 AND failure_count >= 0 AND duration_ms >= 0 "
            "AND duration_total_ms >= duration_ms",
            name=conv("ck_geo_operation_health_counts"),
        ),
        CheckConstraint(
            "(last_success_at IS NULL) = (success_count = 0) AND "
            "(last_failure_at IS NULL) = (failure_count = 0) AND "
            "(last_success_at IS NULL OR last_success_at <= last_attempt_at) AND "
            "(last_failure_at IS NULL OR last_failure_at <= last_attempt_at)",
            name=conv("ck_geo_operation_health_time"),
        ),
    )

    operation: Mapped[str] = mapped_column(String(32), primary_key=True)
    last_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_failure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    success_count: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    failure_count: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    duration_ms: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    duration_total_ms: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
