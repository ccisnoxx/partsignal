"""人工复核真实HTTP/PG：权限、schema、当前投影、历史与原子性。"""

import json
from uuid import uuid4

import pytest
from sqlalchemy import func, select, text

from app.models.geo_analysis import GeoRunReview
from app.models.identity import AuditLog, User
from app.services import geo_reviews as service
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

pytestmark = pytest.mark.integration
__all__ = [
    "analysis_engine",
    "answer_database",
    "harness",
    "plan_database",
    "review_api",
    "run_database",
]


def empty_correction(**patch):
    return {
        "schema_version": 1,
        "mentions": [],
        "recommendations": [],
        "claims": [],
        "citations": [],
        **patch,
    }


def rows(api, case):
    with api.harness.factory() as db:
        return {
            name: db.execute(
                text(
                    f"SELECT to_jsonb(t) FROM {name} t WHERE "
                    + (
                        "run_id=:id"
                        if name in {"geo_answer_snapshots", "geo_analysis_revisions"}
                        else "analysis_revision_id IN "
                        "(SELECT id FROM geo_analysis_revisions WHERE run_id=:id)"
                    )
                ),
                {"id": case.run_id},
            ).all()
            for name in (
                "geo_answer_snapshots",
                "geo_analysis_revisions",
                "geo_entity_mentions",
                "geo_recommendations",
                "geo_claim_assessments",
                "geo_citation_classifications",
            )
        }


def test_confirm_completes_first_review_without_mutating_machine(review_api, contract):
    api = review_api
    case = api.create()
    before = api.detail(case)
    assert before["run"]["status"] == "NEEDS_REVIEW"
    assert before["analysis"]["review_required"]
    assert before["analysis"]["review_gate_passed"] is False
    assert before["data_quality"]["metric_eligible"] is False
    frozen = rows(api, case)
    response = api.submit(case)
    assert response.status_code == 201, response.text
    receipt = response.json()
    assert receipt["run_revision"] == before["run"]["revision"] + 1
    assert receipt["review"]["reviewer_id"] == str(api.engineer_id)
    current = api.detail(case)
    assert current["run"]["status"] == "COMPLETED"
    assert current["batch"]["status"] == "COMPLETED"
    assert current["analysis"]["selection"]["current_review_id"] == receipt["review"]["id"]
    assert current["analysis"]["review_gate_passed"] and not current["analysis"]["review_required"]
    assert current["data_quality"]["metric_eligible"] is None
    assert current["data_quality"]["unavailable_sections"] == ["METRICS", "OPPORTUNITIES", "RETEST"]
    assert rows(api, case) == frozen
    from app.main import app
    from tests.unit.test_geo_run_contract import validate

    for document in (contract, app.openapi()):
        validate(document, "GeoRunReviewCreated", receipt)
        validate(document, "GeoRunDetail", current)
    with api.harness.factory() as db:
        audit = db.scalar(select(AuditLog).where(AuditLog.target_id == receipt["review"]["id"]))
        assert audit.action == "geo_observation_run.reviewed"
        assert audit.details["facts"] == {
            "run_id": str(case.run_id),
            "analysis_revision_id": receipt["review"]["analysis_revision_id"],
            "review_id": receipt["review"]["id"],
            "decision": "CONFIRMED",
        }
        assert "虚构人工确认" not in json.dumps(audit.details, ensure_ascii=False)


