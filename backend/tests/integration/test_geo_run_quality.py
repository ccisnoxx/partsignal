"""CORE-01：真实 PG/HTTP 证明质量与统计一致、导航只来自实际关联。"""

from uuid import UUID

import psycopg
import pytest
from sqlalchemy import select

from app.models.geo_opportunities import GeoOpportunitySource
from app.models.geo_runs import GeoObservationRun
from app.services import geo_analysis_execution, geo_analysis_runs
from tests.integration.geo_retests_support import (
    plans_api,
    post,
    questions_api,
    questions_engine,
    retest_case,
)
from tests.integration.geo_reviews_support import (
    analysis_engine,
    answer_database,
    harness,
    plan_database,
    review_api,
    run_database,
)
from tests.integration.geo_runs_support import batch, run, terminal
from tests.integration.test_geo_overview import overview_api

pytestmark = pytest.mark.integration
__all__ = [
    "plans_api",
    "questions_api",
    "questions_engine",
    "retest_case",
    "analysis_engine",
    "answer_database",
    "harness",
    "plan_database",
    "review_api",
    "run_database",
    "overview_api",
]
RUNS = "/api/v1/geo/observation-runs"


def test_quality_reuses_overview_current_review_and_metric_conditions(overview_api):
    api = overview_api
    case = api.create()
    before = api.detail(case)
    assert "CURRENT_REVIEW_REQUIRED" in before["data_quality"]["exclusion_reasons"]
    assert before["data_quality"]["review_status"] == "REQUIRED"
    assert api.submit(case).status_code == 201
    value = api.detail(case)
    quality = value["data_quality"]
    assert quality["assessment"] == "ELIGIBLE" and quality["metric_eligible"] is True
    assert quality["review_status"] == "REVIEWED" and quality["evidence_complete"]
    assert not quality["cost_recorded"]  # 未报告费用不变成零
    query = {k: v for k, v in value["navigation"]["insights"].items() if v is not None and v != []}
    response = api.engineer.get("/api/v1/geo/overview", params=query)
    assert response.status_code == 200, response.text
    overview = response.json()
    assert overview["data_quality"]["eligible_run_count"] == 1
    for subject in quality["subjects"]:
        matching = [
            cell for cell in overview["metric_cells"] if cell["subject_id"] == subject["subject_id"]
        ]
        assert matching
        metrics = {metric["metric_code"]: metric for metric in subject["metrics"]}
        for metric in matching[0]["cards"]:
            eligibility = metrics[metric["metric_code"]]
            assert eligibility["eligible"] == bool(metric["eligible_run_count"])
            assert set(eligibility["exclusion_reasons"]) == {
                reason["code"] for reason in metric["exclusion_reason_counts"]
            }
    # 没有独立引用/声明事实时，仅排除对应指标，不改变通用资格。
    plain = api.create(review_required=False)
    plain_quality = api.detail(plain)["data_quality"]
    assert plain_quality["metric_eligible"] is True
    assert any(
        "ASSESSABLE_CLAIM_UNAVAILABLE" in metric["exclusion_reasons"]
        for subject in plain_quality["subjects"]
        for metric in subject["metrics"]
    )
    assert value["navigation"]["opportunities"] == [] and value["navigation"]["retests"] == []


def test_navigation_uses_source_and_real_retest_batches(retest_case):
    case = retest_case
    plan, opportunity_id, baseline_batch_id, _ = case
    api = plan.api
    with api.factory() as db:
        original_runs = list(
            db.scalars(
                select(GeoObservationRun)
                .where(GeoObservationRun.batch_id == baseline_batch_id)
                .order_by(GeoObservationRun.repeat_index)
            )
        )
        source_id = db.scalar(
            select(GeoOpportunitySource.run_id).where(
                GeoOpportunitySource.opportunity_id == opportunity_id
            )
        )
    original_runs.sort(key=lambda run: run.id != source_id)
    original = api.engineer.get(f"{RUNS}/{original_runs[0].id}")
    assert original.status_code == 200, original.text
    navigation = original.json()["navigation"]
    assert navigation["opportunities"] == [
        {"opportunity_id": str(opportunity_id), "source_roles": ["TRIGGER"]}
    ]
    assert navigation["retests"] == []
    # 同批次另一运行不是该机会的来源，不按相似维度猜出关联。
    unrelated = api.engineer.get(f"{RUNS}/{original_runs[1].id}")
    assert unrelated.status_code == 200
    assert unrelated.json()["navigation"]["opportunities"] == []
    receipt = post(case).json()
    assert "batch_id" in receipt, receipt
    expected = [
        {
            "opportunity_id": str(opportunity_id),
            "baseline_id": receipt["baseline_id"],
            "retest_batch_id": receipt["batch_id"],
        }
    ]
    after = api.engineer.get(f"{RUNS}/{original_runs[0].id}").json()
    assert after["navigation"]["retests"] == expected
    with api.factory() as db:
        retest_run = db.scalar(
            select(GeoObservationRun).where(GeoObservationRun.batch_id == UUID(receipt["batch_id"]))
        )
    result = api.engineer.get(f"{RUNS}/{retest_run.id}")
    assert result.status_code == 200, result.text
    assert result.json()["navigation"]["retests"] == expected
    assert result.json()["data_quality"]["metric_eligible"] is False
    assert "CURRENT_ANALYSIS_UNAVAILABLE" in result.json()["data_quality"]["exclusion_reasons"]


def test_failed_run_reanalysis_does_not_restore_metric_eligibility(overview_api, monkeypatch):
    api = overview_api
    case = api.harness.create(answer_text="虚构的普通资料。")

    def fail(_value):
        raise RuntimeError("CORE-01 故意使首次分析失败")

    with monkeypatch.context() as patch:
        patch.setattr(geo_analysis_execution, "analyze", fail)
        geo_analysis_runs.process_analysis_run(case.run_id)
    assert api.harness.run(case.run_id).status == "FAILED"
    identity = api.harness.reanalyze(case.run_id)
    geo_analysis_runs.process_analysis_revision(identity)
    value = api.detail(case)
    assert value["run"]["status"] == "FAILED"
    assert value["data_quality"]["current_analysis_status"] == "COMPLETED"
    assert value["data_quality"]["metric_eligible"] is False
    assert value["data_quality"]["exclusion_reasons"] == ["RUN_NOT_COMPLETED"]


def test_historical_attempt_is_excluded_and_has_no_current_insight_link(overview_api):
    api = overview_api
    database = api.harness.database.runs
    with psycopg.connect(database.url) as conn:
        identity = batch(conn, database)
        conn.execute(
            "INSERT INTO geo_batch_subjects(batch_id,subject_id,role) VALUES (%s,%s,'PRIMARY')",
            (identity, database.plan.subjects[0]),
        )
        parent = run(conn, database, identity)
        terminal(conn, parent, "FAILED")
        conn.commit()
        successor = run(conn, database, identity, attempt_no=2, previous_attempt_id=parent)
    response = api.engineer.get(f"{RUNS}/{parent}")
    assert response.status_code == 200, response.text
    value = response.json()
    assert "SUPERSEDED_ATTEMPT" in value["data_quality"]["exclusion_reasons"]
    assert value["navigation"]["insights"] is None
    assert value["navigation"]["insights_unavailable_reason"] == "SUPERSEDED_ATTEMPT"
    assert {item["id"] for item in value["attempts"]} == {str(parent), str(successor)}
