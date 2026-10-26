"""计划调度运行摘要；配置revision与窗口进展分别表达。"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from app.schemas.base import ContractModel


class GeoPlanScheduleWindowOut(ContractModel):
    scheduled_for: datetime
    plan_revision: int
    status: Literal["CREATED", "FAILED", "MISSED"]
    batch_id: UUID | None
    error_code: str | None
    covered_until: datetime | None
    created_at: datetime


class GeoPlanScheduleRuntime(ContractModel):
    next_run_at: datetime | None
    latest_window: GeoPlanScheduleWindowOut | None
