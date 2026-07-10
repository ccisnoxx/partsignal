"""内部账号、服务端会话、RBAC 与审计接口。"""

from __future__ import annotations

import hmac
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy import func, select

from app.audit import append_audit
from app.config import settings
from app.deps import CsrfProtected, CurrentSession, CurrentUser, DbSession, require_roles
from app.errors import AppError, not_found
from app.models import AuditLog, Role, SessionRecord, User
from app.schemas import (
    AuditLogList,
    AuditLogOut,
    AuthSession,
    CsrfToken,
    LoginRequest,
    RoleName,
    UserCreate,
    UserList,
    UserOut,
    UserUpdate,
)
from app.security import generate_token, hash_password, hash_token, verify_password

router = APIRouter(prefix="/api/v1", tags=["auth", "identity"])


def present_user(user: User) -> UserOut:
    """将 ORM 角色对象投影为稳定角色字符串。"""
    return UserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        roles=[RoleName(role.name) for role in user.roles],
        is_active=user.is_active,
        revision=user.revision,
        created_at=user.created_at,
    )


@router.post("/auth/login", response_model=AuthSession, operation_id="login")
def login(payload: LoginRequest, response: Response, db: DbSession) -> AuthSession:
    """校验内部账号并创建可撤销的 PostgreSQL 会话。"""
    user = db.scalar(select(User).where(User.username == payload.username.strip().lower()))
    if (
        user is None
        or not user.is_active
        or not verify_password(user.password_hash, payload.password)
    ):
        raise AppError("AUTH_REQUIRED", "用户名或密码错误", 401)
    session_token = generate_token()
    csrf_token = generate_token()
    db.add(
        SessionRecord(
            token_hash=hash_token(session_token),
            csrf_hash=hash_token(csrf_token),
            user_id=user.id,
            expires_at=datetime.now(UTC) + timedelta(seconds=settings.session_ttl_seconds),
        )
    )
    db.commit()
    response.set_cookie(
        settings.session_cookie_name,
        session_token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        settings.csrf_cookie_name,
        csrf_token,
        max_age=settings.session_ttl_seconds,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )
    return AuthSession(user=present_user(user), csrf_token=csrf_token)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT, operation_id="logout")
def logout(
    response: Response,
    db: DbSession,
    current: CurrentSession,
    _csrf: CsrfProtected,
) -> None:
    """撤销当前会话并删除浏览器 Cookie。"""
    current.revoked_at = datetime.now(UTC)
    db.commit()
    response.delete_cookie(settings.session_cookie_name, path="/")
    response.delete_cookie(settings.csrf_cookie_name, path="/")


@router.get("/auth/me", response_model=UserOut, operation_id="getCurrentUser")
def get_current_user(user: CurrentUser) -> UserOut:
    """返回当前内部账号及角色。"""
    return present_user(user)


@router.get("/auth/csrf", response_model=CsrfToken, operation_id="getCsrfToken")
def get_csrf_token(current: CurrentSession, request: Request) -> CsrfToken:
    """返回 Strict Cookie 中与当前会话绑定的稳定 CSRF 令牌。"""
    csrf_token = request.cookies.get(settings.csrf_cookie_name)
    if not csrf_token or not hmac.compare_digest(current.csrf_hash, hash_token(csrf_token)):
        raise AppError("CSRF_INVALID", "CSRF Cookie 无效", 403)
    return CsrfToken(csrf_token=csrf_token)


AdminUser = Annotated[User, Depends(require_roles(RoleName.SYSTEM_ADMIN))]


@router.get("/users", response_model=UserList, operation_id="listUsers")
def list_users(db: DbSession, _admin: AdminUser) -> UserList:
    """列出内部账号；MVP 用户量按单页返回。"""
    users = list(db.scalars(select(User).order_by(User.created_at)).all())
    return UserList(
        items=[present_user(user) for user in users], page=1, page_size=20, total=len(users)
    )


@router.post(
    "/users", response_model=UserOut, status_code=status.HTTP_201_CREATED, operation_id="createUser"
)
def create_user(
    payload: UserCreate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> UserOut:
    """创建内部账号并仅赋予契约允许的固定角色。"""
    username = payload.username.strip().lower()
    if db.scalar(select(User.id).where(User.username == username)) is not None:
        raise AppError("REVISION_CONFLICT", "用户名已存在", 409)
    roles = list(
        db.scalars(select(Role).where(Role.name.in_([role.value for role in payload.roles])))
    )
    if len(roles) != len(set(payload.roles)):
        raise AppError("VALIDATION_ERROR", "包含未知角色", 422)
    user = User(
        username=username,
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        roles=roles,
    )
    db.add(user)
    db.flush()
    append_audit(
        db,
        actor_id=admin.id,
        action="user.created",
        target_type="User",
        target_id=user.id,
        request_id=request.state.request_id,
        details={"roles": [role.value for role in payload.roles]},
    )
    db.commit()
    return present_user(user)


@router.patch("/users/{user_id}", response_model=UserOut, operation_id="updateUser")
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> UserOut:
    """以乐观锁更新角色和启用状态。"""
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise not_found("用户")
    if user.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "用户已被其他请求修改", 409)
    roles = list(
        db.scalars(select(Role).where(Role.name.in_([role.value for role in payload.roles])))
    )
    if len(roles) != len(set(payload.roles)):
        raise AppError("VALIDATION_ERROR", "包含未知角色", 422)
    user.display_name = payload.display_name.strip()
    user.roles = roles
    user.is_active = payload.is_active
    user.revision += 1
    append_audit(
        db,
        actor_id=admin.id,
        action="user.updated",
        target_type="User",
        target_id=user.id,
        request_id=request.state.request_id,
        details={"is_active": user.is_active, "roles": [role.name for role in roles]},
    )
    db.commit()
    return present_user(user)


@router.get("/audit-logs", response_model=AuditLogList, operation_id="listAuditLogs")
def list_audit_logs(
    db: DbSession,
    _admin: AdminUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    target_type: str | None = None,
    target_id: uuid.UUID | None = None,
) -> AuditLogList:
    """分页查询追加式审计记录。"""
    query = select(AuditLog)
    count_query = select(func.count()).select_from(AuditLog)
    if target_type:
        query = query.where(AuditLog.target_type == target_type)
        count_query = count_query.where(AuditLog.target_type == target_type)
    if target_id:
        query = query.where(AuditLog.target_id == str(target_id))
        count_query = count_query.where(AuditLog.target_id == str(target_id))
    total = int(db.scalar(count_query) or 0)
    records = list(
        db.scalars(
            query.order_by(AuditLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return AuditLogList(
        items=[
            AuditLogOut(
                id=record.id,
                actor_id=record.actor_id,
                action=record.action,
                target_type=record.target_type,
                target_id=uuid.UUID(record.target_id),
                change_summary=record.details,
                request_id=record.request_id,
                created_at=record.created_at,
            )
            for record in records
            if record.actor_id is not None
        ],
        page=page,
        page_size=page_size,
        total=total,
    )
