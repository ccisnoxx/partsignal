"""Batch/Run 稳定读模型；质量与后续导航均为服务端一致快照投影。"""

from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, Field, model_validator

from app.schemas.base import ContractModel
from app.schemas.common import SignedUrl
from app.schemas.geo_answer_insights import InsightMetric
from app.schemas.geo_answers import GeoAnswerCitationOut, GeoAnswerSnapshotOut
from app.schemas.geo_insights import GeoOverviewFilters
from app.schemas.geo_manual_cancellation import GeoManualRunCancellationOut
from app.schemas.geo_metric_values import MetricExclusion
from app.schemas.geo_plan_preview import GeoKnownCostTotal
from app.schemas.geo_reviews import GeoRunAnalysisDetail
from app.schemas.geo_run_workflow import GeoBatchWorkflowProjection, GeoRunWorkflowProjection
from app.schemas.geo_runs import (
    GeoBatchTriggerType,
    GeoObservationBatchOut,
    GeoObservationRunOut,
    GeoRunErrorCode,
    GeoRunErrorStage,
    GeoRunStatus,
    NonNegative,
    Positive,
)
from app.schemas.geo_surface_management import GeoProfileActivationBlocker


class GeoRunStatusCounts(ContractModel):
    pending: NonNegative
    running: NonNegative
    collected: NonNegative
    analyzing: NonNegative
    needs_review: NonNegative
    completed: NonNegative
    failed: NonNegative
    cancelled: NonNegative
    budget_blocked: NonNegative


class GeoRunCostSummary(ContractModel):
    known_attempt_count: NonNegative
    unknown_attempt_count: NonNegative
    known_costs: list[GeoKnownCostTotal]


class GeoBatchSummary(ContractModel):
    requested_run_count: Positive
    attempt_count: Positive
    status_counts: GeoRunStatusCounts
    pending_manual_count: NonNegative
    cost: GeoRunCostSummary


class GeoBatchListItem(GeoBatchWorkflowProjection):
    id: UUID
    plan_id: UUID | None
    plan_name: str
    plan_revision: NonNegative | None
    trigger_type: GeoBatchTriggerType
    revision: NonNegative
    created_by: UUID | None
    scheduled_for: AwareDatetime | None
    created_at: AwareDatetime
    started_at: AwareDatetime | None
    finished_at: AwareDatetime | None
    summary: GeoBatchSummary


class GeoBatchListPage(ContractModel):
    items: list[GeoBatchListItem]
    total: NonNegative
    page: Positive
    page_size: Literal[10, 20, 50]
    as_of: AwareDatetime


class GeoBatchDetail(ContractModel):
    batch: GeoObservationBatchOut
    summary: GeoBatchSummary
    workflow: GeoBatchWorkflowProjection
    as_of: AwareDatetime


class GeoRunListItem(GeoObservationRunOut, GeoRunWorkflowProjection):
    answer_snapshot_id: UUID | None
    collection_eligible: bool
    collection_blockers: list[GeoProfileActivationBlocker]
    frozen_binding_matches: bool
    is_latest_attempt: bool


class GeoRunListPage(ContractModel):
    items: list[GeoRunListItem]
    total: NonNegative
    page: Positive
    page_size: Literal[10, 20, 50]
    as_of: AwareDatetime


class GeoRunAttemptSummary(ContractModel):
    id: UUID
    attempt_no: Positive
    previous_attempt_id: UUID | None
    status: GeoRunStatus
    error_stage: GeoRunErrorStage | None
    error_code: GeoRunErrorCode | None
    error_summary: str | None
    created_at: AwareDatetime
    started_at: AwareDatetime | None
    collected_at: AwareDatetime | None
    finished_at: AwareDatetime | None


class GeoRunTimelineEvent(ContractModel):
    run_id: UUID
    attempt_no: Positive
    event: Literal["CREATED", "STARTED", "COLLECTED", "FINISHED"]
    occurred_at: AwareDatetime


class GeoRunEvidenceFile(ContractModel):
    id: UUID
    kind: Literal["SCREENSHOT", "RAW_PAYLOAD"]
    content_type: str
    size: Annotated[int, Field(strict=True, ge=1)]
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    access_level: Literal["INTERNAL", "RESTRICTED"]
    download: SignedUrl


class GeoRunDataQuality(ContractModel):
    """与 EFFECTIVE 策略的总览同口径；合格不承诺分母非零或满足样本门槛。"""

    assessment: Literal["ELIGIBLE", "EXCLUDED"]
    metric_eligible: bool
    exclusion_reasons: list[MetricExclusion]
    current_analysis_status: Literal["UNAVAILABLE", "COMPLETED"]
    review_status: Literal["NOT_READY", "REQUIRED", "NOT_REQUIRED", "REVIEWED"]
    evidence_complete: bool
    cost_recorded: bool
    model_version_known: bool
    subjects: list["GeoRunSubjectQuality"] = Field(
        description="按冻结监测对象给出现有业务指标资格；缺少指标专项事实显式排除，不填零。"
    )

    @model_validator(mode="after")
    def eligibility_consistent(self) -> Self:
        if self.metric_eligible != (not self.exclusion_reasons) or self.metric_eligible != (
            self.assessment == "ELIGIBLE"
        ):
            raise ValueError("通用指标资格必须与评估及排除原因一致")
        return self


class GeoRunMetricQualification(ContractModel):
    metric_code: (
        InsightMetric | Literal["answer_coverage", "product_mention", "top_recommendation_rate"]
    )
    eligible: bool
    exclusion_reasons: list[MetricExclusion]


class GeoRunSubjectQuality(ContractModel):
    subject_id: UUID
    display_name: str
    metrics: list[GeoRunMetricQualification]


class GeoRunOpportunityLink(ContractModel):
    opportunity_id: UUID
    source_roles: list[Literal["TRIGGER", "SUPPORTING", "BASELINE", "RETEST"]]


class GeoRunRetestLink(ContractModel):
    opportunity_id: UUID
    baseline_id: UUID
    retest_batch_id: UUID | None


class GeoRunNavigation(ContractModel):
    insights: GeoOverviewFilters | None = Field(
        description=(
            "最新尝试创建日 UTC、冻结问题/配置的洞察范围，包含该范围全部对象；"
            "不保证该运行进入各指标分母。"
        )
    )
    insights_unavailable_reason: Literal["SUPERSEDED_ATTEMPT"] | None
    opportunities: list[GeoRunOpportunityLink] = Field(
        description="该运行真实来源记录关联的机会，含历史版本。"
    )
    retests: list[GeoRunRetestLink] = Field(
        description="该运行所在批次的实际基线/复测请求；null 批次表示尚未发起复测。"
    )


class GeoRunDetail(ContractModel):
    cancellation: GeoManualRunCancellationOut | None
    run: GeoRunListItem
    batch: GeoBatchListItem
    answer: GeoAnswerSnapshotOut | None
    citations: list[GeoAnswerCitationOut]
    evidence_files: list[GeoRunEvidenceFile]
    attempts: list[GeoRunAttemptSummary]
    timeline: list[GeoRunTimelineEvent]
    data_quality: GeoRunDataQuality
    navigation: GeoRunNavigation
    analysis: GeoRunAnalysisDetail
    as_of: AwareDatetime
