"""真实PG/HTTP报告：资格与追溯、独立审计、分批RR和失败资源释放。"""

import csv
import io
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
import yaml
from sqlalchemy import event, select

from app.main import app
from app.models.identity import AuditLog, SessionRecord, User
from app.services import geo_report_csv, geo_reports
from app.services.geo_overview_queries import load_inputs
from tests.integration.geo_answers_support import new_run
from tests.integration.geo_reviews_support import (
    analysis_engine,
    answer_database,
    harness,
    plan_database,
    review_api,
    run_database,
)
from tests.integration.geo_runs_support import run, terminal
from tests.integration.test_geo_overview import overview_api, params
from tests.integration.test_geo_reviews import empty_correction
from tests.unit.test_geo_run_contract import validate

pytestmark = pytest.mark.integration
__all__ = [
    "analysis_engine",
    "answer_database",
    "harness",
    "plan_database",
    "review_api",
    "run_database",
    "overview_api",
]
PATH = "/api/v1/geo/reports"


def request(api, endpoint, case=None, **patch):
    response = api.engineer.get(PATH + endpoint, params=params(api, case, **patch))
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    return response


def rows(api, kind, case=None, **patch):
    response = request(api, f"/{kind}.csv", case, **patch)
    assert response.content.startswith(b"\xef\xbb\xbf")
    assert response.headers["Content-Type"] == "text/csv; charset=utf-8"
    assert response.headers["Content-Disposition"].startswith(f'attachment; filename="geo-{kind}-')
    reader = csv.DictReader(io.StringIO(response.content.decode("utf-8-sig")))
    assert reader.fieldnames == list(geo_report_csv.COLUMNS[kind])
    values = list(reader)
    assert {row["as_of"] for row in values} == {response.headers["X-Report-As-Of"]}
    return values, response


def audits(api, request_id=None):
    with api.harness.factory() as db:
        query = select(AuditLog).where(AuditLog.target_type == "GeoReport")
        if request_id is not None:
            query = query.where(AuditLog.request_id == request_id)
        return list(db.scalars(query.order_by(AuditLog.created_at, AuditLog.id)))


def test_empty_report_closed_contract_auth_validation_and_unimplemented_export(overview_api):
    api = overview_api
    query = params(api, subject_ids=str(uuid4()))
    before = len(audits(api))
    report = api.engineer.get(PATH + "/preview", params=query).json()
    assert report["available"] is False and report["unavailable_reason"] == "NO_DATA"
    assert report["as_of"] == report["insights"]["as_of"]
    assert report["source_mode"] == "LIVE" and report["generated_at"] >= report["as_of"]
    contract = yaml.safe_load(
        (Path(__file__).resolve().parents[3] / "contracts/openapi.yaml").read_text()
    )
    for document in (contract, app.openapi()):
        validate(document, "GeoReportPreview", report)
    response = api.engineer.get(PATH + "/print", params=query)
    assert response.status_code == 200 and response.json()["available"] is False
    for kind in ("runs", "citations", "claims"):
        response = api.engineer.get(PATH + f"/{kind}.csv", params=query)
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "GEO_REPORT_EMPTY"
        assert response.json()["error"]["request_id"] == response.headers["X-Request-ID"]
    response = api.engineer.get(PATH + "/opportunities.csv", params=query)
    assert response.status_code == 501 and response.json()["error"]["code"] == "NOT_IMPLEMENTED"
    assert len(audits(api)) == before
    for endpoint in (
        "/preview",
        "/print",
        "/runs.csv",
        "/citations.csv",
        "/claims.csv",
        "/opportunities.csv",
    ):
        assert api.anonymous.get(PATH + endpoint, params=query).status_code == 401
        response = api.engineer.get(PATH + endpoint, params=query | {"fields": "private-canary"})
        assert response.status_code == 422 and "private-canary" not in response.text
    response = api.engineer.get(
        PATH + "/preview",
        params=query
        | {
            "date_from": "0001-01-02T00:00:00Z",
            "date_to": "0001-01-04T00:00:00Z",
        },
    )
    assert response.status_code == 422