def test_four_correction_kinds_and_latest_review_replaces_previous(review_api):
    api = review_api
    case = api.create()
    before = api.detail(case)
    machine = before["analysis"]["revisions"][0]
    subject = machine["mentions"][0]["subject_id"]
    claim = machine["claims"][0]
    citation = before["citations"][0]["id"]
    correction = empty_correction(
        mentions=[
            {
                "subject_id": subject,
                "mention_count": 0,
                "first_character_offset": None,
                "matched_aliases": [],
            }
        ],
        recommendations=[
            {
                "subject_id": subject,
                "recommendation": "NOT_RECOMMENDED",
                "rank": None,
                "rationale_excerpt": "虚构人工判定",
            }
        ],
        claims=[
            {
                "claim_assessment_id": claim["id"],
                "verdict": "PARTIAL",
                "severity": "LOW",
                "explanation": "虚构核验说明",
            }
        ],
        citations=[
            {"citation_id": citation, "source_category": "INDUSTRY_MEDIA", "subject_id": None}
        ],
    )
    first = api.submit(
        case, decision="CORRECTED", correction_payload=correction, comment="虚构人工修正"
    )
    assert first.status_code == 201, first.text
    after = api.detail(case)
    effective = after["analysis"]["effective_results"]
    assert effective["mentions"][0]["mention_count"] == 0
    assert effective["recommendations"][0]["recommendation"] == "NOT_RECOMMENDED"
    assert (
        effective["claims"][0]["verdict"] == "PARTIAL"
        and effective["claims"][0]["confidence"] is None
    )
    assert effective["citations"][0]["source_category"] == "INDUSTRY_MEDIA"
    assert after["analysis"]["revisions"] == before["analysis"]["revisions"]
    # 后一次只修引用，其余恢复机器值，不叠加第一条review。
    second = api.submit(
        case,
        decision="CORRECTED",
        correction_payload=empty_correction(
            citations=[
                {"citation_id": citation, "source_category": "COMMUNITY", "subject_id": None}
            ],
        ),
        comment="只复核引用",
    )
    assert second.status_code == 201, second.text
    latest = api.detail(case)
    assert (
        latest["analysis"]["effective_results"]["mentions"][0]["mention_count"]
        == machine["mentions"][0]["mention_count"]
    )
    assert latest["analysis"]["effective_results"]["claims"][0]["verdict"] == claim["verdict"]
    assert api.submit(case).status_code == 201
    confirmed = api.detail(case)
    assert len(confirmed["analysis"]["reviews"]) == 3
    assert sum(row["is_current"] for row in confirmed["analysis"]["reviews"]) == 1
    assert confirmed["analysis"]["effective_results"]["citations"] == machine["citations"]
    assert confirmed["run"]["finished_at"] == after["run"]["finished_at"]


def test_stale_run_analysis_and_superseded_history(review_api):
    api = review_api
    case = api.create()
    payload = api.payload(case)
    accepted = api.submit(case)
    assert accepted.status_code == 201
    stale = api.engineer.post(f"{RUNS}/{case.run_id}/review", json=payload)
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "REVISION_CONFLICT"
    newer = api.reanalyze(case)
    current = api.detail(case)
    assert current["analysis"]["selection"]["current_analysis_revision_id"] == str(newer)
    assert current["run"]["status"] == "COMPLETED"
    assert current["analysis"]["selection"]["current_review_id"] is None
    assert (
        current["analysis"]["review_required"]
        and current["data_quality"]["metric_eligible"] is False
    )
    assert current["analysis"]["reviews"][0]["is_current"] is False
    assert len(current["analysis"]["revisions"]) == 2
    # analysis和run都过期时优先说明旧分析，不能悄悄迁移review。
    stale = api.engineer.post(f"{RUNS}/{case.run_id}/review", json=payload)
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "GEO_REVIEW_STALE_ANALYSIS"
    needs = api.engineer.get(RUNS, params={"needs_review": True}).json()
    assert str(case.run_id) in {row["id"] for row in needs["items"]}
    assert current["run"]["workflow_stage"] == "REVIEW_REQUIRED"
    assert api.submit(case).status_code == 201
    completed = api.detail(case)
    assert len(completed["analysis"]["reviews"]) == 2
    assert completed["analysis"]["reviews"][0]["is_current"]
    assert not completed["analysis"]["reviews"][1]["is_current"]
    assert not completed["analysis"]["review_required"]


