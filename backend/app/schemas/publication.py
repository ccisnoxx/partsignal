"""人工发布、异常待办与修复上下文 Schema。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, Field, HttpUrl, field_validator

from app.schemas.base import ContractModel, require_unique_items
from app.schemas.configuration import QueryTopicOut
from app.schemas.content import ContentTaskOut, ContentVersionOut
from app.schemas.product_facts import Confidentiality, FactVersionOut, ProductOut

PublicationAction = Literal[
    "mark-platform-review",
    "mark-published",
    "verify",
    "reject",
    "remove",
    "mark-verification-failed",
]


class PublicationPackage(ContractModel):
    content_version_id: uuid.UUID
    fact_version_id: uuid.UUID
    title: str
    body_markdown: str
    body_html: str
    body_text: str
    tags: list[str]
    content_hash: str


class PlatformAccountCreate(ContractModel):
    platform_profile_id: uuid.UUID
    label: str
    account_identifier: str


class PlatformAccountOut(PlatformAccountCreate):
    id: uuid.UUID
    is_active: bool


class PlatformAccountList(ContractModel):
    items: list[PlatformAccountOut]


class ManualPublicationCreate(ContractModel):
    content_version_id: uuid.UUID
    platform_account_id: uuid.UUID
    section_url: HttpUrl
    attachment_file_ids: Annotated[list[uuid.UUID], AfterValidator(require_unique_items)] = Field(
        default_factory=list, json_schema_extra={"uniqueItems": True}
    )


class PublicationCommand(ContractModel):
    actual_title: str | None = None
    final_url: HttpUrl | None = None
    published_at: datetime | None = None
    content_matches: bool | None = None
    comment: str
    attachment_file_ids: Annotated[list[uuid.UUID], AfterValidator(require_unique_items)] = Field(
        default_factory=list, json_schema_extra={"uniqueItems": True}
    )


class PublicationStatus(StrEnum):
    PENDING_MANUAL_PUBLISH = "PENDING_MANUAL_PUBLISH"
    PLATFORM_REVIEW = "PLATFORM_REVIEW"
    PUBLISHED = "PUBLISHED"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
    REMOVED = "REMOVED"
    VERIFICATION_FAILED = "VERIFICATION_FAILED"


class PublicationEvent(ContractModel):
    status: PublicationStatus
    comment: str
    actor_id: uuid.UUID
    created_at: datetime


class FileRecordOut(ContractModel):
    id: uuid.UUID
    category: Literal["EVIDENCE", "OPERATION_SCREENSHOT", "PUBLICATION_ASSET", "PLATFORM_LOGO"]
    original_filename: str
    object_key: str
    content_type: str
    size: int
    sha256: str
    access_level: Confidentiality
    status: Literal["PENDING", "VERIFIED", "FAILED", "ABORTED"]
    created_at: datetime
    verified_at: datetime | None = None


class PublicationRecordOut(ContractModel):
    id: uuid.UUID
    content_version_id: uuid.UUID
    task_id: uuid.UUID
    content_title: str
    content_version: int
    platform_profile_id: uuid.UUID
    platform_profile_name: str
    platform_account_id: uuid.UUID
    platform_account_label: str
    account_identifier: str
    section_url: HttpUrl
    actual_title: str | None = None
    final_url: HttpUrl | None = None
    published_at: datetime | None = None
    status: PublicationStatus
    content_hash: str
    created_by: uuid.UUID
    created_at: datetime
    status_events: list[PublicationEvent]
    attachments: list[FileRecordOut]
    available_actions: list[PublicationAction]


class PublicationRecordListItem(ContractModel):
    """发布列表一次查询所需的可扫描字段。"""

    id: uuid.UUID
    task_id: uuid.UUID
    content_version_id: uuid.UUID
    content_title: str
    content_version: int
    platform_profile_id: uuid.UUID
    platform_profile_name: str
    platform_account_id: uuid.UUID
    platform_account_label: str
    account_identifier: str
    status: PublicationStatus
    actual_title: str | None
    final_url: HttpUrl | None
    published_at: datetime | None
    created_at: datetime
    last_verification_at: datetime | None
    available_actions: list[PublicationAction]


class PublicationRecordList(ContractModel):
    items: list[PublicationRecordListItem]
    page: int
    page_size: int
    total: int


class PublicationCandidate(ContractModel):
    content_version: ContentVersionOut
    task_id: uuid.UUID
    platform_profile_id: uuid.UUID
    platform_profile_name: str
    matching_accounts: list[PlatformAccountOut]


class PublicationCandidateList(ContractModel):
    items: list[PublicationCandidate]


class PublicationAttentionStatus(StrEnum):
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"


class PublicationAttentionOut(ContractModel):
    id: uuid.UUID
    publication_record_id: uuid.UUID
    original_task_id: uuid.UUID
    trigger_status: Literal["REMOVED", "VERIFICATION_FAILED"]
    status: PublicationAttentionStatus
    revision: int
    opened_at: datetime
    resolved_at: datetime | None
    resolved_by: uuid.UUID | None
    resolution_comment: str | None
    repair_task_id: uuid.UUID | None
    available_actions: list[Literal["CREATE_REPAIR_TASK", "RESOLVE"]]


class PublicationAttentionListItem(ContractModel):
    """发布关注列表所需的记录、内容和平台上下文。"""

    id: uuid.UUID
    publication_record_id: uuid.UUID
    original_task_id: uuid.UUID
    content_title: str
    content_version: int
    platform_profile_id: uuid.UUID
    platform_profile_name: str
    platform_account_label: str
    final_url: HttpUrl | None
    trigger_status: Literal["REMOVED", "VERIFICATION_FAILED"]
    status: PublicationAttentionStatus
    revision: int
    opened_at: datetime
    resolved_at: datetime | None
    resolved_by: uuid.UUID | None
    resolution_comment: str | None
    repair_task_id: uuid.UUID | None
    available_actions: list[Literal["CREATE_REPAIR_TASK", "RESOLVE"]]


class PublicationAttentionList(ContractModel):
    items: list[PublicationAttentionListItem]


class PublicationStatusCounts(ContractModel):
    PENDING_MANUAL_PUBLISH: int = Field(ge=0)
    PLATFORM_REVIEW: int = Field(ge=0)
    PUBLISHED: int = Field(ge=0)
    VERIFIED: int = Field(ge=0)
    REJECTED: int = Field(ge=0)
    REMOVED: int = Field(ge=0)
    VERIFICATION_FAILED: int = Field(ge=0)


class PublicationPeriodMetrics(ContractModel):
    registered_published_count: int = Field(ge=0)
    verified_count: int = Field(ge=0)
    verification_rate: float | None = Field(ge=0, le=1)
    new_exception_count: int = Field(ge=0)
    current_unresolved_attention_count: int = Field(ge=0)


class PublicationExceptionCounts(ContractModel):
    rejected: int = Field(ge=0)
    removed_open: int = Field(ge=0)
    verification_failed_open: int = Field(ge=0)


class PublicationRecentActivity(ContractModel):
    publication_id: uuid.UUID
    content_title: str
    content_version: int
    platform_profile_name: str
    status: PublicationStatus
    occurred_at: datetime


class PublicationWorkbenchSummary(ContractModel):
    """发布工作台的全量当前快照、周期指标和最近事件。"""

    as_of: datetime
    window_start: datetime
    window_days: Literal[7, 30]
    current_status_counts: PublicationStatusCounts
    open_attention_count: int = Field(ge=0)
    period: PublicationPeriodMetrics
    exception_counts: PublicationExceptionCounts
    recent_activity: list[PublicationRecentActivity] = Field(max_length=5)


class VersionChange(ContractModel):
    field: str
    before: Any
    after: Any


class VersionDifference(ContractModel):
    from_id: uuid.UUID
    to_id: uuid.UUID
    changes: list[VersionChange]


class FactVersionCandidate(ContractModel):
    version: FactVersionOut
    difference: VersionDifference


class PublicationRepairContext(ContractModel):
    attention: PublicationAttentionOut
    publication: PublicationRecordOut
    original_task: ContentTaskOut
    product: ProductOut
    query_topic: QueryTopicOut | None
    platform_profile_id: uuid.UUID
    platform_profile_name: str
    original_fact_version: FactVersionOut
    fact_candidates: list[FactVersionCandidate]


class PublicationRepairTaskCreate(ContractModel):
    expected_attention_revision: int = Field(ge=0)
    fact_version_id: uuid.UUID


class ResolvePublicationAttentionRequest(ContractModel):
    expected_revision: int = Field(ge=0)
    resolution_comment: str = Field(min_length=1)

    @field_validator("resolution_comment")
    @classmethod
    def validate_resolution_comment(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("处置说明不能为空")
        return trimmed
