"""CORE-05：真实PG完整机会集合、稳定分批、安全列、独立审计与RR生命周期。"""

import csv
import io
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, select

from app.models.geo_opportunities import GeoOpportunity, GeoOpportunitySource
from app.models.identity import AuditLog, User
from app.schemas.geo_opportunity_workbench import GeoOpportunityFilters
from app.services import geo_reports
from app.services.geo_opportunity_csv import COLUMNS
from tests.integration.test_geo_opportunity_summary import clone, counts, query
from tests.integration.test_geo_opportunity_workbench import (
    PATH,
    analysis_engine,
    answer_database,
    api,
    harness,
    opportunity,
    overview_api,
    plan_database,
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
EXPORT = PATH + "/export.csv"


def decoded(response):
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"\xef\xbb\xbf")
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Content-Type"] == "text/csv; charset=utf-8"
    assert response.headers["Content-Disposition"].startswith(
        'attachment; filename="geo-opportunities-'
    )
    values = csv.DictReader(io.StringIO(response.content.decode("utf-8-sig")))
    assert values.fieldnames == list(COLUMNS)
    rows = list(values)
    assert {row["as_of"] for row in rows} == {response.headers["X-Report-As-Of"]}
    return rows


def audit_rows(api):
    with api.harness.factory() as db:
        return list(db.scalars(select(AuditLog).where(AuditLog.target_type == "GeoReport")))


@pytest.mark.parametrize("sort", ["PRIORITY_DESC", "CREATED_DESC", "LAST_SEEN_DESC"])
def test_full_filtered_set_keyset_order_ties_and_saved_source_dedup(api, monkeypatch, sort):
    _, scope, _, identity = opportunity(api)
    with api.harness.factory() as db:
        timestamp = db.get(GeoOpportunity, UUID(identity)).created_at

    # 在首次落库前设置平局时间，不修改已保存机会的不可变identity时间。
    def seed_clock(_mapper, _connection, target):
        target.created_at = timestamp
        target.last_seen_at = timestamp

    event.listen(GeoOpportunity, "before_insert", seed_clock)
    try:
        identities = [identity] + [
            clone(api, identity, priority)
            for priority in ("LOW", "CRITICAL", "HIGH", "MEDIUM", "HIGH")
        ]
    finally:
        event.remove(GeoOpportunity, "before_insert", seed_clock)
    with api.harness.factory.begin() as db:
        original = db.get(GeoOpportunity, UUID(identity))
        saved = db.scalar(
            select(GeoOpportunitySource).where(GeoOpportunitySource.opportunity_id == original.id)
        )
        db.add(
            GeoOpportunitySource(
                opportunity_id=original.id,
                run_id=saved.run_id,
                analysis_revision_id=saved.analysis_revision_id,
                review_id=saved.review_id,
                source_role="SUPPORTING",
            )
        )
    monkeypatch.setattr(geo_reports, "BATCH_SIZE", 2)
    params = {"source_scope": scope.model_dump_json(), "sort": sort, "page_size": 10}
    listed = api.engineer.get(PATH, params=params).json()
    before = counts(api)
    rows = decoded(api.engineer.get(EXPORT, params=params | {"page": 999}))
    assert [row["opportunity_id"] for row in rows] == [item["id"] for item in listed["items"]]
    assert len(rows) == listed["total"] == len(set(identities))
    assert len({row["opportunity_id"] for row in rows}) == len(rows)
    assert counts(api) == before
    for filters in (
        {"priority": "HIGH"},
        {"status": "OPEN", "q": "事实"},
        {"collection_mode": "MANUAL"},
        {"product_id": str(uuid4())},
    ):
        choice = params | filters
        selected = api.engineer.get(PATH, params=choice).json()
        response = api.engineer.get(EXPORT, params=choice)
        if selected["total"]:
            assert [row["opportunity_id"] for row in decoded(response)] == [
                item["id"] for item in selected["items"]
            ]
        else:
            assert (
                response.status_code == 409
                and response.json()["error"]["code"] == "GEO_REPORT_EMPTY"
            )


