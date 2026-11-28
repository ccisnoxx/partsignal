"""Slice 4A：GEO 干预编排与归因层 Schema。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Self

from pydantic import AwareDatetime, Field, field_validator, model_validator

from app.schemas.base import ContractModel
from app.schemas.geo_metric_values import GeoConfidenceInterval, GeoDeltaConfidenceInterval

GeoInterventionActionType = Literal[
    "FACT_REVISION",
    "CONTENT_TASK",
    "PUBLICATION_REPAIR",
    "ADDITIONAL_MONITORING",
    "OTHER",
]
GeoInterventionStatus = Literal["PLANNED", "ACTIVE", "EVALUATING", "CONCLUDED", "CANCELLED"]
GeoInterventionOutcomeVerdict = Literal[
    "TARGET_MET",
    "PARTIAL_IMPROVEMENT",
    "NO_IMPROVEMENT",
    "INSUFFICIENT_DATA",
]


class GeoInterventionTargetMetrics(ContractModel):
    """闭合目标指标定义（均按 0..1 比率表达，避免无界键）。"""

    target_discovery_rate: float | None = Field(default=None, ge=0.0, le=1.0)
    target_mention_rate: float | None = Field(default=None, ge=0.0, le=1.0)
    target_recommendation_rate: float | None = Field(default=None, ge=0.0, le=1.0)
    target_citation_rate: float | None = Field(default=None, ge=0.0, le=1.0)
    target_accuracy_rate: float | None = Field(default=None, ge=0.0, le=1.0)


class GeoInterventionCreate(ContractModel):
    """创建 GEO 干预归因记录的命令载荷。"""

    opportunity_id: uuid.UUID
    campaign_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=200)
    hypothesis: str = Field(min_length=1, max_length=2000)
    planned_action_type: GeoInterventionActionType
    target_metrics: GeoInterventionTargetMetrics = Field(
        default_factory=GeoInterventionTargetMetrics
    )
    baseline_id: uuid.UUID | None = None
    assignee_id: uuid.UUID | None = None
    intervened_at: AwareDatetime | None = None
    retest_window_start: AwareDatetime | None = None
    retest_window_end: AwareDatetime | None = None

    @field_validator("title", "hypothesis")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("字段不能为空")
        return cleaned

    @model_validator(mode="after")
    def _validate_window(self) -> Self:
        if (
            self.retest_window_start is not None
            and self.retest_window_end is not None
            and self.retest_window_start > self.retest_window_end
        ):
            raise ValueError("复测开始时间不能晚于结束时间")
        return self


class GeoInterventionUpdate(ContractModel):
    """更新非终态 GEO 干预的命令载荷（CAS expected_revision）。"""

    campaign_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=200)
    hypothesis: str = Field(min_length=1, max_length=2000)
    planned_action_type: GeoInterventionActionType
    status: Literal["PLANNED", "ACTIVE", "EVALUATING"]
    target_metrics: GeoInterventionTargetMetrics = Field(
        default_factory=GeoInterventionTargetMetrics
    )
    baseline_id: uuid.UUID | None = None
    decision_id: uuid.UUID | None = None
    assignee_id: uuid.UUID | None = None
    intervened_at: AwareDatetime | None = None
    retest_window_start: AwareDatetime | None = None
    retest_window_end: AwareDatetime | None = None
    expected_revision: int = Field(ge=0)

    @field_validator("title", "hypothesis")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("字段不能为空")
        return cleaned

    @model_validator(mode="after")
    def _validate_window(self) -> Self:
        if (
            self.retest_window_start is not None
            and self.retest_window_end is not None
            and self.retest_window_start > self.retest_window_end
        ):
            raise ValueError("复测开始时间不能晚于结束时间")
        return self


class GeoInterventionConcludeRequest(ContractModel):
    """结案 GEO 干预并冻结归因结论（CAS expected_revision）。"""

    outcome_verdict: GeoInterventionOutcomeVerdict
    conclusion_note: str = Field(min_length=1, max_length=2000)
    decision_id: uuid.UUID | None = None
    expected_revision: int = Field(ge=0)

    @field_validator("conclusion_note")
    @classmethod
    def _strip_note(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("结案说明不能为空")
        return cleaned


class GeoInterventionCancelRequest(ContractModel):
    """取消非终态 GEO 干预（CAS expected_revision）。"""

    reason: str = Field(min_length=1, max_length=500)
    expected_revision: int = Field(ge=0)

    @field_validator("reason")
    @classmethod
    def _strip_reason(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("取消原因不能为空")
        return cleaned


class GeoInterventionLinkedActionOut(ContractModel):
    """由对应 GeoOpportunity 派生的下游行动摘要。"""

    action_id: uuid.UUID
    action_type: str
    target_type: str
    target_id: uuid.UUID | None
    status_snapshot: str
    created_at: datetime


class GeoInterventionMetricDeltaOut(ContractModel):
    """基线与复测窗口间的单项指标变化、样本量、95% 统计置信区间与达标状态。"""

    metric_code: str
    baseline_value: float | None
    retest_value: float | None
    delta: float | None
    target_value: float | None
    target_met: bool | None
    baseline_sample_size: int | None = Field(default=None, ge=0)
    retest_sample_size: int | None = Field(default=None, ge=0)
    baseline_ci: GeoConfidenceInterval | None = None
    retest_ci: GeoConfidenceInterval | None = None
    delta_ci: GeoDeltaConfidenceInterval | None = None


class GeoInterventionAttributionOut(ContractModel):
    """显式非强因果归因证据摘要（延续 R6 可比性与样本完整性口径）。"""

    causal_claim: Literal["NOT_ESTABLISHED"] = "NOT_ESTABLISHED"
    comparable: bool | None
    comparability_reasons: list[str]
    baseline_batch_id: uuid.UUID | None
    retest_batch_id: uuid.UUID | None
    baseline_sample_count: int = Field(ge=0)
    baseline_completed_run_count: int = Field(ge=0)
    retest_sample_count: int = Field(ge=0)
    retest_completed_run_count: int = Field(ge=0)
    missing_data_rate: float | None = Field(default=None, ge=0.0, le=1.0)
    metric_deltas: list[GeoInterventionMetricDeltaOut]
    linked_actions: list[GeoInterventionLinkedActionOut]
    linked_content_task_ids: list[uuid.UUID]
    linked_published_article_ids: list[uuid.UUID]


class GeoInterventionOut(ContractModel):
    """GEO 干预完整视图（含关联机会/活动身份与只读归因证据）。"""

    id: uuid.UUID
    opportunity_id: uuid.UUID
    opportunity_rule_code: str
    opportunity_status: str
    campaign_id: uuid.UUID | None
    campaign_name: str | None
    title: str
    hypothesis: str
    planned_action_type: GeoInterventionActionType
    target_metrics: GeoInterventionTargetMetrics
    status: GeoInterventionStatus
    outcome_verdict: GeoInterventionOutcomeVerdict | None
    causal_claim: Literal["NOT_ESTABLISHED"] = "NOT_ESTABLISHED"
    baseline_id: uuid.UUID | None
    decision_id: uuid.UUID | None
    assignee_id: uuid.UUID | None
    assignee_display_name: str | None
    intervened_at: datetime | None
    retest_window_start: datetime | None
    retest_window_end: datetime | None
    concluded_at: datetime | None
    conclusion_note: str
    revision: int = Field(ge=0)
    created_by: uuid.UUID
    updated_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    available_actions: list[Literal["UPDATE", "CONCLUDE", "CANCEL"]]
    attribution: GeoInterventionAttributionOut


class GeoInterventionListPage(ContractModel):
    """GEO 干预分页列表。"""

    items: list[GeoInterventionOut]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
