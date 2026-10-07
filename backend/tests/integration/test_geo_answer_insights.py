"""GEO-603真实PG/HTTP：前周期、同快照、筛选下钻和安全边界。"""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
import yaml
from sqlalchemy import event

from app.main import app
from tests.integration import geo_analysis_support
from tests.integration.geo_reviews_support import (
    analysis_engine,
    answer_database,
    harness,
    plan_database,
    review_api,
    run_database,
)
from tests.integration.test_geo_overview import overview_api, params
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
PATH = "/api/v1/geo/insights"


@pytest.mark.parametrize("path", [PATH, PATH + "/runs"])
def test_unrepresentable_previous_window_returns_validation_error(overview_api, path):
    query = params(
        overview_api,
        date_from="0001-01-02T00:00:00Z",
        date_to="0001-01-04T00:00:00Z",
    )
    if path.endswith("/runs"):
        query.update(cell_key="0" * 64, metric_code="natural_visibility")
    response = overview_api.engineer.get(path, params=query)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def insights(api, **patch):
    query = params(api, **patch)
    if "product_ids" in patch and "subject_ids" not in patch:
        query.pop("subject_ids", None)
    response = api.engineer.get(PATH, params=query)
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    return response.json()


def samples(api, card, **patch):
    drill = card["drilldown"]
    query = {k: v for k, v in drill["filters"].items() if v is not None and v != []}
    query.update({k: drill[k] for k in ("cell_key", "metric_code", "period", "cohort")})
    response = api.engineer.get(PATH + "/runs", params=query | patch)
    assert response.status_code == 200, response.text
    return response.json()


def test_equal_previous_window_uses_original_creation_time_and_zero_baseline(
    overview_api, monkeypatch
):
    api = overview_api
    pivot = datetime(2026, 10, 1, tzinfo=UTC)
    created = pivot - timedelta(hours=1)
    original = geo_analysis_support.run

    def historical_insert(conn, db, batch_id, **patch):
        # 正常INSERT冻结历史时间，不更新已创建Run、不修改生产guard。
        return original(conn, db, batch_id, created_at=created, **patch)

    monkeypatch.setattr(geo_analysis_support, "run", historical_insert)
    old = [api.create(review_required=False, products=0) for _ in range(5)]
    created = pivot
    now = [api.create(review_required=False, products=0) for _ in range(5)]
    created = pivot + timedelta(days=1)
    outside = api.create(review_required=False, products=0)
    value = insights(
        api, date_from=pivot.isoformat(), date_to=(pivot + timedelta(days=1)).isoformat()
    )
    assert value["previous_window"] == {
        "date_from": "2026-09-30T00:00:00Z",
        "date_to": "2026-10-01T00:00:00Z",
    }
    assert len(value["current_cells"]) == len(value["previous_cells"]) == 1
    visibility = next(t for t in value["trends"] if t["metric_code"] == "natural_visibility")
    assert visibility["change_points"] == 0 and visibility["relative_change"] is None
    assert visibility["unavailable_reasons"] == []
    for cells, expected in ((value["current_cells"], now), (value["previous_cells"], old)):
        card = next(c for c in cells[0]["metrics"] if c["metric_code"] == "natural_visibility")
        page = samples(api, card)
        assert {s["run_id"] for s in page["items"]} == {str(c.run_id) for c in expected}
        assert card["denominator"] == page["total"] == 5
        assert str(outside.run_id) not in str(page)


def test_empty_contract_auth_closed_queries_and_legacy_operation_preserved(overview_api):
    api = overview_api
    value = insights(api, subject_ids=str(uuid4()))
    assert (
        value["current_cells"]
        == value["previous_cells"]
        == value["trends"]
        == value["question_coverage"]
        == []
    )
    contract = yaml.safe_load((Path("/contracts") / "openapi.yaml").read_text())
    for document in (contract, app.openapi()):
        validate(document, "GeoAnswerInsights", value)
        assert document["paths"]["/api/v1/geo-insights"]["get"]["operationId"] == "getGeoInsights"
    assert api.anonymous.get(PATH, params=params(api)).status_code == 401
    for patch in (
        {"collection_modes": "AUTO"},
        {"unknown": "private-canary"},
        {"date_from": "2100-01-01T00:00:00Z"},
    ):
        response = api.engineer.get(PATH, params=params(api, **patch))
        assert response.status_code == 422 and "private-canary" not in response.text
    assert (
        api.engineer.get(
            PATH + "/runs", params=params(api, cell_key="a" * 64, metric_code="mention_sov")
        ).status_code
        == 404
    )


