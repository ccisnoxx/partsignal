"""706 真实PG：冻结窗口/版本、显式CAS动作、指纹、原子性与不可变处理历史。"""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.exc import DBAPIError

from app.errors import AppError
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_opportunities import GeoOpportunity
from app.models.geo_opportunity_decisions import GeoOpportunityDecision
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.identity import AuditLog, User
from app.schemas.geo_retest_comparisons import GeoOpportunityContinueRequest
from app.services import geo_opportunity_decisions as commands
from tests.integration.geo_comparisons_support import (
    append_analysis,
    comparison_case,
    create_retest,
    finish_retest,
    payload,
    read_comparison,
)
from tests.integration.geo_retests_support import PATH, plans_api, questions_api, questions_engine

pytestmark = pytest.mark.integration
__all__ = ["comparison_case", "plans_api", "questions_api", "questions_engine"]


def test_full_windows_pending_recovery_explicit_continue_and_resolve(comparison_case):
    case = comparison_case
    initial = read_comparison(case)
    assert initial["comparison"] is None and initial["decisions"] == []
    assert initial["opportunity"]["available_actions"] == ["DISMISS", "RESOLVE", "CONTINUE"]
    batch = create_retest(case)
    pending = read_comparison(case)
    assert pending["comparison"]["recovery"]["status"] == "PENDING"
    finish_retest(case, batch)
    read = read_comparison(case)
    evidence = read["comparison"]
    assert evidence["recovery"]["status"] == "RECOVERED", evidence["recovery"]
    assert evidence["recovery"]["reference_value"] == evidence["recovery"]["threshold"] == 1
    assert evidence["recovery"]["observed_value"] == 1
    assert evidence["baseline"]["metrics"][0]["value"] == 0
    assert evidence["retest"]["metrics"][0]["value"] == 1
    assert (
        evidence["baseline"]["candidate_run_count"]
        == evidence["retest"]["candidate_run_count"]
        == 5
    )
    assert evidence["baseline"]["date_from"] < evidence["baseline"]["date_to"]
    assert evidence["causal_claim"] == "NOT_ESTABLISHED"
    response = case[0].api.engineer.post(f"{PATH}/{case[1]}/continue", json=payload(case, read))
    assert response.status_code == 200, response.text
    assert response.json()["opportunity"]["status"] == "IN_PROGRESS"
    assert response.json()["decision"]["comparison_snapshot"] == evidence
    assert response.json()["decision"]["revision_after"] == read["opportunity_revision"] + 1
    latest = read_comparison(case)
    assert len(latest["decisions"]) == 1
    assert latest["comparison"]["fingerprint"] == evidence["fingerprint"]
    response = case[0].api.engineer.post(
        f"{PATH}/{case[1]}/resolve", json=payload(case, latest, resolution_method="RETEST")
    )
    assert response.status_code == 200, response.text
    assert response.json()["opportunity"]["status"] == "RESOLVED"
    assert response.json()["opportunity"]["available_actions"] == []
    assert len(read_comparison(case)["decisions"]) == 2
    with case[0].api.factory() as db:
        logs = list(db.scalars(select(AuditLog).where(AuditLog.target_id == str(case[1]))))
        for log in logs:
            assert "明确的虚构处理依据" not in str(log.details)
        assert {log.action for log in logs} >= {
            "geo_opportunity.continued",
            "geo_opportunity.resolved",
        }


@pytest.mark.parametrize(
    "version,product,code",
    [
        ("fixture-v2", None, "MODEL_VERSION_CHANGED"),
        (None, None, "MODEL_VERSION_UNKNOWN"),
        ("fixture-v1", "changed-product", "MODEL_VERSION_CHANGED"),
    ],
)
def test_actual_model_product_changes_block_recovery(comparison_case, version, product, code):
    case = comparison_case
    batch = create_retest(case)
    finish_retest(case, batch, version=version, source_product=product)
    read = read_comparison(case)
    comparison = read["comparison"]
    assert comparison["comparable"] is False
    assert comparison["recovery"]["status"] == "NOT_COMPARABLE"
    assert code in {d["code"] for d in comparison["differences"]}
    assert all(e["source_version"] == version for e in comparison["retest"]["environments"])
    assert all(
        e["input_snapshot"]["profile"]["collection_mode"] == "MANUAL"
        for e in comparison["retest"]["environments"]
    )
    response = case[0].api.engineer.post(
        f"{PATH}/{case[1]}/resolve", json=payload(case, read, resolution_method="RETEST")
    )
    assert (
        response.status_code == 409
        and response.json()["error"]["code"] == "GEO_RETEST_NOT_RECOVERED"
    )


