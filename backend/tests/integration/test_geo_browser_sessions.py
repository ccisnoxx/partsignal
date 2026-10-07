"""GEO-802：真实 PostgreSQL、会话/CSRF、受限卷和撤销恢复。"""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import UUID

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from app.config import settings
from app.errors import AppError
from app.models.geo_browser_sessions import GeoBrowserSession
from app.models.geo_surfaces import GeoCollectionProfile
from app.models.identity import AuditLog
from app.schemas.geo_browser_sessions import GeoBrowserSessionImport
from app.services import geo_browser_sessions as commands
from app.services.geo_browser_session_vault import BrowserSessionVault
from tests.integration.geo_surface_management_support import (
    PROFILES,
    actor,
)
from tests.integration.geo_surface_management_support import (
    surface_api as surface_api,
)
from tests.integration.geo_surface_management_support import (
    surface_engine as surface_engine,
)

pytestmark = pytest.mark.integration
SERVICE_KEY = "fictional-geo802-service-key-for-local-test-only"
CANARY = "fictional-geo802-cookie-must-never-be-visible"


def state() -> str:
    return json.dumps(
        {
            "cookies": [
                {
                    "name": "session",
                    "value": CANARY,
                    "domain": "example.com",
                    "path": "/",
                    "expires": -1,
                    "httpOnly": True,
                    "secure": True,
                    "sameSite": "Lax",
                }
            ],
            "origins": [],
        }
    )


@pytest.fixture
def browser(surface_api, tmp_path, monkeypatch):
    vault = tmp_path / "sessions"
    vault.mkdir(mode=0o700)
    private = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    public_file = tmp_path / "public.pem"
    public_file.write_bytes(
        private.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
    )
    service_file = tmp_path / "service.key"
    service_file.write_text(SERVICE_KEY)
    service_file.chmod(0o600)
    monkeypatch.setattr(settings, "geo_browser_session_root", str(vault))
    monkeypatch.setattr(settings, "geo_browser_session_public_key_file", str(public_file))
    monkeypatch.setattr(settings, "geo_browser_session_service_key_file", str(service_file))
    monkeypatch.setattr(settings, "geo_browser_session_service_user_id", surface_api.admin_id)
    surface = surface_api.surface(compliance_status="APPROVED")
    profile = surface_api.profile(
        surface, "BROWSER", login_state="AUTHENTICATED", adapter_key="browser-session"
    )
    base = f"{PROFILES}/{profile['summary']['id']}/browser-session"
    body = {
        "expected_revision": 0,
        "storage_state": state(),
        "expires_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
        "approved_account": True,
    }
    return surface_api, base, body, vault, private


def imported(browser):
    api, base, body, _, _ = browser
    response = api.admin.post(base + "/import", json=body)
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    return response.json()


def command_body(context):
    return {
        "expected_revision": context["profile_revision"],
        "session_reference": context["session"]["session_reference"],
    }


def enable_for_material_access(api, profile_id):
    # 仅装配隔离测试的当前活动状态，不登记adapter、不调用真实平台。
    with api.factory.begin() as db:
        profile = db.get(GeoCollectionProfile, UUID(profile_id))
        if not profile.is_active:
            profile.is_active = True
            profile.revision += 1
        surface = api.admin.get(f"{PROFILES}/{profile_id}").json()["summary"]["engine_surface"]
        db.execute(
            text(
                "UPDATE geo_engine_surfaces SET is_active=true, revision=revision+1 "
                "WHERE id=:id AND NOT is_active"
            ),
            {"id": surface["id"]},
        )


def access(api, context, key=SERVICE_KEY, profile_id=None):
    reference = context["session"]["session_reference"]
    return api.admin.post(
        f"/api/internal/geo/browser-sessions/{reference}/access",
        json={"profile_id": profile_id or context["profile_id"]},
        headers={"X-GEO-Browser-Service-Key": key},
    )


