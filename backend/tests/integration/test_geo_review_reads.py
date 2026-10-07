"""复核详情RR快照与固定查询成本，未批准事实不能被人工凭空确认。"""

import pytest
from sqlalchemy import event

from app.services import geo_analysis_runs as runs
from tests.integration.geo_reviews_support import (
    RUNS,
    analysis_engine,
    answer_database,
    harness,
    plan_database,
    review_api,
    run_database,
)
from tests.integration.test_geo_reviews import empty_correction

pytestmark = pytest.mark.integration
__all__ = [
    "analysis_engine",
    "answer_database",
    "harness",
    "plan_database",
    "review_api",
    "run_database",
]


def test_detail_cannot_mix_review_commit_between_queries(review_api):
    api = review_api
    case = api.create()
    submitted = False

    def after_run(conn, cursor, statement, parameters, context, many):
        nonlocal submitted
        if (
            submitted
            or "FROM geo_observation_runs LEFT OUTER JOIN geo_answer_snapshots" not in statement
        ):
            return
        submitted = True
        assert api.submit(case).status_code == 201

    event.listen(api.harness.factory.kw["bind"], "after_cursor_execute", after_run)
    try:
        observed = api.detail(case)
    finally:
        event.remove(api.harness.factory.kw["bind"], "after_cursor_execute", after_run)
    assert submitted
    assert observed["run"]["status"] == "NEEDS_REVIEW"
    assert observed["analysis"]["review_required"] and observed["analysis"]["reviews"] == []
    assert api.detail(case)["analysis"]["review_gate_passed"]


def test_detail_query_count_does_not_grow_with_review_history(review_api):
    api = review_api
    case = api.create()

    def capture():
        statements, levels = [], []

        def before(conn, cursor, statement, parameters, context, many):
            statements.append(statement)
            levels.append(conn.get_isolation_level())

        engine = api.harness.factory.kw["bind"]
        event.listen(engine, "before_cursor_execute", before)
        try:
            value = api.detail(case)
        finally:
            event.remove(engine, "before_cursor_execute", before)
        assert all(sql.lstrip().startswith("SELECT") for sql in statements)
        assert all(level == "REPEATABLE READ" for level in levels)
        return value, len(statements)

    _, initial = capture()
    for _ in range(4):
        assert api.submit(case).status_code == 201
    api.reanalyze(case)
    current, count = capture()
    assert len(current["analysis"]["reviews"]) == 4
    assert len(current["analysis"]["revisions"]) == 2
    assert count == initial


def test_claim_without_approved_fact_cannot_become_judgeable(review_api):
    api = review_api
    subject_name = api.harness.database.runs.input["subjects"][0]["canonical_name"]
    case = api.harness.create(products=0, answer_text=f"{subject_name}的供电电压为5 V。")
    runs.process_analysis_run(case.run_id)
    machine = api.detail(case)["analysis"]["revisions"][0]
    claim = machine["claims"][0]
    assert claim["fact_version_id"] is None and claim["verdict"] == "UNJUDGEABLE"
    correction = empty_correction(
        claims=[
            {
                "claim_assessment_id": claim["id"],
                "verdict": "ACCURATE",
                "severity": "LOW",
                "explanation": "虚构凭空判断",
            }
        ]
    )
    response = api.submit(
        case, decision="CORRECTED", correction_payload=correction, comment="虚构错误修正"
    )
    assert response.status_code == 422
    assert api.detail(case)["analysis"]["reviews"] == []
    assert api.engineer.get(f"{RUNS}/{case.run_id}").status_code == 200


def test_new_analysis_without_review_reasons_clears_old_review_workflow(review_api):
    from app.models.geo_catalog import GeoSubjectAlias
    from app.services.geo_catalog_normalization import catalog_text_key

    api = review_api
    case = api.create()
    assert api.harness.run(case.run_id).status == "NEEDS_REVIEW"
    # 当前字典不再匹配原答案里的旧型号，真实重分析因此没有待复核判断。
    with api.harness.factory.begin() as db:
        subject = case.input["subjects"][0]["id"]
        name = "虚构不在答案中的当前别名"
        db.add(
            GeoSubjectAlias(
                subject_id=subject,
                alias=name,
                normalized_alias=catalog_text_key(name),
                alias_kind="NAME",
                is_active=True,
            )
        )
    newer = api.harness.reanalyze(case.run_id)
    runs.process_analysis_revision(newer)
    current = api.detail(case)
    assert current["analysis"]["selection"]["current_analysis_revision_id"] == str(newer)
    assert current["run"]["status"] == "NEEDS_REVIEW"
    assert current["analysis"]["review_required"] is False
    assert current["analysis"]["review_gate_passed"] is True
    assert current["run"]["workflow_stage"] == "COMPLETED"
    assert current["run"]["primary_task"] == "VIEW_OBSERVATION"
    items = api.engineer.get(RUNS, params={"needs_review": True}).json()["items"]
    assert str(case.run_id) not in {row["id"] for row in items}
