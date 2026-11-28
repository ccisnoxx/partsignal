"""产品 Markdown 事实工作区与事实版本 Schema。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import AwareDatetime, Field, field_validator

from app.schemas.base import ContractModel
from app.schemas.common import DeletionProjection


class ProductFactsFreshness(StrEnum):
    UNSET = "UNSET"
    FRESH = "FRESH"
    OVERDUE = "OVERDUE"


class ProductStatus(StrEnum):
    ACTIVE = "ACTIVE"
    RETIRED = "RETIRED"


class ProductWorkflowStage(StrEnum):
    FACTS_EMPTY = "FACTS_EMPTY"
    FACTS_EDITING = "FACTS_EDITING"
    FACT_REVIEW_PENDING = "FACT_REVIEW_PENDING"
    FACT_CHANGES_REQUESTED = "FACT_CHANGES_REQUESTED"
    FACT_APPROVED = "FACT_APPROVED"
    RETIRED = "RETIRED"


class ProductFactStatus(StrEnum):
    NOT_ENTERED = "NOT_ENTERED"
    PENDING_REVIEW = "PENDING_REVIEW"
    CHANGES_REQUESTED = "CHANGES_REQUESTED"
    APPROVED = "APPROVED"
    RETIRED = "RETIRED"


class ProductSort(StrEnum):
    UPDATED_DESC = "UPDATED_DESC"
    UPDATED_ASC = "UPDATED_ASC"
    MODEL_ASC = "MODEL_ASC"
    MODEL_DESC = "MODEL_DESC"


class FactVersionStatus(StrEnum):
    PENDING_REVIEW = "PENDING_REVIEW"
    CHANGES_REQUESTED = "CHANGES_REQUESTED"
    APPROVED = "APPROVED"
    RETIRED = "RETIRED"


class _ProductIdentity(ContractModel):
    part_number: str = Field(min_length=1, max_length=160)
    brand: str = Field(min_length=1, max_length=160)
    category: str = Field(min_length=1, max_length=160)

    @field_validator("part_number", "brand", "category", mode="before")
    @classmethod
    def strip_product_identity(cls, value: object) -> object:
        """在请求边界去除两侧空白，使空白与长度校验作用于实际保存值。"""
        return value.strip() if isinstance(value, str) else value


class ProductCreate(_ProductIdentity):
    summary: str | None = Field(default=None, max_length=2000)
    datasheet_url: str | None = Field(default=None, max_length=2000)


class ProductUpdate(_ProductIdentity):
    expected_revision: int = Field(ge=0)
    status: ProductStatus
    summary: str | None = Field(default=None, max_length=2000)
    datasheet_url: str | None = Field(default=None, max_length=2000)


class ProductOut(ContractModel):
    id: uuid.UUID
    part_number: str
    brand: str
    category: str
    status: ProductStatus
    workflow_stage: ProductWorkflowStage
    primary_task: Literal[
        "ENTER_FACTS",
        "SUBMIT_FACT_REVIEW",
        "REVIEW_FACT",
        "REVISE_FACT",
        "CREATE_CONTENT_TASK",
        "VIEW_FACT_HISTORY",
    ]
    available_actions: list[Literal["UPDATE", "DELETE"]]
    deletion: DeletionProjection | None
    source_owner: str | None
    next_review_at: datetime | None
    facts_freshness: ProductFactsFreshness
    summary: str | None = None
    datasheet_url: str | None = None
    facts_updated_at: datetime | None = None
    revision: int
    created_at: datetime
    updated_at: datetime


class ProductFactSummary(ContractModel):
    version: int = Field(ge=1)
    status: FactVersionStatus


class ProductListItem(ProductOut):
    fact_status: ProductFactStatus
    current_fact: ProductFactSummary | None


class ProductList(ContractModel):
    items: list[ProductListItem]
    page: int
    page_size: int
    total: int


class Confidentiality(StrEnum):
    PUBLIC = "PUBLIC"
    INTERNAL = "INTERNAL"
    RESTRICTED = "RESTRICTED"


class ProductFactsDraftUpdate(ContractModel):
    expected_revision: int = Field(ge=0)
    body_markdown: str = Field(min_length=1)
    classification: Confidentiality
    source_owner: str | None = Field(default=None, max_length=160)
    source_reference: str | None = Field(default=None, max_length=500)
    verified_at: AwareDatetime | None = None
    next_review_at: AwareDatetime | None = None
    applicable_region: str | None = Field(default=None, max_length=160)
    content_restrictions: str | None = Field(default=None, max_length=4000)
    approved_claims_summary: str | None = Field(default=None, max_length=4000)

    @field_validator(
        "source_owner",
        "source_reference",
        "applicable_region",
        "content_restrictions",
        "approved_claims_summary",
        mode="before",
    )
    @classmethod
    def normalize_optional_metadata(cls, value: object) -> object:
        """去除可选运营元数据两侧空白；纯空白归一为 None。"""
        if not isinstance(value, str):
            return value
        stripped = value.strip()
        return stripped or None


class ProductFactsConfirmReviewRequest(ContractModel):
    expected_revision: int = Field(ge=0)
    next_review_at: AwareDatetime


class ProductFactsProductContext(ContractModel):
    id: uuid.UUID
    part_number: str
    brand: str
    category: str
    status: ProductStatus
    workflow_stage: ProductWorkflowStage


class ProductFactsDraft(ContractModel):
    product_id: uuid.UUID
    product: ProductFactsProductContext
    body_markdown: str
    classification: Confidentiality
    source_owner: str | None
    source_reference: str | None
    verified_at: datetime | None
    next_review_at: datetime | None
    applicable_region: str | None
    content_restrictions: str | None
    approved_claims_summary: str | None
    last_reviewed_at: datetime | None
    last_reviewed_by: uuid.UUID | None
    facts_freshness: ProductFactsFreshness
    approved_fact: ProductFactSummary | None
    pending_fact: ProductFactSummary | None
    available_actions: list[Literal["SAVE", "SUBMIT_REVIEW", "CONFIRM_REVIEW"]]
    revision: int = Field(ge=0)


class FactReviewSubmissionRequest(ContractModel):
    expected_revision: int = Field(ge=0)
    change_summary: str = Field(min_length=1)

    @field_validator("change_summary")
    @classmethod
    def require_non_blank_summary(cls, value: str) -> str:
        """拒绝空白审核摘要，同时保留合法原文。"""
        if not value.strip():
            raise ValueError("变更摘要不能为空")
        return value


class FactVersionOut(ContractModel):
    id: uuid.UUID
    product_id: uuid.UUID
    version: int
    status: FactVersionStatus
    body_markdown: str
    classification: Confidentiality
    change_summary: str
    primary_task: Literal[
        "REVIEW_FACT", "CREATE_CONTENT_TASK", "REVISE_FACT", "VIEW_FACT_HISTORY"
    ]
    available_actions: list[Literal["APPROVE", "REQUEST_CHANGES", "RETIRE", "DELETE"]]
    deletion: DeletionProjection | None
    revision: int
    created_by: uuid.UUID
    approved_by: uuid.UUID | None = None
    created_at: datetime
    approved_at: datetime | None = None
    source_reference: str | None = None
    verified_at: datetime | None = None
    applicable_region: str | None = None
    content_restrictions: str | None = None
    approved_claims_summary: str | None = None


class FactVersionList(ContractModel):
    items: list[FactVersionOut]


class ProductFactHistoryItem(ContractModel):
    id: uuid.UUID
    product_id: uuid.UUID
    version: int = Field(ge=1)
    status: FactVersionStatus
    classification: Confidentiality
    change_summary: str
    created_by: uuid.UUID
    created_at: datetime


class ProductFactHistoryList(ContractModel):
    product: ProductFactsProductContext
    items: list[ProductFactHistoryItem]
    page: int = Field(ge=1)
    page_size: Literal[10, 20, 50]
    total: int = Field(ge=0)
