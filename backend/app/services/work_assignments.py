"""Slice 2D：跨 5 个主聚合的统一软归属任务分派、SLA 更新与并发锁序服务。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.deps import assert_account_types
from app.errors import AppError, not_found
from app.models.content import ContentTask
from app.models.geo_opportunities import GeoOpportunity
from app.models.identity import User
from app.models.product_facts import FactVersion
from app.models.publication import PublicationWork, PublishedContentIssue
from app.schemas.common import AccountType
from app.schemas.content import ActorSummary
from app.schemas.work_assignment import (
    WorkAssigneeOption,
    WorkAssigneeOptionList,
    WorkAssignmentDetail,
    WorkAssignmentOut,
    WorkAssignmentTargetType,
    WorkAssignmentUpdate,
    WorkPriority,
)
from app.services.current_actor import discard_auth_heartbeat, require_command_session
from app.services.product_facts import db_utc_now

_PUBLICATION_MUTABLE_STATUSES = frozenset(
    {"PREPARING", "PLATFORM_REVIEW", "AWAITING_VERIFICATION", "ACTION_REQUIRED"}
)
_GEO_OPPORTUNITY_MUTABLE_STATUSES = frozenset({"OPEN", "ACKNOWLEDGED", "IN_PROGRESS"})

_TARGET_CONFIG: dict[WorkAssignmentTargetType, tuple[type[Any], str, AuditModule]] = {
    "FactVersion": (FactVersion, "产品事实版本", AuditModule.PRODUCT_FACTS),
    "ContentTask": (ContentTask, "内容任务", AuditModule.CONTENT_PLANNING),
    "PublicationWork": (PublicationWork, "发布工作", AuditModule.PUBLICATION),
    "PublishedContentIssue": (PublishedContentIssue, "发布后内容问题", AuditModule.PUBLICATION),
    "GeoOpportunity": (GeoOpportunity, "GEO 机会", AuditModule.GEO_OBSERVATION),
}


def assert_assignable_user(target_user: User | None) -> None:
    """校验新分派的目标负责人必须为活跃的 ADMIN 或 ENGINEER。"""
    if (
        target_user is None
        or not target_user.is_active
        or target_user.account_type not in {AccountType.ADMIN.value, AccountType.ENGINEER.value}
    ):
        raise AppError("VALIDATION_ERROR", "所选负责人不存在或已停用", 422)


@contextmanager
def lock_actor_and_optional_assignee(
    db: Session,
    actor: User,
    assignee_id: uuid.UUID | None,
    *,
    require_active_assignee: bool = True,
) -> Iterator[tuple[User, User | None]]:
    """按 UUID 升序锁 User(SHARE) 并复核会话与可选受派人，彻底避免 User AB-BA 死锁。"""
    try:
        with db.no_autoflush:
            discard_auth_heartbeat(db)
            user_ids = sorted({actor.id, assignee_id} if assignee_id is not None else {actor.id})
            locked_users = {
                row.id: row
                for row in db.scalars(
                    select(User)
                    .where(User.id.in_(user_ids))
                    .order_by(User.id)
                    .with_for_update(read=True)
                    .execution_options(populate_existing=True)
                )
            }
            current = locked_users.get(actor.id)
            if current is None or not current.is_active:
                raise AppError("AUTH_REQUIRED", "账号已停用或不存在", 401)
            if current.must_change_password:
                raise AppError("PASSWORD_CHANGE_REQUIRED", "必须先修改临时密码", 403)
            assert_account_types(current, (AccountType.ADMIN, AccountType.ENGINEER))
            require_command_session(db, current.id, lock=True)
            target_user = locked_users.get(assignee_id) if assignee_id is not None else None
            if assignee_id is not None and require_active_assignee:
                assert_assignable_user(target_user)
            yield current, target_user
    except Exception:
        db.rollback()
        raise


def list_assignable_users(db: Session) -> WorkAssigneeOptionList:
    """列出当前所有活跃的可分派成员（ADMIN / ENGINEER）。"""
    users = list(
        db.scalars(
            select(User)
            .where(
                User.is_active.is_(True),
                User.account_type.in_((AccountType.ADMIN.value, AccountType.ENGINEER.value)),
            )
            .order_by(User.display_name, User.id)
        )
    )
    return WorkAssigneeOptionList(
        items=[
            WorkAssigneeOption(
                id=user.id,
                username=user.username,
                display_name=user.display_name,
                account_type=AccountType(user.account_type),
            )
            for user in users
        ]
    )


def _is_editable(target_type: WorkAssignmentTargetType, row: Any) -> bool:
    if target_type == "FactVersion":
        return bool(row.status == "PENDING_REVIEW")
    if target_type == "ContentTask":
        return bool(row.status == "OPEN" and row.archived_at is None)
    if target_type == "PublicationWork":
        return bool(row.status in _PUBLICATION_MUTABLE_STATUSES)
    if target_type == "PublishedContentIssue":
        return bool(row.status == "OPEN")
    return bool(row.status in _GEO_OPPORTUNITY_MUTABLE_STATUSES)


def _actor_summary(user: User | None) -> ActorSummary | None:
    if user is None:
        return None
    return ActorSummary(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
    )


def _project_assignment_detail(
    db: Session,
    *,
    target_type: WorkAssignmentTargetType,
    row: Any,
    now: datetime,
) -> WorkAssignmentDetail:
    user_ids = {uid for uid in (row.assignee_id, row.assigned_by) if uid is not None}
    users_by_id = (
        {user.id: user for user in db.scalars(select(User).where(User.id.in_(user_ids)))}
        if user_ids
        else {}
    )
    editable = _is_editable(target_type, row)
    is_overdue = bool(editable and row.due_at is not None and row.due_at <= now)
    return WorkAssignmentDetail(
        target_type=target_type,
        target_id=row.id,
        revision=int(row.revision),
        editable=editable,
        priority_mutable=target_type != "GeoOpportunity",
        assignment=WorkAssignmentOut(
            assignee=_actor_summary(users_by_id.get(row.assignee_id)),
            priority=cast(WorkPriority, row.priority),
            due_at=row.due_at,
            blocked_reason=row.blocked_reason,
            assigned_by=_actor_summary(users_by_id.get(row.assigned_by)),
            assigned_at=row.assigned_at,
            is_overdue=is_overdue,
        ),
    )


def get_work_assignment(
    db: Session,
    *,
    target_type: WorkAssignmentTargetType,
    target_id: uuid.UUID,
) -> WorkAssignmentDetail:
    """读取指定聚合的当前分派与 SLA 状态。"""
    model_cls, label, _module = _TARGET_CONFIG[target_type]
    row = db.get(model_cls, target_id)
    if row is None:
        raise not_found(label)
    return _project_assignment_detail(
        db,
        target_type=target_type,
        row=row,
        now=db_utc_now(db),
    )


def update_work_assignment(
    *,
    db: Session,
    target_type: WorkAssignmentTargetType,
    target_id: uuid.UUID,
    payload: WorkAssignmentUpdate,
    actor: User,
    request_id: str,
) -> WorkAssignmentDetail:
    """以软归属 + expected_revision CAS 更新 5 类主聚合的责任人与 SLA。"""
    model_cls, label, audit_module = _TARGET_CONFIG[target_type]
    with lock_actor_and_optional_assignee(
        db, actor, payload.assignee_id, require_active_assignee=False
    ) as (current_actor, target_user):
        row = db.scalar(
            select(model_cls)
            .where(model_cls.id == target_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        if row is None:
            raise not_found(label)
        if int(row.revision) != payload.expected_revision:
            raise AppError("REVISION_CONFLICT", f"{label}已被其他请求修改，请刷新后重试", 409)
        if not _is_editable(target_type, row):
            raise AppError("INVALID_STATE_TRANSITION", f"当前状态下的{label}已冻结分派与 SLA", 409)
        if (
            target_type == "GeoOpportunity"
            and payload.priority is not None
            and payload.priority != row.priority
        ):
            raise AppError(
                "VALIDATION_ERROR",
                "GEO 机会优先级由触发规则冻结，不能手工修改",
                422,
            )
        # 仅当真正新派或改派负责人时要求目标用户活跃；允许保留已停用历史负责人并调整 SLA/阻塞说明
        if payload.assignee_id is not None and payload.assignee_id != row.assignee_id:
            assert_assignable_user(target_user)

        next_priority = (
            row.priority
            if target_type == "GeoOpportunity"
            else (payload.priority if payload.priority is not None else row.priority)
        )
        now = db_utc_now(db)
        if (
            row.assignee_id == payload.assignee_id
            and row.priority == next_priority
            and row.due_at == payload.due_at
            and row.blocked_reason == payload.blocked_reason
        ):
            detail = _project_assignment_detail(db, target_type=target_type, row=row, now=now)
            db.rollback()
            return detail

        if payload.assignee_id is None:
            row.assignee_id = None
            row.assigned_by = None
            row.assigned_at = None
        else:
            if row.assignee_id != payload.assignee_id:
                row.assignee_id = payload.assignee_id
                row.assigned_by = current_actor.id
                row.assigned_at = now
        if target_type != "GeoOpportunity":
            row.priority = next_priority
        row.due_at = payload.due_at
        row.blocked_reason = payload.blocked_reason
        row.revision = int(row.revision) + 1
        if target_type == "PublicationWork" or target_type == "ContentTask":
            row.updated_at = now
        db.flush()

        append_audit(
            db,
            AuditEntry(
                actor_id=current_actor.id,
                business_module=audit_module,
                action="work_assignment.updated",
                target_type=target_type,
                target_id=row.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message=f"{label}责任人与 SLA 已更新",
                details={
                    "facts": {
                        "assignee_id": str(row.assignee_id) if row.assignee_id else None,
                        "priority": row.priority,
                        "has_due_at": row.due_at is not None,
                        "has_blocked_reason": row.blocked_reason is not None,
                        "revision": row.revision,
                    }
                },
            ),
        )
        db.commit()
        return _project_assignment_detail(db, target_type=target_type, row=row, now=now)
