"""GEO-406：真实 PG、被杀死的子进程、本地 provider 和显式重试合同。"""

import os
import selectors
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import timedelta
from threading import Event
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.collectors.errors import CollectorError, CollectorStage
from app.collectors.registry import collector_registry
from app.config import settings
from app.errors import AppError
from app.geo_fake_server import FakeMode, FakeScenario, running_geo_fake
from app.main import app
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.geo_surfaces import GeoCollectionProfile
from app.models.identity import AuditLog, User
from app.schemas.geo_run_retry import GeoRunRetryRequest
from app.schemas.geo_runs import GeoExternalCallState, GeoRunErrorCode
from app.services import geo_dispatch, geo_run_retries, geo_runs
from app.services.geo_collection_profiles import load_profile_facts
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine
from tests.integration.geo_worker_support import worker_graph as worker_graph

pytestmark = pytest.mark.integration


@pytest.fixture
def local_provider():
    with running_geo_fake() as server:
        yield server


def row(graph, identity):
    with graph.api.api.factory() as db:
        return db.get(GeoObservationRun, identity)


def facts(graph, identity):
    value = row(graph, identity)
    return {column.name: getattr(value, column.name) for column in value.__table__.columns}


def expire(graph, identity):
    expiry = row(graph, identity).lease_expires_at + timedelta(seconds=1)
    return geo_dispatch.recover_expired_collection_runs(now=expiry)


def retry(graph, identity, *, revision=None, actor_id=None):
    with graph.api.api.factory() as db:
        actor = db.get(User, actor_id or graph.api.api.engineer_id)
        return geo_run_retries.retry_collection_run(
            db,
            run_id=identity,
            payload=GeoRunRetryRequest(
                expected_revision=revision
                if revision is not None
                else row(graph, identity).revision
            ),
            actor=actor,
            request_id=f"geo406-{uuid4()}",
        )


def lose_sent_run(graph):
    identity = graph.create()
    lease = geo_runs.claim_collection_run(identity)
    geo_runs.authorize_send(lease)
    assert expire(graph, identity) == 1
    return identity, lease


@pytest.mark.parametrize("sent", [False, True])
def test_killed_worker_recovers_only_before_send(worker_graph, local_provider, sent):
    identity = worker_graph.create()
    script = """
import sys
from dataclasses import replace
from types import MappingProxyType
from uuid import UUID
from app.collectors.registry import collector_registry
from app.config import settings
from app.services.geo_runs import claim_collection_run, authorize_send
settings.geo_monitoring_enabled = settings.geo_api_collection_enabled = True
settings.ai_allow_local_http = True
r = replace(collector_registry.resolve("openai-compatible-chat"), approved=True)
collector_registry._entries = MappingProxyType({
    "manual": collector_registry.resolve("manual"), r.key: r
})
lease = claim_collection_run(UUID(sys.argv[1]))
assert lease is not None
if sys.argv[2] == "sent":
    lease.collector.collect(lease.request, before_send=lambda: authorize_send(lease))
print("READY", flush=True)
sys.stdin.readline()
"""
    environment = os.environ | {
        "DATABASE_URL": worker_graph.api.api.engine.url.render_as_string(hide_password=False),
    }
    process = subprocess.Popen(
        [sys.executable, "-c", script, str(identity), "sent" if sent else "unsent"],
        env=environment,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            assert selector.select(timeout=10), "隔离Worker未到达崩溃边界"
        assert process.stdout.readline().strip() == "READY"
        assert row(worker_graph, identity).status == "RUNNING"
        assert row(worker_graph, identity).external_call_state == (
            "SENT" if sent else "NOT_STARTED"
        )
        process.kill()
        assert process.wait(timeout=5) < 0
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=5)
    assert expire(worker_graph, identity) == 1
    recovered = row(worker_graph, identity)
    assert recovered.status == ("FAILED" if sent else "PENDING")
    assert recovered.external_call_state == ("UNKNOWN" if sent else "NOT_STARTED")
    assert recovered.lease_token is None and recovered.lease_expires_at is None
    if not sent:
        assert recovered.started_at is None
    before = facts(worker_graph, identity)
    geo_runs.process_collection_run(identity)
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 1
    if sent:
        assert facts(worker_graph, identity) == before
    else:
        assert row(worker_graph, identity).status == "COLLECTED"
        assert row(worker_graph, identity).attempt_no == 1


