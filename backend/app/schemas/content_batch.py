"""Slice 2C：批量内容任务规划矩阵（预览与原子提交）请求与响应模型。"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.content import ContentBriefInput, ContentTaskOut


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

BatchDiagnosticSeverity = Literal["BLOCKER", "WARNING"]
BatchCellStatus = Literal["READY", "WARNING", "BLOCKED"]
BatchDiagnosticCode = Literal[
    "PRODUCT_NOT_FOUND",
    "PRODUCT_INACTIVE",
    "NO_APPROVED_FACT",
    "FACT_NOT_FOUND",
    "FACT_NOT_APPROVED",
    "FACT_PRODUCT_MISMATCH",
    "PLATFORM_NOT_FOUND",
    "PLATFORM_DISABLED",
    "QUERY_TOPIC_NOT_FOUND",
    "QUERY_TOPIC_INACTIVE",
    "CAMPAIGN_NOT_FOUND",
    "CAMPAIGN_NOT_ELIGIBLE",
    "CAMPAIGN_SCOPE_MISMATCH",
    "DUPLICATE_IN_BATCH",
    "EXISTING_ACTIVE_TASK",
    "RECENT_PUBLISHED_ARTICLE",
    "PLATFORM_MISSING_PROMPT",
    "FACT_OVERDUE",
]


class ContentTaskBatchCellInput(_StrictModel):
    """批量规划矩阵中的单个任务单元格定义。"""

    product_id: uuid.UUID
    query_topic_id: uuid.UUID
    platform_profile_id: uuid.UUID
    fact_version_id: uuid.UUID | None = None
    brief: ContentBriefInput


class ContentTaskBatchPreviewRequest(_StrictModel):
    """只读批量任务预览请求，最多 100 格。"""

    campaign_id: uuid.UUID | None = None
    cells: list[ContentTaskBatchCellInput] = Field(min_length=1, max_length=100)


class ContentTaskBatchCreateRequest(_StrictModel):
    """批量任务原子提交请求；若存在软告警需显式确认 acknowledge_warnings=true。"""

    campaign_id: uuid.UUID | None = None
    cells: list[ContentTaskBatchCellInput] = Field(min_length=1, max_length=100)
    acknowledge_warnings: bool = False


class ContentTaskBatchDiagnostic(_StrictModel):
    """单元格级硬阻断或软告警诊断。"""

    severity: BatchDiagnosticSeverity
    code: BatchDiagnosticCode
    message: str


class ContentTaskBatchPreviewCell(_StrictModel):
    """单个矩阵单元格的解析结果与诊断。"""

    index: int = Field(ge=0)
    product_id: uuid.UUID
    query_topic_id: uuid.UUID
    platform_profile_id: uuid.UUID
    resolved_fact_version_id: uuid.UUID | None
    resolved_fact_version: int | None
    content_angle: str
    status: BatchCellStatus
    blockers: list[ContentTaskBatchDiagnostic]
    warnings: list[ContentTaskBatchDiagnostic]


class ContentTaskBatchPreviewResponse(_StrictModel):
    """批量任务规划只读预览投影。"""

    campaign_id: uuid.UUID | None
    total_cells: int = Field(ge=1)
    creatable_count: int = Field(ge=0)
    blocker_cell_count: int = Field(ge=0)
    warning_cell_count: int = Field(ge=0)
    can_commit: bool
    requires_warning_acknowledgement: bool
    cells: list[ContentTaskBatchPreviewCell]


class ContentTaskBatchCreateResponse(_StrictModel):
    """批量任务原子创建结果或幂等重放回执。"""

    batch_request_id: uuid.UUID
    replayed: bool
    campaign_id: uuid.UUID | None
    created_count: int = Field(ge=1)
    tasks: list[ContentTaskOut]
