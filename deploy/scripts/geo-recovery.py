#!/usr/bin/env python3
"""成套备份与一次性隔离恢复；不接受已有数据库或生产 OSS 作为恢复目标。"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import tempfile
import sys
from contextlib import ExitStack
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import settings
from app.services.storage import get_evidence_storage
from app.tools.geo_recovery_scan import database_readable, scan_database
from geo_recovery_environment import (
    RecoveryCleanupError,
    cleanup_owned_database,
    connection_boundary,
    lifecycle,
    pg_tool,
    restore_archive,
    restored_settings,
    secret_proofs,
    validate_secrets,
)
from geo_recovery_bundle import (
    RecoveryError,
    backup_key,
    file_digest,
    private_directory,
    private_file,
    seal,
    unseal,
    write_private,
)

FIXED_FILES = {
    "database.dump",
    "secrets.json",
    "release.json",
    "runtime.env",
    "nginx.conf",
}


def browser_check(db: Session, deployment: dict) -> dict:
    """N/A 同时依赖环境部署证据和实际配置/材料/PG检查，不依赖默认值。"""
    required = {
        "environment",
        "checked_at",
        "r7_deployed",
        "browser_service_running",
        "session_mounts_present",
        "material_roots",
        "quiesced",
    }
    if not required <= deployment.keys() or not deployment["environment"]:
        raise RecoveryError("DEPLOYMENT_EVIDENCE_REQUIRED")
    checked = datetime.fromisoformat(deployment["checked_at"])
    if checked.utcoffset() is None:
        raise RecoveryError("DEPLOYMENT_EVIDENCE_STALE")
    age = datetime.now(UTC) - checked
    if not timedelta(0) <= age <= timedelta(hours=1):
        raise RecoveryError("DEPLOYMENT_EVIDENCE_STALE")
    if deployment["quiesced"] is not True:
        raise RecoveryError("QUIESCED_BACKUP_REQUIRED")
    booleans = ("r7_deployed", "browser_service_running", "session_mounts_present")
    if any(type(deployment[name]) is not bool for name in booleans):
        raise RecoveryError("DEPLOYMENT_EVIDENCE_INVALID")
    roots = deployment["material_roots"]
    if not isinstance(roots, list) or any(not isinstance(v, str) for v in roots):
        raise RecoveryError("DEPLOYMENT_EVIDENCE_INVALID")
    material_count = 0
    for root in roots:
        path = Path(root)
        if not path.is_absolute() or path.is_symlink() or not path.is_dir():
            raise RecoveryError("BROWSER_MATERIAL_CHECK_FAILED")
        material_count += sum(1 for _ in path.iterdir())
    configured = any(
        (
            settings.geo_browser_session_root,
            settings.geo_browser_session_public_key_file,
            settings.geo_browser_session_service_key_file,
            settings.geo_browser_session_service_user_id,
        )
    )
    rows = db.scalar(text("SELECT count(*) FROM geo_browser_sessions"))
    if (
        any(deployment[name] for name in booleans)
        or settings.geo_browser_collection_enabled
        or configured
        or rows
        or material_count
    ):
        raise RecoveryError("BROWSER_RECOVERY_REQUIRED")
    return {
        "status": "N/A",
        "environment": deployment["environment"],
        "checked_at": deployment["checked_at"],
        "r7_deployed": False,
        "browser_service_running": False,
        "session_mounts_present": False,
        "browser_collection_enabled": False,
        "session_configured": False,
        "session_rows": rows,
        "checked_material_roots": len(roots),
        "material_entries": material_count,
    }


def download_object(row: dict, destination: Path) -> str:
    storage = get_evidence_storage()
    url = storage.download_url(
        row["object_key"], datetime.now(UTC) + timedelta(minutes=5)
    )
    try:
        with httpx.stream("GET", url, timeout=30, follow_redirects=False) as response:
            if response.status_code == 404:
                return "MISSING"
            response.raise_for_status()
            with destination.open("xb") as handle:
                os.fchmod(handle.fileno(), 0o600)
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > row["size"]:
                        return "CORRUPT"
                    handle.write(chunk)
        return (
            "VERIFIED"
            if file_digest(destination) == (row["size"], row["sha256"])
            else "CORRUPT"
        )
    except httpx.HTTPError:
        return "UNAVAILABLE"


def backup(args: argparse.Namespace) -> dict:
    connection_boundary(settings.database_url)
    key = backup_key(Path(args.backup_key_file))
    secrets = json.loads(private_file(Path(args.secrets_file)))
    validate_secrets(secrets, source=True)
    deployment = json.loads(Path(args.deployment_evidence).read_text())
    if settings.environment == "production" and (
        not args.runtime_env or not args.nginx_config
    ):
        raise RecoveryError("PRODUCTION_CONFIG_BACKUP_REQUIRED")
    bundle = Path(args.bundle)
    bundle.mkdir(mode=0o700)  # 已存在目标拒绝覆盖，失败集合没有 READY。
    set_id = uuid4().hex
    engine = create_engine(settings.database_url, isolation_level="REPEATABLE READ")
    try:
        with (
            tempfile.TemporaryDirectory(prefix="geo903-backup-") as tmp,
            Session(engine, autoflush=False) as db,
        ):
            work = Path(tmp)
            db.execute(text("SET TRANSACTION READ ONLY"))
            browser = browser_check(db, deployment)
            scan = scan_database(db, secrets["AI_CREDENTIAL_ENCRYPTION_KEY"])
            snapshot = db.scalar(text("SELECT pg_export_snapshot()"))
            pg_tool(
                "pg_dump",
                settings.database_url,
                [
                    "--format=custom",
                    "--no-owner",
                    "--no-privileges",
                    f"--snapshot={snapshot}",
                    "--file",
                    str(work / "database.dump"),
                ],
            )
            os.chmod(work / "database.dump", 0o600)
            write_private(work / "secrets.json", json.dumps(secrets).encode())
            write_private(
                work / "release.json", private_file(Path(args.release_manifest))
            )
            for name, source in (
                ("runtime.env", args.runtime_env),
                ("nginx.conf", args.nginx_config),
            ):
                if source:
                    write_private(work / name, private_file(Path(source)))
            objects = []
            for row in scan["files"]:
                if row["status"] == "DELETED":
                    objects.append({"id": row["id"], "status": "TOMBSTONE"})
                    continue
                name = f"object-{row['id']}"
                status = download_object(row, work / name)
                objects.append({"id": row["id"], "status": status})
                if status != "VERIFIED":
                    (work / name).unlink(missing_ok=True)
            artifacts = {}
            for path in sorted(work.iterdir()):
                size, digest = file_digest(path)
                artifacts[path.name] = {"size": size, "sha256": digest}
                seal(path, bundle / (path.name + ".enc"), key, f"{set_id}/{path.name}")
            complete = database_readable(scan) and all(
                o["status"] in {"VERIFIED", "TOMBSTONE"} for o in objects
            )
            manifest = {
                "version": 1,
                "set_id": set_id,
                "complete": complete,
                "created_at": datetime.now(UTC).isoformat(),
                "browser": browser,
                "scan": scan,
                "secret_proofs": secret_proofs(secrets, set_id),
                "objects": objects,
                "artifacts": artifacts,
            }
            write_private(work / "manifest.json", json.dumps(manifest).encode())
            seal(
                work / "manifest.json",
                bundle / "manifest.json.enc",
                key,
                f"{set_id}/manifest.json",
            )
            write_private(bundle / "READY", set_id.encode("ascii"))
            return {
                "operation": "backup",
                "complete": complete,
                "objects": objects,
                "browser": browser,
                "migration_head": scan["migration_head"],
                "credential_count": len(scan["credentials"]),
                "run_detail_count": len(scan["run_details"]),
            }
    finally:
        engine.dispose()


def load_bundle(bundle: Path, work: Path, key: bytes) -> dict:
    private_directory(bundle)
    set_id = private_file(bundle / "READY").decode("ascii")
    if not re.fullmatch(r"[0-9a-f]{32}", set_id):
        raise RecoveryError("BUNDLE_INVALID")
    unseal(
        bundle / "manifest.json.enc",
        work / "manifest.json",
        key,
        f"{set_id}/manifest.json",
    )
    manifest = json.loads((work / "manifest.json").read_bytes())
    if manifest["version"] != 1 or manifest["set_id"] != set_id:
        raise RecoveryError("BUNDLE_INVALID")
    if (
        not {"database.dump", "secrets.json", "release.json"}
        <= manifest["artifacts"].keys()
    ):
        raise RecoveryError("BUNDLE_INCOMPLETE")
    for name, expected in manifest["artifacts"].items():
        if name not in FIXED_FILES and not re.fullmatch(
            r"object-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}", name
        ):
            raise RecoveryError("BUNDLE_PATH_INVALID")
        if not (bundle / (name + ".enc")).is_file():
            raise RecoveryError("BUNDLE_ARTIFACT_MISSING")
        unseal(bundle / (name + ".enc"), work / name, key, f"{set_id}/{name}")
        if file_digest(work / name) != (expected["size"], expected["sha256"]):
            raise RecoveryError("BUNDLE_DIGEST_MISMATCH")
    return manifest


def restore(args: argparse.Namespace) -> dict:
    if os.environ.get("VERIFY_DATABASE_URL"):
        raise RecoveryError("EXISTING_RESTORE_TARGET_FORBIDDEN")
    admin_url = os.environ["RECOVERY_ADMIN_DATABASE_URL"]
    connection_boundary(admin_url, loopback=True)
    key = backup_key(Path(args.backup_key_file))
    name = f"partsignal_e2e_{datetime.now(UTC):%Y%m%d}_{uuid4().hex}"
    token = uuid4().hex
    create_attempted = False
    try:
        with ExitStack() as stack:
            work = Path(
                stack.enter_context(
                    tempfile.TemporaryDirectory(prefix="geo903-restore-")
                )
            )
            manifest = load_bundle(Path(args.bundle), work, key)
            secrets = json.loads((work / "secrets.json").read_bytes())
            validate_secrets(secrets)
            if secret_proofs(secrets, manifest["set_id"]) != manifest["secret_proofs"]:
                raise RecoveryError("BUNDLE_SECRET_PAIRING_MISMATCH")
            object_root = work / "oss"
            object_root.mkdir(mode=0o700)
            stack.enter_context(restored_settings(secrets, object_root))
            # 尝试创建后均检查本次 marker；同名他人库仍不能获得删除权。
            create_attempted = True
            url = lifecycle.manage_database("create", name, token, admin_url)
            engine = create_engine(url, isolation_level="REPEATABLE READ")
            try:
                with engine.connect() as connection:
                    owner = connection.scalar(
                        text(
                            "SELECT shobj_description(oid,'pg_database') FROM pg_database "
                            "WHERE datname=current_database()"
                        )
                    )
                    if owner != lifecycle.owner_marker(token) or connection.scalar(
                        text("SELECT count(*) FROM pg_tables WHERE schemaname='public'")
                    ):
                        raise RecoveryError("EMPTY_OWNED_DATABASE_REQUIRED")
                restore_archive(url, work)
                with Session(engine, autoflush=False) as db:
                    scan = scan_database(db, secrets["AI_CREDENTIAL_ENCRYPTION_KEY"])
                mismatched = [
                    part
                    for part in (
                        "migration_head",
                        "tables",
                        "schema",
                        "credentials",
                        "run_details",
                        "overview",
                    )
                    if scan[part] != manifest["scan"][part]
                ]
                objects = []
                for row in scan["files"]:
                    name_in_bundle = f"object-{row['id']}"
                    if row["status"] == "DELETED":
                        status = "TOMBSTONE"
                    elif not (work / name_in_bundle).is_file():
                        status = "MISSING"
                    else:
                        status = (
                            "VERIFIED"
                            if file_digest(work / name_in_bundle)
                            == (row["size"], row["sha256"])
                            else "CORRUPT"
                        )
                        if status == "VERIFIED":
                            target = (object_root / row["object_key"]).resolve()
                            if object_root.resolve() not in target.parents:
                                raise RecoveryError("OBJECT_KEY_INVALID")
                            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                            shutil.copyfile(work / name_in_bundle, target)
                            os.chmod(target, 0o600)
                            write_private(
                                target.with_name(target.name + ".metadata.json"),
                                json.dumps(
                                    {
                                        k: row[k]
                                        for k in ("size", "sha256", "content_type")
                                    }
                                ).encode(),
                            )
                            if file_digest(target) != (row["size"], row["sha256"]):
                                raise RecoveryError("RESTORED_OBJECT_CORRUPT")
                    objects.append({"id": row["id"], "status": status})
                return {
                    "operation": "restore",
                    "complete": manifest["complete"]
                    and not mismatched
                    and database_readable(scan)
                    and all(o["status"] in {"VERIFIED", "TOMBSTONE"} for o in objects),
                    "database": name,
                    "isolated": True,
                    "objects": objects,
                    "mismatched_sections": mismatched,
                    "credentials": scan["credentials"],
                    "run_detail_count": len(scan["run_details"]),
                    "overview": scan["overview"],
                    "migration_head": scan["migration_head"],
                    "run_states": scan["run_states"],
                    "browser": manifest["browser"],
                    "external_provider_calls": 0,
                    "object_storage": "ISOLATED_TEMPORARY_DEVELOPMENT_TREE",
                }
            finally:
                engine.dispose()
    finally:
        if create_attempted:
            cleanup_owned_database(name, token, admin_url, sys.exception())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("backup", "restore"))
    parser.add_argument("bundle")
    parser.add_argument("--backup-key-file", required=True)
    parser.add_argument("--secrets-file")
    parser.add_argument("--deployment-evidence")
    parser.add_argument("--release-manifest")
    parser.add_argument("--runtime-env")
    parser.add_argument("--nginx-config")
    args = parser.parse_args()
    os.umask(0o077)

    def cancelled(_signum, _frame):
        raise RecoveryError("RECOVERY_CANCELLED")

    signal.signal(signal.SIGTERM, cancelled)
    signal.signal(signal.SIGINT, cancelled)
    try:
        if args.operation == "backup" and not all(
            (
                args.secrets_file,
                args.deployment_evidence,
                args.release_manifest,
            )
        ):
            raise RecoveryError("BACKUP_INPUT_REQUIRED")
        result = backup(args) if args.operation == "backup" else restore(args)
        result["cleanup"] = (
            "COMPLETE" if args.operation == "restore" else "NOT_APPLICABLE"
        )
    except Exception as error:
        result = {
            "complete": False,
            "error_code": str(error)
            if isinstance(error, RecoveryError)
            else "RECOVERY_FAILED",
        }
        if isinstance(error, RecoveryCleanupError):
            result.update(
                database=error.database,
                cleanup="FAILED",
                cleanup_error_code=error.cleanup_code,
            )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    raise SystemExit(0 if result["complete"] else 2)


if __name__ == "__main__":
    main()
