"""703真实PG/HTTP：历史证据、服务端动作、CAS、授权、原子审计。"""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, select

from app.errors import AppError
from app.models.geo_opportunities import GeoOpportunity
from app.models.identity import AuditLog, User
from app.schemas.geo_opportunity_workbench import GeoOpportunityRevisionRequest
from app.services import geo_opportunity_commands as commands
from tests.integration.test_geo_opportunities import (
    analysis_engine,
    answer_database,
    api,
    critical,
    evaluate,
    harness,
    overview_api,
    plan_database,
    prepared,
    review_api,
    run_database,
)
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
PATH = "/api/v1/geo/opportunities"


def opportunity(api):
    case, filters, correction = prepared(api)
    value = critical(api, evaluate(api, filters))
    assert value.opportunity_id is not None
    return case, filters, correction, str(value.opportunity_id)


def detail(api, identity, **params):
    response = api.engineer.get(f"{PATH}/{identity}", params=params)
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    return response.json()


def test_historical_evidence_and_linked_evaluation_survive_new_review_and_reanalysis(api):
    case, filters, correction, identity = opportunity(api)
    first = detail(api, identity)
    assert first["sources"]["total"] == 1
    source = first["sources"]["items"][0]
    assert source["run_id"] == str(case.run_id)
    assert source["analysis_revision_id"] == source["analysis"]["analysis"]["id"]
    assert source["review_id"] == source["review"]["id"]
    assert source["effective_results"]["claims"][0]["explanation"] == "虚构核验"
    assert source["answer"]["answer_text"] and source["citations"]
    changed = deepcopy(correction)
    changed["claims"][0]["explanation"] = "后续审核解释，不应覆盖早期证据"
    assert api.submit(case, decision="CORRECTED", correction_payload=changed).status_code == 201
    evaluate(api, filters)
    reads = []
    levels = []
    engine = api.harness.factory.kw["bind"]

    def capture(conn, _cursor, statement, _params, _context, _many):
        reads.append(statement)
        levels.append(conn.get_isolation_level())

    event.listen(engine, "before_cursor_execute", capture)
    try:
        second = detail(api, identity)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert all(sql.lstrip().startswith("SELECT") for sql in reads)
    assert all(level == "REPEATABLE READ" for level in levels)
    assert not any(
        "lease_token" in sql or "api_key_ciphertext" in sql or "ai_channel_headers" in sql
        for sql in reads
    )

    assert second["trigger_snapshot"] == first["trigger_snapshot"]
    assert second["sources"]["total"] == 2
    assert {k: v for k, v in second["sources"]["items"][0].items() if k != "run"} == {
        k: v for k, v in source.items() if k != "run"
    }
    assert (
        second["sources"]["items"][1]["effective_results"]["claims"][0]["explanation"]
        == changed["claims"][0]["explanation"]
    )
    assert second["latest_evaluation"]["id"] != first["latest_evaluation"]["id"]
    api.reanalyze(case)
    history = detail(api, identity)["sources"]
    assert [{k: v for k, v in row.items() if k != "run"} for row in history["items"]] == [
        {k: v for k, v in row.items() if k != "run"} for row in second["sources"]["items"]
    ]
    from pathlib import Path

    import yaml

    contract = yaml.safe_load(Path("/contracts/openapi.yaml").read_text())
    validate(contract, "GeoOpportunityDetail", second)
    # 明确的来源空页仍报告真实total，不能伪造不存在的答案。
    page = detail(api, identity, source_page=99, source_page_size=10)["sources"]
    assert page["items"] == [] and page["total"] == 2


