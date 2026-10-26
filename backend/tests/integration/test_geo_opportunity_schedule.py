"""AUTO-02真实配置/评估/窗口合同与原手动口径一致性。"""

from datetime import datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from app.config import settings
from app.models.geo_opportunities import GeoOpportunity, GeoOpportunityAction
from app.models.geo_opportunity_evaluation import GeoOpportunityEvaluationRun
from app.models.geo_opportunity_schedule import GeoOpportunityScheduleWindow
from app.models.geo_retests import GeoRetestRequest
from app.models.geo_rules import GeoRuleSetRevision
from app.models.identity import AuditLog
from app.services import geo_opportunity_scheduler as service
from tests.integration.geo_opportunity_schedule_support import (
    PATH,
    active,
    configuration,
    execute,
    prepared,
    receipts,
    windows,
)
from tests.integration.geo_opportunity_schedule_support import (
    analysis_engine as analysis_engine,
)
from tests.integration.geo_opportunity_schedule_support import (
    answer_database as answer_database,
)
from tests.integration.geo_opportunity_schedule_support import (
    api as api,
)
from tests.integration.geo_opportunity_schedule_support import (
    harness as harness,
)
from tests.integration.geo_opportunity_schedule_support import (
    overview_api as overview_api,
)
from tests.integration.geo_opportunity_schedule_support import (
    plan_database as plan_database,
)
from tests.integration.geo_opportunity_schedule_support import (
    review_api as review_api,
)
from tests.integration.geo_opportunity_schedule_support import (
    run_database as run_database,
)
from tests.unit.test_geo_run_contract import contract as contract
from tests.unit.test_geo_run_contract import validate

pytestmark = pytest.mark.integration


def test_admin_configuration_cas_flags_permissions_and_read_does_not_execute(api, monkeypatch):
    initial = api.admin.get(PATH)
    assert initial.status_code == 200 and initial.headers["cache-control"] == "no-store"
    assert initial.json()["status"] == "UNCONFIGURED"
    assert initial.json()["available_actions"] == ["CONFIGURE"]
    body = {"expected_revision": 0, "configuration": configuration(api)}
    assert api.engineer.get(PATH).status_code == 403
    assert api.engineer.put(PATH, json=body).status_code == 403
    assert api.anonymous.get(PATH).status_code == 401
    assert api.admin.put(PATH, json=body, headers={"X-CSRF-Token": "x" * 32}).status_code == 403
    response = api.admin.put(PATH, json=body)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["status"] == "DISABLED" and saved["next_run_at"] is None
    assert api.admin.put(PATH, json=body).json()["error"]["code"] == "REVISION_CONFLICT"
    assert receipts(api) == 0
    for _ in range(2):
        assert api.admin.get(PATH).json() == saved
    monkeypatch.setattr(settings, "geo_opportunity_evaluation_enabled", False)
    assert "ACTIVATE" not in api.admin.get(PATH).json()["available_actions"]
    blocked = api.admin.post(PATH + "/activate", json={"expected_revision": saved["revision"]})
    assert blocked.status_code == 409
    assert receipts(api) == 0


def test_scheduled_and_manual_use_identical_rules_filters_and_dedup_with_separate_request_identity(
    api, contract
):
    _, filters, _ = prepared(api)
    value = active(api, filters)
    due = datetime.fromisoformat(value["next_run_at"])
    payload = {
        key: val
        for key, val in value["configuration"].items()
        if key not in {"interval_hours", "lookback_days"}
    }
    payload |= {"date_from": (due - timedelta(days=7)).isoformat(), "date_to": due.isoformat()}
    identity = "auto02:" + due.isoformat(timespec="microseconds")
    before = receipts(api)
    manual = api.admin.post(
        "/api/v1/geo/opportunities/evaluate", json=payload, headers={"Idempotency-Key": identity}
    )
    assert manual.status_code == 200, manual.text
    assert manual.json()["created"] >= 1
    result = execute(api, value)
    assert result.created == 0 and result.existing_reused >= 1
    assert result.evaluated_cells == manual.json()["evaluated_cells"]
    assert result.unavailable_reasons == [
        type(r).model_validate(v)
        for r, v in zip(
            result.unavailable_reasons, manual.json()["unavailable_reasons"], strict=True
        )
    ]
    assert receipts(api) == before + 2  # 手动key不能占用后台命名空间。
    assert execute(api, value) is None
    rows = windows(api, value["revision"])
    assert len(rows) == 1 and rows[0].status == "COMPLETED"
    current = api.admin.get(PATH).json()
    validate(contract, "GeoOpportunityScheduleDetail", current)
    assert current["revision"] == value["revision"]
    assert current["latest_window"]["receipt"]["evaluation_run_id"] == str(result.evaluation_run_id)
    with api.harness.factory() as db:
        assert db.scalar(select(func.count()).select_from(GeoOpportunityAction)) == 0
        assert db.scalar(select(func.count()).select_from(GeoRetestRequest)) == 0
        audit = db.scalar(
            select(AuditLog).where(AuditLog.target_id == str(result.evaluation_run_id))
        )
        assert audit.details["facts"]["trigger_type"] == "SCHEDULED"
        assert "自动周期" in audit.result_message
        assert db.get(GeoOpportunityEvaluationRun, result.evaluation_run_id).request_snapshot[
            "date_to"
        ] == due.isoformat().replace("+00:00", "Z")


