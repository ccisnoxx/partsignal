"""Opportunity 数据组件；HTTP 工作台及命令由 GEO-703 接入。"""

from enum import StrEnum
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, model_validator

from app.schemas.base import ContractModel
from app.schemas.geo_rules import GeoRuleCode, GeoRuleSnapshot


class GeoOpportunityStatus(StrEnum):
    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    IN_PROGRESS = "IN_PROGRESS"
    RESOLVED = "RESOLVED"
    DISMISSED = "DISMISSED"


class GeoOpportunityPriority(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class GeoOpportunitySourceRole(StrEnum):
    TRIGGER = "TRIGGER"
    SUPPORTING = "SUPPORTING"
    BASELINE = "BASELINE"
    RETEST = "RETEST"


class GeoOpportunityActionType(StrEnum):
    FACT_REVISION = "FACT_REVISION"
    CONTENT_TASK = "CONTENT_TASK"
    PUBLICATION_REPAIR = "PUBLICATION_REPAIR"
    ADDITIONAL_MONITORING = "ADDITIONAL_MONITORING"
    OTHER = "OTHER"


class GeoOpportunityScope(ContractModel):
    subject_id: UUID | None
    query_topic_id: UUID | None
    prompt_variant_id: UUID | None
    collection_profile_id: UUID | None
    engine_surface_id: UUID | None
    batch_id: UUID | None
    environment_key: str = Field(pattern=r"^[0-9a-f]{64}$")


class GeoOpportunitySourceSnapshot(ContractModel):
    run_id: UUID
    analysis_revision_id: UUID | None
    review_id: UUID | None
    source_role: GeoOpportunitySourceRole


Rate = Annotated[float, Field(allow_inf_nan=False)]


class GeoOpportunityTriggerSnapshot(ContractModel):
    schema_version: Literal[1]
    rule_snapshot: GeoRuleSnapshot
    rule_code: GeoRuleCode
    scope: GeoOpportunityScope
    source_date_from: AwareDatetime
    source_date_to: AwareDatetime
    triggered: bool
    priority: GeoOpportunityPriority
    value: Rate | None
    threshold: Rate | None
    numerator: int = Field(ge=0)
    denominator: int = Field(ge=0)
    unavailable_reasons: list[str]
    sources: list[GeoOpportunitySourceSnapshot]
    details: dict[str, Any]

    @model_validator(mode="after")
    def coherent_trigger(self) -> "GeoOpportunityTriggerSnapshot":
        if self.source_date_from >= self.source_date_to:
            raise ValueError("机会窗口必须满足开始早于结束")
        if self.triggered and (self.unavailable_reasons or self.value is None or not self.sources):
            raise ValueError("触发机会必须有可用值和来源且没有不可用原因")
        return self
