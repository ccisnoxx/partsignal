"""GEO-205 真实 API 的权限、安全摘要、CRUD、门禁与引用保护。"""

from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import select, text

from app.models.identity import AuditLog
from tests.integration.geo_surface_management_support import (
    PROFILES,
    SURFACES,
    SurfaceAPI,
)
from tests.integration.geo_surface_management_support import surface_api as surface_api
from tests.integration.geo_surface_management_support import surface_engine as surface_engine
from tests.unit.test_geo_surface_contract import contract as contract
from tests.unit.test_geo_surface_contract import profile_payload, surface_payload, validate

pytestmark = pytest.mark.integration


def test_admin_crud_revision_noop_and_independent_profile(surface_api: SurfaceAPI) -> None:
    api = surface_api
    row = api.surface()
    sid = row["summary"]["id"]
    assert not row["summary"]["is_active"] and row["summary"]["revision"] == 0
    assert row["primary_task"] == "ENABLE_SURFACE"
    assert set(row["available_actions"]) == {"UPDATE", "ENABLE", "DELETE"}
    baseline = row["configuration"]
    payload = {key: baseline[key] for key in surface_payload()}
    noop = api.admin.patch(f"{SURFACES}/{sid}", json={**payload, "expected_revision": 0})
    assert noop.status_code == 200 and noop.json() == row
    active = api.admin.post(f"{SURFACES}/{sid}/enable", json={"expected_revision": 0}).json()
    assert active["summary"]["is_active"] and active["summary"]["revision"] == 1
    profile = api.profile(active)
    pid = profile["summary"]["id"]
    assert profile["summary"]["last_test_status"] == "UNTESTED"
    assert not profile["summary"]["is_active"] and profile["summary"]["revision"] == 0
    enabled = api.admin.post(f"{PROFILES}/{pid}/enable", json={"expected_revision": 0})
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["summary"]["is_active"]
    assert enabled.json()["summary"]["last_test_status"] == "UNTESTED"
    noop_enable = api.admin.post(f"{PROFILES}/{pid}/enable", json={"expected_revision": 1})
    assert noop_enable.status_code == 200 and noop_enable.json() == enabled.json()
    stale = api.admin.post(f"{PROFILES}/{pid}/disable", json={"expected_revision": 0})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "REVISION_CONFLICT"
    updated_payload = deepcopy(profile["configuration"])
    for field in (
        "id",
        "engine_surface_id",
        "is_active",
        "last_test_status",
        "last_tested_at",
        "revision",
        "created_by",
        "created_at",
        "updated_at",
    ):
        updated_payload.pop(field)
    changed = api.admin.patch(
        f"{PROFILES}/{pid}", json={**updated_payload, "name": "新配置名称", "expected_revision": 1}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["summary"]["revision"] == 2
    assert not changed.json()["summary"]["is_active"]
    assert api.admin.get(f"{SURFACES}/{sid}").json()["summary"]["revision"] == 1
    assert api.admin.delete(f"{PROFILES}/{pid}?expected_revision=2").status_code == 204
    assert api.admin.delete(f"{SURFACES}/{sid}?expected_revision=1").status_code == 204
    with api.factory() as db:
        assert len(list(db.scalars(select(AuditLog).where(AuditLog.target_id == sid)))) == 3
        assert len(list(db.scalars(select(AuditLog).where(AuditLog.target_id == pid)))) == 4


def test_engineer_only_summary_all_write_operations_forbidden(surface_api: SurfaceAPI) -> None:
    api = surface_api
    surface = api.surface()
    profile = api.profile(surface)
    for path, row in [(SURFACES, surface), (PROFILES, profile)]:
        rid = row["summary"]["id"]
        detail = api.engineer.get(f"{path}/{rid}").json()
        assert detail["summary"] == row["summary"]
        assert detail["configuration"] is None and detail["deletion"] is None
        assert detail["available_actions"] == [] and detail["primary_task"] == "VIEW_SUMMARY"
        if path == PROFILES:
            assert detail["activation_blockers"] is None
        for denied in [
            api.engineer.post(
                path, json=surface_payload() if path == SURFACES else profile_payload()
            ),
            api.engineer.patch(
                f"{path}/{rid}",
                json={
                    **(
                        surface_payload()
                        if path == SURFACES
                        else {
                            k: v for k, v in profile_payload().items() if k != "engine_surface_id"
                        }
                    ),
                    "expected_revision": 0,
                },
            ),
            api.engineer.post(f"{path}/{rid}/enable", json={"expected_revision": 0}),
            api.engineer.post(f"{path}/{rid}/disable", json={"expected_revision": 0}),
            api.engineer.delete(f"{path}/{rid}?expected_revision=0"),
        ]:
            assert denied.status_code == 403, denied.text
        listing = api.engineer.get(path).json()
        assert any(item["summary"]["id"] == rid for item in listing["items"])
        serialized = str(detail)
        for forbidden in (
            "website_url",
            "created_by",
            "adapter_key",
            "settings",
            "ai_model_id",
            "ai_channel_id",
        ):
            assert forbidden not in serialized


@pytest.mark.parametrize("mode", ["MANUAL", "API", "BROWSER"])
def test_rejected_secret_inputs_never_echo_values(surface_api: SurfaceAPI, mode: str) -> None:
    api = surface_api
    surface = api.surface()
    marker = "fictional-sensitive-value-205"
    for field in ("api_key", "headers", "Cookie", "session_path"):
        for nesting in (False, True):
            payload = profile_payload(mode, engine_surface_id=surface["summary"]["id"])
            (payload["settings"] if nesting else payload)[field] = marker
            response = api.admin.post(PROFILES, json=payload)
            assert response.status_code == 422
            assert marker not in response.text
    payload = profile_payload(mode, engine_surface_id=surface["summary"]["id"])
    payload["collection_mode"] = marker
    response = api.admin.post(PROFILES, json=payload)
    assert response.status_code == 422 and marker not in response.text


def test_csrf_revision_validation_uniqueness_and_missing(surface_api: SurfaceAPI) -> None:
    api = surface_api
    row = api.surface()
    sid = row["summary"]["id"]
    duplicate = api.admin.post(SURFACES, json=surface_payload(slug=row["summary"]["slug"]))
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "GEO_SURFACE_SLUG_EXISTS"
    profile = api.profile(row)
    duplicate = api.admin.post(PROFILES, json=profile_payload(engine_surface_id=sid))
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "GEO_PROFILE_NAME_EXISTS"
    csrf = api.admin.headers.pop("X-CSRF-Token")
    try:
        assert (
            api.admin.post(f"{SURFACES}/{sid}/enable", json={"expected_revision": 0}).status_code
            == 422
        )
        assert (
            api.admin.post(
                f"{SURFACES}/{sid}/enable",
                json={"expected_revision": 0},
                headers={"X-CSRF-Token": "wrong-but-long-enough-32-byte-token"},
            ).status_code
            == 403
        )
    finally:
        api.admin.headers["X-CSRF-Token"] = csrf
    for path in (SURFACES, PROFILES):
        assert api.admin.get(f"{path}/{uuid4()}").status_code == 404
        assert api.admin.get(f"{path}?page_size=11").status_code == 422
        assert api.admin.get(f"{path}?page=0").status_code == 422
        assert api.admin.get(f"{path}?q=%00").status_code == 422
        rid = sid if path == SURFACES else profile["summary"]["id"]
        assert api.admin.delete(f"{path}/{rid}").status_code == 422


def test_live_profile_and_history_marker_block_surface_deletion(surface_api: SurfaceAPI) -> None:
    api = surface_api
    row = api.surface()
    sid = row["summary"]["id"]
    profile = api.profile(row)
    detail = api.admin.get(f"{SURFACES}/{sid}").json()
    assert detail["deletion"]["blockers"] == [{"type": "COLLECTION_PROFILE", "count": 1}]
    blocked = api.admin.delete(f"{SURFACES}/{sid}?expected_revision=0")
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "GEO_SURFACE_IN_USE"
    assert (
        api.admin.delete(f"{PROFILES}/{profile['summary']['id']}?expected_revision=0").status_code
        == 204
    )
    with api.factory() as db:
        db.execute(
            text(
                "UPDATE geo_engine_surfaces SET first_referenced_at=now(), "
                "revision=revision+1, updated_at=now() WHERE id=:id"
            ),
            {"id": sid},
        )
        db.commit()
    detail = api.admin.get(f"{SURFACES}/{sid}").json()
    assert detail["deletion"]["blockers"] == [{"type": "HISTORICAL_REFERENCE", "count": 1}]
    assert "DELETE" not in detail["available_actions"]
    assert api.admin.delete(f"{SURFACES}/{sid}?expected_revision=1").status_code == 409


def test_actual_admin_and_engineer_payloads_satisfy_closed_public_read_contract(
    surface_api: SurfaceAPI,
    contract: dict,
) -> None:
    api = surface_api
    surface = api.surface()
    profile = api.profile(surface)
    for component, path, row in [
        ("GeoEngineSurfaceRead", SURFACES, surface),
        ("GeoCollectionProfileRead", PROFILES, profile),
    ]:
        validate(contract, component, row)
        engineer = api.engineer.get(f"{path}/{row['summary']['id']}").json()
        validate(contract, component, engineer)
