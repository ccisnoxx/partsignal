"""604真实PG/HTTP：共享域名、有效复核、事件下钻、RR与固定查询数。"""

from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
import yaml
from sqlalchemy import event

from app.main import app
from app.services import geo_analysis_runs
from tests.integration import geo_analysis_support
from tests.integration.geo_reviews_support import (
    analysis_engine,
    answer_database,
    harness,
    plan_database,
    review_api,
    run_database,
)
from tests.integration.test_geo_answer_insights import insights, samples
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
PATH = "/api/v1/geo/insights"


def detail(api, drill, **patch):
    endpoints = {
        "listGeoInsightCitations": "/citations",
        "listGeoInsightClaims": "/claims",
        "listGeoInsightQualityRuns": "/quality/runs",
    }
    query = {k: v for k, v in drill["filters"].items() if v is not None and v != []}
    query.update(
        {k: v for k, v in drill.items() if k not in {"filters", "operation_id"} and v is not None}
    )
    response = api.engineer.get(PATH + endpoints[drill["operation_id"]], params=query | patch)
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    return response.json()


def test_citation_deduplication_shared_domains_and_summary_bucket_drilldowns(
    overview_api,
    monkeypatch,
):
    api = overview_api
    monkeypatch.setitem(
        api.harness.database.runs.input["subjects"][0],
        "domains",
        [
            {"hostname": "example.com", "relation_type": "OFFICIAL"},
        ],
    )
    original = geo_analysis_support.snapshot

    def canonical_count(conn, db, run_id, **patch):
        # citation_count保存去重条数；occurrences保留三个原始位置。
        return original(conn, db, run_id, **(patch | {"citation_count": 2}))

    monkeypatch.setattr(geo_analysis_support, "snapshot", canonical_count)
    case = api.harness.create(
        products=1,
        answer_text="虚构资料。",
        citation_urls=(
            "https://example.com/a?utm_source=first#part",
            "https://EXAMPLE.com:443/a?utm_source=first",
            "https://example.com/b",
        ),
    )
    geo_analysis_runs.process_analysis_run(case.run_id)
    assert api.submit(case).status_code == 201
    product = next(s["product_id"] for s in case.input["subjects"] if s["product_id"])
    value = insights(api, product_ids=product)
    summary = value["citation_insights"][0]
    page = detail(api, summary["drilldown"])
    assert summary["citation_count"] == page["total"] == 2
    assert page["run_count"] == 1
    assert sorted(c["occurrences"] for c in page["items"]) == [[1, 2], [3]]
    assert all(c["shared_domain"] and len(c["candidate_subject_ids"]) == 2 for c in page["items"])
    for group in (summary["domains"], summary["urls"], summary["source_categories"]):
        for bucket in group:
            rows = detail(api, bucket["drilldown"])
            assert rows["total"] == bucket["citation_count"]
            assert rows["run_count"] == bucket["run_count"]
    quality = value["data_quality"]
    assert quality["shared_domain_citation_count"] == 2 and quality["shared_domain_run_count"] == 1
    assert detail(api, quality["shared_domain_drilldown"])["total"] == 1
    card = next(
        c
        for cell in value["current_cells"]
        if cell["selected_subject"]
        for c in cell["metrics"]
        if c["metric_code"] == "owned_citation_share"
    )
    assert card["denominator"] == 2 and samples(api, card)["items"][0]["denominator"] == 2


