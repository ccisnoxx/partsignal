"""Slice 4C：Campaign 归因看板、全局经营指标与内容衰退预警 Schema。"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, PlainSerializer, WithJsonSchema

from app.schemas.base import ContractModel
from app.schemas.cost_accounting import CurrencyCode


def _money_str(value: Decimal) -> str:
    result = format(value.copy_abs() if value.is_zero() else value, "f")
    return result.rstrip("0").rstrip(".") if "." in result else result


MoneyString = Annotated[
    Decimal,
    PlainSerializer(_money_str, return_type=str, when_used="json"),
    WithJsonSchema({"type": "string", "pattern": r"^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$"}),
]

DecayAlertKind = Literal[
    "OVERDUE_FACT",
    "UNHEALTHY_PAGE",
    "GEO_VISIBILITY_DROP",
    "GEO_CITATION_LOST",
]
DecayAlertSeverity = Literal["HIGH", "MEDIUM"]
DecayAlertTargetType = Literal["Product", "PublishedArticle", "GeoOpportunity"]


class ProductionMetricsOut(ContractModel):
    """内容生产漏斗、审核一次通过率与周期耗时指标。"""

    task_count: int = Field(ge=0)
    approved_task_count: int = Field(ge=0)
    published_article_count: int = Field(ge=0)
    first_pass_review_rate: float | None = None
    avg_draft_to_approval_hours: float | None = None
    avg_approval_to_publish_hours: float | None = None
    avg_publish_to_verify_hours: float | None = None
    near_duplicate_version_count: int = Field(ge=0)
    overdue_fact_product_count: int = Field(ge=0)


class PublishingHealthOut(ContractModel):
    """发布成果公开页面健康分布与发布后问题处置效率。"""

    published_article_count: int = Field(ge=0)
    healthy_articles: int = Field(ge=0)
    fetch_blocked_articles: int = Field(ge=0)
    confirmed_anomaly_articles: int = Field(ge=0)
    unchecked_articles: int = Field(ge=0)
    open_issues: int = Field(ge=0)
    resolved_issues: int = Field(ge=0)
    avg_issue_resolution_hours: float | None = None


class GeoAttributionSummaryOut(ContractModel):
    """GEO 观测效果与干预闭环摘要（显式非强因果）。"""

    causal_claim: Literal["NOT_ESTABLISHED"] = "NOT_ESTABLISHED"
    sample_count: int = Field(ge=0)
    completed_run_count: int = Field(ge=0)
    missing_data_rate: float | None = None
    mention_rate: float | None = None
    recommendation_rate: float | None = None
    citation_rate: float | None = None
    accuracy_rate: float | None = None
    open_opportunity_count: int = Field(ge=0)
    resolved_opportunity_count: int = Field(ge=0)
    linked_intervention_count: int = Field(ge=0)
    concluded_intervention_count: int = Field(ge=0)


class CostSampleCoverageOut(ContractModel):
    """AI 与 GEO 样本单价覆盖率（显式披露缺失定价比例，严禁假 0）。"""

    total_ai_jobs: int = Field(ge=0)
    priced_ai_jobs: int = Field(ge=0)
    unpriced_ai_jobs: int = Field(ge=0)
    missing_price_rate: float | None = None
    total_geo_runs: int = Field(ge=0)
    priced_geo_runs: int = Field(ge=0)
    missing_geo_price_rate: float | None = None


class CurrencyCostBreakdownOut(ContractModel):
    """按单一币种分组汇总的 AI 与人工/外采运营成本明细（严禁跨币种混加）。"""

    currency: CurrencyCode
    ai_generation_cost: MoneyString
    ai_semantic_check_cost: MoneyString
    geo_collection_cost: MoneyString
    labor_cost: MoneyString
    external_placement_cost: MoneyString
    other_operating_cost: MoneyString
    total_ai_cost: MoneyString
    total_operating_cost: MoneyString
    total_cost: MoneyString


class UnitEconomicsByCurrencyOut(ContractModel):
    """按单一币种计算的单位内容与单位 GEO 样本经济学指标（分母为 0 时为 null）。"""

    currency: CurrencyCode
    cost_per_approved_content: MoneyString | None = None
    cost_per_published_article: MoneyString | None = None
    cost_per_geo_sample: MoneyString | None = None
    cost_per_resolved_opportunity: MoneyString | None = None


class CampaignAttributionDashboardOut(ContractModel):
    """单个内容活动的实时归因、生产效率、页面健康与成本看板。"""

    campaign_id: uuid.UUID
    campaign_name: str
    campaign_status: str
    causal_claim: Literal["NOT_ESTABLISHED"] = "NOT_ESTABLISHED"
    window_days: int = Field(ge=7, le=365)
    generated_at: datetime
    production: ProductionMetricsOut
    publishing_health: PublishingHealthOut
    geo_attribution: GeoAttributionSummaryOut
    cost_coverage: CostSampleCoverageOut
    costs_by_currency: list[CurrencyCostBreakdownOut]
    unit_economics_by_currency: list[UnitEconomicsByCurrencyOut]


class ContentDecayAlertItem(ContractModel):
    """内容老化与 GEO 衰退可执行预警项。"""

    kind: DecayAlertKind
    severity: DecayAlertSeverity
    target_type: DecayAlertTargetType
    target_id: uuid.UUID
    title: str
    detail: str
    navigation_path: str


class OperationsMetricsOut(ContractModel):
    """全局纯 GEO 内容运营经营看板与衰退预警。"""

    causal_claim: Literal["NOT_ESTABLISHED"] = "NOT_ESTABLISHED"
    window_days: int = Field(ge=7, le=365)
    generated_at: datetime
    active_campaign_count: int = Field(ge=0)
    production: ProductionMetricsOut
    publishing_health: PublishingHealthOut
    geo_attribution: GeoAttributionSummaryOut
    cost_coverage: CostSampleCoverageOut
    costs_by_currency: list[CurrencyCostBreakdownOut]
    unit_economics_by_currency: list[UnitEconomicsByCurrencyOut]
    decay_alerts: list[ContentDecayAlertItem]
