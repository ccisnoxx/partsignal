"""Content Editor 首屏所需的最小一致读模型。"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import Field

from app.schemas.base import ContractModel
from app.schemas.content import ContentDiff, ContentVersionOut
from app.schemas.content_task_detail import (
    ContentTaskDetailGeneration,
    ContentTaskDetailPlatform,
    ContentTaskDetailSource,
    ContentTaskDetailTask,
    ContentVersionStatus,
)
from app.schemas.product_facts import Confidentiality, FactVersionStatus, ProductStatus


class ContentEditorProduct(ContractModel):
    id: uuid.UUID
    brand: str
    part_number: str
    category: str
    status: ProductStatus


class ContentEditorFact(ContractModel):
    id: uuid.UUID
    version: int = Field(ge=1)
    status: FactVersionStatus
    classification: Confidentiality
    body_markdown: str


class ContentEditorComparisonContent(ContractModel):
    id: uuid.UUID
    version: int = Field(ge=1)
    source_type: Literal["AI", "HUMAN"]
    status: ContentVersionStatus
    title: str


class ContentEditorSnapshotChannel(ContractModel):
    id: uuid.UUID | None
    name: str | None
    protocol_type: str | None


class ContentEditorSnapshotModel(ContractModel):
    id: uuid.UUID | None
    display_name: str | None
    model_id: str | None


class ContentEditorPromptIdentity(ContractModel):
    id: uuid.UUID
    name: str
    revision: int = Field(ge=0)


class ContentEditorGenerationLineage(ContractModel):
    job_id: uuid.UUID
    contract_version: str
    channel: ContentEditorSnapshotChannel
    model: ContentEditorSnapshotModel
    platform_prompt: ContentEditorPromptIdentity | None


class ContentEditorHumanizationLineage(ContractModel):
    job_id: uuid.UUID
    source_content_version_id: uuid.UUID
    contract_version: str
    channel: ContentEditorSnapshotChannel
    model: ContentEditorSnapshotModel
    prompt_revision: int = Field(ge=0)


class ContentEditorLineage(ContractModel):
    generation: ContentEditorGenerationLineage
    humanizations: list[ContentEditorHumanizationLineage]


class ContentEditorContext(ContractModel):
    task: ContentTaskDetailTask
    product: ContentEditorProduct
    platform: ContentTaskDetailPlatform
    locked_fact_version: ContentEditorFact
    current_content: ContentVersionOut | None
    comparison_content: ContentEditorComparisonContent | None
    diff: ContentDiff | None
    latest_generation: ContentTaskDetailGeneration | None
    current_lineage: ContentEditorLineage | None
    source: ContentTaskDetailSource | None
