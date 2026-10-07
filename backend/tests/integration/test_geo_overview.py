"""真实PG/HTTP Overview：同筛选下钻、current review、RR与固定查询数。"""

from uuid import uuid4

import psycopg
import pytest
from sqlalchemy import event, select

from app.models.geo_runs import GeoObservationRun
from app.models.identity import User
from tests.integration.geo_answers_support import new_run
from tests.integration.geo_reviews_support import (
    analysis_engine,
    answer_database,
    harness,
    plan_database,
    review_api,
    run_database,
)
from tests.integration.geo_runs_support import batch, run, terminal
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
]
PATH = "/api/v1/geo/overview"


@pytest.fixture
def overview_api(review_api, monkeypatch):
    # 该夹具明确配置为不要求截图；缺必需截图的反例单独验证。
    monkeypatch.setitem(
        review_api.harness.database.runs.input["profile"]["settings"], "require_screenshot", False
    )
    return review_api


def params(api, case=None, **patch):
    value = {"date_from": "2020-01-01T00:00:00Z", "date_to": "2100-01-01T00:00:00Z"}
    if case:
        value["product_ids"] = next(
            s["product_id"] for s in case.input["subjects"] if s["product_id"]
        )
    else:
        value["subject_ids"] = str(api.harness.database.runs.plan.subjects[0])
    return value | patch


def overview(api, case=None, **patch):
    response = api.engineer.get(PATH, params=params(api, case, **patch))
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    return response.json()


def samples(api, card, **patch):
    drill = card["drilldown"]
    query = {k: v for k, v in drill["filters"].items() if v is not None and v != []}
    query.update(
        {
            k: drill[k]
            for k in ("metric_code", "cell_key", "cohort", "batch_id")
            if drill[k] is not None
        }
    )
    response = api.engineer.get(PATH + "/runs", params=query | patch)
    assert response.status_code == 200, response.text
    return response.json()


def test_empty_overview_auth_validation_and_closed_public_payload(overview_api):
    api = overview_api
    value = overview(api, subject_ids=str(uuid4()))
    assert (
        value["metric_cells"]
        == value["key_products"]
        == value["risks"]
        == value["recent_batches"]
        == []
    )
    assert value["data_quality"]["candidate_run_count"] == 0
    assert all(c["value"] is None for c in value["cards"] + value["data_quality"]["cards"])
    assert value["open_opportunities"]["open_count"] is None
    from pathlib import Path

    import yaml

    from app.main import app

    contract = yaml.safe_load((Path("/contracts") / "openapi.yaml").read_text())
    for document in (contract, app.openapi()):
        validate(document, "GeoOverview", value)
    assert api.anonymous.get(PATH, params=params(api)).status_code == 401
    for patch in (
        {"date_from": "2100-01-01T00:00:00Z"},
        {"collection_modes": "AUTO"},
        {"language_codes": "bad_value"},
        {"unknown": "private-canary"},
    ):
        response = api.engineer.get(PATH, params=params(api, **patch))
        assert response.status_code == 422
        assert "private-canary" not in response.text


def test_current_review_and_all_cards_reproduce_from_same_filtered_samples(overview_api):
    api = overview_api
    case = api.create()
    before = overview(api, case)
    assert before["data_quality"]["eligible_run_count"] == 0
    assert api.submit(case).status_code == 201
    value = overview(api, case)
    assert (
        value["data_quality"]["candidate_run_count"]
        == value["data_quality"]["eligible_run_count"]
        == 1
    )
    assert len(value["key_products"]) == 1
    cards = value["cards"] + value["data_quality"]["cards"] + value["key_products"][0]["cards"]
    for card in cards:
        detail = samples(api, card)
        assert sum(row["numerator"] for row in detail["items"]) == card["numerator"]
        assert sum(row["denominator"] for row in detail["items"]) == card["denominator"]
        assert all(row["run_id"] == str(case.run_id) for row in detail["items"])
        assert card["drilldown"]["filters"] == value["filters"]
    correction = empty_correction(
        mentions=[
            {
                "subject_id": case.input["subjects"][1]["id"],
                "mention_count": 0,
                "first_character_offset": None,
                "matched_aliases": [],
            }
        ]
    )
    assert (
        api.submit(
            case, decision="CORRECTED", correction_payload=correction, comment="修正虚构提及"
        ).status_code
        == 201
    )
    current = overview(api, case, review_policy="REVIEWED_ONLY")
    card = next(
        c for c in current["key_products"][0]["cards"] if c["metric_code"] == "answer_coverage"
    )
    assert (card["numerator"], card["denominator"]) == (0, 1)
    page = samples(api, card)
    assert (
        page["items"][0]["review_id"]
        == api.detail(case)["analysis"]["selection"]["current_review_id"]
    )
    assert samples(api, card, cohort="NUMERATOR")["total"] == 0
    assert not any(
        word in str(value)
        for word in ("answer_text", "fact_excerpt", "lease_token", "comment", "raw_payload")
    )


