"""发布工作、核验、发布成果与内容问题 Schema。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal, Self

from pydantic import AfterValidator, Field, HttpUrl, model_validator

from app.schemas.base import ContractModel, require_unique_items
from app.schemas.common import DeletionProjection
from app.schemas.configuration import QueryTopicOut
from app.schemas.content import ContentTaskOut, ContentVersionOut
from app.schemas.product_facts import Confidentiality, FactVersionOut, ProductOut

PublicationWorkAction = Literal[
    "UPDATE_PREPARATION",
    "MARK_PLATFORM_REVIEW",
    "REGISTER_RESULT",
    "VERIFY",
    "SWITCH_CONTENT_VERSION",
    "CLOSE",
]
PublishedArticleAction = Literal["OPEN_ISSUE", "PERMANENT_DELETE"]
PublishedContentIssueAction = Literal["CREATE_REPAIR_TASK", "RESOLVE"]


def normalize_nonblank(value: str) -> str:
    """去除业务文本两侧空白并拒绝空值。"""
    normalized = value.strip()
    if not normalized:
        raise ValueError("文本不能为空")
    return normalized


PlatformAccountLabel = Annotated[
    str,
    Field(min_length=1, max_length=160),
    AfterValidator(normalize_nonblank),
]
PlatformAccountIdentifier = Annotated[
    str,
    Field(min_length=1, max_length=200),
    AfterValidator(normalize_nonblank),
]
NonblankText = Annotated[str, Field(min_length=1), AfterValidator(normalize_nonblank)]
AttachmentFileIds = Annotated[
    list[uuid.UUID],
    AfterValidator(require_unique_items),
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
    label: PlatformAccountLabel
    account_identifier: PlatformAccountIdentifier


class PlatformAccountUpdate(ContractModel):
    label: PlatformAccountLabel
    account_identifier: PlatformAccountIdentifier
    expected_revision: int = Field(ge=0)


class PlatformAccountOut(PlatformAccountCreate):
    id: uuid.UUID
    is_active: bool
    workflow_stage: Literal["PLATFORM_DISABLED", "ACCOUNT_DISABLED", "OPERATIONAL"]
    primary_task: Literal["HANDLE_PLATFORM", "ENABLE_ACCOUNT", "MANAGE_ACCOUNT"]
    available_actions: list[Literal["UPDATE", "ENABLE", "DISABLE", "DELETE"]]
    deletion: DeletionProjection | None
    revision: int = Field(ge=0)


class PlatformAccountList(ContractModel):
    items: list[PlatformAccountOut]


class PublicationWorkStatus(StrEnum):
    PREPARING = "PREPARING"
    PLATFORM_REVIEW = "PLATFORM_REVIEW"
    AWAITING_VERIFICATION = "AWAITING_VERIFICATION"
    ACTION_REQUIRED = "ACTION_REQUIRED"
    COMPLETED = "COMPLETED"
    CLOSED = "CLOSED"


class PublicationVerificationOutcome(StrEnum):
    PASSED = "PASSED"
    FAILED = "FAILED"


class PublicationCloseReason(StrEnum):
    PLATFORM_REJECTED = "PLATFORM_REJECTED"
    BUSINESS_CANCELLED = "BUSINESS_CANCELLED"
    OTHER = "OTHER"


class PublishedContentIssueKind(StrEnum):
    PAGE_UNAVAILABLE = "PAGE_UNAVAILABLE"
    CONTENT_CHANGED = "CONTENT_CHANGED"
    OTHER = "OTHER"


class PublishedContentIssueStatus(StrEnum):
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"


class PublishedContentIssueResolution(StrEnum):
    RESTORED = "RESTORED"
    RETIRED = "RETIRED"


class PublicationWorkCreate(ContractModel):
    content_version_id: uuid.UUID
    platform_account_id: uuid.UUID


class PublicationPreparationUpdate(ContractModel):
    platform_account_id: uuid.UUID
    expected_revision: int = Field(ge=0)
    comment: NonblankText


class PublicationPlatformReviewRequest(ContractModel):
    expected_revision: int = Field(ge=0)
    comment: NonblankText


class PublicationResultUpdate(ContractModel):
    actual_title: NonblankText
    final_url: HttpUrl
    published_at: datetime
    expected_revision: int = Field(ge=0)
    comment: NonblankText
    attachment_file_ids: AttachmentFileIds = Field(
        default_factory=list,
        json_schema_extra={"uniqueItems": True},
    )


class PublicationVerificationCreate(ContractModel):
    outcome: PublicationVerificationOutcome
    content_matches: bool
    expected_revision: int = Field(ge=0)
    comment: str = ""

    @model_validator(mode="after")
    def validate_outcome(self) -> Self:
        """核验结果必须与正文匹配结论一致，失败必须说明原因。"""
        self.comment = self.comment.strip()
        if (self.outcome == PublicationVerificationOutcome.PASSED) != self.content_matches:
            raise ValueError("核验结果与正文匹配结论不一致")
        if self.outcome == PublicationVerificationOutcome.FAILED and not self.comment:
            raise ValueError("核验失败必须填写说明")
        return self


class PublicationWorkCloseRequest(ContractModel):
    reason: PublicationCloseReason
    comment: NonblankText
    expected_revision: int = Field(ge=0)


class PublicationContentVersionSwitchRequest(ContractModel):
    content_version_id: uuid.UUID
    expected_revision: int = Field(ge=0)
    comment: NonblankText


class PublishedContentIssueCreate(ContractModel):
    kind: PublishedContentIssueKind
    description: NonblankText


class PublishedContentIssueResolveRequest(ContractModel):
    outcome: PublishedContentIssueResolution
    comment: NonblankText
    expected_revision: int = Field(ge=0)


class PublishedContentRepairTaskCreate(ContractModel):
    fact_version_id: uuid.UUID
    expected_issue_revision: int = Field(ge=0)


class FileRecordOut(ContractModel):
    id: uuid.UUID
    category: Literal["EVIDENCE", "OPERATION_SCREENSHOT", "PUBLICATION_ASSET", "PLATFORM_LOGO"]
    original_filename: str
    object_key: str
    content_type: str
    size: int
    sha256: str
    access_level: Confidentiality
    status: Literal["PENDING", "VERIFIED", "FAILED", "ABORTED", "DELETING", "DELETED"]
    created_at: datetime
    verified_at: datetime | None = None


class PublicationWorkEventOut(ContractModel):
    id: uuid.UUID
    action: Literal[
        "CREATED",
        "PREPARATION_UPDATED",
        "PLATFORM_REVIEW_MARKED",
        "RESULT_REGISTERED",
        "VERIFICATION_FAILED",
        "CONTENT_VERSION_CHANGED",
        "COMPLETED",
        "CLOSED",
    ]
    from_status: PublicationWorkStatus | None
    to_status: PublicationWorkStatus
    from_content_version_id: uuid.UUID | None
    to_content_version_id: uuid.UUID | None
    comment: str
    actor_id: uuid.UUID
    created_at: datetime


class PublicationVerificationOut(ContractModel):
    id: uuid.UUID
    content_version_id: uuid.UUID
    outcome: PublicationVerificationOutcome
    actual_title_snapshot: str
    final_url_snapshot: HttpUrl
    published_at_snapshot: datetime
    comment: str
    actor_id: uuid.UUID
    created_at: datetime


class PublicationReadyItem(ContractModel):
    content_version: ContentVersionOut
    task_id: uuid.UUID
    platform_profile_id: uuid.UUID
    platform_profile_name: str
    matching_accounts: list[PlatformAccountOut]
    available_actions: list[Literal["START"]]
    primary_task: Literal["START_PUBLICATION"]


class PublicationReadyItemList(ContractModel):
    items: list[PublicationReadyItem]


class PublicationWorkListItem(ContractModel):
    id: uuid.UUID
    task_id: uuid.UUID
    content_version_id: uuid.UUID
    content_title: str
    content_version: int
    platform_profile_id: uuid.UUID | None
    platform_profile_name: str
    platform_account_id: uuid.UUID | None
    platform_account_label: str
    account_identifier: str
    actual_title: str | None
    final_url: HttpUrl | None
    published_at: datetime | None
    status: PublicationWorkStatus
    revision: int = Field(ge=0)
    close_reason: PublicationCloseReason | None
    close_comment: str | None
    created_at: datetime
    updated_at: datetime
    latest_verification_outcome: PublicationVerificationOutcome | None
    latest_verification_at: datetime | None
    workflow_stage: Literal[
        "PREPARING",
        "PLATFORM_REVIEW",
        "AWAITING_VERIFICATION",
        "ACTION_REQUIRED",
        "COMPLETED",
        "CLOSED",
    ]
    primary_task: Literal[
        "CONTINUE_PREPARATION",
        "REGISTER_RESULT",
        "RUN_FIRST_VERIFICATION",
        "FIX_AND_REVERIFY",
        "VIEW_COMPLETION",
        "VIEW_CLOSURE",
    ]
    available_actions: list[PublicationWorkAction]


class PublicationWorkOut(PublicationWorkListItem):
    content_hash: str
    closed_by: uuid.UUID | None
    closed_at: datetime | None
    created_by: uuid.UUID
    events: list[PublicationWorkEventOut]
    verifications: list[PublicationVerificationOut]
    attachments: list[FileRecordOut]


class PublicationWorkList(ContractModel):
    items: list[PublicationWorkListItem]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0)


class PublishedContentIssueHistoryItem(ContractModel):
    id: uuid.UUID
    kind: PublishedContentIssueKind
    description: str
    status: PublishedContentIssueStatus
    opened_at: datetime
    resolved_at: datetime | None
    resolution_outcome: PublishedContentIssueResolution | None
    resolution_comment: str | None


class PublishedArticleListItem(ContractModel):
    id: uuid.UUID
    task_id: uuid.UUID
    product_id: uuid.UUID
    content_version_id: uuid.UUID
    content_title: str
    content_version: int
    platform_profile_id: uuid.UUID | None
    platform_profile_name: str
    platform_account_id: uuid.UUID | None
    platform_account_label: str
    account_identifier: str
    actual_title: str
    final_url: HttpUrl
    published_at: datetime
    verified_at: datetime
    has_open_issue: bool
    open_issue_id: uuid.UUID | None
    retired: bool
    revision: int = Field(ge=0)
    workflow_stage: Literal["HEALTHY", "OPEN_ISSUE", "RETIRED"]
    primary_task: Literal["START_PRODUCT_OBSERVATION", "HANDLE_CONTENT_ISSUE", "VIEW_HISTORY"]
    available_actions: list[PublishedArticleAction]
    deletion: DeletionProjection | None


class PublishedArticleOut(PublishedArticleListItem):
    content_hash: str
    verification: PublicationVerificationOut
    issues: list[PublishedContentIssueHistoryItem]


class PublishedArticleList(ContractModel):
    items: list[PublishedArticleListItem]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0)


class PublishedArticlePermanentDeletionCounts(ContractModel):
    """管理员删除发布成果前展示的内部记录范围。"""

    publication_events: int = Field(ge=0)
    publication_verifications: int = Field(ge=0)
    published_content_issues: int = Field(ge=0)
    detached_repair_tasks: int = Field(ge=0)
    attachment_relations: int = Field(ge=0)


class PublishedArticlePermanentDeletionPreview(ContractModel):
    article_id: uuid.UUID
    revision: int = Field(ge=0)
    counts: PublishedArticlePermanentDeletionCounts
    external_url: HttpUrl
    confirmation_text: Literal["永久删除"]


class PublishedArticlePermanentDeleteRequest(ContractModel):
    expected_revision: int = Field(ge=0)
    confirmation_text: str


class PublishedContentIssueListItem(PublishedContentIssueHistoryItem):
    published_article_id: uuid.UUID
    content_title: str
    platform_profile_name: str
    actual_title: str
    final_url: HttpUrl
    revision: int = Field(ge=0)
    repair_task_id: uuid.UUID | None
    workflow_stage: Literal["OPEN", "REPAIRING", "AWAITING_RESOLUTION", "RESOLVED"]
    primary_task: Literal[
        "HANDLE_CONTENT_ISSUE", "CONTINUE_REPAIR", "CONFIRM_RESOLUTION", "VIEW_RESOLUTION"
    ]
    available_actions: list[PublishedContentIssueAction]


class PublishedContentIssueOut(PublishedContentIssueListItem):
    opened_by: uuid.UUID
    resolved_by: uuid.UUID | None
    article: PublishedArticleListItem


class PublishedContentIssueList(ContractModel):
    items: list[PublishedContentIssueListItem]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0)


class PublicationWorkbenchSummary(ContractModel):
    ready_count: int = Field(ge=0)
    active_count: int = Field(ge=0)
    awaiting_verification_count: int = Field(ge=0)
    action_required_count: int = Field(ge=0)
    open_issue_count: int = Field(ge=0)


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


class PublishedContentRepairContext(ContractModel):
    issue: PublishedContentIssueOut
    article: PublishedArticleOut
    original_task: ContentTaskOut
    product: ProductOut
    query_topic: QueryTopicOut | None
    platform_profile_id: uuid.UUID
    platform_profile_name: str
    original_fact_version: FactVersionOut
    fact_candidates: list[FactVersionCandidate]
