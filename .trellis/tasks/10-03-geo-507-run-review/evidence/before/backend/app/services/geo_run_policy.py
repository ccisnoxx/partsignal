"""Run 首次工作链及命令资格的唯一纯策略；不拥有事务或外部调用。"""

from dataclasses import dataclass
from datetime import datetime

from app.errors import AppError
from app.schemas.common import AccountType
from app.schemas.geo_run_workflow import (
    GeoRunAction as Action,
)
from app.schemas.geo_run_workflow import (
    GeoRunPrimaryTask as Task,
)
from app.schemas.geo_run_workflow import (
    GeoRunWorkflowProjection,
)
from app.schemas.geo_run_workflow import (
    GeoRunWorkflowStage as Stage,
)
from app.schemas.geo_runs import GeoExternalCallState as External
from app.schemas.geo_runs import GeoRunCommandErrorCode as Error
from app.schemas.geo_runs import GeoRunErrorStage, GeoRunStatus
from app.schemas.geo_surfaces import GeoCollectionMode

TERMINAL_RUN_STATUSES = frozenset(
    {
        GeoRunStatus.COMPLETED,
        GeoRunStatus.FAILED,
        GeoRunStatus.CANCELLED,
        GeoRunStatus.BUDGET_BLOCKED,
    }
)
_TRANSITIONS = {
    GeoRunStatus.PENDING: frozenset(
        {
            GeoRunStatus.RUNNING,
            GeoRunStatus.COLLECTED,
            GeoRunStatus.FAILED,
            GeoRunStatus.CANCELLED,
            GeoRunStatus.BUDGET_BLOCKED,
        }
    ),
    GeoRunStatus.RUNNING: frozenset(
        {GeoRunStatus.PENDING, GeoRunStatus.COLLECTED, GeoRunStatus.FAILED}
    ),
    GeoRunStatus.COLLECTED: frozenset({GeoRunStatus.ANALYZING}),
    GeoRunStatus.ANALYZING: frozenset(
        {GeoRunStatus.COMPLETED, GeoRunStatus.NEEDS_REVIEW, GeoRunStatus.FAILED}
    ),
    GeoRunStatus.NEEDS_REVIEW: frozenset({GeoRunStatus.COMPLETED}),
}


@dataclass(frozen=True)
class RunState:
    """由锁内数据库事实显式转换，不从 ORM、UI 或当前 Profile 猜测历史模式。"""

    status: GeoRunStatus
    collection_mode: GeoCollectionMode
    external_call_state: External
    error_stage: GeoRunErrorStage | None
    has_answer: bool
    has_successor: bool

    def __post_init__(self) -> None:
        object.__setattr__(self, "status", GeoRunStatus(self.status))
        object.__setattr__(self, "collection_mode", GeoCollectionMode(self.collection_mode))
        object.__setattr__(self, "external_call_state", External(self.external_call_state))
        if self.error_stage is not None:
            object.__setattr__(self, "error_stage", GeoRunErrorStage(self.error_stage))


@dataclass(frozen=True)
class RunCommandAvailability:
    """接线能力而非推测：未实现的命令必须传 false，没有默认成功能力。"""

    manual_entry: bool
    cancel: bool
    retry: bool


@dataclass(frozen=True)
class UnsentLeaseRecovery:
    """调用服务撤销旧 token 后的证据；不得仅凭发送状态实施恢复。"""

    lease_expires_at: datetime
    now: datetime
    lease_revoked: bool

    def permits_recovery(self) -> bool:
        if self.now.utcoffset() is None or self.lease_expires_at.utcoffset() is None:
            raise ValueError("lease 恢复时间必须带时区")
        return self.lease_revoked and self.lease_expires_at <= self.now


def cancellable(state: RunState) -> bool:
    return (
        state.status == GeoRunStatus.PENDING
        and state.external_call_state == External.NOT_STARTED
        and not state.has_answer
    )


def retryable(state: RunState) -> bool:
    return (
        state.status in {GeoRunStatus.FAILED, GeoRunStatus.BUDGET_BLOCKED}
        and state.error_stage == GeoRunErrorStage.COLLECTION
        and not state.has_answer
        and not state.has_successor
    )


def require_cancellable(state: RunState) -> None:
    if not cancellable(state):
        raise AppError(Error.GEO_RUN_ALREADY_STARTED, "只能取消尚未开始的运行", 409)


def require_retryable(state: RunState) -> None:
    if state.has_successor:
        raise AppError(Error.GEO_RUN_HAS_SUCCESSOR, "该尝试已有后继，请查看最新尝试", 409)
    if not retryable(state):
        raise AppError(Error.GEO_RUN_NOT_RETRYABLE, "只有无原始答案的采集失败可以创建新尝试", 409)