def test_report_and_exports_follow_current_latest_review_and_keep_unjudgeable(overview_api):
    api = overview_api
    case = api.create()
    unavailable = request(api, "/preview", case).json()
    assert unavailable["unavailable_reason"] == "NO_ELIGIBLE_RUNS"
    run_rows, _ = rows(api, "runs", case)
    assert run_rows[0]["status"] == "NEEDS_REVIEW" and run_rows[0]["generic_eligible"] == "False"
    assert "CURRENT_REVIEW_REQUIRED" in run_rows[0]["exclusion_reasons"]
    for kind in ("citations", "claims"):
        assert api.engineer.get(PATH + f"/{kind}.csv", params=params(api, case)).status_code == 409
    assert api.submit(case).status_code == 201
    report = request(api, "/preview", case).json()
    assert report["available"] and report["unavailable_reason"] is None
    assert report["filters"] == report["insights"]["filters"]
    assert report["insights"]["data_quality"]["overview"]["candidate_run_count"] == 1
    assert report["insights"]["data_quality"]["overview"]["eligible_run_count"] == 1
    assert len(report["formulas"]) == 17 and report["method_notes"]
    detail = api.detail(case)["analysis"]
    claim = detail["revisions"][0]["claims"][0]
    citation = detail["revisions"][0]["citations"][0]
    claims, _ = rows(api, "claims", case)
    citations, _ = rows(api, "citations", case)
    for row in (*claims, *citations):
        assert row["run_id"] == str(case.run_id)
        assert row["analysis_revision_id"] == detail["selection"]["current_analysis_revision_id"]
        assert row["review_id"] == detail["selection"]["current_review_id"]
        assert "fact_excerpt" not in row and "explanation" not in row
    assert claims[0]["verdict"] == "UNJUDGEABLE"
    assert claims[0]["claim_assessment_id"] == claim["id"]
    assert citations[0]["citation_id"] == citation["citation_id"]
    correction = empty_correction(
        claims=[
            {
                "claim_assessment_id": claim["id"],
                "verdict": "INCORRECT",
                "severity": "HIGH",
                "explanation": "private-explanation-canary",
            }
        ],
        citations=[
            {
                "citation_id": citation["citation_id"],
                "source_category": "COMMUNITY",
                "subject_id": None,
            }
        ],
    )
    assert (
        api.submit(
            case, decision="CORRECTED", correction_payload=correction, comment="虚构修正"
        ).status_code
        == 201
    )
    assert rows(api, "claims", case)[0][0]["verdict"] == "INCORRECT"
    assert rows(api, "citations", case)[0][0]["source_category"] == "COMMUNITY"
    assert api.submit(case).status_code == 201
    assert rows(api, "claims", case)[0][0]["verdict"] == "UNJUDGEABLE"
    api.reanalyze(case)
    run_rows, _ = rows(api, "runs", case)
    assert run_rows[0]["review_id"] == ""
    assert api.engineer.get(PATH + "/claims.csv", params=params(api, case)).status_code == 409
    assert (
        api.engineer.get(
            PATH + "/runs.csv", params=params(api, case, review_policy="REVIEWED_ONLY")
        ).status_code
        == 409
    )


def test_csv_whitelist_does_not_export_url_query_or_hidden_evidence(overview_api):
    api = overview_api
    case = api.harness.create(
        products=0,
        answer_text="private-answer-canary",
        citation_urls=("https://example.com/a?signature=private-url-canary",),
    )
    from app.services.geo_analysis_runs import process_analysis_run

    process_analysis_run(case.run_id)
    for kind in ("runs", "citations"):
        values, response = rows(
            api, kind, date_from=api.harness.run(case.run_id).created_at.isoformat()
        )
        assert any(row["run_id"] == str(case.run_id) for row in values)
        assert "private-" not in response.text
        assert "normalized_url," not in response.text and "original_url," not in response.text
    assert "normalized_url_sha256" in values[0]


