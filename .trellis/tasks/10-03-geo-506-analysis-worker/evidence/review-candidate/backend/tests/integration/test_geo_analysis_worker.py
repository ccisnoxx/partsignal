"""真实 PostgreSQL/Redis/Celery：失败、重复、迟到与 revision 生命周期。"""

import base64
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from celery.contrib.testing.worker import start_worker
from redis import Redis
from sqlalchemy import event, func, select
from sqlalchemy.exc import DBAPIError

from app.config import settings
from app.errors import AppError
from app.models.geo_analysis import (
    GeoAnalysisFactVersion,
    GeoAnalysisRevision,
    GeoClaimAssessment,
    GeoEntityMention,
    GeoRecommendation,
)
from app.models.geo_analysis_worker import GeoAnalysisJob, GeoCitationClassification
from app.models.geo_answers import GeoAnswerCitation, GeoAnswerSnapshot
from app.models.geo_runs import GeoObservationBatch
from app.models.identity import AuditLog, User
from app.services import geo_analysis_dispatch as dispatch
from app.services import geo_analysis_execution as execution
from app.services import geo_analysis_runs as runs
from app.services import geo_reanalysis
from app.worker import analyze_geo_revision, analyze_geo_run, celery_app
from tests.integration.geo_analysis_worker_support import analysis_engine as analysis_engine
from tests.integration.geo_analysis_worker_support import answer_database as answer_database
from tests.integration.geo_analysis_worker_support import harness as harness
from tests.integration.geo_analysis_worker_support import plan_database as plan_database
from tests.integration.geo_analysis_worker_support import run_database as run_database

pytestmark = pytest.mark.integration


def count(harness, model, identity):
    with harness.factory() as db:
        return db.scalar(
            select(func.count()).select_from(model).where(model.analysis_revision_id == identity)
        )


def test_first_success_atomic_snapshot_citations_and_batch(harness):
    case = harness.create(answer_text="虚构的测试资料。", citation_urls=("https://example.com/a",))
    identity = runs.prepare_collected_run(case.run_id)
    assert runs.prepare_collected_run(case.run_id) == identity
    lease = runs.claim_analysis_revision(identity)
    assert lease is not None and harness.run(case.run_id).status == "ANALYZING"
    assert runs.claim_analysis_revision(identity) is None
    assert runs.submit_analysis_result(lease, harness.result(identity))
    state = harness.run(case.run_id)
    assert state.status == "COMPLETED" and state.current_analysis_revision_id == identity
    assert state.lease_token is None and state.external_call_state == "NOT_STARTED"
    assert harness.analysis(identity).status == "COMPLETED"
    assert count(harness, GeoCitationClassification, identity) == 1
    with harness.factory() as db:
        assert db.get(GeoObservationBatch, state.batch_id).status == "COMPLETED"
        answer = db.get(GeoAnswerSnapshot, case.answer_id)
        assert answer.answer_text == "虚构的测试资料。"
        category = db.scalar(
            select(GeoCitationClassification).where(
                GeoCitationClassification.analysis_revision_id == identity
            )
        )
        assert category.source_category == "UNKNOWN" and category.subject_id is None
    assert not runs.submit_analysis_result(lease, harness.result(identity))
    runs.process_analysis_revision(identity)
    assert count(harness, GeoCitationClassification, identity) == 1


def test_review_reasons_and_bound_facts_persist_four_stages(harness):
    case = harness.create(
        products=1,
        answer_text="推荐 GEO501-0，供电电压为 5 V。",
        citation_urls=("https://example.com/a",),
    )
    runs.process_analysis_run(case.run_id)
    state = harness.run(case.run_id)
    identity = state.current_analysis_revision_id
    assert state.status == "NEEDS_REVIEW" and state.finished_at is None
    reasons = harness.analysis(identity).review_required_reasons
    assert "CLAIM_UNJUDGEABLE" in reasons and "UNRELIABLE_RANK" in reasons
    assert count(harness, GeoEntityMention, identity) == 1
    assert count(harness, GeoRecommendation, identity) == 1
    assert count(harness, GeoClaimAssessment, identity) == 1
    assert count(harness, GeoCitationClassification, identity) == 1
    with harness.factory() as db:
        binding = db.scalar(
            select(GeoAnalysisFactVersion).where(
                GeoAnalysisFactVersion.analysis_revision_id == identity
            )
        )
        claim = db.scalar(
            select(GeoClaimAssessment).where(GeoClaimAssessment.analysis_revision_id == identity)
        )
        assert binding.fact_version_id == claim.fact_version_id == case.facts[0]


