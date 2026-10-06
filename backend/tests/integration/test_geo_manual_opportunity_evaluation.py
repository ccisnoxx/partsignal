"""GEO-1006 真实 PostgreSQL/管理员 API：冻结重放、权限和原子事务。"""

import traceback
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.deps import CURRENT_SESSION_ID
from app.errors import AppError
from app.main import app
from app.models.geo_opportunities import (
    GeoOpportunity,
    GeoOpportunityAction,
    GeoOpportunityEvaluation,
)
from app.models.geo_opportunity_evaluation import GeoOpportunityEvaluationRun
from app.models.geo_retests import GeoRetestRequest
from app.models.geo_runs import GeoObservationBatch
from app.models.identity import AuditLog, SessionRecord, User
from app.schemas.geo_insights import GeoOverviewFilters
from app.schemas.geo_opportunity_evaluation import GeoOpportunityEvaluationRequest
from app.schemas.geo_rules import GeoRuleUpdateRequest
from app.services import geo_opportunities, geo_rules
from app.services import geo_opportunity_evaluation as service
from tests.integration.test_geo_opportunities import (
    analysis_engine,
    answer_database,
    api,
    harness,
    overview_api,
    plan_database,
    prepared,
    review_api,
    run_database,
)

pytestmark = pytest.mark.integration
__all__ = [
    "analysis_engine",
    "answer_database",
    "api",
    "harness",
    "overview_api",
    "plan_database",
    "review_api",
    "run_database",
]
PATH = "/api/v1/geo/opportunities/evaluate"


def payload(api, filters=None, **patch):
    with api.harness.factory() as db:
        revision = geo_rules.get_rules(db).revision
    return {
        "scope": "FILTERED" if filters else "ALL",
        "date_from": (datetime.now(UTC) - timedelta(days=7)).isoformat(),
        "date_to": (datetime.now(UTC) + timedelta(minutes=1)).isoformat(),
        "rule_set_revision": revision,
        "subject_ids": [str(v) for v in filters.subject_ids] if filters else [],
        **patch,
    }


def post(api, value, key=None, client=None):
    return (client or api.admin).post(
        PATH, json=value, headers={"Idempotency-Key": key or str(uuid4())}
    )


def counts(api):
    with api.harness.factory() as db:
        return tuple(
            db.scalar(select(func.count()).select_from(model))
            for model in (
                GeoOpportunityEvaluationRun,
                GeoOpportunityEvaluation,
                GeoOpportunity,
                GeoOpportunityAction,
                GeoRetestRequest,
                GeoObservationBatch,
                AuditLog,
            )
        )


def test_admin_real_evaluation_receipt_sources_audit_and_no_automatic_followups(api):
    case, filters, _ = prepared(api)
    frozen = api.harness.run(case.run_id).input_snapshot
    value = payload(
        api,
        filters,
        engine_surface_ids=[frozen["profile"]["surface"]["id"]],
        collection_profile_ids=[frozen["profile"]["id"]],
        collection_modes=[frozen["profile"]["collection_mode"]],
    )
    before = counts(api)
    key = "geo1006-private-key-canary"
    response = post(api, value, key)
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    receipt = response.json()
    assert receipt["created"] >= 1 and not receipt["replayed"]
    assert receipt["evaluated_cells"] == sum(
        receipt[k] for k in ("created", "existing_reused", "skipped")
    )
    assert receipt["unavailable_reasons"]
    after = counts(api)
    assert before[3:6] == after[3:6]
    with api.harness.factory() as db:
        record = db.get(GeoOpportunityEvaluationRun, UUID(receipt["evaluation_run_id"]))
        assert record.receipt == receipt
        assert record.request_snapshot["subject_ids"] == value["subject_ids"]
        opportunity = db.scalar(
            select(GeoOpportunity).where(
                GeoOpportunity.subject_id.in_(filters.subject_ids),
                GeoOpportunity.rule_code == "CRITICAL_FACT_ERROR",
            )
        )
        assert opportunity.trigger_snapshot["sources"][0]["run_id"] == str(case.run_id)
        assert (
            opportunity.trigger_snapshot["rule_snapshot"]["rule_set_revision"]
            == (value["rule_set_revision"])
        )
        audit = db.scalar(select(AuditLog).where(AuditLog.action == "geo_opportunity.evaluated"))
        assert audit.target_id == receipt["evaluation_run_id"]
        assert audit.actor_id == api.harness.database.runs.plan.actor
        assert audit.details["facts"]["created"] == receipt["created"]
        assert key not in str(record.request_snapshot) + str(record.receipt) + str(audit.details)
        assert "虚构核验" not in str(audit.details)
    from pathlib import Path

    import yaml

    from app.main import app
    from tests.unit.test_geo_run_contract import validate

    contract = yaml.safe_load((Path("/contracts") / "openapi.yaml").read_text())
    for document in (contract, app.openapi()):
        validate(document, "GeoOpportunityEvaluationReceipt", receipt)


