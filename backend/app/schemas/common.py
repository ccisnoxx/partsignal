"""身份、审计、健康检查和公共命令 Schema。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import Field, field_validator

from app.audit_types import AuditModule, AuditOutcome
from app.schemas.base import ContractModel, require_unique_items


class AccountType(StrEnum):
    ADMIN = "ADMIN"
    ENGINEER = "ENGINEER"


class UserStatus(StrEnum):
    ENABLED = "ENABLED"
    DISABLED = "DISABLED"


class UserOut(ContractModel):
    id: uuid.UUID
    username: str
    display_name: str
    account_type: AccountType
    is_active: bool
    must_change_password: bool
    revision: int
    created_at: datetime


class UserSummary(ContractModel):
    user_total: int = Field(ge=0)
    enabled_total: int = Field(ge=0)
    disabled_total: int = Field(ge=0)
    must_change_password_total: int = Field(ge=0)
    admin_total: int = Field(ge=0)


class UserList(ContractModel):
    items: list[UserOut]
    page: int
    page_size: int
    total: int
    summary: UserSummary


class LoginRequest(ContractModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=8)


class AuthSession(ContractModel):
    user: UserOut
    csrf_token: str


class CsrfToken(ContractModel):
    csrf_token: str


class UserCreate(ContractModel):
    username: str = Field(min_length=3)
    display_name: str = Field(min_length=1)
    temporary_password: str = Field(min_length=12)
    account_type: AccountType


class UserUpdate(ContractModel):
    expected_revision: int = Field(ge=0)
    display_name: str = Field(min_length=1)
    account_type: AccountType
    is_active: bool


class ResetPasswordRequest(ContractModel):
    temporary_password: str = Field(min_length=8)


class ChangePasswordRequest(ContractModel):
    old_password: str = Field(min_length=8)
    new_password: str = Field(min_length=8)


class UserBulkStatusItem(ContractModel):
    user_id: uuid.UUID
    expected_revision: int = Field(ge=0)


class UserBulkStatusRequest(ContractModel):
    items: list[UserBulkStatusItem] = Field(min_length=1, max_length=100)
    status: UserStatus

    @field_validator("items")
    @classmethod
    def validate_unique_user_ids(cls, items: list[UserBulkStatusItem]) -> list[UserBulkStatusItem]:
        """批量状态命令只允许每个用户出现一次。"""
        require_unique_items([item.user_id for item in items])
        return items


class UserBulkStatusFailure(ContractModel):
    user_id: uuid.UUID
    code: str
    message: str


class UserBulkStatusResult(ContractModel):
    succeeded: list[UserOut]
    failures: list[UserBulkStatusFailure]


class AuditActor(ContractModel):
    """审计操作者的当前用户目录投影，不表示事发时快照。"""

    id: uuid.UUID
    display_name: str
    account_type: AccountType


class AuditLogOut(ContractModel):
    id: uuid.UUID
    actor_id: uuid.UUID | None
    actor: AuditActor | None
    business_module: AuditModule
    action: str
    target_type: str
    target_id: str | None
    outcome: AuditOutcome
    change_summary: dict[str, Any]
    request_id: str
    created_at: datetime


class AuditChange(ContractModel):
    field: str
    before: Any = None
    after: Any = None


class AuditRelatedEntry(ContractModel):
    status: Literal["AVAILABLE", "MISSING", "UNSUPPORTED"]
    kind: str | None
    parent_id: str | None


class AuditLogDetail(AuditLogOut):
    changes: list[AuditChange]
    facts: dict[str, Any]
    result_message: str
    error_code: str | None
    related_entry: AuditRelatedEntry


class AuditLogList(ContractModel):
    items: list[AuditLogOut]
    page: int
    page_size: int
    total: int


class AuditLogFilterOptions(ContractModel):
    actions: list[str]
    target_types: list[str]


class HealthResponse(ContractModel):
    status: Literal["ok"]
    checks: dict[str, str] | None = None


class CommandRequest(ContractModel):
    expected_revision: int = Field(ge=0)
    comment: str


class RequestChangesCommand(ContractModel):
    """退回命令必须携带可读意见，不能只提交空白字符。"""

    expected_revision: int = Field(ge=0)
    comment: str = Field(min_length=1)

    @field_validator("comment")
    @classmethod
    def validate_comment(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("退回意见不能为空")
        return trimmed


class RevisionRequest(ContractModel):
    expected_revision: int = Field(ge=0)