def test_import_health_revoke_restore_and_redaction(browser, monkeypatch, caplog):
    api, base, body, vault, private = browser
    context = imported(browser)
    reference = context["session"]["session_reference"]
    assert context["session"]["health"] == "AVAILABLE"
    assert context["login_probe"] == "NOT_IMPLEMENTED"
    assert CANARY not in json.dumps(context)
    with api.factory() as db:
        row = db.scalar(select(GeoBrowserSession).where(GeoBrowserSession.id == UUID(reference)))
        envelope = BrowserSessionVault(
            str(vault), settings.geo_browser_session_public_key_file
        ).read(row.id, row.cipher_sha256)
        database = db.scalar(
            text("SELECT to_jsonb(s) FROM geo_browser_sessions s WHERE id=:id"), {"id": reference}
        )
        assert CANARY not in json.dumps(database)
    assert CANARY not in envelope
    enable_for_material_access(api, context["profile_id"])
    context = api.admin.get(base).json()
    monkeypatch.setattr(settings, "geo_browser_collection_enabled", True)
    response = access(api, context)
    assert response.status_code == 200, response.text
    assert CANARY not in response.text
    assert response.json()["expires_at"] == json.loads(response.json()["envelope"])["expires_at"]
    assert response.headers["Cache-Control"] == "no-store"
    checked = api.admin.post(base + "/health", json=command_body(context))
    assert checked.status_code == 200, checked.text
    revoked = api.admin.post(base + "/revoke", json=command_body(checked.json()))
    assert revoked.status_code == 200, revoked.text
    revoked_context = revoked.json()
    assert revoked_context["session"]["health"] == "REVOKED"
    assert revoked_context["cleanup_pending_count"] == 0 and not list(vault.iterdir())
    # 暂时启用配置也不能把撤销材料重新授权。
    enable_for_material_access(api, context["profile_id"])
    revoked_context = api.admin.get(base).json()
    denied = access(api, revoked_context)
    assert (
        denied.status_code == 409
        and denied.json()["error"]["code"] == "GEO_BROWSER_SESSION_REVOKED"
    )
    again = api.admin.post(base + "/revoke", json=command_body(revoked_context))
    assert again.status_code == 200 and again.json() == revoked_context
    restore_body = {**body, "expected_revision": revoked_context["profile_revision"]}
    restored = api.admin.post(base + "/import", json=restore_body)
    assert (
        restored.status_code == 200 and restored.json()["session"]["session_reference"] != reference
    )
    with api.factory() as db:
        audits = list(
            db.scalars(select(AuditLog).where(AuditLog.target_id == context["profile_id"]))
        )
        assert any(row.action == "geo_browser_session.accessed" for row in audits)
        assert not any(CANARY in json.dumps(row.details) for row in audits)
    assert not any(CANARY in record.getMessage() for record in caplog.records)


def test_permissions_csrf_and_secret_errors(browser):
    api, base, body, vault, _ = browser
    assert api.engineer.get(base).status_code == 403
    for suffix in ("import", "health", "revoke", "purge"):
        assert api.engineer.post(base + "/" + suffix, json=body).status_code == 403
    previous = api.admin.headers.pop("X-CSRF-Token")
    denied = api.admin.post(base + "/import", json=body)
    api.admin.headers["X-CSRF-Token"] = previous
    assert denied.status_code == 422
    for invalid in (
        "not-json-" + CANARY,
        json.dumps({"cookies": CANARY}),
        state().replace("example.com", "evil.example"),
    ):
        response = api.admin.post(base + "/import", json={**body, "storage_state": invalid})
        assert response.status_code == 422 and CANARY not in response.text
    response = api.admin.post(base + "/import", json={**body, CANARY: CANARY})
    assert response.status_code == 422 and CANARY not in response.text
    for approval in (False, 1, "true", None):
        denied = api.admin.post(base + "/import", json={**body, "approved_account": approval})
        assert denied.status_code == 422 and CANARY not in denied.text
    assert not list(vault.iterdir())


