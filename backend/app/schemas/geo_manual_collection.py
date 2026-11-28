"""人工编辑上下文与一次性提交；环境始终来自不可变 Run 输入。"""

from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, Field, StrictBool, model_validator

from app.schemas.base import ContractModel
from app.schemas.geo_answers import (
    GeoAnswerCitationInput,
    GeoCitationObservation,
    GeoRawPayloadSummary,
)
from app.schemas.geo_daily_checklist import (
    GeoCitationPublicationLinkOut,
    GeoManualInlineReview,
)
from app.schemas.geo_prompt_variants import Revision
from app.schemas.geo_run_workflow import GeoRunWorkflowProjection
from app.schemas.geo_runs import GeoRunInputSnapshot, GeoRunStatus, Sha256
from app.schemas.geo_surface_management import GeoProfileActivationBlocker

DraftText = Annotated[str, Field(strict=True, max_length=1048576, pattern=r"^[^\x00]*$")]
SourceProduct = Annotated[
    str,
    Field(strict=True, min_length=1, max_length=160, pattern=r"^[^\s\x00](?:[^\x00]*[^\s\x00])?$"),
]
SourceModel = Annotated[
    str,
    Field(strict=True, min_length=1, max_length=200, pattern=r"^[^\s\x00](?:[^\x00]*[^\s\x00])?$"),
]


class GeoManualCitationInput(GeoAnswerCitationInput):
    extraction_source: Literal["MANUAL"] = "MANUAL"


class GeoManualObservationDraft(ContractModel):
    answer_text: DraftText = ""
    answer_format: Literal["TEXT", "MARKDOWN", "HTML_TEXT"] = "TEXT"
    source_product: SourceProduct | None = None
    source_model: SourceModel | None = None
    source_version: SourceModel | None = None
    web_search_observed: StrictBool | None = None
    raw_payload_summary: GeoRawPayloadSummary = Field(default_factory=GeoRawPayloadSummary)
    raw_payload_file_id: UUID | None = None
    screenshot_file_id: UUID | None = None
    citations: list[GeoManualCitationInput] = Field(default_factory=list, max_length=1000)
    citation_observation: GeoCitationObservation | None = Field(
        default=None,
        description="草稿可未记录；新人工正式提交必须显式声明。旧请求仅可原样重放已有幂等回执，不补造观察事实。",
    )
    collected_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def distinct_citation_positions(self) -> Self:
        if self.citation_observation is not None:
            self.citation_observation.validate_citation_count(len(self.citations))
        if len({value.position for value in self.citations}) != len(self.citations):
            raise ValueError("引用的实际位置不能重复")
        return self


class GeoManualDraftSave(ContractModel):
    expected_draft_revision: Revision
    draft: GeoManualObservationDraft


class GeoManualObservationSubmit(GeoManualObservationDraft):
    expected_draft_revision: Revision
    answer_text: DraftText
    collected_at: AwareDatetime
    actual_prompt_text: str | None = Field(default=None, max_length=8000)
    inline_review: GeoManualInlineReview | None = None


class GeoManualDraftOut(ContractModel):
    run_id: UUID
    draft_revision: Revision
    draft: GeoManualObservationDraft
    updated_by: UUID
    updated_at: datetime


class GeoManualEntryContext(GeoRunWorkflowProjection):
    run_id: UUID
    batch_id: UUID
    run_revision: Revision
    input_snapshot: GeoRunInputSnapshot
    require_screenshot: StrictBool
    draft_revision: Revision
    draft: GeoManualDraftOut | None
    collection_blockers: list[GeoProfileActivationBlocker]


class GeoManualObservationSubmitted(ContractModel):
    """人工提交回执：记录原始回答冻结结果及同步确定性分析/复核状态。"""

    run_id: UUID
    answer_snapshot_id: UUID
    answer_sha256: Sha256
    run_revision: Revision
    draft_revision: Revision
    collected_at: AwareDatetime
    submitted_at: AwareDatetime
    collection_status: Literal["COLLECTED"]
    run_status: GeoRunStatus | None = None
    analysis_revision_id: UUID | None = None
    review_id: UUID | None = None
    citation_links: list[GeoCitationPublicationLinkOut] | None = None
    analysis_dispatch: Literal[
        "NOT_IMPLEMENTED", "SYNC_COMPLETED", "SYNC_NEEDS_REVIEW", "DISPATCHED"
    ]
