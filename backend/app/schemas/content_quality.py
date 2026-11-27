"""Slice 3B：内容重复度分析与 Layer 2 异步 AI 语义质量检查 API 契约。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.base import ContractModel
from app.schemas.content import GenerationOptionModel

QualitySeverity = Literal["BLOCKING", "WARNING", "INFORMATION"]
SemanticQualityJobStatus = Literal["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]


class SimilarContentItem(ContractModel):
    """与当前内容高度相似的同 Campaign 或同产品历史内容摘要。"""

    content_version_id: uuid.UUID
    content_task_id: uuid.UUID
    task_identifier: str
    platform_name: str
    campaign_id: uuid.UUID | None
    same_campaign: bool
    title: str
    status: str
    similarity: float = Field(ge=0.0, le=1.0)
    title_similarity: float = Field(ge=0.0, le=1.0)
    shared_paragraph_count: int = Field(ge=0)


class DuplicateTitleItem(ContractModel):
    """高度重复的标题条目。"""

    content_version_id: uuid.UUID
    content_task_id: uuid.UUID
    task_identifier: str
    platform_name: str
    same_campaign: bool
    title: str
    similarity: float = Field(ge=0.0, le=1.0)


class DuplicateParagraphItem(ContractModel):
    """跨内容重复或近似复用的段落明细。"""

    target_version_id: uuid.UUID
    target_task_identifier: str
    target_platform_name: str
    target_title: str
    same_campaign: bool
    source_excerpt: str
    matched_excerpt: str
    similarity: float = Field(ge=0.0, le=1.0)


class ContentDuplicationAnalysisOut(ContractModel):
    """内容版本重复度分析与差异化建议读模型。"""

    content_version_id: uuid.UUID
    content_task_id: uuid.UUID
    campaign_id: uuid.UUID | None
    product_id: uuid.UUID
    compared_campaign_count: int = Field(ge=0)
    compared_product_count: int = Field(ge=0)
    same_campaign_max_similarity: float = Field(ge=0.0, le=1.0)
    same_product_max_similarity: float = Field(ge=0.0, le=1.0)
    similar_contents: list[SimilarContentItem]
    duplicate_titles: list[DuplicateTitleItem]
    duplicate_paragraphs: list[DuplicateParagraphItem]
    differentiation_suggestions: list[str]


class SemanticQualityCheckCreate(ContractModel):
    """触发可选 Layer 2 异步 AI 语义质量检查请求体。"""

    ai_model_id: uuid.UUID


class SemanticQualityFinding(ContractModel):
    """AI 语义质量检查输出的单条结构化发现。"""

    code: str = Field(min_length=1, max_length=64)
    severity: QualitySeverity
    message: str = Field(min_length=1, max_length=1000)
    suggestion: str = Field(default="", max_length=1000)


class SemanticQualityModelResult(ContractModel):
    """模型返回的严格语义质检 JSON 结构。"""

    findings: list[SemanticQualityFinding] = Field(default_factory=list, max_length=30)
    differentiation_suggestions: list[str] = Field(default_factory=list, max_length=10)


class SemanticQualityCheckJobOut(ContractModel):
    """Layer 2 异步 AI 语义质量检查作业读模型。"""

    id: uuid.UUID
    content_version_id: uuid.UUID
    content_task_id: uuid.UUID
    content_revision: int | None = None
    content_hash: str | None = None
    status: SemanticQualityJobStatus
    ai_model_id: uuid.UUID | None
    adapter_name: str
    findings: list[SemanticQualityFinding]
    differentiation_suggestions: list[str]
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    response_duration_ms: int | None
    error_code: str | None
    error_summary: str | None
    created_by: uuid.UUID
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class SemanticQualityCheckJobList(ContractModel):
    """目标内容版本的异步语义质量检查历史列表及当前可用模型选项。"""

    content_version_id: uuid.UUID
    items: list[SemanticQualityCheckJobOut]
    available_models: list[GenerationOptionModel] = Field(default_factory=list)