def test_report_matches_pending_summary_but_workbench_can_export_closed_without_private_text(api):
    _, scope, _, identity = opportunity(api)
    acknowledged = clone(api, identity, "LOW")
    dismissed = clone(api, identity, "HIGH")
    assert (
        api.engineer.post(
            f"{PATH}/{acknowledged}/acknowledge", json={"expected_revision": 1}
        ).status_code
        == 200
    )
    assert (
        api.engineer.post(
            f"{PATH}/{dismissed}/dismiss",
            json={
                "expected_revision": 1,
                "resolution_code": "DUPLICATE",
                "resolution_comment": "private-resolution-canary",
            },
        ).status_code
        == 200
    )
    before = counts(api)
    report = api.engineer.get("/api/v1/geo/reports/preview", params=query(scope)).json()
    assert next(item for item in report["exports"] if item["kind"] == "opportunities")["available"]
    response = api.engineer.get("/api/v1/geo/reports/opportunities.csv", params=query(scope))
    rows = decoded(response)
    assert len(rows) == report["open_opportunities"]["open_count"] == 2
    assert {row["opportunity_id"] for row in rows} == {identity, acknowledged}
    closed = api.engineer.get(
        EXPORT, params={"source_scope": scope.model_dump_json(), "status": "DISMISSED"}
    )
    assert [row["opportunity_id"] for row in decoded(closed)] == [dismissed]
    assert "private-resolution-canary" not in closed.text
    excluded = {
        "description",
        "resolution_comment",
        "trigger_snapshot",
        "source_snapshot",
        "sources",
        "answer_text",
        "body_markdown",
        "navigation_path",
        "final_url",
        "object_key",
        "download_url",
    }
    assert not excluded.intersection(COLUMNS)
    assert counts(api) == before
    audit = audit_rows(api)[-1]
    assert set(audit.details["facts"]) == {"export_type", "as_of", "filter_sha256"}
    assert audit.details["facts"]["export_type"] == "opportunities"
    assert "private-" not in str(audit.details)


def test_one_rr_snapshot_survives_later_commits_and_owned_stream_closes(api, monkeypatch):
    _, scope, _, identity = opportunity(api)
    others = [clone(api, identity, "HIGH") for _ in range(3)]
    monkeypatch.setattr(geo_reports, "BATCH_SIZE", 1)
    engine = api.harness.factory.kw["bind"]
    baseline = engine.pool.checkedout()
    statements = []
    read_connection = None

    def capture(conn, _cursor, sql, _params, _context, _many):
        nonlocal read_connection
        if (
            read_connection is None
            and "geo_opportunities" in sql
            and conn.get_isolation_level() == "REPEATABLE READ"
        ):
            read_connection = conn
        if conn is read_connection:
            statements.append((sql, conn.get_isolation_level()))

    event.listen(engine, "before_cursor_execute", capture)
    try:
        with api.harness.factory() as db:
            actor = db.get(User, api.engineer_id)
            response = geo_reports.prepare_opportunities_csv(
                db,
                actor,
                GeoOpportunityFilters(source_scope=scope.model_dump_json()),
                "core05-snapshot",
            )
            initial = next(response.stream)
            first_id = list(csv.DictReader(io.StringIO(initial.decode("utf-8-sig"))))[0][
                "opportunity_id"
            ]
            changed = next(key for key in others if key != first_id)
            result = api.engineer.post(
                f"{PATH}/{changed}/dismiss",
                json={
                    "expected_revision": 1,
                    "resolution_code": "OTHER",
                    "resolution_comment": "later-private-change",
                },
            )
            assert result.status_code == 200, result.text
            later = clone(api, identity, "CRITICAL")
            data = initial + b"".join(response.stream)
            rows = list(csv.DictReader(io.StringIO(data.decode("utf-8-sig"))))
            assert {row["opportunity_id"] for row in rows} == {identity, *others}
            assert later not in {row["opportunity_id"] for row in rows}
            assert next(row for row in rows if row["opportunity_id"] == changed)["status"] == "OPEN"
            assert response.stream.closed and engine.pool.checkedout() == baseline + 1
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert statements and all(
        sql.lstrip().startswith("SELECT") and "FOR UPDATE" not in sql and level == "REPEATABLE READ"
        for sql, level in statements
    )
    assert engine.pool.checkedout() == baseline
    assert any(row.request_id == "core05-snapshot" for row in audit_rows(api))


def test_empty_validation_auth_and_failed_audit_do_not_deliver_or_leak_connection(api, monkeypatch):
    _, scope, _, identity = opportunity(api)
    before = len(audit_rows(api))
    engine = api.harness.factory.kw["bind"]
    baseline = engine.pool.checkedout()
    assert api.anonymous.get(EXPORT).status_code == 401
    response = api.engineer.get(EXPORT, params={"q": str(uuid4())})
    assert response.status_code == 409 and response.json()["error"]["code"] == "GEO_REPORT_EMPTY"
    invalid = api.engineer.get(EXPORT, params={"fields": "private-input-canary"})
    assert invalid.status_code == 422 and "private-input-canary" not in invalid.text

    def fail(*args):
        raise RuntimeError("core05-audit-failure")

    monkeypatch.setattr(geo_reports, "append_audit", fail)
    with pytest.raises(RuntimeError, match="core05-audit-failure"):
        api.engineer.get(EXPORT, params={"source_scope": scope.model_dump_json()})
    assert engine.pool.checkedout() == baseline and len(audit_rows(api)) == before
