"""严格复制、差异、真实HTTP幂等/CAS及有界并发，不使用真实Provider。"""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, select

from app.models.geo_opportunities import GeoOpportunity
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.geo_retests import GeoRetestBaseline
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.geo_surfaces import GeoCollectionProfile
from app.models.identity import AuditLog, User
from app.schemas.geo_retests import GeoRetestRequest as Request
from app.services import geo_retests
from tests.integration.geo_retests_support import (
    PATH,
    counts,
    plans_api,
    post,
    preview,
    questions_api,
    questions_engine,
    retest_case,
)

pytestmark = pytest.mark.integration
__all__ = ["plans_api", "questions_api", "questions_engine", "retest_case"]


def test_freezes_exact_matrix_rules_sources_and_replays_original_receipt(retest_case):
    case = retest_case
    before = counts(case)
    read = preview(case)
    assert read.status_code == 200, read.text
    snapshot = read.json()["snapshot"]
    assert read.json()["comparable"] is True and len(snapshot["cells"]) == 2
    assert counts(case) == before  # 预览不保存基线
    key = str(uuid4())
    first = post(case, key)
    assert first.status_code == 201, first.text
    receipt = first.json()
    after = counts(case)
    assert after == tuple(a + b for a, b in zip(before, (1, 1, 1, 2), strict=True))
    with case[0].api.factory() as db:
        baseline = db.get(GeoRetestBaseline, UUID(receipt["baseline_id"]))
        batch = db.get(GeoObservationBatch, UUID(receipt["batch_id"]))
        opportunity = db.get(GeoOpportunity, case[1])
        assert baseline.snapshot == snapshot
        assert batch.trigger_type == "RETEST" and batch.baseline_batch_id == case[2]
        assert batch.source_opportunity_id == case[1] and batch.status == "QUEUED"
        assert (
            batch.plan_snapshot == snapshot["plan_snapshot"]
            and batch.rule_snapshot == snapshot["rule_snapshot"]
        )
        roots = list(
            db.scalars(
                select(GeoObservationRun)
                .where(GeoObservationRun.batch_id == batch.id)
                .order_by(GeoObservationRun.repeat_index)
            )
        )
        assert [r.input_snapshot for r in roots] == [c["input_snapshot"] for c in snapshot["cells"]]
        assert [r.repeat_index for r in roots] == [1, 2]
        assert all(
            r.attempt_no == 1 and r.previous_attempt_id is None and r.status == "PENDING"
            for r in roots
        )
        assert opportunity.status == "IN_PROGRESS" and opportunity.revision == 4
        assert (
            len(
                list(
                    db.scalars(
                        select(AuditLog).where(
                            AuditLog.action == "geo.retest.created",
                            AuditLog.target_id == str(case[1]),
                        )
                    )
                )
            )
            == 1
        )
    with case[0].api.factory.begin() as db:
        profile = db.get(GeoCollectionProfile, case[0].profile)
        profile.is_active = False
        profile.revision += 1
    replay = post(case, key)
    assert replay.status_code == 201, replay.text
    assert replay.json() == receipt | {"replayed": True}
    assert counts(case) == after
    changed = post(case, key, case[3] | {"expected_revision": 4})
    assert changed.status_code == 409 and changed.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    stale = post(case)
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "REVISION_CONFLICT"


@pytest.mark.parametrize(
    "model,attribute,value,code",
    [
        (GeoCollectionProfile, "is_active", False, "PROFILE_UNAVAILABLE"),
        (GeoCollectionProfile, "language_code", "en", "PROFILE_CHANGED"),
        (GeoPromptVariant, "is_active", False, "VARIANT_UNAVAILABLE"),
    ],
)
def test_unavailable_or_changed_configuration_never_replaces_snapshot(
    retest_case, model, attribute, value, code
):
    case = retest_case
    identity = case[0].profile if model is GeoCollectionProfile else case[0].prompt
    with case[0].api.factory.begin() as db:
        row = db.get(model, identity)
        setattr(row, attribute, value)
        row.revision += 1
    before = counts(case)
    read = preview(case)
    assert read.status_code == 200, read.text
    assert read.json()["comparable"] is False
    assert code in {d["code"] for d in read.json()["differences"]}
    response = post(case)
    assert (
        response.status_code == 409
        and response.json()["error"]["code"] == "GEO_RETEST_NOT_COMPARABLE"
    )
    assert response.json()["error"]["details"]["requires_new_baseline"] is True
    assert counts(case) == before


