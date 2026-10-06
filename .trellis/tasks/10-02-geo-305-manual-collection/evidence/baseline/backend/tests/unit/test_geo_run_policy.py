"""运行完整边表、终态和执行事实；预期来自业务合同而非读取策略表。"""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from itertools import product

import pytest

from app.errors import AppError
from app.schemas.common import AccountType
from app.schemas.geo_run_workflow import GeoRunAction
from app.schemas.geo_runs import GeoExternalCallState as External
from app.schemas.geo_runs import GeoRunErrorStage as ErrorStage
from app.schemas.geo_runs import GeoRunStatus as Status
from app.schemas.geo_surfaces import GeoCollectionMode as Mode
from app.services.geo_run_policy import (
    RunCommandAvailability,
    RunState,
    UnsentLeaseRecovery,
    cancellable,
    require_cancellable,
    require_retryable,
    retryable,
    run_transition,
    run_workflow,
)

NOW = datetime(2026, 10, 2, tzinfo=UTC)
COMMANDS = RunCommandAvailability(manual_entry=True, cancel=True, retry=True)
NO_COMMANDS = RunCommandAvailability(manual_entry=False, cancel=False, retry=False)
COMMON_EDGES = {
    (Status.PENDING, Status.FAILED),
    (Status.PENDING, Status.CANCELLED),
    (Status.COLLECTED, Status.ANALYZING),
    (Status.ANALYZING, Status.COMPLETED),
    (Status.ANALYZING, Status.NEEDS_REVIEW),
    (Status.ANALYZING, Status.FAILED),
    (Status.NEEDS_REVIEW, Status.COMPLETED),
}
AUTO_EDGES = {
    (Status.PENDING, Status.RUNNING),
    (Status.PENDING, Status.BUDGET_BLOCKED),
    (Status.RUNNING, Status.PENDING),
    (Status.RUNNING, Status.COLLECTED),
    (Status.RUNNING, Status.FAILED),
}


def state(status: Status, mode: Mode = Mode.API, **patch: object) -> RunState:
    answer = status in {Status.COLLECTED, Status.ANALYZING, Status.NEEDS_REVIEW, Status.COMPLETED}
    value = RunState(
        status=status,
        collection_mode=mode,
        external_call_state=External.COMPLETED
        if answer and mode != Mode.MANUAL
        else External.NOT_STARTED,
        error_stage=ErrorStage.COLLECTION
        if status in {Status.FAILED, Status.BUDGET_BLOCKED}
        else None,
        has_answer=answer,
        has_successor=False,
    )
    return replace(value, **patch)


@pytest.mark.parametrize("source,target,mode", product(Status, Status, Mode))
def test_complete_run_transition_table(source: Status, target: Status, mode: Mode) -> None:
    current = state(source, mode)
    if target == Status.COLLECTED:
        current = replace(current, has_answer=True)
        if source == Status.RUNNING:
            current = replace(current, external_call_state=External.COMPLETED)
    allowed = (source, target) in COMMON_EDGES
    allowed |= mode != Mode.MANUAL and (source, target) in AUTO_EDGES
    allowed |= mode == Mode.MANUAL and (source, target) == (Status.PENDING, Status.COLLECTED)
    recovery = UnsentLeaseRecovery(NOW, NOW, lease_revoked=True)
    if allowed:
        assert run_transition(current, target, recovery=recovery) == target
    else:
        with pytest.raises(AppError) as caught:
            run_transition(current, target, recovery=recovery)
        assert (caught.value.code, caught.value.status_code, caught.value.details) == (
            "INVALID_STATE_TRANSITION",
            409,
            {},
        )


