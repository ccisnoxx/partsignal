"""Frontend V2 Workbench 聚合读模型合同。"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal, Self

from pydantic import Field, model_validator

from app.schemas.base import ContractModel

WorkbenchHealthStatus = Literal["CLEAR", "ATTENTION"]
WorkbenchAttentionCategory = Literal[
    "FACT_REVIEW",
    "CONTENT_REVIEW",
    "PUBLICATION_VERIFICATION",
    "PUBLICATION_ACTION",
    "CONTENT_ISSUE",
    "GEO_ACCURACY_ISSUE",
]
RelativeHref = Annotated[str, Field(min_length=1, pattern=r"^/")]
NonblankLabel = Annotated[str, Field(min_length=1)]


class WorkbenchLink(ContractModel):
    label: NonblankLabel
    href: RelativeHref


class WorkbenchCount(ContractModel):
    value: int = Field(ge=0)
    href: RelativeHref


class WorkbenchMultiLinkCount(ContractModel):
    value: int = Field(ge=0)
    links: Annotated[list[WorkbenchLink], Field(min_length=1)]


class WorkbenchActionableCounts(ContractModel):
    fact_reviews: WorkbenchCount
    content_reviews: WorkbenchCount
    publication_verifications: WorkbenchCount
    publication_actions: WorkbenchMultiLinkCount
    content_issues: WorkbenchCount
    geo_accuracy_issues: WorkbenchMultiLinkCount


class WorkbenchWorkflowHealthItem(ContractModel):
    status: WorkbenchHealthStatus
    summary: NonblankLabel


class WorkbenchWorkflowHealth(ContractModel):
    product_facts: WorkbenchWorkflowHealthItem
    content: WorkbenchWorkflowHealthItem
    publication: WorkbenchWorkflowHealthItem
    geo: WorkbenchWorkflowHealthItem


class WorkbenchRate(ContractModel):
    numerator: int = Field(ge=0)
    denominator: int = Field(ge=0)
    value: float | None = Field(ge=0, le=1)

    @model_validator(mode="after")
    def validate_rate(self) -> Self:
        """分数、分母与可空比率必须描述同一个事实。"""
        if self.numerator > self.denominator:
            raise ValueError("Workbench rate 分子不能大于分母")
        if self.denominator == 0:
            if self.value is not None:
                raise ValueError("Workbench rate 无样本时 value 必须为 null")
            return self
        expected = self.numerator / self.denominator
        if self.value is None or abs(self.value - expected) > 1e-12:
            raise ValueError("Workbench rate value 与计数不一致")
        return self


class WorkbenchWindow(ContractModel):
    date_from: date
    date_to: date

    @model_validator(mode="after")
    def validate_window(self) -> Self:
        """窗口必须按正向自然日表达。"""
        if self.date_from > self.date_to:
            raise ValueError("Workbench window 开始日期不能晚于结束日期")
        return self


class WorkbenchGeoSummary(ContractModel):
    window: WorkbenchWindow
    discovery_rate: WorkbenchRate
    mention_rate: WorkbenchRate
    accuracy_rate: WorkbenchRate


class WorkbenchAttentionItem(ContractModel):
    category: WorkbenchAttentionCategory
    resource_id: uuid.UUID
    title: NonblankLabel
    summary: NonblankLabel
    occurred_at: datetime
    href: RelativeHref


class WorkbenchAggregate(ContractModel):
    generated_at: datetime
    actionable_counts: WorkbenchActionableCounts
    workflow_health: WorkbenchWorkflowHealth
    geo_summary: WorkbenchGeoSummary
    recent_attention_items: Annotated[
        list[WorkbenchAttentionItem], Field(max_length=10)
    ]