@pytest.mark.parametrize("phase", ["compute", "rows", "pointer", "commit"])
def test_failure_preserves_answer_and_rolls_back_every_result(harness, monkeypatch, caplog, phase):
    case = harness.create(
        products=1,
        answer_text="推荐 GEO501-0，供电电压为 5 V。",
        citation_urls=("https://example.com/a",),
    )
    identity = runs.prepare_collected_run(case.run_id)
    secret = "敏感的答案和事实绝不可打印"

    def fail(*args):
        raise RuntimeError(secret)

    if phase == "compute":
        monkeypatch.setattr(execution, "analyze", fail)
    elif phase == "rows":
        original = execution.add_results

        def partial(db, aid, result):
            original(db, aid, result)
            db.flush()
            fail()

        monkeypatch.setattr(execution, "add_results", partial)
    elif phase == "pointer":

        def fail_update(conn, cursor, statement, parameters, context, executemany):
            if (
                statement.startswith("UPDATE geo_observation_runs SET")
                and "current_analysis_revision_id=" in statement
            ):
                fail()

        event.listen(harness.factory.kw["bind"], "before_cursor_execute", fail_update)
    else:

        def fail_commit(session):
            if any(
                isinstance(row, GeoAnalysisRevision) and row.status == "COMPLETED"
                for row in session.identity_map.values()
            ):
                fail()

        event.listen(harness.factory.class_, "before_commit", fail_commit)
    try:
        runs.process_analysis_revision(identity)
    finally:
        if phase == "pointer":
            event.remove(harness.factory.kw["bind"], "before_cursor_execute", fail_update)
        if phase == "commit":
            event.remove(harness.factory.class_, "before_commit", fail_commit)
    state = harness.run(case.run_id)
    assert state.status == "FAILED" and state.error_stage == "ANALYSIS"
    assert state.current_analysis_revision_id is None and state.error_code == "ANALYSIS_FAILED"
    assert harness.analysis(identity).status == "FAILED"
    assert secret not in caplog.text and secret not in state.error_summary
    for model in (
        GeoEntityMention,
        GeoRecommendation,
        GeoClaimAssessment,
        GeoCitationClassification,
    ):
        assert count(harness, model, identity) == 0
    with harness.factory() as db:
        assert (
            db.get(GeoAnswerSnapshot, case.answer_id).answer_text
            == "推荐 GEO501-0，供电电压为 5 V。"
        )
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoAnswerCitation)
                .where(GeoAnswerCitation.answer_snapshot_id == case.answer_id)
            )
            == 1
        )


def test_duplicate_concurrent_claims_and_input_creation(harness):
    case = harness.create(answer_text="虚构的测试资料。")

    def prepare(_):
        try:
            return runs.prepare_collected_run(case.run_id)
        except DBAPIError as error:
            assert error.orig.sqlstate == "40001"
            return None

    with ThreadPoolExecutor(max_workers=4) as pool:
        ids = list(pool.map(prepare, range(4)))
    identities = {identity for identity in ids if identity is not None}
    assert len(identities) == 1
    identity = identities.pop()
    with ThreadPoolExecutor(max_workers=4) as pool:
        leases = list(pool.map(runs.claim_analysis_revision, [identity] * 4))
    claimed = [lease for lease in leases if lease is not None]
    assert len(claimed) == 1
    assert runs.submit_analysis_result(claimed[0], harness.result(identity))
    with harness.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoAnalysisRevision)
                .where(GeoAnalysisRevision.run_id == case.run_id)
            )
            == 1
        )


