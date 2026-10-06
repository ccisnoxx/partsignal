"""批次状态的完整组合表与最新尝试/集合边界。"""

from dataclasses import replace
from itertools import product

import pytest

from app.schemas.common import AccountType
from app.schemas.geo_runs import GeoBatchStatus as Batch
from app.schemas.geo_runs import GeoRunStatus as Status
from app.schemas.geo_surfaces import GeoCollectionMode as Mode
from app.services.geo_batch_policy import BatchRunState, batch_status, batch_workflow
from tests.unit.test_geo_run_policy import COMMANDS, NO_COMMANDS, state


def rows(*statuses: Status) -> list[BatchRunState]:
    return [BatchRunState(str(index), 1, state(status)) for index, status in enumerate(statuses)]


@pytest.mark.parametrize("statuses", product(Status, repeat=3))
def test_complete_batch_projection_table(statuses: tuple[Status, ...]) -> None:
    # 独立按合同计数，覆盖全部非终态优先及终态混合，不读取实现常量。
    completed = statuses.count(Status.COMPLETED)
    waiting = sum(
        status
        in {Status.PENDING, Status.RUNNING, Status.COLLECTED, Status.ANALYZING, Status.NEEDS_REVIEW}
        for status in statuses
    )
    if statuses.count(Status.PENDING) == 3:
        expected = Batch.QUEUED
    elif waiting:
        expected = Batch.RUNNING
    elif completed == 3:
        expected = Batch.COMPLETED
    elif completed:
        expected = Batch.PARTIAL
    elif statuses.count(Status.BUDGET_BLOCKED):
        expected = Batch.BUDGET_BLOCKED
    elif statuses.count(Status.FAILED):
        expected = Batch.FAILED
    else:
        expected = Batch.CANCELLED
    actual = batch_status(rows(*statuses), requested_run_count=3, matrix_committed=True)
    assert actual == expected


def test_uncommitted_planned_and_committed_pending_are_distinct() -> None:
    assert batch_status([], requested_run_count=3, matrix_committed=False) == Batch.PLANNED
    assert (
        batch_status(rows(Status.PENDING), requested_run_count=3, matrix_committed=False)
        == Batch.PLANNED
    )
    assert (
        batch_status(rows(Status.PENDING), requested_run_count=1, matrix_committed=True)
        == Batch.QUEUED
    )


@pytest.mark.parametrize(
    "latest,expected",
    [
        (Status.PENDING, Batch.QUEUED),
        (Status.RUNNING, Batch.RUNNING),
        (Status.COMPLETED, Batch.COMPLETED),
        (Status.FAILED, Batch.FAILED),
        (Status.BUDGET_BLOCKED, Batch.BUDGET_BLOCKED),
    ],
)
def test_retry_reprojects_cache_without_counting_old_failure(
    latest: Status, expected: Batch
) -> None:
    history = [
        BatchRunState("cell", 1, state(Status.FAILED, has_successor=True)),
        BatchRunState("cell", 2, state(latest)),
    ]
    assert batch_status(iter(history), requested_run_count=1, matrix_committed=True) == expected
    assert batch_status(reversed(history), requested_run_count=1, matrix_committed=True) == expected
    assert history[0].state.status == Status.FAILED


def test_latest_attempt_selection_does_not_choose_successful_answer() -> None:
    # 即使非法旁路给出历史成功，投影也不能按答案好坏择优；链合法性由0048检查。
    history = [
        BatchRunState("cell", 1, state(Status.COMPLETED)),
        BatchRunState("cell", 2, state(Status.FAILED)),
    ]
    assert batch_status(history, requested_run_count=1, matrix_committed=True) == Batch.FAILED


def test_complete_roots_cannot_hide_an_existing_latest_successor() -> None:
    history = [
        BatchRunState("cell", 1, state(Status.FAILED, has_successor=True)),
        BatchRunState("cell", 2, state(Status.PENDING)),
    ]
    assert batch_status(history, requested_run_count=1, matrix_committed=True) == Batch.QUEUED
    with pytest.raises(ValueError, match="后继"):
        batch_status(history[:1], requested_run_count=1, matrix_committed=True)


@pytest.mark.parametrize(
    "records,count,committed",
    [
        ([], 1, True),
        (rows(Status.PENDING), 2, True),
        (rows(Status.PENDING, Status.PENDING), 1, True),
        ([BatchRunState("cell", 2, state(Status.PENDING))], 1, True),
        (rows(Status.PENDING) * 2, 1, True),
        ([BatchRunState("", 1, state(Status.PENDING))], 1, True),
        ([BatchRunState("cell", 0, state(Status.PENDING))], 1, True),
        (rows(Status.RUNNING), 1, False),
        ([BatchRunState("cell", 2, state(Status.PENDING))], 1, False),
        (rows(Status.PENDING, Status.PENDING), 1, False),
        (rows(Status.PENDING), 0, True),
    ],
)
def test_missing_invalid_or_partial_history_fails(
    records: list[BatchRunState], count: int, committed: bool
) -> None:
    with pytest.raises(ValueError):
        batch_status(records, requested_run_count=count, matrix_committed=committed)


