"""MAN-01真实PG/HTTP取消、保留与提交竞态；对象存储仅本地开发服务。"""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from copy import deepcopy
from datetime import UTC, datetime
from queue import Queue
from threading import Event
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from app.config import settings
from app.deps import CURRENT_SESSION_ID
from app.errors import AppError
from app.main import app
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_files import FileRecord
from app.models.geo_manual_cancellation import GeoManualRunCancellation
from app.models.geo_manual_collection import GeoManualDraft
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.geo_surfaces import GeoCollectionProfile
from app.models.identity import AuditLog, SessionRecord
from app.schemas.geo_manual_cancellation import GeoManualRunCancelRequest
from app.schemas.geo_manual_collection import GeoManualObservationSubmit
from app.services import geo_manual_cancellation as service
from app.services import geo_manual_collection as manual
from app.services.file_records import file_is_referenced
from app.services.identity import _user_business_reference_counts
from tests.integration.geo_plans_support import (
    plans_api as plans_api,
)
from tests.integration.geo_plans_support import (
    questions_api as questions_api,
)
from tests.integration.geo_plans_support import (
    questions_engine as questions_engine,
)
from tests.integration.test_geo_manual_collection import (
    batch_run,
    evidence,
    payload,
    prefix,
    save,
    submit,
)
from tests.integration.test_geo_manual_races import start, wait_for_lock

pytestmark = pytest.mark.integration


def cancel(api, run, *, revision=0, draft_revision=0, reason="人工无法完成本次采样", client=None):
    return (client or api.api.engineer).post(
        prefix(run) + "/manual-cancel",
        json={
            "expected_revision": revision,
            "expected_draft_revision": draft_revision,
            "reason": reason,
        },
    )