def test_recovery_revokes_old_worker_before_new_claim(worker_graph, local_provider):
    identity = worker_graph.create()
    old = geo_runs.claim_collection_run(identity)
    assert expire(worker_graph, identity) == 1
    current = geo_runs.claim_collection_run(identity)
    assert current.token != old.token
    with pytest.raises(geo_runs.LeaseLost):
        old.collector.collect(old.request, before_send=lambda: geo_runs.authorize_send(old))
    assert not geo_runs.submit_collection_failure(old, None)
    result = current.collector.collect(
        current.request, before_send=lambda: geo_runs.authorize_send(current)
    )
    assert geo_runs.submit_collection_result(current, result)
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 1


def test_sent_marker_before_first_byte_is_still_unknown(worker_graph, local_provider):
    identity, lease = lose_sent_run(worker_graph)
    assert row(worker_graph, identity).external_call_state == "UNKNOWN"
    assert row(worker_graph, identity).error_code == "COLLECTOR_UNKNOWN_OUTCOME"
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 0
    with pytest.raises(geo_runs.LeaseLost):
        geo_runs.authorize_send(lease)
    assert geo_dispatch.recover_expired_collection_runs() == 0
    assert geo_dispatch.redispatch_pending_collection_runs(lambda _: pytest.fail("禁止补发")) == 0


@pytest.mark.parametrize("failure", [None, "NOT_STARTED", "UNKNOWN", "COMPLETED"])
def test_failure_preserves_durable_send_facts(worker_graph, failure):
    identity = worker_graph.create()
    lease = geo_runs.claim_collection_run(identity)
    geo_runs.authorize_send(lease)
    error = (
        None
        if failure is None
        else CollectorError(
            GeoRunErrorCode.PROVIDER_TIMEOUT
            if failure == "NOT_STARTED"
            else GeoRunErrorCode.PROVIDER_RESPONSE_INVALID
            if failure == "COMPLETED"
            else GeoRunErrorCode.COLLECTOR_UNKNOWN_OUTCOME,
            stage=CollectorStage.SEND
            if failure == "NOT_STARTED"
            else CollectorStage.PARSE
            if failure == "COMPLETED"
            else CollectorStage.RECEIVE,
            external_call_state=GeoExternalCallState(failure),
        )
    )
    assert geo_runs.submit_collection_failure(lease, error)
    run = row(worker_graph, identity)
    assert run.status == "FAILED"
    assert run.external_call_state == ("COMPLETED" if failure == "COMPLETED" else "UNKNOWN")
    assert run.error_code == (
        "PROVIDER_RESPONSE_INVALID" if failure == "COMPLETED" else "COLLECTOR_UNKNOWN_OUTCOME"
    )
    assert not geo_runs.submit_collection_failure(lease, error)


def test_full_received_result_commit_failure_keeps_completed(
    worker_graph, local_provider, monkeypatch
):
    identity = worker_graph.create()

    def unavailable(*_args):
        raise RuntimeError("虚构提交故障")

    monkeypatch.setattr(geo_runs, "submit_collection_result", unavailable)
    geo_runs.process_collection_run(identity)
    run = row(worker_graph, identity)
    assert run.status == "FAILED" and run.external_call_state == "COMPLETED"
    assert run.error_code == "WORKER_LOST"
    geo_runs.process_collection_run(identity)
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 1


def test_success_late_after_retry_cannot_change_either_attempt(worker_graph, local_provider):
    identity = worker_graph.create()
    lease = geo_runs.claim_collection_run(identity)
    result = lease.collector.collect(
        lease.request, before_send=lambda: geo_runs.authorize_send(lease)
    )
    assert expire(worker_graph, identity) == 1
    previous = facts(worker_graph, identity)
    created = retry(worker_graph, identity)
    successor = facts(worker_graph, created.run_id)
    assert not geo_runs.submit_collection_result(lease, result)
    assert not geo_runs.submit_collection_result(replace(lease, token=uuid4()), result)
    assert facts(worker_graph, identity) == previous
    assert facts(worker_graph, created.run_id) == successor
    with worker_graph.api.api.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoAnswerSnapshot)
                .where(GeoAnswerSnapshot.run_id.in_([identity, created.run_id]))
            )
            == 0
        )


