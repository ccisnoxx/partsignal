"""Frontend V2 Workbench 聚合读取入口。"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.deps import CurrentUser, DbSession
from app.errors import error_responses
from app.schemas.workbench import WorkbenchAggregate
from app.services.workbench import get_workbench_aggregate

router = APIRouter(prefix="/api/v1", tags=["workbench"])


def _workbench_read_snapshot(db: DbSession) -> None:
    """在认证读取前为跨领域聚合建立一致的 PostgreSQL 快照。"""
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
