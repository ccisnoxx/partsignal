"""人工发布、异常待办与修复上下文 Schema。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, Field, HttpUrl, field_validator, model_validator

from app.schemas.base import ContractModel, require_unique_items
from app.schemas.configuration import PlatformProfileVersionOut, QueryTopicOut
from app.schemas.content import ContentTaskOut, ContentVersionOut
from app.schemas.product_facts import Confidentiality, FactVersionOut, ProductOut


class PublicationPackage(ContractModel):
    content_version_id: uuid.UUID
    fact_version_id: uuid.UUID
    title: str
    body_markdown: str
    body_html: str
    body_text: str
    tags: list[str]
    canonical_url: HttpUrl
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
    attachment_file_ids: Annotated[
        list[uuid.UUID], AfterValidator(require_unique_items)
    ] = Field(default_factory=list, json_schema_extra={"uniqueItems": True})


class PublicationCommand(ContractModel):
    actual_title: str | None = None
    final_url: HttpUrl | None = None
    published_at: datetime | None = None
    content_matches: bool | None = None
    comment: str


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
    category: Literal["EVIDENCE", "OPERATION_SCREENSHOT", "PUBLICATION_ASSET"]
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
    platform_account_id: uuid.UUID
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
    available_actions: list[
        Literal[
            "mark-platform-review",
            "mark-published",
            "verify",
            "reject",
            "remove",
            "mark-verification-failed",
        ]
    ]


class PublicationRecordList(ContractModel):
    items: list[PublicationRecordOut]
    page: int
    page_size: int
    total: int


class PublicationCandidate(ContractModel):
    content_version: ContentVersionOut
    task_id: uuid.UUID
    platform_profile_id: uuid.UUID
    platform_profile_name: str
    platform_profile_version_id: uuid.UUID
    platform_profile_version: int
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


class PublicationAttentionList(ContractModel):
    items: list[PublicationAttentionOut]


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


class PlatformVersionCandidate(ContractModel):
    version: PlatformProfileVersionOut
    difference: VersionDifference


class PublicationRepairDefaults(ContractModel):
    target_audience: str
    content_angle: str
    conversion_goal: str
    desired_format: str
    desired_length_min: int
    desired_length_max: int
    canonical_url: HttpUrl


class PublicationRepairContext(ContractModel):
    attention: PublicationAttentionOut
    publication: PublicationRecordOut
    original_task: ContentTaskOut
    product: ProductOut
    query_topic: QueryTopicOut
    platform_profile_id: uuid.UUID
    platform_profile_name: str
    original_fact_version: FactVersionOut
    fact_candidates: list[FactVersionCandidate]
    original_platform_version: PlatformProfileVersionOut
    platform_candidates: list[PlatformVersionCandidate]
    defaults: PublicationRepairDefaults


class PublicationRepairTaskCreate(ContractModel):
    expected_attention_revision: int = Field(ge=0)
    fact_version_id: uuid.UUID
    platform_profile_version_id: uuid.UUID
    target_audience: str = Field(min_length=1)
    content_angle: str = Field(min_length=1)
    conversion_goal: str = Field(min_length=1)
    desired_format: str = Field(min_length=1)
    desired_length_min: int = Field(ge=1)
    desired_length_max: int = Field(ge=1)
    canonical_url: HttpUrl

    @model_validator(mode="after")
    def validate_length(self) -> PublicationRepairTaskCreate:
        if self.desired_length_min > self.desired_length_max:
            raise ValueError("期望正文最小长度不能大于最大长度")
        return self


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
