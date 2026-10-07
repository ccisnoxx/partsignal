"""GEO-407：真实 PG 并发预留、费用未知、Profile 配额与原子结果。"""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from itertools import count
from threading import Barrier, Event

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.collectors.contracts import CollectionEstimate, Money
from app.collectors.openai_compatible import OpenAICompatibleGeoCollector
from app.config import settings
from app.geo_fake_server import FakeMode, FakeScenario, running_geo_fake
from app.models.geo_answers import GeoAnswerCitation, GeoAnswerSnapshot
from app.models.geo_collection_admission import GeoCollectionReservation as Reservation
from app.models.geo_runs import GeoObservationRun as Run
from app.models.geo_surfaces import GeoCollectionProfile
from app.services import geo_dispatch, geo_runs
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine
from tests.integration.geo_worker_support import worker_graph as worker_graph

pytestmark = pytest.mark.integration
_days = count()


@pytest.fixture
def local_provider():
    with running_geo_fake() as server:
        yield server


@pytest.fixture
def clock(monkeypatch):
    # 每个测试独立 UTC 日，避免模块内未知发送历史影响后续日预算用例。
    value = [datetime(2040, 1, 1, tzinfo=UTC) + timedelta(days=next(_days))]
    monkeypatch.setattr(geo_runs, "database_now", lambda _: value[0])
    monkeypatch.setattr(settings, "geo_daily_budget_limit", None)
    return value


def profile_limits(graph, *, concurrency=100, per_minute=60):
    with graph.api.api.factory.begin() as db:
        profile = db.get(GeoCollectionProfile, graph.profile)
        profile.settings_json = {"max_concurrency": concurrency, "requests_per_minute": per_minute}
        profile.revision += 1
    # 仅虚构测试资格；生产配置更新仍由 0052 撤销旧测试资格。
    with graph.api.api.factory.begin() as db:
        profile = db.get(GeoCollectionProfile, graph.profile)
        profile.last_test_status = "PASSED"
        profile.last_tested_at = datetime.now(UTC)
        profile.is_active = True
        profile.revision += 1


def estimate(monkeypatch, amount="0.001200", currency="USD"):
    monkeypatch.setattr(
        OpenAICompatibleGeoCollector,
        "estimate",
        lambda self, request: CollectionEstimate(cost=Money(Decimal(amount), currency)),
    )


def row(graph, identity, model=Run):
    with graph.api.api.factory() as db:
        return db.get(model, identity)


def complete(lease, provider, graph, *, known=True):
    provider.state.configure(graph.call_id, FakeScenario(reported_cost=known))
    result = lease.collector.collect(
        lease.request, before_send=lambda: geo_runs.authorize_send(lease)
    )
    assert geo_runs.submit_collection_result(lease, result)
    return result


def batch_runs(graph, first):
    with graph.api.api.factory() as db:
        return list(db.scalars(select(Run.id).where(Run.batch_id == row(graph, first).batch_id)))


@pytest.mark.parametrize("daily", [False, True])
def test_concurrent_budget_cannot_overreserve(
    worker_graph, local_provider, monkeypatch, clock, daily
):
    profile_limits(worker_graph)
    estimate(monkeypatch)
    if daily:
        monkeypatch.setattr(settings, "geo_daily_budget_limit", Decimal("0.001200"))
        ids = [worker_graph.create(), worker_graph.create()]
    else:
        first = worker_graph.create(budget="0.001200", repeat_count=2)
        ids = batch_runs(worker_graph, first)
    barrier = Barrier(2)

    def claim(identity):
        barrier.wait(timeout=5)
        return geo_runs.claim_collection_run(identity)

    with ThreadPoolExecutor(max_workers=2) as pool:
        leases = list(pool.map(claim, ids))
    assert sum(lease is not None for lease in leases) == 1
    assert sorted(row(worker_graph, identity).status for identity in ids) == [
        "BUDGET_BLOCKED",
        "RUNNING",
    ]
    assert sum(row(worker_graph, identity, Reservation) is not None for identity in ids) == 1
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 0
    complete(next(lease for lease in leases if lease), local_provider, worker_graph)