@pytest.mark.parametrize(
    "version,code", [("fixture-v2", "MODEL_VERSION_CHANGED"), (None, "MODEL_VERSION_UNKNOWN")]
)
def test_latest_observed_model_version_change_or_unknown_blocks(retest_case, version, code):
    from datetime import UTC, datetime, timedelta

    from app.models.geo_answers import GeoAnswerSnapshot
    from app.models.geo_batch_creation import GeoBatchSubject

    case = retest_case
    with case[0].api.factory.begin() as db:
        original = db.get(GeoObservationBatch, case[2])
        root = db.scalar(select(GeoObservationRun).where(GeoObservationRun.batch_id == original.id))
        batch = GeoObservationBatch(
            id=uuid4(),
            trigger_type="MANUAL",
            plan_id=original.plan_id,
            created_by=case[0].api.engineer_id,
            requested_run_count=2,
            plan_snapshot=deepcopy(original.plan_snapshot),
            rule_snapshot=deepcopy(original.rule_snapshot),
        )
        db.add(batch)
        db.flush()
        db.add(GeoBatchSubject(batch_id=batch.id, subject_id=case[0].subject, role="PRIMARY"))
        db.flush()
        for repeat in (1, 2):
            run = GeoObservationRun(
                batch_id=batch.id,
                prompt_variant_id=root.prompt_variant_id,
                collection_profile_id=root.collection_profile_id,
                repeat_index=repeat,
                input_snapshot=deepcopy(root.input_snapshot),
            )
            db.add(run)
            db.flush()
            collected_at = datetime.now(UTC) + timedelta(seconds=1)
            db.add(
                GeoAnswerSnapshot(
                    run_id=run.id,
                    prompt_text=root.input_snapshot["prompt"]["prompt_text"],
                    answer_text="新版本虚构回答",
                    answer_format="TEXT",
                    source_model="fixture-model",
                    source_version=version,
                    raw_payload_summary={
                        "schema_version": 1,
                        "payload_format": None,
                        "payload_bytes": None,
                        "finish_reason": None,
                    },
                    citation_count=0,
                    collected_at=collected_at,
                )
            )
            run.status = "COLLECTED"
            run.collected_at = collected_at
            run.started_at = collected_at
            run.revision += 1
    before = counts(case)
    read = preview(case)
    assert read.status_code == 200, read.text
    assert code in {d["code"] for d in read.json()["differences"]}
    assert post(case).status_code == 409
    assert counts(case) == before


def test_http_permission_csrf_validation_and_revision(retest_case):
    case = retest_case
    api = case[0].api
    path = f"{PATH}/{case[1]}/retest"
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as anonymous:
        assert anonymous.post(path, json=case[3]).status_code == 401
    assert (
        api.engineer.post(
            path,
            json=case[3],
            headers={
                "X-CSRF-Token": "wrong-token-must-be-at-least-32-bytes",
                "Idempotency-Key": str(uuid4()),
            },
        ).status_code
        == 403
    )
    assert api.engineer.post(path, json=case[3]).status_code == 422
    assert post(case, payload=case[3] | {"snapshot": {}}).status_code == 422
    assert (
        post(case, payload=case[3] | {"expected_revision": 2}).json()["error"]["code"]
        == "REVISION_CONFLICT"
    )


