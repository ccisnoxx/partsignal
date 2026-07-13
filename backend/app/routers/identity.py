"""内部账号、服务端会话、RBAC 与审计接口。"""

from __future__ import annotations

import hmac
import uuid

from fastapi import APIRouter, Query, Request, Response, status
from sqlalchemy import func, select

from app.config import settings
from app.deps import AdminUser, CsrfProtected, CurrentSession, CurrentUser, DbSession
from app.errors import AppError
from app.models.identity import (
    AuditLog,
    User,
)
from app.schemas.common import (
    AuditLogList,
    AuditLogOut,
    AuthSession,
    ChangePasswordRequest,
    CsrfToken,
    LoginRequest,
    ResetPasswordRequest,
    UserCreate,
    UserList,
    UserOut,
    UserUpdate,
)
from app.security import hash_token
from app.services.identity import (
    change_password as change_password_command,
)
from app.services.identity import (
    create_user as create_user_command,
)
from app.services.identity import (
    login as login_command,
)
from app.services.identity import (
    logout as logout_command,
)
from app.services.identity import (
    reset_user_password as reset_user_password_command,
)
from app.services.identity import (
    update_user as update_user_command,
)

router = APIRouter(prefix="/api/v1", tags=["auth", "identity"])


def present_user(user: User) -> UserOut:
    """将内部账号投影为不含密码信息的契约对象。"""
    return UserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        account_type=user.account_type,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        revision=user.revision,
        created_at=user.created_at,
    )


@router.post("/auth/login", response_model=AuthSession, operation_id="login")
def login(payload: LoginRequest, response: Response, db: DbSession) -> AuthSession:
    user, session_token, csrf_token = login_command(db, payload)
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
    logout_command(db, current)
    response.delete_cookie(settings.session_cookie_name, path="/")
    response.delete_cookie(settings.csrf_cookie_name, path="/")


@router.get("/auth/me", response_model=UserOut, operation_id="getCurrentUser")
def get_current_user(user: CurrentUser) -> UserOut:
    """返回当前内部账号及账号类型。"""
    return present_user(user)


@router.get("/auth/csrf", response_model=CsrfToken, operation_id="getCsrfToken")
def get_csrf_token(current: CurrentSession, request: Request) -> CsrfToken:
    """返回 Strict Cookie 中与当前会话绑定的稳定 CSRF 令牌。"""
    csrf_token = request.cookies.get(settings.csrf_cookie_name)
    if not csrf_token or not hmac.compare_digest(current.csrf_hash, hash_token(csrf_token)):
        raise AppError("CSRF_INVALID", "CSRF Cookie 无效", 403)
    return CsrfToken(csrf_token=csrf_token)


@router.post(
    "/auth/change-password",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="changePassword",
)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    db: DbSession,
    current: CurrentSession,
    _csrf: CsrfProtected,
) -> None:
    change_password_command(
        db=db, current=current, payload=payload, request_id=request.state.request_id
    )


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
    user = create_user_command(
        db=db, payload=payload, actor=admin, request_id=request.state.request_id
    )
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
    user = update_user_command(
        db=db,
        user_id=user_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
    return present_user(user)


@router.post(
    "/users/{user_id}/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="resetUserPassword",
)
def reset_user_password(
    user_id: uuid.UUID,
    payload: ResetPasswordRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
    reset_user_password_command(
        db=db,
        user_id=user_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )


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