def test_replay_freezes_original_as_of_despite_new_review_and_new_key_reuses_opportunity(api):
    case, filters, correction = prepared(api)
    value, key = payload(api, filters), str(uuid4())
    original = post(api, value, key).json()
    before = counts(api)
    with api.harness.factory() as db:
        opportunities = list(db.scalars(select(GeoOpportunity)))
        frozen = {o.id: (deepcopy(o.trigger_snapshot), o.revision) for o in opportunities}
    assert api.submit(case, decision="CORRECTED", correction_payload=correction).status_code == 201
    after_review = counts(api)
    replay = post(api, value, key)
    assert replay.status_code == 200, replay.text
    assert replay.json() == original | {"replayed": True}
    assert counts(api) == after_review
    different = post(
        api, value | {"date_to": (datetime.now(UTC) + timedelta(hours=1)).isoformat()}, key
    )
    assert (
        different.status_code == 409 and different.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    )
    assert counts(api) == after_review
    fresh = post(api, value).json()
    assert fresh["created"] == 0 and fresh["existing_reused"] >= 1
    assert fresh["evaluation_run_id"] != original["evaluation_run_id"]
    assert fresh["as_of"] != original["as_of"]
    assert counts(api)[2:6] == before[2:6]
    with api.harness.factory() as db:
        for identity, (snapshot, revision) in frozen.items():
            current = db.get(GeoOpportunity, identity)
            assert current.trigger_snapshot == snapshot and current.revision >= revision
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.action == "geo_opportunity.evaluated",
                    AuditLog.target_id.in_(
                        [original["evaluation_run_id"], fresh["evaluation_run_id"]]
                    ),
                )
            )
            == 2
        )


def test_concurrent_same_key_returns_one_frozen_receipt(api):
    _, filters, _ = prepared(api)
    value = GeoOpportunityEvaluationRequest.model_validate(payload(api, filters))
    key, barrier = str(uuid4()), Barrier(2)
    before = counts(api)

    def execute():
        with api.harness.factory() as db:
            actor = db.get(User, api.harness.database.runs.plan.actor)
            barrier.wait(timeout=10)
            return service.run_evaluation(
                db, value, actor=actor, request_id="geo1006-concurrent", idempotency_key=key
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(execute) for _ in range(2)]
        results = [f.result(timeout=30) for f in futures]
    assert results[0].evaluation_run_id == results[1].evaluation_run_id
    assert results[0].as_of == results[1].as_of
    assert sorted(r.replayed for r in results) == [False, True]
    assert counts(api)[0] == before[0] + 1
    with api.harness.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.action == "geo_opportunity.evaluated",
                    AuditLog.target_id == str(results[0].evaluation_run_id),
                )
            )
            == 1
        )


