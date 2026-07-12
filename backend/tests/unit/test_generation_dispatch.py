"""生成作业统一投递边界的单元测试。"""

from __future__ import annotations

import uuid
from contextlib import AbstractContextManager
from datetime import datetime
from types import SimpleNamespace
from typing import Any, cast

import pytest

from app.models import GenerationJob
from app.services import generation_dispatch


class FakeTransaction(AbstractContextManager[Any]):
    """为投递测试提供只返回一个 Job 的最小事务边界。"""

    def __init__(self, job: GenerationJob, *, fail_commit: bool = False) -> None:
        self.job = job
        self.fail_commit = fail_commit

    def __enter__(self) -> FakeTransaction:
        return self

    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> bool:
        if exc_type is None and self.fail_commit:
            raise RuntimeError("模拟投递元数据提交失败")
        return False

    def scalar(self, _statement: object) -> GenerationJob:
        return self.job


class FakeSessionFactory:
    """模拟 `SessionLocal.begin()`，保留是否在提交阶段失败的控制点。"""

    def __init__(self, job: GenerationJob, *, fail_commit: bool = False) -> None:
        self.job = job
        self.fail_commit = fail_commit

    def begin(self) -> FakeTransaction:
        return FakeTransaction(self.job, fail_commit=self.fail_commit)


def pending_job() -> GenerationJob:
    return cast(
        GenerationJob,
        SimpleNamespace(
            id=uuid.uuid4(),
            status="PENDING",
            dispatch_attempt_count=0,
            last_dispatch_attempt_at=None,
            created_at=datetime.now().astimezone(),
        ),
    )


def test_broker_failure_keeps_job_pending_and_records_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job = pending_job()
    monkeypatch.setattr(generation_dispatch, "SessionLocal", FakeSessionFactory(job))

    dispatched = generation_dispatch.dispatch_generation_job(
        job.id,
        lambda _job_id: (_ for _ in ()).throw(ConnectionError("broker unavailable")),
    )

    assert dispatched is False
    assert job.status == "PENDING"
    assert job.dispatch_attempt_count == 1
    assert isinstance(job.last_dispatch_attempt_at, datetime)


def test_broker_acceptance_before_metadata_commit_remains_recoverable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job = pending_job()
    sent: list[str] = []
    monkeypatch.setattr(
        generation_dispatch,
        "SessionLocal",
        FakeSessionFactory(job, fail_commit=True),
    )

    dispatched = generation_dispatch.dispatch_generation_job(job.id, sent.append)

    assert dispatched is False
    assert sent == [str(job.id)]
    assert job.status == "PENDING"


def test_non_pending_message_does_not_call_broker(monkeypatch: pytest.MonkeyPatch) -> None:
    job = pending_job()
    job.status = "RUNNING"
    sent: list[str] = []
    monkeypatch.setattr(generation_dispatch, "SessionLocal", FakeSessionFactory(job))

    assert generation_dispatch.dispatch_generation_job(job.id, sent.append) is False
    assert sent == []
    assert job.dispatch_attempt_count == 0
