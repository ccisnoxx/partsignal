"""真实 PostgreSQL/Redis/Celery 与 HTTP 模拟站验证采集生命周期。"""

import base64
import json
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from threading import Event
from uuid import uuid4

import pytest
from celery.contrib.testing.worker import start_worker
from redis import Redis
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.collectors.errors import CollectorError
from app.config import settings
from app.geo_fake_server import FakeMode, FakeScenario, running_geo_fake
from app.models.ai_generation import AIChannel
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.services import geo_dispatch, geo_runs
from app.worker import celery_app, collect_geo_run
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine
from tests.integration.geo_worker_support import WorkerGraph
from tests.integration.geo_worker_support import worker_graph as worker_graph

pytestmark = pytest.mark.integration


@pytest.fixture
def local_provider():
    with running_geo_fake() as server:
        yield server


def row(graph: WorkerGraph, identity):
    with graph.api.api.factory() as db:
        return db.get(GeoObservationRun, identity)


def calls(server, graph):
    return server.state.snapshot(graph.call_id)["count"]


def test_duplicate_and_concurrent_messages_call_provider_once(worker_graph, local_provider):
    run_id = worker_graph.create()
    assert row(worker_graph, run_id).dispatch_attempt_count == 1
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(geo_runs.process_collection_run, [run_id] * 6))
    geo_runs.process_collection_run(run_id)
    run = row(worker_graph, run_id)
    assert run.status == "COLLECTED" and run.external_call_state == "COMPLETED"
    assert run.lease_token is None and run.lease_expires_at is None
    assert run.cost_amount is None and run.total_tokens is None
    assert calls(local_provider, worker_graph) == 1
    with worker_graph.api.api.factory() as db:
        answer = db.scalar(select(GeoAnswerSnapshot).where(GeoAnswerSnapshot.run_id == run_id))
        assert answer.prompt_text == "虚构Plan问题"
        assert answer.answer_text == "仅供测试的虚构回答；不得用于真实选型。"
        assert db.get(GeoObservationBatch, run.batch_id).status == "RUNNING"


def test_real_redis_celery_messages_only_run_id_and_one_call(
    worker_graph, local_provider, monkeypatch
):
    queue = f"geo405-{uuid4().hex}"
    redis = Redis.from_url(settings.redis_url)
    monkeypatch.setattr(
        collect_geo_run,
        "delay",
        lambda rid: collect_geo_run.apply_async(args=[rid], queue=queue, retry=False),
    )
    try:
        run_id = worker_graph.create()
        collect_geo_run.delay(str(run_id))
        messages = redis.lrange(queue, 0, -1)
        assert len(messages) == 2
        for raw in messages:
            message = json.loads(raw)
            body = json.loads(base64.b64decode(message["body"]))
            assert message["headers"]["task"] == "partsignal.collect_geo_run"
            assert body[0] == [str(run_id)] and body[1] == {}
            assert "geo405-fake-secret" not in raw.decode()
        completed = Event()

        def received(sender=None, **kwargs):
            if kwargs.get("task_id"):
                completed.set()

        from celery.signals import task_postrun

        task_postrun.connect(received, weak=False)
        try:
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
                    if row(worker_graph, run_id).status == "COLLECTED" and redis.llen(queue) == 0:
                        break
                    time.sleep(0.05)
                assert completed.wait(2)
                assert row(worker_graph, run_id).status == "COLLECTED"
                assert redis.llen(queue) == 0
        finally:
            task_postrun.disconnect(received)
        assert calls(local_provider, worker_graph) == 1
    finally:
        redis.delete(queue)
        redis.close()


def test_pending_redispatch_throttle_limit_and_skip_locked(
    worker_graph, local_provider, monkeypatch
):
    ids = [worker_graph.create() for _ in range(3)]
    now = datetime.now(UTC) + timedelta(minutes=3)
    monkeypatch.setattr(settings, "geo_recovery_batch_size", 2)
    sent = []
    first_locked = Event()
    release = Event()

    def hold(value):
        first_locked.set()
        assert release.wait(5)
        sent.append(value)

    with ThreadPoolExecutor(max_workers=2) as pool:
        future = pool.submit(geo_dispatch.redispatch_pending_collection_runs, hold, now=now)
        assert first_locked.wait(5)
        other = geo_dispatch.redispatch_pending_collection_runs(sent.append, now=now)
        release.set()
        total = future.result() + other
    assert total == 3
    assert sorted(sent) == sorted(map(str, ids))
    assert geo_dispatch.redispatch_pending_collection_runs(sent.append, now=now) == 0
    assert calls(local_provider, worker_graph) == 0
    assert all(row(worker_graph, i).dispatch_attempt_count == 2 for i in ids)


