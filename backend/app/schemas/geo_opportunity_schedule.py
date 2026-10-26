"""管理员自动评估配置与运行摘要；不接受客户端执行时间或系统身份。"""

from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, Field

from app.schemas.base import ContractModel
from app.schemas.geo_opportunity_evaluation import (
    GeoOpportunityEvaluationReceipt,
    GeoOpportunityEvaluationScope,
)


class GeoOpportunityScheduleConfiguration(GeoOpportunityEvaluationScope):
    rule_set_revision: int = Field(strict=True, ge=1)
    interval_hours: int = Field(strict=True, ge=1, le=168)
    lookback_days: int = Field(strict=True, ge=1, le=31)


class GeoOpportunityScheduleSave(ContractModel):
    expected_revision: int = Field(strict=True, ge=0)
    configuration: GeoOpportunityScheduleConfiguration


class GeoOpportunityScheduleCommand(ContractModel):
    expected_revision: int = Field(strict=True, ge=1)


class GeoOpportunityScheduleWindowOut(ContractModel):
    scheduled_for: AwareDatetime
    configuration_revision: int = Field(ge=1)
    configuration: GeoOpportunityScheduleConfiguration
    status: Literal["COMPLETED", "FAILED", "MISSED"]
    covered_until: AwareDatetime | None
    error_code: str | None
    receipt: GeoOpportunityEvaluationReceipt | None
    created_at: AwareDatetime


class GeoOpportunityScheduleDetail(ContractModel):
    revision: int = Field(ge=0)
    status: Literal["UNCONFIGURED", "DISABLED", "ACTIVE", "PAUSED"]
    configuration: GeoOpportunityScheduleConfiguration | None
    authorizer_id: UUID | None
    next_run_at: AwareDatetime | None
    latest_window: GeoOpportunityScheduleWindowOut | None
    available_actions: list[Literal["CONFIGURE", "ACTIVATE", "PAUSE", "RESUME"]]
    blocked_reason: (
        Literal[
            "GEO_MONITORING_DISABLED",
            "AUTH_REQUIRED",
            "PASSWORD_CHANGE_REQUIRED",
            "PERMISSION_DENIED",
        ]
        | None
    )
