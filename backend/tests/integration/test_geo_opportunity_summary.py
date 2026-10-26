"""CORE-02 真实 PG/HTTP：去重、当前状态、历史来源与跨页面筛选一致。"""

from copy import deepcopy
from datetime import timedelta
from hashlib import sha256
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.main import app
from app.models.geo_opportunities import (
    GeoOpportunity,
    GeoOpportunityAction,
    GeoOpportunityEvaluation,
    GeoOpportunitySource,
)
from app.schemas.geo_insights import GeoOverviewFilters
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
from tests.unit.test_geo_run_contract import contract as contract
from tests.unit.test_geo_run_contract import validate

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


def query(scope):
    return {
        key: value
        for key, value in scope.model_dump(mode="json").items()
        if value is not None and value != []
    }


def read(api, path, params):
    response = api.engineer.get(path, params=params)
    assert response.status_code == 200, response.text
    if path != PATH:
        assert response.headers["Cache-Control"] == "no-store"
    return response.json()


def summary(api, scope):
    return read(api, "/api/v1/geo/overview", query(scope))["open_opportunities"]


def follow(api, drilldown):
    return read(
        api,
        PATH,
        {
            "source_scope": GeoOverviewFilters.model_validate(
                drilldown["source_scope"]
            ).model_dump_json(),
            "open_only": drilldown["open_only"],
            **{key: drilldown[key] for key in ("status", "priority") if drilldown[key] is not None},
        },
    )


def clone(api, identity, priority):
    """创建独立虚构机会，共享真实来源；不复制 evaluator 规则。"""
    with api.harness.factory.begin() as db:
        original = db.get(GeoOpportunity, UUID(identity))
        trigger = deepcopy(original.trigger_snapshot)
        trigger["priority"] = priority
        value = GeoOpportunity(
            identity_key=sha256(str(uuid4()).encode()).hexdigest(),
            priority=priority,
            status="OPEN",
            trigger_snapshot=trigger,
            **{
                name: getattr(original, name)
                for name in (
                    "rule_code",
                    "source_date_from",
                    "source_date_to",
                    "subject_id",
                    "query_topic_id",
                    "prompt_variant_id",
                    "collection_profile_id",
                    "engine_surface_id",
                    "batch_id",
                )
            },
        )
        db.add(value)
        db.flush()
        for source in db.scalars(
            select(GeoOpportunitySource).where(GeoOpportunitySource.opportunity_id == original.id)
        ):
            db.add(
                GeoOpportunitySource(
                    opportunity_id=value.id,
                    run_id=source.run_id,
                    analysis_revision_id=source.analysis_revision_id,
                    review_id=source.review_id,
                    source_role=source.source_role,
                )
            )
        return str(value.id)


def counts(api):
    with api.harness.factory() as db:
        return tuple(
            db.scalar(select(func.count()).select_from(model))
            for model in (
                GeoOpportunity,
                GeoOpportunitySource,
                GeoOpportunityAction,
                GeoOpportunityEvaluation,
            )
        )


