"""Slice 4C：Campaign 归因看板与全局经营指标只读 HTTP 路由。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.deps import DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.operations_dashboard import (
    CampaignAttributionDashboardOut,
    OperationsMetricsOut,
)
from app.services.operations_dashboard import (
    get_campaign_attribution_dashboard,
    get_workbench_operations_metrics,
)

router = APIRouter(prefix="/api/v1", tags=["operations-dashboard"])


def _repeatable_read_snapshot(db: DbSession) -> None:
    """在认证查询开启事务之前配置单次 REPEATABLE READ 读取快照。"""
    db.autoflush = False
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})


@router.get(
    "/campaigns/{campaign_id}/attribution-dashboard",
    response_model=CampaignAttributionDashboardOut,
    operation_id="getCampaignAttributionDashboard",
    dependencies=[Depends(_repeatable_read_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def get_campaign_attribution_dashboard_endpoint(
    campaign_id: uuid.UUID,
    db: DbSession,
    _user: EngineerUser,
    window_days: Annotated[int, Query(ge=7, le=365)] = 30,
) -> CampaignAttributionDashboardOut:
    return get_campaign_attribution_dashboard(db, campaign_id, window_days=window_days)


@router.get(
    "/workbench/operations-metrics",
    response_model=OperationsMetricsOut,
    operation_id="getWorkbenchOperationsMetrics",
    dependencies=[Depends(_repeatable_read_snapshot)],
    responses=error_responses(401, 403, 422),
)
def get_workbench_operations_metrics_endpoint(
    db: DbSession,
    _user: EngineerUser,
    window_days: Annotated[int, Query(ge=7, le=365)] = 30,
) -> OperationsMetricsOut:
    return get_workbench_operations_metrics(db, window_days=window_days)
