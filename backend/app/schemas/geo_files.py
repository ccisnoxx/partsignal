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
from app.schemas.content import ActorSummary, ContentTag
from app.schemas.product_facts import Confidentiality
from app.schemas.publication import FileRecordOut

GeoObservationKind = Literal["LEGACY_MODEL_RESULT", "MANUAL_ARTICLE_SEARCH"]
GeoObservationAction = Literal["CORRECT", "DELETE"]
GeoObservationSortOrder = Literal["ASC", "DESC"]
LegacyRecommendation = Literal["NONE", "CANDIDATE", "RECOMMENDED"]
GeoAccuracy = Literal["ACCURATE", "PARTIAL", "INCORRECT", "UNJUDGEABLE"]


class GeoCitation(ContractModel):
    url: HttpUrl
    source_type: Literal["OFFICIAL", "EXTERNAL_COMPANY", "OTHER"]
    published_article_id: uuid.UUID | None = None


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
    published_article_ids: Annotated[list[uuid.UUID], AfterValidator(require_unique_items)] = (
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
    workflow_stage: Literal["LEGACY"]
    primary_task: Literal["VIEW_HISTORICAL_RECORD"]
    available_actions: list[Literal["CORRECT"]]
    created_at: datetime


NonBlankText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
SearchPlatform = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)
]


class GeoArticleResultCreate(ContractModel):
    published_article_id: uuid.UUID
    discovered: bool
    mentioned: bool
    accuracy: GeoAccuracy | None


class GeoArticleResultOut(ContractModel):
    published_article_id: uuid.UUID
    discovered: bool | None
    mentioned: bool | None
    accuracy: GeoAccuracy | None
    title: str
    platform_name: str
    final_url: HttpUrl


class GeoPublicationCandidate(ContractModel):
    published_article_id: uuid.UUID
    title: str
    platform_name: str
    final_url: HttpUrl
    status: Literal["COMPLETED"]


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
        default_factory=list,
        json_schema_extra={"uniqueItems": True},
    )
    notes: str
    supersedes_id: uuid.UUID | None = None

    @field_validator("article_results")
    @classmethod
    def require_unique_publications(
        cls, values: list[GeoArticleResultCreate]
    ) -> list[GeoArticleResultCreate]:
        """一次观测只能对同一发布成果给出一个结论。"""
        publication_ids = [item.published_article_id for item in values]
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
    workflow_stage: Literal["READY", "INCOMPLETE", "SUPERSEDED"]
    primary_task: Literal[
        "VIEW_ANALYSIS", "CORRECT_OBSERVATION", "VIEW_CORRECTION_HISTORY"
    ]
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
    discovered_article_count: int = Field(ge=0)
    mentioned_article_count: int = Field(ge=0)
    article_discovery_rate: float | None = Field(ge=0, le=1)
    article_mention_rate: float | None = Field(ge=0, le=1)
    article_accuracy_rate: float | None = Field(ge=0, le=1)


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
    products: list[GeoInsightOption]
    content_platforms: list[GeoInsightOption]
    geo_platforms: list[str]
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


class GeoInsightTrends(ContractModel):
    discovery_rate: GeoInsightRateTrend
    mention_rate: GeoInsightRateTrend
    accuracy_rate: GeoInsightRateTrend


class GeoInsightPlatformPerformance(ContractModel):
    geo_platform: str
    observation_count: int = Field(ge=0)
    discovery_rate: GeoInsightRateValue
    mention_rate: GeoInsightRateValue
    accuracy_rate: GeoInsightRateValue
    primary_task: Literal["VIEW_OBSERVATION_DETAILS"]


class GeoInsightContentPerformance(ContractModel):
    published_article_id: uuid.UUID
    product_id: uuid.UUID
    content_platform_id: uuid.UUID
    title: str
    content_platform: str
    observation_count: int = Field(ge=0)
    discovery_rate: GeoInsightRateValue
    mention_rate: GeoInsightRateValue
    accuracy_rate: GeoInsightRateValue
    primary_task: Literal[
        "VIEW_CONTENT_PERFORMANCE", "CREATE_OPTIMIZATION_TASK"
    ]


