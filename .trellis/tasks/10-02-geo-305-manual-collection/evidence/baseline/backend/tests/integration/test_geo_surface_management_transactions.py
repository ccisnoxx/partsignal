"""GEO-205 事务原子性、Registry 门禁、当前模型与固定查询快照。"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.collectors import registry as collectors
from app.collectors.registry import CollectorRegistry
from app.config import settings
from app.models.ai_generation import AIChannel, AIModel
from app.models.geo_surfaces import GeoCollectionProfile
from app.models.identity import AuditLog
from app.schemas.geo_surfaces import GeoCollectionMode, GeoEngineSurfaceUpdate
from app.services import geo_surface_commands as commands
from app.services.audit_logs import get_audit_log
from tests.integration.geo_surface_management_support import PROFILES, SURFACES, SurfaceAPI, actor
from tests.integration.geo_surface_management_support import surface_api as surface_api
from tests.integration.geo_surface_management_support import surface_engine as surface_engine
from tests.unit.test_geo_collector_registry import registration
from tests.unit.test_geo_surface_contract import profile_payload, surface_payload

pytestmark = pytest.mark.integration


def state(api: SurfaceAPI, table: str, resource_id: str) -> tuple:
    assert table in {"geo_engine_surfaces", "geo_collection_profiles"}
    with api.factory() as db:
        return db.execute(
            text(
                "SELECT to_jsonb(s), "
                "(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM audit_logs l "
                f"WHERE l.target_id=CAST(s.id AS text)) FROM {table} s WHERE s.id=:id"
            ),
            {"id": resource_id},
        ).one()


def test_audit_failure_and_unknown_integrity_roll_back_whole_change(
    surface_api: SurfaceAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = surface_api
    row = api.surface()
    sid = row["summary"]["id"]
    before = state(api, "geo_engine_surfaces", sid)

    def fail_audit(*args, **kwargs):
        raise RuntimeError("test-only audit storage failure")

    monkeypatch.setattr(commands, "append_audit", fail_audit)
    with api.factory() as db, pytest.raises(RuntimeError):
        commands.update_surface(
            db=db,
            actor=actor(db, api),
            surface_id=UUID(sid),
            request_id="geo205-audit-fail",
            payload=GeoEngineSurfaceUpdate(
                **surface_payload(slug=row["summary"]["slug"], name="不会提交"),
                expected_revision=0,
            ),
        )
        assert db.is_active
    assert state(api, "geo_engine_surfaces", sid) == before

    def violate_audit(db, *args, **kwargs):
        db.add(
            AuditLog(
                actor_id=uuid4(),
                business_module="CONFIGURATION",
                outcome="SUCCESS",
                action="geo_engine_surface.updated",
                target_type="GeoEngineSurface",
                target_id=sid,
                result_message="测试失败",
                request_id="geo205-audit-fk",
                details={},
            )
        )

    monkeypatch.setattr(commands, "append_audit", violate_audit)
    with api.factory() as db, pytest.raises(IntegrityError) as error:
        commands.update_surface(
            db=db,
            actor=actor(db, api),
            surface_id=UUID(sid),
            request_id="geo205-audit-fail",
            payload=GeoEngineSurfaceUpdate(
                **surface_payload(slug=row["summary"]["slug"], name="不会提交"),
                expected_revision=0,
            ),
        )
    assert error.value.orig.sqlstate == "23503"
    assert state(api, "geo_engine_surfaces", sid) == before


def test_registry_rejects_unknown_and_unapproved_browser_without_success_audit(
    surface_api: SurfaceAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = surface_api
    row = api.surface(compliance_status="APPROVED")
    sid = row["summary"]["id"]
    unknown = api.admin.post(PROFILES, json=profile_payload("BROWSER", engine_surface_id=sid))
    assert unknown.status_code == 422 and unknown.json()["error"]["code"] == "GEO_ADAPTER_UNKNOWN"
    registry = CollectorRegistry(
        [
            collectors.collector_registry.resolve("manual"),
            registration(GeoCollectionMode.BROWSER, key="test-browser", approved=False),
        ]
    )
    monkeypatch.setattr(collectors, "collector_registry", registry)
    enabled_surface = api.admin.post(
        f"{SURFACES}/{sid}/enable", json={"expected_revision": 0}
    ).json()
    browser = api.profile(enabled_surface, "BROWSER", adapter_key="test-browser")
    pid = browser["summary"]["id"]
    before = state(api, "geo_collection_profiles", pid)
    response = api.admin.post(f"{PROFILES}/{pid}/enable", json={"expected_revision": 0})
    assert (
        response.status_code == 409 and response.json()["error"]["code"] == "GEO_PROFILE_INELIGIBLE"
    )
    codes = {item["code"] for item in response.json()["error"]["details"]["blockers"]}
    assert {"ADAPTER_NOT_APPROVED", "PROFILE_NOT_TESTED", "BROWSER_COLLECTION_DISABLED"} <= codes
    assert state(api, "geo_collection_profiles", pid) == before
    assert "ENABLE" not in browser["available_actions"]
    assert browser["summary"]["last_test_status"] == "UNTESTED"


def test_manual_shared_monitoring_and_surface_gates_are_final_guards(
    surface_api: SurfaceAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = surface_api
    row = api.surface()
    profile = api.profile(row)
    pid = profile["summary"]["id"]
    response = api.admin.post(f"{PROFILES}/{pid}/enable", json={"expected_revision": 0})
    assert {item["code"] for item in response.json()["error"]["details"]["blockers"]} == {
        "SURFACE_DISABLED"
    }
    monkeypatch.setattr(settings, "geo_monitoring_enabled", False)
    surface = api.admin.post(
        f"{SURFACES}/{row['summary']['id']}/enable", json={"expected_revision": 0}
    )
    assert surface.status_code == 200
    response = api.admin.post(f"{PROFILES}/{pid}/enable", json={"expected_revision": 0})
    assert {item["code"] for item in response.json()["error"]["details"]["blockers"]} == {
        "MONITORING_DISABLED"
    }


def model_binding(api: SurfaceAPI) -> tuple[UUID, UUID]:
    with api.factory() as db:
        channel = AIChannel(
            name="虚构渠道",
            description="不调用外部服务",
            protocol_type="openai-compatible-chat-completions",
            provider_brand="CUSTOM",
            base_url="https://example.com",
            api_key_ciphertext="fictional-secret-ciphertext-205",
            api_key_updated_at=datetime.now(UTC),
            timeout_seconds=30,
            is_enabled=True,
            revision=0,
            created_by=api.admin_id,
        )
        db.add(channel)
        db.flush()
        model = AIModel(
            channel_id=channel.id,
            display_name="虚构模型",
            model_id="fictional-model",
            request_parameters={"fictional-secret-parameter": "must-not-leak"},
            is_enabled=True,
            test_status="PASSED",
            last_tested_at=datetime.now(UTC),
            revision=0,
            created_by=api.admin_id,
        )
        db.add(model)
        db.commit()
        return channel.id, model.id


def api_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        collectors,
        "collector_registry",
        CollectorRegistry(
            [
                collectors.collector_registry.resolve("manual"),
                registration(model_protocol="openai-compatible-chat-completions"),
            ]
        ),
    )
    monkeypatch.setattr(settings, "geo_api_collection_enabled", True)


def mark_profile_tested(api: SurfaceAPI, pid: str) -> None:
    with api.factory() as db:
        db.execute(
            text(
                "UPDATE geo_collection_profiles SET last_test_status='PASSED', "
                "last_tested_at=now(), revision=revision+1, "
                "updated_at=greatest(clock_timestamp(),updated_at) WHERE id=:id"
            ),
            {"id": pid},
        )
        db.commit()


def test_current_binding_test_reset_noop_and_role_safe_model_projection(
    surface_api: SurfaceAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = surface_api
    api_registry(monkeypatch)
    channel, model = model_binding(api)
    surface = api.surface(surface_kind="MODEL_API", compliance_status="APPROVED")
    sid = surface["summary"]["id"]
    api.admin.post(f"{SURFACES}/{sid}/enable", json={"expected_revision": 0})
    row = api.profile(
        surface, "API", adapter_key="test-api", ai_channel_id=str(channel), ai_model_id=str(model)
    )
    pid = row["summary"]["id"]
    mark_profile_tested(api, pid)
    enabled = api.admin.post(f"{PROFILES}/{pid}/enable", json={"expected_revision": 1})
    assert enabled.status_code == 200, enabled.text
    assert "fictional-secret" not in enabled.text and "must-not-leak" not in enabled.text
    payload = profile_payload(
        "API", adapter_key="test-api", ai_channel_id=str(channel), ai_model_id=str(model)
    )
    payload.pop("engine_surface_id")
    before = state(api, "geo_collection_profiles", pid)
    noop = api.admin.patch(f"{PROFILES}/{pid}", json={**payload, "expected_revision": 2})
    assert noop.status_code == 200 and state(api, "geo_collection_profiles", pid) == before
    update = api.admin.patch(
        f"{PROFILES}/{pid}",
        json={**payload, "expected_revision": 2, "settings": {"temperature": 0.5}},
    )
    assert update.status_code == 200
    assert update.json()["summary"]["revision"] == 3
    assert not update.json()["summary"]["is_active"]
    assert update.json()["summary"]["last_test_status"] == "UNTESTED"
    assert update.json()["summary"]["last_tested_at"] is None
    mark_profile_tested(api, pid)
    with api.factory() as db:
        cached = db.get(GeoCollectionProfile, UUID(pid))
        db.execute(text("DELETE FROM ai_models WHERE id=:id"), {"id": model})
        assert cached.ai_model_id == model
        db.commit()
    response = api.admin.post(f"{PROFILES}/{pid}/enable", json={"expected_revision": 4})
    assert response.status_code == 409
    assert "MODEL_BINDING_REQUIRED" in response.text
    engineer = api.engineer.get(f"{PROFILES}/{pid}").json()
    assert engineer["activation_blockers"] is None and engineer["configuration"] is None


def test_invalid_binding_and_registered_configuration_failure_are_422(
    surface_api: SurfaceAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = surface_api
    api_registry(monkeypatch)
    channel, model = model_binding(api)
    other_channel, _ = model_binding(api)
    surface = api.surface()
    payload = profile_payload(
        "API",
        engine_surface_id=surface["summary"]["id"],
        adapter_key="test-api",
        ai_channel_id=str(other_channel),
        ai_model_id=str(model),
    )
    response = api.admin.post(PROFILES, json=payload)
    assert (
        response.status_code == 422
        and response.json()["error"]["code"] == "GEO_MODEL_BINDING_INVALID"
    )
    registry = CollectorRegistry([registration(languages=frozenset({"en"}))])
    monkeypatch.setattr(collectors, "collector_registry", registry)
    payload.update(ai_channel_id=str(channel))
    response = api.admin.post(PROFILES, json=payload)
    assert (
        response.status_code == 422
        and response.json()["error"]["code"] == "GEO_PROFILE_CONFIGURATION_INVALID"
    )


def test_audit_detail_available_and_missing_targets(surface_api: SurfaceAPI) -> None:
    api = surface_api
    surface = api.surface()
    profile = api.profile(surface)
    sid, pid = surface["summary"]["id"], profile["summary"]["id"]
    with api.factory() as db:
        audits = list(db.scalars(select(AuditLog).where(AuditLog.target_id.in_([sid, pid]))))
        ids = [item.id for item in audits]
        for audit in audits:
            detail = get_audit_log(db, audit.id)
            assert detail.related_entry.status == "AVAILABLE"
            assert detail.related_entry.kind == audit.target_type
            if audit.target_id == pid:
                assert detail.related_entry.parent_id == sid
    api.admin.delete(f"{PROFILES}/{pid}?expected_revision=0")
    api.admin.delete(f"{SURFACES}/{sid}?expected_revision=0")
    with api.factory() as db:
        assert all(get_audit_log(db, aid).related_entry.status == "MISSING" for aid in ids)
