"""回答级运行与批次的独立动作投影；接线方必须显式给出全部字段。"""

from enum import StrEnum

from app.schemas.base import ContractModel
from app.schemas.geo_runs import GeoBatchStatus


class GeoRunWorkflowStage(StrEnum):
    MANUAL_ENTRY_REQUIRED = "MANUAL_ENTRY_REQUIRED"
    QUEUED = "QUEUED"
    COLLECTION_IN_PROGRESS = "COLLECTION_IN_PROGRESS"
    ANALYSIS_PENDING = "ANALYSIS_PENDING"
    ANALYSIS_IN_PROGRESS = "ANALYSIS_IN_PROGRESS"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    COMPLETED = "COMPLETED"
    RETRYABLE_FAILURE = "RETRYABLE_FAILURE"
    HISTORICAL_FAILURE = "HISTORICAL_FAILURE"
    CANCELLED = "CANCELLED"
    BUDGET_BLOCKED = "BUDGET_BLOCKED"


class GeoRunPrimaryTask(StrEnum):
    ENTER_MANUAL_OBSERVATION = "ENTER_MANUAL_OBSERVATION"
    VIEW_EXECUTION_PROGRESS = "VIEW_EXECUTION_PROGRESS"
    VIEW_REVIEW = "VIEW_REVIEW"
    VIEW_OBSERVATION = "VIEW_OBSERVATION"
    HANDLE_FAILURE = "HANDLE_FAILURE"
    VIEW_FAILURE = "VIEW_FAILURE"


class GeoRunAction(StrEnum):
    ENTER_MANUAL_OBSERVATION = "ENTER_MANUAL_OBSERVATION"
    CANCEL = "CANCEL"
    RETRY = "RETRY"


class GeoBatchWorkflowStage(StrEnum):
    PREPARING = "PREPARING"
    QUEUED = "QUEUED"
    MANUAL_ENTRY_REQUIRED = "MANUAL_ENTRY_REQUIRED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    BUDGET_BLOCKED = "BUDGET_BLOCKED"


class GeoBatchPrimaryTask(StrEnum):
    VIEW_EXECUTION_PROGRESS = "VIEW_EXECUTION_PROGRESS"
    ENTER_MANUAL_OBSERVATIONS = "ENTER_MANUAL_OBSERVATIONS"
    VIEW_RESULTS = "VIEW_RESULTS"
    HANDLE_FAILURE = "HANDLE_FAILURE"


class GeoBatchAction(StrEnum):
    CANCEL = "CANCEL"


class GeoRunWorkflowProjection(ContractModel):
    workflow_stage: GeoRunWorkflowStage
    primary_task: GeoRunPrimaryTask
    available_actions: list[GeoRunAction]


class GeoBatchWorkflowProjection(ContractModel):
    status: GeoBatchStatus
    workflow_stage: GeoBatchWorkflowStage
    primary_task: GeoBatchPrimaryTask
    available_actions: list[GeoBatchAction]