def test_filters_are_shared_by_cells_products_risks_batches_quality(overview_api):
    api = overview_api
    case = api.create()
    assert api.submit(case).status_code == 201
    snapshot = api.harness.run(case.run_id).input_snapshot
    patch = {
        "subject_ids": snapshot["subjects"][1]["id"],
        "query_topic_ids": snapshot["prompt"]["query_topic_id"],
        "prompt_variant_ids": snapshot["prompt"]["id"],
        "engine_surface_ids": snapshot["profile"]["surface"]["id"],
        "collection_profile_ids": snapshot["profile"]["id"],
        "collection_modes": snapshot["profile"]["collection_mode"],
        "language_codes": snapshot["profile"]["language_code"],
        "region_codes": snapshot["profile"]["region_code"],
        "login_states": snapshot["profile"]["login_state"],
        "intent_types": snapshot["prompt"]["intent_type"],
        "mention_mode": snapshot["prompt"]["mention_mode"],
        "review_policy": "REVIEWED_ONLY",
    }
    value = overview(api, case, **patch)
    assert value["data_quality"]["candidate_run_count"] == 1
    assert value["recent_batches"][0]["candidate_run_count"] == 1
    for field, incompatible in (
        ("subject_ids", str(uuid4())),
        ("product_ids", str(uuid4())),
        ("query_topic_ids", str(uuid4())),
        ("prompt_variant_ids", str(uuid4())),
        ("engine_surface_ids", str(uuid4())),
        ("collection_profile_ids", str(uuid4())),
        ("collection_modes", "BROWSER"),
        ("language_codes", "fr"),
        ("region_codes", "FR"),
        ("login_states", "AUTHENTICATED"),
        ("intent_types", "BRAND"),
        ("mention_mode", "BRANDED"),
    ):
        empty = overview(api, case, **(patch | {field: incompatible}))
        assert empty["data_quality"]["candidate_run_count"] == 0, field
        assert empty["key_products"] == empty["risks"] == empty["recent_batches"] == []
    with api.harness.factory() as db:
        created = db.scalar(
            select(GeoObservationRun.created_at).where(GeoObservationRun.id == case.run_id)
        )
    assert (
        overview(api, case, date_to=created.isoformat())["data_quality"]["candidate_run_count"] == 0
    )
    assert (
        overview(api, case, date_from=created.isoformat())["data_quality"]["candidate_run_count"]
        == 1
    )


def test_repeatable_read_cannot_mix_new_review_between_queries(overview_api):
    api = overview_api
    case = api.create()
    inserted = False

    def after_run(conn, cursor, statement, parameters, context, many):
        nonlocal inserted
        if inserted or "FROM geo_observation_runs" not in statement:
            return
        inserted = True
        assert api.submit(case).status_code == 201

    engine = api.harness.factory.kw["bind"]
    event.listen(engine, "after_cursor_execute", after_run)
    try:
        value = overview(api, case)
    finally:
        event.remove(engine, "after_cursor_execute", after_run)
    assert inserted and value["data_quality"]["eligible_run_count"] == 0
    assert overview(api, case)["data_quality"]["eligible_run_count"] == 1


def test_query_count_is_fixed_with_empty_dense_and_review_history(overview_api):
    api = overview_api

    def capture(**patch):
        sqls, levels = [], []

        def before(conn, cursor, statement, parameters, context, many):
            sqls.append(statement)
            levels.append(conn.get_isolation_level())

        engine = api.harness.factory.kw["bind"]
        event.listen(engine, "before_cursor_execute", before)
        try:
            value = overview(api, **patch)
        finally:
            event.remove(engine, "before_cursor_execute", before)
        assert all(sql.lstrip().startswith("SELECT") for sql in sqls)
        assert all(level == "REPEATABLE READ" for level in levels)
        assert not any(
            word in sql
            for sql in sqls
            for word in ("lease_token", "ai_channel_headers", "api_key_encrypted")
        )
        return value, len(sqls)

    _, empty = capture(subject_ids=str(uuid4()))
    case = api.create()
    for _ in range(3):
        assert api.submit(case).status_code == 201
    for _ in range(4):
        api.create(review_required=False, products=0)
    value, dense = capture()
    assert value["data_quality"]["candidate_run_count"] >= 5
    assert empty == dense == 15


