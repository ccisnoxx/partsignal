"""真实 PostgreSQL、真实会话及本地 OSS 的人工冻结与故障原子性。"""

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.errors import AppError
from app.models.geo_answers import GeoAnswerCitation, GeoAnswerSnapshot
from app.models.geo_files import FileRecord
from app.models.geo_manual_collection import GeoManualDraft, GeoManualSubmission
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.identity import AuditLog, User
from app.schemas.geo_manual_collection import GeoManualDraftSave, GeoManualObservationSubmit
from app.services import geo_manual_collection as service
from app.services.file_records import _claim_file_cleanup, file_is_referenced
from app.services.storage import DevelopmentEvidenceStorage
from tests.integration.geo_plans_support import PlansAPI
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine

pytestmark = pytest.mark.integration
__all__ = ["plans_api", "questions_api", "questions_engine"]


def batch_run(api: PlansAPI, *, screenshot=True, repeats=1):
    with api.api.factory() as db:
        db.execute(
            text(
                "UPDATE geo_collection_profiles SET settings_json=:settings, "
                "revision=revision+1 WHERE id=:id"
            ),
            {
                "settings": json.dumps({"require_screenshot": screenshot}),
                "id": api.profile,
            },
        )
        db.commit()
    result = api.api.engineer.post(
        "/api/v1/geo/observation-batches",
        json={"source": "AD_HOC", "configuration": api.payload(repeat_count=repeats)},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert result.status_code == 201, result.text
    with api.api.factory() as db:
        runs = list(
            db.scalars(
                select(GeoObservationRun)
                .where(GeoObservationRun.batch_id == UUID(result.json()["batch_id"]))
                .order_by(GeoObservationRun.repeat_index)
            )
        )
        return runs


def evidence(api: PlansAPI, *, screenshot=True, owner=None, access="INTERNAL"):
    data = b"fixture-redacted-screenshot" if screenshot else b"fixture-redacted-answer"
    key = f"geo305/{uuid4()}"
    digest = hashlib.sha256(data).hexdigest()
    kind = "image/png" if screenshot else "text/plain"
    storage = DevelopmentEvidenceStorage()
    storage.put(key, data, content_type=kind, sha256=digest)
    with api.api.factory() as db:
        f = FileRecord(
            category="OPERATION_SCREENSHOT" if screenshot else "EVIDENCE",
            original_filename="fixture.png" if screenshot else "fixture.txt",
            object_key=key,
            content_type=kind,
            size=len(data),
            sha256=digest,
            access_level=access,
            status="VERIFIED",
            uploader_id=owner or api.api.engineer_id,
            upload_expires_at=datetime.now(UTC) + timedelta(hours=1),
            verified_at=datetime.now(UTC),
            cleanup_after=datetime.now(UTC) + timedelta(days=1),
        )
        db.add(f)
        db.commit()
        return f.id, key


def prefix(run):
    return f"/api/v1/geo/observation-runs/{run.id}"


def payload(run, *, revision=0, **values):
    return {
        "expected_draft_revision": revision,
        "answer_text": "  虚构原始回答\n",
        "answer_format": "MARKDOWN",
        "collected_at": datetime.now(UTC).isoformat(),
        **values,
    }


def submit(api, run, value, key="submit"):
    return api.api.engineer.post(
        prefix(run) + "/manual-submit", json=value, headers={"Idempotency-Key": key}
    )


def save(api, run, draft, revision=0):
    return api.api.engineer.put(
        prefix(run) + "/manual-draft", json={"expected_draft_revision": revision, "draft": draft}
    )


def assert_pending(api, run, *, revision=0):
    with api.api.factory() as db:
        assert db.get(GeoObservationRun, run.id).status == "PENDING"
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoAnswerSnapshot)
                .where(GeoAnswerSnapshot.run_id == run.id)
            )
            == 0
        )
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoManualSubmission)
                .where(GeoManualSubmission.run_id == run.id)
            )
            == 0
        )
        draft = db.get(GeoManualDraft, run.id)
        assert (draft.draft_revision if draft else 0) == revision


