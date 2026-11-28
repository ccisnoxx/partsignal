"""Slice 1C：今日待监测清单、一屏规则预判、单条直录/补录、失败态与引用分级归因契约。"""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, StrictBool, field_validator

from app.schemas.base import ContractModel
from app.schemas.geo_analysis import GeoRecommendationKind
from app.schemas.geo_answers import GeoCitationObservation
from app.schemas.geo_prompt_variants import GeoPromptCategory, Revision
from app.schemas.geo_runs import GeoRunEntryKind, GeoRunStatus


class GeoCitationMatchMethod(StrEnum):
    EXACT_NORMALIZED_URL = "EXACT_NORMALIZED_URL"
    STRIPPED_TRACKING_CANDIDATE = "STRIPPED_TRACKING_CANDIDATE"
    SAME_DOMAIN_CANDIDATE = "SAME_DOMAIN_CANDIDATE"
    MANUAL_SELECTED = "MANUAL_SELECTED"


class GeoCitationLinkStatus(StrEnum):
    AUTO_EXACT = "AUTO_EXACT"
    CANDIDATE = "CANDIDATE"
    CONFIRMED = "CONFIRMED"
    REJECTED = "REJECTED"


class GeoManualFailCode(StrEnum):
    MANUAL_TIMEOUT = "MANUAL_TIMEOUT"
    MANUAL_PLATFORM_UNAVAILABLE = "MANUAL_PLATFORM_UNAVAILABLE"
    MANUAL_ANSWER_UNAVAILABLE = "MANUAL_ANSWER_UNAVAILABLE"
    MANUAL_ACCESS_BLOCKED = "MANUAL_ACCESS_BLOCKED"
    MANUAL_OTHER = "MANUAL_OTHER"


class GeoCitationPublicationLinkOut(ContractModel):
    id: UUID
    citation_id: UUID
    citation_url: str
    article_publication_id: UUID
    article_id: UUID | None = None
    article_title: str | None = None
    publication_title: str | None = None
    publication_url: str | None = None
    platform_name: str | None = None
    match_method: GeoCitationMatchMethod
    link_status: GeoCitationLinkStatus
    match_reason: str
    confirmed_by: UUID | None
    confirmed_at: datetime | None
    revision: int
    created_at: datetime
    updated_at: datetime


class GeoCitationLinkDecisionRequest(ContractModel):
    expected_revision: Revision
    link_status: Literal["CONFIRMED", "REJECTED"]


class GeoCitationManualLinkRequest(ContractModel):
    article_publication_id: UUID
    match_reason: str = Field(default="人工确认引用归属", max_length=500)


class GeoManualPreviewCitationInput(ContractModel):
    original_url: str = Field(min_length=1, max_length=2083)
    title: str | None = Field(default=None, max_length=2000)


class GeoManualPreviewRequest(ContractModel):
    answer_text: str = Field(default="", max_length=1048576)
    citations: list[GeoManualPreviewCitationInput] = Field(default_factory=list, max_length=1000)


class GeoManualPreviewSubjectSuggestion(ContractModel):
    subject_id: UUID
    subject_type: str
    display_name: str
    product_id: UUID | None
    mentioned: bool
    mention_count: int
    matched_aliases: list[str]
    recommendation: GeoRecommendationKind
    rank: int | None


class GeoManualPreviewCitationSuggestion(ContractModel):
    original_url: str
    normalized_url: str
    hostname: str
    source: Literal["INPUT", "EXTRACTED_FROM_TEXT"]
    suggested_article_publication_id: UUID | None = None
    suggested_article_title: str | None = None
    suggested_publication_title: str | None = None
    suggested_platform_name: str | None = None
    match_method: GeoCitationMatchMethod | None = None
    suggested_link_status: GeoCitationLinkStatus | None = None
    match_reason: str | None = None


class GeoManualPreviewOut(ContractModel):
    run_id: UUID
    subjects: list[GeoManualPreviewSubjectSuggestion]
    extracted_urls: list[str]
    citation_suggestions: list[GeoManualPreviewCitationSuggestion]
    review_required_reasons: list[str]


class GeoManualInlineSubjectDecision(ContractModel):
    subject_id: UUID
    mentioned: bool | None = None
    recommendation: GeoRecommendationKind | None = None
    rank: int | None = Field(default=None, ge=1, le=100)


class GeoManualInlineCitationDecision(ContractModel):
    normalized_url: str = Field(min_length=1, max_length=2083)
    article_publication_id: UUID
    action: Literal["CONFIRM", "REJECT"]


