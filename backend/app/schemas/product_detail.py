"""Product Detail 跨域紧凑只读投影。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.base import ContractModel
from app.schemas.content import ActorSummary, ContentTaskWorkflowStage
from app.schemas.product_facts import Confidentiality, ProductOut


class ProductDetailApprovedFact(ContractModel):
    id: uuid.UUID
    version: int = Field(ge=1)
    status: Literal["APPROVED"]
    classification: Confidentiality
    approved_at: datetime | None


class ProductDetailPendingFact(ContractModel):
    id: uuid.UUID
    version: int = Field(ge=1)
    status: Literal["PENDING_REVIEW", "CHANGES_REQUESTED"]
    classification: Confidentiality
    created_at: datetime


class ProductDetailContentTaskSummary(ContractModel):
    task_id: uuid.UUID
    workflow_stage: ContentTaskWorkflowStage
    created_at: datetime


class ProductDetailContentSummary(ContractModel):
    task_count: int = Field(ge=0)
    latest_task: ProductDetailContentTaskSummary | None


class ProductDetailPublishingLatest(ContractModel):
    work_id: uuid.UUID
    article_id: uuid.UUID | None
    status: Literal[
        "PREPARING",
        "PLATFORM_REVIEW",
        "AWAITING_VERIFICATION",
        "ACTION_REQUIRED",
        "COMPLETED",
        "CLOSED",
    ]
    actual_title: str | None
    updated_at: datetime


class ProductDetailPublishingSummary(ContractModel):
    published_article_count: int = Field(ge=0)
    latest: ProductDetailPublishingLatest | None


class ProductDetailGeoSummary(ContractModel):
    observation_count: int = Field(ge=0)
    article_result_count: int = Field(ge=0)
    discovery_rate: float | None = Field(ge=0, le=1)
    mention_rate: float | None = Field(ge=0, le=1)
    accuracy_rate: float | None = Field(ge=0, le=1)


ProductDetailActivityKind = Literal[
    "PRODUCT",
    "FACT_REVIEW",
    "CONTENT_TASK",
    "CONTENT_REVIEW",
    "PUBLICATION",
    "GEO_OBSERVATION",
]
ProductDetailActivityTargetKind = Literal[
    "PRODUCT",
    "FACT_VERSION",
    "CONTENT_TASK",
    "CONTENT_VERSION",
    "PUBLICATION_WORK",
    "GEO_OBSERVATION",
]


class ProductDetailActivityTarget(ContractModel):
    kind: ProductDetailActivityTargetKind
    id: uuid.UUID
    label: str


class ProductDetailActivityItem(ContractModel):
    id: uuid.UUID
    kind: ProductDetailActivityKind
    label: str
    timestamp: datetime
    actor: ActorSummary | None
    target: ProductDetailActivityTarget


class ProductDetail(ContractModel):
    product: ProductOut
    approved_fact: ProductDetailApprovedFact | None
    pending_fact: ProductDetailPendingFact | None
    content: ProductDetailContentSummary
    publishing: ProductDetailPublishingSummary
    geo: ProductDetailGeoSummary
    activity: list[ProductDetailActivityItem]
