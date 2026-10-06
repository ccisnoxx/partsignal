"""GEO-306 契约草案；先落根 OpenAPI，再接线运行时。"""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field

from app.schemas.base import ContractModel
from app.schemas.common import SignedUrl
from app.schemas.geo_answers import GeoAnswerCitationOut, GeoAnswerSnapshotOut
from app.schemas.geo_plan_preview import GeoKnownCostTotal
from app.schemas.geo_run_workflow import GeoBatchWorkflowProjection, GeoRunWorkflowProjection
from app.schemas.geo_runs import (
    GeoBatchStatus,
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
    assessment: Literal["NOT_IMPLEMENTED"]
    metric_eligible: None
    reason_code: Literal["METRIC_ELIGIBILITY_NOT_IMPLEMENTED"]
    unavailable_sections: list[Literal["ANALYSIS", "REVIEW", "METRICS", "OPPORTUNITIES", "RETEST"]]


class GeoRunDetail(ContractModel):
    run: GeoRunListItem
    batch: GeoBatchListItem
    answer: GeoAnswerSnapshotOut | None
    citations: list[GeoAnswerCitationOut]
    evidence_files: list[GeoRunEvidenceFile]
    attempts: list[GeoRunAttemptSummary]
    timeline: list[GeoRunTimelineEvent]
    data_quality: GeoRunDataQuality
    as_of: AwareDatetime