def test_expired_lease_rejects_late_success_and_failure(harness):
    case = harness.create(answer_text="虚构的测试资料。")
    identity = runs.prepare_collected_run(case.run_id)
    lease = runs.claim_analysis_revision(identity)
    result = harness.result(identity)
    future = datetime.now(UTC) + timedelta(minutes=10)
    assert dispatch.recover_expired_analysis_revisions(now=future) == 1
    assert not runs.submit_analysis_result(lease, result)
    assert not runs.submit_analysis_failure(lease)
    assert harness.analysis(identity).status == "FAILED"
    assert harness.run(case.run_id).status == "FAILED"
    assert dispatch.recover_expired_analysis_revisions(now=future) == 0


def test_reanalysis_append_idempotent_and_failure_retains_current(harness, monkeypatch):
    case = harness.create(answer_text="虚构的测试资料。")
    runs.process_analysis_run(case.run_id)
    original = harness.run(case.run_id)
    first = original.current_analysis_revision_id
    second = harness.reanalyze(case.run_id)
    assert second != first  # 当前 Catalog 名称与夹具的原运行冻结名称不同。
    assert harness.reanalyze(case.run_id) == second
    assert harness.run(case.run_id).status == "COMPLETED"
    runs.process_analysis_revision(second)
    state = harness.run(case.run_id)
    assert state.current_analysis_revision_id == second and state.status == original.status
    assert state.finished_at == original.finished_at and state.collected_at == original.collected_at
    assert harness.reanalyze(case.run_id) == second
    # 新字典输入追加第三版；失败只能保留第二版指针。
    subject_id = case.input["subjects"][0]["id"]
    with harness.factory.begin() as db:
        from app.models.geo_catalog import GeoSubject

        subject = db.get(GeoSubject, subject_id)
        subject.display_name = "虚构的新显示名称"
        subject.revision += 1
    third = harness.reanalyze(case.run_id)
    with monkeypatch.context() as context:
        context.setattr(
            execution, "analyze", lambda _: (_ for _ in ()).throw(RuntimeError("虚构故障"))
        )
        runs.process_analysis_revision(third)
    assert harness.analysis(third).status == "FAILED"
    assert harness.run(case.run_id).current_analysis_revision_id == second
    assert harness.analysis(first).status == "COMPLETED"
    fourth = harness.reanalyze(case.run_id)
    assert (
        fourth != third
        and harness.analysis(fourth).input_sha256 == harness.analysis(third).input_sha256
    )
    runs.process_analysis_revision(fourth)
    assert harness.run(case.run_id).current_analysis_revision_id == fourth
    with harness.factory() as db:
        audits = list(
            db.scalars(
                select(AuditLog).where(
                    AuditLog.target_id.in_([str(second), str(third), str(fourth)])
                )
            )
        )
        assert audits and all(
            set(row.details["facts"]) == {"run_id", "analysis_revision_id", "reason_code"}
            for row in audits
        )


def test_old_success_after_new_success_does_not_regress_pointer(harness):
    case = harness.create(answer_text="虚构的测试资料。")
    runs.process_analysis_run(case.run_id)
    second = harness.reanalyze(case.run_id)
    old = runs.claim_analysis_revision(second)
    subject_id = case.input["subjects"][0]["id"]
    from app.models.geo_catalog import GeoSubject

    with harness.factory.begin() as db:
        subject = db.get(GeoSubject, subject_id)
        subject.display_name = "虚构的第三版名称"
        subject.revision += 1
    third = harness.reanalyze(case.run_id)
    runs.process_analysis_revision(third)
    assert runs.submit_analysis_result(old, harness.result(second))
    assert harness.analysis(second).status == "COMPLETED"
    assert harness.run(case.run_id).current_analysis_revision_id == third