def test_service_identity_binding_expiry_and_kill_switch(browser, monkeypatch):
    api, base, _, _, _ = browser
    context = imported(browser)
    assert access(api, context, key="wrong").status_code == 403
    assert access(api, context).json()["error"]["code"] == "COLLECTOR_DISABLED"
    enable_for_material_access(api, context["profile_id"])
    context = api.admin.get(base).json()
    monkeypatch.setattr(settings, "geo_browser_collection_enabled", True)
    other = api.profile(
        api.surface(compliance_status="APPROVED"),
        "BROWSER",
        login_state="AUTHENTICATED",
        adapter_key="browser-session",
    )
    enable_for_material_access(api, other["summary"]["id"])
    assert access(api, context, profile_id=other["summary"]["id"]).status_code == 404
    monkeypatch.setattr(settings, "geo_browser_session_service_user_id", api.engineer_id)
    assert access(api, context).status_code == 403
    monkeypatch.setattr(settings, "geo_browser_session_service_user_id", api.admin_id)

    class Future(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.now(UTC) + timedelta(days=2)

    monkeypatch.setattr(commands, "datetime", Future)
    assert access(api, context).json()["error"]["code"] == "PROFILE_NEEDS_REAUTH"
    expired = api.admin.post(base + "/health", json=command_body(context))
    assert expired.status_code == 200 and expired.json()["session"]["health"] == "EXPIRED"
    assert expired.json()["session"]["purged_at"] is not None


def test_access_audit_failure_never_releases_ciphertext(browser, monkeypatch):
    api, base, _, vault, _ = browser
    context = imported(browser)
    enable_for_material_access(api, context["profile_id"])
    context = api.admin.get(base).json()
    monkeypatch.setattr(settings, "geo_browser_collection_enabled", True)

    def audit_failure(*_args, **_kwargs):
        raise RuntimeError("审计写入故障")

    monkeypatch.setattr(commands, "append_audit", audit_failure)
    with api.factory() as db, pytest.raises(RuntimeError, match="审计写入故障"):
        commands.access_session(
            db=db,
            reference=UUID(context["session"]["session_reference"]),
            profile_id=UUID(context["profile_id"]),
            supplied_key=SERVICE_KEY,
            request_id="geo802-access-audit-failure",
        )
    assert api.admin.get(base).json() == context
    assert len(list(vault.iterdir())) == 1
    with api.factory() as db:
        assert db.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.target_id == context["profile_id"],
                AuditLog.action == "geo_browser_session.accessed",
            )
        ) == 0


def test_revocation_cleanup_failure_is_recoverable(browser, monkeypatch):
    api, base, _, vault, _ = browser
    context = imported(browser)
    original_delete = BrowserSessionVault.delete

    def unavailable(*_args):
        raise AppError("DEPENDENCY_UNAVAILABLE", "受保护卷不可用", 503)

    monkeypatch.setattr(BrowserSessionVault, "delete", unavailable)
    revoked = api.admin.post(base + "/revoke", json=command_body(context))
    assert revoked.status_code == 200
    pending = revoked.json()
    assert pending["cleanup_pending_count"] == 1 and "PURGE" in pending["available_actions"]
    assert pending["session"]["revoked_at"] is not None and list(vault.iterdir())
    monkeypatch.setattr(BrowserSessionVault, "delete", original_delete)
    result = api.admin.post(
        base + "/purge", json={"expected_revision": pending["profile_revision"]}
    )
    assert result.status_code == 200 and result.json()["cleanup_pending_count"] == 0
    assert not list(vault.iterdir())


def test_cas_parallel_import_and_atomic_audit_failure(browser, monkeypatch):
    api, base, body, vault, _ = browser
    profile_id = UUID(base.split("/")[-2])
    barrier = Barrier(2)

    def run():
        with api.factory() as db:
            current = actor(db, api)
            barrier.wait(timeout=10)
            try:
                commands.import_session(
                    db=db,
                    profile_id=profile_id,
                    payload=GeoBrowserSessionImport(**body),
                    actor=current,
                    request_id="geo802-parallel",
                )
                return "SUCCESS"
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(run) for _ in range(2)]
        assert sorted(f.result(timeout=20) for f in futures) == ["REVISION_CONFLICT", "SUCCESS"]
    context = api.admin.get(base).json()
    assert len(list(vault.iterdir())) == 1
    with api.factory() as db:
        count = db.scalar(
            select(func.count())
            .select_from(GeoBrowserSession)
            .where(GeoBrowserSession.profile_id == profile_id)
        )
        assert count == 1

    def audit_failure(*_args, **_kwargs):
        raise RuntimeError("审计写入故障")

    monkeypatch.setattr(commands, "append_audit", audit_failure)
    with api.factory() as db, pytest.raises(RuntimeError):
        commands.import_session(
            db=db,
            profile_id=profile_id,
            payload=GeoBrowserSessionImport(**{**body, "expected_revision": 1}),
            actor=actor(db, api),
            request_id="geo802-audit-failure",
        )
    assert api.admin.get(base).json() == context
    # 未发布密文是受保护卷孤儿，不能删除可能已提交的对象或伪造补偿成功。
    assert len(list(vault.iterdir())) == 2


