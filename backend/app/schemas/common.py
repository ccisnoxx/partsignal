"""身份、审计、健康检查和公共命令 Schema。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import Field, field_validator

from app.schemas.base import ContractModel


class AccountType(StrEnum):
    ADMIN = "ADMIN"
    ENGINEER = "ENGINEER"


class UserOut(ContractModel):
    id: uuid.UUID
    username: str
    display_name: str
    account_type: AccountType
    is_active: bool
    must_change_password: bool
    revision: int
    created_at: datetime


class UserList(ContractModel):
    items: list[UserOut]
    page: int
    page_size: int
    total: int


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
    password: str = Field(min_length=12)
    account_type: AccountType


class UserUpdate(ContractModel):
    expected_revision: int = Field(ge=0)
    display_name: str = Field(min_length=1)
    account_type: AccountType
    is_active: bool


class ResetPasswordRequest(ContractModel):
    temporary_password: str = Field(min_length=12)


class ChangePasswordRequest(ContractModel):
    old_password: str = Field(min_length=8)
    new_password: str = Field(min_length=12)


class AuditLogOut(ContractModel):
    id: uuid.UUID
    actor_id: uuid.UUID
    action: str
    target_type: str
    target_id: uuid.UUID
    change_summary: dict[str, Any]
    request_id: str
    created_at: datetime


class AuditLogList(ContractModel):
    items: list[AuditLogOut]
    page: int
    page_size: int
    total: int


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
