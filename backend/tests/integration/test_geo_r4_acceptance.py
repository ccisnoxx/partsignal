"""R4 严重参数错误从真实分析、复核到新 revision 的可追溯验收。"""

import pytest

from app.services import geo_analysis_runs
from tests.integration.geo_reviews_support import (
    RUNS,
    analysis_engine,
    answer_database,
    harness,
    plan_database,
    review_api,
    run_database,
)

pytestmark = pytest.mark.integration
__all__ = [
    "analysis_engine",
    "answer_database",
    "harness",
    "plan_database",
    "review_api",
    "run_database",
]


def test_severe_error_requires_review_and_new_revision_invalidates_old_review(review_api):
    api = review_api
    case = api.harness.create(
        products=1,
        answer_text="GEO501-0 的供电电压为 5 V。",
        fact_body="供电电压为 3.3 V。",
        citation_urls=("https://geo-fixture-owned.test/spec",),
    )
    geo_analysis_runs.process_analysis_run(case.run_id)
    before = api.detail(case)
    original = before["analysis"]["revisions"][0]
    claim = original["claims"][0]
    assert claim["verdict"] == "INCORRECT" and claim["severity"] == "HIGH"
    assert claim["fact_version_id"] == str(case.facts[0])
    assert "3.3 V" in claim["fact_excerpt"]
    assert "HIGH_SEVERITY_INCORRECT" in original["analysis"]["review_required_reasons"]
    assert before["analysis"]["review_required"]
    assert before["data_quality"]["metric_eligible"] is False

    first = api.submit(case, comment="已人工核对错误5V声明与批准3.3V事实，确认机器风险判断")
    assert first.status_code == 201
    reviewed = api.detail(case)
    assert reviewed["analysis"]["review_gate_passed"]
    # 确认风险判断不把错误回答伪装为正确，也不提前实现全指标资格。
    assert reviewed["analysis"]["effective_results"]["claims"][0] == claim
    assert reviewed["data_quality"]["metric_eligible"] is None
    old_payload = api.payload(case)
    new_id = api.reanalyze(case)
    current = api.detail(case)
    assert current["analysis"]["selection"]["current_analysis_revision_id"] == str(new_id)
    assert current["analysis"]["selection"]["current_review_id"] is None
    assert current["analysis"]["review_required"]
    stale = api.engineer.post(f"{RUNS}/{case.run_id}/review", json=old_payload)
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "GEO_REVIEW_STALE_ANALYSIS"
    machine = next(
        row for row in current["analysis"]["revisions"] if row["analysis"]["id"] == str(new_id)
    )
    current_claim = machine["claims"][0]
    correction = {
        "schema_version": 1,
        "mentions": [],
        "recommendations": [],
        "citations": [],
        "claims": [
            {
                "claim_assessment_id": current_claim["id"],
                "verdict": "INCORRECT",
                "severity": "HIGH",
                "explanation": "人工核验后保留高风险错误，需纠正回答中的供电电压",
            }
        ],
    }
    second = api.submit(
        case, decision="CORRECTED", correction_payload=correction, comment="已逐条处理当前严重声明"
    )
    assert second.status_code == 201
    final = api.detail(case)
    assert final["answer"] == before["answer"]
    assert final["citations"] == before["citations"]
    assert original in final["analysis"]["revisions"]
    assert machine in final["analysis"]["revisions"]
    assert [row["is_current"] for row in final["analysis"]["reviews"]] == [True, False]
    assert final["analysis"]["reviews"][1]["review"] == first.json()["review"]
    effective = final["analysis"]["effective_results"]["claims"][0]
    assert effective["explanation"] == correction["claims"][0]["explanation"]
    assert effective["verdict"] == "INCORRECT" and effective["confidence"] is None