def test_concurrent_retry_one_successor_and_original_terminal_unchanged(worker_graph):
    identity, _ = lose_sent_run(worker_graph)
    original = facts(worker_graph, identity)

    def create(index):
        try:
            return retry(
                worker_graph,
                identity,
                revision=original["revision"],
                actor_id=worker_graph.api.api.engineer_id
                if index % 2
                else worker_graph.api.api.admin_id,
            )
        except AppError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(create, range(5)))
    assert results.count("GEO_RUN_HAS_SUCCESSOR") == 4
    created = next(value for value in results if not isinstance(value, str))
    successor = row(worker_graph, created.run_id)
    assert successor.input_snapshot == original["input_snapshot"]
    assert successor.run_cell_key == original["run_cell_key"]
    assert successor.attempt_no == 2 and successor.previous_attempt_id == identity
    assert successor.status == "PENDING" and successor.external_call_state == "NOT_STARTED"
    assert facts(worker_graph, identity) == original
    with worker_graph.api.api.factory() as db:
        batch = db.get(GeoObservationBatch, successor.batch_id)
        assert batch.status == "QUEUED" and batch.finished_at is None
        assert batch.requested_run_count == 1
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.action == "geo_observation_run.retried",
                    AuditLog.target_id == str(successor.id),
                )
            )
            == 1
        )


def test_retry_and_audit_failure_roll_back_batch_and_successor(worker_graph, monkeypatch):
    identity, _ = lose_sent_run(worker_graph)
    with worker_graph.api.api.factory() as db:
        before = db.get(GeoObservationBatch, row(worker_graph, identity).batch_id)
        previous = before.status, before.revision, before.finished_at

    def unavailable(*_args):
        raise RuntimeError("虚构审计故障")

    monkeypatch.setattr(geo_run_retries, "append_audit", unavailable)
    with pytest.raises(RuntimeError):
        retry(worker_graph, identity)
    with worker_graph.api.api.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoObservationRun)
                .where(GeoObservationRun.previous_attempt_id == identity)
            )
            == 0
        )
        after = db.get(GeoObservationBatch, before.id)
        assert (after.status, after.revision, after.finished_at) == previous


def test_retry_api_auth_csrf_revision_actions_and_broker_failure(worker_graph):
    identity, _ = lose_sent_run(worker_graph)
    path = f"/api/v1/geo/observation-runs/{identity}"
    client = worker_graph.api.api.engineer
    detail = client.get(path).json()
    assert "RETRY" in detail["run"]["available_actions"]
    revision = detail["run"]["revision"]
    assert client.post(path + "/retry", json={}).status_code == 422
    assert (
        client.post(path + "/retry", json={"expected_revision": revision - 1}).json()["error"][
            "code"
        ]
        == "REVISION_CONFLICT"
    )
    with TestClient(app) as anonymous:
        assert (
            anonymous.post(path + "/retry", json={"expected_revision": revision}).status_code == 401
        )
    assert (
        client.post(
            path + "/retry",
            json={"expected_revision": revision},
            headers={"X-CSRF-Token": "x" * 32},
        ).status_code
        == 403
    )
    created = client.post(path + "/retry", json={"expected_revision": revision})
    assert created.status_code == 201, created.text
    child = UUID(created.json()["run_id"])
    assert row(worker_graph, child).dispatch_attempt_count == 1
    assert (
        client.post(path + "/retry", json={"expected_revision": revision}).json()["error"]["code"]
        == "GEO_RUN_HAS_SUCCESSOR"
    )
    detail = client.get(path).json()
    assert "RETRY" not in detail["run"]["available_actions"]
    assert len(detail["attempts"]) == 2 and detail["batch"]["summary"]["attempt_count"] == 2


def test_expiry_recovery_commit_failure_does_not_revoke_lease(worker_graph):
    identity = worker_graph.create()
    geo_runs.claim_collection_run(identity)
    before = facts(worker_graph, identity)

    def fail(_db):
        raise RuntimeError("虚构恢复回滚")

    event.listen(Session, "before_commit", fail)
    try:
        with pytest.raises(RuntimeError):
            expire(worker_graph, identity)
    finally:
        event.remove(Session, "before_commit", fail)
    assert facts(worker_graph, identity) == before