@pytest.mark.parametrize("daily", [False, True])
def test_unknown_estimate_blocks_before_call(
    worker_graph, local_provider, monkeypatch, clock, daily
):
    if daily:
        monkeypatch.setattr(settings, "geo_daily_budget_limit", Decimal("1"))
    identity = worker_graph.create(budget=None if daily else "1")
    geo_runs.process_collection_run(identity)
    run = row(worker_graph, identity)
    assert (run.status, run.error_code, run.external_call_state) == (
        "BUDGET_BLOCKED",
        "BUDGET_EXCEEDED",
        "NOT_STARTED",
    )
    assert row(worker_graph, identity, Reservation) is None
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 0


def test_unknown_reported_cost_and_partial_usage_remain_unknown(
    worker_graph, local_provider, clock
):
    identity = worker_graph.create()
    local_provider.state.configure(worker_graph.call_id, FakeScenario(partial_usage=True))
    geo_runs.process_collection_run(identity)
    run = row(worker_graph, identity)
    assert run.status == "COLLECTED" and run.prompt_tokens == 7
    assert run.completion_tokens is None and run.total_tokens is None
    assert run.cost_amount is None and run.cost_currency is None
    assert row(worker_graph, identity, Reservation).state == "UNKNOWN"
    detail = worker_graph.api.api.engineer.get(
        f"/api/v1/geo/observation-batches/{run.batch_id}"
    ).json()
    assert detail["summary"]["cost"] == {
        "known_attempt_count": 0,
        "unknown_attempt_count": 1,
        "known_costs": [],
    }


@pytest.mark.parametrize("sent", [False, True])
def test_recovery_releases_only_unsent_budget(
    worker_graph, local_provider, monkeypatch, clock, sent
):
    profile_limits(worker_graph)
    estimate(monkeypatch)
    first = worker_graph.create(budget="0.001200", repeat_count=2)
    ids = batch_runs(worker_graph, first)
    lease = geo_runs.claim_collection_run(ids[0])
    if sent:
        geo_runs.authorize_send(lease)
    expiry = row(worker_graph, ids[0]).lease_expires_at + timedelta(seconds=1)
    clock[0] = expiry
    assert geo_dispatch.recover_expired_collection_runs(now=expiry) == 1
    assert row(worker_graph, ids[0], Reservation).state == ("UNKNOWN" if sent else "RELEASED")
    second = geo_runs.claim_collection_run(ids[1])
    assert (second is None) == sent
    assert row(worker_graph, ids[1]).status == ("BUDGET_BLOCKED" if sent else "RUNNING")
    if second:
        complete(second, local_provider, worker_graph)


def test_actual_cost_over_estimate_stops_later_admission(
    worker_graph, local_provider, monkeypatch, clock
):
    profile_limits(worker_graph)
    estimate(monkeypatch, "0.000100")
    first = worker_graph.create(budget="0.001200", repeat_count=2)
    ids = batch_runs(worker_graph, first)
    lease = geo_runs.claim_collection_run(ids[0])
    complete(lease, local_provider, worker_graph)
    assert row(worker_graph, ids[0]).cost_amount == Decimal("0.001200")
    assert row(worker_graph, ids[0], Reservation).estimated_amount == Decimal("0.000100")
    assert geo_runs.claim_collection_run(ids[1]) is None
    assert row(worker_graph, ids[1]).status == "BUDGET_BLOCKED"


@pytest.mark.parametrize("currency", ["EUR", "USD"])
def test_daily_currency_and_known_zero(worker_graph, local_provider, monkeypatch, clock, currency):
    estimate(monkeypatch, "0", currency)
    monkeypatch.setattr(settings, "geo_daily_budget_limit", Decimal("0"))
    identity = worker_graph.create()
    lease = geo_runs.claim_collection_run(identity)
    assert (lease is not None) == (currency == "USD")
    if lease:
        local_provider.state.configure(worker_graph.call_id, FakeScenario())
        result = lease.collector.collect(
            lease.request, before_send=lambda: geo_runs.authorize_send(lease)
        )
        assert geo_runs.submit_collection_result(
            lease, replace(result, cost=Money(Decimal("0"), "USD"))
        )
        assert row(worker_graph, identity).cost_amount == Decimal("0")
        assert row(worker_graph, identity, Reservation).state == "SETTLED"
    else:
        assert row(worker_graph, identity).status == "BUDGET_BLOCKED"
        assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 0


