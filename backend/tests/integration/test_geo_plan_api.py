"""真实会话下的 Plan 生命周期、公开读模型、权限与安全占位。"""

from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import select, text

from app.config import settings
from app.models.identity import AuditLog
from tests.integration.geo_plans_support import PREFIX, PlansAPI
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine
from tests.unit.test_geo_surface_contract import contract as contract
from tests.unit.test_geo_surface_contract import validate

pytestmark = pytest.mark.integration


def logs(api: PlansAPI, identity: str) -> list[AuditLog]:
    with api.api.factory() as db:
        return list(db.scalars(select(AuditLog).where(AuditLog.target_id == identity)))


def test_crud_noop_revision_lifecycle_and_audit(plans_api: PlansAPI, contract: dict) -> None:
    api = plans_api
    row = api.create()
    validate(contract, "GeoMonitoringPlanDetail", row)
    path = f"{PREFIX}/{row['id']}"
    assert row["status"] == "DISABLED" and row["revision"] == 0
    assert row["workflow_stage"] == "READY"
    assert {"ACTIVATE", "UPDATE", "DELETE"} <= set(row["available_actions"])
    assert row["run_entry"] == {"available": False, "reason_code": "UI_NOT_IMPLEMENTED"}
    noop = api.api.engineer.patch(path, json=api.payload(expected_revision=0))
    assert noop.status_code == 200 and noop.json() == row
    assert len(logs(api, row["id"])) == 1
    for operation, status in [("activate", "ACTIVE"), ("pause", "PAUSED"), ("resume", "ACTIVE")]:
        result = api.action(row, operation)
        assert result.status_code == 200, result.text
        after = result.json()
        assert after["status"] == status and after["revision"] == row["revision"] + 1
        assert after["created_by"] == row["created_by"]
        row = after
    changed = api.api.admin.patch(path, json=api.payload(name="活动配置新版", expected_revision=3))
    assert changed.status_code == 200, changed.text
    row = changed.json()
    assert row["status"] == "ACTIVE" and row["revision"] == 4
    assert row["updated_by"] == str(api.api.admin_id)
    assert row["created_by"] == str(api.api.engineer_id)
    archived = api.action(row, "archive")
    assert archived.status_code == 200, archived.text
    row = archived.json()
    assert row["status"] == "ARCHIVED" and row["revision"] == 5
    assert row["available_actions"] == ["COPY"] and row["primary_task"] == "VIEW_HISTORY"
    assert api.api.engineer.get(path).json() == row
    events = logs(api, row["id"])
    assert [event.action for event in sorted(events, key=lambda item: item.created_at)] == [
        "geo_monitoring_plan." + action
        for action in ("created", "activated", "paused", "resumed", "updated", "archived")
    ]
    for entry in events:
        assert entry.details.keys() == {"facts"}
        assert entry.details["facts"].keys() == {"revision", "status"}
        assert api.name not in str(entry.details)
        assert "虚构内部说明" not in str(entry.details)
    validate(contract, "GeoMonitoringPlanDetail", row)


