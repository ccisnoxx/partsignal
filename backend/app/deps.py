"""认证、权限与 CSRF 的 FastAPI 依赖。"""

from __future__ import annotations

import hmac
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Header, Request, Security
from fastapi.security import APIKeyCookie
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.errors import AppError
from app.models import SessionRecord, User
from app.schemas import RoleName
from app.security import hash_token

DbSession = Annotated[Session, Depends(get_db)]
session_cookie_scheme = APIKeyCookie(
    name=settings.session_cookie_name, scheme_name="sessionCookie", auto_error=False
)


def get_current_session(
    db: DbSession,
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


def require_roles(*allowed: RoleName) -> Callable[[User], User]:
    """创建角色依赖；SYSTEM_ADMIN 不会隐式获得事实或内容审核权。"""

    def check(user: CurrentUser) -> User:
        role_names = {role.name for role in user.roles}
        if not role_names.intersection(role.value for role in allowed):
            raise AppError("PERMISSION_DENIED", "当前账号没有执行此操作的权限", 403)
        return user

    return check


def request_id(request: Request) -> str:
    """返回中间件分配的请求 ID。"""
    return str(request.state.request_id)