@pytest.mark.parametrize("sent", [False, True])
def test_expired_lease_fails_and_rejects_old_token(worker_graph, local_provider, sent):
    identity = worker_graph.create()
    lease = geo_runs.claim_collection_run(identity)
    assert lease is not None
    if sent:
        geo_runs.authorize_send(lease)
    expired = row(worker_graph, identity).lease_expires_at + timedelta(seconds=1)
    assert geo_dispatch.fail_expired_collection_runs(now=expired) >= 1
    run = row(worker_graph, identity)
    assert run.status == "FAILED" and run.error_code == "WORKER_LOST"
    assert run.external_call_state == ("SENT" if sent else "NOT_STARTED")
    assert (
        geo_dispatch.redispatch_pending_collection_runs(
            lambda _: pytest.fail("不得补发"), now=expired
        )
        == 0
    )
    with pytest.raises(geo_runs.LeaseLost):
        geo_runs.authorize_send(lease)
    assert geo_runs.submit_collection_failure(lease, None) is False
    geo_runs.process_collection_run(identity)
    assert calls(local_provider, worker_graph) == 0


@pytest.mark.parametrize("mode", [FakeMode.RATE_LIMIT, FakeMode.INVALID_JSON, FakeMode.DISCONNECT])
def test_after_send_failure_never_redispatches(worker_graph, local_provider, mode):
    identity = worker_graph.create()
    local_provider.state.configure(worker_graph.call_id, FakeScenario(mode=mode))
    geo_runs.process_collection_run(identity)
    run = row(worker_graph, identity)
    assert run.status == "FAILED" and run.external_call_state != "NOT_STARTED"
    expected = {
        FakeMode.RATE_LIMIT: "PROVIDER_RATE_LIMITED",
        FakeMode.INVALID_JSON: "PROVIDER_RESPONSE_INVALID",
        FakeMode.DISCONNECT: "COLLECTOR_UNKNOWN_OUTCOME",
    }
    assert run.error_code == expected[mode]
    geo_runs.process_collection_run(identity)
    assert (
        geo_dispatch.redispatch_pending_collection_runs(
            lambda _: pytest.fail("不得补发"), now=datetime.now(UTC) + timedelta(hours=1)
        )
        == 0
    )
    assert calls(local_provider, worker_graph) == 1


def test_send_rechecks_disable_rotation_and_old_token(worker_graph, local_provider):
    identity = worker_graph.create()
    lease = geo_runs.claim_collection_run(identity)
    assert lease is not None
    with pytest.raises(geo_runs.LeaseLost):
        geo_runs.authorize_send(replace(lease, token=uuid4()))
    with worker_graph.api.api.factory() as db:
        channel = db.get(AIChannel, worker_graph.channel)
        channel.is_enabled = False
        channel.revision += 1
        db.commit()
    with pytest.raises(CollectorError):
        geo_runs.authorize_send(lease)
    assert row(worker_graph, identity).external_call_state == "NOT_STARTED"
    assert calls(local_provider, worker_graph) == 0


def test_result_rollback_no_partial_answer_and_no_second_call(worker_graph, local_provider):
    identity = worker_graph.create()
    lease = geo_runs.claim_collection_run(identity)
    result = lease.collector.collect(
        lease.request, before_send=lambda: geo_runs.authorize_send(lease)
    )

    def fail_commit(_db):
        raise RuntimeError("虚构结果提交失败")

    event.listen(Session, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError):
            geo_runs.submit_collection_result(lease, result)
    finally:
        event.remove(Session, "before_commit", fail_commit)
    run = row(worker_graph, identity)
    assert run.status == "RUNNING" and run.external_call_state == "SENT"
    with worker_graph.api.api.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoAnswerSnapshot)
                .where(GeoAnswerSnapshot.run_id == identity)
            )
            == 0
        )
    assert geo_runs.submit_collection_result(lease, result)
    assert not geo_runs.submit_collection_result(lease, result)
    geo_runs.process_collection_run(identity)
    assert calls(local_provider, worker_graph) == 1


