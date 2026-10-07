"""引用、声明与质量明细的闭合公共合同；筛选继承既有洞察窗口。"""

from decimal import Decimal
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BeforeValidator, Field, model_validator

from app.schemas.base import ContractModel
from app.schemas.geo_analysis import (
    GeoClaimKind,
    GeoClaimSeverity,
    GeoClaimVerdict,
    GeoSourceCategory,
)
from app.schemas.geo_insights import (
    Cohort,
    GeoOverviewDataQuality,
    GeoOverviewFilters,
    GeoOverviewRunSample,
)
from app.schemas.geo_metric_values import MetricExclusion

CellKey = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
PageSize = Annotated[Literal[10, 20, 50], BeforeValidator(int)]


class GeoInsightCitationFilters(GeoOverviewFilters):
    cell_key: CellKey
    hostname: str | None = Field(default=None, max_length=253)
    normalized_url: str | None = Field(default=None, max_length=4000)
    source_category: GeoSourceCategory | None = None
    page: int = Field(default=1, ge=1)
    page_size: PageSize = 20


class GeoInsightClaimFilters(GeoOverviewFilters):
    cell_key: CellKey
    verdict: GeoClaimVerdict | None = None
    severity: GeoClaimSeverity | None = None
    claim_kind: GeoClaimKind | None = None
    page: int = Field(default=1, ge=1)
    page_size: PageSize = 20


class GeoInsightCitationDrilldown(ContractModel):
    operation_id: Literal["listGeoInsightCitations"] = "listGeoInsightCitations"
    filters: GeoOverviewFilters
    cell_key: CellKey
    hostname: str | None = None
    normalized_url: str | None = None
    source_category: GeoSourceCategory | None = None


class GeoInsightClaimDrilldown(ContractModel):
    operation_id: Literal["listGeoInsightClaims"] = "listGeoInsightClaims"
    filters: GeoOverviewFilters
    cell_key: CellKey
    verdict: GeoClaimVerdict | None = None
    severity: GeoClaimSeverity | None = None
    claim_kind: GeoClaimKind | None = None


class GeoInsightCitationBucket(ContractModel):
    key: str
    citation_count: int = Field(ge=0)
    run_count: int = Field(ge=0)
    coverage_value: float | None
    coverage_denominator: int = Field(ge=0)
    share_value: float | None
    share_denominator: int = Field(ge=0)
    query_topic_ids: list[UUID]
    engine_surface_ids: list[UUID]
    drilldown: GeoInsightCitationDrilldown


class GeoInsightCitationSummary(ContractModel):
    cell_key: CellKey
    subject_id: UUID
    citation_count: int = Field(ge=0)
    domains: list[GeoInsightCitationBucket]
    urls: list[GeoInsightCitationBucket]
    source_categories: list[GeoInsightCitationBucket]
    drilldown: GeoInsightCitationDrilldown


class GeoInsightClaimGroup(ContractModel):
    claim_kind: GeoClaimKind
    verdict: GeoClaimVerdict
    severity: GeoClaimSeverity
    claim_count: int = Field(ge=0)
    run_count: int = Field(ge=0)
    drilldown: GeoInsightClaimDrilldown


class GeoInsightFactRiskSummary(ContractModel):
    cell_key: CellKey
    subject_id: UUID
    claim_count: int = Field(ge=0)
    verdict_counts: dict[GeoClaimVerdict, int]
    incorrect_severity_counts: dict[GeoClaimSeverity, int]
    groups: list[GeoInsightClaimGroup]
    drilldown: GeoInsightClaimDrilldown


class GeoInsightCitationSample(ContractModel):
    run_id: UUID
    batch_id: UUID
    created_at: AwareDatetime
    analysis_revision_id: UUID
    review_id: UUID | None
    citation_id: UUID
    normalized_url: str
    hostname: str
    title: str | None
    occurrences: list[int]
    source_category: GeoSourceCategory
    attributed_subject_id: UUID | None
    candidate_subject_ids: list[UUID]
    shared_domain: bool


class GeoInsightClaimSample(ContractModel):
    run_id: UUID
    batch_id: UUID
    created_at: AwareDatetime
    analysis_revision_id: UUID
    review_id: UUID | None
    claim_assessment_id: UUID
    subject_id: UUID
    fact_version_id: UUID | None
    claim_kind: GeoClaimKind
    claim_text: str
    verdict: GeoClaimVerdict
    severity: GeoClaimSeverity
    fact_excerpt: str | None
    explanation: str


