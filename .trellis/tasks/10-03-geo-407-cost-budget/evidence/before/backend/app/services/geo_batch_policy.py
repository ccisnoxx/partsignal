"""Batch 是完整 Run 集合的投影，不接受缓存状态或前端分页作为事实。"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Literal

from app.schemas.common import AccountType
from app.schemas.geo_run_workflow import (
    GeoBatchAction,
    GeoBatchWorkflowProjection,
    GeoRunAction,
)
from app.schemas.geo_run_workflow import (
    GeoBatchPrimaryTask as Task,
)
from app.schemas.geo_run_workflow import (
    GeoBatchWorkflowStage as Stage,
)
from app.schemas.geo_runs import GeoBatchStatus as Status
from app.schemas.geo_runs import GeoRunStatus
from app.services.geo_run_policy import (
    TERMINAL_RUN_STATUSES,
    RunCommandAvailability,
    RunState,
    cancellable,
    run_workflow,
)


@dataclass(frozen=True)
class BatchRunState:
    """调用方提供同一 Batch 的完整历史；cell key 来自数据库生成列。"""

    run_cell_key: str
    attempt_no: int
    state: RunState


def latest_cell_attempts(
    runs: Iterable[BatchRunState], *, requested_run_count: int, matrix_committed: bool
) -> tuple[BatchRunState, ...]:
    """保留编号最大的尝试，不择优答案；缺失初始 cell 或重复 attempt 显式失败。"""
    if type(requested_run_count) is not int or requested_run_count < 1:
        raise ValueError("请求数量必须是正整数")
    latest: dict[str, BatchRunState] = {}
    roots: set[str] = set()
    identities: set[tuple[str, int]] = set()
    for run in runs:
        if not run.run_cell_key or type(run.attempt_no) is not int or run.attempt_no < 1:
            raise ValueError("采样单元和尝试编号必须有效")
        key = (run.run_cell_key, run.attempt_no)
        if key in identities:
            raise ValueError("同一采样单元的尝试编号重复")
        identities.add(key)
        if run.attempt_no == 1:
            roots.add(run.run_cell_key)
        if run.run_cell_key not in latest or latest[run.run_cell_key].attempt_no < run.attempt_no:
            latest[run.run_cell_key] = run
    if not matrix_committed:
        # PLANNED 仅表达未提交的准备态，不能掩盖已运行或带后继的集合。
        if any(
            run.attempt_no != 1 or run.state.status != GeoRunStatus.PENDING
            for run in latest.values()
        ):
            raise ValueError("未提交矩阵只能包含初始 PENDING")
        if len(roots) > requested_run_count:
            raise ValueError("初始矩阵超出请求数量")
        return ()
    if len(roots) != requested_run_count or roots != latest.keys():
        raise ValueError("批次投影必须提供全部初始采样单元及其尝试历史")
    if any(run.state.has_successor for run in latest.values()):
        raise ValueError("批次投影遗漏了已存在的后继尝试")
    return tuple(latest[key] for key in sorted(latest))


# 纯投影和读取筛选共享同一有序规则；SQL只翻译EXACT/ANY，不依赖缓存状态。
BATCH_STATUS_RULES: tuple[tuple[Status, Literal["EXACT", "ANY"], frozenset[GeoRunStatus]], ...] = (
    (Status.QUEUED, "EXACT", frozenset({GeoRunStatus.PENDING})),
    (Status.RUNNING, "ANY", frozenset(GeoRunStatus) - TERMINAL_RUN_STATUSES),
    (Status.COMPLETED, "EXACT", frozenset({GeoRunStatus.COMPLETED})),
    (Status.PARTIAL, "ANY", frozenset({GeoRunStatus.COMPLETED})),
    (Status.BUDGET_BLOCKED, "ANY", frozenset({GeoRunStatus.BUDGET_BLOCKED})),
    (Status.FAILED, "ANY", frozenset({GeoRunStatus.FAILED})),
    (Status.CANCELLED, "EXACT", frozenset({GeoRunStatus.CANCELLED})),
)


def _status(latest: tuple[BatchRunState, ...]) -> Status:
    if not latest:
        return Status.PLANNED
    states = {run.state.status for run in latest}
    for status, kind, selected in BATCH_STATUS_RULES:
        if (states == selected) if kind == "EXACT" else bool(states & selected):
            return status
    raise ValueError("运行集合无法投影批次状态")


def batch_status(
    runs: Iterable[BatchRunState], *, requested_run_count: int, matrix_committed: bool
) -> Status:
    return _status(
        latest_cell_attempts(
            runs, requested_run_count=requested_run_count, matrix_committed=matrix_committed
        )
    )


def batch_workflow(
    runs: Iterable[BatchRunState],
    *,
    requested_run_count: int,
    matrix_committed: bool,
    actor_type: AccountType,
    actor_active: bool,
    collection_eligibility: Mapping[str, bool],
    run_commands: RunCommandAvailability,
    cancel_available: bool,
) -> GeoBatchWorkflowProjection:
    AccountType(actor_type)
    latest = latest_cell_attempts(
        runs, requested_run_count=requested_run_count, matrix_committed=matrix_committed
    )
    status = _status(latest)
    if set(collection_eligibility) != {run.run_cell_key for run in latest}:
        raise ValueError("必须逐 cell 显式提供当前采集资格")
    workflows = [
        run_workflow(
            run.state,
            actor_type=actor_type,
            actor_active=actor_active,
            collection_eligible=collection_eligibility[run.run_cell_key],
            commands=run_commands,
        )
        for run in latest
    ]
    manual_entry = any(
        GeoRunAction.ENTER_MANUAL_OBSERVATION in w.available_actions for w in workflows
    )
    retry = any(GeoRunAction.RETRY in w.available_actions for w in workflows)
    stages = {
        Status.PLANNED: Stage.PREPARING,
        Status.QUEUED: Stage.QUEUED,
        Status.RUNNING: Stage.IN_PROGRESS,
        Status.COMPLETED: Stage.COMPLETED,
        Status.PARTIAL: Stage.PARTIAL,
        Status.FAILED: Stage.FAILED,
        Status.CANCELLED: Stage.CANCELLED,
        Status.BUDGET_BLOCKED: Stage.BUDGET_BLOCKED,
    }
    stage = Stage.MANUAL_ENTRY_REQUIRED if manual_entry else stages[status]
    task = Task.VIEW_EXECUTION_PROGRESS
    if manual_entry:
        task = Task.ENTER_MANUAL_OBSERVATIONS
    elif retry:
        task = Task.HANDLE_FAILURE
    elif status in {
        Status.COMPLETED,
        Status.PARTIAL,
        Status.FAILED,
        Status.CANCELLED,
        Status.BUDGET_BLOCKED,
    }:
        task = Task.VIEW_RESULTS
    actions = (
        [GeoBatchAction.CANCEL]
        if actor_active and cancel_available and any(cancellable(run.state) for run in latest)
        else []
    )
    return GeoBatchWorkflowProjection(
        status=status, workflow_stage=stage, primary_task=task, available_actions=actions
    )
