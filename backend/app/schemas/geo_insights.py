"""回答级 Overview 公共读合同；旧文章关系洞察保持独立。"""

from datetime import UTC
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BeforeValidator, Field, model_validator

from app.geo_prompt_variants import GeoPromptMentionMode
from app.schemas.base import ContractModel
from app.schemas.configuration import IntentType
from app.schemas.geo_metric_values import MetricExclusion, SampleLevel
from app.schemas.geo_prompt_variants import PromptLanguage, PromptRegion
from app.schemas.geo_runs import GeoRunStatus
from app.schemas.geo_surfaces import GeoCollectionMode, GeoProfileLoginState

Identities = Annotated[list[UUID], Field(max_length=50)]
OverviewMetric = Literal[
    "answer_coverage",
    "natural_visibility",
    "product_mention",
    "recommendation_rate",
    "top_recommendation_rate",
    "owned_source_coverage",
    "accurate_claim_rate",
    "severe_error_run_rate",
    "eligible_runs",
    "run_success_rate",
    "analysis_run_coverage",
    "review_backlog",
    "evidence_completeness",
    "cost_coverage",
    "model_version_coverage",
]
Cohort = Literal["CANDIDATE", "DENOMINATOR", "NUMERATOR", "EXCLUDED"]


class GeoOverviewFilters(ContractModel):
    date_from: AwareDatetime
    date_to: AwareDatetime
    subject_ids: Identities = Field(default_factory=list)
    product_ids: Identities = Field(default_factory=list)
    query_topic_ids: Identities = Field(default_factory=list)
    prompt_variant_ids: Identities = Field(default_factory=list)
    engine_surface_ids: Identities = Field(default_factory=list)
    collection_profile_ids: Identities = Field(default_factory=list)
    collection_modes: list[GeoCollectionMode] = Field(default_factory=list, max_length=3)
    language_codes: list[PromptLanguage] = Field(default_factory=list, max_length=50)
    region_codes: list[PromptRegion] = Field(default_factory=list, max_length=50)
    login_states: list[GeoProfileLoginState] = Field(default_factory=list, max_length=3)
    intent_types: list[IntentType] = Field(default_factory=list, max_length=10)
    mention_mode: GeoPromptMentionMode | None = None
    review_policy: Literal["EFFECTIVE", "REVIEWED_ONLY"] = "EFFECTIVE"

    @model_validator(mode="after")
    def window_and_sets(self) -> Self:
        if self.date_from >= self.date_to:
            raise ValueError("时间窗口必须满足 date_from < date_to")
        self.date_from = self.date_from.astimezone(UTC)
        self.date_to = self.date_to.astimezone(UTC)
        for name in (
            "subject_ids",
            "product_ids",
            "query_topic_ids",
            "prompt_variant_ids",
            "engine_surface_ids",
            "collection_profile_ids",
            "collection_modes",
            "language_codes",
            "region_codes",
            "login_states",
            "intent_types",
        ):
            setattr(self, name, sorted(set(getattr(self, name))))
        return self


class GeoOverviewSampleFilters(GeoOverviewFilters):
    metric_code: OverviewMetric
    cell_key: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    cohort: Cohort = "DENOMINATOR"
    batch_id: UUID | None = None
    page: int = Field(default=1, ge=1)
    page_size: Annotated[Literal[10, 20, 50], BeforeValidator(int)] = 20


class GeoOverviewDrilldown(ContractModel):
    operation_id: Literal["listGeoOverviewRuns"] = "listGeoOverviewRuns"
    filters: GeoOverviewFilters
    metric_code: OverviewMetric
    cell_key: str | None
    cohort: Cohort
    batch_id: UUID | None


class GeoOverviewExclusion(ContractModel):
    code: MetricExclusion
    run_count: int = Field(ge=0)


class GeoOverviewCard(ContractModel):
    metric_code: OverviewMetric
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
    drilldown: GeoOverviewDrilldown


class GeoOverviewDimensions(ContractModel):
    query_topic_id: UUID
    query_topic_revision: int
    prompt_variant_id: UUID
    prompt_revision: int
    collection_profile_id: UUID
    profile_revision: int
    engine_surface_id: UUID
    surface_revision: int
    collection_mode: GeoCollectionMode
    language_code: str
    region_code: str
    login_state: GeoProfileLoginState
    mention_mode: GeoPromptMentionMode
    intent_type: IntentType
    source_model: str | None
    source_product: str | None
    model_version: str | None
    product_version: str | None
    rule_set_version: str
    analysis_configuration_key: str
    subject_versions: list[tuple[UUID, int]]
    fact_version_bindings: list[tuple[UUID, UUID]]
    window_key: str


class GeoOverviewCell(ContractModel):
    cell_key: str
    subject_id: UUID
    product_id: UUID | None
    display_name: str
    dimensions: GeoOverviewDimensions
    cards: list[GeoOverviewCard]


class GeoOverviewRisk(ContractModel):
    cell_key: str
    subject_id: UUID
    severe_error: GeoOverviewCard


class GeoOverviewBatch(ContractModel):
    batch_id: UUID
    created_at: AwareDatetime
    candidate_run_count: int = Field(ge=0)
    status_counts: dict[GeoRunStatus, int]
    drilldown: GeoOverviewDrilldown


class GeoOverviewOpportunityPlaceholder(ContractModel):
    available: Literal[False] = False
    reason_code: Literal["NOT_IMPLEMENTED"] = "NOT_IMPLEMENTED"
    open_count: None = None
    numerator: None = None
    denominator: None = None
    filters: GeoOverviewFilters


class GeoOverviewDataQuality(ContractModel):
    candidate_run_count: int = Field(ge=0)
    eligible_run_count: int = Field(ge=0)
    excluded_run_count: int = Field(ge=0)
    exclusion_reason_counts: list[GeoOverviewExclusion]
    status_counts: dict[GeoRunStatus, int]
    dimension_count: int = Field(ge=0)
    cards: list[GeoOverviewCard]


class GeoOverview(ContractModel):
    as_of: AwareDatetime
    filters: GeoOverviewFilters
    cards: list[GeoOverviewCard]
    metric_cells: list[GeoOverviewCell]
    key_products: list[GeoOverviewCell]
    risks: list[GeoOverviewRisk]
    recent_batches: list[GeoOverviewBatch]
    open_opportunities: GeoOverviewOpportunityPlaceholder
    data_quality: GeoOverviewDataQuality
    unavailable_sections: list[
        Literal["TRENDS", "COMPETITOR_SOV", "INSIGHT_DETAILS", "OPPORTUNITIES"]
    ]


class GeoOverviewRunSample(ContractModel):
    run_id: UUID
    batch_id: UUID
    created_at: AwareDatetime
    status: GeoRunStatus
    analysis_revision_id: UUID | None
    review_id: UUID | None
    numerator: int = Field(ge=0)
    denominator: int = Field(ge=0)
    exclusion_reasons: list[MetricExclusion]


class GeoOverviewRunPage(ContractModel):
    as_of: AwareDatetime
    filters: GeoOverviewSampleFilters
    items: list[GeoOverviewRunSample]
    total: int = Field(ge=0)
    page: int
    page_size: int