def test_new_current_analysis_does_not_reuse_old_review_and_analysis_count_is_run_level(
    overview_api,
):
    api = overview_api
    case = api.create()
    assert api.submit(case).status_code == 201
    api.reanalyze(case)
    value = overview(api, case)
    analysis = next(
        c for c in value["data_quality"]["cards"] if c["metric_code"] == "analysis_run_coverage"
    )
    assert (analysis["numerator"], analysis["denominator"]) == (1, 1)
    assert value["data_quality"]["eligible_run_count"] == 0
    assert (
        overview(api, case, review_policy="REVIEWED_ONLY")["data_quality"]["candidate_run_count"]
        == 0
    )
    assert api.submit(case).status_code == 201
    assert overview(api, case)["data_quality"]["eligible_run_count"] == 1


def test_required_screenshot_and_password_gate_are_not_relaxed(review_api):
    api = review_api
    case = api.create()
    assert api.submit(case).status_code == 201
    value = overview(api, case)
    assert value["data_quality"]["candidate_run_count"] == 1
    assert value["data_quality"]["eligible_run_count"] == 0
    assert any(
        reason["code"] == "INTEGRITY_ERROR"
        for reason in value["data_quality"]["exclusion_reason_counts"]
    )
    assert api.admin.get(PATH, params=params(api, case)).status_code == 200
    with api.harness.factory.begin() as db:
        db.get(User, api.engineer_id).must_change_password = True
    for endpoint in (PATH, PATH + "/runs"):
        response = api.engineer.get(
            endpoint,
            params=params(api, case, metric_code="eligible_runs")
            if endpoint.endswith("/runs")
            else params(api, case),
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"


def test_same_profile_id_keeps_distinct_frozen_evidence_requirements(overview_api, monkeypatch):
    api = overview_api
    with psycopg.connect(api.harness.database.url) as conn:
        start = conn.execute("SELECT now()").fetchone()[0]
    api.create(review_required=False, products=0)
    # 同ID历史配置可不同；不能以profile/batch身份替代完整冻结输入指纹。
    profile = api.harness.database.runs.input["profile"]
    monkeypatch.setitem(profile, "revision", profile["revision"] + 1)
    monkeypatch.setitem(profile["settings"], "require_screenshot", True)
    api.create(review_required=False, products=0)
    value = overview(api, date_from=start.isoformat())
    quality = value["data_quality"]
    assert quality["candidate_run_count"] == 2
    assert quality["eligible_run_count"] == 1
    assert any(r["code"] == "INTEGRITY_ERROR" for r in quality["exclusion_reason_counts"])


def test_latest_attempt_and_cross_page_composition_use_filtered_candidates(overview_api):
    api = overview_api
    db = api.harness.database.runs
    with psycopg.connect(db.url) as conn:
        start = conn.execute("SELECT now()").fetchone()[0]
        identity = batch(conn, db)
        conn.execute(
            "INSERT INTO geo_batch_subjects(batch_id,subject_id,role) VALUES (%s,%s,'PRIMARY')",
            (identity, db.plan.subjects[0]),
        )
        parent = run(conn, db, identity)
        terminal(conn, parent, "FAILED")
        conn.commit()
        successor = run(conn, db, identity, attempt_no=2, previous_attempt_id=parent)
        other = [new_run(conn, api.harness.database) for _ in range(11)]
    value = overview(api, date_from=start.isoformat())
    card = next(c for c in value["cards"] if c["metric_code"] == "eligible_runs")
    first = samples(api, card, cohort="CANDIDATE", page_size=10)
    second = samples(api, card, cohort="CANDIDATE", page_size=10, page=2)
    rows = first["items"] + second["items"]
    expected = {str(successor), *(str(item) for item in other)}
    assert first["total"] == second["total"] == len(expected)
    assert {item["run_id"] for item in rows} == expected
    assert len(rows) == len(expected) and str(parent) not in str(rows)
    excluded = samples(api, card, cohort="EXCLUDED", page_size=20)
    assert excluded["total"] == value["data_quality"]["excluded_run_count"] == len(expected)
    assert all(item["exclusion_reasons"] for item in excluded["items"])
    # 后继全局存在时，原attempt即使落在窗口内也不能重新变成一个样本。
    with api.harness.factory() as session:
        created = session.scalar(
            select(GeoObservationRun.created_at).where(GeoObservationRun.id == successor)
        )
    empty = overview(api, date_from=start.isoformat(), date_to=created.isoformat())
    assert empty["data_quality"]["candidate_run_count"] == 0