@pytest.mark.parametrize("external", External)
@pytest.mark.parametrize("expired,revoked,has_answer", product([False, True], repeat=3))
def test_unsent_recovery_requires_all_evidence(
    external: External, expired: bool, revoked: bool, has_answer: bool
) -> None:
    current = state(Status.RUNNING, external_call_state=external, has_answer=has_answer)
    evidence = UnsentLeaseRecovery(
        NOW if expired else NOW + timedelta(seconds=1), NOW, lease_revoked=revoked
    )
    if external == External.NOT_STARTED and expired and revoked and not has_answer:
        assert run_transition(current, Status.PENDING, recovery=evidence) == Status.PENDING
    else:
        with pytest.raises(AppError, match="当前运行状态"):
            run_transition(current, Status.PENDING, recovery=evidence)


def test_recovery_is_not_an_ordinary_return_edge() -> None:
    with pytest.raises(AppError):
        run_transition(state(Status.RUNNING), Status.PENDING)
    with pytest.raises(ValueError, match="带时区"):
        run_transition(
            state(Status.RUNNING),
            Status.PENDING,
            recovery=UnsentLeaseRecovery(NOW.replace(tzinfo=None), NOW, True),
        )


@pytest.mark.parametrize("mode", Mode)
@pytest.mark.parametrize(
    "source,target",
    [
        (Status.PENDING, Status.COLLECTED),
        (Status.RUNNING, Status.COLLECTED),
        (Status.COLLECTED, Status.ANALYZING),
        (Status.ANALYZING, Status.COMPLETED),
        (Status.ANALYZING, Status.NEEDS_REVIEW),
        (Status.NEEDS_REVIEW, Status.COMPLETED),
    ],
)
def test_no_successful_progress_without_answer(mode: Mode, source: Status, target: Status) -> None:
    with pytest.raises(AppError):
        run_transition(state(source, mode, has_answer=False), target)


@pytest.mark.parametrize("external", [External.NOT_STARTED, External.SENT, External.UNKNOWN])
def test_automatic_collection_requires_completed_external_call(external: External) -> None:
    with pytest.raises(AppError):
        run_transition(
            state(Status.RUNNING, has_answer=True, external_call_state=external), Status.COLLECTED
        )


@pytest.mark.parametrize("status,external,has_answer", product(Status, External, [False, True]))
def test_cancel_qualification_and_guard(
    status: Status, external: External, has_answer: bool
) -> None:
    current = state(status, external_call_state=external, has_answer=has_answer)
    expected = status == Status.PENDING and external == External.NOT_STARTED and not has_answer
    assert cancellable(current) == expected
    if expected:
        require_cancellable(current)
    else:
        with pytest.raises(AppError) as caught:
            require_cancellable(current)
        assert caught.value.code == "GEO_RUN_ALREADY_STARTED"
        assert caught.value.status_code == 409


@pytest.mark.parametrize(
    "status,stage,answer,successor",
    product(Status, [None, *ErrorStage], [False, True], [False, True]),
)
def test_retry_qualification_and_error_priority(
    status: Status, stage: ErrorStage | None, answer: bool, successor: bool
) -> None:
    current = state(status, error_stage=stage, has_answer=answer, has_successor=successor)
    expected = (
        status in {Status.FAILED, Status.BUDGET_BLOCKED}
        and stage == ErrorStage.COLLECTION
        and not answer
        and not successor
    )
    assert retryable(current) == expected
    if expected:
        require_retryable(current)
    else:
        with pytest.raises(AppError) as caught:
            require_retryable(current)
        assert caught.value.code == (
            "GEO_RUN_HAS_SUCCESSOR" if successor else "GEO_RUN_NOT_RETRYABLE"
        )
        assert caught.value.status_code == 409


@pytest.mark.parametrize("status,mode,actor", product(Status, Mode, AccountType))
def test_workflow_uses_same_qualification(status: Status, mode: Mode, actor: AccountType) -> None:
    current = state(status, mode)
    projection = run_workflow(
        current, actor_type=actor, actor_active=True, collection_eligible=True, commands=COMMANDS
    )
    expected = []
    if status == Status.PENDING:
        if mode == Mode.MANUAL:
            expected.append("ENTER_MANUAL_OBSERVATION")
        expected.append("CANCEL")
    if status in {Status.FAILED, Status.BUDGET_BLOCKED}:
        expected.append("RETRY")
    assert projection.available_actions == expected
    if GeoRunAction.CANCEL in projection.available_actions:
        require_cancellable(current)
    if GeoRunAction.RETRY in projection.available_actions:
        require_retryable(current)