class GeoInsightDeclineBasis(ContractModel):
    metric: Literal["discovery_rate", "mention_rate", "accuracy_rate"]
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
    primary_task: Literal[
        "VIEW_OBSERVATION_DETAILS", "CREATE_OPTIMIZATION_TASK", "ADD_OBSERVATION"
    ]


class GeoInsightQuestionCoverage(ContractModel):
    by_status: GeoInsightCoverageCounts
    matrix: list[GeoInsightCoverageItem]


class GeoInsightRecommendationBasis(ContractModel):
    metric: Literal[
        "unmentioned_days",
        "discovery_rate",
        "mention_rate",
        "accuracy_rate",
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
        "CONTENT_NEVER_DISCOVERED",
        "QUESTION_UNCOVERED",
        "QUESTION_OCCASIONAL",
        "QUESTION_INSUFFICIENT_DATA",
    ]
    priority: Literal["HIGH", "MEDIUM", "LOW"]
    title: str
    basis_text: str
    basis_values: list[GeoInsightRecommendationBasis]
    impact_relationship_count: int = Field(ge=0)
    published_article_ids: list[uuid.UUID]
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
    content_rankings: GeoInsightContentRankings
    question_coverage: GeoInsightQuestionCoverage
    recommendations: list[GeoInsightRecommendation]
    data_quality: GeoInsightDataQuality


class GeoOptimizationContentTaskCreate(ContractModel):
    rule_code: Literal["CONTENT_DECLINE", "LONG_UNMENTIONED", "QUESTION_COVERAGE_GAP"]
    date_from: date
    date_to: date
    published_article_id: uuid.UUID | None = None
    query_topic_id: uuid.UUID | None = None
    geo_platform: SearchPlatform | None = None
    product_id: uuid.UUID
    platform_profile_id: uuid.UUID
    fact_version_id: uuid.UUID

    @model_validator(mode="after")
    def validate_source_identity(self) -> GeoOptimizationContentTaskCreate:
        """每类优化规则必须携带可由服务端复算的唯一异常身份。"""
        if self.date_from > self.date_to:
            raise ValueError("开始日期不能晚于结束日期")
        if self.rule_code in {"CONTENT_DECLINE", "LONG_UNMENTIONED"}:
            if self.published_article_id is None:
                raise ValueError("内容表现异常必须指定发布成果")
        elif self.query_topic_id is None or self.geo_platform is None:
            raise ValueError("问题覆盖异常必须指定问题主题和 GEO 平台")
        return self


class GeoContentDeclineBasis(ContractModel):
    rule_code: Literal["CONTENT_DECLINE"]
    item: GeoInsightDecliningContent


class GeoLongUnmentionedBasis(ContractModel):
    rule_code: Literal["LONG_UNMENTIONED"]
    item: GeoInsightLongUnmentionedContent


class GeoQuestionCoverageGapBasis(ContractModel):
    rule_code: Literal["QUESTION_COVERAGE_GAP"]
    item: GeoInsightCoverageItem


class DashboardSummary(ContractModel):
    pending_fact_reviews: int = Field(ge=0)
    pending_content_reviews: int = Field(ge=0)
    pending_publications: int = Field(ge=0)
    open_publication_issues: int = Field(ge=0)
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


class GeneratedDraft(ContractModel):
    """开发与真实模型共同遵循的严格四字段输出边界。"""

    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    body_markdown: str = Field(min_length=1)
    tags: list[ContentTag] = Field(min_length=1)

    @model_validator(mode="after")
    def reject_blank_output(self) -> GeneratedDraft:
        """拒绝仅由空白组成的正文，不替模型修复内容。"""
        if not self.title.strip() or not self.summary.strip() or not self.body_markdown.strip():
            raise ValueError("模型输出字段不能为空白")
        return self


JsonObject = dict[str, Any]
