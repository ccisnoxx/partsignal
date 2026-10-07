"""服务端矩阵预览数据组件；HTTP 接线由 GEO-208 拥有。"""

from decimal import Decimal
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import Field, PlainSerializer, WithJsonSchema

from app.collectors.registry import ProfileBlockerCode
from app.schemas.base import ContractModel


class GeoPlanBlockerCode(StrEnum):
    SUBJECT_NOT_FOUND = "SUBJECT_NOT_FOUND"
    SUBJECT_DISABLED = "SUBJECT_DISABLED"
    PROMPT_NOT_FOUND = "PROMPT_NOT_FOUND"
    PROMPT_DISABLED = "PROMPT_DISABLED"
    PROFILE_NOT_FOUND = "PROFILE_NOT_FOUND"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"
    BUDGET_CURRENCY_MISMATCH = "BUDGET_CURRENCY_MISMATCH"


class GeoPlanWarningCode(StrEnum):
    MIXED_COLLECTION_MODES = "MIXED_COLLECTION_MODES"
    MIXED_PROFILE_ENVIRONMENTS = "MIXED_PROFILE_ENVIRONMENTS"
    PROMPT_PROFILE_ENVIRONMENT_MISMATCH = "PROMPT_PROFILE_ENVIRONMENT_MISMATCH"
    MODEL_VERSION_UNKNOWN = "MODEL_VERSION_UNKNOWN"
    COST_UNKNOWN = "COST_UNKNOWN"
    COST_PARTIAL = "COST_PARTIAL"
    COST_CURRENCY_MISMATCH = "COST_CURRENCY_MISMATCH"
    BUDGET_UNVERIFIED = "BUDGET_UNVERIFIED"


class GeoEstimatedCostCoverage(StrEnum):
    NONE = "NONE"
    PARTIAL = "PARTIAL"
    COMPLETE = "COMPLETE"


class GeoPlanPreviewBlocker(ContractModel):
    code: GeoPlanBlockerCode | ProfileBlockerCode
    field: str
    resource_id: UUID | None
    related_resource_id: UUID | None


class GeoPlanPreviewWarning(ContractModel):
    code: GeoPlanWarningCode
    field: str
    resource_id: UUID | None
    related_resource_id: UUID | None


def _amount_string(value: Decimal) -> str:
    value = value.copy_abs() if value.is_zero() else value
    result = format(value, "f")
    return result.rstrip("0").rstrip(".") if "." in result else result


EstimatedAmount = Annotated[
    Decimal,
    Field(ge=0, decimal_places=6, allow_inf_nan=False),
    PlainSerializer(_amount_string, return_type=str, when_used="json"),
    WithJsonSchema(
        {"type": "string", "pattern": r"^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$(?![\s\S])"}
    ),
]
CostCurrency = Annotated[str, Field(strict=True, min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")]
RunCount = Annotated[int, Field(strict=True, ge=0)]


class GeoKnownCostTotal(ContractModel):
    value: EstimatedAmount
    currency: CostCurrency


class GeoPlanEstimatedCost(ContractModel):
    value: EstimatedAmount | None
    currency: CostCurrency | None
    coverage: GeoEstimatedCostCoverage
    known_run_count: RunCount
    unknown_run_count: RunCount
    known_costs: list[GeoKnownCostTotal]


class GeoMonitoringPlanPreview(ContractModel):
    prompt_count: RunCount
    profile_count: RunCount
    repeat_count: int = Field(strict=True, ge=1, le=10)
    run_count: RunCount
    manual_run_count: RunCount
    api_run_count: RunCount
    browser_run_count: RunCount
    unresolved_run_count: RunCount
    estimated_cost: GeoPlanEstimatedCost
    blockers: list[GeoPlanPreviewBlocker]
    warnings: list[GeoPlanPreviewWarning]
