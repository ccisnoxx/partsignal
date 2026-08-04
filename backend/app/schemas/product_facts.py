"""产品 Markdown 事实工作区与事实版本 Schema。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import Field

from app.schemas.base import ContractModel


class ProductStatus(StrEnum):
    ACTIVE = "ACTIVE"
    RETIRED = "RETIRED"


class ProductCreate(ContractModel):
    part_number: str = Field(min_length=1)
    brand: str = Field(min_length=1)
    category: str = Field(min_length=1)


class ProductUpdate(ContractModel):
    expected_revision: int = Field(ge=0)
    part_number: str
    brand: str
    category: str
    status: ProductStatus


class ProductOut(ContractModel):
    id: uuid.UUID
    part_number: str
    brand: str
    category: str
    status: ProductStatus
    workflow_stage: Literal[
        "FACTS_EMPTY",
        "FACTS_EDITING",
        "FACT_REVIEW_PENDING",
        "FACT_CHANGES_REQUESTED",
        "FACT_APPROVED",
        "RETIRED",
    ]
    primary_task: Literal[
        "ENTER_FACTS",
        "SUBMIT_FACT_REVIEW",
        "REVIEW_FACT",
        "REVISE_FACT",
        "CREATE_CONTENT_TASK",
        "VIEW_FACT_HISTORY",
    ]
    available_actions: list[Literal["UPDATE", "DELETE"]]
    revision: int
    created_at: datetime
    updated_at: datetime


class ProductList(ContractModel):
    items: list[ProductOut]
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


class ProductFactsDraft(ContractModel):
    product_id: uuid.UUID
    body_markdown: str
    classification: Confidentiality
    available_actions: list[Literal["SAVE", "SUBMIT_REVIEW"]]
    revision: int = Field(ge=0)


class FactReviewSubmissionRequest(ContractModel):
    expected_revision: int = Field(ge=0)
    change_summary: str = Field(min_length=1)


class FactVersionStatus(StrEnum):
    PENDING_REVIEW = "PENDING_REVIEW"
    CHANGES_REQUESTED = "CHANGES_REQUESTED"
    APPROVED = "APPROVED"
    RETIRED = "RETIRED"


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
    revision: int
    created_by: uuid.UUID
    approved_by: uuid.UUID | None = None
    created_at: datetime
    approved_at: datetime | None = None


class FactVersionList(ContractModel):
    items: list[FactVersionOut]