def test_claim_and_category_corrections_are_effective_and_old_review_is_not_reused(overview_api):
    api = overview_api
    case = api.create()
    machine = api.detail(case)["analysis"]["revisions"][0]
    claim = machine["claims"][0]
    citation = machine["citations"][0]
    correction = empty_correction(
        claims=[
            {
                "claim_assessment_id": claim["id"],
                "verdict": "INCORRECT",
                "severity": "HIGH",
                "explanation": "虚构人工错误核验",
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
            case, decision="CORRECTED", correction_payload=correction, comment="虚构复核修正"
        ).status_code
        == 201
    )
    product = next(s["product_id"] for s in case.input["subjects"] if s["product_id"])
    value = insights(api, product_ids=product)
    risk = value["fact_risks"][0]
    assert risk["verdict_counts"]["INCORRECT"] == risk["incorrect_severity_counts"]["HIGH"] == 1
    rows = detail(api, risk["groups"][0]["drilldown"])
    assert rows["total"] == risk["groups"][0]["claim_count"] == 1
    assert rows["items"][0]["verdict"] == "INCORRECT" and rows["items"][0]["review_id"] is not None
    assert rows["items"][0]["fact_version_id"] == str(case.facts[0])
    bucket = value["citation_insights"][0]["source_categories"][0]
    assert bucket["key"] == "COMMUNITY"
    assert detail(api, bucket["drilldown"])["items"][0]["source_category"] == "COMMUNITY"
    severe = next(
        c
        for cell in value["current_cells"]
        if cell["selected_subject"]
        for c in cell["metrics"]
        if c["metric_code"] == "severe_error_run_rate"
    )
    assert severe["numerator"] == samples(api, severe, cohort="NUMERATOR")["total"] == 1
    # 同一analysis的新CONFIRMED整条替换旧修正，恢复机器UNJUDGEABLE。
    assert api.submit(case).status_code == 201
    restored = insights(api, product_ids=product)
    assert restored["fact_risks"][0]["verdict_counts"]["UNJUDGEABLE"] == 1
    assert restored["fact_risks"][0]["verdict_counts"]["INCORRECT"] == 0
    assert (
        detail(api, restored["fact_risks"][0]["drilldown"])["items"][0]["verdict"] == "UNJUDGEABLE"
    )
    api.reanalyze(case)
    newer = insights(api, product_ids=product)
    assert (
        newer["fact_risks"][0]["claim_count"]
        == newer["citation_insights"][0]["citation_count"]
        == 0
    )
    backlog = next(
        c
        for c in newer["data_quality"]["overview"]["cards"]
        if c["metric_code"] == "review_backlog"
    )
    assert backlog["numerator"] == 1
    query = {
        "filters": newer["filters"],
        "operation_id": "listGeoInsightQualityRuns",
        "quality_code": "review_backlog",
        "cohort": "NUMERATOR",
    }
    backlog_rows = detail(api, query)
    assert backlog_rows["total"] == 1 and backlog_rows["items"][0]["review_id"] is None
    assert (
        insights(api, product_ids=product, review_policy="REVIEWED_ONLY")["data_quality"][
            "overview"
        ]["candidate_run_count"]
        == 0
    )


def test_unjudgeable_claims_have_detail_but_never_enter_accuracy_denominator(overview_api):
    api = overview_api
    case = api.create()
    assert api.submit(case).status_code == 201
    product = next(s["product_id"] for s in case.input["subjects"] if s["product_id"])
    value = insights(api, product_ids=product)
    risk = value["fact_risks"][0]
    assert risk["verdict_counts"]["UNJUDGEABLE"] == 1
    rows = detail(api, risk["drilldown"], verdict="UNJUDGEABLE")
    assert rows["total"] == 1
    accuracy = next(
        c
        for cell in value["current_cells"]
        if cell["selected_subject"]
        for c in cell["metrics"]
        if c["metric_code"] == "accurate_claim_rate"
    )
    assert accuracy["value"] is None and accuracy["denominator"] == 0
    assert accuracy["unjudgeable_claim_count"] == 1
    assert samples(api, accuracy)["total"] == 0


def test_quality_versions_exclusions_and_stable_pagination_match_summary(overview_api, monkeypatch):
    api = overview_api
    original = geo_analysis_support.run

    def isolated_window(conn, db, batch_id, **patch):
        # 模块共用数据库，按创建时的冻结窗口隔离本组数据。
        return original(
            conn, db, batch_id, **(patch | {"created_at": datetime(2020, 1, 1, tzinfo=UTC)})
        )

    monkeypatch.setattr(geo_analysis_support, "run", isolated_window)
    cases = [api.create(review_required=False, products=0) for _ in range(12)]
    value = insights(api, date_from="2020-01-01T00:00:00Z", date_to="2020-01-02T00:00:00Z")
    quality = value["data_quality"]
    all_drill = {
        "filters": value["filters"],
        "operation_id": "listGeoInsightQualityRuns",
        "quality_code": "eligible_runs",
        "cohort": "CANDIDATE",
    }
    first, second = (
        detail(api, all_drill, page_size=10),
        detail(api, all_drill, page_size=10, page=2),
    )
    rows = first["items"] + second["items"]
    assert (
        len(rows)
        == first["total"]
        == second["total"]
        == quality["overview"]["candidate_run_count"]
        == 12
    )
    assert {r["run_id"] for r in rows} == {str(c.run_id) for c in cases}
    assert len({r["run_id"] for r in rows}) == 12
    assert (
        detail(api, quality["excluded_drilldown"])["total"]
        == quality["overview"]["excluded_run_count"]
    )
    assert quality["known_costs"] == [] and all(r["cost_amount"] is None for r in rows)
    for version in quality["collection_versions"] + quality["analysis_versions"]:
        assert detail(api, version["drilldown"])["total"] == version["run_count"]
    assert all(r["source_version"] is None for r in rows)
    for word in ("answer_text", "fact_excerpt", "lease_token", "raw_payload", "comment", "api_key"):
        assert word not in str(rows)


def test_reported_costs_and_versions_round_trip_through_http(overview_api, monkeypatch):
    api = overview_api
    original_run, original_snapshot = geo_analysis_support.run, geo_analysis_support.snapshot
    costs = iter([(Decimal(0), "USD"), (Decimal(6), "USD"), (Decimal(9), "CNY"), (None, None)])
    versions = iter(["v1", "v1", "v2", None])

    def isolated_run(conn, db, batch_id, **patch):
        return original_run(
            conn, db, batch_id, **(patch | {"created_at": datetime(2021, 1, 1, tzinfo=UTC)})
        )

    def reported_snapshot(conn, db, run_id, **patch):
        version = next(versions)
        return original_snapshot(
            conn,
            db,
            run_id,
            **(
                patch
                | {
                    "source_model": "虚构模型" if version else None,
                    "source_product": "虚构产品",
                    "source_version": version,
                }
            ),
        )

    def reported_collect(conn, run_id):
        # 在首次采集同事务保存报告费用；不更新终态、不放宽生产guard。
        amount, currency = next(costs)
        conn.execute(
            "UPDATE geo_observation_runs SET status='COLLECTED', started_at=now(), "
            "collected_at=now(),cost_amount=%s,cost_currency=%s,revision=revision+1 WHERE id=%s",
            (amount, currency, run_id),
        )

    monkeypatch.setattr(geo_analysis_support, "run", isolated_run)
    monkeypatch.setattr(geo_analysis_support, "snapshot", reported_snapshot)
    monkeypatch.setattr(geo_analysis_support, "collect", reported_collect)
    cases = [api.create(review_required=False, products=0) for _ in range(4)]
    value = insights(api, date_from="2021-01-01T00:00:00Z", date_to="2021-01-02T00:00:00Z")
    quality = value["data_quality"]
    groups = {g["currency"]: g for g in quality["known_costs"]}
    assert set(groups) == {"USD", "CNY"}
    for currency, count, total, average in (("USD", 2, 6, 3), ("CNY", 1, 9, 9)):
        group = groups[currency]
        assert group["known_run_count"] == count
        assert Decimal(group["total_amount"]) == total
        assert Decimal(group["average_amount"]) == average
        rows = detail(api, group["drilldown"])
        assert rows["total"] == count
        assert all(r["cost_currency"] == currency for r in rows["items"])
        assert sum(Decimal(r["cost_amount"]) for r in rows["items"]) == total
    assert {
        Decimal(r["cost_amount"])
        for r in detail(api, groups["USD"]["drilldown"])["items"]
    } == {Decimal(0), Decimal(6)}
    for code in ("cost_coverage", "model_version_coverage"):
        card = next(c for c in quality["overview"]["cards"] if c["metric_code"] == code)
        assert (card["numerator"], card["denominator"]) == (3, 4)
        rows = detail(
            api,
            {
                "filters": value["filters"],
                "quality_code": code,
                "cohort": "CANDIDATE",
                "operation_id": "listGeoInsightQualityRuns",
            },
        )
        assert rows["total"] == 4
        assert {r["run_id"] for r in rows["items"]} == {str(c.run_id) for c in cases}
        assert sum(r["numerator"] for r in rows["items"]) == 3
    for group in quality["collection_versions"]:
        assert detail(api, group["drilldown"])["total"] == group["run_count"]
    assert {g["source_version"] for g in quality["collection_versions"]} == {"v1", "v2", None}
    for document in (yaml.safe_load(Path("/contracts/openapi.yaml").read_text()), app.openapi()):
        validate(document, "GeoAnswerInsights", value)


def test_detail_queries_are_fixed_repeatable_read_and_do_not_mix_new_review(overview_api):
    api = overview_api
    case = api.create()
    product = next(s["product_id"] for s in case.input["subjects"] if s["product_id"])
    before_value = insights(api, product_ids=product)
    drill = before_value["fact_risks"][0]["drilldown"]
    inserted = False
    sqls, levels = [], []

    def after_run(conn, cursor, statement, parameters, context, many):
        nonlocal inserted
        if inserted or "FROM geo_observation_runs" not in statement:
            return
        inserted = True
        assert api.submit(case).status_code == 201

    engine = api.harness.factory.kw["bind"]
    event.listen(engine, "after_cursor_execute", after_run)
    try:
        assert detail(api, drill)["total"] == 0
    finally:
        event.remove(engine, "after_cursor_execute", after_run)
    assert inserted and detail(api, drill)["total"] == 1

    def before(conn, cursor, statement, parameters, context, many):
        sqls.append(statement)
        levels.append(conn.get_isolation_level())

    for candidate_drill in (
        insights(api, product_ids=product)["citation_insights"][0]["drilldown"],
        drill,
        {
            "filters": before_value["filters"],
            "operation_id": "listGeoInsightQualityRuns",
            "quality_code": "eligible_runs",
        },
    ):
        sqls.clear()
        levels.clear()
        event.listen(engine, "before_cursor_execute", before)
        try:
            detail(api, candidate_drill)
        finally:
            event.remove(engine, "before_cursor_execute", before)
        assert len(sqls) == 15 and set(levels) == {"REPEATABLE READ"}
        assert all(sql.lstrip().startswith("SELECT") for sql in sqls)
        assert not any(
            word in sql
            for sql in sqls
            for word in ("lease_token", "api_key_encrypted", "channel_headers")
        )


def test_closed_contracts_authentication_and_shared_filters(overview_api):
    api = overview_api
    case = api.create()
    assert api.submit(case).status_code == 201
    product = next(s["product_id"] for s in case.input["subjects"] if s["product_id"])
    value = insights(api, product_ids=product)
    docs = (yaml.safe_load((Path("/contracts") / "openapi.yaml").read_text()), app.openapi())
    for doc in docs:
        validate(doc, "GeoAnswerInsights", value)
    for suffix, name, drill in (
        ("/citations", "GeoInsightCitationPage", value["citation_insights"][0]["drilldown"]),
        ("/claims", "GeoInsightClaimPage", value["fact_risks"][0]["drilldown"]),
        ("/quality/runs", "GeoInsightQualityPage", value["data_quality"]["excluded_drilldown"]),
    ):
        payload = detail(api, drill)
        for doc in docs:
            validate(doc, name, payload)
        query = params(api, case)
        if suffix != "/quality/runs":
            query["cell_key"] = drill["cell_key"]
        assert api.anonymous.get(PATH + suffix, params=query).status_code == 401
        response = api.engineer.get(PATH + suffix, params=query | {"unknown": "private-canary"})
        assert response.status_code == 422 and "private-canary" not in response.text
        if suffix != "/quality/runs":
            assert (
                api.engineer.get(PATH + suffix, params=query | {"cell_key": "0" * 64}).status_code
                == 404
            )
        response = api.engineer.get(PATH + suffix, params=query | {"collection_modes": "BROWSER"})
        assert response.status_code == (200 if suffix == "/quality/runs" else 404)
        if response.status_code == 200:
            assert response.json()["total"] == 0
    empty = insights(api, product_ids=str(uuid4()))
    assert empty["citation_insights"] == empty["fact_risks"] == []
    assert empty["data_quality"]["overview"]["candidate_run_count"] == 0
