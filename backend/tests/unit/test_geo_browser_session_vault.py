"""专用卷及 Python 公钥加密到独立 Node 私钥恢复的契约测试。"""

import base64
import hashlib
import json
import os
import subprocess
import traceback
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa

from app.errors import AppError
from app.schemas.geo_browser_sessions import GeoBrowserSessionEnvelope
from app.services.geo_browser_session_vault import BrowserSessionVault
from app.services.geo_browser_storage_state import validate_storage_state

CANARY = "仅限虚构测试-跨语言-secret-canary"


@pytest.fixture(scope="module")
def private_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=3072)


@pytest.fixture
def vault_files(tmp_path: Path, private_key: rsa.RSAPrivateKey) -> tuple[Path, Path]:
    root = tmp_path / "session-vault"
    root.mkdir(mode=0o700)
    key = tmp_path / "public.pem"
    key.write_bytes(
        private_key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
    )
    return root, key


def plaintext() -> str:
    now = datetime.now(UTC)
    return validate_storage_state(
        json.dumps(
            {
                "cookies": [
                    {
                        "name": "test",
                        "value": CANARY,
                        "domain": "chat.example.invalid",
                        "path": "/",
                        "expires": -1,
                        "httpOnly": True,
                        "secure": True,
                        "sameSite": "Lax",
                    }
                ],
                "origins": [
                    {
                        "origin": "https://chat.example.invalid",
                        "localStorage": [{"name": "test", "value": CANARY}],
                    }
                ],
            }
        ),
        "https://chat.example.invalid",
        now + timedelta(hours=1),
        now,
    )


def write(vault: BrowserSessionVault) -> tuple[UUID, UUID, datetime, str]:
    reference, profile = uuid4(), uuid4()
    expiry = datetime.now(UTC) + timedelta(hours=1)
    digest = vault.write(reference, profile, expiry, plaintext())
    return reference, profile, expiry, digest


def test_encryption_is_persistent_bound_random_and_api_holds_only_public_key(
    vault_files: tuple[Path, Path],
) -> None:
    root, key = vault_files
    vault = BrowserSessionVault(str(root), str(key))
    reference, profile, expiry, digest = write(vault)
    envelope = BrowserSessionVault(str(root), str(key)).read(reference, digest)
    assert CANARY not in envelope
    assert digest == hashlib.sha256(envelope.encode()).hexdigest()
    assert (root / f"{reference}.json").stat().st_mode & 0o777 == 0o600
    parsed = json.loads(envelope)
    assert set(parsed) == {
        "version",
        "algorithm",
        "reference",
        "profile_id",
        "expires_at",
        "aad",
        "wrapped_key",
        "nonce",
        "ciphertext",
    }
    assert parsed["reference"] == str(reference)
    assert parsed["profile_id"] == str(profile)
    assert parsed["expires_at"] == expiry.isoformat(timespec="microseconds")
    assert len(base64.b64decode(parsed["wrapped_key"])) == 384
    assert len(base64.b64decode(parsed["nonce"])) == 12
    other_reference = uuid4()
    other = vault.write(other_reference, profile, expiry, plaintext())
    second = json.loads(vault.read(other_reference, other))
    assert parsed["wrapped_key"] != second["wrapped_key"]
    assert parsed["nonce"] != second["nonce"]
    assert not hasattr(vault, "decrypt")
    assert not hasattr(vault, "_private_key")
    assert all(path.suffix == ".json" for path in root.iterdir())