class GeoInsightCitationPage(ContractModel):
    as_of: AwareDatetime
    filters: GeoInsightCitationFilters
    items: list[GeoInsightCitationSample]
    total: int = Field(ge=0)
    run_count: int = Field(ge=0)
    page: int
    page_size: int


class GeoInsightClaimPage(ContractModel):
    as_of: AwareDatetime
    filters: GeoInsightClaimFilters
    items: list[GeoInsightClaimSample]
    total: int = Field(ge=0)
    run_count: int = Field(ge=0)
    page: int
    page_size: int


QualityCode = Literal[
    "eligible_runs",
    "run_success_rate",
    "analysis_run_coverage",
    "review_backlog",
    "evidence_completeness",
    "cost_coverage",
    "model_version_coverage",
    "shared_domain",
    "collection_version",
    "analysis_version",
]


class GeoInsightQualityFilters(GeoOverviewFilters):
    quality_code: QualityCode = "eligible_runs"
    cohort: Cohort = "CANDIDATE"
    exclusion_reason: MetricExclusion | None = None
    version_key: CellKey | None = None
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    page: int = Field(default=1, ge=1)
    page_size: PageSize = 20

    @model_validator(mode="after")
    def selector_scope(self) -> Self:
        if self.version_key is not None and self.quality_code not in {
            "collection_version",
            "analysis_version",
        }:
            raise ValueError("版本筛选仅用于版本分布下钻")
        if self.currency is not None and self.quality_code != "cost_coverage":
            raise ValueError("币种筛选仅用于费用覆盖下钻")
        if self.exclusion_reason is not None and (
            self.quality_code != "eligible_runs" or self.cohort != "EXCLUDED"
        ):
            raise ValueError("排除原因筛选须选择合格运行的排除集")
        return self


class GeoInsightQualityDrilldown(ContractModel):
    operation_id: Literal["listGeoInsightQualityRuns"] = "listGeoInsightQualityRuns"
    filters: GeoOverviewFilters
    quality_code: QualityCode
    cohort: Cohort = "CANDIDATE"
    exclusion_reason: MetricExclusion | None = None
    version_key: CellKey | None = None
    currency: str | None = None


class GeoInsightCostSummary(ContractModel):
    currency: str
    known_run_count: int = Field(ge=1)
    total_amount: Decimal
    average_amount: Decimal
    drilldown: GeoInsightQualityDrilldown


class GeoInsightVersionSummary(ContractModel):
    version_key: CellKey
    source_model: str | None
    source_product: str | None
    source_version: str | None
    analyzer_version: str | None
    rule_set_version: str | None
    analysis_configuration_key: str | None
    run_count: int = Field(ge=1)
    drilldown: GeoInsightQualityDrilldown


class GeoAnswerInsightDataQuality(ContractModel):
    overview: GeoOverviewDataQuality
    shared_domain_run_count: int = Field(ge=0)
    shared_domain_citation_count: int = Field(ge=0)
    shared_domain_drilldown: GeoInsightQualityDrilldown
    excluded_drilldown: GeoInsightQualityDrilldown
    known_costs: list[GeoInsightCostSummary]
    collection_versions: list[GeoInsightVersionSummary]
    analysis_versions: list[GeoInsightVersionSummary]
    notes: list[
        Literal[
            "SHARED_DOMAIN",
            "REVIEW_BACKLOG",
            "COST_UNKNOWN",
            "MODEL_VERSION_UNKNOWN",
            "MIXED_COLLECTION_VERSIONS",
            "MIXED_ANALYSIS_VERSIONS",
            "MULTIPLE_DIMENSIONS",
        ]
    ]


class GeoInsightQualitySample(GeoOverviewRunSample):
    cost_amount: Decimal | None
    cost_currency: str | None
    source_model: str | None
    source_product: str | None
    source_version: str | None
    analyzer_version: str | None
    rule_set_version: str | None
    analysis_configuration_key: str | None
    review_required: bool
    current_review_valid: bool
    shared_domain_citation_ids: list[UUID]
    review_required_reasons: list[str]


class GeoInsightQualityPage(ContractModel):
    as_of: AwareDatetime
    filters: GeoInsightQualityFilters
    items: list[GeoInsightQualitySample]
    total: int = Field(ge=0)
    page: int
    page_size: int
