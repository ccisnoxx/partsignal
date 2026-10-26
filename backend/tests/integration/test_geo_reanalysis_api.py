"""CORE-06：真实管理员HTTP、冻结历史与已有分析派发，不连接外部Broker。"""

import json
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import settings
from app.main import app
from app.models.geo_analysis import GeoAnalysisRevision
from app.models.identity import AuditLog
from app.services import geo_analysis_runs as runs
from app.services import geo_reanalysis as service
from tests.integration.geo_reviews_support import (
    RUNS,
    analysis_engine,
    answer_database,
    harness,
    plan_database,
    review_api,
    run_database,
)
from tests.unit.test_geo_run_contract import contract as contract
from tests.unit.test_geo_run_contract import validate

pytestmark = pytest.mark.integration
__all__ = [
    "analysis_engine",
    "answer_database",
    "harness",
    "plan_database",
    "review_api",
    "run_database",
]


@pytest.fixture
def api(review_api, monkeypatch):
    from app.worker import analyze_geo_revision

    messages = []
    monkeypatch.setattr(analyze_geo_revision, "delay", messages.append)
    review_api.messages = messages
    return review_api


def send(api, case, **patch):
    return api.admin.post(
        f"{RUNS}/{case.run_id}/reanalyze",
        headers={"X-Request-ID": "core06-fictional-request"},
        json={
            "expected_revision": api.harness.run(case.run_id).revision,
            "reason": "DICTIONARY_UPDATED",
            **patch,
        },
    )


def count(api, run_id):
    with api.harness.factory() as db:
        return db.scalar(
            select(func.count())
            .select_from(GeoAnalysisRevision)
            .where(GeoAnalysisRevision.run_id == run_id)
        )


def test_http_accept_reuse_publish_and_preserve_answer_history(api, contract):
    case = api.create(review_required=False)
    before = api.admin.get(f"{RUNS}/{case.run_id}").json()
    assert "REANALYZE" in before["analysis"]["available_actions"]
    assert "REANALYZE" not in api.detail(case)["analysis"]["available_actions"]
    first = before["analysis"]["selection"]["current_analysis_revision_id"]
    response = send(api, case)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    receipt = response.json()
    second = receipt["analysis_revision_id"]
    assert receipt == {
        "run_id": str(case.run_id),
        "analysis_revision_id": second,
        "request_id": "core06-fictional-request",
    }
    assert second != first and str(api.messages[-1]) == second
    pending = api.admin.get(f"{RUNS}/{case.run_id}").json()
    assert pending["run"] == before["run"]
    assert pending["analysis"]["revisions"][0]["analysis"]["status"] == "PENDING"
    assert send(api, case).json()["analysis_revision_id"] == second
    assert count(api, case.run_id) == 2
    runs.process_analysis_revision(UUID(second))
    current = api.admin.get(f"{RUNS}/{case.run_id}").json()
    assert current["answer"] == before["answer"]
    assert current["citations"] == before["citations"]
    assert current["analysis"]["revisions"][-1] == before["analysis"]["revisions"][0]
    assert current["analysis"]["selection"]["current_analysis_revision_id"] == second
    for field in ("status", "collected_at", "finished_at", "input_snapshot"):
        assert current["run"][field] == before["run"][field]
    assert send(api, case).json()["analysis_revision_id"] == second
    for document in (contract, app.openapi()):
        validate(document, "GeoRunReanalysisAccepted", receipt)
        validate(document, "GeoRunDetail", current)
    with api.harness.factory() as db:
        audit = db.scalar(select(AuditLog).where(AuditLog.target_id == second))
        assert audit.action == "geo_observation_run.reanalyzed"
        assert audit.details["facts"] == {
            "run_id": str(case.run_id),
            "analysis_revision_id": second,
            "reason_code": "DICTIONARY_UPDATED",
        }
        assert before["answer"]["answer_text"] not in json.dumps(audit.details, ensure_ascii=False)


