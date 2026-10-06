"""恢复运维边界：认证加密、危险目标拒绝、缺失集合和条件性 N/A。"""

import argparse
import base64
import os
import runpy
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.config import settings
from app.tools.geo_recovery_scan import semantic_digest

SCRIPTS = Path(__file__).resolve().parents[3] / "deploy/scripts"


def load_recovery():
    if str(SCRIPTS) not in sys.path:
        sys.path.insert(0, str(SCRIPTS))
    return SimpleNamespace(**runpy.run_path(str(SCRIPTS / "geo-recovery.py")))


def test_authenticated_stream_roundtrip_and_restricted_files(tmp_path):
    load_recovery()
    from geo_recovery_bundle import seal, unseal, write_private

    original = b"geo903-synthetic-private-canary\x00" * 100000
    key = os.urandom(32)
    write_private(tmp_path / "source", original)
    seal(tmp_path / "source", tmp_path / "sealed", key, "set/database")
    assert b"geo903-synthetic-private-canary" not in (tmp_path / "sealed").read_bytes()
    unseal(tmp_path / "sealed", tmp_path / "restored", key, "set/database")
    assert (tmp_path / "restored").read_bytes() == original
    assert (tmp_path / "sealed").stat().st_mode & 0o077 == 0


@pytest.mark.parametrize("failure", ["wrong-key", "wrong-aad", "tamper", "truncated"])
def test_authentication_failure_never_publishes_plaintext(tmp_path, failure):
    load_recovery()
    from geo_recovery_bundle import RecoveryError, seal, unseal, write_private

    key = os.urandom(32)
    write_private(tmp_path / "source", b"secret-canary")
    seal(tmp_path / "source", tmp_path / "sealed", key, "set/secret")
    if failure in {"tamper", "truncated"}:
        data = bytearray((tmp_path / "sealed").read_bytes())
        data[24] ^= 1
        (tmp_path / "sealed").write_bytes(data[:20] if failure == "truncated" else data)
    with pytest.raises(RecoveryError, match="BUNDLE_AUTHENTICATION_FAILED"):
        unseal(
            tmp_path / "sealed",
            tmp_path / "restored",
            os.urandom(32) if failure == "wrong-key" else key,
            "wrong/secret" if failure == "wrong-aad" else "set/secret",
        )
    assert not (tmp_path / "restored").exists()


def test_refuses_unprotected_key_and_preserves_existing_destination(tmp_path):
    load_recovery()
    from geo_recovery_bundle import RecoveryError, backup_key, seal, unseal, write_private

    key = os.urandom(32)
    write_private(tmp_path / "key", base64.b64encode(key))
    (tmp_path / "key").chmod(0o644)
    with pytest.raises(RecoveryError, match="PRIVATE_FILE_REQUIRED"):
        backup_key(tmp_path / "key")
    write_private(tmp_path / "source", b"source")
    write_private(tmp_path / "existing", b"preserved")
    seal(tmp_path / "source", tmp_path / "sealed", key, "set/file")
    with pytest.raises(RecoveryError):
        unseal(tmp_path / "sealed", tmp_path / "existing", key, "set/file")
    assert (tmp_path / "existing").read_bytes() == b"preserved"


@pytest.mark.parametrize("target", ["production", "remote", "unix", "query"])
def test_dangerous_restore_target_rejected_before_io(tmp_path, monkeypatch, target):
    recovery = load_recovery()
    from geo_recovery_bundle import RecoveryError

    monkeypatch.delenv("VERIFY_DATABASE_URL", raising=False)
    monkeypatch.setenv(
        "RECOVERY_ADMIN_DATABASE_URL",
        {
            "production": "postgresql://user@127.0.0.1/main",
            "remote": "postgresql://user@production.internal/main",
            "unix": "postgresql:///main",
            "query": "postgresql://127.0.0.1/main?host=production.internal",
        }[target],
    )
    if target == "production":
        monkeypatch.setenv("VERIFY_DATABASE_URL", "postgresql://production/main")
    with pytest.raises(RecoveryError, match="FORBIDDEN|LOOPBACK_ADMIN_REQUIRED"):
        recovery.restore(argparse.Namespace(bundle=str(tmp_path), backup_key_file="unused"))