def test_archived_readonly_copy_and_disabled_deletion(plans_api: PlansAPI) -> None:
    api = plans_api
    row = api.action(api.create(), "archive").json()
    path = f"{PREFIX}/{row['id']}"
    for response in [
        api.api.engineer.patch(path, json=api.payload(expected_revision=1)),
        *(api.action(row, op) for op in ("activate", "pause", "resume", "archive")),
        api.api.engineer.delete(path, params={"expected_revision": 1}),
        api.api.engineer.post(
            f"{path}/run", json={"expected_revision": 1}, headers={"Idempotency-Key": "208-key"}
        ),
    ]:
        assert (
            response.status_code == 409 and response.json()["error"]["code"] == "GEO_PLAN_ARCHIVED"
        )
    assert api.api.engineer.get(path).json() == row and len(logs(api, row["id"])) == 2
    copy = api.api.admin.post(f"{path}/copy", json={"expected_revision": 1, "name": "新草稿"})
    assert copy.status_code == 201, copy.text
    copied = copy.json()
    assert copied["id"] != row["id"] and copied["status"] == "DISABLED" and copied["revision"] == 0
    assert copied["created_by"] == copied["updated_by"] == str(api.api.admin_id)
    for name in ("subjects", "prompt_variant_ids", "collection_profile_ids", "repeat_count"):
        assert copied[name] == row[name]
    assert api.api.engineer.get(path).json() == row
    delete = api.api.engineer.delete(f"{PREFIX}/{copied['id']}", params={"expected_revision": 0})
    assert delete.status_code == 204 and delete.content == b""
    assert api.api.engineer.get(f"{PREFIX}/{copied['id']}").status_code == 404
    assert len(logs(api, copied["id"])) == 2
    with api.api.factory() as db:
        for suffix in ("subjects", "prompts", "profiles"):
            assert (
                db.scalar(
                    text(f"SELECT count(*) FROM geo_monitoring_plan_{suffix} WHERE plan_id=:id"),
                    {"id": copied["id"]},
                )
                == 0
            )


def test_stale_illegal_transition_and_delete_protection(plans_api: PlansAPI) -> None:
    api = plans_api
    original = api.create()
    illegal = api.action(original, "resume")
    assert (
        illegal.status_code == 409 and illegal.json()["error"]["code"] == "INVALID_STATE_TRANSITION"
    )
    row = api.action(original, "activate").json()
    for response in [
        api.action(original, "pause"),
        api.action(original, "copy", name="过期副本"),
        api.api.engineer.patch(f"{PREFIX}/{row['id']}", json=api.payload(expected_revision=0)),
    ]:
        assert (
            response.status_code == 409 and response.json()["error"]["code"] == "REVISION_CONFLICT"
        )
    duplicate = api.action(row, "activate")
    assert (
        duplicate.status_code == 409
        and duplicate.json()["error"]["code"] == "INVALID_STATE_TRANSITION"
    )
    for index in range(2):
        state = row if index == 0 else api.action(row, "pause").json()
        response = api.api.engineer.delete(
            f"{PREFIX}/{state['id']}", params={"expected_revision": state["revision"]}
        )
        assert response.status_code == 409 and response.json()["error"]["code"] == "GEO_PLAN_IN_USE"