def test_send_rechecks_new_utc_day_budget(worker_graph, local_provider, monkeypatch, clock):
    profile_limits(worker_graph)
    estimate(monkeypatch)
    monkeypatch.setattr(settings, "geo_daily_budget_limit", Decimal("0.001200"))
    clock[0] = clock[0].replace(hour=23, minute=59, second=59)
    waiting = geo_runs.claim_collection_run(worker_graph.create())
    clock[0] += timedelta(seconds=2)
    current = geo_runs.claim_collection_run(worker_graph.create())
    complete(current, local_provider, worker_graph)
    from app.services.geo_collection_admission import BudgetExceeded

    with pytest.raises(BudgetExceeded):
        geo_runs.authorize_send(waiting)
    assert geo_runs.submit_collection_failure(waiting, None, budget_denied=True)
    run = row(worker_graph, waiting.request.run_id)
    assert run.error_code == "BUDGET_EXCEEDED" and run.external_call_state == "NOT_STARTED"
    assert row(worker_graph, run.id, Reservation).state == "RELEASED"
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 1


def test_profile_concurrency_and_minute_quota(worker_graph, local_provider, clock):
    profile_limits(worker_graph, concurrency=1, per_minute=1)
    ids = [worker_graph.create(), worker_graph.create()]
    first = geo_runs.claim_collection_run(ids[0])
    original = row(worker_graph, ids[1]).revision
    assert geo_runs.claim_collection_run(ids[1]) is None
    assert row(worker_graph, ids[1]).revision == original
    assert row(worker_graph, ids[1]).status == "PENDING"
    complete(first, local_provider, worker_graph)
    assert geo_runs.claim_collection_run(ids[1]) is None
    clock[0] += timedelta(seconds=61)
    second = geo_runs.claim_collection_run(ids[1])
    assert second is not None
    complete(second, local_provider, worker_graph)
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 2


def test_429_persists_and_cools_profile_without_partial_answer(worker_graph, local_provider, clock):
    profile_limits(worker_graph)
    identity = worker_graph.create()
    local_provider.state.configure(worker_graph.call_id, FakeScenario(mode=FakeMode.RATE_LIMIT))
    geo_runs.process_collection_run(identity)
    run = row(worker_graph, identity)
    assert (run.status, run.error_code, run.provider_status, run.retry_after_seconds) == (
        "FAILED",
        "PROVIDER_RATE_LIMITED",
        429,
        2,
    )
    assert row(worker_graph, identity, Reservation).state == "UNKNOWN"
    detail = worker_graph.api.api.engineer.get(f"/api/v1/geo/observation-runs/{identity}").json()
    assert detail["answer"] is None and detail["citations"] == []
    assert detail["run"]["provider_status"] == 429 and detail["run"]["retry_after_seconds"] == 2
    next_id = worker_graph.create()
    assert geo_runs.claim_collection_run(next_id) is None
    geo_runs.process_collection_run(identity)
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 1
    clock[0] += timedelta(seconds=2)
    second = geo_runs.claim_collection_run(next_id)
    assert second is not None
    complete(second, local_provider, worker_graph)


