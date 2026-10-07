"""706 比较与显式处理协议；服务器拥有指标、恢复裁决和证据指纹。"""

from enum import StrEnum
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, Field, model_validator

from app.schemas.base import ContractModel
from app.schemas.geo_insights import GeoOverviewDimensions, GeoOverviewExclusion
from app.schemas.geo_metric_values import SampleLevel
from app.schemas.geo_opportunities import GeoOpportunitySourceSnapshot
from app.schemas.geo_opportunity_workbench import (
    GeoOpportunityListItem,
    GeoOpportunityRevisionRequest,
    ReasonCode,
    ReasonComment,
)
from app.schemas.geo_rules import GeoRuleRecovery, GeoRuleSnapshot
from app.schemas.geo_runs import GeoBatchStatus, GeoRunInputSnapshot

Fingerprint = Annotated[str, Field(strict=True, pattern=r"^[0-9a-f]{64}$")]
ComparisonMetric = Literal[
    "natural_visibility",
    "recommendation_rate",
    "recommendation_sov",
    "owned_source_coverage",
    "severe_error_run_rate",
    "incorrect_claim_rate",
    "mention_stability",
    "run_success_rate",
    "evidence_completeness",
    "same_fact_error_count",
    "owned_citation_count",
    "consecutive_failed_count",
]


class GeoRetestRecoveryStatus(StrEnum):
    PENDING = "PENDING"
    UNAVAILABLE = "UNAVAILABLE"
    NOT_COMPARABLE = "NOT_COMPARABLE"
    INSUFFICIENT_SAMPLE = "INSUFFICIENT_SAMPLE"
    NOT_RECOVERED = "NOT_RECOVERED"
    RECOVERED = "RECOVERED"


DifferenceCode = Literal[
    "MATRIX_CHANGED",
    "INPUT_CHANGED",
    "MODEL_VERSION_UNKNOWN",
    "MODEL_VERSION_CHANGED",
    "ANALYSIS_VERSION_CHANGED",
    "ENVIRONMENT_CHANGED",
    "BASELINE_SOURCE_UNAVAILABLE",
]


class GeoRetestComparisonDifference(ContractModel):
    code: DifferenceCode
    field: str
    baseline_run_id: UUID | None
    retest_run_id: UUID | None
    baseline_value: str | None
    retest_value: str | None


class GeoRetestComparisonMetric(ContractModel):
    metric_code: ComparisonMetric
    formula_version: str
    value: float | None
    numerator: int = Field(ge=0)
    denominator: int = Field(ge=0)
    candidate_run_count: int = Field(ge=0)
    eligible_run_count: int = Field(ge=0)
    excluded_run_count: int = Field(ge=0)
    sample_level: SampleLevel
    exclusion_reason_counts: list[GeoOverviewExclusion]
    unjudgeable_claim_count: int = Field(ge=0)
    dimensions: GeoOverviewDimensions | None
    unavailable_reasons: list[str]


class GeoRetestComparisonEnvironment(ContractModel):
    run_id: UUID
    repeat_index: int = Field(ge=1)
    input_snapshot: GeoRunInputSnapshot
    source_product: str | None
    source_model: str | None
    source_version: str | None
    dimensions: GeoOverviewDimensions


class GeoRetestComparisonWindow(ContractModel):
    batch_id: UUID
    date_from: AwareDatetime
    date_to: AwareDatetime
    candidate_run_count: int = Field(ge=0)
    sources: list[GeoOpportunitySourceSnapshot]
    metrics: list[GeoRetestComparisonMetric]
    environments: list[GeoRetestComparisonEnvironment]


class GeoRetestRecovery(ContractModel):
    status: GeoRetestRecoveryStatus
    rule_snapshot: GeoRuleSnapshot
    recovery_configuration: GeoRuleRecovery | None
    required_run_count: int = Field(ge=1)
    reference_kind: Literal["PREVIOUS_TRIGGER_WINDOW", "FROZEN_RECOVERY_THRESHOLD"]
    reference_value: float | None
    observed_value: float | None
    threshold: float | None
    reasons: list[str]
    manual_confirmation_required: Literal[True] = True


class GeoRetestComparison(ContractModel):
    baseline_id: UUID
    retest_batch_id: UUID
    fingerprint: Fingerprint
    baseline: GeoRetestComparisonWindow
    retest: GeoRetestComparisonWindow
    comparable: bool
    differences: list[GeoRetestComparisonDifference]
    recovery: GeoRetestRecovery
    causal_claim: Literal["NOT_ESTABLISHED"] = "NOT_ESTABLISHED"


class GeoRetestComparisonChoice(ContractModel):
    batch_id: UUID
    baseline_id: UUID
    baseline_batch_id: UUID
    created_at: AwareDatetime
    status: GeoBatchStatus


class GeoOpportunityDecisionKind(StrEnum):
    MANUAL_RESOLVE = "MANUAL_RESOLVE"
    RETEST_RESOLVE = "RETEST_RESOLVE"
    CONTINUE = "CONTINUE"


class GeoOpportunityDecision(ContractModel):
    id: UUID
    opportunity_id: UUID
    decision: GeoOpportunityDecisionKind
    reason_code: str
    reason_comment: str
    revision_before: int = Field(ge=1)
    revision_after: int = Field(ge=2)
    retest_batch_id: UUID | None
    comparison_fingerprint: Fingerprint | None
    comparison_snapshot: GeoRetestComparison | None
    created_by: UUID
    created_at: AwareDatetime


class GeoOpportunityComparisonRead(ContractModel):
    opportunity: GeoOpportunityListItem
    opportunity_id: UUID
    opportunity_revision: int = Field(ge=1)
    as_of: AwareDatetime
    retests: list[GeoRetestComparisonChoice]
    selected_retest_batch_id: UUID | None
    comparison: GeoRetestComparison | None
    decisions: list[GeoOpportunityDecision]


class GeoOpportunityDecisionRequest(GeoOpportunityRevisionRequest):
    resolution_code: ReasonCode
    resolution_comment: ReasonComment

    @model_validator(mode="after")
    def nonempty_reason(self) -> Self:
        self.resolution_code = self.resolution_code.strip()
        self.resolution_comment = self.resolution_comment.strip()
        if not self.resolution_code or not self.resolution_comment:
            raise ValueError("处理机会必须填写非空原因代码和说明")
        return self


class GeoOpportunityResolveRequest(GeoOpportunityDecisionRequest):
    resolution_method: Literal["MANUAL", "RETEST"]
    retest_batch_id: UUID | None = None
    comparison_fingerprint: Fingerprint | None = None

    @model_validator(mode="after")
    def evidence_selection(self) -> Self:
        if self.resolution_method == "RETEST":
            if self.retest_batch_id is None or self.comparison_fingerprint is None:
                raise ValueError("确认复测解决必须选择复测批次及比较证据指纹")
        elif self.retest_batch_id is not None or self.comparison_fingerprint is not None:
            raise ValueError("人工解决不携带复测证据选择")
        return self


class GeoOpportunityContinueRequest(GeoOpportunityDecisionRequest):
    retest_batch_id: UUID | None = None
    comparison_fingerprint: Fingerprint | None = None

    @model_validator(mode="after")
    def paired_selection(self) -> Self:
        if (self.retest_batch_id is None) != (self.comparison_fingerprint is None):
            raise ValueError("复测批次与比较证据指纹必须同时提交")
        return self


class GeoOpportunityDecisionResult(ContractModel):
    opportunity: GeoOpportunityListItem
    decision: GeoOpportunityDecision