@pytest.mark.parametrize("same_key", [True, False])
def test_concurrent_retests_create_exactly_one_matrix(retest_case, same_key):
    case = retest_case
    barrier = Barrier(2)
    key = str(uuid4())
    before = counts(case)

    def invoke(index):
        from app.errors import AppError

        with case[0].api.factory() as db:
            actor = db.get(User, case[0].api.engineer_id)
            barrier.wait(timeout=10)
            try:
                return geo_retests.create_retest(
                    db,
                    case[1],
                    Request.model_validate(case[3]),
                    actor=actor,
                    request_id=str(uuid4()),
                    idempotency_key=key if same_key else f"{key}-{index}",
                )
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(invoke, (0, 1)))
    if same_key:
        assert results[0].batch_id == results[1].batch_id
        assert {r.replayed for r in results} == {True, False}
    else:
        assert sum(r == "REVISION_CONFLICT" for r in results) == 1
    assert counts(case) == tuple(a + b for a, b in zip(before, (1, 1, 1, 2), strict=True))


@pytest.mark.parametrize("failure", ["audit", "commit"])
def test_failure_rolls_back_baseline_matrix_receipt_and_revision(retest_case, monkeypatch, failure):
    case = retest_case
    before = counts(case)

    def reject(*_args, **_kwargs):
        raise RuntimeError("虚构原子失败")

    if failure == "audit":
        monkeypatch.setattr(geo_retests, "append_audit", reject)
    with case[0].api.factory() as db:
        actor = db.get(User, case[0].api.engineer_id)
        if failure == "commit":
            monkeypatch.setattr(db, "commit", reject)
        with pytest.raises(RuntimeError, match="虚构原子失败"):
            geo_retests.create_retest(
                db,
                case[1],
                Request.model_validate(case[3]),
                actor=actor,
                request_id=str(uuid4()),
                idempotency_key=str(uuid4()),
            )
        assert db.get(GeoOpportunity, case[1]).revision == 3
    assert counts(case) == before


def test_preview_is_repeatable_read_without_writes_or_locks(retest_case):
    case = retest_case
    statements = []
    levels = []

    def capture(conn, _cursor, statement, _params, _context, _many):
        statements.append(statement)
        levels.append(conn.get_isolation_level())

    event.listen(case[0].api.engine, "before_cursor_execute", capture)
    try:
        assert preview(case).status_code == 200
    finally:
        event.remove(case[0].api.engine, "before_cursor_execute", capture)
    assert all(s.lstrip().startswith("SELECT") and "FOR UPDATE" not in s for s in statements)
    assert all(level == "REPEATABLE READ" for level in levels)


def test_fresh_request_reuses_frozen_baseline_after_current_plan_changes(retest_case):
    case = retest_case
    original = preview(case).json()["snapshot"]
    first = post(case)
    assert first.status_code == 201, first.text
    # 当前计划可继续演进；严格复测始终由原批次决定矩阵。
    plan_path = f"/api/v1/geo/monitoring-plans/{original['plan_snapshot']['plan_id']}"
    current = case[0].api.engineer.get(plan_path)
    assert current.status_code == 200, current.text
    result = case[0].api.engineer.patch(
        plan_path,
        json=case[0].payload(expected_revision=current.json()["revision"], repeat_count=3),
    )
    assert result.status_code == 200, result.text
    before = counts(case)
    second = post(case, payload=case[3] | {"expected_revision": 4})
    assert second.status_code == 201, second.text
    assert second.json()["baseline_id"] == first.json()["baseline_id"]
    assert second.json()["batch_id"] != first.json()["batch_id"]
    assert second.json()["requested_run_count"] == 2
    assert second.json()["opportunity_revision"] == 5
    assert counts(case) == tuple(a + b for a, b in zip(before, (0, 1, 1, 2), strict=True))
    with case[0].api.factory() as db:
        batch = db.get(GeoObservationBatch, UUID(second.json()["batch_id"]))
        assert batch.plan_snapshot == original["plan_snapshot"]
        assert batch.rule_snapshot == original["rule_snapshot"]
        assert db.get(GeoRetestBaseline, UUID(second.json()["baseline_id"])).snapshot == original