@pytest.mark.parametrize("field", ["mentions", "recommendations", "claims", "citations"])
def test_foreign_correction_target_rejected_without_side_effects(review_api, field):
    api = review_api
    case = api.create()
    old = api.harness.run(case.run_id)
    value = {
        "mentions": {
            "subject_id": str(uuid4()),
            "mention_count": 0,
            "first_character_offset": None,
            "matched_aliases": [],
        },
        "recommendations": {
            "subject_id": str(uuid4()),
            "recommendation": "UNKNOWN",
            "rank": None,
            "rationale_excerpt": None,
        },
        "claims": {
            "claim_assessment_id": str(uuid4()),
            "verdict": "ACCURATE",
            "severity": "LOW",
            "explanation": "虚构说明",
        },
        "citations": {"citation_id": str(uuid4()), "source_category": "OTHER", "subject_id": None},
    }[field]
    response = api.submit(
        case,
        decision="CORRECTED",
        correction_payload=empty_correction(**{field: [value]}),
        comment="虚构拒绝",
    )
    assert response.status_code == 422 and response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert api.harness.run(case.run_id).revision == old.revision
    with api.harness.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoRunReview)
                .where(GeoRunReview.run_id == case.run_id)
            )
            == 0
        )


@pytest.mark.parametrize(
    "mode,expected",
    [
        ("anonymous", 401),
        ("csrf", 403),
        ("missing-csrf", 422),
        ("disabled", 401),
        ("password", 403),
    ],
)
def test_permissions_and_csrf_are_real(review_api, mode, expected):
    api = review_api
    case = api.create()
    client = api.anonymous if mode == "anonymous" else api.engineer
    if mode == "csrf":
        client.headers["X-CSRF-Token"] = "invalid-token-with-32-characters-long"
    elif mode == "missing-csrf":
        del client.headers["X-CSRF-Token"]
    elif mode in {"disabled", "password"}:
        with api.harness.factory.begin() as db:
            user = db.get(User, api.engineer_id)
            user.is_active = mode != "disabled"
            user.must_change_password = mode == "password"
            user.revision += 1
    response = client.post(f"{RUNS}/{case.run_id}/review", json=api.payload(case))
    assert response.status_code == expected, response.text
    with api.harness.factory() as db:
        assert not db.scalar(select(GeoRunReview.id).where(GeoRunReview.run_id == case.run_id))


def test_admin_can_review_and_no_current_analysis_is_explicit(review_api):
    api = review_api
    case = api.create(review_required=False)
    response = api.admin.post(f"{RUNS}/{case.run_id}/review", json=api.payload(case))
    assert response.status_code == 201, response.text
    pending = api.harness.create()
    response = api.engineer.post(
        f"{RUNS}/{pending.run_id}/review",
        json={**api.payload(pending), "analysis_revision_id": str(uuid4())},
    )
    assert (
        response.status_code == 409
        and response.json()["error"]["code"] == "GEO_ANALYSIS_NOT_AVAILABLE"
    )


@pytest.mark.parametrize("phase", ["audit", "commit"])
def test_failure_rolls_back_review_run_batch_and_audit(review_api, monkeypatch, phase):
    api = review_api
    case = api.create()
    before = api.detail(case)
    canary = "虚构敏感正文不能回显"
    if phase == "audit":
        monkeypatch.setattr(
            service, "append_audit", lambda *args: (_ for _ in ()).throw(RuntimeError(canary))
        )
    else:
        from sqlalchemy.orm import Session

        monkeypatch.setattr(
            Session, "commit", lambda self: (_ for _ in ()).throw(RuntimeError(canary))
        )
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app, raise_server_exceptions=False) as client:
        client.cookies.update(api.engineer.cookies)
        client.headers.update(api.engineer.headers)
        response = client.post(f"{RUNS}/{case.run_id}/review", json=api.payload(case))
    assert response.status_code == 500 and canary not in response.text
    after = api.detail(case)
    assert after["run"]["revision"] == before["run"]["revision"]
    assert after["batch"]["revision"] == before["batch"]["revision"]
    assert after["analysis"]["reviews"] == []
    assert after["run"]["status"] == "NEEDS_REVIEW"