@pytest.mark.parametrize("damage,health", [("missing", "MISSING"), ("tamper", "UNREADABLE")])
def test_health_damage_requires_new_import_and_retains_history(browser, damage, health):
    api, base, body, vault, _ = browser
    context = imported(browser)
    reference = context["session"]["session_reference"]
    filename = vault / f"{reference}.json"
    if damage == "missing":
        filename.unlink()
    else:
        filename.write_bytes(filename.read_bytes() + b" ")
    checked = api.admin.post(base + "/health", json=command_body(context))
    assert checked.status_code == 200 and checked.json()["session"]["health"] == health
    result = api.admin.post(
        base + "/import", json={**body, "expected_revision": checked.json()["profile_revision"]}
    )
    assert result.status_code == 200
    restored = result.json()
    assert restored["session"]["session_reference"] != reference
    with api.factory() as db:
        old = db.get(GeoBrowserSession, UUID(reference))
        assert old.revoked_at is not None and old.purged_at is not None
    assert not filename.exists()
    profile = api.admin.get(f"{PROFILES}/{context['profile_id']}").json()
    assert "DELETE" not in profile["available_actions"]
    denied = api.admin.delete(
        f"{PROFILES}/{context['profile_id']}?expected_revision={restored['profile_revision']}"
    )
    assert denied.status_code == 409 and denied.json()["error"]["code"] == "GEO_PROFILE_IN_USE"


@pytest.mark.parametrize(
    "change",
    [
        "DELETE FROM geo_browser_sessions WHERE id=:id",
        "TRUNCATE geo_browser_sessions",
        "UPDATE geo_browser_sessions SET cipher_sha256=repeat('b',64) WHERE id=:id",
        "UPDATE geo_browser_sessions SET expires_at=expires_at+interval '1 hour' WHERE id=:id",
        "UPDATE geo_browser_sessions SET revoked_at=NULL, revoked_by=NULL, "
        "purged_at=NULL, health='AVAILABLE' WHERE id=:id",
        "UPDATE geo_browser_sessions SET purged_at=NULL WHERE id=:id",
    ],
)
def test_database_rejects_secret_identity_rewrite_and_revocation_undo(browser, change):
    api, base, _, _, _ = browser
    context = imported(browser)
    revoked = api.admin.post(base + "/revoke", json=command_body(context))
    assert revoked.status_code == 200
    reference = context["session"]["session_reference"]
    with api.factory() as db, pytest.raises(DBAPIError) as error:
        db.execute(text(change), {"id": reference})
        db.commit()
    assert error.value.orig.sqlstate == "55000"
    assert api.admin.get(base).json() == revoked.json()


def test_session_catalog_is_management_only_and_cannot_enable(browser):
    api, _, _, _, _ = browser
    profile_id = browser[1].split("/")[-2]
    denied = api.admin.post(f"{PROFILES}/{profile_id}/enable", json={"expected_revision": 0})
    assert denied.status_code == 409
    blockers = {item["code"] for item in denied.json()["error"]["details"]["blockers"]}
    assert {"ADAPTER_NOT_APPROVED", "CAPABILITY_UNSUPPORTED", "PROFILE_NOT_TESTED"} <= blockers


@pytest.mark.parametrize(
    "website,compliance",
    [(None, "APPROVED"), ("http://example.com", "APPROVED"), ("https://example.com", "REJECTED")],
)
def test_import_action_matches_current_website_and_compliance_guard(browser, website, compliance):
    api, base, body, vault, _ = browser
    with api.factory.begin() as db:
        profile = db.get(GeoCollectionProfile, UUID(base.split("/")[-2]))
        db.execute(
            text(
                "UPDATE geo_engine_surfaces SET website_url=:url, compliance_status=:status, "
                "revision=revision+1 WHERE id=:id"
            ),
            {"url": website, "status": compliance, "id": profile.engine_surface_id},
        )
    context = api.admin.get(base).json()
    assert "IMPORT" not in context["available_actions"]
    denied = api.admin.post(base + "/import", json=body)
    assert denied.status_code == 409
    assert denied.json()["error"]["code"] == "GEO_BROWSER_SESSION_IMPORT_FORBIDDEN"
    assert not list(vault.iterdir())