def test_reanalysis_permission_revision_and_disabled_gate(harness, monkeypatch):
    case = harness.create(answer_text="虚构的测试资料。")
    with pytest.raises(AppError) as error:
        harness.reanalyze(case.run_id)
    assert error.value.code == "INVALID_STATE_TRANSITION"
    runs.process_analysis_run(case.run_id)
    with harness.factory() as db:
        actor = db.get(User, harness.database.runs.plan.actor)
    with pytest.raises(AppError) as error:
        geo_reanalysis.reanalyze_run(
            run_id=case.run_id,
            actor=actor,
            expected_revision=0,
            reason="RETRY_FAILED",
            request_id="geo506-conflict",
            sender=lambda _: None,
        )
    assert error.value.code == "REVISION_CONFLICT"
    with harness.factory.begin() as db:
        engineer = User(
            username=f"geo506-{uuid4()}",
            display_name="虚构工程师",
            password_hash="unused",
            account_type="ENGINEER",
            is_active=True,
            must_change_password=False,
        )
        db.add(engineer)
    with pytest.raises(AppError) as error:
        geo_reanalysis.reanalyze_run(
            run_id=case.run_id,
            actor=engineer,
            expected_revision=harness.run(case.run_id).revision,
            reason="RETRY_FAILED",
            request_id="geo506-forbidden",
            sender=lambda _: None,
        )
    assert error.value.code == "PERMISSION_DENIED"
    monkeypatch.setattr(settings, "geo_monitoring_enabled", False)
    assert dispatch.redispatch_pending_analysis_revisions(lambda _: None) == 0
    with pytest.raises(AppError):
        harness.reanalyze(case.run_id)


def test_collected_scanner_broker_loss_and_throttle(harness):
    case = harness.create(answer_text="虚构的测试资料。")

    def offline(_):
        raise ConnectionError("虚构 Broker 离线")

    assert dispatch.redispatch_pending_analysis_revisions(offline) == 0
    with harness.factory() as db:
        analysis = db.scalar(
            select(GeoAnalysisRevision).where(GeoAnalysisRevision.run_id == case.run_id)
        )
        job = db.get(GeoAnalysisJob, analysis.id)
        assert job.dispatch_attempt_count == 1 and job.claimed_at is None
    sent = []
    assert dispatch.redispatch_pending_analysis_revisions(sent.append) == 0
    assert (
        dispatch.redispatch_pending_analysis_revisions(
            sent.append, now=datetime.now(UTC) + timedelta(minutes=3)
        )
        == 1
    )
    assert sent == [str(analysis.id)]
    runs.process_analysis_revision(analysis.id)


def test_real_redis_celery_only_stable_ids_and_duplicate_messages(harness):
    case = harness.create(answer_text="虚构的测试资料。")
    identity = runs.prepare_collected_run(case.run_id)
    queue = f"geo506-{uuid4().hex}"
    redis = Redis.from_url(settings.redis_url)
    try:
        analyze_geo_run.apply_async(args=[str(case.run_id)], queue=queue, retry=False)
        analyze_geo_revision.apply_async(args=[str(identity)], queue=queue, retry=False)
        analyze_geo_revision.apply_async(args=[str(identity)], queue=queue, retry=False)
        messages = redis.lrange(queue, 0, -1)
        assert len(messages) == 3
        for raw in messages:
            message = json.loads(raw)
            body = json.loads(base64.b64decode(message["body"]))
            assert body[0] in ([str(identity)], [str(case.run_id)]) and body[1] == {}
            assert case.input["subjects"][0]["canonical_name"] not in raw.decode()
        with start_worker(
            celery_app,
            pool="solo",
            queues=[queue],
            perform_ping_check=False,
            shutdown_timeout=15,
            loglevel="ERROR",
        ):
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if harness.run(case.run_id).status == "COMPLETED" and redis.llen(queue) == 0:
                    break
                time.sleep(0.05)
            assert harness.run(case.run_id).status == "COMPLETED" and redis.llen(queue) == 0
        with harness.factory() as db:
            assert (
                db.scalar(
                    select(func.count())
                    .select_from(GeoAnalysisRevision)
                    .where(GeoAnalysisRevision.run_id == case.run_id)
                )
                == 1
            )
    finally:
        redis.delete(queue)
        redis.close()