def test_recovery_wins_race_old_sender_cannot_send(worker_graph, local_provider):
    identity = worker_graph.create()
    lease = geo_runs.claim_collection_run(identity)
    locked, release = Event(), Event()

    def hold_recovery():
        with worker_graph.api.api.factory.begin() as db:
            from app.services import geo_collection_admission
            from app.services.geo_run_lifecycle import lock_run, recover_unsent_run, refresh_batch

            geo_collection_admission.lock_accounting(db)
            batch, run = lock_run(db, identity)
            recovered_at = run.lease_expires_at + timedelta(seconds=1)
            recover_unsent_run(db, run, recovered_at)
            geo_collection_admission.settle(db, run, recovered_at)
            refresh_batch(db, batch, run.created_at)
            locked.set()
            assert release.wait(5)

    with ThreadPoolExecutor(max_workers=2) as pool:
        recovery = pool.submit(hold_recovery)
        assert locked.wait(5)
        sending = pool.submit(
            lease.collector.collect,
            lease.request,
            before_send=lambda: geo_runs.authorize_send(lease),
        )
        release.set()
        recovery.result(timeout=5)
        with pytest.raises(geo_runs.LeaseLost):
            sending.result(timeout=5)
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 0


def test_only_explicit_retry_can_make_second_provider_call(worker_graph, local_provider):
    identity = worker_graph.create()
    local_provider.state.configure(worker_graph.call_id, FakeScenario(mode=FakeMode.DISCONNECT))
    geo_runs.process_collection_run(identity)
    previous = facts(worker_graph, identity)
    assert previous["status"] == "FAILED" and previous["external_call_state"] == "UNKNOWN"
    geo_runs.process_collection_run(identity)
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 1
    local_provider.state.configure(worker_graph.call_id, FakeScenario())
    created = retry(worker_graph, identity)
    geo_runs.process_collection_run(created.run_id)
    geo_runs.process_collection_run(created.run_id)
    geo_runs.process_collection_run(identity)
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 2
    assert facts(worker_graph, identity) == previous
    assert row(worker_graph, created.run_id).status == "COLLECTED"


@pytest.mark.parametrize("change", ["revision", "disabled"])
def test_retry_rechecks_frozen_profile_and_current_eligibility(worker_graph, change, monkeypatch):
    identity, _ = lose_sent_run(worker_graph)
    previous = facts(worker_graph, identity)
    if change == "revision":
        with worker_graph.api.api.factory.begin() as db:
            profile = db.get(GeoCollectionProfile, worker_graph.profile)
            profile.name += "-已更新"
            profile.revision += 1
        path = f"/api/v1/geo/collection-profiles/{worker_graph.profile}"
        tested = worker_graph.api.api.admin.post(path + "/test", json={"expected_revision": 1})
        assert tested.status_code == 200, tested.text
        assert tested.json()["summary"]["last_test_status"] == "PASSED"
        enabled = worker_graph.api.api.admin.post(
            path + "/enable", json={"expected_revision": tested.json()["summary"]["revision"]}
        )
        assert enabled.status_code == 200, enabled.text
        assert enabled.json()["summary"]["is_active"] is True
        with worker_graph.api.api.factory() as db:
            current_facts = load_profile_facts(db, [worker_graph.profile])[worker_graph.profile]
            assert current_facts.eligibility(
                registry=collector_registry, configuration=settings
            ).eligible
    else:
        monkeypatch.setattr(settings, "geo_api_collection_enabled", False)
    detail = worker_graph.api.api.engineer.get(f"/api/v1/geo/observation-runs/{identity}").json()
    assert "RETRY" not in detail["run"]["available_actions"]
    assert detail["run"]["primary_task"] == "VIEW_FAILURE"
    with pytest.raises(AppError) as caught:
        retry(worker_graph, identity)
    assert caught.value.code == (
        "GEO_PROFILE_CHANGED" if change == "revision" else "GEO_PLAN_PROFILE_INELIGIBLE"
    )
    assert facts(worker_graph, identity) == previous
    with worker_graph.api.api.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoObservationRun)
                .where(GeoObservationRun.previous_attempt_id == identity)
            )
            == 0
        )


def test_recovery_of_persisted_unknown_never_requeues(worker_graph):
    identity = worker_graph.create()
    lease = geo_runs.claim_collection_run(identity)
    geo_runs.authorize_send(lease)
    with worker_graph.api.api.factory.begin() as db:
        run = db.get(GeoObservationRun, identity)
        run.external_call_state = "UNKNOWN"
        run.revision += 1
    assert expire(worker_graph, identity) == 1
    assert row(worker_graph, identity).status == "FAILED"
    assert row(worker_graph, identity).external_call_state == "UNKNOWN"
    assert not geo_runs.submit_collection_failure(lease, None)
