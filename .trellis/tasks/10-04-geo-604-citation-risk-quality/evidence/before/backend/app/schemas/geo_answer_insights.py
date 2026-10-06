"""GEO-603回答级洞察公共合同；文章关系级GeoInsights保持独立。"""

from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BeforeValidator, Field, model_validator

from app.schemas.base import ContractModel
from app.schemas.geo_insights import (
    Cohort,
    GeoOverviewDimensions,
    GeoOverviewExclusion,
    GeoOverviewFilters,
    GeoOverviewRunSample,
)
from app.schemas.geo_metric_values import SampleLevel

InsightMetric = Literal[
    "natural_visibility",
    "recommendation_rate",
    "accurate_claim_rate",
    "mention_sov",
    "recommendation_sov",
]
Period = Literal["CURRENT", "PREVIOUS"]


class GeoInsightWindow(ContractModel):
    date_from: AwareDatetime
    date_to: AwareDatetime


class GeoAnswerInsightFilters(GeoOverviewFilters):
    @model_validator(mode="after")
    def representable_previous_window(self) -> Self:
        try:
            self.date_from - (self.date_to - self.date_from)
        except OverflowError as exc:
            raise ValueError("前周期超出可表示时间范围") from exc
        return self


class GeoAnswerInsightSampleFilters(GeoAnswerInsightFilters):
    cell_key: str = Field(pattern=r"^[0-9a-f]{64}$")
    metric_code: InsightMetric
    period: Period = "CURRENT"
    cohort: Cohort = "DENOMINATOR"
    page: int = Field(default=1, ge=1)
    page_size: Annotated[Literal[10, 20, 50], BeforeValidator(int)] = 20


class GeoAnswerInsightDrilldown(ContractModel):
    operation_id: Literal["listGeoAnswerInsightRuns"] = "listGeoAnswerInsightRuns"
    filters: GeoOverviewFilters
    cell_key: str
    metric_code: InsightMetric
    period: Period
    cohort: Cohort


class GeoAnswerInsightMetric(ContractModel):
    metric_code: InsightMetric
    formula_version: str
    value: float | None
    numerator: int = Field(ge=0)
    denominator: int = Field(ge=0)
    sample_level: SampleLevel
    eligible_run_count: int = Field(ge=0)
    excluded_run_count: int = Field(ge=0)
    exclusion_reason_counts: list[GeoOverviewExclusion]
    unjudgeable_claim_count: int = Field(ge=0)
    unavailable_reason: Literal["NO_DENOMINATOR"] | None
    drilldown: GeoAnswerInsightDrilldown


class GeoAnswerInsightCell(ContractModel):
    cell_key: str
    subject_id: UUID
    product_id: UUID | None
    display_name: str
    selected_subject: bool
    dimensions: GeoOverviewDimensions
    sov_subject_ids: list[UUID]
    metrics: list[GeoAnswerInsightMetric]


class GeoAnswerInsightTrend(ContractModel):
    subject_id: UUID
    prompt_variant_id: UUID
    collection_profile_id: UUID
    metric_code: InsightMetric
    current_cell_keys: list[str]
    previous_cell_keys: list[str]
    change_points: float | None
    relative_change: float | None
    minimum_run_count: int
    unavailable_reasons: list[
        Literal[
            "MISSING_WINDOW",
            "MIXED_DIMENSIONS",
            "COMPETITOR_SET_CHANGED",
            "DIMENSIONS_CHANGED",
            "FORMULA_CHANGED",
            "NO_DENOMINATOR",
            "INSUFFICIENT_SAMPLE",
        ]
    ]
    changed_dimensions: list[str]
    version_warnings: list[
        Literal[
            "MODEL_VERSION_CHANGED",
            "MODEL_VERSION_UNKNOWN",
            "PRODUCT_VERSION_CHANGED",
            "PRODUCT_VERSION_UNKNOWN",
        ]
    ]


class GeoQuestionVariantCoverage(ContractModel):
    cell_key: str
    classification: Literal["DATA_INSUFFICIENT", "NOT_VISIBLE", "OCCASIONAL", "STABLE"] | None
    unavailable_reason: Literal["INSUFFICIENT_SAMPLE", "INSUFFICIENT_STABLE_SAMPLE"] | None
    target_reached: bool


class GeoQuestionCoverage(ContractModel):
    subject_id: UUID
    # 显式分层，只在同一环境/规则中跨问题主题计主题数；变体完整保留。
    stratum_key: str
    variant_results: list[GeoQuestionVariantCoverage]
    monitored_topic_ids: list[UUID]
    eligible_topic_ids: list[UUID]
    reached_topic_ids: list[UUID]
    target_topic_coverage: float | None
    positive_topic_coverage: float | None
    numerator: int = Field(ge=0)
    monitored_denominator: int = Field(ge=0)
    eligible_denominator: int = Field(ge=0)
    target_rate: float
    reportable_minimum: int
    stable_minimum: int


class GeoPlatformPerformance(ContractModel):
    engine_surface_id: UUID
    cell_keys: list[str]


class GeoAnswerInsights(ContractModel):
    as_of: AwareDatetime
    filters: GeoOverviewFilters
    current_window: GeoInsightWindow
    previous_window: GeoInsightWindow
    current_cells: list[GeoAnswerInsightCell]
    previous_cells: list[GeoAnswerInsightCell]
    trends: list[GeoAnswerInsightTrend]
    product_matrix_cell_keys: list[str]
    question_coverage: list[GeoQuestionCoverage]
    platform_performance: list[GeoPlatformPerformance]
    competitor_sov_cell_keys: list[str]
    unavailable_sections: list[
        Literal["CITATION_INSIGHTS", "FACT_RISKS", "DATA_QUALITY", "OPPORTUNITIES"]
    ]


class GeoAnswerInsightRunPage(ContractModel):
    as_of: AwareDatetime
    filters: GeoAnswerInsightSampleFilters
    items: list[GeoOverviewRunSample]
    total: int = Field(ge=0)
    page: int
    page_size: int