@pytest.mark.parametrize("microseconds", [0, 123456])
def test_real_new_node_process_recovers_serialized_access_dto(
    vault_files: tuple[Path, Path], private_key: rsa.RSAPrivateKey, microseconds: int
) -> None:
    root, key = vault_files
    vault = BrowserSessionVault(str(root), str(key))
    reference, profile = uuid4(), uuid4()
    expiry = (datetime.now(UTC) + timedelta(hours=1)).replace(microsecond=microseconds)
    digest = vault.write(reference, profile, expiry, plaintext())
    response = GeoBrowserSessionEnvelope(
        session_reference=reference,
        profile_id=profile,
        expires_at=expiry,
        envelope=vault.read(reference, digest),
    ).model_dump(mode="json")
    module = Path(__file__).resolve().parents[3] / "browser-collector/src/session.mjs"
    probe = """
import { readFileSync } from 'node:fs';
const { decryptSessionEnvelope } = await import(process.argv[1]);
const input = JSON.parse(readFileSync(0, 'utf8'));
const state = decryptSessionEnvelope(input.envelope, input.key, input.expected);
process.stdout.write(JSON.stringify(JSON.stringify(state) === JSON.stringify(input.state)));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", probe, module.as_uri()],
        input=json.dumps(
            {
                "envelope": response["envelope"],
                "state": json.loads(plaintext()),
                "key": private_key.private_bytes(
                    serialization.Encoding.PEM,
                    serialization.PrivateFormat.PKCS8,
                    serialization.NoEncryption(),
                ).decode(),
                "expected": {
                    "reference": response["session_reference"],
                    "profileId": response["profile_id"],
                    "expiresAt": response["expires_at"],
                },
            }
        ),
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == "true"
    assert CANARY not in result.stderr


def test_reference_cannot_be_overwritten_and_delete_is_idempotent(
    vault_files: tuple[Path, Path],
) -> None:
    root, key = vault_files
    vault = BrowserSessionVault(str(root), str(key))
    reference, profile, expiry, digest = write(vault)
    before = vault.read(reference, digest)
    with pytest.raises(AppError) as captured:
        vault.write(reference, profile, expiry, plaintext())
    assert captured.value.code == "DEPENDENCY_UNAVAILABLE"
    assert vault.read(reference, digest) == before
    assert len(list(root.iterdir())) == 1
    vault.delete(reference)
    vault.delete(reference)
    with pytest.raises(AppError) as captured:
        vault.read(reference, digest)
    assert captured.value.code == "GEO_BROWSER_SESSION_MISSING"
    assert captured.value.status_code == 409


@pytest.mark.parametrize(
    "mode", ["hash", "permissions", "oversize", "directory", "symlink", "invalid-json", "binding"]
)
def test_object_damage_is_rejected_without_secret_or_path(
    vault_files: tuple[Path, Path], mode: str
) -> None:
    root, key = vault_files
    vault = BrowserSessionVault(str(root), str(key))
    reference, _, _, digest = write(vault)
    target = root / f"{reference}.json"
    if mode == "hash":
        target.write_bytes(target.read_bytes() + b" ")
    elif mode == "permissions":
        target.chmod(0o640)
    elif mode == "oversize":
        target.write_bytes(b"x" * (256 * 1024 + 1))
    elif mode == "directory":
        target.unlink()
        target.mkdir()
    elif mode == "symlink":
        target.unlink()
        target.symlink_to(key)
    else:
        envelope: Any = json.loads(target.read_text())
        if mode == "binding":
            envelope["reference"] = str(uuid4())
            payload = json.dumps(envelope)
        else:
            payload = CANARY
        target.write_text(payload)
        digest = hashlib.sha256(payload.encode()).hexdigest()
    with pytest.raises(AppError) as captured:
        vault.read(reference, digest)
    assert captured.value.code == "GEO_BROWSER_SESSION_UNREADABLE"
    rendered = "".join(traceback.format_exception(captured.value))
    assert CANARY not in rendered
    assert str(root) not in str(captured.value)
    assert captured.value.details == {}


@pytest.mark.parametrize(
    "kind",
    [
        "root-missing",
        "root-other",
        "root-symlink",
        "key-symlink",
        "key-private",
        "key-invalid",
        "weak-rsa",
        "not-rsa",
    ],
)
def test_configuration_fails_closed(
    vault_files: tuple[Path, Path], private_key: rsa.RSAPrivateKey, kind: str
) -> None:
    root, key = vault_files
    if kind == "root-missing":
        root = root / "missing"
    elif kind == "root-other":
        root.chmod(0o701)
    elif kind == "root-symlink":
        link = root.parent / "link"
        link.symlink_to(root, target_is_directory=True)
        root = link
    elif kind == "key-symlink":
        link = key.with_name("link.pem")
        link.symlink_to(key)
        key = link
    elif kind == "key-private":
        key.write_bytes(
            private_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
        )
    elif kind == "key-invalid":
        key.write_text(CANARY)
    elif kind in ("weak-rsa", "not-rsa"):
        replacement = (
            rsa.generate_private_key(public_exponent=65537, key_size=2048)
            if kind == "weak-rsa"
            else ec.generate_private_key(ec.SECP256R1())
        )
        key.write_bytes(
            replacement.public_key().public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
            )
        )
    with pytest.raises(AppError) as captured:
        BrowserSessionVault(str(root), str(key))
    assert captured.value.code == "DEPENDENCY_UNAVAILABLE"
    assert captured.value.status_code == 503
    assert CANARY not in "".join(traceback.format_exception(captured.value))


def test_directory_is_checked_each_time_and_parent_symlink_is_rejected(
    vault_files: tuple[Path, Path],
) -> None:
    root, key = vault_files
    vault = BrowserSessionVault(str(root), str(key))
    reference, _, _, digest = write(vault)
    root.chmod(0o707)
    with pytest.raises(AppError) as captured:
        vault.read(reference, digest)
    assert captured.value.code == "DEPENDENCY_UNAVAILABLE"
    root.chmod(0o700)
    link = root.parent / "parent-link"
    link.symlink_to(root.parent, target_is_directory=True)
    with pytest.raises(AppError):
        BrowserSessionVault(str(link / root.name), str(key))


def test_sync_failure_never_reports_success_and_cleans_staging(
    vault_files: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    root, key = vault_files
    vault = BrowserSessionVault(str(root), str(key))

    def broken_sync(_descriptor: int) -> None:
        raise OSError(CANARY)

    monkeypatch.setattr(os, "fsync", broken_sync)
    with pytest.raises(AppError) as captured:
        write(vault)
    assert captured.value.code == "DEPENDENCY_UNAVAILABLE"
    assert not list(root.iterdir())
    assert CANARY not in "".join(traceback.format_exception(captured.value))


def test_delete_failure_is_explicit_and_retryable(
    vault_files: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    root, key = vault_files
    vault = BrowserSessionVault(str(root), str(key))
    reference, _, _, digest = write(vault)
    original = os.unlink

    def broken_unlink(*_args: object, **_kwargs: object) -> None:
        raise PermissionError(CANARY)

    monkeypatch.setattr(os, "unlink", broken_unlink)
    with pytest.raises(AppError) as captured:
        vault.delete(reference)
    assert captured.value.code == "DEPENDENCY_UNAVAILABLE"
    assert CANARY not in "".join(traceback.format_exception(captured.value))
    assert vault.read(reference, digest)
    monkeypatch.setattr(os, "unlink", original)
    vault.delete(reference)
    assert not list(root.iterdir())