@pytest.mark.parametrize(
    "mode,eligible,expected_stage,expected_task",
    [
        (Mode.MANUAL, True, "MANUAL_ENTRY_REQUIRED", "ENTER_MANUAL_OBSERVATIONS"),
        (Mode.MANUAL, False, "QUEUED", "VIEW_EXECUTION_PROGRESS"),
        (Mode.API, True, "QUEUED", "VIEW_EXECUTION_PROGRESS"),
    ],
)
def test_pending_batch_workflow(
    mode: Mode, eligible: bool, expected_stage: str, expected_task: str
) -> None:
    records = [BatchRunState("cell", 1, state(Status.PENDING, mode))]
    out = batch_workflow(
        records,
        requested_run_count=1,
        matrix_committed=True,
        actor_type=AccountType.ENGINEER,
        actor_active=True,
        collection_eligibility={"cell": eligible},
        run_commands=COMMANDS,
        cancel_available=True,
    )
    assert (out.status, out.workflow_stage, out.primary_task) == (
        Batch.QUEUED,
        expected_stage,
        expected_task,
    )
    assert out.available_actions == ["CANCEL"]


@pytest.mark.parametrize(
    "status,stage,task",
    [
        (Status.RUNNING, "IN_PROGRESS", "VIEW_EXECUTION_PROGRESS"),
        (Status.NEEDS_REVIEW, "IN_PROGRESS", "VIEW_EXECUTION_PROGRESS"),
        (Status.COMPLETED, "COMPLETED", "VIEW_RESULTS"),
        (Status.FAILED, "FAILED", "HANDLE_FAILURE"),
        (Status.CANCELLED, "CANCELLED", "VIEW_RESULTS"),
        (Status.BUDGET_BLOCKED, "BUDGET_BLOCKED", "HANDLE_FAILURE"),
    ],
)
def test_batch_stage_and_primary(status: Status, stage: str, task: str) -> None:
    out = batch_workflow(
        rows(status),
        requested_run_count=1,
        matrix_committed=True,
        actor_type=AccountType.ADMIN,
        actor_active=True,
        collection_eligibility={"0": True},
        run_commands=COMMANDS,
        cancel_available=True,
    )
    assert (out.workflow_stage, out.primary_task) == (stage, task)
    assert out.available_actions == []


def test_partial_cancellation_preserves_finished_and_started_runs() -> None:
    records = rows(Status.COMPLETED, Status.RUNNING, Status.PENDING)
    out = batch_workflow(
        records,
        requested_run_count=3,
        matrix_committed=True,
        actor_type=AccountType.ENGINEER,
        actor_active=True,
        collection_eligibility=dict.fromkeys(["0", "1", "2"], False),
        run_commands=NO_COMMANDS,
        cancel_available=True,
    )
    assert out.available_actions == ["CANCEL"]
    cancelled = [*records[:2], replace(records[2], state=state(Status.CANCELLED))]
    assert batch_status(cancelled, requested_run_count=3, matrix_committed=True) == Batch.RUNNING
    finished = [cancelled[0], replace(cancelled[1], state=state(Status.COMPLETED)), cancelled[2]]
    assert batch_status(finished, requested_run_count=3, matrix_committed=True) == Batch.PARTIAL


def test_mixed_profiles_do_not_share_one_eligibility_boolean() -> None:
    records = [
        BatchRunState("manual", 1, state(Status.PENDING, Mode.MANUAL)),
        BatchRunState("auto", 1, state(Status.FAILED)),
    ]
    out = batch_workflow(
        records,
        requested_run_count=2,
        matrix_committed=True,
        actor_type=AccountType.ADMIN,
        actor_active=True,
        collection_eligibility={"manual": False, "auto": True},
        run_commands=COMMANDS,
        cancel_available=True,
    )
    assert out.primary_task == "HANDLE_FAILURE"
    with pytest.raises(ValueError, match="逐 cell"):
        batch_workflow(
            records,
            requested_run_count=2,
            matrix_committed=True,
            actor_type=AccountType.ADMIN,
            actor_active=True,
            collection_eligibility={"auto": True},
            run_commands=COMMANDS,
            cancel_available=True,
        )


@pytest.mark.parametrize("active,available", product([False, True], repeat=2))
def test_batch_cancel_respects_actor_and_command_availability(
    active: bool, available: bool
) -> None:
    out = batch_workflow(
        rows(Status.PENDING),
        requested_run_count=1,
        matrix_committed=True,
        actor_type=AccountType.ADMIN,
        actor_active=active,
        collection_eligibility={"0": True},
        run_commands=NO_COMMANDS,
        cancel_available=available,
    )
    assert out.available_actions == (["CANCEL"] if active and available else [])
    assert out.primary_task == "VIEW_EXECUTION_PROGRESS"