def test_downtime_records_older_range_and_evaluates_only_latest_due(api):
    value = active(api, scope="FILTERED", subject_ids=[str(uuid4())])
    due = datetime.fromisoformat(value["next_run_at"])
    before = receipts(api)
    result = execute(api, value, now=due + timedelta(hours=3, minutes=15))
    assert result.created == 0 and result.unavailable_reasons
    assert receipts(api) == before + 1
    rows = windows(api, value["revision"])
    assert len(rows) == 2
    assert rows[0].status == "MISSED" and rows[0].covered_until == due + timedelta(hours=3)
    assert rows[1].status == "COMPLETED" and rows[1].scheduled_for == rows[0].covered_until
    current = api.admin.get(PATH).json()
    assert datetime.fromisoformat(current["next_run_at"]) == due + timedelta(hours=4)
    with api.harness.factory() as db:
        with pytest.raises(DBAPIError) as caught:
            db.execute(
                text(
                    "UPDATE geo_opportunity_schedule_windows SET status=status WHERE schedule_id=1"
                )
            )
        assert caught.value.orig.sqlstate == "55000"
        db.rollback()


@pytest.mark.parametrize(
    "patch",
    [
        {"interval_hours": 0},
        {"interval_hours": 169},
        {"lookback_days": 32},
        {"lookback_days": True},
        {"scope": "FILTERED", "subject_ids": []},
        {"subject_ids": [str(uuid4())]},
        {"rule_set_revision": -1},
    ],
)
def test_invalid_configuration_does_not_write(api, patch):
    current = api.admin.get(PATH).json()
    result = api.admin.put(
        PATH,
        json={
            "expected_revision": current["revision"],
            "configuration": configuration(api, **patch),
        },
    )
    assert result.status_code == 422, result.text
    assert api.admin.get(PATH).json() == current


def test_unknown_failure_rolls_back_results_before_recording_true_failed_window(
    api, monkeypatch, caplog
):
    _, filters, _ = prepared(api)
    value = active(api, filters)
    before = receipts(api)
    with api.harness.factory() as db:
        count = db.scalar(select(func.count()).select_from(GeoOpportunity))
    original = service.run_scheduled_evaluation

    def fail(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("auto02-sensitive-canary")

    monkeypatch.setattr(service, "run_scheduled_evaluation", fail)
    assert execute(api, value) is None
    assert receipts(api) == before
    with api.harness.factory() as db:
        assert db.scalar(select(func.count()).select_from(GeoOpportunity)) == count
    rows = windows(api, value["revision"])
    assert (
        len(rows) == 1 and rows[0].status == "FAILED" and rows[0].error_code == "EVALUATION_FAILED"
    )
    assert "auto02-sensitive-canary" not in caplog.text


def test_commit_ack_loss_preserves_completed_window_instead_of_recording_failure(api, monkeypatch):
    value = active(api, scope="FILTERED", subject_ids=[str(uuid4())])
    due = datetime.fromisoformat(value["next_run_at"])
    with api.harness.factory() as db:
        commit = db.commit

        def lost():
            commit()
            raise RuntimeError("虚构commit确认丢失")

        monkeypatch.setattr(db, "commit", lost)
        assert service.execute_due_evaluation(db, now=due + timedelta(seconds=1)) is None
    rows = windows(api, value["revision"])
    assert len(rows) == 1 and rows[0].status == "COMPLETED"
    assert execute(api, value) is None


@pytest.mark.parametrize("mismatch", ["scope", "rule"])
def test_window_guard_rejects_receipt_from_another_scope_or_rule(api, mismatch):
    value = active(api, scope="FILTERED", subject_ids=[str(uuid4())])
    due = datetime.fromisoformat(value["next_run_at"])
    wrong = dict(value["configuration"])
    if mismatch == "scope":
        wrong["subject_ids"] = [str(uuid4())]
    else:
        with api.harness.factory.begin() as db:
            version = db.get(GeoRuleSetRevision, wrong["rule_set_revision"])
            revision = db.scalar(select(func.max(GeoRuleSetRevision.revision))) + 1
            db.add(
                GeoRuleSetRevision(
                    revision=revision,
                    configuration=version.configuration,
                    created_by=api.harness.database.runs.plan.actor,
                )
            )
        wrong["rule_set_revision"] = revision
    request = {
        key: val for key, val in wrong.items() if key not in {"interval_hours", "lookback_days"}
    }
    request |= {
        "date_from": (due - timedelta(days=wrong["lookback_days"])).isoformat(),
        "date_to": due.isoformat(),
    }
    result = api.admin.post(
        "/api/v1/geo/opportunities/evaluate",
        json=request,
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert result.status_code == 200, result.text
    with api.harness.factory() as db:
        db.add(
            GeoOpportunityScheduleWindow(
                schedule_id=1,
                scheduled_for=due,
                configuration_revision=value["revision"],
                configuration_snapshot={k: v for k, v in wrong.items() if k != "rule_set_revision"},
                rule_set_revision=wrong["rule_set_revision"],
                status="COMPLETED",
                evaluation_run_id=UUID(result.json()["evaluation_run_id"]),
            )
        )
        with pytest.raises(DBAPIError) as caught:
            db.commit()
        assert caught.value.orig.sqlstate == "23514"
        db.rollback()
