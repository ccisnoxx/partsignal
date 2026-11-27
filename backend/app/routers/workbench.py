"""Frontend V2 Workbench 聚合读取入口。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.deps import CurrentUser, DbSession
from app.errors import error_responses
from app.schemas.work_assignment import (
    WorkAssigneeOptionList,
    WorkbenchInbox,
    WorkbenchInboxBucket,
)
from app.schemas.workbench import WorkbenchAggregate
from app.services.work_assignments import list_assignable_users
from app.services.workbench import get_workbench_aggregate
from app.services.workbench_inbox import get_workbench_inbox

router = APIRouter(prefix="/api/v1", tags=["workbench"])


def _workbench_read_snapshot(db: DbSession) -> None:
    """在认证读取前为跨领域聚合建立禁止 autoflush 的一致 PostgreSQL 快照。"""
    db.autoflush = False
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})


@router.get(
    "/workbench",
    response_model=WorkbenchAggregate,
    operation_id="getWorkbench",
    responses=error_responses(401, 403, 409),
    dependencies=[Depends(_workbench_read_snapshot)],
)
def get_workbench(db: DbSession, _user: CurrentUser) -> WorkbenchAggregate:
    """返回当前已认证操作者可读取的 Workbench 聚合。"""
    return get_workbench_aggregate(db)


@router.get(
    "/workbench/inbox",
    response_model=WorkbenchInbox,
    operation_id="getWorkbenchInbox",
    responses=error_responses(401, 403, 422),
    dependencies=[Depends(_workbench_read_snapshot)],
)
def get_workbench_inbox_route(
    db: DbSession,
    user: CurrentUser,
    bucket: WorkbenchInboxBucket = "assigned_to_me",
    timezone: Annotated[str, Query(min_length=1, max_length=64)] = "Asia/Shanghai",
) -> WorkbenchInbox:
    """在单次一致快照内返回当前操作者的 8 分桶运营收件箱投影。"""
    return get_workbench_inbox(
        db,
        actor=user,
        bucket=bucket,
        timezone_name=timezone,
    )


@router.get(
    "/workbench/assignees",
    response_model=WorkAssigneeOptionList,
    operation_id="listWorkbenchAssignees",
    responses=error_responses(401, 403),
    dependencies=[Depends(_workbench_read_snapshot)],
)
def list_workbench_assignees(db: DbSession, _user: CurrentUser) -> WorkAssigneeOptionList:
    """返回可供软归属分派的活跃成员列表。"""
    return list_assignable_users(db)
