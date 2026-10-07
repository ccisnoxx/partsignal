"""GEO-701 规则配置合同；preview 只验证配置和样本门槛，不创建机会。"""

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.schemas.base import ContractModel
from app.schemas.geo_metric_values import SampleLevel

Count = Annotated[int, Field(strict=True, ge=1, le=10000)]
Rate = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
Days = Annotated[int, Field(strict=True, ge=1, le=365)]
Revision = Annotated[int, Field(strict=True, ge=1)]


class GeoRuleCode(StrEnum):
    VISIBILITY_DROP = "VISIBILITY_DROP"
    RECOMMENDATION_DROP = "RECOMMENDATION_DROP"
    COMPETITOR_SURGE = "COMPETITOR_SURGE"
    TOPIC_COVERAGE_GAP = "TOPIC_COVERAGE_GAP"
    OWN_CITATION_LOST = "OWN_CITATION_LOST"
    CRITICAL_FACT_ERROR = "CRITICAL_FACT_ERROR"
    REPEATED_FACT_ERROR = "REPEATED_FACT_ERROR"
    UNSTABLE_RESULT = "UNSTABLE_RESULT"
    DATA_QUALITY_PROBLEM = "DATA_QUALITY_PROBLEM"
    RUN_FAILURE = "RUN_FAILURE"


class GeoRuleSamplePolicy(ContractModel):
    """必须满足 1 < reportable_minimum < stable_minimum；顺序由服务端权威校验。"""

    reportable_minimum: Annotated[Count, Field(ge=2)] = 3
    stable_minimum: Annotated[Count, Field(ge=3)] = 5

    @model_validator(mode="after")
    def ordered(self) -> "GeoRuleSamplePolicy":
        if not 1 < self.reportable_minimum < self.stable_minimum:
            raise ValueError("样本门槛必须满足 1 < REPORTABLE < STABLE")
        return self


class GeoRuleRecovery(ContractModel):
    minimum_runs: Count = 5
    visibility_drop_max_points: Rate = 0.0
    recommendation_drop_max_points: Rate = 0.0
    competitor_surge_max_points: Rate = 0.0
    topic_visibility_minimum_rate: Rate = 0.6
    owned_citation_minimum_count: Count = 1
    stability_minimum_rate: Rate = 0.67
    # 恢复从来不授权自动关闭；事实错误要求零次同类错误。
    fact_error_max_count: Literal[0] = 0
    strict_comparability_required: Literal[True] = True
    manual_confirmation_required: Literal[True] = True

    @field_validator("strict_comparability_required", "manual_confirmation_required", mode="before")
    @classmethod
    def required_confirmation(cls, value: object) -> object:
        if value is not True:
            raise ValueError("严格可比和人工确认必须为 true")
        return value

    @field_validator("fact_error_max_count", mode="before")
    @classmethod
    def no_remaining_errors(cls, value: object) -> object:
        if type(value) is not int or value != 0:
            raise ValueError("事实错误恢复必须为整数零")
        return value


class GeoRuleConfiguration(ContractModel):
    sample_policy: GeoRuleSamplePolicy = Field(default_factory=GeoRuleSamplePolicy)
    visibility_drop_points: Rate = 0.1
    recommendation_drop_points: Rate = 0.1
    competitor_surge_points: Rate = 0.15
    own_citation_previous_count: Count = 2
    repeated_error_minimum_runs: Count = 3
    repeated_error_window_days: Days = 30
    unstable_minimum_repeats: Count = 3
    stability_minimum_rate: Rate = 0.67
    dedup_window_days: Days = 30
    # 方法没有批准这些数值；null 表示数值门槛尚未配置，不能伪造默认成功率。
    data_quality_minimum_success_rate: Rate | None = None
    data_quality_minimum_evidence_rate: Rate | None = None
    run_failure_consecutive_limit: Count | None = None
    recovery: GeoRuleRecovery = Field(default_factory=GeoRuleRecovery)


class GeoRuleSnapshot(ContractModel):
    schema_version: Literal[1]
    rule_set_revision: Revision
    configuration: GeoRuleConfiguration


class GeoRuleSetRead(ContractModel):
    revision: Revision
    configuration: GeoRuleConfiguration
    updated_at: datetime
    updated_by: UUID | None
    available_actions: list[Literal["UPDATE", "PREVIEW"]]


class GeoRuleUpdateRequest(ContractModel):
    expected_revision: Revision
    configuration: GeoRuleConfiguration


class GeoRulePreviewSamples(ContractModel):
    current_runs: Annotated[int, Field(strict=True, ge=0, le=100000)] = 0
    previous_runs: Annotated[int, Field(strict=True, ge=0, le=100000)] = 0


class GeoRulePreviewRequest(GeoRuleUpdateRequest):
    samples: GeoRulePreviewSamples = Field(default_factory=GeoRulePreviewSamples)


class GeoRuleSampleGate(ContractModel):
    rule_code: GeoRuleCode
    current_minimum: Count
    previous_minimum: Annotated[int, Field(ge=0)]
    sample_sufficient: bool
    threshold_configured: bool


class GeoRulePreviewRead(ContractModel):
    baseline_revision: Revision
    proposed_revision: Revision
    changed: bool
    snapshot: GeoRuleSnapshot
    current_sample_level: SampleLevel
    previous_sample_level: SampleLevel
    sample_gates: list[GeoRuleSampleGate]
    preview_scope: Literal["CONFIGURATION_AND_SAMPLE_GATES"]