def test_na_requires_live_database_config_and_material_evidence(tmp_path, monkeypatch):
    recovery = load_recovery()
    from geo_recovery_bundle import RecoveryError

    for name in (
        "geo_browser_session_root",
        "geo_browser_session_public_key_file",
        "geo_browser_session_service_key_file",
    ):
        monkeypatch.setattr(settings, name, "")
    monkeypatch.setattr(settings, "geo_browser_session_service_user_id", None)
    monkeypatch.setattr(settings, "geo_browser_collection_enabled", False)
    evidence = {
        "environment": "unit-isolated",
        "checked_at": datetime.now(UTC).isoformat(),
        "r7_deployed": False,
        "browser_service_running": False,
        "session_mounts_present": False,
        "material_roots": [str(tmp_path)],
        "quiesced": True,
    }
    db = SimpleNamespace(scalar=lambda _query: 0)
    assert recovery.browser_check(db, evidence)["status"] == "N/A"
    (tmp_path / "unreferenced-ciphertext").write_text("synthetic")
    with pytest.raises(RecoveryError, match="BROWSER_RECOVERY_REQUIRED"):
        recovery.browser_check(db, evidence)
    (tmp_path / "unreferenced-ciphertext").unlink()
    with pytest.raises(RecoveryError, match="BROWSER_RECOVERY_REQUIRED"):
        recovery.browser_check(SimpleNamespace(scalar=lambda _query: 1), evidence)
    monkeypatch.setattr(settings, "geo_browser_session_public_key_file", "configured-key")
    with pytest.raises(RecoveryError, match="BROWSER_RECOVERY_REQUIRED"):
        recovery.browser_check(db, evidence)


def test_digest_preserves_history_and_ignores_only_read_capability():
    first = {"revision": 3, "sha256": "original", "as_of": "first", "download": {"url": "one"}}
    second = first | {"as_of": "second", "download": {"url": "two"}}
    assert semantic_digest(first) == semantic_digest(second)
    assert semantic_digest(first) != semantic_digest(second | {"revision": 4})
    assert semantic_digest(first) != semantic_digest(second | {"sha256": "damaged"})


@pytest.mark.parametrize("variable", ["PGHOSTADDR", "PGSERVICE", "PGHOST"])
def test_inherited_pg_routing_override_rejected_before_database_io(tmp_path, monkeypatch, variable):
    recovery = load_recovery()
    from geo_recovery_bundle import RecoveryError

    monkeypatch.setenv("RECOVERY_ADMIN_DATABASE_URL", "postgresql://user@127.0.0.1/postgres")
    monkeypatch.setenv(variable, "203.0.113.10")
    calls = []
    monkeypatch.setattr(recovery.lifecycle, "manage_database", lambda *args: calls.append(args))
    with pytest.raises(RecoveryError, match="PG_ENVIRONMENT_OVERRIDE_FORBIDDEN"):
        recovery.restore(argparse.Namespace(bundle=str(tmp_path), backup_key_file="unused"))
    assert calls == []


@pytest.mark.parametrize("matching_owner", [True, False])
def test_create_confirmation_lost_still_checks_exact_owner(tmp_path, monkeypatch, matching_owner):
    recovery = load_recovery()
    from geo_recovery_bundle import RecoveryError
    from geo_recovery_environment import RecoveryCleanupError

    key_path = tmp_path / "key"
    recovery.write_private(key_path, base64.b64encode(os.urandom(32)))
    monkeypatch.setenv("RECOVERY_ADMIN_DATABASE_URL", "postgresql://user@127.0.0.1/postgres")
    monkeypatch.delenv("VERIFY_DATABASE_URL", raising=False)
    secrets = {
        "AI_CREDENTIAL_ENCRYPTION_KEY": settings.ai_credential_encryption_key,
        "SESSION_SECRET": settings.session_secret,
        "UPLOAD_SIGNING_SECRET": settings.development_storage_signing_key,
    }
    calls = []
    owned = {"exists": True}

    def load(_bundle, work, _key):
        import json

        recovery.write_private(work / "secrets.json", json.dumps(secrets).encode())
        return {"set_id": "a" * 32, "secret_proofs": recovery.secret_proofs(secrets, "a" * 32)}

    def lifecycle(action, name, token, _url):
        calls.append((action, name, token))
        if action == "create":
            raise RecoveryError("CREATE_CONFIRMATION_LOST")
        if not matching_owner:
            raise ValueError("owner mismatch")
        owned["exists"] = False

    monkeypatch.setitem(recovery.restore.__globals__, "load_bundle", load)
    monkeypatch.setattr(recovery.lifecycle, "manage_database", lifecycle)
    with pytest.raises(RecoveryError, match="CREATE_CONFIRMATION_LOST") as caught:
        recovery.restore(argparse.Namespace(bundle=str(tmp_path), backup_key_file=str(key_path)))
    assert [call[0] for call in calls] == ["create", "drop"]
    assert calls[0][1:] == calls[1][1:]
    assert owned["exists"] is not matching_owner
    if not matching_owner:
        assert isinstance(caught.value, RecoveryCleanupError)
        assert caught.value.cleanup_code == "OWNERSHIP_NOT_CONFIRMED"
        assert caught.value.database == calls[0][1]
