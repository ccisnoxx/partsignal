"""Slice 1B：统一文章台账、多平台 URL 发布记录、产品资料附件与轻量 AI 生稿契约。"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Literal

from pydantic import AwareDatetime, Field, field_validator

from app.geo_citation_urls import normalize_citation_url
from app.schemas.base import ContractModel


class ArticleOriginType(StrEnum):
    EXTERNAL_AI = "EXTERNAL_AI"
    HUMAN = "HUMAN"
    SYSTEM_AI = "SYSTEM_AI"
    OTHER = "OTHER"


class ArticleStatus(StrEnum):
    DRAFT = "DRAFT"
    READY = "READY"
    PUBLISHED = "PUBLISHED"
    ARCHIVED = "ARCHIVED"


class ArticlePublicationRegistrationStatus(StrEnum):
    REGISTERED = "REGISTERED"
    REMOVED = "REMOVED"


class ArticlePublicationVerificationStatus(StrEnum):
    UNVERIFIED = "UNVERIFIED"
    VERIFIED = "VERIFIED"
    ISSUE_OPEN = "ISSUE_OPEN"


def _strip_optional(value: object) -> object:
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    return stripped or None


def _normalize_keywords(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        item = raw.strip()
        if not item:
            continue
        key = item.casefold()
        if key not in seen:
            seen.add(key)
            result.append(item[:100])
    return result[:50]


class ProductMaterialAttachRequest(ContractModel):
    file_id: uuid.UUID
    display_label: str = Field(default="", max_length=200)

    @field_validator("display_label", mode="before")
    @classmethod
    def strip_label(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ProductMaterialAttachmentOut(ContractModel):
    product_id: uuid.UUID
    file_id: uuid.UUID
    display_label: str
    original_filename: str
    content_type: str
    size: int
    created_by: uuid.UUID
    created_at: datetime


class ProductMaterialAttachmentList(ContractModel):
    items: list[ProductMaterialAttachmentOut]


class ProductPromptCopyBundleRequest(ContractModel):
    platform_prompt_version_id: uuid.UUID | None = None
    platform_profile_id: uuid.UUID | None = None
    writing_goal: str = Field(default="", max_length=1000)
    target_audience: str = Field(default="", max_length=500)
    target_question: str = Field(default="", max_length=1000)


class ProductPromptCopyBundleOut(ContractModel):
    product_id: uuid.UUID
    product_label: str
    facts_classification: Literal["PUBLIC"]
    prompt_template_name: str | None
    prompt_version_number: int | None
    system_prompt: str
    user_prompt: str
    combined_copy_text: str


class ArticleCreateRequest(ContractModel):
    product_id: uuid.UUID
    parent_article_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=300)
    summary: str = Field(default="", max_length=2000)
    body_markdown: str = Field(min_length=1, max_length=524288)
    target_keywords: list[str] = Field(default_factory=list, max_length=50)
    origin_type: ArticleOriginType = ArticleOriginType.EXTERNAL_AI
    external_model_name: str | None = Field(default=None, max_length=160)
    status: ArticleStatus = ArticleStatus.DRAFT
    change_summary: str = Field(default="初始录入", max_length=500)

    @field_validator("title", "summary", "change_summary", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("external_model_name", mode="before")
    @classmethod
    def strip_model(cls, value: object) -> object:
        return _strip_optional(value)

    @field_validator("target_keywords")
    @classmethod
    def clean_keywords(cls, value: list[str]) -> list[str]:
        return _normalize_keywords(value)


class ArticleUpdateRequest(ContractModel):
    expected_revision: int = Field(ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=300)
    summary: str | None = Field(default=None, max_length=2000)
    body_markdown: str | None = Field(default=None, min_length=1, max_length=524288)
    target_keywords: list[str] | None = Field(default=None, max_length=50)
    status: ArticleStatus | None = None
    change_summary: str = Field(default="", max_length=500)

    @field_validator("title", "summary", "change_summary", mode="before")
    @classmethod
    def strip_opt_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("target_keywords")
    @classmethod
    def clean_opt_keywords(cls, value: list[str] | None) -> list[str] | None:
        return _normalize_keywords(value) if value is not None else None


class ArticleRevisionOut(ContractModel):
    id: uuid.UUID
    article_id: uuid.UUID
    revision_no: int
    title: str
    summary: str
    body_markdown: str
    content_hash: str
    change_summary: str
    created_by: uuid.UUID
    created_by_name: str | None = None
    created_at: datetime


class ArticlePublicationCreateRequest(ContractModel):
    platform_profile_id: uuid.UUID | None = None
    platform_name: str | None = Field(default=None, min_length=1, max_length=160)
    platform_account_id: uuid.UUID | None = None
    platform_account_label: str | None = Field(default=None, max_length=160)
    actual_title: str = Field(min_length=1, max_length=300)
    final_url: str = Field(min_length=1, max_length=2083)
    published_at: AwareDatetime
    screenshot_file_id: uuid.UUID | None = None
    notes: str = Field(default="", max_length=2000)

    @field_validator("platform_name", "platform_account_label", mode="before")
    @classmethod
    def strip_opt(cls, value: object) -> object:
        return _strip_optional(value)

    @field_validator("actual_title", "notes", mode="before")
    @classmethod
    def strip_req(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("final_url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        return normalize_citation_url(value.strip()).original_url


class ArticlePublicationUpdateRequest(ContractModel):
    expected_revision: int = Field(ge=0)
    actual_title: str | None = Field(default=None, min_length=1, max_length=300)
    registration_status: ArticlePublicationRegistrationStatus | None = None
    screenshot_file_id: uuid.UUID | None = None
    notes: str | None = Field(default=None, max_length=2000)
    comment: str = Field(default="", max_length=500)

    @field_validator("actual_title", "notes", "comment", mode="before")
    @classmethod
    def strip_fields(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ArticlePublicationOut(ContractModel):
    id: uuid.UUID
    article_id: uuid.UUID
    article_title: str | None = None
    product_id: uuid.UUID | None = None
    product_label: str | None = None
    article_revision_id: uuid.UUID
    platform_profile_id: uuid.UUID | None
    platform_name_snapshot: str
    platform_account_id: uuid.UUID | None
    platform_account_label_snapshot: str | None
    actual_title: str
    final_url: str
    normalized_url: str
    hostname: str
    published_at: datetime
    registration_status: ArticlePublicationRegistrationStatus
    verification_status: ArticlePublicationVerificationStatus
    verified_at: datetime | None
    verified_by: uuid.UUID | None
    source_published_article_id: uuid.UUID | None
    screenshot_file_id: uuid.UUID | None
    notes: str
    revision: int
    registered_by: uuid.UUID
    registered_by_name: str | None = None
    created_at: datetime
    updated_at: datetime


class ArticlePublicationList(ContractModel):
    items: list[ArticlePublicationOut]
    page: int
    page_size: int
    total: int


class ArticleAiGenerationSnapshotOut(ContractModel):
    id: uuid.UUID
    article_revision_id: uuid.UUID
    product_facts_classification: Literal["PUBLIC"]
    prompt_template_version_id: uuid.UUID | None
    provider_model_snapshot: str
    cost_amount: Decimal | None
    cost_currency: str | None
    created_by: uuid.UUID
    created_at: datetime


class ArticleOut(ContractModel):
    id: uuid.UUID
    product_id: uuid.UUID
    product_label: str
    parent_article_id: uuid.UUID | None
    title: str
    summary: str
    body_markdown: str
    target_keywords: list[str]
    origin_type: ArticleOriginType
    external_model_name: str | None
    status: ArticleStatus
    current_revision: int
    revision: int
    owner_id: uuid.UUID
    owner_name: str
    created_by: uuid.UUID
    updated_by: uuid.UUID
    source_content_task_id: uuid.UUID | None
    source_content_version_id: uuid.UUID | None
    publication_count: int = Field(ge=0)
    verified_publication_count: int = Field(ge=0)
    created_at: datetime
    updated_at: datetime


class ArticleList(ContractModel):
    items: list[ArticleOut]
    page: int
    page_size: int
    total: int


class ArticleDetail(ArticleOut):
    revisions: list[ArticleRevisionOut]
    publications: list[ArticlePublicationOut]
    ai_generation_snapshots: list[ArticleAiGenerationSnapshotOut]


class ArticleGenerateDraftRequest(ContractModel):
    product_id: uuid.UUID
    ai_model_id: uuid.UUID
    platform_prompt_version_id: uuid.UUID | None = None
    platform_profile_id: uuid.UUID | None = None
    writing_goal: str = Field(default="", max_length=1000)
    target_audience: str = Field(default="", max_length=500)
    target_question: str = Field(default="", max_length=1000)
    target_keywords: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("target_keywords")
    @classmethod
    def clean_kw(cls, value: list[str]) -> list[str]:
        return _normalize_keywords(value)