def test_preview_draft_saved_with_blockers_and_activation_rechecks(
    plans_api: PlansAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = plans_api
    with api.api.factory() as db:
        db.execute(
            text(
                "UPDATE geo_collection_profiles SET is_active=false, "
                "revision=revision+1 WHERE id=:id"
            ),
            {"id": api.profile},
        )
        db.commit()
    preview = api.api.engineer.post(f"{PREFIX}/preview", json=api.payload())
    assert preview.status_code == 200 and preview.json()["blockers"]
    row = api.create()
    assert row["preview"] == preview.json() and "ACTIVATE" not in row["available_actions"]
    blocked = api.action(row, "activate")
    assert (
        blocked.status_code == 409
        and blocked.json()["error"]["code"] == "GEO_PLAN_PROFILE_INELIGIBLE"
    )
    with api.api.factory() as db:
        db.execute(
            text(
                "UPDATE geo_collection_profiles SET is_active=true, "
                "revision=revision+1 WHERE id=:id"
            ),
            {"id": api.profile},
        )
        db.commit()
    row = api.action(row, "activate").json()
    monkeypatch.setattr(settings, "geo_monitoring_enabled", False)
    changed = api.api.engineer.patch(
        f"{PREFIX}/{row['id']}", json=api.payload(name="不得保存的活动修改", expected_revision=1)
    )
    assert (
        changed.status_code == 409
        and changed.json()["error"]["code"] == "GEO_PLAN_PROFILE_INELIGIBLE"
    )
    paused = api.action(row, "pause").json()
    assert paused["status"] == "PAUSED" and "RESUME" not in paused["available_actions"]
    saved = api.api.engineer.patch(
        f"{PREFIX}/{row['id']}", json=api.payload(name="可修复暂停配置", expected_revision=2)
    )
    assert saved.status_code == 200 and saved.json()["revision"] == 3


def test_missing_reference_validation_and_server_metadata(plans_api: PlansAPI) -> None:
    api = plans_api
    for field in ("prompt_variant_ids", "collection_profile_ids"):
        response = api.api.engineer.post(PREFIX, json=api.payload(**{field: [str(uuid4())]}))
        assert (
            response.status_code == 422
            and response.json()["error"]["code"] == "GEO_PLAN_REFERENCE_INVALID"
        )
    for values in (
        {"subjects": []},
        {"status": "ACTIVE"},
        {"revision": 99},
        {"created_by": str(api.api.admin_id)},
        {"api_key": "secret-208-marker"},
    ):
        response = api.api.engineer.post(PREFIX, json=api.payload(**values))
        assert response.status_code == 422 and "secret-208-marker" not in response.text
    assert api.api.engineer.get(f"{PREFIX}/{uuid4()}").status_code == 404


def test_csrf_auth_permissions_and_idempotent_run(plans_api: PlansAPI) -> None:
    api = plans_api
    row = api.create()
    path = f"{PREFIX}/{row['id']}"
    before = deepcopy(row)
    assert api.api.engineer.post(f"{path}/run", json={"expected_revision": 0}).status_code == 422
    receipts = []
    for _ in range(2):
        result = api.api.engineer.post(
            f"{path}/run", json={"expected_revision": 0}, headers={"Idempotency-Key": "208-command"}
        )
        assert result.status_code == 201, result.text
        receipts.append(result.json())
    after = api.api.engineer.get(path).json()
    assert receipts[0] == receipts[1]
    assert after["revision"] == before["revision"] and after["deletion"]["blockers"] == [
        "HAS_BATCH_HISTORY"
    ]
    assert len(logs(api, row["id"])) == 1
    csrf = api.api.engineer.headers.pop("X-CSRF-Token")
    try:
        assert api.api.engineer.post(f"{PREFIX}/preview", json=api.payload()).status_code == 422
        assert api.action(row, "activate").status_code == 422
        denied = api.api.engineer.patch(
            path,
            json=api.payload(expected_revision=0),
            headers={"X-CSRF-Token": "wrong-but-long-enough-token-32-bytes"},
        )
        assert denied.status_code == 403
    finally:
        api.api.engineer.headers["X-CSRF-Token"] = csrf
    with api.api.factory() as db:
        db.execute(
            text("UPDATE users SET must_change_password=true, revision=revision+1 WHERE id=:id"),
            {"id": api.api.engineer_id},
        )
        db.commit()
    for response in (
        api.api.engineer.get(PREFIX),
        api.api.engineer.get(path),
        api.api.engineer.post(PREFIX, json=api.payload()),
        api.action(row, "activate"),
    ):
        assert response.status_code == 403
    api.api.engineer.cookies.clear()
    assert api.api.engineer.get(PREFIX).status_code == 401


def test_audit_detail_recognizes_plan_and_retains_deleted_tombstone(plans_api: PlansAPI) -> None:
    from app.services.audit_logs import get_audit_log

    api = plans_api
    row = api.create()
    entry = logs(api, row["id"])[0]
    with api.api.factory() as db:
        detail = get_audit_log(db, entry.id)
        assert detail.related_entry.kind == "GeoMonitoringPlan"
        assert detail.related_entry.status == "AVAILABLE"
        assert api.name not in detail.model_dump_json()
    assert (
        api.api.engineer.delete(
            f"{PREFIX}/{row['id']}", params={"expected_revision": 0}
        ).status_code
        == 204
    )
    with api.api.factory() as db:
        assert get_audit_log(db, entry.id).related_entry.status == "MISSING"