def test_http_auth_csrf_closed_input_revision_and_flag(api, monkeypatch):
    case = api.create(review_required=False)
    url = f"{RUNS}/{case.run_id}/reanalyze"
    body = {"expected_revision": api.harness.run(case.run_id).revision, "reason": "FACTS_UPDATED"}
    for client, expected in ((api.anonymous, 401), (api.engineer, 403)):
        assert client.post(url, json=body).status_code == expected
    assert api.admin.post(url, json=body, headers={"X-CSRF-Token": "wrong" * 8}).status_code == 403
    for patch in (
        {"reason": "自由文本"},
        {"reason": None},
        {"expected_revision": True},
        {"expected_revision": "1"},
        {"expected_revision": -1},
        {"facts": []},
    ):
        assert send(api, case, **patch).status_code == 422
    assert send(api, case, expected_revision=0).json()["error"]["code"] == "REVISION_CONFLICT"
    assert api.admin.post(f"{RUNS}/{uuid4()}/reanalyze", json=body).status_code == 404
    monkeypatch.setattr(settings, "geo_monitoring_enabled", False)
    assert (
        "REANALYZE"
        not in api.admin.get(f"{RUNS}/{case.run_id}").json()["analysis"]["available_actions"]
    )
    assert send(api, case).json()["error"]["code"] == "GEO_PLAN_PROFILE_INELIGIBLE"
    assert count(api, case.run_id) == 1
    assert not api.messages


def test_http_collected_but_first_analysis_unfinished_is_rejected(api):
    case = api.harness.create(answer_text="未结束首次分析的虚构回答。")
    assert send(api, case).json()["error"]["code"] == "INVALID_STATE_TRANSITION"
    assert (
        "REANALYZE"
        not in api.admin.get(f"{RUNS}/{case.run_id}").json()["analysis"]["available_actions"]
    )
    assert count(api, case.run_id) == 0


def test_failed_first_analysis_can_reanalyze_without_restoring_collection(api):
    case = api.harness.create(answer_text="虚构首次分析失败。")
    first = runs.prepare_collected_run(case.run_id)
    assert runs.submit_analysis_failure(runs.claim_analysis_revision(first))
    before = api.admin.get(f"{RUNS}/{case.run_id}").json()
    assert before["run"]["status"] == "FAILED"
    assert "REANALYZE" in before["analysis"]["available_actions"]
    response = send(api, case, reason="RETRY_FAILED")
    assert response.status_code == 200, response.text
    second = UUID(response.json()["analysis_revision_id"])
    runs.process_analysis_revision(second)
    after = api.admin.get(f"{RUNS}/{case.run_id}").json()
    assert after["run"]["status"] == "FAILED"
    assert after["run"]["finished_at"] == before["run"]["finished_at"]
    assert after["answer"] == before["answer"]
    assert after["analysis"]["selection"]["current_analysis_revision_id"] == str(second)
    assert after["data_quality"]["metric_eligible"] is False
    assert after["analysis"]["revisions"][-1] == before["analysis"]["revisions"][0]


def test_broker_loss_keeps_accepted_pending_revision(api, monkeypatch):
    from app.worker import analyze_geo_revision

    def unavailable(_):
        raise RuntimeError("虚构Broker不可用")

    monkeypatch.setattr(analyze_geo_revision, "delay", unavailable)
    case = api.create(review_required=False)
    response = send(api, case)
    assert response.status_code == 200, response.text
    identity = UUID(response.json()["analysis_revision_id"])
    assert api.harness.analysis(identity).status == "PENDING"
    assert api.harness.run(case.run_id).current_analysis_revision_id != identity
    runs.process_analysis_revision(identity)
    assert api.harness.run(case.run_id).current_analysis_revision_id == identity


def test_audit_failure_rolls_back_freeze_and_returns_safe_unknown(api, monkeypatch, caplog):
    case = api.create(review_required=False)
    before = api.harness.run(case.run_id)

    def fail(*_):
        raise RuntimeError("core06-sensitive-sql-payload")

    monkeypatch.setattr(service, "append_audit", fail)
    with TestClient(app, raise_server_exceptions=False) as client:
        client.cookies.update(api.admin.cookies)
        client.headers.update(api.admin.headers)
        response = client.post(
            f"{RUNS}/{case.run_id}/reanalyze",
            json={"expected_revision": before.revision, "reason": "RULES_UPDATED"},
        )
    assert response.status_code == 500
    assert count(api, case.run_id) == 1
    assert not api.messages
    assert (
        api.harness.run(case.run_id).current_analysis_revision_id
        == before.current_analysis_revision_id
    )
    assert "core06-sensitive-sql-payload" not in response.text + caplog.text