def test_product_platform_cells_and_sov_contributions_share_filters_and_current_review(
    overview_api,
):
    api = overview_api
    case = api.create()
    assert api.submit(case).status_code == 201
    # 产品筛选保留冻结竞品集合，而产品矩阵只引用选中产品的完整cell。
    product = next(s["product_id"] for s in case.input["subjects"] if s["product_id"])
    value = insights(api, product_ids=product)
    assert len(value["product_matrix_cell_keys"]) == 1
    keys = {c["cell_key"] for c in value["current_cells"]}
    assert set(value["product_matrix_cell_keys"]) <= keys
    assert all(set(p["cell_keys"]) <= keys for p in value["platform_performance"])
    for cell in value["current_cells"]:
        for card in cell["metrics"]:
            page = samples(api, card)
            assert sum(s["numerator"] for s in page["items"]) == card["numerator"]
            assert sum(s["denominator"] for s in page["items"]) == card["denominator"]
            assert card["drilldown"]["filters"] == value["filters"]
    assert all(t["change_points"] is None for t in value["trends"])
    assert not any(
        word in str(value)
        for word in ("answer_text", "fact_excerpt", "lease_token", "comment", "raw_payload")
    )
    empty = insights(api, product_ids=str(uuid4()))
    assert (
        empty["current_cells"]
        == empty["product_matrix_cell_keys"]
        == empty["platform_performance"]
        == []
    )
    api.reanalyze(case)
    assert insights(api, product_ids=product, review_policy="REVIEWED_ONLY")["current_cells"] == []


def test_branded_never_enters_natural_or_sov_coverage(overview_api, monkeypatch):
    api = overview_api
    monkeypatch.setitem(api.harness.database.runs.input["prompt"], "mention_mode", "BRANDED")
    api.create(review_required=False, products=0)
    value = insights(api, mention_mode="BRANDED")
    assert value["current_cells"] and value["question_coverage"] == []
    for cell in value["current_cells"]:
        for card in cell["metrics"]:
            if card["metric_code"] in {"natural_visibility", "mention_sov", "recommendation_sov"}:
                assert (
                    card["value"] is None and card["eligible_run_count"] == card["denominator"] == 0
                )


def test_rr_and_fixed_query_count_cover_both_windows_and_do_not_read_sensitive_columns(
    overview_api,
):
    api = overview_api
    case = api.create()
    inserted = False

    def after(conn, cursor, statement, parameters, context, many):
        nonlocal inserted
        if not inserted and "FROM geo_observation_runs" in statement:
            inserted = True
            assert api.submit(case).status_code == 201

    engine = api.harness.factory.kw["bind"]
    event.listen(engine, "after_cursor_execute", after)
    try:
        product = next(s["product_id"] for s in case.input["subjects"] if s["product_id"])
        value = insights(api, product_ids=product)
    finally:
        event.remove(engine, "after_cursor_execute", after)
    assert inserted
    assert all(m["eligible_run_count"] == 0 for c in value["current_cells"] for m in c["metrics"])
    counts = []
    for patch in ({"subject_ids": str(uuid4())}, {}):
        statements = []

        def before(conn, cursor, statement, parameters, context, many, statements=statements):
            assert conn.get_isolation_level() == "REPEATABLE READ"
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", before)
        try:
            insights(api, **patch)
        finally:
            event.remove(engine, "before_cursor_execute", before)
        assert all(s.lstrip().startswith("SELECT") for s in statements)
        assert not any(
            word in s
            for s in statements
            for word in ("lease_token", "ai_channel_headers", "api_key_encrypted")
        )
        counts.append(len(statements))
    assert counts == [15, 15]
