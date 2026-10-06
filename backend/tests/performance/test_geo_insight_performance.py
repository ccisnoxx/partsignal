"""100k Run、认证 HTTP P95、实际 SQL 计划和稀疏/密集 N+1 门禁。"""

import json
import math
import os
import platform
import time
from hashlib import sha256
from pathlib import Path

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
from tests.performance.seed_geo import seed

__all__ = [
    "analysis_engine", "answer_database", "harness", "plan_database", "review_api",
    "run_database", "overview_api",
]
pytestmark = pytest.mark.performance


def test_100k_thirty_day_insights(overview_api):
    api = overview_api
    output = Path(os.environ.get("GEO_PERF_OUTPUT", "/tmp/geo607-performance"))
    phase = os.environ.get("GEO_PERF_PHASE", "candidate")
    samples = int(os.environ.get("GEO_PERF_SAMPLES", "20"))
    assert samples >= 20, "P95至少需要20个完整HTTP样本"
    sources = {
        path: sha256(Path(path).read_bytes()).hexdigest()
        for path in ("app/services/geo_overview_queries.py", "app/services/geo_overview.py",
                     "app/services/geo_answer_insights.py", "app/services/geo_metrics.py",
                     "app/schemas/geo_answers.py", "app/geo_citation_urls.py")
    }
    cases = seed(api, output)
    if os.environ.get("GEO_PERF_PROFILE") == "1":
        from tests.performance.profile_insights import profile

        profile(api.harness.database.url.replace("postgresql://", "postgresql+psycopg://", 1),
                output / "cpu-profile.txt")
    engine = api.harness.factory.kw["bind"]
    captured = []

    def capture(_conn, _cursor, statement, parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            captured.append((statement, parameters))

    base = {"date_from": "2026-09-02T00:00:00Z", "date_to": "2026-10-02T00:00:00Z"}
    product = next(s["product_id"] for s in cases[0].input["subjects"] if s["product_id"])
    scenarios = [
        ("overview_product_30d", "/api/v1/geo/overview", base | {"product_ids": product}, 3.0),
        ("insights_product_30d", "/api/v1/geo/insights", base | {"product_ids": product}, 3.0),
        ("report_product_30d", "/api/v1/geo/reports/preview", base | {"product_ids": product}, 3.0),
        ("insights_all_30d", "/api/v1/geo/insights", base, 3.0),
        ("overview_all_30d", "/api/v1/geo/overview", base, 3.0),
    ]
    results = {}
    plans = {}
    event.listen(engine, "before_cursor_execute", capture)
    try:
        for name, path, query, limit in scenarios:
            timings, counts = [], []
            for iteration in range(samples + 2):
                captured.clear()
                started = time.perf_counter()
                response = api.engineer.get(path, params=query)
                assert response.status_code == 200, response.text
                value = response.json()
                elapsed = time.perf_counter() - started
                assert response.headers["Cache-Control"] == "no-store"
                payload = value.get("insights", value)
                quality = payload["data_quality"]
                if "overview" in quality:
                    quality = quality["overview"]
                expected = 600 if "product" in name else 8400
                eligible = 420 if "product" in name else 4375
                # 由生成分布独立枚举得出；200/响应大小不能证明窗口内有密集样本。
                assert quality["candidate_run_count"] == expected
                assert quality["eligible_run_count"] == eligible
                if "current_cells" in payload:
                    assert payload["current_cells"] and payload["previous_cells"]
                if iteration >= 2:
                    timings.append(elapsed)
                    counts.append(len(captured))
            expected_selects = (13 if phase == "baseline" else 15) + int("/reports/" in path)
            assert set(counts) == {expected_selects}, f"{name}查询数漂移: {counts}"
            p95 = sorted(timings)[math.ceil(len(timings) * .95) - 1]
            results[name] = {
                "p95_seconds": p95, "target_seconds": limit, "passed": p95 <= limit,
                "samples_seconds": timings, "select_counts": counts,
                "response_bytes": len(response.content),
                "candidate_run_count": expected, "eligible_run_count": eligible,
            }
            # 参数只来自专用虚构数据库。认证查询不导出，避免会话散列进入证据。
            with psycopg.connect(api.harness.database.url) as conn:
                postgres_version = conn.info.server_version
                plans[name] = [
                    conn.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + statement, parameters)
                    .fetchone()[0][0]
                    for statement, parameters in captured
                    if "geo_" in statement
                ]
            # now、文件状态及认证查询不包含geo表。
            assert len(plans[name]) == (10 if phase == "baseline" else 12)
            sql_candidates = 8400 if phase == "baseline" else expected
            expected_rows = sql_candidates * (2 if "/overview" not in path else 1)
            assert plans[name][0]["Plan"]["Actual Rows"] == expected_rows
            (output / "benchmarks.json").write_text(json.dumps({
                "phase": phase, "samples": samples, "warmups": 2, "percentile": "nearest-rank",
                "python": platform.python_version(), "platform": platform.platform(),
                "postgres": postgres_version, "scenarios": results,
                "source_sha256": sources,
            }, ensure_ascii=False, indent=2) + "\n")
            (output / "plans.json").write_text(json.dumps(plans, indent=2, default=str) + "\n")
            print(f"{name}: P95={p95:.3f}s, SELECT={expected_selects}", flush=True)
        # 相同数据库的空/单产品/全对象候选均保持固定SQL；空结果不是N+1证据的替身。
        if phase != "baseline":
            assert all(item["passed"] for item in results.values()), results
    finally:
        event.remove(engine, "before_cursor_execute", capture)