def test_reason_history_draft_and_file_preserved_and_batch_uses_existing_statistics(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    file_id, _ = evidence(api)
    saved = save(api, run, {"answer_text": "未提交原文", "screenshot_file_id": str(file_id)}).json()
    with api.api.factory() as db:
        original = deepcopy(db.get(GeoManualDraft, run.id).draft)
    before = api.api.engineer.get(prefix(run)).json()
    assert before["cancellation"] is None and "CANCEL" in before["run"]["available_actions"]
    assert (
        "CANCEL" in api.api.engineer.get(prefix(run) + "/manual-entry").json()["available_actions"]
    )
    response = cancel(api, run, draft_revision=1, reason="  采集窗口结束，保留草稿  ")
    assert response.status_code == 200, response.text
    record = response.json()
    assert record["reason"] == "采集窗口结束，保留草稿" and record["draft_revision"] == 1
    detail = api.api.engineer.get(prefix(run)).json()
    assert detail["cancellation"] == record
    assert detail["run"]["status"] == "CANCELLED" and not detail["run"]["available_actions"]
    assert detail["batch"]["summary"]["status_counts"]["cancelled"] == 1
    assert detail["batch"]["summary"]["pending_manual_count"] == 0
    assert detail["batch"]["status"] == "CANCELLED"
    with api.api.factory() as db:
        assert db.get(GeoManualDraft, run.id).draft == original
        assert db.get(FileRecord, file_id).cleanup_after is None and file_is_referenced(db, file_id)
        assert db.get(GeoObservationRun, run.id).input_snapshot == run.input_snapshot
        assert _user_business_reference_counts(db, [api.api.engineer_id])[api.api.engineer_id] > 0
        log = db.scalar(
            select(AuditLog).where(
                AuditLog.target_id == str(run.id),
                AuditLog.action == "geo_manual_observation.cancelled",
            )
        )
        assert record["reason"] not in str(log.details)
    assert cancel(api, run, revision=1, draft_revision=1).status_code == 409
    assert save(api, run, saved["draft"], 1).status_code == 409
    assert (
        submit(api, run, payload(run, revision=1, screenshot_file_id=str(file_id))).status_code
        == 409
    )


@pytest.mark.parametrize(
    "patch,status",
    [
        ({"expected_revision": 7}, 409),
        ({"expected_draft_revision": 1}, 409),
        ({"reason": " \n\t"}, 422),
        ({"reason": "x" * 2001}, 422),
        ({"expected_revision": True}, 422),
        ({"unexpected": True}, 422),
    ],
)
def test_invalid_or_stale_requests_never_change_state(plans_api, patch, status):
    api = plans_api
    run = batch_run(api)[0]
    body = {"expected_revision": 0, "expected_draft_revision": 0, "reason": "虚构取消原因", **patch}
    response = api.api.engineer.post(prefix(run) + "/manual-cancel", json=body)
    assert response.status_code == status, response.text
    with api.api.factory() as db:
        assert db.get(GeoObservationRun, run.id).status == "PENDING"
        assert db.get(GeoManualRunCancellation, run.id) is None


def test_permissions_csrf_missing_run_and_current_session_revalidation(plans_api, monkeypatch):
    api = plans_api
    run = batch_run(api)[0]
    body = {"expected_revision": 0, "expected_draft_revision": 0, "reason": "虚构取消"}
    with TestClient(app) as anonymous:
        assert anonymous.post(prefix(run) + "/manual-cancel", json=body).status_code == 401
    assert (
        api.api.engineer.post(
            prefix(run) + "/manual-cancel", json=body, headers={"X-CSRF-Token": "x" * 32}
        ).status_code
        == 403
    )
    assert (
        api.api.engineer.post(
            f"/api/v1/geo/observation-runs/{uuid4()}/manual-cancel", json=body
        ).status_code
        == 404
    )
    original = service.current_actor_command

    @contextmanager
    def revoked_after_http(db, actor, **kwargs):
        with api.api.factory.begin() as writer:
            writer.execute(
                SessionRecord.__table__.update()
                .where(SessionRecord.id == db.info[CURRENT_SESSION_ID])
                .values(revoked_at=datetime.now(UTC))
            )
        with original(db, actor, **kwargs) as current:
            yield current

    monkeypatch.setattr(service, "current_actor_command", revoked_after_http)
    # 使用admin专门撤销本次会话，不改变其他测试共享engineer身份。
    assert cancel(api, run, client=api.api.admin).status_code == 401
    with api.api.factory() as db:
        assert db.get(GeoManualRunCancellation, run.id) is None


def test_disabled_profile_and_switch_do_not_trap_manual_pending_run(plans_api, monkeypatch):
    api = plans_api
    run = batch_run(api)[0]
    with api.api.factory.begin() as db:
        profile = db.get(GeoCollectionProfile, api.profile)
        profile.is_active = False
        profile.revision += 1
    monkeypatch.setattr(settings, "geo_monitoring_enabled", False)
    detail = api.api.engineer.get(prefix(run)).json()
    assert "CANCEL" in detail["run"]["available_actions"]
    assert "ENTER_MANUAL_OBSERVATION" not in detail["run"]["available_actions"]
    assert cancel(api, run).status_code == 200


def test_submitted_answer_and_evidence_are_never_cancelled(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    file_id, _ = evidence(api)
    answer = submit(api, run, payload(run, screenshot_file_id=str(file_id)))
    assert answer.status_code == 201, answer.text
    with api.api.factory() as db:
        row = db.get(GeoAnswerSnapshot, UUID(answer.json()["answer_snapshot_id"]))
        frozen = {c.name: deepcopy(getattr(row, c.name)) for c in row.__table__.columns}
        revision = db.get(GeoObservationRun, run.id).revision
    assert cancel(api, run, revision=revision).status_code == 409
    with api.api.factory() as db:
        row = db.get(GeoAnswerSnapshot, row.id)
        assert {c.name: getattr(row, c.name) for c in row.__table__.columns} == frozen
        assert file_is_referenced(db, file_id)
        assert db.get(GeoManualRunCancellation, run.id) is None


def test_audit_failure_rolls_back_cancellation_and_reason_without_leaking_details(
    plans_api, monkeypatch
):
    api = plans_api
    run = batch_run(api)[0]

    def fail(*args, **kwargs):
        raise RuntimeError("manual-cancel-sensitive-canary")

    monkeypatch.setattr(service, "append_audit", fail)
    with pytest.raises(RuntimeError, match="人工取消失败") as caught:
        cancel(api, run)
    import traceback

    assert "manual-cancel-sensitive-canary" not in "".join(traceback.format_exception(caught.value))
    with api.api.factory() as db:
        assert db.get(GeoObservationRun, run.id).status == "PENDING"
        assert db.get(GeoManualRunCancellation, run.id) is None
        assert db.get(GeoObservationBatch, run.batch_id).status == "QUEUED"


@pytest.mark.parametrize("winner", ["cancel", "submit"])
def test_cancel_and_submit_serialize_at_real_batch_run_lock(plans_api, monkeypatch, winner):
    api = plans_api
    run = batch_run(api)[0]
    file_id, _ = evidence(
        api, owner=api.api.admin_id if winner == "submit" else api.api.engineer_id
    )
    cancel_payload = GeoManualRunCancelRequest(
        expected_revision=0, expected_draft_revision=0, reason="并发取消原因"
    )
    submit_payload = GeoManualObservationSubmit.model_validate(
        payload(run, screenshot_file_id=str(file_id))
    )
    entered, release = Event(), Event()
    holder = Queue()
    target, name = (service, "lock_run") if winner == "cancel" else (manual, "_lock_entry")
    original = getattr(target, name)

    def hold(db, identity):
        result = original(db, identity)
        if db.info.get("man01_hold"):
            holder.put(db.scalar(text("SELECT pg_backend_pid()")))
            entered.set()
            assert release.wait(10)
        return result

    monkeypatch.setattr(target, name, hold)

    def operation(which, hold_first=False):
        def invoke(db, actor):
            db.info["man01_hold"] = hold_first
            if which == "cancel":
                return service.cancel_manual_run(
                    db, run_id=run.id, payload=cancel_payload, actor=actor, request_id="man01-race"
                )
            return manual.submit_manual_observation(
                db,
                run_id=run.id,
                payload=submit_payload,
                actor=actor,
                idempotency_key="man01-race",
                request_id="man01-race",
            )

        return invoke

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, _ = start(pool, api, api.api.admin_id, operation(winner, True))
        assert entered.wait(10)
        other = "submit" if winner == "cancel" else "cancel"
        second, waiter = start(pool, api, api.api.engineer_id, operation(other))
        try:
            wait_for_lock(api, waiter, holder.get(timeout=5))
        finally:
            release.set()
        assert not isinstance(first.result(timeout=15), AppError)
        assert isinstance(second.result(timeout=15), AppError)
    with api.api.factory() as db:
        assert db.get(GeoObservationRun, run.id).status == (
            "CANCELLED" if winner == "cancel" else "COLLECTED"
        )
        assert (db.get(GeoManualRunCancellation, run.id) is not None) == (winner == "cancel")
        assert db.scalar(
            select(func.count())
            .select_from(GeoAnswerSnapshot)
            .where(GeoAnswerSnapshot.run_id == run.id)
        ) == (0 if winner == "cancel" else 1)


def test_database_cancellation_record_is_mandatory_matching_and_immutable(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    with api.api.factory() as db:
        db.execute(
            text(
                "UPDATE geo_observation_runs SET status='CANCELLED', revision=revision+1, "
                "finished_at=clock_timestamp() WHERE id=:id"
            ),
            {"id": run.id},
        )
        with pytest.raises(DBAPIError) as caught:
            db.commit()
        assert caught.value.orig.sqlstate == "23514"
        db.rollback()
    assert cancel(api, run).status_code == 200
    with api.api.factory() as db:
        for sql in [
            "UPDATE geo_manual_run_cancellations SET reason=reason",
            "DELETE FROM geo_manual_run_cancellations",
            "TRUNCATE geo_manual_run_cancellations",
        ]:
            with pytest.raises(DBAPIError) as caught:
                db.execute(text(sql))
            assert caught.value.orig.sqlstate == "55000"
            db.rollback()
