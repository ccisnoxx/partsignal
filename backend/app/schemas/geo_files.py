"""GEO 观测、文件上传和生成模型输出 Schema。"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    Field,
    HttpUrl,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.schemas.base import ContractModel, require_unique_items
from app.schemas.content import ActorSummary
from app.schemas.product_facts import Confidentiality
from app.schemas.publication import FileRecordOut

GeoObservationKind = Literal["LEGACY_MODEL_RESULT", "MANUAL_ARTICLE_SEARCH"]
GeoObservationAction = Literal["CORRECT"]
GeoObservationSortOrder = Literal["ASC", "DESC"]
LegacyRecommendation = Literal["NONE", "CANDIDATE", "RECOMMENDED"]
GeoAccuracy = Literal["ACCURATE", "PARTIAL", "INCORRECT", "UNJUDGEABLE"]


class GeoCitation(ContractModel):
    url: HttpUrl
    source_type: Literal["OFFICIAL", "EXTERNAL_COMPANY", "OTHER"]
    publication_record_id: uuid.UUID | None = None


class LegacyGeoObservationOut(ContractModel):
    """迁移前模型观测的只读投影，不再接受新写入。"""

    observation_kind: Literal["LEGACY_MODEL_RESULT"]
    id: uuid.UUID
    query_topic_id: uuid.UUID
    product_id: uuid.UUID
    product_label: str
    actual_prompt: str
    model_name: str
    model_version: str | None = None
    tested_at: datetime
    web_search_enabled: bool
    answer_summary: str
    mentioned: bool
    recommendation: LegacyRecommendation
    accuracy: GeoAccuracy
    citations: list[GeoCitation]
    publication_record_ids: Annotated[list[uuid.UUID], AfterValidator(require_unique_items)] = (
        Field(json_schema_extra={"uniqueItems": True})
    )
    attachment_file_ids: Annotated[list[uuid.UUID], AfterValidator(require_unique_items)] = Field(
        json_schema_extra={"uniqueItems": True}
    )
    notes: str
    supersedes_id: uuid.UUID | None = None
    tested_by: uuid.UUID
    recorder: ActorSummary
    is_current: bool
    available_actions: list[GeoObservationAction]
    created_at: datetime


RecommendationStatus = Literal["RECOMMENDED", "NOT_RECOMMENDED"]
NonBlankText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
SearchPlatform = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)
]


class GeoArticleResultCreate(ContractModel):
    publication_record_id: uuid.UUID
    discovered: bool
    mentioned: bool
    recommendation_status: RecommendationStatus
    cited: bool
    accuracy: GeoAccuracy

    @model_validator(mode="after")
    def require_cumulative_stages(self) -> GeoArticleResultCreate:
        """逐篇阶段必须满足已批准的严格累计关系。"""
        if self.mentioned and not self.discovered:
            raise ValueError("获得提及前必须先被检索发现")
        if self.recommendation_status == "RECOMMENDED" and not self.mentioned:
            raise ValueError("获得推荐前必须先获得提及")
        if self.cited and self.recommendation_status != "RECOMMENDED":
            raise ValueError("展示引用前必须先获得推荐")
        if self.accuracy == "ACCURATE" and not self.cited:
            raise ValueError("结果准确阶段必须先展示引用")
        return self


class GeoArticleResultOut(ContractModel):
    publication_record_id: uuid.UUID
    discovered: bool | None
    mentioned: bool | None
    recommendation_status: RecommendationStatus
    cited: bool | None
    accuracy: GeoAccuracy | None
    title: str
    platform_name: str
    final_url: HttpUrl


class GeoPublicationCandidate(ContractModel):
    publication_record_id: uuid.UUID
    title: str
    platform_name: str
    final_url: HttpUrl
    status: Literal["PUBLISHED", "VERIFIED"]


class GeoPublicationCandidateList(ContractModel):
    items: list[GeoPublicationCandidate]


class GeoObservationCreate(ContractModel):
    product_id: uuid.UUID
    query_topic_id: uuid.UUID
    search_platform: SearchPlatform
    search_query: NonBlankText
    tested_at: datetime
    article_results: list[GeoArticleResultCreate] = Field(min_length=1)
    attachment_file_ids: Annotated[list[uuid.UUID], AfterValidator(require_unique_items)] = Field(
        min_length=1, json_schema_extra={"uniqueItems": True}
    )
    notes: str
    supersedes_id: uuid.UUID | None = None

    @field_validator("article_results")
    @classmethod
    def require_unique_publications(
        cls, values: list[GeoArticleResultCreate]
    ) -> list[GeoArticleResultCreate]:
        """一次观测只能对同一发布记录给出一个结论。"""
        publication_ids = [item.publication_record_id for item in values]
        if len(publication_ids) != len(set(publication_ids)):
            raise ValueError("文章结果不得重复")
        return values


class ManualGeoObservationOut(ContractModel):
    observation_kind: Literal["MANUAL_ARTICLE_SEARCH"]
    id: uuid.UUID
    query_topic_id: uuid.UUID | None
    product_id: uuid.UUID
    product_label: str
    search_platform: str
    search_query: str
    tested_at: datetime
    article_results: list[GeoArticleResultOut]
    attachment_file_ids: list[uuid.UUID]
    notes: str
    supersedes_id: uuid.UUID | None
    tested_by: uuid.UUID
    recorder: ActorSummary
    is_current: bool
    available_actions: list[GeoObservationAction]
    created_at: datetime


GeoObservationOut = Annotated[
    LegacyGeoObservationOut | ManualGeoObservationOut,
    Field(discriminator="observation_kind"),
]


class GeoObservationList(ContractModel):
    items: list[GeoObservationOut]
    page: int
    page_size: int
    total: int


class GeoMetrics(ContractModel):
    legacy_sample_count: int
    legacy_mention_rate: float | None = Field(ge=0, le=1)
    legacy_recommendation_rate: float | None = Field(ge=0, le=1)
    legacy_citation_rate: float | None = Field(ge=0, le=1)
    legacy_accuracy_rate: float | None = Field(ge=0, le=1)
    manual_observation_count: int = Field(ge=0)
    article_result_count: int = Field(ge=0)
    recommended_article_count: int = Field(ge=0)
    not_recommended_article_count: int = Field(ge=0)
    article_recommendation_rate: float | None = Field(ge=0, le=1)


class GeoInsightPeriodWindow(ContractModel):
    date_from: date
    date_to: date


class GeoInsightPeriod(ContractModel):
    current: GeoInsightPeriodWindow
    previous: GeoInsightPeriodWindow


class GeoInsightOption(ContractModel):
    id: uuid.UUID
    label: str


class GeoInsightPublicationOption(GeoInsightOption):
    platform_name: str


class GeoInsightFilterOptions(ContractModel):
    content_platforms: list[GeoInsightOption]
    geo_platforms: list[str]
    content_angles: list[str]
    publications: list[GeoInsightPublicationOption]
    query_topics: list[GeoInsightOption]


class GeoInsightRateValue(ContractModel):
    numerator: int = Field(ge=0)
    denominator: int = Field(ge=0)
    value: float | None = Field(ge=0, le=1)


class GeoInsightRatePoint(GeoInsightRateValue):
    date: date


class GeoInsightRateTrend(ContractModel):
    current: GeoInsightRateValue
    previous: GeoInsightRateValue
    change: float | None
    points: list[GeoInsightRatePoint]


class GeoInsightCountPoint(ContractModel):
    date: date
    count: int = Field(ge=0)


class GeoInsightCountTrend(ContractModel):
    current: int = Field(ge=0)
    previous: int = Field(ge=0)
    change: float | None
    points: list[GeoInsightCountPoint]


class GeoInsightTrends(ContractModel):
    mention_rate: GeoInsightRateTrend
    recommendation_rate: GeoInsightRateTrend
    citation_rate: GeoInsightRateTrend
    accuracy_rate: GeoInsightRateTrend
    not_recommended_content_count: GeoInsightCountTrend


class GeoInsightPlatformPerformance(ContractModel):
    geo_platform: str
    observation_count: int = Field(ge=0)
    mention_rate: GeoInsightRateValue
    recommendation_rate: GeoInsightRateValue
    citation_rate: GeoInsightRateValue
    accuracy_rate: GeoInsightRateValue


class GeoInsightFunnelStage(ContractModel):
    code: Literal["PUBLISHED", "DISCOVERED", "MENTIONED", "RECOMMENDED", "CITED", "ACCURATE"]
    label: str
    count: int = Field(ge=0)
    conversion_from_previous: float | None = Field(ge=0, le=1)


class GeoInsightContentPerformance(ContractModel):
    publication_record_id: uuid.UUID
    title: str
    content_platform: str
    observation_count: int = Field(ge=0)
    mention_rate: GeoInsightRateValue
    recommendation_rate: GeoInsightRateValue
    citation_rate: GeoInsightRateValue


class GeoInsightDeclineBasis(ContractModel):
    metric: Literal["citation_rate", "recommendation_rate", "mention_rate"]
    current_value: float = Field(ge=0, le=1)
    previous_value: float = Field(ge=0, le=1)
    decline: float = Field(ge=0, le=1)


class GeoInsightDecliningContent(GeoInsightContentPerformance):
    basis: list[GeoInsightDeclineBasis]


class GeoInsightLongUnmentionedContent(GeoInsightContentPerformance):
    unmentioned_days: int = Field(ge=0)
    last_mentioned_at: datetime | None


class GeoInsightContentRankings(ContractModel):
    best: list[GeoInsightContentPerformance]
    declining: list[GeoInsightDecliningContent]
    long_unmentioned: list[GeoInsightLongUnmentionedContent]


GeoCoverageStatus = Literal[
    "STABLE", "OCCASIONAL", "UNCOVERED", "INSUFFICIENT_DATA"
]


class GeoInsightCoverageCounts(ContractModel):
    stable: int = Field(ge=0)
    occasional: int = Field(ge=0)
    uncovered: int = Field(ge=0)
    insufficient_data: int = Field(ge=0)


class GeoInsightCoverageItem(ContractModel):
    query_topic_id: uuid.UUID
    canonical_question: str
    geo_platform: str
    status: GeoCoverageStatus
    observation_count: int = Field(ge=0)
    mentioned_observation_count: int = Field(ge=0)
    coverage_rate: GeoInsightRateValue


class GeoInsightQuestionCoverage(ContractModel):
    by_status: GeoInsightCoverageCounts
    matrix: list[GeoInsightCoverageItem]


class GeoInsightRecommendationBasis(ContractModel):
    metric: Literal[
        "unmentioned_days",
        "citation_rate",
        "recommendation_rate",
        "mention_rate",
        "observation_count",
        "coverage_rate",
    ]
    value: float | None
    threshold: float | None
    unit: Literal["RATIO", "PERCENTAGE_POINT", "COUNT", "DAY"]


class GeoInsightRecommendation(ContractModel):
    rule_code: Literal[
        "CONTENT_LONG_UNMENTIONED",
        "CONTENT_PERFORMANCE_DECLINE",
        "GEO_PLATFORM_PERFORMANCE_DECLINE",
        "CONTENT_NEVER_RECOMMENDED",
        "QUESTION_UNCOVERED",
        "QUESTION_OCCASIONAL",
        "QUESTION_INSUFFICIENT_DATA",
    ]
    priority: Literal["HIGH", "MEDIUM", "LOW"]
    title: str
    basis_text: str
    basis_values: list[GeoInsightRecommendationBasis]
    impact_relationship_count: int = Field(ge=0)
    publication_record_ids: list[uuid.UUID]
    geo_platforms: list[str]
    query_topic_ids: list[uuid.UUID]
    detail_path: str | None


class GeoInsightUnavailableSection(ContractModel):
    code: Literal[
        "NO_COMPLETE_OBSERVATIONS",
        "NO_COMPLETE_PREVIOUS_OBSERVATIONS",
        "NO_GEO_PLATFORMS",
        "LONG_UNMENTIONED_PERIOD_TOO_SHORT",
    ]
    message: str


class GeoInsightDataQuality(ContractModel):
    eligible_observation_count: int = Field(ge=0)
    excluded_incomplete_observation_count: int = Field(ge=0)
    excluded_incomplete_relation_count: int = Field(ge=0)
    unavailable_sections: list[GeoInsightUnavailableSection]


class GeoInsights(ContractModel):
    generated_at: datetime
    analysis_unit: Literal["MANUAL_OBSERVATION_PUBLICATION_RELATION"]
    period: GeoInsightPeriod
    filter_options: GeoInsightFilterOptions
    trends: GeoInsightTrends
    platform_performance: list[GeoInsightPlatformPerformance]
    funnel: list[GeoInsightFunnelStage]
    content_rankings: GeoInsightContentRankings
    question_coverage: GeoInsightQuestionCoverage
    recommendations: list[GeoInsightRecommendation]
    data_quality: GeoInsightDataQuality


class DashboardSummary(ContractModel):
    pending_fact_reviews: int = Field(ge=0)
    pending_content_reviews: int = Field(ge=0)
    pending_publications: int = Field(ge=0)
    publication_attention: int = Field(ge=0)
    recent_accuracy_errors: int = Field(ge=0)


class UploadIntentCreate(ContractModel):
    category: Literal["EVIDENCE", "OPERATION_SCREENSHOT", "PUBLICATION_ASSET", "PLATFORM_LOGO"]
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