def test_citations_usage_cost_commit_rollback_and_duplicate(worker_graph, local_provider, clock):
    identity = worker_graph.create()
    lease = geo_runs.claim_collection_run(identity)
    local_provider.state.configure(
        worker_graph.call_id,
        FakeScenario(mode=FakeMode.CITATIONS, partial_usage=True, reported_cost=True),
    )
    result = lease.collector.collect(
        lease.request, before_send=lambda: geo_runs.authorize_send(lease)
    )

    def reject(_session):
        raise RuntimeError("虚构提交故障")

    event.listen(Session, "before_commit", reject)
    try:
        with pytest.raises(RuntimeError):
            geo_runs.submit_collection_result(lease, result)
    finally:
        event.remove(Session, "before_commit", reject)
    run = row(worker_graph, identity)
    assert run.external_call_state == "SENT" and run.cost_amount is None
    assert row(worker_graph, identity, Reservation).state == "SENT"
    with worker_graph.api.api.factory() as db:
        assert (
            db.scalar(select(GeoAnswerSnapshot).where(GeoAnswerSnapshot.run_id == identity)) is None
        )
    assert geo_runs.submit_collection_result(lease, result)
    assert not geo_runs.submit_collection_result(lease, result)
    detail = worker_graph.api.api.engineer.get(f"/api/v1/geo/observation-runs/{identity}").json()
    assert detail["answer"]["citation_count"] == 1
    assert detail["citations"][0]["occurrences"] == [1, 3]
    assert detail["run"]["prompt_tokens"] == 7 and detail["run"]["total_tokens"] is None
    assert Decimal(detail["run"]["cost_amount"]) == Decimal("0.001200")
    assert detail["batch"]["summary"]["cost"]["known_attempt_count"] == 1
    with worker_graph.api.api.factory() as db:
        citation = db.scalar(
            select(GeoAnswerCitation)
            .join(GeoAnswerSnapshot)
            .where(GeoAnswerSnapshot.run_id == identity)
        )
        citation_id = citation.id
    with pytest.raises(IntegrityError), worker_graph.api.api.factory.begin() as db:
        db.execute(
            text("UPDATE geo_answer_citations SET title='改写' WHERE id=:id"), {"id": citation_id}
        )
    with pytest.raises(IntegrityError), worker_graph.api.api.factory.begin() as db:
        db.execute(
            text("DELETE FROM geo_collection_reservations WHERE run_id=:id"), {"id": identity}
        )
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 1


def test_db_rejects_run_ledger_divergence(worker_graph, clock):
    identity = worker_graph.create()
    geo_runs.claim_collection_run(identity)
    with pytest.raises(IntegrityError) as caught, worker_graph.api.api.factory.begin() as db:
        run = db.get(Run, identity)
        run.external_call_state = "SENT"
        run.revision += 1
    assert caught.value.orig.diag.constraint_name == "ck_geo_reservations_run"
    assert row(worker_graph, identity).external_call_state == "NOT_STARTED"


def test_concurrent_distinct_runs_respect_profile_limit(worker_graph, local_provider, clock):
    profile_limits(worker_graph, concurrency=1)
    ids = [worker_graph.create(), worker_graph.create()]
    barrier = Barrier(2)

    def claim(identity):
        barrier.wait(timeout=5)
        return geo_runs.claim_collection_run(identity)

    with ThreadPoolExecutor(max_workers=2) as pool:
        leases = list(pool.map(claim, ids))
    assert sum(lease is not None for lease in leases) == 1
    assert sorted(row(worker_graph, identity).status for identity in ids) == ["PENDING", "RUNNING"]
    complete(next(lease for lease in leases if lease), local_provider, worker_graph)
    next_id = next(identity for identity in ids if row(worker_graph, identity).status == "PENDING")
    complete(geo_runs.claim_collection_run(next_id), local_provider, worker_graph)


def test_unsent_failure_releases_minute_quota(worker_graph, local_provider, clock):
    profile_limits(worker_graph, concurrency=1, per_minute=1)
    first = geo_runs.claim_collection_run(worker_graph.create())
    assert geo_runs.submit_collection_failure(first, None)
    second = geo_runs.claim_collection_run(worker_graph.create())
    assert second is not None
    assert row(worker_graph, first.request.run_id, Reservation).state == "RELEASED"
    complete(second, local_provider, worker_graph)
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 1


@pytest.mark.parametrize("known", [False, True])
def test_unknown_or_mixed_actual_currency_blocks_batch(
    worker_graph, local_provider, monkeypatch, clock, known
):
    profile_limits(worker_graph)
    estimate(monkeypatch)
    first = worker_graph.create(budget="1", repeat_count=2)
    ids = batch_runs(worker_graph, first)
    lease = geo_runs.claim_collection_run(ids[0])
    result = lease.collector.collect(
        lease.request, before_send=lambda: geo_runs.authorize_send(lease)
    )
    result = replace(result, cost=Money(Decimal("0.0012"), "EUR") if known else None)
    assert geo_runs.submit_collection_result(lease, result)
    assert geo_runs.claim_collection_run(ids[1]) is None
    assert row(worker_graph, ids[1]).status == "BUDGET_BLOCKED"
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 1