@pytest.mark.parametrize("rejected", ["engineer", "anonymous", "csrf", "missing_key", "bad_key"])
def test_http_permission_csrf_and_required_idempotency_reject_without_business_writes(
    api, rejected
):
    value, before = payload(api), counts(api)
    if rejected in {"engineer", "anonymous"}:
        response = post(api, value, client=getattr(api, rejected))
        expected = 403 if rejected == "engineer" else 401
    elif rejected == "csrf":
        response = api.admin.post(
            PATH,
            json=value,
            headers={
                "Idempotency-Key": str(uuid4()),
                "X-CSRF-Token": "x" * 40,
            },
        )
        expected = 403
    elif rejected == "missing_key":
        response = api.admin.post(PATH, json=value)
        expected = 422
    else:
        response = post(api, value, "invalid key")
        expected = 422
    assert response.status_code == expected, response.text
    assert counts(api) == before


@pytest.mark.parametrize("field", ["geo_monitoring_enabled", "geo_opportunity_evaluation_enabled"])
def test_closed_feature_flags_reject_new_requests_and_existing_receipt_replays(
    api, monkeypatch, field
):
    value, key = payload(api), str(uuid4())
    assert post(api, value, key).status_code == 200
    before = counts(api)
    monkeypatch.setattr(settings, field, False)
    for request_key in (key, str(uuid4())):
        response = post(api, value, request_key)
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "GEO_MONITORING_DISABLED"
    assert counts(api) == before


@pytest.mark.parametrize(
    "patch",
    [
        {"scope": "FILTERED"},
        {"scope": "ALL", "subject_ids": [str(uuid4())]},
        {"date_from": "2020-01-01T00:00:00Z"},
        {"date_from": "2026-01-01T00:00:00"},
        {"rule_set_revision": 0},
        {"rule_set_revision": None},
        {"private": "private-input-canary"},
    ],
)
def test_explicit_request_validation(api, patch):
    before = counts(api)
    response = post(api, payload(api, **patch))
    assert response.status_code == 422, response.text
    assert "private-input-canary" not in response.text
    assert counts(api) == before


def test_rule_revision_is_explicit_and_missing_revision_does_not_write(api):
    _, filters, _ = prepared(api)
    value = payload(api, filters)
    with api.harness.factory() as db:
        current = geo_rules.get_rules(db)
        geo_rules.update_rules(
            db,
            GeoRuleUpdateRequest(
                expected_revision=current.revision,
                configuration=current.configuration.model_copy(
                    update={"visibility_drop_points": 0.25}
                ),
            ),
            actor=db.get(User, api.harness.database.runs.plan.actor),
            request_id="geo1006-rules",
        )
    response = post(api, value)
    assert response.status_code == 200 and response.json()["rule_set_revision"] == current.revision
    with api.harness.factory() as db:
        rows = list(db.scalars(select(GeoOpportunityEvaluation)))
        assert rows and all(r.rule_set_revision == current.revision for r in rows)
    before = counts(api)
    missing = post(api, value | {"rule_set_revision": 999999})
    assert missing.status_code == 404
    assert counts(api) == before


@pytest.mark.parametrize(
    "filter_field", ["subject_ids", "engine_surface_ids", "collection_profile_ids"]
)
def test_empty_filtered_scope_has_unavailable_reasons_without_opportunities(api, filter_field):
    prepared(api)
    before = counts(api)
    response = post(api, payload(api, scope="FILTERED", **{filter_field: [str(uuid4())]}))
    assert response.status_code == 200, response.text
    receipt = response.json()
    assert receipt["created"] == receipt["existing_reused"] == 0
    assert receipt["skipped"] == receipt["evaluated_cells"]
    assert {r["code"] for r in receipt["unavailable_reasons"]} == {"NO_CANDIDATES"}
    assert counts(api)[2:6] == before[2:6]


