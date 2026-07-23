"""认证、权限与 CSRF 的 FastAPI 依赖。"""

from __future__ import annotations

import hmac
from collections.abc import Callable, Collection
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Header, Request, Security
from fastapi.security import APIKeyCookie
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.errors import AppError
from app.models.identity import (
    SessionRecord,
    User,
)
from app.schemas.common import AccountType
from app.security import hash_token

DbSession = Annotated[Session, Depends(get_db)]
session_cookie_scheme = APIKeyCookie(
    name=settings.session_cookie_name, scheme_name="sessionCookie", auto_error=False
)


def get_current_session(
    db: DbSession,
    request: Request,
    session_token: Annotated[str | None, Security(session_cookie_scheme)] = None,
) -> SessionRecord:
    """从服务端会话表解析当前用户，过期或撤销会话立即拒绝。"""
    if not session_token:
        raise AppError("AUTH_REQUIRED", "请先登录", 401)
    record = db.scalar(
        select(SessionRecord).where(SessionRecord.token_hash == hash_token(session_token))
    )
    now = datetime.now(UTC)
    if record is None or record.revoked_at is not None or record.expires_at <= now:
        raise AppError("AUTH_REQUIRED", "登录会话无效或已过期", 401)
    if not record.user.is_active:
        raise AppError("AUTH_REQUIRED", "账号已停用", 401)
    allowed_while_changing_password = {
        ("GET", "/api/v1/auth/me"),
        ("GET", "/api/v1/auth/csrf"),
        ("POST", "/api/v1/auth/change-password"),
        ("POST", "/api/v1/auth/logout"),
    }
    if (
        record.user.must_change_password
        and (request.method, request.url.path) not in allowed_while_changing_password
    ):
        raise AppError("PASSWORD_CHANGE_REQUIRED", "必须先修改临时密码", 403)
    record.last_seen_at = now
    return record


CurrentSession = Annotated[SessionRecord, Depends(get_current_session)]


def get_current_user(current: CurrentSession) -> User:
    """返回当前已认证且启用的用户。"""
    return current.user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_csrf(
    current: CurrentSession,
    x_csrf_token: Annotated[str, Header(alias="X-CSRF-Token", min_length=32)],
) -> None:
    """所有已认证写请求必须携带会话绑定的 CSRF 令牌。"""
    if not x_csrf_token or not hmac.compare_digest(current.csrf_hash, hash_token(x_csrf_token)):
        raise AppError("CSRF_INVALID", "CSRF 令牌无效", 403)


CsrfProtected = Annotated[None, Depends(require_csrf)]


def assert_account_types(user: User, allowed: Collection[AccountType]) -> None:
    """校验当前用户账号类型，供依赖和需记录拒绝结果的命令共同复用。"""
    if user.account_type not in {account_type.value for account_type in allowed}:
        raise AppError("PERMISSION_DENIED", "当前账号没有执行此操作的权限", 403)


def require_account_types(*allowed: AccountType) -> Callable[[User], User]:
    """创建账号类型依赖，所有权限判断只读取用户账号类型。"""

    def check(user: CurrentUser) -> User:
        assert_account_types(user, allowed)
        return user

    return check


AdminUser = Annotated[User, Depends(require_account_types(AccountType.ADMIN))]
EngineerUser = Annotated[
    User, Depends(require_account_types(AccountType.ADMIN, AccountType.ENGINEER))
]


def request_id(request: Request) -> str:
    """返回中间件分配的请求 ID。"""
    return str(request.state.request_id)