@pytest.mark.parametrize("saved_baseline", [False, True])
def test_retest_and_source_review_do_not_form_foreign_key_lock_cycle(
    retest_case, monkeypatch, saved_baseline
):
    import time
    from threading import Event

    from sqlalchemy import text

    from app.models.geo_analysis import GeoAnalysisRevision
    from app.models.geo_answers import GeoAnswerSnapshot
    from app.schemas.geo_reviews import GeoRunReviewRequest
    from app.services import geo_reviews
    from tests.unit.test_geo_analysis_contract import analysis_input

    case = retest_case
    with case[0].api.factory.begin() as db:
        run = db.scalar(select(GeoObservationRun).where(GeoObservationRun.batch_id == case[2]))
        answer = db.scalar(select(GeoAnswerSnapshot).where(GeoAnswerSnapshot.run_id == run.id))
        frozen = analysis_input() | {
            "answer_sha256": answer.answer_sha256,
            "subjects": deepcopy(run.input_snapshot["subjects"]),
        }
        analysis = GeoAnalysisRevision(
            run_id=run.id,
            answer_snapshot_id=answer.id,
            revision=1,
            analyzer_type="DETERMINISTIC",
            analyzer_version="fixture-v1",
            input_snapshot=frozen,
        )
        db.add(analysis)
        db.flush()
        db.execute(
            text(
                "UPDATE geo_analysis_revisions SET status='COMPLETED',"
                "finished_at=clock_timestamp() WHERE id=:id"
            ),
            {"id": analysis.id},
        )
        run.current_analysis_revision_id = analysis.id
        run.revision += 1
        db.flush()
        run_id, analysis_id, run_revision = run.id, analysis.id, run.revision
    command = case[3]
    if saved_baseline:
        first = post(case)
        assert first.status_code == 201, first.text
        command = command | {"expected_revision": first.json()["opportunity_revision"]}
    held, resources, release = Event(), Event(), Event()
    original_run_lock, original_resources = geo_reviews.lock_run, geo_retests.lock_resources
    planner_pid = []

    def hold_source(db, identity):
        result = original_run_lock(db, identity)
        held.set()
        assert release.wait(6)
        return result

    def observe_resources(db, values, **kwargs):
        original_resources(db, values, **kwargs)
        resources.set()

    monkeypatch.setattr(geo_reviews, "lock_run", hold_source)
    monkeypatch.setattr(geo_retests, "lock_resources", observe_resources)

    def review_source():
        with case[0].api.factory() as db:
            actor = db.get(User, case[0].api.admin_id)
            db.execute(text("SET LOCAL lock_timeout='6s'"))
            return geo_reviews.review_run(
                db,
                run_id=run_id,
                payload=GeoRunReviewRequest(
                    analysis_revision_id=analysis_id,
                    expected_run_revision=run_revision,
                    decision="CONFIRMED",
                    correction_payload=None,
                    comment="虚构并发复核",
                ),
                actor=actor,
                request_id="geo705-review-race",
            )

    def retest():
        with case[0].api.factory() as db:
            actor = db.get(User, case[0].api.engineer_id)
            db.execute(text("SET LOCAL lock_timeout='6s'"))
            planner_pid.append(db.scalar(select(text("pg_backend_pid()"))))
            return geo_retests.create_retest(
                db,
                case[1],
                Request.model_validate(command),
                actor=actor,
                request_id="geo705-retest-race",
                idempotency_key=str(uuid4()),
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        review_future = pool.submit(review_source)
        assert held.wait(4)
        retest_future = pool.submit(retest)
        try:
            assert resources.wait(4)
            # 明确证明Planner已等待来源Batch的隐式FK锁，再放行复核的第二次Run写。
            deadline = time.monotonic() + 4
            with case[0].api.factory() as observer:
                while time.monotonic() < deadline:
                    observer.execute(text("SELECT pg_stat_clear_snapshot()"))
                    waiting = observer.scalar(
                        text("SELECT wait_event_type FROM pg_stat_activity WHERE pid=:pid"),
                        {"pid": planner_pid[0]},
                    )
                    if waiting == "Lock":
                        break
                    time.sleep(0.01)
                else:
                    pytest.fail("Planner没有进入来源Batch的预期锁等待")
        finally:
            release.set()
        assert review_future.result(timeout=8).run_revision == run_revision + 1
        assert retest_future.result(timeout=8).requested_run_count == 2
    assert preview(case).json()["snapshot"]["trigger_snapshot"]["sources"][0]["review_id"] is None