def _invalid_transition() -> AppError:
    return AppError("INVALID_STATE_TRANSITION", "当前运行状态或执行事实不允许此转换", 409)


def run_transition(
    state: RunState, target: GeoRunStatus, *, recovery: UnsentLeaseRecovery | None = None
) -> GeoRunStatus:
    """只裁决边和事实；lease 获取、结果原子提交、revision 与错误字段仍由命令 owner 写入。"""
    try:
        target = GeoRunStatus(target)
    except ValueError as error:
        raise _invalid_transition() from error
    if target not in _TRANSITIONS.get(state.status, frozenset()):
        raise _invalid_transition()
    manual = state.collection_mode == GeoCollectionMode.MANUAL
    if state.status == GeoRunStatus.PENDING:
        allowed = state.external_call_state == External.NOT_STARTED
        if target == GeoRunStatus.COLLECTED:
            allowed = allowed and manual and state.has_answer
        else:
            allowed = allowed and not state.has_answer
            if target in {GeoRunStatus.RUNNING, GeoRunStatus.BUDGET_BLOCKED}:
                allowed = allowed and not manual
    elif state.status == GeoRunStatus.RUNNING:
        allowed = not manual
        if target == GeoRunStatus.PENDING:
            allowed = (
                allowed
                and state.external_call_state == External.NOT_STARTED
                and not state.has_answer
                and recovery is not None
                and recovery.permits_recovery()
            )
        elif target == GeoRunStatus.COLLECTED:
            allowed = (
                allowed and state.has_answer and state.external_call_state == External.COMPLETED
            )
        else:
            allowed = allowed and not state.has_answer
    else:
        allowed = state.has_answer and (
            state.external_call_state == External.COMPLETED
            or (manual and state.external_call_state == External.NOT_STARTED)
        )
    if not allowed:
        raise _invalid_transition()
    return target


def run_workflow(
    state: RunState,
    *,
    actor_type: AccountType,
    actor_active: bool,
    collection_eligible: bool,
    commands: RunCommandAvailability,
) -> GeoRunWorkflowProjection:
    """投影与守卫共用资格；角色、当前执行门禁与真实接线能力都不能由前端补全。"""
    AccountType(actor_type)
    actions: list[Action] = []
    manual_pending = state.collection_mode == GeoCollectionMode.MANUAL and cancellable(state)
    if actor_active:
        if manual_pending and collection_eligible and commands.manual_entry:
            actions.append(Action.ENTER_MANUAL_OBSERVATION)
        if cancellable(state) and commands.cancel:
            actions.append(Action.CANCEL)
        if retryable(state) and collection_eligible and commands.retry:
            actions.append(Action.RETRY)
    stages = {
        GeoRunStatus.PENDING: Stage.MANUAL_ENTRY_REQUIRED if manual_pending else Stage.QUEUED,
        GeoRunStatus.RUNNING: Stage.COLLECTION_IN_PROGRESS,
        GeoRunStatus.COLLECTED: Stage.ANALYSIS_PENDING,
        GeoRunStatus.ANALYZING: Stage.ANALYSIS_IN_PROGRESS,
        GeoRunStatus.NEEDS_REVIEW: Stage.REVIEW_REQUIRED,
        GeoRunStatus.COMPLETED: Stage.COMPLETED,
        GeoRunStatus.FAILED: Stage.RETRYABLE_FAILURE
        if Action.RETRY in actions
        else Stage.HISTORICAL_FAILURE,
        GeoRunStatus.CANCELLED: Stage.CANCELLED,
        GeoRunStatus.BUDGET_BLOCKED: Stage.BUDGET_BLOCKED,
    }
    task = Task.VIEW_EXECUTION_PROGRESS
    if Action.ENTER_MANUAL_OBSERVATION in actions:
        task = Task.ENTER_MANUAL_OBSERVATION
    elif state.status == GeoRunStatus.NEEDS_REVIEW:
        task = Task.VIEW_REVIEW
    elif state.status == GeoRunStatus.COMPLETED:
        task = Task.VIEW_OBSERVATION
    elif state.status in {GeoRunStatus.FAILED, GeoRunStatus.BUDGET_BLOCKED}:
        task = Task.HANDLE_FAILURE if Action.RETRY in actions else Task.VIEW_FAILURE
    return GeoRunWorkflowProjection(
        workflow_stage=stages[state.status], primary_task=task, available_actions=actions
    )
