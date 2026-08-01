"""内部账号、服务端会话、RBAC 与审计接口。"""

from __future__ import annotations

import hmac
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response, status

from app.audit import commit_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.config import settings
from app.deps import (
    AdminUser,
    CsrfProtected,
    CurrentSession,
    CurrentUser,
    DbSession,
    OptionalCurrentSession,
    assert_account_types,
)
from app.errors import AppError
from app.models.identity import User
from app.schemas.common import (
    AccountType,
    AuditLogDetail,
    AuditLogFilterOptions,
    AuditLogList,
    AuthSession,
    ChangePasswordRequest,
    CsrfToken,
    LoginRequest,
    ResetPasswordRequest,
    UserBulkStatusRequest,
    UserBulkStatusResult,
    UserCreate,
    UserList,
    UserOut,
    UserStatus,
    UserUpdate,
)
from app.security import hash_token
from app.services.audit_logs import audit_log_filter_options
from app.services.audit_logs import get_audit_log as get_audit_log_query
from app.services.audit_logs import list_audit_logs as list_audit_logs_query
from app.services.identity import (
    bulk_update_user_status as bulk_update_user_status_command,
)
from app.services.identity import (
    change_password as change_password_command,
)
from app.services.identity import (
    create_user as create_user_command,
)
from app.services.identity import (
    delete_user as delete_user_command,
)
from app.services.identity import (
    export_users as export_users_query,
)
from app.services.identity import (
    list_users as list_users_query,
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
from app.services.identity import user_out as present_managed_user
from app.services.identity import users_out as present_managed_users

router = APIRouter(prefix="/api/v1", tags=["auth", "identity"])


def present_user(user: User) -> UserOut:
    """将内部账号投影为不含密码信息的契约对象。"""
    return UserOut.model_validate(
        {
            **{
                field: getattr(user, field)
                for field in UserOut.model_fields
                if field != "available_actions"
            },
            "available_actions": [],
        }
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


@router.get(
    "/auth/me",
    response_model=UserOut,
    responses={status.HTTP_204_NO_CONTENT: {"description": "当前无会话"}},
    operation_id="getCurrentUser",
)
def get_current_user(current: OptionalCurrentSession) -> UserOut | Response:
    """返回当前内部账号；完全没有会话 Cookie 时返回空 204。"""
    if current is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return present_user(current.user)


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
def list_users(
    db: DbSession,
    admin: AdminUser,
    q: str | None = Query(None, max_length=200),
    account_type: AccountType | None = None,
    user_status: Annotated[UserStatus | None, Query(alias="status")] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> UserList:
    """查询用户的稳定分页窗口和未筛选全局摘要。"""
    return list_users_query(
        db=db,
        q=q,
        account_type=account_type.value if account_type is not None else None,
        user_status=user_status,
        page=page,
        page_size=page_size,
        actor=admin,
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
    return present_managed_user(db, user, actor=admin)


@router.post(
    "/users/bulk-status",
    response_model=UserBulkStatusResult,
    operation_id="bulkUpdateUserStatus",
)
def bulk_update_user_status(
    payload: UserBulkStatusRequest,
    request: Request,
    db: DbSession,
    actor: CurrentUser,
    _csrf: CsrfProtected,
) -> UserBulkStatusResult:
    """在一个事务中执行最多一百项用户状态更新。"""
    try:
        assert_account_types(actor, (AccountType.ADMIN,))
        succeeded, failures = bulk_update_user_status_command(
            db=db,
            payload=payload,
            actor=actor,
            request_id=request.state.request_id,
        )
    except AppError as error:
        db.rollback()
        outcome = AuditOutcome.DENIED if error.code == "PERMISSION_DENIED" else AuditOutcome.FAILED
        for item in payload.items:
            commit_audit(
                db,
                AuditEntry(
                    actor_id=actor.id,
                    business_module=AuditModule.IDENTITY,
                    action="user.updated",
                    target_type="User",
                    target_id=item.user_id,
                    request_id=request.state.request_id,
                    outcome=outcome,
                    result_message=(
                        "用户状态更新被拒绝"
                        if outcome == AuditOutcome.DENIED
                        else "用户状态更新失败"
                    ),
                    error_code=error.code,
                    details={
                        "facts": {
                            "source": "BULK_STATUS",
                            "status": payload.status.value,
                        }
                    },
                )
            )
        raise
    return UserBulkStatusResult(
        succeeded=present_managed_users(db, succeeded, actor=actor),
        failures=failures,
    )


@router.get("/users/export", operation_id="exportUsers")
def export_users(
    request: Request,
    db: DbSession,
    admin: AdminUser,
    q: str | None = Query(None, max_length=200),
    account_type: AccountType | None = None,
    user_status: Annotated[UserStatus | None, Query(alias="status")] = None,
) -> Response:
    """导出当前筛选下按用户列表稳定顺序排列的安全业务列。"""
    content = export_users_query(
        db=db,
        q=q,
        account_type=account_type.value if account_type is not None else None,
        user_status=user_status,
        actor=admin,
        request_id=request.state.request_id,
    )
    generated_at = datetime.now(UTC).strftime("%Y%m%d-%H%M%SZ")
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="users-{generated_at}.csv"'},
    )


@router.patch("/users/{user_id}", response_model=UserOut, operation_id="updateUser")
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    request: Request,
    db: DbSession,
    actor: CurrentUser,
    _csrf: CsrfProtected,
) -> UserOut:
    try:
        assert_account_types(actor, (AccountType.ADMIN,))
        user = update_user_command(
            db=db,
            user_id=user_id,
            payload=payload,
            actor=actor,
            request_id=request.state.request_id,
        )
    except AppError as error:
        db.rollback()
        outcome = AuditOutcome.DENIED if error.code == "PERMISSION_DENIED" else AuditOutcome.FAILED
        commit_audit(
            db,
            AuditEntry(
                actor_id=actor.id,
                business_module=AuditModule.IDENTITY,
                action="user.updated",
                target_type="User",
                target_id=user_id,
                request_id=request.state.request_id,
                outcome=outcome,
                result_message=(
                    "用户状态更新被拒绝" if outcome == AuditOutcome.DENIED else "用户状态更新失败"
                ),
                error_code=error.code,
                details={
                    "facts": {
                        "status": (
                            UserStatus.ENABLED.value
                            if payload.is_active
                            else UserStatus.DISABLED.value
                        )
                    }
                },
            )
        )
        raise
    return present_managed_user(db, user, actor=actor)


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteUser",
)
def delete_user(
    user_id: uuid.UUID,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
    """删除已停用且不承担业务历史归属的用户。"""
    delete_user_command(
        db=db,
        user_id=user_id,
        actor=admin,
        request_id=request.state.request_id,
    )


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
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    actor_id: uuid.UUID | None = None,
    business_module: AuditModule | None = None,
    action: Annotated[str | None, Query(max_length=120)] = None,
    target_type: str | None = None,
    target_id: Annotated[str | None, Query(max_length=100)] = None,
    outcome: AuditOutcome | None = None,
    request_id: Annotated[str | None, Query(max_length=100)] = None,
    keyword: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
) -> AuditLogList:
    """按服务端组合条件查询追加式审计记录。"""
    return list_audit_logs_query(
        db=db,
        created_from=created_from,
        created_to=created_to,
        actor_id=actor_id,
        business_module=business_module,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        outcome=outcome,
        request_id=request_id,
        keyword=keyword,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/audit-logs/filter-options",
    response_model=AuditLogFilterOptions,
    operation_id="getAuditLogFilterOptions",
)
def get_audit_log_filter_options(
    db: DbSession,
    _admin: AdminUser,
) -> AuditLogFilterOptions:
    """返回数据库当前真实存在的动作与对象类型。"""
    return audit_log_filter_options(db)


@router.get(
    "/audit-logs/{audit_log_id}",
    response_model=AuditLogDetail,
    response_model_exclude_unset=True,
    operation_id="getAuditLog",
)
def get_audit_log(
    audit_log_id: uuid.UUID,
    db: DbSession,
    _admin: AdminUser,
) -> AuditLogDetail:
    """返回单条日志的安全详情和固定关联投影。"""
    return get_audit_log_query(db, audit_log_id)