def test_acknowledge_dismiss_revision_and_atomic_safe_audit(api):
    _, _, _, identity = opportunity(api)
    before = detail(api, identity)
    revision = before["opportunity"]["revision"]
    assert before["opportunity"]["available_actions"] == ["ACKNOWLEDGE", "DISMISS"]
    missing = api.engineer.post(
        f"{PATH}/{identity}/dismiss",
        json={
            "expected_revision": revision,
            "resolution_code": "OTHER",
            "resolution_comment": " \u3000 ",
        },
    )
    assert missing.status_code == 422
    ack = api.engineer.post(f"{PATH}/{identity}/acknowledge", json={"expected_revision": revision})
    assert ack.status_code == 200, ack.text
    value = ack.json()
    assert value["status"] == "ACKNOWLEDGED" and value["revision"] == revision + 1
    assert value["available_actions"] == ["DISMISS"]
    assert value["last_seen_at"] == before["opportunity"]["last_seen_at"]
    assert (
        api.engineer.post(
            f"{PATH}/{identity}/acknowledge", json={"expected_revision": revision}
        ).json()["error"]["code"]
        == "REVISION_CONFLICT"
    )
    assert (
        api.engineer.post(
            f"{PATH}/{identity}/acknowledge", json={"expected_revision": value["revision"]}
        ).json()["error"]["code"]
        == "INVALID_STATE_TRANSITION"
    )
    reason = "这是授权详情保留的私密人工理由"
    dismissed = api.admin.post(
        f"{PATH}/{identity}/dismiss",
        json={
            "expected_revision": value["revision"],
            "resolution_code": "  DUPLICATE  ",
            "resolution_comment": f" {reason} ",
        },
    )
    assert dismissed.status_code == 200, dismissed.text
    after = detail(api, identity)
    assert after["opportunity"]["status"] == "DISMISSED"
    assert after["opportunity"]["available_actions"] == []
    assert after["opportunity"]["resolution_comment"] == reason
    assert after["opportunity"]["resolution_code"] == "DUPLICATE"
    assert (
        after["sources"] == before["sources"]
        and after["trigger_snapshot"] == before["trigger_snapshot"]
    )
    assert after["latest_evaluation"] == before["latest_evaluation"]
    with api.harness.factory() as db:
        logs = list(
            db.scalars(
                select(AuditLog)
                .where(AuditLog.target_type == "GeoOpportunity", AuditLog.target_id == identity)
                .order_by(AuditLog.created_at)
            )
        )
        assert [row.action for row in logs] == [
            "geo_opportunity.opened",
            "geo_opportunity.acknowledged",
            "geo_opportunity.dismissed",
        ]
        assert logs[-1].details == {
            "facts": {"revision": value["revision"] + 1, "status": "DISMISSED"}
        }
        assert reason not in str([row.details for row in logs])
        audit_id = logs[-1].id
    audit_detail = api.admin.get(f"/api/v1/audit-logs/{audit_id}")
    assert audit_detail.status_code == 200, audit_detail.text
    assert audit_detail.json()["related_entry"] == {
        "status": "AVAILABLE", "kind": "GeoOpportunity", "parent_id": None
    }
    assert reason not in audit_detail.text


def test_permissions_csrf_unknown_fields_and_missing_resources(api):
    _, _, _, identity = opportunity(api)
    assert api.anonymous.get(PATH).status_code == 401
    assert api.anonymous.get(f"{PATH}/{identity}").status_code == 401
    assert api.engineer.get(f"{PATH}/{uuid4()}").status_code == 404
    assert (
        api.engineer.post(
            f"{PATH}/{uuid4()}/acknowledge", json={"expected_revision": 1}
        ).status_code
        == 404
    )
    assert (
        api.engineer.post(
            f"{PATH}/{identity}/acknowledge",
            headers={"X-CSRF-Token": "wrong-token-must-still-be-32-bytes-long"},
            json={"expected_revision": 1},
        ).status_code
        == 403
    )
    rejected = api.engineer.get(PATH, params={"unapproved": "secret-canary"})
    assert rejected.status_code == 422 and "secret-canary" not in rejected.text
    for patch in (
        {"page_size": 30},
        {"created_from": "2100-01-01T00:00:00Z", "created_to": "2020-01-01T00:00:00Z"},
        {"status": "UNKNOWN"},
    ):
        assert api.engineer.get(PATH, params=patch).status_code == 422
    with api.harness.factory.begin() as db:
        user = db.get(User, api.engineer_id)
        user.must_change_password = True
    assert api.engineer.get(PATH).status_code == 403
    assert (
        api.engineer.post(
            f"{PATH}/{identity}/acknowledge", json={"expected_revision": 1}
        ).status_code
        == 403
    )