def test_failed_recovery_can_be_manually_resolved_with_independent_reason(comparison_case):
    case = comparison_case
    batch = create_retest(case)
    finish_retest(case, batch, mentioned=False)
    read = read_comparison(case)
    assert read["comparison"]["recovery"]["status"] == "NOT_RECOVERED"
    response = case[0].api.engineer.post(
        f"{PATH}/{case[1]}/resolve",
        json={
            "expected_revision": read["opportunity_revision"],
            "resolution_method": "MANUAL",
            "resolution_code": "CONFIRMED",
            "resolution_comment": "独立人工处理依据",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["decision"]["comparison_snapshot"] is None
    assert response.json()["decision"]["decision"] == "MANUAL_RESOLVE"


def test_current_baseline_pointer_and_batch_window_drift_do_not_change_frozen_read(comparison_case):
    case = comparison_case
    batch = create_retest(case)
    finish_retest(case, batch)
    before = read_comparison(case)["comparison"]
    with case[0].api.factory.begin() as db:
        root = db.scalar(select(GeoObservationRun).where(GeoObservationRun.batch_id == case[2]))
        answer = db.scalar(select(GeoAnswerSnapshot).where(GeoAnswerSnapshot.run_id == root.id))
        append_analysis(db, root, answer, mentioned=True)
        source_batch = db.get(GeoObservationBatch, case[2])
        source_batch.finished_at += timedelta(days=5)
        source_batch.revision += 1
    after = read_comparison(case)["comparison"]
    assert after == before
    assert all(s["analysis_revision_id"] for s in after["baseline"]["sources"])


@pytest.mark.parametrize("comparison_case", [2], indirect=True)
def test_complete_comparable_retest_below_frozen_sample_gate_cannot_resolve(comparison_case):
    case = comparison_case
    batch = create_retest(case)
    finish_retest(case, batch)
    read = read_comparison(case)
    comparison = read["comparison"]
    assert comparison["comparable"] is True
    assert comparison["retest"]["metrics"][0]["eligible_run_count"] == 2
    assert comparison["retest"]["metrics"][0]["value"] == 1
    assert comparison["recovery"]["status"] == "INSUFFICIENT_SAMPLE"
    assert comparison["recovery"]["required_run_count"] == 5
    response = case[0].api.engineer.post(
        f"{PATH}/{case[1]}/resolve", json=payload(case, read, resolution_method="RETEST")
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "GEO_RETEST_NOT_RECOVERED"
    assert read_comparison(case)["decisions"] == []


def test_cas_fingerprint_unknown_selection_csrf_and_empty_reason(comparison_case):
    case = comparison_case
    batch = create_retest(case)
    finish_retest(case, batch)
    read = read_comparison(case)
    api = case[0].api
    path = f"{PATH}/{case[1]}/continue"
    assert (
        api.engineer.post(path, json=payload(case, read, expected_revision=3)).json()["error"][
            "code"
        ]
        == "REVISION_CONFLICT"
    )
    assert (
        api.engineer.post(path, json=payload(case, read, comparison_fingerprint="0" * 64)).json()[
            "error"
        ]["code"]
        == "GEO_COMPARISON_STALE"
    )
    assert (
        api.engineer.post(path, json=payload(case, read, resolution_comment=" \u3000")).status_code
        == 422
    )
    assert (
        api.engineer.post(
            path,
            json=payload(case, read),
            headers={"X-CSRF-Token": "wrong-token-must-be-at-least-32-bytes"},
        ).status_code
        == 403
    )
    assert (
        api.engineer.get(
            f"{PATH}/{case[1]}/comparison", params={"retest_batch_id": str(uuid4())}
        ).status_code
        == 404
    )
    assert read_comparison(case)["decisions"] == []


def test_changed_retest_analysis_rejects_old_fingerprint_without_side_effects(comparison_case):
    case = comparison_case
    batch = create_retest(case)
    finish_retest(case, batch)
    before = read_comparison(case)
    with case[0].api.factory.begin() as db:
        root = db.scalar(select(GeoObservationRun).where(GeoObservationRun.batch_id == batch))
        answer = db.scalar(select(GeoAnswerSnapshot).where(GeoAnswerSnapshot.run_id == root.id))
        append_analysis(db, root, answer, mentioned=False)
    response = case[0].api.engineer.post(
        f"{PATH}/{case[1]}/resolve", json=payload(case, before, resolution_method="RETEST")
    )
    assert (
        response.status_code == 409 and response.json()["error"]["code"] == "GEO_COMPARISON_STALE"
    )
    assert read_comparison(case)["opportunity_revision"] == before["opportunity_revision"]
    assert read_comparison(case)["decisions"] == []


@pytest.mark.parametrize("failure", ["audit", "commit"])
def test_decision_failure_rolls_back_revision_decision_and_audit(
    comparison_case, monkeypatch, failure
):
    case = comparison_case
    before = read_comparison(case)
    request = GeoOpportunityContinueRequest(
        expected_revision=3, resolution_code="FOLLOWUP", resolution_comment="私密依据"
    )

    def reject(*_args, **_kwargs):
        raise RuntimeError("虚构原子失败")

    with case[0].api.factory() as db:
        if failure == "audit":
            monkeypatch.setattr(commands, "append_audit", reject)
        else:
            monkeypatch.setattr(db, "commit", reject)
        with pytest.raises(RuntimeError, match="虚构原子失败"):
            commands.continue_followup(
                db,
                case[1],
                request,
                actor=db.get(User, case[0].api.engineer_id),
                request_id="geo706-rollback",
            )
    after = read_comparison(case)
    assert after["opportunity"] == before["opportunity"]
    assert after["decisions"] == []


def test_concurrent_continue_has_one_cas_winner(comparison_case):
    case = comparison_case
    barrier = Barrier(2)

    def invoke():
        with case[0].api.factory() as db:
            actor = db.get(User, case[0].api.engineer_id)
            barrier.wait(timeout=10)
            try:
                return commands.continue_followup(
                    db,
                    case[1],
                    GeoOpportunityContinueRequest(
                        expected_revision=3,
                        resolution_code="FOLLOWUP",
                        resolution_comment="明确依据",
                    ),
                    actor=actor,
                    request_id=str(uuid4()),
                ).opportunity.status
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(lambda _: invoke(), (0, 1))) == ["IN_PROGRESS", "REVISION_CONFLICT"]
    assert len(read_comparison(case)["decisions"]) == 1


@pytest.mark.parametrize("operation", ["UPDATE", "DELETE", "TRUNCATE"])
def test_decision_history_is_immutable(comparison_case, operation):
    case = comparison_case
    response = case[0].api.engineer.post(
        f"{PATH}/{case[1]}/continue",
        json={
            "expected_revision": 3,
            "resolution_code": "FOLLOWUP",
            "resolution_comment": "明确依据",
        },
    )
    assert response.status_code == 200, response.text
    identity = UUID(response.json()["decision"]["id"])
    with case[0].api.factory() as db:
        statement = {
            "UPDATE": "UPDATE geo_opportunity_decisions SET reason_comment='altered' WHERE id=:id",
            "DELETE": "DELETE FROM geo_opportunity_decisions WHERE id=:id",
            "TRUNCATE": "TRUNCATE geo_opportunity_decisions",
        }[operation]
        with pytest.raises(DBAPIError) as rejected:
            db.execute(text(statement), {"id": identity})
        assert rejected.value.orig.sqlstate == "55000"
        db.rollback()
        assert db.get(GeoOpportunityDecision, identity).reason_comment == "明确依据"


def test_read_is_repeatable_read_no_writes_locks_or_sensitive_columns(comparison_case):
    case = comparison_case
    batch = create_retest(case)
    finish_retest(case, batch)
    statements, levels = [], []

    def capture(conn, _cursor, statement, _params, _context, _many):
        statements.append(statement)
        levels.append(conn.get_isolation_level())

    event.listen(case[0].api.engine, "before_cursor_execute", capture)
    try:
        read_comparison(case)
    finally:
        event.remove(case[0].api.engine, "before_cursor_execute", capture)
    assert all(s.lstrip().startswith("SELECT") and "FOR UPDATE" not in s for s in statements)
    assert all(level == "REPEATABLE READ" for level in levels)
    assert not any("lease_token" in s or "api_key_ciphertext" in s for s in statements)


def test_direct_sql_resolution_without_same_transaction_decision_is_rejected(comparison_case):
    case = comparison_case
    with case[0].api.factory() as db:
        db.execute(
            text(
                "UPDATE geo_opportunities SET status='RESOLVED',revision=revision+1,"
                "resolved_at=clock_timestamp(),resolved_by=:actor,resolution_code='CONFIRMED',"
                "resolution_comment='明确依据' WHERE id=:id"
            ),
            {"actor": case[0].api.engineer_id, "id": case[1]},
        )
        with pytest.raises(DBAPIError) as rejected:
            db.commit()
        assert rejected.value.orig.diag.constraint_name == "ck_geo_resolution_decision_required"
        db.rollback()
        assert db.get(GeoOpportunity, case[1]).status == "IN_PROGRESS"


def test_direct_sql_comparison_snapshot_tamper_is_rejected(comparison_case):
    case = comparison_case
    batch = create_retest(case)
    finish_retest(case, batch)
    read = read_comparison(case)
    comparison = read["comparison"]
    comparison["retest"]["metrics"][0]["numerator"] = 500
    with case[0].api.factory() as db:
        opportunity = db.get(GeoOpportunity, case[1])
        before = opportunity.revision
        opportunity.revision += 1
        db.flush()
        db.add(
            GeoOpportunityDecision(
                opportunity_id=case[1],
                decision="CONTINUE",
                reason_code="FOLLOWUP",
                reason_comment="明确依据",
                revision_before=before,
                revision_after=before + 1,
                baseline_id=UUID(comparison["baseline_id"]),
                retest_batch_id=batch,
                comparison_fingerprint=comparison["fingerprint"],
                comparison_snapshot=comparison,
                created_by=case[0].api.engineer_id,
            )
        )
        with pytest.raises(DBAPIError) as rejected:
            db.flush()
        assert rejected.value.orig.diag.constraint_name == "ck_geo_decision_comparison_identity"
        db.rollback()
    assert read_comparison(case)["decisions"] == []
