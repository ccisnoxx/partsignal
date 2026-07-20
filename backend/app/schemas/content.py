"""内容任务、生成、版本和审核 Schema。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field, HttpUrl, model_validator

from app.schemas.base import ContractModel
from app.schemas.configuration import PlatformLogoOut
from app.schemas.product_facts import Confidentiality, FactVersionOut

GenerationJobStatus = Literal["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]


class ContentTaskCreate(ContractModel):
    product_id: uuid.UUID
    fact_version_id: uuid.UUID
    platform_profile_version_id: uuid.UUID
    target_audience: str
    content_angle: str
    conversion_goal: str
    desired_format: str
    desired_length_min: int = Field(ge=1)
    desired_length_max: int = Field(ge=1)
    canonical_url: HttpUrl

    @model_validator(mode="after")
    def validate_length(self) -> ContentTaskCreate:
        if self.desired_length_min > self.desired_length_max:
            raise ValueError("期望正文最小长度不能大于最大长度")
        return self


class ContentTaskOut(ContentTaskCreate):
    id: uuid.UUID
    query_topic_id: uuid.UUID | None
    platform_type_id: uuid.UUID | None
    platform_type_snapshot: dict[str, Any] | None
    user_prompt_markdown: str
    generation_data_classification: Confidentiality | None
    generation_data_classified_by: uuid.UUID | None
    generation_data_classified_at: datetime | None
    source_publication_attention_id: uuid.UUID | None
    available_actions: list[Literal["CANCEL"]]
    status: Literal["OPEN", "COMPLETED", "CANCELLED"]
    revision: int
    created_by: uuid.UUID
    created_at: datetime


class ContentTaskProductSummary(ContractModel):
    id: uuid.UUID
    brand: str
    part_number: str


class ContentTaskPlatformSummary(ContractModel):
    id: uuid.UUID
    name: str
    website_url: HttpUrl | None
    logo: PlatformLogoOut | None


class ContentTaskListItem(ContentTaskOut):
    product: ContentTaskProductSummary
    platform: ContentTaskPlatformSummary
    latest_generation_status: GenerationJobStatus | None


class ContentTaskList(ContractModel):
    items: list[ContentTaskListItem]


class ContentTaskUserPromptUpdate(ContractModel):
    expected_revision: int = Field(ge=0)
    user_prompt_markdown: str
    generation_data_classification: Confidentiality


class GenerationOptionModel(ContractModel):
    id: uuid.UUID
    channel_id: uuid.UUID
    channel_name: str
    display_name: str
    model_id: str


class GenerationOptions(ContractModel):
    platform_profile_version_id: uuid.UUID
    platform_profile_name: str
    platform_type_id: uuid.UUID
    platform_type_name: str
    platform_type_slug: str
    system_prompt_markdown: str
    humanization_prompt_configured: bool
    models: list[GenerationOptionModel]


class GenerationJobCreate(ContractModel):
    ai_model_id: uuid.UUID


class GenerationJobOut(ContractModel):
    id: uuid.UUID
    content_task_id: uuid.UUID
    job_type: Literal["GENERATE", "HUMANIZE"]
    source_content_version_id: uuid.UUID | None
    status: GenerationJobStatus
    attempt_count: int
    content_version_id: uuid.UUID | None = None
    retry_of_id: uuid.UUID | None = None
    error_code: str | None = None
    error_summary: str | None = None
    provider_request_id: str | None = None
    response_duration_ms: int | None = Field(default=None, ge=0)
    prompt_tokens: int | None = Field(default=None, ge=0)
    completion_tokens: int | None = Field(default=None, ge=0)
    total_tokens: int | None = Field(default=None, ge=0)
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class GenerationJobList(ContractModel):
    items: list[GenerationJobOut]


class GenerationSnapshot(ContractModel):
    adapter_name: str
    contract_version: str
    channel: dict[str, Any]
    model: dict[str, Any]
    platform_type: dict[str, Any]
    # 0014 之前的不可变历史快照没有具体平台字段；新作业必须写入。
    platform_profile: dict[str, Any] | None = None
    system_message: str
    user_prompt_markdown: str
    # 0012 之前的不可变历史快照没有分级字段；新建或重试第三方作业必须显式校验。
    generation_data_classification: Confidentiality | None = None
    generation_data_classified_by: uuid.UUID | None = None
    generation_data_classified_at: datetime | None = None
    approved_facts: dict[str, Any]
    task_requirements: dict[str, Any]
    user_message: str


class HumanizationPromptSnapshot(ContractModel):
    revision: int = Field(ge=0)
    template_markdown: str = Field(min_length=1)


class HumanizationSourceContent(ContractModel):
    id: uuid.UUID
    task_id: uuid.UUID
    fact_version_id: uuid.UUID
    version: int = Field(ge=1)
    content_hash: str
    title: str
    summary: str
    body_markdown: str
    tags: list[str]


class HumanizationSnapshot(ContractModel):
    """一次自然化调用的完整不可变输入。"""

    adapter_name: Literal["openai-compatible-chat-completions"]
    contract_version: Literal["humanization-json-v1"]
    channel: dict[str, Any]
    model: dict[str, Any]
    humanization_prompt: HumanizationPromptSnapshot
    source_content: HumanizationSourceContent
    source_generation_job_id: uuid.UUID
    user_prompt_markdown: str
    generation_data_classification: Confidentiality
    generation_data_classified_by: uuid.UUID
    generation_data_classified_at: datetime
    approved_facts: dict[str, Any]
    task_requirements: dict[str, Any]
    system_message: str
    user_message: str


class GenerationJobDetail(GenerationJobOut):
    input_snapshot: GenerationSnapshot | HumanizationSnapshot

    @model_validator(mode="after")
    def validate_snapshot_type(self) -> GenerationJobDetail:
        if self.job_type == "GENERATE" and not isinstance(self.input_snapshot, GenerationSnapshot):
            raise ValueError("原始生成作业必须使用 GenerationSnapshot")
        if self.job_type == "HUMANIZE" and not isinstance(
            self.input_snapshot, HumanizationSnapshot
        ):
            raise ValueError("自然化作业必须使用 HumanizationSnapshot")
        return self


class QualityIssue(ContractModel):
    code: str
    severity: Literal["WARNING", "BLOCKING"]
    message: str


class ContentVersionOut(ContractModel):
    id: uuid.UUID
    task_id: uuid.UUID
    fact_version_id: uuid.UUID
    source_job_id: uuid.UUID | None
    based_on_id: uuid.UUID | None
    version: int
    source_type: Literal["AI", "HUMAN"]
    title: str
    summary: str
    body_markdown: str
    tags: list[str]
    content_hash: str
    status: Literal["DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SUPERSEDED"]
    revision: int
    quality_issues: list[QualityIssue]
    created_by: uuid.UUID
    created_at: datetime


class ContentRevisionCreate(ContractModel):
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    body_markdown: str = Field(min_length=1)
    tags: list[str]
    change_summary: str = Field(min_length=1)


class ContentVersionList(ContractModel):
    items: list[ContentVersionOut]


class DiffLine(ContractModel):
    kind: Literal["EQUAL", "ADD", "DELETE"]
    old_line: int | None = None
    new_line: int | None = None
    text: str


class ContentDiff(ContractModel):
    left_id: uuid.UUID
    right_id: uuid.UUID
    lines: list[DiffLine]


class ActorSummary(ContractModel):
    id: uuid.UUID
    username: str
    display_name: str


class ReviewRecord(ContractModel):
    id: uuid.UUID
    target_id: uuid.UUID
    target_version: int
    action: str
    comment: str
    actor: ActorSummary
    created_at: datetime


class ReviewEvidenceStatus(ContractModel):
    client_key: str
    file_id: uuid.UUID | None
    file_status: Literal["PENDING", "VERIFIED", "FAILED", "ABORTED"] | None


class FactReviewContext(ContractModel):
    fact_version: FactVersionOut
    evidence_statuses: list[ReviewEvidenceStatus]
    available_actions: list[Literal["SUBMIT", "APPROVE", "REQUEST_CHANGES", "RETIRE"]]
    review_history: list[ReviewRecord]


class GenerationTrace(ContractModel):
    job_id: uuid.UUID
    input_snapshot: GenerationSnapshot


class HumanizationTrace(ContractModel):
    job_id: uuid.UUID
    source_content_version_id: uuid.UUID
    input_snapshot: HumanizationSnapshot


class ContentReviewContext(ContractModel):
    content: ContentVersionOut
    task: ContentTaskOut
    fact_version: FactVersionOut
    evidence_statuses: list[ReviewEvidenceStatus]
    diff: ContentDiff | None
    generation_trace: GenerationTrace | None
    humanization_traces: list[HumanizationTrace]
    available_actions: list[Literal["SUBMIT_REVIEW", "APPROVE", "REQUEST_CHANGES"]]
    review_history: list[ReviewRecord]
