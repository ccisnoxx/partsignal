"""人工编辑上下文与一次性提交；环境始终来自不可变 Run 输入。"""

from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, Field, StrictBool, model_validator

from app.schemas.base import ContractModel
from app.schemas.geo_answers import GeoAnswerCitationInput, GeoRawPayloadSummary
from app.schemas.geo_prompt_variants import Revision
from app.schemas.geo_run_workflow import GeoRunWorkflowProjection
from app.schemas.geo_runs import GeoRunInputSnapshot, Sha256
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
    collected_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def distinct_citation_positions(self) -> Self:
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
    """首次提交的稳定回执；不代表当前 Run 状态或已经执行分析。"""

    run_id: UUID
    answer_snapshot_id: UUID
    answer_sha256: Sha256
    run_revision: Revision
    draft_revision: Revision
    collected_at: AwareDatetime
    submitted_at: AwareDatetime
    collection_status: Literal["COLLECTED"]
    analysis_dispatch: Literal["NOT_IMPLEMENTED"]