def test_entry_draft_revision_noop_conflict_and_file_retention(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    context = api.api.engineer.get(prefix(run) + "/manual-entry")
    assert context.status_code == 200, context.text
    assert context.json()["draft_revision"] == 0 and context.json()["draft"] is None
    assert context.json()["available_actions"] == ["ENTER_MANUAL_OBSERVATION"]
    f, _ = evidence(api)
    result = save(api, run, {"answer_text": "半成品", "screenshot_file_id": str(f)})
    assert result.status_code == 200, result.text
    assert result.json()["draft_revision"] == 1
    noop = save(api, run, result.json()["draft"], 1)
    assert noop.json() == result.json()
    conflict = save(api, run, {"answer_text": "过期"}, 0)
    assert conflict.status_code == 409 and conflict.json()["error"]["code"] == "REVISION_CONFLICT"
    with api.api.factory() as db:
        assert file_is_referenced(db, f)
        assert db.get(FileRecord, f).cleanup_after is None
        db.execute(text("UPDATE file_records SET cleanup_after=now() WHERE id=:id"), {"id": f})
        assert f not in {
            x for x, _ in _claim_file_cleanup(db, now=datetime.now(UTC), batch_size=10000)
        }
        db.rollback()
    removed = save(api, run, {"answer_text": "修订"}, 1)
    assert removed.json()["draft_revision"] == 2
    with api.api.factory() as db:
        assert db.get(FileRecord, f).cleanup_after > datetime.now(UTC) + timedelta(days=6)
        assert not file_is_referenced(db, f)
        assert db.get(GeoObservationRun, run.id).revision == 0


def test_submit_freezes_all_once_replay_and_no_analysis(plans_api, monkeypatch):
    api = plans_api
    run = batch_run(api)[0]
    f, _ = evidence(api)
    raw, _ = evidence(api, screenshot=False)
    assert save(api, run, {"answer_text": "旧草稿"}).status_code == 200
    value = payload(
        run,
        revision=1,
        screenshot_file_id=str(f),
        raw_payload_file_id=str(raw),
        citations=[
            {"original_url": "https://EXAMPLE.test/a#x", "position": 2, "title": "后出现"},
            {"original_url": "https://example.test/a", "position": 1, "title": "首次"},
        ],
    )
    result = submit(api, run, value)
    assert result.status_code == 201, result.text
    receipt = result.json()
    assert receipt["analysis_dispatch"] == "NOT_IMPLEMENTED"
    with api.api.factory() as db:
        answer = db.get(GeoAnswerSnapshot, UUID(receipt["answer_snapshot_id"]))
        assert (
            answer.answer_text == value["answer_text"]
            and answer.prompt_text == run.input_snapshot["prompt"]["prompt_text"]
        )
        assert answer.answer_sha256 == hashlib.sha256(value["answer_text"].encode()).hexdigest()
        citations = list(
            db.scalars(
                select(GeoAnswerCitation).where(GeoAnswerCitation.answer_snapshot_id == answer.id)
            )
        )
        assert (
            len(citations) == 1
            and citations[0].occurrences == [1, 2]
            and citations[0].title == "首次"
        )
        state = db.get(GeoObservationRun, run.id)
        batch = db.get(GeoObservationBatch, run.batch_id)
        assert (
            state.status == "COLLECTED"
            and state.revision == 1
            and state.external_call_state == "NOT_STARTED"
        )
        assert state.dispatch_attempt_count == 0 and state.lease_token is None
        assert batch.status == "RUNNING" and batch.revision == 2 and batch.finished_at is None
        assert db.get(GeoManualDraft, run.id) is None
        assert file_is_referenced(db, f) and file_is_referenced(db, raw)
        logs = list(db.scalars(select(AuditLog).where(AuditLog.target_id == str(run.id))))
        assert len(logs) == 2 and all("answer_text" not in str(log.details) for log in logs)
    monkeypatch.setattr(settings, "geo_monitoring_enabled", False)
    assert submit(api, run, value).json() == receipt
    changed = submit(api, run, {**value, "answer_text": "不同"})
    assert changed.status_code == 409 and changed.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert submit(api, run, value, key="other").status_code == 409
    assert save(api, run, {"answer_text": "覆盖"}, 1).status_code == 409
    assert api.api.engineer.get(prefix(run) + "/manual-entry").status_code == 409


@pytest.mark.parametrize(
    "case,code",
    [
        ("empty", "GEO_ANSWER_EMPTY"),
        ("no_evidence", "GEO_EVIDENCE_REQUIRED"),
        ("raw_only", "GEO_SCREENSHOT_REQUIRED"),
        ("missing", "FILE_INTEGRITY_FAILED"),
        ("owner", "PERMISSION_DENIED"),
        ("public", "FILE_INTEGRITY_FAILED"),
        ("future", "VALIDATION_ERROR"),
        ("before", "VALIDATION_ERROR"),
        ("revision", "REVISION_CONFLICT"),
        ("object_missing", "FILE_INTEGRITY_FAILED"),
        ("object_changed", "FILE_INTEGRITY_FAILED"),
        ("storage", "DEPENDENCY_UNAVAILABLE"),
    ],
)
def test_submit_failure_is_atomic(plans_api, monkeypatch, case, code):
    api = plans_api
    run = batch_run(api)[0]
    f, key = evidence(
        api,
        screenshot=case != "raw_only",
        owner=api.api.admin_id if case == "owner" else None,
        access="PUBLIC" if case == "public" else "INTERNAL",
    )
    value = payload(run, screenshot_file_id=str(f))
    if case == "empty":
        value["answer_text"] = " \n "
    elif case == "no_evidence":
        value.pop("screenshot_file_id")
    elif case == "raw_only":
        value["raw_payload_file_id"] = value.pop("screenshot_file_id")
    elif case == "missing":
        value["screenshot_file_id"] = str(uuid4())
    elif case == "future":
        value["collected_at"] = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    elif case == "before":
        value["collected_at"] = (run.created_at - timedelta(seconds=1)).isoformat()
    elif case == "revision":
        value["expected_draft_revision"] = 1
    elif case == "object_missing":
        DevelopmentEvidenceStorage().delete(key)
    elif case == "object_changed":
        d = b"changed"
        DevelopmentEvidenceStorage().put(
            key, d, content_type="image/png", sha256=hashlib.sha256(d).hexdigest()
        )
    elif case == "storage":
        monkeypatch.setattr(settings, "development_storage_internal_url", "http://127.0.0.1:1")
    result = submit(api, run, value)
    assert result.status_code in (403, 409, 422, 503), result.text
    assert result.json()["error"]["code"] == code, result.text
    assert_pending(api, run)


def test_optional_screenshot_still_requires_evidence_and_submission_can_include_unsaved_edits(
    plans_api,
):
    api = plans_api
    run = batch_run(api, screenshot=False)[0]
    f, _ = evidence(api, screenshot=False)
    assert save(api, run, {"answer_text": "未完成"}).status_code == 200
    value = payload(run, revision=1, raw_payload_file_id=str(f))
    assert submit(api, run, value).status_code == 201


def test_disabled_configuration_is_readable_but_not_writable(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    assert save(api, run, {"answer_text": "先保存"}).status_code == 200
    with api.api.factory() as db:
        db.execute(
            text(
                "UPDATE geo_collection_profiles SET is_active=false, "
                "revision=revision+1 WHERE id=:id"
            ),
            {"id": api.profile},
        )
        db.commit()
    context = api.api.engineer.get(prefix(run) + "/manual-entry")
    assert context.status_code == 200 and context.json()["draft_revision"] == 1
    assert context.json()["available_actions"] == [] and context.json()["collection_blockers"]
    assert save(api, run, {"answer_text": "禁止"}, 1).status_code == 422


def test_audit_failure_rolls_back_freeze_and_preserves_draft(plans_api, monkeypatch):
    api = plans_api
    run = batch_run(api)[0]
    f, _ = evidence(api)
    assert (
        save(api, run, {"answer_text": "必须保留", "screenshot_file_id": str(f)}).status_code == 200
    )

    def fail(*args, **kwargs):
        raise RuntimeError("fixture failure")

    monkeypatch.setattr(service, "append_audit", fail)
    with api.api.factory() as db, pytest.raises(RuntimeError, match="fixture failure"):
        service.submit_manual_observation(
            db,
            run_id=run.id,
            actor=db.get(User, api.api.engineer_id),
            payload=GeoManualObservationSubmit.model_validate(
                payload(run, revision=1, screenshot_file_id=str(f))
            ),
            idempotency_key="audit-failure",
            request_id=str(uuid4()),
        )
    assert_pending(api, run, revision=1)


@pytest.mark.parametrize("same_key", [True, False])
def test_concurrent_submit_is_exactly_once(plans_api, same_key):
    api = plans_api
    run = batch_run(api)[0]
    f, _ = evidence(api)
    value = GeoManualObservationSubmit.model_validate(payload(run, screenshot_file_id=str(f)))
    gate = Barrier(2)

    def invoke(i):
        with api.api.factory() as db:
            actor = db.get(User, api.api.engineer_id)
            gate.wait(timeout=10)
            try:
                return service.submit_manual_observation(
                    db,
                    run_id=run.id,
                    payload=value,
                    actor=actor,
                    idempotency_key="same" if same_key else f"key-{i}",
                    request_id=str(uuid4()),
                ).model_dump(mode="json")
            except AppError as e:
                return e.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(invoke, range(2)))
    if same_key:
        assert results[0] == results[1]
    else:
        assert (
            sum(isinstance(r, dict) for r in results) == 1 and "INVALID_STATE_TRANSITION" in results
        )
    with api.api.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoAnswerSnapshot)
                .where(GeoAnswerSnapshot.run_id == run.id)
            )
            == 1
        )
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoManualSubmission)
                .where(GeoManualSubmission.run_id == run.id)
            )
            == 1
        )
        assert db.get(GeoObservationRun, run.id).revision == 1


