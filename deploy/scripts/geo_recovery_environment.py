"""GEO 恢复的连接、配套密钥和受控资源生命周期边界。"""

from __future__ import annotations

import hashlib
import hmac
import importlib.util
import os
import subprocess
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy.engine import make_url

from app.config import settings
from geo_recovery_bundle import RecoveryError

SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "e2e_database", SCRIPTS / "e2e-database.py"
)
assert spec is not None and spec.loader is not None
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)

SECRET_FIELDS = {
    "AI_CREDENTIAL_ENCRYPTION_KEY": "ai_credential_encryption_key",
    "SESSION_SECRET": "session_secret",
    "UPLOAD_SIGNING_SECRET": "development_storage_signing_key",
}
SECRET_NAMES = set(SECRET_FIELDS)


def connection_boundary(url: str, *, loopback: bool = False) -> None:
    # psycopg 和 PG CLI 必须指向同一集群；继承 PGHOSTADDR/PGSERVICE 等可绕过 URL。
    if any(name.startswith("PG") for name in os.environ):
        raise RecoveryError("PG_ENVIRONMENT_OVERRIDE_FORBIDDEN")
    target = make_url(url)
    if (
        target.drivername not in {"postgresql", "postgresql+psycopg"}
        or not target.host
        or target.query
        or urlsplit(url).fragment
        or (loopback and target.host not in {"127.0.0.1", "::1"})
    ):
        raise RecoveryError(
            "LOOPBACK_ADMIN_REQUIRED"
            if loopback
            else "PG_CONNECTION_OPTIONS_UNSUPPORTED"
        )


def validate_secrets(secrets: dict, *, source: bool = False) -> None:
    if (
        set(secrets) != SECRET_NAMES
        or any(not isinstance(v, str) or not v for v in secrets.values())
        or len(secrets["SESSION_SECRET"]) < 32
    ):
        raise RecoveryError("SECRETS_INVENTORY_INVALID")
    if source and any(
        not hmac.compare_digest(
            secrets[name].encode(), getattr(settings, field).encode()
        )
        for name, field in SECRET_FIELDS.items()
    ):
        raise RecoveryError("SOURCE_SECRET_PAIRING_MISMATCH")


def secret_proofs(secrets: dict, set_id: str) -> dict:
    return {
        name: hmac.new(
            value.encode(), f"geo903/{set_id}/{name}".encode(), hashlib.sha256
        ).hexdigest()
        for name, value in secrets.items()
    }


@contextmanager
def restored_settings(secrets: dict, object_root: Path):
    # 独立运维进程的临时配置；不启动应用/worker，且在异常时恢复原值。
    updates = {field: secrets[name] for name, field in SECRET_FIELDS.items()}
    updates.update(
        {
            "object_storage_backend": "development",
            "development_storage_path": str(object_root),
            "development_storage_internal_url": "http://127.0.0.1:1",
            "development_storage_public_url": "http://127.0.0.1:1",
        }
    )
    original = {field: getattr(settings, field) for field in updates}
    try:
        for field, value in updates.items():
            setattr(settings, field, value)
        yield
    finally:
        for field, value in original.items():
            setattr(settings, field, value)


class RecoveryCleanupError(RecoveryError):
    def __init__(self, database: str, primary: BaseException | None, cleanup_code: str):
        super().__init__(
            str(primary) if isinstance(primary, RecoveryError) else "RECOVERY_FAILED"
        )
        self.database = database
        self.cleanup_code = cleanup_code


def cleanup_owned_database(
    name: str, token: str, admin_url: str, primary: BaseException | None
) -> None:
    try:
        lifecycle.manage_database("drop", name, token, admin_url)
    except Exception as error:
        code = (
            "OWNERSHIP_NOT_CONFIRMED"
            if isinstance(error, ValueError)
            else "CLEANUP_FAILED"
        )
        raise RecoveryCleanupError(name, primary, code) from None


def pg_tool(name: str, url: str, arguments: list[str]) -> None:
    """libpq 从子进程环境读取连接串；argv 和失败报告均不包含凭据。"""
    binary = Path(os.environ.get("RECOVERY_PG_BIN", "/usr/bin")) / name
    target = make_url(url)
    if target.query:
        raise RecoveryError("PG_CONNECTION_OPTIONS_UNSUPPORTED")
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env.update(
        {
            "PGHOST": target.host or "",
            "PGPORT": str(target.port or 5432),
            "PGDATABASE": target.database or "",
            "PGUSER": target.username or "",
            "PGPASSWORD": target.password or "",
            "PGCONNECT_TIMEOUT": "10",
        }
    )
    try:
        result = subprocess.run(
            [str(binary), *arguments],
            env=env,
            capture_output=True,
            timeout=600,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RecoveryError(f"{name.upper()}_UNAVAILABLE") from None
    if result.returncode:
        raise RecoveryError(f"{name.upper()}_FAILED")


def restore_archive(url: str, work: Path) -> None:
    # pg_restore 的空 search_path 会使既有 SQL-string 函数在 generated CHECK 中内联失败。
    # 仅在已确认空库/owner 的隔离数据库内，使用 pg_catalog 与本次 dump 的 public。
    sql_source, sql_target = work / "restore-original.sql", work / "restore.sql"
    pg_tool(
        "pg_restore",
        url,
        [
            "--no-owner",
            "--no-privileges",
            "--file",
            str(sql_source),
            str(work / "database.dump"),
        ],
    )
    os.chmod(sql_source, 0o600)
    expected = "SELECT pg_catalog.set_config('search_path', '', false);\n"
    count = 0
    with sql_source.open() as incoming, sql_target.open("x") as outgoing:
        os.fchmod(outgoing.fileno(), 0o600)
        for line in incoming:
            if line == expected:
                line = "SELECT pg_catalog.set_config('search_path', 'pg_catalog,public', false);\n"
                count += 1
            outgoing.write(line)
    if count != 1:
        raise RecoveryError("RESTORE_SEARCH_PATH_UNEXPECTED")
    pg_tool(
        "psql",
        url,
        [
            "--no-psqlrc",
            "--single-transaction",
            "--set=ON_ERROR_STOP=1",
            "--file",
            str(sql_target),
        ],
    )
