"""机会工作台公共协议；状态与动作由服务端闭合投影。"""

from enum import StrEnum
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BeforeValidator, Field, model_validator

from app.schemas.base import ContractModel
from app.schemas.geo_analysis import GeoRunReviewOut
from app.schemas.geo_answers import GeoAnswerCitationOut, GeoAnswerSnapshotOut
from app.schemas.geo_opportunities import (
    GeoOpportunityActionType,
    GeoOpportunityPriority,
    GeoOpportunityScope,
    GeoOpportunitySourceRole,
    GeoOpportunityStatus,
    GeoOpportunityTriggerSnapshot,
    Rate,
)
from app.schemas.geo_opportunity_actions import GeoOpportunityActionSourceSnapshot
from app.schemas.geo_read_models import GeoRunEvidenceFile
from app.schemas.geo_reviews import GeoAnalysisResult, GeoReviewedResults
from app.schemas.geo_rules import GeoRuleCode
from app.schemas.geo_runs import GeoObservationRunOut
from app.schemas.geo_surfaces import GeoCollectionMode


class GeoOpportunityAction(StrEnum):
    ACKNOWLEDGE = "ACKNOWLEDGE"
    DISMISS = "DISMISS"
    RESOLVE = "RESOLVE"
    CONTINUE = "CONTINUE"


class GeoOpportunityWorkflowStage(StrEnum):
    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    IN_PROGRESS = "IN_PROGRESS"
    CLOSED = "CLOSED"


class GeoOpportunityWorkflow(ContractModel):
    workflow_stage: GeoOpportunityWorkflowStage
    primary_task: Literal["ACKNOWLEDGE", "VIEW_EVIDENCE"]
    available_actions: list[GeoOpportunityAction]


class GeoOpportunityFilters(ContractModel):
    q: str | None = Field(default=None, max_length=200, pattern=r"^[^\x00]*$")
    created_from: AwareDatetime | None = None
    created_to: AwareDatetime | None = None
    page: int = Field(default=1, ge=1)
    page_size: Annotated[Literal[10, 20, 50], BeforeValidator(int)] = 20
    sort: Literal["PRIORITY_DESC", "CREATED_DESC", "LAST_SEEN_DESC"] = "PRIORITY_DESC"
    status: GeoOpportunityStatus | None = None
    priority: GeoOpportunityPriority | None = None
    rule_code: GeoRuleCode | None = None
    subject_id: UUID | None = None
    product_id: UUID | None = None
    query_topic_id: UUID | None = None
    prompt_variant_id: UUID | None = None
    collection_profile_id: UUID | None = None
    engine_surface_id: UUID | None = None
    collection_mode: GeoCollectionMode | None = None

    @model_validator(mode="after")
    def time_window(self) -> Self:
        if (
            self.created_from is not None
            and self.created_to is not None
            and self.created_from >= self.created_to
        ):
            raise ValueError("时间窗口必须满足 created_from < created_to")
        return self


class GeoOpportunitySourceFilters(ContractModel):
    source_page: int = Field(default=1, ge=1)
    source_page_size: Annotated[Literal[10, 20, 50], BeforeValidator(int)] = 20


class GeoOpportunityRevisionRequest(ContractModel):
    expected_revision: int = Field(strict=True, ge=1)


ReasonCode = Annotated[str, Field(strict=True, min_length=1, max_length=40, pattern=r"^[^\x00]*$")]
ReasonComment = Annotated[
    str, Field(strict=True, min_length=1, max_length=2000, pattern=r"^[^\x00]*$")
]


class GeoOpportunityDismissRequest(GeoOpportunityRevisionRequest):
    resolution_code: ReasonCode
    resolution_comment: ReasonComment

    @model_validator(mode="after")
    def reason(self) -> Self:
        self.resolution_code = self.resolution_code.strip()
        self.resolution_comment = self.resolution_comment.strip()
        if not self.resolution_code or not self.resolution_comment:
            raise ValueError("驳回必须填写非空原因代码和说明")
        return self


