"""Plan 命令与读模型；运行健康留给后续批次能力。"""

from enum import StrEnum
from typing import Literal

from pydantic import Field

from app.schemas.base import ContractModel
from app.schemas.geo_monitoring_plans import (
    GeoMonitoringPlanOut,
    GeoMonitoringPlanRevisionRequest,
    PlanName,
)
from app.schemas.geo_plan_preview import GeoMonitoringPlanPreview


class GeoPlanAction(StrEnum):
    UPDATE = "UPDATE"
    PREVIEW = "PREVIEW"
    ACTIVATE = "ACTIVATE"
    PAUSE = "PAUSE"
    RESUME = "RESUME"
    ARCHIVE = "ARCHIVE"
    COPY = "COPY"
    CREATE_REVISION = "CREATE_REVISION"
    DELETE = "DELETE"


class GeoPlanWorkflowStage(StrEnum):
    CONFIGURATION_REQUIRED = "CONFIGURATION_REQUIRED"
    READY = "READY"
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    ARCHIVED = "ARCHIVED"


class GeoPlanPrimaryTask(StrEnum):
    COMPLETE_CONFIGURATION = "COMPLETE_CONFIGURATION"
    ACTIVATE = "ACTIVATE"
    VIEW_RUNTIME = "VIEW_RUNTIME"
    RESUME = "RESUME"
    VIEW_HISTORY = "VIEW_HISTORY"


class GeoPlanDeletion(ContractModel):
    blockers: list[Literal["PLAN_NOT_DISABLED", "ARCHIVED", "HAS_BATCH_HISTORY"]]


class GeoPlanRunEntry(ContractModel):
    available: Literal[False]
    reason_code: Literal["UI_NOT_IMPLEMENTED"]


class GeoMonitoringPlanCopy(GeoMonitoringPlanRevisionRequest):
    name: PlanName


class GeoMonitoringPlanDetail(GeoMonitoringPlanOut):
    preview: GeoMonitoringPlanPreview
    workflow_stage: GeoPlanWorkflowStage
    primary_task: GeoPlanPrimaryTask
    available_actions: list[GeoPlanAction]
    deletion: GeoPlanDeletion
    run_entry: GeoPlanRunEntry


class GeoMonitoringPlanListPage(ContractModel):
    items: list[GeoMonitoringPlanDetail]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: Literal[10, 20, 50]
