"""内容活动策划（ContentCampaign）读写 Schema。"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BeforeValidator,
    Field,
    PlainSerializer,
    StringConstraints,
    WithJsonSchema,
    model_validator,
)

from app.schemas.base import ContractModel, require_unique_items
from app.schemas.common import DeletionProjection
from app.schemas.configuration import IntentType
from app.schemas.product_facts import ProductFactsFreshness, ProductStatus

WorkPriority = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
ContentCampaignStatus = Literal["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]
ContentCampaignWorkflowStage = ContentCampaignStatus
ContentCampaignPrimaryTask = Literal[
    "CONFIGURE_CAMPAIGN",
    "ACTIVATE_CAMPAIGN",
    "MANAGE_CAMPAIGN",
    "RESUME_CAMPAIGN",
    "ARCHIVE_CAMPAIGN",
    "VIEW_HISTORY",
]
ContentCampaignAction = Literal[
    "UPDATE",
    "ACTIVATE",
    "PAUSE",
    "RESUME",
    "COMPLETE",
    "ARCHIVE",
    "DELETE",
    "PLAN_TASKS",
]

CAMPAIGN_BUDGET_PATTERN = r"^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$(?![\s\S])"


def _budget_input(value: object) -> object:
    if isinstance(value, Decimal):
        return value
    if not isinstance(value, str) or re.fullmatch(CAMPAIGN_BUDGET_PATTERN, value) is None:
        raise ValueError("预算金额必须为非负十进制字符串，最多 12 位整数和 2 位小数")
    return value


def _budget_output(value: Decimal) -> str:
    result = format(value.copy_abs() if value.is_zero() else value, "f")
    return result.rstrip("0").rstrip(".") if "." in result else result


CampaignBudgetAmount = Annotated[
    Decimal,
    Field(ge=0, max_digits=14, decimal_places=2, allow_inf_nan=False),
    BeforeValidator(_budget_input),
    PlainSerializer(_budget_output, return_type=str, when_used="json"),
    WithJsonSchema({"type": "string", "pattern": CAMPAIGN_BUDGET_PATTERN}),
]
CampaignCurrency = Annotated[
    str,
    StringConstraints(strip_whitespace=True, pattern=r"^[A-Z]{3}$"),
]
CampaignName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
]
CampaignDescription = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=4000),
]
CampaignAudience = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=500),
]


class ContentCampaignOwner(ContractModel):
    """活动负责人最小展示摘要。"""

    id: uuid.UUID
    username: str
    display_name: str


class ContentCampaignSummary(ContractModel):
    """嵌入任务、详情与编辑器投影的紧凑活动摘要。"""

    id: uuid.UUID
    name: str
    status: ContentCampaignStatus


class ContentCampaignTargetMetrics(ContractModel):
    """活动闭合结构化目标指标。"""

    target_content_count: int | None = Field(default=None, ge=1, le=10000)
    target_discovery_rate: float | None = Field(default=None, ge=0.0, le=1.0)
    target_mention_rate: float | None = Field(default=None, ge=0.0, le=1.0)
    target_recommendation_rate: float | None = Field(default=None, ge=0.0, le=1.0)
    target_citation_rate: float | None = Field(default=None, ge=0.0, le=1.0)


class ContentCampaignCreate(ContractModel):
    name: CampaignName
    description: CampaignDescription = ""
    target_audience: CampaignAudience = ""
    owner_id: uuid.UUID | None = None
    priority: WorkPriority = "MEDIUM"
    start_date: date | None = None
    end_date: date | None = None
    target_metrics: ContentCampaignTargetMetrics = Field(
        default_factory=ContentCampaignTargetMetrics
    )
    budget_amount: CampaignBudgetAmount | None = None
    budget_currency: CampaignCurrency | None = None
    product_ids: Annotated[list[uuid.UUID], AfterValidator(require_unique_items)] = Field(
        default_factory=list, max_length=100, json_schema_extra={"uniqueItems": True}
    )
    query_topic_ids: Annotated[list[uuid.UUID], AfterValidator(require_unique_items)] = Field(
        default_factory=list, max_length=100, json_schema_extra={"uniqueItems": True}
    )
    platform_profile_ids: Annotated[list[uuid.UUID], AfterValidator(require_unique_items)] = Field(
        default_factory=list, max_length=50, json_schema_extra={"uniqueItems": True}
    )
    monitoring_plan_ids: Annotated[list[uuid.UUID], AfterValidator(require_unique_items)] = Field(
        default_factory=list, max_length=50, json_schema_extra={"uniqueItems": True}
    )

    @model_validator(mode="after")
    def _validate_pairs(self) -> Self:
        if (
            self.start_date is not None
            and self.end_date is not None
            and self.start_date > self.end_date
        ):
            raise ValueError("活动开始日期不能晚于结束日期")
        if (self.budget_amount is None) != (self.budget_currency is None):
            raise ValueError("预算金额与币种必须同时填写或同时留空")
        return self


class ContentCampaignUpdate(ContentCampaignCreate):
    owner_id: uuid.UUID
    expected_revision: int = Field(ge=0)


class ContentCampaignCounts(ContractModel):
    product_count: int = Field(ge=0)
    topic_count: int = Field(ge=0)
    platform_count: int = Field(ge=0)
    monitoring_plan_count: int = Field(ge=0)
    task_count: int = Field(ge=0)
    published_article_count: int = Field(ge=0)


class ContentCampaignProductItem(ContractModel):
    id: uuid.UUID
    brand: str
    part_number: str
    status: ProductStatus
    has_approved_fact: bool
    facts_freshness: ProductFactsFreshness


class ContentCampaignTopicItem(ContractModel):
    id: uuid.UUID
    canonical_question: str
    intent_type: IntentType
    is_active: bool
    description: str


class ContentCampaignPlatformItem(ContractModel):
    id: uuid.UUID
    name: str
    is_active: bool
    configuration_complete: bool


class ContentCampaignMonitoringPlanItem(ContractModel):
    id: uuid.UUID
    name: str
    status: Literal["DISABLED", "ACTIVE", "PAUSED", "ARCHIVED"]


class ContentCampaignListItem(ContractModel):
    id: uuid.UUID
    name: str
    description: str
    target_audience: str
    owner: ContentCampaignOwner
    priority: WorkPriority
    status: ContentCampaignStatus
    start_date: date | None
    end_date: date | None
    target_metrics: ContentCampaignTargetMetrics
    budget_amount: CampaignBudgetAmount | None
    budget_currency: CampaignCurrency | None
    counts: ContentCampaignCounts
    workflow_stage: ContentCampaignWorkflowStage
    primary_task: ContentCampaignPrimaryTask
    available_actions: list[ContentCampaignAction]
    deletion: DeletionProjection | None
    revision: int = Field(ge=0)
    created_by: uuid.UUID
    updated_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class ContentCampaignDetail(ContentCampaignListItem):
    products: list[ContentCampaignProductItem]
    topics: list[ContentCampaignTopicItem]
    platforms: list[ContentCampaignPlatformItem]
    monitoring_plans: list[ContentCampaignMonitoringPlanItem]


class ContentCampaignListPage(ContractModel):
    items: list[ContentCampaignListItem]
    page: int = Field(ge=1)
    page_size: Literal[10, 20, 50]
    total: int = Field(ge=0)


class ContentCampaignOptions(ContractModel):
    owners: list[ContentCampaignOwner]
    products: list[ContentCampaignProductItem]
    topics: list[ContentCampaignTopicItem]
    platforms: list[ContentCampaignPlatformItem]
    monitoring_plans: list[ContentCampaignMonitoringPlanItem]