def test_independent_audit_is_committed_before_delivery_and_does_not_flush_heartbeat(
    overview_api, monkeypatch
):
    api = overview_api
    case = api.create()
    assert api.submit(case).status_code == 201
    with api.harness.factory() as db:
        before = list(
            db.execute(
                select(SessionRecord.id, SessionRecord.last_seen_at).where(
                    SessionRecord.user_id == api.engineer_id
                )
            )
        )
    api.engineer.headers["X-Request-ID"] = "geo606-audit-delivery"
    original_call = geo_report_csv.GeoCsvResponse.__call__

    async def before_send(response, scope, receive, send):
        # 在任何HTTP response.start之前，通过另一连接看见已经提交的开始事件。
        assert any(
            record.action == "geo_report.export_started"
            and record.details["facts"]["as_of"] == response.headers["X-Report-As-Of"]
            for record in audits(api, "geo606-audit-delivery")
        )
        await original_call(response, scope, receive, send)

    monkeypatch.setattr(geo_report_csv.GeoCsvResponse, "__call__", before_send)
    try:
        for endpoint in ("/print", "/runs.csv"):
            response = request(api, endpoint, case)
            records = audits(api, "geo606-audit-delivery")
            assert records
            latest = records[-1]
            assert latest.outcome == "SUCCESS" and latest.target_type == "GeoReport"
            facts = latest.details["facts"]
            assert set(facts) == {"as_of", "export_type", "filter_sha256"}
            assert len(facts["filter_sha256"]) == 64
            assert facts["as_of"] == (
                response.json()["as_of"].replace("Z", "+00:00")
                if endpoint == "/print"
                else response.headers["X-Report-As-Of"]
            )
    finally:
        api.engineer.headers.pop("X-Request-ID", None)
    records = audits(api, "geo606-audit-delivery")
    assert {record.action for record in records} == {
        "geo_report.print_prepared",
        "geo_report.export_started",
    }
    with api.harness.factory() as db:
        after = list(
            db.execute(
                select(SessionRecord.id, SessionRecord.last_seen_at).where(
                    SessionRecord.user_id == api.engineer_id
                )
            )
        )
    assert before == after