class GeoManualInlineReview(ContractModel):
    """同屏人工确认；仅在明确选择确认/修正时写入 GeoRunReview 并完成 Run。"""

    confirm_all: bool = True
    subject_decisions: list[GeoManualInlineSubjectDecision] = Field(
        default_factory=list, max_length=100
    )
    citation_decisions: list[GeoManualInlineCitationDecision] = Field(
        default_factory=list, max_length=200
    )
    comment: str = Field(default="", max_length=2000)


class GeoManualFailRequest(ContractModel):
    expected_run_revision: Revision
    error_code: GeoManualFailCode
    error_summary: str = Field(min_length=1, max_length=500)

    @field_validator("error_summary", mode="before")
    @classmethod
    def strip_summary(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class GeoManualFailOut(ContractModel):
    run_id: UUID
    status: Literal["FAILED"]
    revision: Revision
    error_stage: Literal["COLLECTION"]
    error_code: GeoManualFailCode
    error_summary: str
    finished_at: datetime


class GeoDailyChecklistOption(ContractModel):
    id: UUID
    label: str
    meta: str | None = None


class GeoDailyChecklistItem(ContractModel):
    run_id: UUID
    batch_id: UUID
    plan_id: UUID | None
    plan_name: str | None
    prompt_variant_id: UUID
    prompt_text: str
    prompt_category: GeoPromptCategory
    prompt_priority: str
    collection_profile_id: UUID
    profile_name: str
    platform_name: str
    web_search_policy: str
    require_screenshot: bool
    status: GeoRunStatus
    revision: Revision
    entry_kind: GeoRunEntryKind
    is_backfill: bool
    backfill_source: str | None
    assignee_id: UUID | None
    assignee_name: str | None
    target_article_publication_id: UUID | None
    effective_at: datetime
    collected_at: datetime | None
    query_modified: bool = False
    error_code: str | None = None
    error_summary: str | None = None
    has_answer: bool = False
    has_brand_or_product_mention: bool | None = None
    linked_article_count: int = 0
    pending_candidate_link_count: int = 0


class GeoDailyChecklistSummary(ContractModel):
    planned_total: int = 0
    completed_count: int = 0
    pending_count: int = 0
    needs_review_count: int = 0
    failed_count: int = 0
    cancelled_count: int = 0


class GeoDailyChecklistOut(ContractModel):
    target_date: date
    timezone: str
    summary: GeoDailyChecklistSummary
    items: list[GeoDailyChecklistItem]
    core_plans: list[GeoDailyChecklistOption]
    profiles: list[GeoDailyChecklistOption]
    prompts: list[GeoDailyChecklistOption]
    users: list[GeoDailyChecklistOption]
    publications: list[GeoDailyChecklistOption]


class GeoDailyChecklistEnsureRequest(ContractModel):
    target_date: date | None = None
    plan_id: UUID | None = None


class GeoDailyChecklistEnsureOut(ContractModel):
    target_date: date
    created_batch_ids: list[UUID]
    reused_batch_ids: list[UUID]
    created_run_count: int


class GeoDirectManualObservationCreate(ContractModel):
    """历史补录 / 探索性新问题 / 文章定位核查单条直录；支持创建并立即提交。"""

    entry_kind: Literal["BACKFILL", "EXPLORATORY", "ARTICLE_LOOKUP"]
    prompt_variant_id: UUID
    collection_profile_id: UUID
    subject_ids: list[UUID] = Field(default_factory=list, max_length=50)
    backfill_source: str | None = Field(default=None, max_length=160)
    target_article_publication_id: UUID | None = None
    assignee_id: UUID | None = None
    # 可选一步到位直录答案与确认
    answer_text: str | None = Field(default=None, max_length=1048576)
    actual_prompt_text: str | None = Field(default=None, max_length=8000)
    collected_at: AwareDatetime | None = None
    web_search_observed: StrictBool | None = None
    source_product: str | None = Field(default=None, max_length=160)
    source_model: str | None = Field(default=None, max_length=200)
    source_version: str | None = Field(default=None, max_length=200)
    screenshot_file_id: UUID | None = None
    citations: list[GeoManualPreviewCitationInput] = Field(default_factory=list, max_length=1000)
    citation_observation: GeoCitationObservation | None = None
    inline_review: GeoManualInlineReview | None = None


class GeoDirectManualObservationOut(ContractModel):
    batch_id: UUID
    run_id: UUID
    entry_kind: GeoRunEntryKind
    is_backfill: bool
    run_status: GeoRunStatus
    answer_snapshot_id: UUID | None = None
    analysis_revision_id: UUID | None = None
    review_id: UUID | None = None
    citation_links: list[GeoCitationPublicationLinkOut] = Field(default_factory=list)
