"""人工复核命令与机器/当前结果的独立读模型。"""

from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import Field, model_validator

from app.schemas.base import ContractModel
from app.schemas.geo_analysis import (
    GeoAnalysisRevisionOut,
    GeoAnalysisSelection,
    GeoClaimAssessmentOut,
    GeoEntityMentionOut,
    GeoMentionCorrection,
    GeoRecommendationCorrection,
    GeoRecommendationOut,
    GeoReviewCorrectionPayload,
    GeoReviewDecision,
    GeoRunReviewOut,
    GeoSourceCategory,
    NonNegative,
    validate_review_decision,
)


class GeoRunReviewRequest(ContractModel):
    model_config = GeoRunReviewOut.model_config

    analysis_revision_id: UUID
    expected_run_revision: NonNegative
    decision: GeoReviewDecision
    correction_payload: GeoReviewCorrectionPayload | None
    comment: Annotated[str, Field(strict=True, max_length=2000, pattern=r"^[^\x00]*$")]

    @model_validator(mode="after")
    def decision_payload(self) -> Self:
        validate_review_decision(self.decision, self.correction_payload, self.comment)
        return self


class GeoRunReviewCreated(ContractModel):
    review: GeoRunReviewOut
    run_revision: NonNegative


class GeoCitationClassificationOut(ContractModel):
    analysis_revision_id: UUID
    citation_id: UUID
    source_category: GeoSourceCategory
    subject_id: UUID | None


class GeoAnalysisResult(ContractModel):
    analysis: GeoAnalysisRevisionOut
    mentions: list[GeoEntityMentionOut]
    recommendations: list[GeoRecommendationOut]
    claims: list[GeoClaimAssessmentOut]
    citations: list[GeoCitationClassificationOut]
    citation_classification_complete: bool


class GeoReviewedResults(ContractModel):
    """不借用机器行身份表示新增/移除的人工提及。"""

    mentions: list[GeoMentionCorrection]
    recommendations: list[GeoRecommendationCorrection]
    claims: list[GeoClaimAssessmentOut]
    citations: list[GeoCitationClassificationOut]
    citation_classification_complete: bool


class GeoReviewHistoryItem(ContractModel):
    review: GeoRunReviewOut
    is_current: bool


class GeoRunAnalysisDetail(ContractModel):
    selection: GeoAnalysisSelection
    revisions: list[GeoAnalysisResult]
    reviews: list[GeoReviewHistoryItem]
    effective_results: GeoReviewedResults | None
    review_required: bool
    review_gate_passed: bool
    available_actions: list[Literal["REVIEW"]]
