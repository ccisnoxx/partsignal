"""严格复测的闭合公共合同；未知版本保留空值并显式阻断。"""

from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, Field

from app.schemas.base import ContractModel
from app.schemas.geo_opportunities import GeoOpportunityTriggerSnapshot
from app.schemas.geo_runs import (
    GeoBatchPlanSnapshot,
    GeoBatchRuleSnapshot,
    GeoBatchRuleSnapshotV2,
    GeoRunInputSnapshot,
)


class GeoRetestDifferenceCode(StrEnum):
    OPPORTUNITY_NOT_IN_PROGRESS = "OPPORTUNITY_NOT_IN_PROGRESS"
    BASELINE_NOT_SOURCE = "BASELINE_NOT_SOURCE"
    BASELINE_NOT_FINISHED = "BASELINE_NOT_FINISHED"
    MATRIX_INVALID = "MATRIX_INVALID"
    VARIANT_UNAVAILABLE = "VARIANT_UNAVAILABLE"
    VARIANT_CHANGED = "VARIANT_CHANGED"
    TOPIC_CHANGED = "TOPIC_CHANGED"
    PROFILE_UNAVAILABLE = "PROFILE_UNAVAILABLE"
    PROFILE_CHANGED = "PROFILE_CHANGED"
    SURFACE_CHANGED = "SURFACE_CHANGED"
    SUBJECT_UNAVAILABLE = "SUBJECT_UNAVAILABLE"
    SUBJECT_CHANGED = "SUBJECT_CHANGED"
    MODEL_VERSION_CHANGED = "MODEL_VERSION_CHANGED"
    MODEL_VERSION_UNKNOWN = "MODEL_VERSION_UNKNOWN"


class GeoRetestDifference(ContractModel):
    code: GeoRetestDifferenceCode
    resource_id: UUID | None
    field: str
    reason: str | None = None


class GeoRetestCell(ContractModel):
    root_run_id: UUID
    repeat_index: int = Field(strict=True, ge=1, le=10)
    input_snapshot: GeoRunInputSnapshot
    answer_snapshot_id: UUID | None
    source_product: str | None
    source_model: str | None
    source_version: str | None


class GeoRetestBaselineSnapshot(ContractModel):
    schema_version: Literal[1]
    opportunity_id: UUID
    baseline_batch_id: UUID
    trigger_snapshot: GeoOpportunityTriggerSnapshot
    plan_snapshot: GeoBatchPlanSnapshot
    rule_snapshot: GeoBatchRuleSnapshot | GeoBatchRuleSnapshotV2
    cells: list[GeoRetestCell] = Field(min_length=1)


class GeoRetestPreview(ContractModel):
    opportunity_id: UUID
    opportunity_revision: int = Field(strict=True, ge=1)
    baseline_id: UUID | None
    baseline_batch_id: UUID
    snapshot: GeoRetestBaselineSnapshot
    comparable: bool
    requires_new_baseline: bool
    differences: list[GeoRetestDifference]


class GeoRetestRequest(ContractModel):
    expected_revision: int = Field(strict=True, ge=1)
    baseline_batch_id: UUID


class GeoRetestCreated(ContractModel):
    baseline_id: UUID
    batch_id: UUID
    requested_run_count: int = Field(strict=True, ge=1)
    opportunity_revision: int = Field(strict=True, ge=1)
    created_at: AwareDatetime
    replayed: bool
