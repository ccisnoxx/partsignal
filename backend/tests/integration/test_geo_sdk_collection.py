"""PSR-003：真实 PG 的授权窗口、预算与未知结果不可重放。"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx2
import pytest
from openai.resources.chat.completions import Completions

from app.collectors.errors import CollectorError
from app.config import settings
from app.geo_fake_server import running_geo_fake
from app.models.ai_generation import AIChannel
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_collection_admission import GeoCollectionReservation
from app.models.geo_runs import GeoObservationRun
from app.services import geo_dispatch, geo_runs
from app.services.ai_provider import AIProvider
from app.services.geo_collection_admission import BudgetExceeded
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine
from tests.integration.geo_worker_support import worker_graph as worker_graph

pytestmark = pytest.mark.integration


@pytest.fixture
def local_provider():
    with running_geo_fake() as server:
        yield server


def row(graph, identity, model=GeoObservationRun):
    with graph.api.api.factory() as db:
        return db.get(model, identity)


@pytest.mark.parametrize("failure", ["budget", "configuration"])
def test_send_authorization_failure_never_starts_sdk_and_releases_budget(
    worker_graph, local_provider, monkeypatch, failure
):
    identity = worker_graph.create()
    lease = geo_runs.claim_collection_run(identity)
    assert lease is not None
    sdk_calls = []
    original = Completions.create

    def sdk_create(self, *args, **kwargs):
        sdk_calls.append(True)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Completions, "create", sdk_create)
    if failure == "budget":
        monkeypatch.setattr(settings, "geo_daily_budget_limit", Decimal("1"))
    else:
        with worker_graph.api.api.factory.begin() as db:
            channel = db.get(AIChannel, worker_graph.channel)
            channel.is_enabled = False
            channel.revision += 1
    with pytest.raises(BudgetExceeded if failure == "budget" else CollectorError) as caught:
        lease.collector.collect(lease.request, before_send=lambda: geo_runs.authorize_send(lease))
    assert sdk_calls == []
    assert local_provider.state.snapshot(worker_graph.call_id)["count"] == 0
    assert row(worker_graph, identity).external_call_state == "NOT_STARTED"
    assert geo_runs.submit_collection_failure(
        lease, caught.value if failure == "configuration" else None,
        budget_denied=failure == "budget",
    )
    assert row(worker_graph, identity).external_call_state == "NOT_STARTED"
    assert row(worker_graph, identity, GeoCollectionReservation).state == "RELEASED"


@pytest.mark.parametrize("error_type", [httpx2.ConnectError, httpx2.ReadTimeout])
def test_sdk_network_fault_persists_unknown_and_same_attempt_cannot_replay(
    worker_graph, local_provider, monkeypatch, error_type
):
    from app.collectors import openai_compatible

    sent = []

    def receive(request):
        # Transport 到达时必须已经提交授权事务；连接失败也属于外部窗口。
        run = row(worker_graph, identity)
        assert run.external_call_state == "SENT"
        assert row(worker_graph, identity, GeoCollectionReservation).state == "SENT"
        sent.append(True)
        raise error_type("虚构网络失败")

    monkeypatch.setattr(openai_compatible, "AIProvider", lambda **kwargs: AIProvider(
        **kwargs, transport=httpx2.MockTransport(receive)
    ))
    identity = worker_graph.create()
    geo_runs.process_collection_run(identity)
    run = row(worker_graph, identity)
    assert (run.status, run.external_call_state, run.error_code) == (
        "FAILED", "UNKNOWN", "COLLECTOR_UNKNOWN_OUTCOME",
    )
    assert row(worker_graph, identity, GeoCollectionReservation).state == "UNKNOWN"
    assert run.provider_status is None and run.retry_after_seconds is None
    from sqlalchemy import select

    with worker_graph.api.api.factory() as db:
        assert db.scalar(select(GeoAnswerSnapshot).where(
            GeoAnswerSnapshot.run_id == identity
        )) is None
    before = run.revision
    geo_runs.process_collection_run(identity)
    assert geo_dispatch.redispatch_pending_collection_runs(
        lambda _: pytest.fail("UNKNOWN 不得补投递"), now=datetime.now(UTC) + timedelta(hours=1)
    ) == 0
    assert row(worker_graph, identity).revision == before
    assert sent == [True]
