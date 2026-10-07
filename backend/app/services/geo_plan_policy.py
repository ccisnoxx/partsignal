"""计划生命周期与动作的唯一策略；不把预览结果当授权。"""

from typing import Literal

from app.errors import AppError
from app.schemas.geo_monitoring_plans import GeoMonitoringPlanStatus as Status
from app.schemas.geo_monitoring_plans import GeoPlanScheduleKind
from app.schemas.geo_plan_management import (
    GeoPlanAction as Action,
)
from app.schemas.geo_plan_management import (
    GeoPlanDeletion,
)
from app.schemas.geo_plan_management import (
    GeoPlanPrimaryTask as Task,
)
from app.schemas.geo_plan_management import (
    GeoPlanWorkflowStage as Stage,
)
from app.schemas.geo_plan_preview import GeoMonitoringPlanPreview

type PlanTransition = Literal["activate", "pause", "resume", "archive"]


def require_supported_schedule(schedule_kind: GeoPlanScheduleKind) -> None:
    """V1.0 无生产到期入口；保留历史 CRON，但禁止写入和首次执行。"""
    if schedule_kind == GeoPlanScheduleKind.CRON:
        raise AppError(
            "GEO_PLAN_CRON_UNSUPPORTED",
            "V1.0 不支持 CRON 计划；历史计划只读，请新建人工计划或人工批次",
            409,
        )


def require_mutable(status: Status) -> None:
    if status == Status.ARCHIVED:
        raise AppError("GEO_PLAN_ARCHIVED", "归档计划只读，请复制为新计划", 409)


def transition(status: Status, command: PlanTransition) -> Status:
    require_mutable(status)
    targets = {
        "activate": {Status.DISABLED: Status.ACTIVE},
        "pause": {Status.ACTIVE: Status.PAUSED},
        "resume": {Status.PAUSED: Status.ACTIVE},
        "archive": dict.fromkeys((Status.DISABLED, Status.PAUSED, Status.ACTIVE), Status.ARCHIVED),
    }
    result = targets[command].get(status)
    if result is None:
        raise AppError("INVALID_STATE_TRANSITION", "当前计划状态不允许此操作", 409)
    return result


def projection(
    status: Status,
    *,
    eligible: bool,
    schedule_kind: GeoPlanScheduleKind = GeoPlanScheduleKind.MANUAL_ONLY,
) -> tuple[Stage, Task, list[Action], GeoPlanDeletion]:
    if schedule_kind == GeoPlanScheduleKind.CRON:
        return (
            Stage.UNSUPPORTED_SCHEDULE,
            Task.VIEW_HISTORY,
            [],
            GeoPlanDeletion(blockers=["SCHEDULE_UNSUPPORTED"]),
        )
    if status == Status.ARCHIVED:
        return (
            Stage.ARCHIVED,
            Task.VIEW_HISTORY,
            [Action.COPY],
            GeoPlanDeletion(blockers=["ARCHIVED"]),
        )
    actions = [Action.PREVIEW, Action.COPY, Action.ARCHIVE]
    if status == Status.ACTIVE:
        actions += [Action.PAUSE, Action.CREATE_REVISION]
        stage, task = Stage.ACTIVE, Task.VIEW_RUNTIME
    else:
        actions += [Action.UPDATE]
        if status == Status.DISABLED:
            actions += [Action.DELETE]
            stage, task = (
                (Stage.READY, Task.ACTIVATE)
                if eligible
                else (Stage.CONFIGURATION_REQUIRED, Task.COMPLETE_CONFIGURATION)
            )
            if eligible:
                actions += [Action.ACTIVATE]
        else:
            stage, task = Stage.PAUSED, Task.RESUME if eligible else Task.COMPLETE_CONFIGURATION
            if eligible:
                actions += [Action.RESUME]
    return (
        stage,
        task,
        actions,
        GeoPlanDeletion(blockers=[] if status == Status.DISABLED else ["PLAN_NOT_DISABLED"]),
    )


def require_references(preview: GeoMonitoringPlanPreview) -> None:
    missing = [
        b
        for b in preview.blockers
        if b.code in {"SUBJECT_NOT_FOUND", "PROMPT_NOT_FOUND", "PROFILE_NOT_FOUND"}
    ]
    if missing:
        raise AppError(
            "GEO_PLAN_REFERENCE_INVALID",
            "计划引用的资源不存在",
            422,
            {"blockers": [b.model_dump(mode="json") for b in missing]},
        )


def require_eligible(preview: GeoMonitoringPlanPreview) -> None:
    if preview.blockers:
        code = (
            "GEO_PLAN_BUDGET_EXCEEDED"
            if any(b.code == "BUDGET_EXCEEDED" for b in preview.blockers)
            else "GEO_PLAN_PROFILE_INELIGIBLE"
        )
        raise AppError(
            code,
            "计划当前不具备运行资格，请修正阻断项",
            409,
            {"blockers": [b.model_dump(mode="json") for b in preview.blockers]},
        )
