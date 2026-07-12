"""GEO 观测、文件上传和生成模型输出 Schema。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, Field, HttpUrl, model_validator

from app.schemas.base import ContractModel, require_unique_items
from app.schemas.product_facts import Confidentiality
from app.schemas.publication import FileRecordOut


class GeoCitation(ContractModel):
    url: HttpUrl
    source_type: Literal["OFFICIAL", "EXTERNAL_COMPANY", "OTHER"]
    publication_record_id: uuid.UUID | None = None


class GeoObservationCreate(ContractModel):
    query_topic_id: uuid.UUID
    product_id: uuid.UUID
    actual_prompt: str
    model_name: str
    model_version: str | None = None
    tested_at: datetime
    web_search_enabled: bool
    answer_summary: str
    mentioned: bool
    recommendation: Literal["NONE", "CANDIDATE", "RECOMMENDED"]
    accuracy: Literal["ACCURATE", "PARTIAL", "INCORRECT", "UNJUDGEABLE"]
    citations: list[GeoCitation]
    publication_record_ids: Annotated[
        list[uuid.UUID], AfterValidator(require_unique_items)
    ] = Field(json_schema_extra={"uniqueItems": True})
    attachment_file_ids: Annotated[
        list[uuid.UUID], AfterValidator(require_unique_items)
    ] = Field(default_factory=list, json_schema_extra={"uniqueItems": True})
    notes: str
    supersedes_id: uuid.UUID | None = None


class GeoObservationOut(GeoObservationCreate):
    id: uuid.UUID
    tested_by: uuid.UUID
    created_at: datetime


class GeoObservationList(ContractModel):
    items: list[GeoObservationOut]


class GeoMetrics(ContractModel):
    sample_count: int
    mention_rate: float = Field(ge=0, le=1)
    recommendation_rate: float = Field(ge=0, le=1)
    citation_rate: float = Field(ge=0, le=1)
    accuracy_rate: float | None = Field(ge=0, le=1)


class DashboardSummary(ContractModel):
    pending_fact_reviews: int = Field(ge=0)
    pending_content_reviews: int = Field(ge=0)
    pending_publications: int = Field(ge=0)
    publication_attention: int = Field(ge=0)
    recent_accuracy_errors: int = Field(ge=0)


class UploadIntentCreate(ContractModel):
    category: Literal["EVIDENCE", "OPERATION_SCREENSHOT", "PUBLICATION_ASSET"]
    original_filename: str
    content_type: str
    size: int = Field(ge=1)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    access_level: Confidentiality


class UploadInstruction(ContractModel):
    method: Literal["PUT", "POST"]
    url: HttpUrl
    headers: dict[str, str]
    fields: dict[str, str]
    expires_at: datetime


class UploadIntent(ContractModel):
    file: FileRecordOut
    upload: UploadInstruction


class SignedUrl(ContractModel):
    url: HttpUrl
    expires_at: datetime


class GeneratedDraft(ContractModel):
    """开发与真实模型共同遵循的严格四字段输出边界。"""

    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    body_markdown: str = Field(min_length=1)
    tags: list[Annotated[str, Field(min_length=1)]] = Field(min_length=1)

    @model_validator(mode="after")
    def reject_blank_output(self) -> GeneratedDraft:
        """拒绝仅由空白组成的正文或标签，不替模型修复内容。"""
        if not self.title.strip() or not self.summary.strip() or not self.body_markdown.strip():
            raise ValueError("模型输出字段不能为空白")
        if any(not item.strip() for item in self.tags):
            raise ValueError("模型输出标签不能为空白")
        return self


JsonObject = dict[str, Any]