class GeoOpportunityListItem(GeoOpportunityWorkflow):
    id: UUID
    rule_code: GeoRuleCode
    priority: GeoOpportunityPriority
    status: GeoOpportunityStatus
    revision: int = Field(ge=1)
    scope: GeoOpportunityScope
    title: str
    description: str
    subject_name: str | None
    product_id: UUID | None
    query_topic_name: str | None
    prompt_variant_name: str | None
    collection_profile_name: str | None
    engine_surface_name: str | None
    value: Rate | None
    threshold: Rate | None
    numerator: int = Field(ge=0)
    denominator: int = Field(ge=0)
    source_date_from: AwareDatetime
    source_date_to: AwareDatetime
    created_at: AwareDatetime
    last_seen_at: AwareDatetime
    acknowledged_at: AwareDatetime | None
    acknowledged_by: UUID | None
    resolved_at: AwareDatetime | None
    resolved_by: UUID | None
    resolution_code: str | None
    resolution_comment: str | None
    source_count: int = Field(ge=0)
    action_count: int = Field(ge=0)


class GeoOpportunityFilterOption(ContractModel):
    id: UUID
    name: str


class GeoOpportunityFilterOptions(ContractModel):
    subjects: list[GeoOpportunityFilterOption]
    products: list[GeoOpportunityFilterOption]
    query_topics: list[GeoOpportunityFilterOption]
    prompt_variants: list[GeoOpportunityFilterOption]
    collection_profiles: list[GeoOpportunityFilterOption]
    engine_surfaces: list[GeoOpportunityFilterOption]


class GeoOpportunityListPage(ContractModel):
    items: list[GeoOpportunityListItem]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: Literal[10, 20, 50]
    as_of: AwareDatetime
    filter_options: GeoOpportunityFilterOptions


class GeoOpportunitySourceEvidence(ContractModel):
    id: UUID
    run_id: UUID
    analysis_revision_id: UUID | None
    review_id: UUID | None
    source_role: GeoOpportunitySourceRole
    created_at: AwareDatetime
    run: GeoObservationRunOut
    answer: GeoAnswerSnapshotOut | None
    citations: list[GeoAnswerCitationOut]
    evidence_files: list[GeoRunEvidenceFile]
    analysis: GeoAnalysisResult | None
    review: GeoRunReviewOut | None
    effective_results: GeoReviewedResults | None


class GeoOpportunitySourcePage(ContractModel):
    items: list[GeoOpportunitySourceEvidence]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: Literal[10, 20, 50]


class GeoOpportunityLinkedEvaluation(ContractModel):
    id: UUID
    rule_set_revision: int = Field(ge=1)
    evaluated_as_of: AwareDatetime
    created_at: AwareDatetime
    disposition: Literal["CREATED", "UPDATED", "UNCHANGED"]
    result_snapshot: GeoOpportunityTriggerSnapshot


class GeoOpportunityActionRecord(ContractModel):
    id: UUID
    action_type: GeoOpportunityActionType
    target_type: str
    target_id: UUID
    status_snapshot: str
    created_by: UUID
    created_at: AwareDatetime
    source_snapshot: GeoOpportunityActionSourceSnapshot | None = None
    navigation_path: str | None = None
    target_available: bool | None = None


class GeoOpportunityActionResult(ContractModel):
    action: GeoOpportunityActionRecord
    opportunity_revision: int = Field(ge=1)
    replayed: bool


class GeoOpportunityDetail(ContractModel):
    opportunity: GeoOpportunityListItem
    trigger_snapshot: GeoOpportunityTriggerSnapshot
    latest_evaluation: GeoOpportunityLinkedEvaluation | None
    sources: GeoOpportunitySourcePage
    actions: list[GeoOpportunityActionRecord]
    available_action_types: list[GeoOpportunityActionType]
    as_of: AwareDatetime