def test_summary_deduplicates_sources_groups_current_pending_and_matches_report_and_list(
    api, contract
):
    case, scope, _, identity = opportunity(api)
    acknowledged = clone(api, identity, "LOW")
    dismissed = clone(api, identity, "HIGH")
    result = api.engineer.post(f"{PATH}/{acknowledged}/acknowledge", json={"expected_revision": 1})
    assert result.status_code == 200, result.text
    result = api.engineer.post(
        f"{PATH}/{dismissed}/dismiss",
        json={
            "expected_revision": 1,
            "resolution_code": "DUPLICATE",
            "resolution_comment": "虚构重复机会",
        },
    )
    assert result.status_code == 200, result.text
    with api.harness.factory.begin() as db:
        original = db.scalar(
            select(GeoOpportunitySource).where(
                GeoOpportunitySource.opportunity_id == UUID(identity)
            )
        )
        db.add(
            GeoOpportunitySource(
                opportunity_id=original.opportunity_id,
                run_id=original.run_id,
                analysis_revision_id=original.analysis_revision_id,
                review_id=original.review_id,
                source_role="SUPPORTING",
            )
        )
    before = counts(api)
    overview = read(api, "/api/v1/geo/overview", query(scope))
    report = read(api, "/api/v1/geo/reports/preview", query(scope))
    value = overview["open_opportunities"]
    assert value["as_of"] == overview["as_of"]
    assert report["open_opportunities"]["as_of"] == report["as_of"]
    assert value["open_count"] == 2
    assert {group["status"]: group["count"] for group in value["by_status"]} == {
        "OPEN": 1,
        "ACKNOWLEDGED": 1,
        "IN_PROGRESS": 0,
    }
    assert {group["priority"]: group["count"] for group in value["by_priority"]} == {
        "CRITICAL": 0,
        "HIGH": 1,
        "MEDIUM": 0,
        "LOW": 1,
    }
    assert follow(api, value["drilldown"])["total"] == value["open_count"]
    assert {row["id"] for row in follow(api, value["drilldown"])["items"]} == {
        identity,
        acknowledged,
    }
    for group in value["by_status"] + value["by_priority"]:
        assert follow(api, group["drilldown"])["total"] == group["count"]
    assert {k: v for k, v in report["open_opportunities"].items() if k != "as_of"} == {
        k: v for k, v in value.items() if k != "as_of"
    }
    assert counts(api) == before  # GET 没有评估、来源追加或行动写入
    assert not any("未实施机会实体" in text for text in report["method_notes"])
    assert (
        next(item for item in report["exports"] if item["kind"] == "opportunities")["available"]
        is False
    )
    for document in (contract, app.openapi()):
        validate(document, "GeoOverview", overview)
        validate(document, "GeoReportPreview", report)


def test_source_date_is_run_creation_not_opportunity_creation_and_empty_scope_is_zero(api):
    case, _, _, identity = opportunity(api)
    run = api.harness.run(case.run_id)
    scope = GeoOverviewFilters(
        date_from=run.created_at, date_to=run.created_at + timedelta(microseconds=1)
    )
    value = summary(api, scope)
    assert identity in {item["id"] for item in follow(api, value["drilldown"])["items"]}
    assert follow(api, value["drilldown"])["total"] == value["open_count"]
    assert (
        read(
            api,
            PATH,
            {"created_from": scope.date_from.isoformat(), "created_to": scope.date_to.isoformat()},
        )["total"]
        == 0
    )
    scope.subject_ids = [uuid4()]
    empty = summary(api, scope)
    assert empty["open_count"] == 0
    assert all(group["count"] == 0 for group in empty["by_status"] + empty["by_priority"])
    assert follow(api, empty["drilldown"])["items"] == []


def test_frozen_source_filters_and_historical_review_do_not_use_current_selection(api):
    case, scope, _, _ = opportunity(api)
    scope.review_policy = "REVIEWED_ONLY"
    initial = summary(api, scope)
    assert initial["open_count"] == 1
    api.reanalyze(case)
    assert api.detail(case)["analysis"]["selection"]["current_review_id"] is None
    assert summary(api, scope)["open_count"] == initial["open_count"]
    for patch in (
        {"language_codes": ["en"]},
        {"region_codes": ["US"]},
        {"collection_modes": ["API"]},
        {"login_states": ["AUTHENTICATED"]},
        {"mention_mode": "BRANDED"},
    ):
        filtered = GeoOverviewFilters.model_validate(scope.model_dump() | patch)
        value = summary(api, filtered)
        assert value["open_count"] == 0, patch
        assert follow(api, value["drilldown"])["total"] == 0


@pytest.mark.parametrize("scope", ["{", "{}", '{"date_from":"invalid","date_to":"invalid"}'])
def test_invalid_source_filter_is_rejected_instead_of_becoming_global(api, scope):
    assert (
        api.engineer.get(PATH, params={"source_scope": scope, "open_only": True}).status_code == 422
    )
