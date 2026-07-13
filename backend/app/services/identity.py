"""账号、密码与 PostgreSQL 会话的事务命令。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy import update as sa_update
from sqlalchemy.orm import Session

from app.audit import append_audit
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
    UserCreate,
    UserUpdate,
)
from app.security import generate_token, hash_password, hash_token, verify_password


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
        actor_id=user.id,
        action="user.password_changed",
        target_type="User",
        target_id=user.id,
        request_id=request_id,
    )
    db.commit()


def create_user(
    *, db: Session, payload: UserCreate, actor: User, request_id: str
) -> User:
    """创建明确账号类型的内部用户。"""
    username = payload.username.strip().lower()
    if db.scalar(select(User.id).where(User.username == username)) is not None:
        raise AppError("REVISION_CONFLICT", "用户名已存在", 409)
    user = User(
        username=username,
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        account_type=payload.account_type.value,
    )
    db.add(user)
    db.flush()
    append_audit(
        db,
        actor_id=actor.id,
        action="user.created",
        target_type="User",
        target_id=user.id,
        request_id=request_id,
        details={"account_type": payload.account_type.value},
    )
    db.commit()
    return user


def update_user(
    *,
    db: Session,
    user_id: uuid.UUID,
    payload: UserUpdate,
    actor: User,
    request_id: str,
) -> User:
    """以表锁保护最后管理员，并在停用账号时撤销全部会话。"""
    db.execute(text("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE"))
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise not_found("用户")
    if user.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "用户已被其他请求修改", 409)
    removes_active_admin = user.account_type == "ADMIN" and user.is_active and (
        payload.account_type.value != "ADMIN" or not payload.is_active
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
    user.display_name = payload.display_name.strip()
    user.account_type = payload.account_type.value
    user.is_active = payload.is_active
    user.revision += 1
    append_audit(
        db,
        actor_id=actor.id,
        action="user.updated",
        target_type="User",
        target_id=user.id,
        request_id=request_id,
        details={"is_active": user.is_active, "account_type": user.account_type},
    )
    if not user.is_active:
        db.execute(
            sa_update(SessionRecord)
            .where(SessionRecord.user_id == user.id, SessionRecord.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )
    db.commit()
    return user


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
        actor_id=actor.id,
        action="user.password_reset",
        target_type="User",
        target_id=user.id,
        request_id=request_id,
    )
    db.commit()