def test_concurrent_draft_conflict(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    gate = Barrier(2)

    def invoke(i):
        with api.api.factory() as db:
            actor = db.get(User, api.api.engineer_id)
            gate.wait(timeout=10)
            try:
                return service.save_manual_draft(
                    db,
                    run_id=run.id,
                    payload=GeoManualDraftSave.model_validate(
                        {"expected_draft_revision": 0, "draft": {"answer_text": str(i)}}
                    ),
                    actor=actor,
                    request_id=str(uuid4()),
                ).draft_revision
            except AppError as e:
                return e.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(invoke, range(2)))
    assert sorted(results, key=str) == [1, "REVISION_CONFLICT"]


def test_sql_final_facts_are_immutable(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    f, _ = evidence(api)
    result = submit(api, run, payload(run, screenshot_file_id=str(f)))
    assert result.status_code == 201, result.text
    for statement in [
        "UPDATE geo_manual_submissions SET draft_revision=99 WHERE run_id=:id",
        "DELETE FROM geo_manual_submissions WHERE run_id=:id",
        "UPDATE geo_answer_snapshots SET answer_text='改历史' WHERE run_id=:id",
        "DELETE FROM geo_answer_snapshots WHERE run_id=:id",
    ]:
        with api.api.factory() as db, pytest.raises(IntegrityError):
            db.execute(text(statement), {"id": run.id})
