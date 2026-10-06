"""R2：确定锁顺序的真实竞争；取消 writer 仅测试策略/存储，非 HTTP 命令。"""

from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from threading import Event
from time import monotonic
from uuid import uuid4

import pytest
from sqlalchemy import select, text

from app.errors import AppError
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_manual_collection import GeoManualDraft, GeoManualSubmission
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.identity import AuditLog, User
from app.schemas.geo_manual_collection import GeoManualDraftSave, GeoManualObservationSubmit
from app.schemas.geo_runs import GeoRunStatus
from app.services import geo_manual_collection as service
from app.services.geo_run_policy import require_cancellable, run_transition
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine
from tests.integration.test_geo_manual_collection import batch_run, evidence, payload, submit

pytestmark = pytest.mark.integration
__all__ = ["plans_api", "questions_api", "questions_engine"]


def wait_for_lock(api, waiter, holder):
    """必须证明指定连接阻塞；线程启动或耗时本身不是竞争证据。"""
    with api.api.engine.connect() as conn:
        deadline = monotonic() + 5
        while monotonic() < deadline:
            blockers = conn.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": waiter})
            if holder in blockers:
                return
    pytest.fail("未观测到指定 PostgreSQL 连接持有的锁等待")


def start(pool, api, actor_id, operation):
    ready = Queue()

    def invoke():
        with api.api.factory() as db:
            db.execute(text("SET LOCAL statement_timeout='10s'"))
            actor = db.get(User, actor_id)
            ready.put(db.scalar(text("SELECT pg_backend_pid()")))
            try:
                return operation(db, actor)
            except AppError as error:
                # 写命令自己的 rollback 必须使原 Session 可继续使用。
                assert not db.in_transaction()
                assert db.scalar(text("SELECT 1")) == 1
                return error

    future = pool.submit(invoke)
    return future, ready.get(timeout=5)


def cancel_storage_writer(db, run):
    """仅验收 SQL 写边界；不注册路由、不伪造取消审计/回执/清理能力。"""
    db.scalar(
        select(GeoObservationBatch).where(GeoObservationBatch.id == run.batch_id).with_for_update()
    )
    current = service._run(db, run.id, lock=True)
    state = service._state(db, current)
    require_cancellable(state)
    run_transition(state, GeoRunStatus.CANCELLED)
    db.execute(
        text(
            "UPDATE geo_observation_runs SET status='CANCELLED', revision=revision+1, "
            "finished_at=clock_timestamp() WHERE id=:id"
        ),
        {"id": run.id},
    )
    db.commit()
    return "CANCELLED"


def facts(api, run):
    with api.api.factory() as db:
        current = db.get(GeoObservationRun, run.id)
        answers = list(
            db.scalars(select(GeoAnswerSnapshot).where(GeoAnswerSnapshot.run_id == run.id))
        )
        submissions = list(
            db.scalars(select(GeoManualSubmission).where(GeoManualSubmission.run_id == run.id))
        )
        logs = list(db.scalars(select(AuditLog).where(AuditLog.target_id == str(run.id))))
        return current, answers, submissions, logs, db.get(GeoManualDraft, run.id)