@pytest.mark.parametrize(
    "change,code",
    [
        ({"account_type": "ENGINEER"}, "PERMISSION_DENIED"),
        ({"is_active": False}, "AUTH_REQUIRED"),
        ({"must_change_password": True}, "PASSWORD_CHANGE_REQUIRED"),
        ({}, "AUTH_REQUIRED"),
    ],
)
def test_authenticated_admin_identity_is_rechecked_before_evaluation_lock(
    api, monkeypatch, change, code
):
    before = counts(api)
    command = service.current_actor_command

    @contextmanager
    def changed_after_auth(db, actor, **kwargs):
        # HTTP ADMIN dependency 已通过；独立事务改变身份，锁内必须刷新陈旧 ORM。
        with api.harness.factory.begin() as writer:
            if change:
                writer.execute(User.__table__.update().where(User.id == actor.id).values(**change))
            else:
                writer.execute(
                    SessionRecord.__table__.update()
                    .where(SessionRecord.id == db.info[CURRENT_SESSION_ID])
                    .values(revoked_at=datetime.now(UTC))
                )
        with command(db, actor, **kwargs) as current:
            yield current

    monkeypatch.setattr(service, "current_actor_command", changed_after_auth)
    try:
        response = post(api, payload(api))
        assert response.status_code in {401, 403}
        assert response.json()["error"]["code"] == code
        assert counts(api) == before
    finally:
        with api.harness.factory.begin() as db:
            db.execute(
                User.__table__.update()
                .where(User.id == api.harness.database.runs.plan.actor)
                .values(account_type="ADMIN", is_active=True, must_change_password=False)
            )


def test_domain_evaluator_also_rejects_engineer(api):
    before = counts(api)
    with api.harness.factory() as db, pytest.raises(AppError) as failure:
        geo_opportunities.evaluate_opportunities(
            db,
            GeoOverviewFilters(
                date_from=datetime.now(UTC) - timedelta(days=1), date_to=datetime.now(UTC)
            ),
            actor=db.get(User, api.engineer_id),
            request_id="geo1006-engineer",
        )
    assert failure.value.code == "PERMISSION_DENIED"
    assert counts(api) == before


@pytest.mark.parametrize("phase", ["audit", "commit"])
def test_unknown_failure_rolls_back_without_http_or_traceback_secret(api, monkeypatch, phase):
    _, filters, _ = prepared(api)
    before = counts(api)

    def fail(*args):
        raise RuntimeError("private-evaluation-error-canary")

    def fail_commit(db):
        if any(isinstance(r, GeoOpportunityEvaluationRun) for r in db.new):
            fail()

    if phase == "audit":
        monkeypatch.setattr(service, "append_audit", fail)
    else:
        event.listen(Session, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError) as failure:
            post(api, payload(api, filters))
        assert "private-evaluation-error-canary" not in "".join(
            traceback.format_exception(failure.value)
        )
        with TestClient(app, raise_server_exceptions=False) as client:
            client.cookies.update(api.admin.cookies)
            client.headers.update(api.admin.headers)
            response = post(api, payload(api, filters), client=client)
        assert response.status_code == 500
        assert "private-evaluation-error-canary" not in response.text
        assert counts(api) == before
    finally:
        if phase == "commit":
            event.remove(Session, "before_commit", fail_commit)


def test_equivalent_timezone_and_duplicate_filters_replay_canonical_request(api):
    from datetime import timezone

    _, filters, _ = prepared(api)
    value, key = payload(api, filters), str(uuid4())
    first = post(api, value, key)
    assert first.status_code == 200, first.text
    before = counts(api)
    west = timezone(timedelta(hours=-7))
    equivalent = value | {
        "subject_ids": value["subject_ids"] * 2,
        "date_from": datetime.fromisoformat(value["date_from"]).astimezone(west).isoformat(),
        "date_to": datetime.fromisoformat(value["date_to"]).astimezone(west).isoformat(),
    }
    replay = post(api, equivalent, key)
    assert replay.status_code == 200, replay.text
    assert replay.json() == first.json() | {"replayed": True}
    assert counts(api) == before