def test_live_switch_and_budget_fail_before_external_call(
    worker_graph, local_provider, monkeypatch
):
    budgeted = worker_graph.create(budget="1.00")
    geo_runs.process_collection_run(budgeted)
    assert row(worker_graph, budgeted).error_code == "COLLECTOR_CONFIGURATION_INVALID"
    identity = worker_graph.create()
    monkeypatch.setattr(settings, "geo_api_collection_enabled", False)
    geo_runs.process_collection_run(identity)
    assert row(worker_graph, identity).error_code == "COLLECTOR_DISABLED"
    assert calls(local_provider, worker_graph) == 0


def test_internal_data_not_sent_and_manual_not_claimed(worker_graph, local_provider, monkeypatch):
    from app.services.geo_batch_snapshots import BatchInputs

    public = BatchInputs.input_for

    def internal(self, prompt_id, profile_id):
        result = public(self, prompt_id, profile_id)
        result["data_classification"] = "INTERNAL"
        return result

    monkeypatch.setattr(BatchInputs, "input_for", internal)
    identity = worker_graph.create()
    geo_runs.process_collection_run(identity)
    assert row(worker_graph, identity).error_code == "DATA_CLASSIFICATION_FORBIDDEN"
    assert calls(local_provider, worker_graph) == 0
    value = worker_graph.api.payload()
    result = worker_graph.api.api.engineer.post(
        "/api/v1/geo/observation-batches",
        json={"source": "AD_HOC", "configuration": value},
        headers={"Idempotency-Key": f"manual-{uuid4()}"},
    )
    assert result.status_code == 201
    with worker_graph.api.api.factory() as db:
        manual = db.scalar(
            select(GeoObservationRun).where(GeoObservationRun.batch_id == result.json()["batch_id"])
        )
        assert manual.status == "PENDING" and manual.dispatch_attempt_count == 0
        assert geo_runs.claim_collection_run(manual.id) is None


def test_received_citations_explicitly_rejected_without_partial_result(
    worker_graph, local_provider
):
    from app.models.geo_answers import GeoAnswerCitation

    identity = worker_graph.create()
    local_provider.state.configure(worker_graph.call_id, FakeScenario(mode=FakeMode.CITATIONS))
    geo_runs.process_collection_run(identity)
    assert row(worker_graph, identity).status == "FAILED"
    assert row(worker_graph, identity).error_code == "PROVIDER_RESPONSE_INVALID"
    assert row(worker_graph, identity).external_call_state == "COMPLETED"
    with worker_graph.api.api.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoAnswerSnapshot)
                .where(GeoAnswerSnapshot.run_id == identity)
            )
            == 0
        )
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoAnswerCitation)
                .join(
                    GeoAnswerSnapshot, GeoAnswerSnapshot.id == GeoAnswerCitation.answer_snapshot_id
                )
                .where(GeoAnswerSnapshot.run_id == identity)
            )
            == 0
        )
    geo_runs.process_collection_run(identity)
    assert calls(local_provider, worker_graph) == 1


def test_late_success_does_not_overwrite_expired_terminal(worker_graph, local_provider):
    identity = worker_graph.create()
    lease = geo_runs.claim_collection_run(identity)
    result = lease.collector.collect(
        lease.request, before_send=lambda: geo_runs.authorize_send(lease)
    )
    expiry = row(worker_graph, identity).lease_expires_at + timedelta(seconds=1)
    assert geo_dispatch.fail_expired_collection_runs(now=expiry) == 1
    assert not geo_runs.submit_collection_result(lease, result)
    assert row(worker_graph, identity).error_code == "WORKER_LOST"
    with worker_graph.api.api.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoAnswerSnapshot)
                .where(GeoAnswerSnapshot.run_id == identity)
            )
            == 0
        )
    assert calls(local_provider, worker_graph) == 1