def test_later_batch_failure_keeps_started_audit_but_closes_real_rr_connection(
    overview_api, monkeypatch
):
    api = overview_api
    with psycopg.connect(api.harness.database.url) as conn:
        start = conn.execute("SELECT now()").fetchone()[0]
        for _ in range(2):
            new_run(conn, api.harness.database)
    from app.schemas.geo_insights import GeoOverviewFilters

    query = GeoOverviewFilters(
        date_from=start,
        date_to="2100-01-01T00:00:00Z",
        subject_ids=[api.harness.database.runs.plan.subjects[0]],
    )
    original_load = geo_report_csv.load_inputs
    calls = 0

    def fail_later(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("geo606-later-batch-failure")
        return original_load(*args, **kwargs)

    monkeypatch.setattr(geo_report_csv, "BATCH_SIZE", 1)
    monkeypatch.setattr(geo_report_csv, "load_inputs", fail_later)
    engine = api.harness.factory.kw["bind"]
    baseline = engine.pool.checkedout()
    with api.harness.factory() as db:
        actor = db.get(User, api.engineer_id)
        response = geo_reports.prepare_csv(db, actor, query, "runs", "geo606-partial")
        assert engine.pool.checkedout() == baseline + 2
        next(response.stream)
        with pytest.raises(RuntimeError, match="geo606-later-batch-failure"):
            next(response.stream)
        assert response.stream.closed and engine.pool.checkedout() == baseline + 1
    assert engine.pool.checkedout() == baseline
    records = audits(api, "geo606-partial")
    assert len(records) == 1 and records[0].action == "geo_report.export_started"


def test_audit_failure_blocks_csv_and_releases_owned_session(overview_api, monkeypatch):
    api = overview_api
    case = api.create(review_required=False, products=0)
    before = len(audits(api))
    engine = api.harness.factory.kw["bind"]
    checked_out = engine.pool.checkedout()

    def fail(*args):
        raise RuntimeError("geo606-audit-failure")

    monkeypatch.setattr(geo_reports, "append_audit", fail)
    with pytest.raises(RuntimeError, match="geo606-audit-failure"):
        request(api, "/runs.csv", date_from=api.harness.run(case.run_id).created_at.isoformat())
    assert engine.pool.checkedout() == checked_out and len(audits(api)) == before


def test_fresh_audit_rechecks_account_gate_before_returning_200(overview_api, monkeypatch):
    api = overview_api
    api.create(review_required=False, products=0)
    original = geo_reports._audit_prepared

    def disable_before_audit(*args):
        with api.harness.factory.begin() as db:
            db.get(User, api.engineer_id).must_change_password = True
        return original(*args)

    monkeypatch.setattr(geo_reports, "_audit_prepared", disable_before_audit)
    try:
        response = api.engineer.get(PATH + "/runs.csv", params=params(api))
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
    finally:
        with api.harness.factory.begin() as db:
            db.get(User, api.engineer_id).must_change_password = False


def test_keyset_batches_of_100_cover_ties_and_failed_latest_attempts(overview_api):
    api = overview_api
    database = api.harness.database
    with psycopg.connect(database.url) as conn:
        start = conn.execute("SELECT now()").fetchone()[0]
        expected = {new_run(conn, database) for _ in range(101)}
        failed = next(iter(expected))
        terminal(conn, failed, "FAILED")
        parent = next(identity for identity in expected if identity != failed)
        terminal(conn, parent, "FAILED")
        conn.commit()
        batch_id = conn.execute(
            "SELECT batch_id FROM geo_observation_runs WHERE id=%s", (parent,)
        ).fetchone()[0]
        successor = run(conn, database.runs, batch_id, attempt_no=2, previous_attempt_id=parent)
        expected.remove(parent)
        expected.add(successor)
    captured = []
    engine = api.harness.factory.kw["bind"]

    def before(conn, cursor, statement, parameters, context, many):
        if statement.startswith("SELECT geo_observation_runs.id, geo_observation_runs.created_at"):
            assert conn.get_isolation_level() == "REPEATABLE READ"
            captured.append((statement, parameters))

    event.listen(engine, "before_cursor_execute", before)
    try:
        values, _ = rows(api, "runs", date_from=start.isoformat())
    finally:
        event.remove(engine, "before_cursor_execute", before)
    assert {row["run_id"] for row in values} == {str(identity) for identity in expected}
    assert len(values) == len(expected) == 101
    assert next(row for row in values if row["run_id"] == str(failed))["status"] == "FAILED"
    assert len(captured) == 3 and all("OFFSET" not in statement for statement, _ in captured)
    assert all(100 in parameters.values() for _, parameters in captured)
    # 默认load_inputs路径保持全量洞察行为；run_ids路径只装配指定候选。
    with api.harness.factory() as db:
        db.autoflush = False
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        from app.schemas.geo_insights import GeoOverviewFilters

        query = GeoOverviewFilters.model_validate(
            params(api, date_from=start.isoformat())
            | {"subject_ids": [database.runs.plan.subjects[0]]}
        )
        _, selected = load_inputs(db, query, run_ids=[failed])
        _, all_inputs = load_inputs(db, query)
        assert [source.metric.run_id for source in selected] == [failed]
        assert {source.metric.run_id for source in all_inputs} == expected


def test_rr_batches_cannot_see_later_review_commit(overview_api, monkeypatch):
    api = overview_api
    old = api.create()
    newer = api.create(review_required=False, products=0)
    monkeypatch.setattr(geo_report_csv, "BATCH_SIZE", 1)
    inserted = False
    engine = api.harness.factory.kw["bind"]

    def after(conn, cursor, statement, parameters, context, many):
        nonlocal inserted
        if not inserted and statement.startswith(
            "SELECT geo_observation_runs.id, geo_observation_runs.created_at"
        ):
            inserted = True
            assert api.submit(old).status_code == 201

    event.listen(engine, "after_cursor_execute", after)
    try:
        values, _ = rows(api, "runs", date_from=api.harness.run(old.run_id).created_at.isoformat())
    finally:
        event.remove(engine, "after_cursor_execute", after)
    assert inserted and {row["run_id"] for row in values} == {str(old.run_id), str(newer.run_id)}
    old_row = next(row for row in values if row["run_id"] == str(old.run_id))
    assert old_row["status"] == "NEEDS_REVIEW" and old_row["review_id"] == ""
    assert api.harness.run(old.run_id).status == "COMPLETED"