@pytest.mark.parametrize(
    "status,stage,task",
    [
        (Status.RUNNING, "COLLECTION_IN_PROGRESS", "VIEW_EXECUTION_PROGRESS"),
        (Status.COLLECTED, "ANALYSIS_PENDING", "VIEW_EXECUTION_PROGRESS"),
        (Status.ANALYZING, "ANALYSIS_IN_PROGRESS", "VIEW_EXECUTION_PROGRESS"),
        (Status.NEEDS_REVIEW, "REVIEW_REQUIRED", "VIEW_REVIEW"),
        (Status.COMPLETED, "COMPLETED", "VIEW_OBSERVATION"),
        (Status.FAILED, "RETRYABLE_FAILURE", "HANDLE_FAILURE"),
        (Status.CANCELLED, "CANCELLED", "VIEW_EXECUTION_PROGRESS"),
        (Status.BUDGET_BLOCKED, "BUDGET_BLOCKED", "HANDLE_FAILURE"),
    ],
)
def test_stage_and_primary_task(status: Status, stage: str, task: str) -> None:
    out = run_workflow(
        state(status),
        actor_type=AccountType.ENGINEER,
        actor_active=True,
        collection_eligible=True,
        commands=COMMANDS,
    )
    assert (out.workflow_stage, out.primary_task) == (stage, task)


@pytest.mark.parametrize(
    "active,eligible,commands", product([False, True], [False, True], [COMMANDS, NO_COMMANDS])
)
def test_current_permissions_eligibility_and_installed_commands(
    active: bool, eligible: bool, commands: RunCommandAvailability
) -> None:
    manual = run_workflow(
        state(Status.PENDING, Mode.MANUAL),
        actor_type=AccountType.ADMIN,
        actor_active=active,
        collection_eligible=eligible,
        commands=commands,
    )
    assert (GeoRunAction.ENTER_MANUAL_OBSERVATION in manual.available_actions) == (
        active and eligible and commands.manual_entry
    )
    assert (GeoRunAction.CANCEL in manual.available_actions) == (active and commands.cancel)
    failed = run_workflow(
        state(Status.FAILED),
        actor_type=AccountType.ADMIN,
        actor_active=active,
        collection_eligible=eligible,
        commands=commands,
    )
    can_retry = active and eligible and commands.retry
    assert failed.available_actions == (["RETRY"] if can_retry else [])
    assert failed.workflow_stage == ("RETRYABLE_FAILURE" if can_retry else "HISTORICAL_FAILURE")


@pytest.mark.parametrize(
    "patch",
    [
        {"error_stage": ErrorStage.ANALYSIS, "has_answer": True},
        {"error_stage": ErrorStage.REVIEW, "has_answer": True},
        {"has_successor": True},
        {"has_answer": True},
    ],
)
def test_same_failed_status_does_not_imply_retry(patch: dict[str, object]) -> None:
    current = state(Status.FAILED, **patch)
    out = run_workflow(
        current,
        actor_type=AccountType.ADMIN,
        actor_active=True,
        collection_eligible=True,
        commands=COMMANDS,
    )
    assert out.available_actions == []
    assert (out.workflow_stage, out.primary_task) == ("HISTORICAL_FAILURE", "VIEW_FAILURE")


def test_unknown_state_and_target_fail_explicitly() -> None:
    with pytest.raises(ValueError):
        state(Status.PENDING, collection_mode="UNKNOWN")
    with pytest.raises(AppError) as caught:
        run_transition(state(Status.PENDING), "UNKNOWN")  # type: ignore[arg-type]
    assert caught.value.code == "INVALID_STATE_TRANSITION"
