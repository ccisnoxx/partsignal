"""Slice 2D：统一任务分派、SLA 与运营收件箱契约模型。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, field_validator

from app.schemas.base import ContractModel
from app.schemas.common import AccountType, CommandRequest, RequestChangesCommand
from app.schemas.content import ActorSummary
from app.schemas.workbench import NonblankLabel, RelativeHref

WorkPriority = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
WorkAssignmentTargetType = Literal[
    "FactVersion",
    "ContentTask",
    "PublicationWork",
    "PublishedContentIssue",
    "GeoOpportunity",
]
WorkbenchInboxBucket = Literal[
    "assigned_to_me",
    "due_today",
    "overdue",
    "pending_review",
    "awaiting_publication",
    "awaiting_verification",
    "needs_fix",
    "high_priority_geo_opportunities",
]
WorkbenchInboxItemKind = Literal[
    "FACT_REVIEW",
    "CONTENT_TASK",
    "CONTENT_REVIEW",
    "PUBLICATION_WORK",
    "PUBLICATION_VERIFICATION",
    "CONTENT_ISSUE",
    "OVERDUE_FACT",
    "GEO_OPPORTUNITY",
]


class WorkAssigneeOption(ContractModel):
    """可供分派的活跃操作者摘要（工程师与管理员均可读取）。"""

    id: uuid.UUID
    username: str
    display_name: str
    account_type: AccountType


class WorkAssigneeOptionList(ContractModel):
    items: list[WorkAssigneeOption]


class WorkAssignmentOut(ContractModel):
    """单个业务聚合的当前责任人与 SLA 状态投影。"""

    assignee: ActorSummary | None
    priority: WorkPriority
    due_at: datetime | None
    blocked_reason: str | None
    assigned_by: ActorSummary | None
    assigned_at: datetime | None
    is_overdue: bool


class WorkAssignmentDetail(ContractModel):
    """统一分派读取与更新返回模型。"""

    target_type: WorkAssignmentTargetType
    target_id: uuid.UUID
    revision: int = Field(ge=0)
    editable: bool
    priority_mutable: bool
    assignment: WorkAssignmentOut


class WorkAssignmentUpdate(ContractModel):
    """软归属分派与 SLA 更新载荷（受 expected_revision 乐观锁保护）。"""

    expected_revision: int = Field(ge=0)
    assignee_id: uuid.UUID | None = None
    priority: WorkPriority | None = None
    due_at: datetime | None = None
    blocked_reason: str | None = None

    @field_validator("due_at")
    @classmethod
    def validate_due_at(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.utcoffset() is None:
            raise ValueError("截止时间必须包含时区信息")
        return value

    @field_validator("blocked_reason")
    @classmethod
    def normalize_blocked_reason(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        if not trimmed:
            return None
        if len(trimmed) > 500:
            raise ValueError("阻塞原因不能超过 500 字符")
        return trimmed


class ContentReviewHandoffCommand(CommandRequest):
    """提交内容审核命令，支持同事务顺手改派内容任务负责人及显式确认质量警告。"""

    next_assignee_id: uuid.UUID | None = None
    acknowledge_warnings: bool = False


class ContentRequestChangesHandoffCommand(RequestChangesCommand):
    """退回内容修改命令，支持同事务顺手改派内容任务负责人。"""

    next_assignee_id: uuid.UUID | None = None


class WorkbenchInboxCounts(ContractModel):
    assigned_to_me: int = Field(ge=0)
    due_today: int = Field(ge=0)
    overdue: int = Field(ge=0)
    pending_review: int = Field(ge=0)
    awaiting_publication: int = Field(ge=0)
    awaiting_verification: int = Field(ge=0)
    needs_fix: int = Field(ge=0)
    high_priority_geo_opportunities: int = Field(ge=0)


class WorkbenchInboxItem(ContractModel):
    item_kind: WorkbenchInboxItemKind
    resource_id: uuid.UUID
    title: NonblankLabel
    summary: NonblankLabel
    priority: WorkPriority
    assignee: ActorSummary | None
    due_at: datetime | None
    is_overdue: bool
    blocked_reason: str | None
    buckets: Annotated[list[WorkbenchInboxBucket], Field(min_length=1)]
    href: RelativeHref
    updated_at: datetime


class WorkbenchInbox(ContractModel):
    generated_at: datetime
    timezone: str = Field(min_length=1, max_length=64)
    active_bucket: WorkbenchInboxBucket
    bucket_counts: WorkbenchInboxCounts
    items: list[WorkbenchInboxItem]
