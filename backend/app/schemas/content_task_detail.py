"""Content Task Detail 跨域紧凑只读投影。"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import Field, HttpUrl

from app.schemas.base import ContractModel
from app.schemas.common import DeletionProjection
from app.schemas.configuration import PlatformLogoOut
from app.schemas.content import (
    ActorSummary,
    ContentTaskAction,
    ContentTaskPrimaryTask,
    ContentTaskWorkflowStage,
    GenerationJobStatus,
)
from app.schemas.product_facts import Confidentiality, FactVersionStatus, ProductStatus
from app.schemas.publication import (
    PublicationWorkStatus,
    PublishedContentIssueKind,
    PublishedContentIssueStatus,
)

ContentVersionStatus = Literal[
    "DRAFT",
    "PENDING_REVIEW",
    "CHANGES_REQUESTED",
    "APPROVED",
    "SUPERSEDED",
    "ABANDONED",
]
ContentTaskDetailActivityKind = Literal[
    "TASK",
    "GENERATION",
    "CONTENT_VERSION",
    "CONTENT_REVIEW",
    "PUBLICATION",
]
ContentTaskDetailActivityTargetKind = Literal[
    "CONTENT_TASK",
    "GENERATION_JOB",
    "CONTENT_VERSION",
    "PUBLICATION_WORK",
]


class ContentTaskDetailGeoContentDeclineItem(ContractModel):
    title: str
    content_platform: str


class ContentTaskDetailGeoContentDeclineBasis(ContractModel):
    rule_code: Literal["CONTENT_DECLINE"]
    item: ContentTaskDetailGeoContentDeclineItem


class ContentTaskDetailGeoLongUnmentionedItem(ContractModel):
    title: str
    unmentioned_days: int = Field(ge=0)


class ContentTaskDetailGeoLongUnmentionedBasis(ContractModel):
    rule_code: Literal["LONG_UNMENTIONED"]
    item: ContentTaskDetailGeoLongUnmentionedItem


class ContentTaskDetailGeoQuestionCoverageItem(ContractModel):
    canonical_question: str
    geo_platform: str


class ContentTaskDetailGeoQuestionCoverageBasis(ContractModel):
    rule_code: Literal["QUESTION_COVERAGE_GAP"]
    item: ContentTaskDetailGeoQuestionCoverageItem


ContentTaskDetailGeoBasis = Annotated[
    ContentTaskDetailGeoContentDeclineBasis
    | ContentTaskDetailGeoLongUnmentionedBasis
    | ContentTaskDetailGeoQuestionCoverageBasis,
    Field(discriminator="rule_code"),
]


class ContentTaskDetailTask(ContractModel):
    id: uuid.UUID
    identifier: str = Field(pattern=r"^CT-[0-9A-F]{8}$")
    status: Literal["OPEN", "COMPLETED", "CANCELLED"]
    workflow_stage: ContentTaskWorkflowStage
    primary_task: ContentTaskPrimaryTask
    available_actions: list[ContentTaskAction]
    deletion: DeletionProjection | None
    revision: int = Field(ge=0)
    created_by: uuid.UUID
    created_at: datetime
    archived_at: datetime | None


class ContentTaskDetailProduct(ContractModel):
    id: uuid.UUID
    brand: str
    part_number: str
    status: ProductStatus


class ContentTaskDetailPlatform(ContractModel):
    id: uuid.UUID | None
    name: str
    website_url: HttpUrl | None
    logo: PlatformLogoOut | None


class ContentTaskDetailFact(ContractModel):
    id: uuid.UUID
    version: int = Field(ge=1)
    status: FactVersionStatus
    classification: Confidentiality


class ContentTaskDetailCurrentContent(ContractModel):
    id: uuid.UUID
    version: int = Field(ge=1)
    source_type: Literal["AI", "HUMAN"]
    status: ContentVersionStatus
    title: str
    summary: str


class ContentTaskDetailGeneration(ContractModel):
    id: uuid.UUID
    job_type: Literal["GENERATE", "HUMANIZE"]
    status: GenerationJobStatus
    attempt_count: int = Field(ge=0)
    error_code: str | None
    error_summary: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class ContentTaskDetailReviewResult(ContractModel):
    action: Literal["submit-review", "approve", "request-changes"]
    actor: ActorSummary
    created_at: datetime


class ContentTaskDetailReview(ContractModel):
    content_version_id: uuid.UUID
    status: ContentVersionStatus
    latest_result: ContentTaskDetailReviewResult | None


class ContentTaskDetailPublicationWork(ContractModel):
    id: uuid.UUID
    status: PublicationWorkStatus
    updated_at: datetime


class ContentTaskDetailPublicationResult(ContractModel):
    id: uuid.UUID
    status: Literal["VERIFIED"]
    actual_title: str
    final_url: HttpUrl
    published_at: datetime
    verified_at: datetime


class ContentTaskDetailPublishing(ContractModel):
    work: ContentTaskDetailPublicationWork
    result: ContentTaskDetailPublicationResult | None


class ContentTaskDetailQueryTopic(ContractModel):
    id: uuid.UUID
    canonical_question: str


class ContentTaskDetailGeoOptimization(ContractModel):
    rule_code: Literal["CONTENT_DECLINE", "LONG_UNMENTIONED", "QUESTION_COVERAGE_GAP"]
    date_from: date
    date_to: date
    published_article_id: uuid.UUID | None
    geo_platform: str | None
    basis: ContentTaskDetailGeoBasis


class ContentTaskDetailPublishedContentIssue(ContractModel):
    id: uuid.UUID
    kind: PublishedContentIssueKind
    status: PublishedContentIssueStatus
    published_article_id: uuid.UUID
    opened_at: datetime


class ContentTaskDetailSource(ContractModel):
    query_topic: ContentTaskDetailQueryTopic | None
    geo_optimization: ContentTaskDetailGeoOptimization | None
    published_content_issue: ContentTaskDetailPublishedContentIssue | None


class ContentTaskDetailActivityTarget(ContractModel):
    kind: ContentTaskDetailActivityTargetKind
    id: uuid.UUID
    label: str


class ContentTaskDetailActivityItem(ContractModel):
    id: uuid.UUID
    kind: ContentTaskDetailActivityKind
    timestamp: datetime
    actor: ActorSummary
    summary: str
    target: ContentTaskDetailActivityTarget


class ContentTaskDetail(ContractModel):
    task: ContentTaskDetailTask
    product: ContentTaskDetailProduct
    platform: ContentTaskDetailPlatform
    fact: ContentTaskDetailFact
    current_content: ContentTaskDetailCurrentContent | None
    generation: ContentTaskDetailGeneration | None
    review: ContentTaskDetailReview | None
    publishing: ContentTaskDetailPublishing | None
    source: ContentTaskDetailSource | None
    activity: list[ContentTaskDetailActivityItem]