def test_list_filters_frozen_mode_stable_paging_and_query_count(api):
    case, _, _, identity = opportunity(api)
    snapshot = api.harness.run(case.run_id).input_snapshot
    base = {"subject_id": snapshot["subjects"][1]["id"], "rule_code": "CRITICAL_FACT_ERROR"}
    counts = []

    def count(_conn, _cursor, statement, _params, _context, _many):
        if statement.lstrip().upper().startswith("SELECT"):
            counts.append(statement)

    engine = api.harness.factory.kw["bind"]
    event.listen(engine, "before_cursor_execute", count)
    try:
        response = api.engineer.get(PATH, params=base)
        assert response.status_code == 200, response.text
        initial_count = len(counts)
        value = response.json()
        assert value["total"] == 1 and value["items"][0]["id"] == identity
        assert value["filter_options"]["subjects"] and value["filter_options"]["products"]
        fields = {
            "query_topic_id": snapshot["prompt"]["query_topic_id"],
            "prompt_variant_id": snapshot["prompt"]["id"],
            "collection_profile_id": snapshot["profile"]["id"],
            "engine_surface_id": snapshot["profile"]["surface"]["id"],
            "collection_mode": snapshot["profile"]["collection_mode"],
            "product_id": snapshot["subjects"][1]["product_id"],
            "status": "OPEN",
            "priority": value["items"][0]["priority"],
            "q": "严重事实错误",
        }
        for key, item in fields.items():
            result = api.engineer.get(PATH, params=base | {key: item})
            assert result.status_code == 200, result.text
            assert result.json()["total"] == 1, (key, result.json())
        counts.clear()
        empty = api.engineer.get(
            PATH, params=base | {"page": 99, "sort": "LAST_SEEN_DESC", "page_size": 10}
        ).json()
        assert empty["total"] == 1 and empty["items"] == []
        assert len(counts) == initial_count and initial_count < 15
        assert api.engineer.get(PATH, params=base | {"collection_mode": "API"}).json()["total"] == 0
        assert (
            api.engineer.get(PATH, params=base | {"subject_id": str(uuid4())}).json()["total"] == 0
        )
    finally:
        event.remove(engine, "before_cursor_execute", count)


def test_concurrent_same_revision_has_one_winner_and_one_audit(api):
    _, _, _, identity = opportunity(api)
    revision = detail(api, identity)["opportunity"]["revision"]
    barrier = Barrier(2)

    def invoke(actor_id):
        with api.harness.factory() as db:
            actor = db.get(User, actor_id)
            barrier.wait(timeout=10)
            try:
                return commands.acknowledge(
                    db,
                    UUID(identity),
                    GeoOpportunityRevisionRequest(expected_revision=revision),
                    actor=actor,
                    request_id="geo703-concurrent",
                ).status
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(invoke, actor)
            for actor in (api.engineer_id, api.harness.database.runs.plan.actor)
        ]
        values = [future.result(timeout=20) for future in futures]
    assert sorted(values) == ["ACKNOWLEDGED", "REVISION_CONFLICT"]
    with api.harness.factory() as db:
        logs = list(
            db.scalars(
                select(AuditLog).where(
                    AuditLog.target_type == "GeoOpportunity", AuditLog.target_id == identity
                )
            )
        )
        assert len(logs) == 2
        assert sorted(row.action for row in logs) == [
            "geo_opportunity.acknowledged", "geo_opportunity.opened"
        ]