def test_accepted_broker_lost_ack_redispatch_keeps_one_call(worker_graph, local_provider):
    queue = f"geo405-lost-{uuid4().hex}"
    redis = Redis.from_url(settings.redis_url)
    identity = worker_graph.create()

    def sender(value):
        return collect_geo_run.apply_async(args=[value], queue=queue, retry=False)

    def lost_ack(value):
        sender(value)
        raise ConnectionError("虚构 Redis 已接收后连接断开")

    try:
        future_time = datetime.now(UTC) + timedelta(minutes=3)
        assert geo_dispatch.redispatch_pending_collection_runs(lost_ack, now=future_time) == 0
        assert redis.llen(queue) == 1
        assert row(worker_graph, identity).dispatch_attempt_count == 2
        assert (
            geo_dispatch.redispatch_pending_collection_runs(
                sender, now=future_time + timedelta(minutes=3)
            )
            == 1
        )
        assert redis.llen(queue) == 2
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
                if row(worker_graph, identity).status == "COLLECTED" and redis.llen(queue) == 0:
                    break
                time.sleep(0.05)
            assert row(worker_graph, identity).status == "COLLECTED" and redis.llen(queue) == 0
        assert calls(local_provider, worker_graph) == 1
    finally:
        redis.delete(queue)
        redis.close()


def test_blocked_broker_does_not_hold_same_batch_result_lock(worker_graph, local_provider):
    identity = worker_graph.create(repeat_count=2)
    lease = geo_runs.claim_collection_run(identity)
    result = lease.collector.collect(
        lease.request, before_send=lambda: geo_runs.authorize_send(lease)
    )
    publishing, release = Event(), Event()

    def blocked_sender(_value):
        publishing.set()
        assert release.wait(5)

    with ThreadPoolExecutor(max_workers=2) as pool:
        publisher = pool.submit(
            geo_dispatch.redispatch_pending_collection_runs,
            blocked_sender,
            now=datetime.now(UTC) + timedelta(minutes=3),
        )
        assert publishing.wait(5)
        try:
            submitted = pool.submit(geo_runs.submit_collection_result, lease, result)
            assert submitted.result(timeout=2)
        finally:
            release.set()
        assert publisher.result() == 1
    assert row(worker_graph, identity).status == "COLLECTED"
    assert calls(local_provider, worker_graph) == 1


def test_dispatch_reservation_rollback_does_not_publish(worker_graph):
    identity = worker_graph.create()
    sent = []

    def fail_commit(_session):
        raise RuntimeError("虚构预留事务回滚")

    event.listen(Session, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError):
            geo_dispatch.redispatch_pending_collection_runs(
                sent.append, now=datetime.now(UTC) + timedelta(minutes=3)
            )
    finally:
        event.remove(Session, "before_commit", fail_commit)
    assert sent == [] and row(worker_graph, identity).dispatch_attempt_count == 1
    assert (
        geo_dispatch.redispatch_pending_collection_runs(
            sent.append, now=datetime.now(UTC) + timedelta(minutes=3)
        )
        == 1
    )
    assert sent == [str(identity)]


def test_configuration_lock_allows_result_foreign_key_checks(worker_graph, local_provider):
    from app.services.geo_collection_execution import lock_configuration

    identity = worker_graph.create()
    lease = geo_runs.claim_collection_run(identity)
    result = lease.collector.collect(
        lease.request, before_send=lambda: geo_runs.authorize_send(lease)
    )
    with ThreadPoolExecutor(max_workers=1) as pool, worker_graph.api.api.factory.begin() as db:
        lock_configuration(db, lease.request)
        future = pool.submit(geo_runs.submit_collection_result, lease, result)
        try:
            assert future.result(timeout=2)
        finally:
            db.rollback()
    assert row(worker_graph, identity).status == "COLLECTED"
    assert calls(local_provider, worker_graph) == 1


def test_first_broker_failure_stops_publish_and_keeps_matrix_pending(worker_graph, monkeypatch):
    seen = []

    def offline(identity):
        seen.append(identity)
        raise ConnectionError("虚构 Broker 离线")

    monkeypatch.setattr(collect_geo_run, "delay", offline)
    identity = worker_graph.create(repeat_count=3)
    assert len(seen) == 1
    with worker_graph.api.api.factory() as db:
        batch_id = db.get(GeoObservationRun, identity).batch_id
        runs = list(
            db.scalars(select(GeoObservationRun).where(GeoObservationRun.batch_id == batch_id))
        )
        assert len(runs) == 3
        assert all(r.status == "PENDING" and r.dispatch_attempt_count == 1 for r in runs)
    assert (
        geo_dispatch.redispatch_pending_collection_runs(
            seen.append, now=datetime.now(UTC) + timedelta(minutes=3)
        )
        == 3
    )
