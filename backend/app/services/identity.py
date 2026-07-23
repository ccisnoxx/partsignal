"""账号、密码与 PostgreSQL 会话的事务命令。"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select, text
from sqlalchemy import update as sa_update
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select
from sqlalchemy.sql.elements import ColumnElement

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.config import settings
from app.errors import AppError, not_found
from app.models.identity import (
    SessionRecord,
    User,
)
from app.schemas.common import (
    ChangePasswordRequest,
    LoginRequest,
    ResetPasswordRequest,
    UserBulkStatusFailure,
    UserBulkStatusRequest,
    UserCreate,
    UserList,
    UserOut,
    UserStatus,
    UserSummary,
    UserUpdate,
)
from app.security import generate_token, hash_password, hash_token, verify_password

_USER_STATE_LOCK = text("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE")
_BULK_ITEM_ERROR_CODES = {"NOT_FOUND", "REVISION_CONFLICT", "LAST_ADMIN_REQUIRED"}


def _user_search_conditions(q: str | None) -> list[ColumnElement[bool]]:
    """把 SQL 通配符按普通字符匹配用户名或显示名称。"""
    if q is None or not (term := q.strip()):
        return []
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"
    return [
        or_(
            User.username.ilike(pattern, escape="\\"),
            User.display_name.ilike(pattern, escape="\\"),
        )
    ]


def _filtered_users_query(
    *,
    q: str | None,
    account_type: str | None,
    user_status: UserStatus | None,
) -> Select[tuple[User]]:
    """构造列表与 CSV 共用的用户筛选和稳定排序。"""
    conditions = _user_search_conditions(q)
    if account_type is not None:
        conditions.append(User.account_type == account_type)
    if user_status is not None:
        conditions.append(User.is_active.is_(user_status == UserStatus.ENABLED))
    return select(User).where(*conditions).order_by(User.created_at, User.id)


def _user_summary(db: Session) -> UserSummary:
    """实时统计全部用户，结果不受列表筛选影响。"""
    totals = db.execute(
        select(
            func.count(User.id),
            func.count(User.id).filter(User.is_active.is_(True)),
            func.count(User.id).filter(User.is_active.is_(False)),
            func.count(User.id).filter(User.must_change_password.is_(True)),
            func.count(User.id).filter(User.account_type == "ADMIN"),
        )
    ).one()
    return UserSummary(
        user_total=int(totals[0]),
        enabled_total=int(totals[1]),
        disabled_total=int(totals[2]),
        must_change_password_total=int(totals[3]),
        admin_total=int(totals[4]),
    )


def list_users(
    *,
    db: Session,
    q: str | None,
    account_type: str | None,
    user_status: UserStatus | None,
    page: int,
    page_size: int,
) -> UserList:
    """返回当前筛选的稳定分页窗口和未筛选全局摘要。"""
    query = _filtered_users_query(
        q=q,
        account_type=account_type,
        user_status=user_status,
    )
    total = int(db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0)
    users = list(db.scalars(query.offset((page - 1) * page_size).limit(page_size)))
    return UserList(
        items=[UserOut.model_validate(user) for user in users],
        page=page,
        page_size=page_size,
        total=total,
        summary=_user_summary(db),
    )


def export_users(
    *,
    db: Session,
    q: str | None,
    account_type: str | None,
    user_status: UserStatus | None,
    actor: User,
    request_id: str,
) -> bytes:
    """生成批准字段的 UTF-8 BOM CSV，并在成功生成后提交导出审计。"""
    users = list(
        db.scalars(
            _filtered_users_query(
                q=q,
                account_type=account_type,
                user_status=user_status,
            )
        )
    )
    output = io.StringIO(newline="")
    output.write("\ufeff")
    writer = csv.writer(output)
    writer.writerow(["用户名", "显示名称", "账号类型", "状态", "必须修改密码", "创建时间"])
    for user in users:
        writer.writerow(
            [
                user.username,
                user.display_name,
                user.account_type,
                "ENABLED" if user.is_active else "DISABLED",
                "YES" if user.must_change_password else "NO",
                user.created_at.astimezone(UTC).isoformat(),
            ]
        )
    csv_bytes = output.getvalue().encode("utf-8")
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.IDENTITY,
            action="user.exported",
            target_type="UserExport",
            target_id=actor.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="用户列表导出完成",
            details={
                "facts": {
                    "account_type": account_type,
                    "status": user_status.value if user_status is not None else None,
                    "row_count": len(users),
                }
            },
        ),
    )
    db.commit()
    return csv_bytes


def login(db: Session, payload: LoginRequest) -> tuple[User, str, str]:
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
    return user, session_token, csrf_token


def logout(db: Session, current: SessionRecord) -> None:
    """撤销当前 PostgreSQL 会话。"""
    current.revoked_at = datetime.now(UTC)
    db.commit()


def change_password(
    *,
    db: Session,
    current: SessionRecord,
    payload: ChangePasswordRequest,
    request_id: str,
) -> None:
    """验证旧密码后更新自身密码，并撤销当前会话以外的会话。"""
    user = db.scalar(select(User).where(User.id == current.user_id).with_for_update())
    if user is None or not verify_password(user.password_hash, payload.old_password):
        raise AppError("AUTH_REQUIRED", "旧密码错误", 401)
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    user.revision += 1
    db.execute(
        sa_update(SessionRecord)
        .where(
            SessionRecord.user_id == user.id,
            SessionRecord.id != current.id,
            SessionRecord.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC))
    )
    append_audit(
        db,
        AuditEntry(
            actor_id=user.id,
            business_module=AuditModule.IDENTITY,
            action="user.password_changed",
            target_type="User",
            target_id=user.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="密码修改完成",
        ),
    )
    db.commit()


def create_user(*, db: Session, payload: UserCreate, actor: User, request_id: str) -> User:
    """创建默认启用且首次登录必须修改临时密码的内部用户。"""
    username = payload.username.strip().lower()
    if db.scalar(select(User.id).where(User.username == username)) is not None:
        raise AppError("REVISION_CONFLICT", "用户名已存在", 409)
    user = User(
        username=username,
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.temporary_password),
        account_type=payload.account_type.value,
        must_change_password=True,
    )
    db.add(user)
    db.flush()
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.IDENTITY,
            action="user.created",
            target_type="User",
            target_id=user.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="用户创建完成",
            details={"facts": {"account_type": payload.account_type.value}},
        ),
    )
    db.commit()
    return user


def _update_user_locked(
    *,
    db: Session,
    user_id: uuid.UUID,
    expected_revision: int,
    payload: UserUpdate | None,
    is_active: bool,
    actor: User,
    request_id: str,
    source: str | None = None,
) -> User:
    """在调用方持有用户表锁时统一执行行锁、状态约束、撤销和审计。"""
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise not_found("用户")
    if user.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "用户已被其他请求修改", 409)

    display_name = payload.display_name.strip() if payload is not None else user.display_name
    account_type = payload.account_type.value if payload is not None else user.account_type
    removes_active_admin = (
        user.account_type == "ADMIN"
        and user.is_active
        and (account_type != "ADMIN" or not is_active)
    )
    if removes_active_admin:
        active_admins = int(
            db.scalar(
                select(func.count())
                .select_from(User)
                .where(User.account_type == "ADMIN", User.is_active.is_(True))
            )
            or 0
        )
        if active_admins <= 1:
            raise AppError("LAST_ADMIN_REQUIRED", "系统必须保留至少一个有效管理员", 409)

    previous_display_name = user.display_name
    previous_account_type = user.account_type
    previous_is_active = user.is_active
    user.display_name = display_name
    user.account_type = account_type
    user.is_active = is_active
    user.revision += 1
    changes: list[dict[str, str | bool]] = []
    if user.display_name != previous_display_name:
        changes.append(
            {
                "field": "display_name",
                "before": previous_display_name,
                "after": user.display_name,
            }
        )
    if user.account_type != previous_account_type:
        changes.append(
            {
                "field": "account_type",
                "before": previous_account_type,
                "after": user.account_type,
            }
        )
    if user.is_active != previous_is_active:
        changes.append(
            {
                "field": "is_active",
                "before": previous_is_active,
                "after": user.is_active,
            }
        )
    facts: dict[str, str] = {}
    if source is not None:
        facts.update(
            {
                "source": source,
                "status": UserStatus.ENABLED.value if is_active else UserStatus.DISABLED.value,
            }
        )
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.IDENTITY,
            action="user.updated",
            target_type="User",
            target_id=user.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="用户资料更新完成",
            details={"changes": changes, "facts": facts},
        ),
    )
    if not user.is_active:
        db.execute(
            sa_update(SessionRecord)
            .where(SessionRecord.user_id == user.id, SessionRecord.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )
    return user


def update_user(
    *,
    db: Session,
    user_id: uuid.UUID,
    payload: UserUpdate,
    actor: User,
    request_id: str,
) -> User:
    """以共享状态不变量更新单个用户并提交事务。"""
    db.execute(_USER_STATE_LOCK)
    user = _update_user_locked(
        db=db,
        user_id=user_id,
        expected_revision=payload.expected_revision,
        payload=payload,
        is_active=payload.is_active,
        actor=actor,
        request_id=request_id,
    )
    db.commit()
    return user


def bulk_update_user_status(
    *,
    db: Session,
    payload: UserBulkStatusRequest,
    actor: User,
    request_id: str,
) -> tuple[list[User], list[UserBulkStatusFailure]]:
    """按 UUID 稳定加锁，保留逐项预期失败并原子回滚意外错误。"""
    db.execute(_USER_STATE_LOCK)
    succeeded: dict[uuid.UUID, User] = {}
    failures: dict[uuid.UUID, UserBulkStatusFailure] = {}
    target_is_active = payload.status == UserStatus.ENABLED
    for item in sorted(payload.items, key=lambda value: value.user_id.int):
        try:
            succeeded[item.user_id] = _update_user_locked(
                db=db,
                user_id=item.user_id,
                expected_revision=item.expected_revision,
                payload=None,
                is_active=target_is_active,
                actor=actor,
                request_id=request_id,
                source="BULK_STATUS",
            )
        except AppError as error:
            if error.code not in _BULK_ITEM_ERROR_CODES:
                raise
            append_audit(
                db,
                AuditEntry(
                    actor_id=actor.id,
                    business_module=AuditModule.IDENTITY,
                    action="user.updated",
                    target_type="User",
                    target_id=item.user_id,
                    request_id=request_id,
                    outcome=AuditOutcome.FAILED,
                    result_message="用户状态更新失败",
                    error_code=error.code,
                    details={
                        "facts": {
                            "source": "BULK_STATUS",
                            "status": payload.status.value,
                        }
                    },
                ),
            )
            failures[item.user_id] = UserBulkStatusFailure(
                user_id=item.user_id,
                code=error.code,
                message=error.message,
            )
    db.commit()
    return (
        [succeeded[item.user_id] for item in payload.items if item.user_id in succeeded],
        [failures[item.user_id] for item in payload.items if item.user_id in failures],
    )


def reset_user_password(
    *,
    db: Session,
    user_id: uuid.UUID,
    payload: ResetPasswordRequest,
    actor: User,
    request_id: str,
) -> None:
    """为其他用户设置临时密码，并立即撤销其全部会话。"""
    if user_id == actor.id:
        raise AppError("VALIDATION_ERROR", "管理员必须通过自助改密修改自己的密码", 422)
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise not_found("用户")
    user.password_hash = hash_password(payload.temporary_password)
    user.must_change_password = True
    user.revision += 1
    db.execute(
        sa_update(SessionRecord)
        .where(SessionRecord.user_id == user.id, SessionRecord.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.IDENTITY,
            action="user.password_reset",
            target_type="User",
            target_id=user.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="用户临时密码重置完成",
        ),
    )
    db.commit()
