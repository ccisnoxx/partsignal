"""批次创建命令与稳定回执；不暴露派发、读模型或内部调度权限。"""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field

from app.schemas.base import ContractModel
from app.schemas.geo_monitoring_plans import (
    GeoMonitoringPlanConfiguration,
    GeoMonitoringPlanRevisionRequest,
    GeoPlanScheduleKind,
)


class GeoPlanBatchCreate(GeoMonitoringPlanRevisionRequest):
    source: Literal["PLAN"]
    plan_id: UUID


class GeoAdHocBatchConfiguration(GeoMonitoringPlanConfiguration):
    schedule_kind: Literal[GeoPlanScheduleKind.MANUAL_ONLY] = GeoPlanScheduleKind.MANUAL_ONLY
    cron_expression: None = None


class GeoAdHocBatchCreate(ContractModel):
    source: Literal["AD_HOC"]
    configuration: GeoAdHocBatchConfiguration


GeoObservationBatchCreate = Annotated[
    GeoPlanBatchCreate | GeoAdHocBatchCreate, Field(discriminator="source")
]


class GeoBatchCreated(ContractModel):
    batch_id: UUID
    requested_run_count: Annotated[int, Field(strict=True, ge=1)]
    created_at: AwareDatetime
