"""小数据验证性能测量合同，不冒充100k基准。"""

import psycopg
import pytest
from sqlalchemy import event

from tests.integration.geo_reviews_support import (
    analysis_engine,
    answer_database,
    harness,
    plan_database,
    review_api,
    run_database,
)
from tests.integration.test_geo_overview import overview_api
from tests.performance.seed_geo import seed_template

__all__ = ["analysis_engine", "answer_database", "harness", "plan_database", "review_api",
           "run_database", "overview_api"]
pytestmark = pytest.mark.performance

def test_measurement_contract_smoke(overview_api):
    """先用1000行验证测量装配/密度/SQL数；不产生或冒充100k P95证据。"""
    api = overview_api
    case = api.create()
    assert api.submit(case).status_code == 201
    with psycopg.connect(api.harness.database.url) as conn:
        seed_template(conn, case, 0)
    query = {"date_from": "2026-09-02T00:00:00Z", "date_to": "2026-10-02T00:00:00Z"}
    captured = []
    engine = api.harness.factory.kw["bind"]

    def capture(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            captured.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        for path, expected in (("overview", 15), ("insights", 15), ("reports/preview", 16)):
            captured.clear()
            response = api.engineer.get("/api/v1/geo/" + path, params=query)
            assert response.status_code == 200, response.text
            value = response.json()
            payload = value.get("insights", value)
            quality = payload["data_quality"]
            quality = quality.get("overview", quality)
            assert quality["candidate_run_count"] == 300
            assert len(captured) == expected
    finally:
        event.remove(engine, "before_cursor_execute", capture)
