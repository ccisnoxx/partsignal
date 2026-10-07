"""真实会话/PG/本地OSS读取：冻结详情、筛选分页、attempt统计与权限。"""

import json
from datetime import datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select, text

from app.config import settings
from app.models.geo_runs import GeoObservationRun
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine
from tests.integration.test_geo_manual_collection import (
    evidence,
    payload,
    prefix,
    submit,
)
from tests.unit.test_geo_run_contract import contract as contract

pytestmark = pytest.mark.integration
BATCHES = "/api/v1/geo/observation-batches"
RUNS = "/api/v1/geo/observation-runs"


def batch_run(api, *, repeats=1):
    response = api.api.engineer.post(
        BATCHES,
        json={"source": "AD_HOC", "configuration": api.payload(repeat_count=repeats)},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    with api.api.factory() as db:
        return list(
            db.scalars(
                select(GeoObservationRun)
                .where(GeoObservationRun.batch_id == response.json()["batch_id"])
                .order_by(GeoObservationRun.repeat_index)
            )
        )


def detail(api, run):
    result = api.api.engineer.get(prefix(run))
    assert result.status_code == 200, result.text
    return result.json()


def test_detail_one_request_evidence_timeline_and_frozen_context(plans_api, monkeypatch, contract):
    api = plans_api
    run = batch_run(api)[0]
    screenshot, _ = evidence(api)
    raw, _ = evidence(api, screenshot=False)
    value = payload(
        run,
        screenshot_file_id=str(screenshot),
        raw_payload_file_id=str(raw),
        citations=[
            {"original_url": "https://EXAMPLE.test/a#x", "position": 3},
            {"original_url": "https://example.test/a", "position": 1},
        ],
    )
    receipt = submit(api, run, value).json()
    with api.api.factory() as db:
        db.execute(
            text("UPDATE geo_engine_surfaces SET name='当前名字',revision=revision+1 WHERE id=:id"),
            {"id": api.surface},
        )
        db.execute(
            text("UPDATE geo_prompt_variants SET is_active=false,revision=revision+1 WHERE id=:id"),
            {"id": api.prompt},
        )
        db.commit()
    monkeypatch.setattr(settings, "geo_monitoring_enabled", False)
    result = api.api.engineer.get(prefix(run))
    assert result.status_code == 200, result.text
    value = result.json()
    from jsonschema import Draft202012Validator, FormatChecker

    from app.main import app

    for schema in (contract, app.openapi()):
        Draft202012Validator(
            {"$ref": "#/components/schemas/GeoRunDetail", "components": schema["components"]},
            format_checker=FormatChecker(),
        ).validate(value)
    assert result.headers["Cache-Control"] == "no-store"
    assert value["run"]["status"] == "COLLECTED" and value["batch"]["status"] == "RUNNING"
    assert value["run"]["input_snapshot"] == run.input_snapshot
    assert value["answer"]["answer_sha256"] == receipt["answer_sha256"]
    assert value["answer"]["answer_text"] == "  虚构原始回答\n"
    assert value["citations"][0]["occurrences"] == [1, 3]
    assert value["data_quality"]["metric_eligible"] is None
    assert value["data_quality"]["assessment"] == "NOT_IMPLEMENTED"
    assert [a["id"] for a in value["attempts"]] == [str(run.id)]
    assert [e["event"] for e in value["timeline"]] == ["CREATED", "STARTED", "COLLECTED"]
    assert {f["id"] for f in value["evidence_files"]} == {str(screenshot), str(raw)}
    assert all("signature=" in f["download"]["url"] for f in value["evidence_files"])
    assert all(
        datetime.fromisoformat(f["download"]["expires_at"]) > datetime.fromisoformat(value["as_of"])
        for f in value["evidence_files"]
    )
    serialized = json.dumps(value)
    for forbidden in ("fixture-redacted", "lease_token", "object_key", "api_key", "identity_hash"):
        assert forbidden not in serialized
    assert value["run"]["available_actions"] == []
    # 原始文件只授予限时访问；GET不下载或HEAD对象。
    assert api.api.admin.get(prefix(run)).status_code == 200


def test_signed_access_downloads_and_signer_failure_is_explicit(plans_api, monkeypatch):
    from app.services.storage import DevelopmentEvidenceStorage, StorageUnavailable

    api = plans_api
    run = batch_run(api)[0]
    screenshot, _ = evidence(api)
    assert submit(api, run, payload(run, screenshot_file_id=str(screenshot))).status_code == 201
    monkeypatch.setattr(
        settings, "development_storage_public_url", settings.development_storage_internal_url
    )
    file = detail(api, run)["evidence_files"][0]
    response = httpx.get(file["download"]["url"], timeout=5)
    assert response.status_code == 200 and response.content == b"fixture-redacted-screenshot"
    # 改签名不能获得对象；仅测试本地开发存储，不连接真实平台。
    from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

    url = urlsplit(file["download"]["url"])
    params = parse_qs(url.query)
    params["signature"] = ["invalid"]
    tampered = urlunsplit(url._replace(query=urlencode(params, doseq=True)))
    assert httpx.get(tampered, timeout=5).status_code == 403

    def unavailable(self, object_key, expires_at):
        raise StorageUnavailable("本地签名故障")

    monkeypatch.setattr(DevelopmentEvidenceStorage, "download_url", unavailable)
    response = api.api.engineer.get(prefix(run))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DEPENDENCY_UNAVAILABLE"


def test_batch_summary_independent_of_run_page_and_stable_filters(plans_api):
    api = plans_api
    runs = []
    for _ in range(2):
        runs.extend(batch_run(api, repeats=10))
    batch_id = runs[0].batch_id
    screenshot, _ = evidence(api)
    assert (
        submit(api, runs[0], payload(runs[0], screenshot_file_id=str(screenshot))).status_code
        == 201
    )
    first = api.api.engineer.get(
        f"{BATCHES}/{batch_id}/runs", params={"page_size": 10, "sort": "CREATED_ASC"}
    ).json()
    assert first["total"] == 10 and len(first["items"]) == 10
    summary = api.api.engineer.get(f"{BATCHES}/{batch_id}").json()
    assert summary["summary"]["status_counts"]["pending"] == 9
    assert summary["summary"]["status_counts"]["collected"] == 1
    assert summary["summary"]["pending_manual_count"] == 9
    assert summary["summary"]["cost"] == {
        "known_attempt_count": 0,
        "unknown_attempt_count": 10,
        "known_costs": [],
    }
    options = {"subject_id": str(api.subject), "page_size": 10, "sort": "CREATED_ASC"}
    page1 = api.api.engineer.get(RUNS, params=options).json()
    page2 = api.api.engineer.get(RUNS, params=options | {"page": 2}).json()
    assert page1["total"] == page2["total"] == 20
    assert [r["id"] for r in page1["items"] + page2["items"]] == [
        str(r.id) for r in sorted(runs, key=lambda r: (r.created_at, r.id))
    ]
    for dimension in (
        {"engine_surface_id": api.surface},
        {"query_topic_id": api.api.topic},
        {"prompt_variant_id": api.prompt},
        {"collection_profile_id": api.profile},
        {"collection_mode": "MANUAL"},
        {"needs_review": False},
    ):
        result = api.api.engineer.get(
            RUNS,
            params=options
            | {k: str(v) if not isinstance(v, bool) else v for k, v in dimension.items()},
        ).json()
        assert result["total"] == 20
    assert api.api.engineer.get(RUNS, params=options | {"status": "COLLECTED"}).json()["total"] == 1
    assert api.api.engineer.get(RUNS, params=options | {"needs_review": True}).json()["total"] == 0
    assert api.api.engineer.get(RUNS, params=options | {"page": 9}).json()["items"] == []
    current = detail(api, runs[0])
    boundary = current["run"]["created_at"]
    assert (
        api.api.engineer.get(RUNS, params=options | {"created_to": boundary}).json()["total"] == 0
    )
    assert (
        api.api.engineer.get(RUNS, params=options | {"created_from": boundary}).json()["total"]
        == 20
    )
    found = api.api.engineer.get(
        BATCHES, params={"subject_id": str(api.subject), "status": "RUNNING"}
    ).json()
    assert [item["id"] for item in found["items"]] == [str(batch_id)]


def test_old_attempts_are_not_extra_samples_and_cache_is_not_status_authority(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    with api.api.factory() as db:
        db.execute(
            text(
                "UPDATE geo_observation_runs SET status='FAILED',revision=revision+1,"
                "finished_at=now(),error_stage='COLLECTION',error_code='PROVIDER_TIMEOUT',"
                "error_summary='测试失败',cost_amount=1.25,cost_currency='USD' WHERE id=:id"
            ),
            {"id": run.id},
        )
        db.commit()
    failed = api.api.engineer.get(
        BATCHES, params={"subject_id": str(api.subject), "status": "FAILED"}
    ).json()
    assert failed["total"] == 1 and failed["items"][0]["status"] == "FAILED"
    with api.api.factory() as db:
        successor = GeoObservationRun(
            batch_id=run.batch_id,
            prompt_variant_id=run.prompt_variant_id,
            collection_profile_id=run.collection_profile_id,
            repeat_index=1,
            attempt_no=2,
            previous_attempt_id=run.id,
            input_snapshot=run.input_snapshot,
        )
        db.add(successor)
        db.commit()
        successor_id = successor.id
    value = detail(api, run)
    assert value["run"]["is_latest_attempt"] is False
    assert [a["id"] for a in value["attempts"]] == [str(run.id), str(successor_id)]
    assert value["batch"]["summary"]["requested_run_count"] == 1
    assert value["batch"]["summary"]["attempt_count"] == 2
    assert value["batch"]["summary"]["status_counts"]["pending"] == 1
    assert value["batch"]["summary"]["status_counts"]["failed"] == 0
    assert value["batch"]["summary"]["cost"]["known_costs"] == [
        {"currency": "USD", "value": "1.25"}
    ]
    options = {"batch_id": str(run.batch_id)}
    assert api.api.engineer.get(RUNS, params=options | {"status": "FAILED"}).json()["total"] == 0
    history = api.api.engineer.get(RUNS, params=options | {"latest_only": False}).json()
    assert history["total"] == 2
    assert (
        api.api.engineer.get(
            BATCHES, params={"subject_id": str(api.subject), "status": "FAILED"}
        ).json()["total"]
        == 0
    )


def test_filter_misses_literal_search_and_plan_scope(plans_api):
    api = plans_api
    ad_hoc = batch_run(api)[0]
    plan = api.create(name="冻结计划 %_ 名称", repeat_count=1)
    created = api.api.engineer.post(
        BATCHES,
        json={"source": "PLAN", "plan_id": plan["id"], "expected_revision": plan["revision"]},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert created.status_code == 201, created.text
    batch_id = created.json()["batch_id"]
    for field in (
        "batch_id",
        "plan_id",
        "subject_id",
        "product_id",
        "query_topic_id",
        "prompt_variant_id",
        "collection_profile_id",
        "engine_surface_id",
    ):
        result = api.api.engineer.get(RUNS, params={field: str(uuid4())})
        assert result.status_code == 200 and result.json()["total"] == 0
    for field in ("plan_id", "subject_id"):
        assert api.api.engineer.get(BATCHES, params={field: str(uuid4())}).json()["total"] == 0
    for q in ("%", "_", "不存在的问题"):
        assert api.api.engineer.get(RUNS, params={"q": q}).json()["total"] == 0
    scope = {"subject_id": str(api.subject)}
    assert api.api.engineer.get(RUNS, params=scope | {"q": "Plan问题"}).json()["total"] == 2
    filtered = api.api.engineer.get(RUNS, params={"plan_id": plan["id"]}).json()
    assert filtered["total"] == 1 and filtered["items"][0]["batch_id"] == batch_id
    assert filtered["items"][0]["batch_id"] != str(ad_hoc.batch_id)
    assert api.api.engineer.get(BATCHES, params={"q": "%_"}).json()["total"] == 1
    assert api.api.engineer.get(RUNS, params={"collection_mode": "API"}).json()["total"] == 0
    assert (
        api.api.engineer.get(RUNS, params={"error_code": "PROVIDER_TIMEOUT"}).json()["total"] == 0
    )
    ascending = api.api.engineer.get(RUNS, params=scope | {"sort": "CREATED_ASC"}).json()["items"]
    descending = api.api.engineer.get(RUNS, params=scope).json()["items"]
    assert [row["id"] for row in ascending] == list(reversed([row["id"] for row in descending]))


@pytest.mark.parametrize(
    "params",
    [
        {"page": 0},
        {"page_size": 11},
        {"status": "UNKNOWN"},
        {"q": "bad\x00"},
        {"created_from": "2026-10-02T00:00:00"},
        {"created_from": "2026-10-02T00:00:00Z", "created_to": "2026-10-01T00:00:00Z"},
    ],
)
def test_filters_invalid_are_safe_422(plans_api, params):
    response = plans_api.api.engineer.get(RUNS, params=params)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_read_auth_missing_and_not_found(plans_api):
    from fastapi.testclient import TestClient

    from app.main import app

    api = plans_api
    run = batch_run(api)[0]
    paths = [
        BATCHES,
        RUNS,
        f"{BATCHES}/{run.batch_id}",
        f"{BATCHES}/{run.batch_id}/runs",
        prefix(run),
    ]
    with TestClient(app) as anonymous:
        for path in paths:
            result = anonymous.get(path)
            assert result.status_code == 401 and result.headers["X-Request-ID"]
    for path in (f"{BATCHES}/{uuid4()}", f"{BATCHES}/{uuid4()}/runs", f"{RUNS}/{uuid4()}"):
        assert api.api.engineer.get(path).status_code == 404
    assert api.api.engineer.get(f"{RUNS}/invalid").status_code == 422
    from app.models.identity import User

    with api.api.factory() as db:
        user = db.get(User, api.api.engineer_id)
        user.must_change_password = True
        db.commit()
    for path in paths:
        result = api.api.engineer.get(path)
        assert result.status_code == 403
        assert result.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