def test_db_rejects_api_claim_without_reservation(worker_graph, clock):
    from uuid import uuid4

    identity = worker_graph.create()
    with pytest.raises(IntegrityError) as caught, worker_graph.api.api.factory.begin() as db:
        run = db.get(Run, identity)
        run.status = "RUNNING"
        run.started_at = clock[0]
        run.lease_token = uuid4()
        run.lease_expires_at = clock[0] + timedelta(minutes=5)
        run.revision += 1
    assert caught.value.orig.diag.constraint_name == "ck_geo_reservations_run"
    assert row(worker_graph, identity).status == "PENDING"
    assert row(worker_graph, identity, Reservation) is None


def test_db_rejects_collected_cost_rewrite(worker_graph, local_provider, clock):
    identity = worker_graph.create()
    complete(geo_runs.claim_collection_run(identity), local_provider, worker_graph)
    with pytest.raises(IntegrityError) as caught, worker_graph.api.api.factory.begin() as db:
        run = db.get(Run, identity)
        run.cost_amount = Decimal(0)
        run.revision += 1
    assert caught.value.orig.diag.constraint_name == "ck_geo_runs_collection_immutable"
    assert row(worker_graph, identity).cost_amount == Decimal("0.001200")
    assert row(worker_graph, identity, Reservation).state == "SETTLED"


def test_db_rejects_wrong_utc_budget_day(worker_graph, clock):
    identity = worker_graph.create()
    geo_runs.claim_collection_run(identity)
    with pytest.raises(IntegrityError) as caught, worker_graph.api.api.factory.begin() as db:
        run = db.get(Run, identity)
        reservation = db.get(Reservation, identity)
        run.external_call_state = "SENT"
        run.revision += 1
        reservation.state = "SENT"
        reservation.sent_at = clock[0]
        reservation.budget_day = (clock[0] - timedelta(days=1)).date()
    assert caught.value.orig.diag.constraint_name == "ck_geo_reservations_day"
    assert row(worker_graph, identity).external_call_state == "NOT_STARTED"


def test_daily_budget_serializes_distinct_configuration_graphs(
    worker_graph, local_provider, monkeypatch, clock
):
    from tests.integration.geo_worker_support import prepared_worker_graph

    monkeypatch.setattr(settings, "geo_daily_budget_limit", Decimal("0.001200"))
    first_id = worker_graph.create()
    entered, release, second_started, second_finished = Event(), Event(), Event(), Event()

    def priced(_self, request):
        if request.run_id == first_id:
            entered.set()
            assert release.wait(5)
        return CollectionEstimate(Money(Decimal("0.001200"), "USD"))

    monkeypatch.setattr(OpenAICompatibleGeoCollector, "estimate", priced)
    with prepared_worker_graph(worker_graph.api, monkeypatch, local_provider) as other:
        second_id = other.create()
        first_profile = row(worker_graph, worker_graph.profile, GeoCollectionProfile)
        other_profile = row(other, other.profile, GeoCollectionProfile)
        assert first_profile.id != other_profile.id
        assert first_profile.ai_channel_id != other_profile.ai_channel_id
        assert first_profile.ai_model_id != other_profile.ai_model_id
        assert first_profile.engine_surface_id != other_profile.engine_surface_id

        def second_claim():
            second_started.set()
            result = geo_runs.claim_collection_run(second_id)
            second_finished.set()
            return result

        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(geo_runs.claim_collection_run, first_id)
            assert entered.wait(5)
            second = pool.submit(second_claim)
            assert second_started.wait(5)
            try:
                assert not second_finished.wait(0.25)
            finally:
                release.set()
            lease = first.result(timeout=5)
            assert second.result(timeout=5) is None
        assert row(other, second_id).status == "BUDGET_BLOCKED"
        complete(lease, local_provider, worker_graph)
        assert local_provider.state.snapshot(other.call_id)["count"] == 0