def test_audit_failure_rolls_back_state_and_stale_identity_map_is_refreshed(api, monkeypatch):
    _, _, _, identity = opportunity(api)

    def fail(*_args):
        raise RuntimeError("虚构审计写入失败")

    with api.harness.factory() as db:
        actor = db.get(User, api.engineer_id)
        stale = db.get(GeoOpportunity, UUID(identity))
        revision = stale.revision
        original = commands.append_audit
        monkeypatch.setattr(commands, "append_audit", fail)
        with pytest.raises(RuntimeError):
            commands.acknowledge(
                db,
                UUID(identity),
                GeoOpportunityRevisionRequest(expected_revision=revision),
                actor=actor,
                request_id="geo703-audit-failure",
            )
        assert db.get(GeoOpportunity, UUID(identity)).status == "OPEN"
        monkeypatch.setattr(commands, "append_audit", original)
        stale = db.get(GeoOpportunity, UUID(identity))
        assert (
            api.admin.post(
                f"{PATH}/{identity}/acknowledge", json={"expected_revision": revision}
            ).status_code
            == 200
        )
        with pytest.raises(AppError) as conflict:
            commands.acknowledge(
                db,
                UUID(identity),
                GeoOpportunityRevisionRequest(expected_revision=revision),
                actor=actor,
                request_id="geo703-stale",
            )
        assert conflict.value.code == "REVISION_CONFLICT"


def test_failure_opportunity_without_answer_or_analysis_is_readable_and_can_be_dismissed(api):
    import psycopg
    from psycopg.types.json import Jsonb

    from app.models.geo_opportunities import GeoOpportunityEvaluation
    from app.schemas.geo_rules import GeoRuleUpdateRequest
    from app.services import geo_rules
    from tests.integration.geo_runs_support import batch, run, terminal
    from tests.integration.test_geo_catalog import insert_row
    from tests.unit.test_geo_run_contract import plan_snapshot

    case, filters, _ = prepared(api)
    database = api.harness.database.runs
    frozen = api.harness.run(case.run_id).input_snapshot
    plan = plan_snapshot(frozen)
    plan["subjects"] = [{"subject_id": s["id"], "role": s["role"]} for s in frozen["subjects"]]
    with psycopg.connect(database.url) as conn:
        root = batch(conn, database, plan_snapshot=Jsonb(plan))
        for subject in frozen["subjects"]:
            insert_row(
                conn,
                "geo_batch_subjects",
                {"batch_id": root, "subject_id": UUID(subject["id"]), "role": subject["role"]},
            )
        failed = run(conn, database, root, input_snapshot=Jsonb(frozen))
        terminal(conn, failed, "FAILED")
    with api.harness.factory() as db:
        current = geo_rules.get_rules(db)
        geo_rules.update_rules(
            db,
            GeoRuleUpdateRequest(
                expected_revision=current.revision,
                configuration=current.configuration.model_copy(
                    update={"run_failure_consecutive_limit": 1}
                ),
            ),
            actor=db.get(User, database.plan.actor),
            request_id="geo703-failure-fixture",
        )
    results = evaluate(api, filters)
    with api.harness.factory() as db:
        evaluation = db.scalar(
            select(GeoOpportunityEvaluation).where(
                GeoOpportunityEvaluation.id.in_([r.evaluation_id for r in results]),
                GeoOpportunityEvaluation.result_snapshot["rule_code"].as_string() == "RUN_FAILURE",
            )
        )
        assert evaluation.opportunity_id is not None
        identity = str(evaluation.opportunity_id)
    value = detail(api, identity)
    source = next(row for row in value["sources"]["items"] if row["run_id"] == str(failed))
    assert (
        source["answer"]
        is source["analysis"]
        is source["review"]
        is source["effective_results"]
        is None
    )
    assert source["citations"] == source["evidence_files"] == []
    response = api.engineer.post(
        f"{PATH}/{identity}/dismiss",
        json={
            "expected_revision": value["opportunity"]["revision"],
            "resolution_code": "KNOWN_FAILURE",
            "resolution_comment": "已确认失败原因，保留原始来源",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["acknowledged_at"] is None
    assert detail(api, identity)["sources"] == value["sources"]
