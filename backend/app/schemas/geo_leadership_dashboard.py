"""Slice 1D：领导效果看板读模型、统一下钻证据与冻结周/月报快照契约。"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, field_validator

from app.schemas.base import ContractModel
from app.schemas.geo_daily_checklist import GeoCitationPublicationLinkOut
from app.schemas.geo_prompt_variants import GeoPromptCategory
from app.schemas.geo_runs import GeoRunEntryKind, GeoRunStatus


class GeoReportSnapshotKind(StrEnum):
    WEEKLY = "WEEKLY"
    MONTHLY = "MONTHLY"
    CUSTOM = "CUSTOM"


class GeoRateCiOut(ContractModel):
    lower: float
    upper: float
    sample_size: int
    method: Literal["WILSON_95"] = "WILSON_95"


class GeoDiffCiOut(ContractModel):
    lower_pp: float
    upper_pp: float
    excludes_zero: bool
    method: Literal["NEWCOMBE_WILSON_95"] = "NEWCOMBE_WILSON_95"


class GeoRateMetricOut(ContractModel):
    numerator: int = Field(ge=0)
    denominator: int = Field(ge=0)
    rate: float | None = None
    ci_95: GeoRateCiOut | None = None
    previous_numerator: int = Field(default=0, ge=0)
    previous_denominator: int = Field(default=0, ge=0)
    previous_rate: float | None = None
    delta_pp: float | None = None
    delta_ci_95: GeoDiffCiOut | None = None


class GeoCoreCoverageCard(ContractModel):
    hit_questions: int = Field(ge=0)
    sampled_questions: int = Field(ge=0)
    total_core_questions: int = Field(ge=0)
    unsampled_questions: int = Field(ge=0)
    coverage_rate: float | None = None


class GeoFirstCitedCard(ContractModel):
    first_cited_count: int = Field(ge=0)
    total_cited_publications_in_period: int = Field(ge=0)
    note: str = "系统观测历史内首次观察到被引用，不代表全网历史首次"


class GeoLeadershipSummaryCards(ContractModel):
    perspective: Literal["COMPANY", "SINGLE_PRODUCT"]
    selected_product_label: str | None = None
    natural_mention_rate: GeoRateMetricOut
    brand_mention_breakdown: GeoRateMetricOut
    product_mention_breakdown: GeoRateMetricOut
    article_citation_hit_rate: GeoRateMetricOut
    citation_unobserved_count: int = Field(ge=0)
    core_question_coverage: GeoCoreCoverageCard
    first_cited_articles: GeoFirstCitedCard
    recommendation_rate: GeoRateMetricOut
    recommendation_unknown_count: int = Field(ge=0)


class GeoTrendBucketOut(ContractModel):
    bucket_key: str
    label: str
    mention_numerator: int = Field(ge=0)
    mention_denominator: int = Field(ge=0)
    natural_mention_rate: float | None = None
    citation_numerator: int = Field(ge=0)
    citation_denominator: int = Field(ge=0)
    citation_hit_rate: float | None = None


class GeoPlatformComparisonOut(ContractModel):
    surface_id: UUID
    platform_name: str
    collection_mode: str
    mention_numerator: int = Field(ge=0)
    mention_denominator: int = Field(ge=0)
    natural_mention_rate: float | None = None
    mention_ci_95: GeoRateCiOut | None = None
    citation_numerator: int = Field(ge=0)
    citation_denominator: int = Field(ge=0)
    citation_hit_rate: float | None = None
    needs_review_count: int = Field(ge=0)
    failed_count: int = Field(ge=0)


class GeoMatrixCellOut(ContractModel):
    surface_id: UUID
    platform_name: str
    valid_count: int = Field(ge=0)
    mention_hit_count: int = Field(ge=0)
    citation_hit_count: int = Field(ge=0)
    needs_review_count: int = Field(ge=0)
    failed_count: int = Field(ge=0)
    run_ids: list[UUID] = Field(default_factory=list)


class GeoQuestionMatrixRowOut(ContractModel):
    prompt_variant_id: UUID
    prompt_text: str
    prompt_priority: str
    cells: list[GeoMatrixCellOut]


class GeoArticlePerformanceOut(ContractModel):
    article_publication_id: UUID
    article_id: UUID
    article_title: str
    publication_title: str
    platform_name: str
    final_url: str
    verification_status: str
    cited_run_count: int = Field(ge=0)
    first_cited_at: datetime
    is_first_cited_in_period: bool
    sample_run_ids: list[UUID] = Field(default_factory=list)


class GeoCategorySeparateSummaryOut(ContractModel):
    category: GeoPromptCategory
    total_runs: int = Field(ge=0)
    valid_completed_runs: int = Field(ge=0)
    mention_hit_runs: int = Field(ge=0)
    citation_hit_runs: int = Field(ge=0)
    needs_review_runs: int = Field(ge=0)
    failed_runs: int = Field(ge=0)


class GeoDataQualityOut(ContractModel):
    planned_total: int = Field(ge=0)
    completed_valid_count: int = Field(ge=0)
    needs_review_count: int = Field(ge=0)
    pending_count: int = Field(ge=0)
    failed_count: int = Field(ge=0)
    cancelled_count: int = Field(ge=0)
    query_modified_excluded_count: int = Field(ge=0)
    exploratory_excluded_count: int = Field(ge=0)
    backfill_count: int = Field(ge=0)
    citation_partial_or_unknown_count: int = Field(ge=0)
    pending_candidate_links_count: int = Field(ge=0)


class GeoDashboardFilterOption(ContractModel):
    id: UUID
    label: str
    meta: str | None = None


class GeoLeadershipFilterOptionsOut(ContractModel):
    products: list[GeoDashboardFilterOption]
    platforms: list[GeoDashboardFilterOption]
    core_plans: list[GeoDashboardFilterOption]


class GeoLeadershipDashboardOut(ContractModel):
    as_of: datetime
    period_from: datetime
    period_to: datetime
    bucket_granularity: Literal["DAY", "WEEK"]
    comparability_warnings: list[str]
    summary_cards: GeoLeadershipSummaryCards
    trend_series: list[GeoTrendBucketOut]
    platform_comparisons: list[GeoPlatformComparisonOut]
    question_platform_matrix: list[GeoQuestionMatrixRowOut]
    article_performance: list[GeoArticlePerformanceOut]
    brand_model_section: GeoCategorySeparateSummaryOut
    article_lookup_section: GeoCategorySeparateSummaryOut
    data_quality: GeoDataQualityOut
    evidence_run_ids: list[UUID]


class GeoLeadershipEvidenceItem(ContractModel):
    run_id: UUID
    effective_at: datetime
    collected_at: datetime | None
    registered_at: datetime
    status: GeoRunStatus
    entry_kind: GeoRunEntryKind
    is_backfill: bool
    backfill_source: str | None
    platform_name: str
    collection_mode: str
    prompt_category: GeoPromptCategory
    prompt_text: str
    actual_prompt_text: str | None
    query_modified: bool
    answer_text: str | None
    screenshot_file_id: UUID | None
    web_search_observed: bool | None
    citation_observation_status: str | None
    recorder_name: str | None
    mentioned_brand: bool
    mentioned_product: bool
    recommended: bool | None
    citation_links: list[GeoCitationPublicationLinkOut]
    error_code: str | None
    error_summary: str | None


class GeoLeadershipEvidenceList(ContractModel):
    items: list[GeoLeadershipEvidenceItem]
    total: int = Field(ge=0)


class GeoReportSnapshotCreateRequest(ContractModel):
    report_kind: GeoReportSnapshotKind = GeoReportSnapshotKind.WEEKLY
    title: str = Field(min_length=1, max_length=200)
    period_from: AwareDatetime
    period_to: AwareDatetime
    bucket_granularity: Literal["DAY", "WEEK"] = "DAY"
    product_id: UUID | None = None
    surface_id: UUID | None = None
    collection_mode: Literal["MANUAL", "API", "BROWSER"] | None = None
    summary_notes: str = Field(default="", max_length=8000)
    supersedes_snapshot_id: UUID | None = None
    correction_reason: str | None = Field(default=None, max_length=1000)

    @field_validator("title", "summary_notes", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class GeoReportSnapshotOut(ContractModel):
    id: UUID
    report_kind: GeoReportSnapshotKind
    title: str
    period_from: datetime
    period_to: datetime
    data_cutoff_at: datetime
    revision_no: int
    supersedes_snapshot_id: UUID | None
    correction_reason: str | None
    summary_notes: str
    evidence_run_count: int = Field(ge=0)
    created_by: UUID
    created_by_name: str | None = None
    created_at: datetime


class GeoReportSnapshotDetail(GeoReportSnapshotOut):
    filter_scope: dict[str, Any]
    core_cohort_snapshot: dict[str, Any]
    dashboard_payload: dict[str, Any]
    evidence_run_ids: list[UUID]


class GeoReportSnapshotList(ContractModel):
    items: list[GeoReportSnapshotOut]
    total: int = Field(ge=0)