def test_cancel_commits_before_waiting_submit(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    file_id, _ = evidence(api)
    value = GeoManualObservationSubmit.model_validate(payload(run, screenshot_file_id=str(file_id)))
    with ThreadPoolExecutor(max_workers=1) as pool, api.api.factory() as first:
        first.scalar(
            select(GeoObservationBatch)
            .where(GeoObservationBatch.id == run.batch_id)
            .with_for_update()
        )
        service._run(first, run.id, lock=True)
        holder = first.scalar(text("SELECT pg_backend_pid()"))
        future, waiter = start(
            pool,
            api,
            api.api.engineer_id,
            lambda db, actor: service.submit_manual_observation(
                db,
                run_id=run.id,
                payload=value,
                actor=actor,
                idempotency_key="cancel-first",
                request_id=str(uuid4()),
            ),
        )
        try:
            wait_for_lock(api, waiter, holder)
            assert cancel_storage_writer(first, run) == "CANCELLED"
        finally:
            first.rollback()
        error = future.result(timeout=5)
    assert (error.status_code, error.code) == (409, "INVALID_STATE_TRANSITION")
    current, answers, submissions, logs, draft = facts(api, run)
    assert (current.status, current.revision, current.collected_at) == ("CANCELLED", 1, None)
    assert current.input_snapshot == run.input_snapshot and current.finished_at is not None
    assert not answers and not submissions and not logs and draft is None
    response = submit(api, run, value.model_dump(mode="json"), key="cancel-first")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INVALID_STATE_TRANSITION"


@pytest.mark.parametrize("loser", ["cancel", "save"])
def test_submit_commits_before_waiting_cancel_or_save(plans_api, monkeypatch, loser):
    api = plans_api
    run = batch_run(api)[0]
    file_id, _ = evidence(api, owner=api.api.admin_id)
    value = GeoManualObservationSubmit.model_validate(payload(run, screenshot_file_id=str(file_id)))
    locked, release = Event(), Event()
    holder = Queue()
    original = service._lock_entry

    def pause_after_lock(db, identity):
        result = original(db, identity)
        if db.info.get("geo308_hold"):
            holder.put(db.scalar(text("SELECT pg_backend_pid()")))
            locked.set()
            assert release.wait(timeout=8), "测试未释放提交事务"
        return result

    monkeypatch.setattr(service, "_lock_entry", pause_after_lock)

    def winner(db, actor):
        db.info["geo308_hold"] = True
        return service.submit_manual_observation(
            db,
            run_id=run.id,
            payload=value,
            actor=actor,
            idempotency_key="submit-first",
            request_id=str(uuid4()),
        )

    def contender(db, actor):
        if loser == "cancel":
            try:
                return cancel_storage_writer(db, run)
            except AppError:
                db.rollback()
                raise
        return service.save_manual_draft(
            db,
            run_id=run.id,
            actor=actor,
            payload=GeoManualDraftSave(
                expected_draft_revision=0, draft={"answer_text": "迟到草稿"}
            ),
            request_id=str(uuid4()),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        winning, _ = start(pool, api, api.api.admin_id, winner)
        try:
            assert locked.wait(timeout=5)
            losing, waiter = start(pool, api, api.api.engineer_id, contender)
            wait_for_lock(api, waiter, holder.get(timeout=5))
        finally:
            release.set()
        receipt, error = winning.result(timeout=5), losing.result(timeout=5)
    assert (error.status_code, error.code) == (
        409,
        "GEO_RUN_ALREADY_STARTED" if loser == "cancel" else "INVALID_STATE_TRANSITION",
    )
    current, answers, submissions, logs, draft = facts(api, run)
    assert (current.status, current.revision) == ("COLLECTED", 1)
    assert current.finished_at is None and current.input_snapshot == run.input_snapshot
    assert len(answers) == len(submissions) == len(logs) == 1 and draft is None
    assert (
        answers[0].answer_text == value.answer_text and answers[0].id == receipt.answer_snapshot_id
    )
    assert submissions[0].run_revision == receipt.run_revision
    assert logs[0].action == "geo_manual_observation.submitted"


def test_saved_revision_commits_before_waiting_submit(plans_api, monkeypatch):
    api = plans_api
    run = batch_run(api)[0]
    file_id, _ = evidence(api)
    locked, release = Event(), Event()
    holder = Queue()
    original = service._lock_entry

    def pause_after_lock(db, identity):
        result = original(db, identity)
        if db.info.get("geo308_hold"):
            holder.put(db.scalar(text("SELECT pg_backend_pid()")))
            locked.set()
            assert release.wait(timeout=8)
        return result

    monkeypatch.setattr(service, "_lock_entry", pause_after_lock)

    def winner(db, actor):
        db.info["geo308_hold"] = True
        return service.save_manual_draft(
            db,
            run_id=run.id,
            actor=actor,
            payload=GeoManualDraftSave(
                expected_draft_revision=0, draft={"answer_text": "赢家草稿"}
            ),
            request_id=str(uuid4()),
        )

    value = GeoManualObservationSubmit.model_validate(payload(run, screenshot_file_id=str(file_id)))
    with ThreadPoolExecutor(max_workers=2) as pool:
        winning, _ = start(pool, api, api.api.admin_id, winner)
        try:
            assert locked.wait(timeout=5)
            losing, waiter = start(
                pool,
                api,
                api.api.engineer_id,
                lambda db, actor: service.submit_manual_observation(
                    db,
                    run_id=run.id,
                    payload=value,
                    actor=actor,
                    idempotency_key="save-first",
                    request_id=str(uuid4()),
                ),
            )
            wait_for_lock(api, waiter, holder.get(timeout=5))
        finally:
            release.set()
        saved, error = winning.result(timeout=5), losing.result(timeout=5)
    assert (error.status_code, error.code, error.details) == (
        409,
        "REVISION_CONFLICT",
        {"current_revision": 1},
    )
    current, answers, submissions, logs, draft = facts(api, run)
    assert (current.status, current.revision) == ("PENDING", 0)
    assert not answers and not submissions and len(logs) == 1
    assert logs[0].action == "geo_manual_draft.saved"
    assert draft.draft == saved.draft.model_dump(mode="json") and draft.draft_revision == 1
