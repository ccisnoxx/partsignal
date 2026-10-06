"""GEO-903 真实恢复、缺失/错误密钥与受控停止的验收场景。"""

import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.dev_storage import app as storage_app
from app.models.geo_files import FileRecord
from app.models.identity import SessionRecord
from app.security import hash_token
from app.services import geo_batches
from app.services.storage import signed_storage_url
from app.tools.geo_recovery_scan import database_readable, scan_database
from tests.integration.geo_recovery_support import (
    plans_api as plans_api,
)
from tests.integration.geo_recovery_support import (
    questions_api as questions_api,
)
from tests.integration.geo_recovery_support import (
    questions_engine as questions_engine,
)
from tests.integration.geo_recovery_support import (
    recovery_case as recovery_case,
)
from tests.integration.geo_recovery_support import (
    recovery_pg_tools as recovery_pg_tools,
)

pytestmark = pytest.mark.integration


def test_real_restore_preserves_details_metrics_credentials_and_schedule(
    recovery_case, monkeypatch
):
    recovery, args, api, rows, data, scheduled, plan, window, master = recovery_case
    result = recovery.backup(args)
    assert result["complete"] and result["credential_count"] == 2
    assert result["browser"]["status"] == "N/A"
    packed = json.loads(Path(args.secrets_file).read_text())
    token = api.api.engineer.cookies.get(settings.session_cookie_name)
    assert token
    monkeypatch.setattr(settings, "session_secret", "wrong-current-session-key" * 2)
    monkeypatch.setattr(settings, "development_storage_signing_key", "wrong-current-object-key")
    tested_objects = []
    original_scan = recovery.scan_database
    original_digest = recovery.file_digest

    def scan(db, key):
        assert settings.session_secret == packed["SESSION_SECRET"]
        assert settings.development_storage_signing_key == packed["UPLOAD_SIGNING_SECRET"]
        result = original_scan(db, key)
        assert db.scalar(
            select(SessionRecord.id).where(SessionRecord.token_hash == hash_token(token))
        )
        if db.get_bind().url.database.startswith("partsignal_e2e_"):
            engine = create_engine(db.get_bind().url)
            try:

                def replay(_):
                    with Session(engine) as session:
                        return geo_batches.create_scheduled_batch(
                            db=session, plan_id=UUID(plan["id"]), scheduled_for=window
                        )

                with ThreadPoolExecutor(max_workers=2) as pool:
                    assert list(pool.map(replay, range(2))) == [scheduled, scheduled]
                with Session(engine) as session:
                    count = session.scalar(
                        text(
                            "SELECT count(*) FROM geo_observation_batches "
                            "WHERE plan_id=:id AND scheduled_for=:window"
                        ),
                        {"id": UUID(plan["id"]), "window": window},
                    )
                    assert count == 1
                with engine.connect() as connection:
                    from sqlalchemy.exc import IntegrityError

                    with pytest.raises(IntegrityError) as immutable:
                        connection.execute(
                            text("UPDATE geo_answer_snapshots SET answer_text=answer_text")
                        )
                    assert getattr(immutable.value.orig, "sqlstate", None) == "23514"
                    assert immutable.value.orig.diag.constraint_name == "ck_geo_answers_immutable"
                    connection.rollback()
            finally:
                engine.dispose()
        return result

    def digest(path):
        if "/oss/" in str(path):
            object_root = next(parent for parent in path.parents if parent.name == "oss")
            key = path.relative_to(object_root).as_posix()
            identity = next(str(identity) for identity, expected in rows if expected == key)
            with monkeypatch.context() as patch:
                patch.setattr(settings, "development_storage_path", str(object_root))
                expires = datetime.now(UTC) + timedelta(minutes=1)
                with TestClient(storage_app) as client:
                    downloaded = client.get(signed_storage_url("download", key, expires))
                    head = client.head(signed_storage_url("head", key, expires))
                    assert downloaded.status_code == head.status_code == 200
                    assert downloaded.content == data[identity]
                    assert (
                        head.headers["x-meta-sha256"] == hashlib.sha256(data[identity]).hexdigest()
                    )
            tested_objects.append(identity)
        return original_digest(path)

    monkeypatch.setitem(recovery.restore.__globals__, "scan_database", scan)
    monkeypatch.setitem(recovery.restore.__globals__, "file_digest", digest)
    restored = recovery.restore(args)
    assert restored["complete"], json.dumps(restored, ensure_ascii=False)
    assert restored["run_detail_count"] >= 2 and restored["overview"]["status"] == "READABLE"
    assert len(tested_objects) == 2
    with psycopg.connect(
        os.environ["PARTSIGNAL_TEST_DATABASE_URL"].replace(
            "postgresql+psycopg://", "postgresql://", 1
        )
    ) as conn:
        assert (
            conn.execute(
                "SELECT 1 FROM pg_database WHERE datname=%s", (restored["database"],)
            ).fetchone()
            is None
        )
    assert "geo903-api-secret-canary" not in json.dumps(restored)
    assert "geo903-header-secret-canary" not in json.dumps(restored)
    assert master not in json.dumps(restored)
    if output := os.environ.get("GEO_RECOVERY_EVIDENCE_DIR"):
        evidence = Path(output)
        evidence.mkdir(parents=True, exist_ok=True)
        (evidence / "isolated-restore.json").write_text(
            json.dumps(
                restored
                | {
                    "cleanup": "COMPLETE",
                    "target_absent_after_restore": True,
                    "object_get_head_verified": len(tested_objects),
                    "schedule_concurrent_replays": 2,
                    "schedule_window_rows": 1,
                    "session_token_hash_verified": True,
                    "table_fingerprints_equal": True,
                    "schema_fingerprint_equal": True,
                    "answer_immutable_guard_verified": True,
                },
                indent=2,
            )
        )


def test_missing_evidence_remains_missing_without_removing_run(recovery_case):
    recovery, args, api, rows, _data, *_ = recovery_case
    # 配置只用于读取检查；获取本测试拥有的源码目录，不碰共享对象。
    source = Path(args.bundle).parent / "source-objects"
    (source / rows[0][1]).unlink()
    backup = recovery.backup(args)
    assert not backup["complete"]
    assert {"id": str(rows[0][0]), "status": "MISSING"} in backup["objects"]
    restored = recovery.restore(args)
    assert not restored["complete"]
    assert {"id": str(rows[0][0]), "status": "MISSING"} in restored["objects"]
    assert restored["mismatched_sections"] == []
    assert restored["run_detail_count"] >= 2
    if output := os.environ.get("GEO_RECOVERY_EVIDENCE_DIR"):
        (Path(output) / "missing-object-restore.json").write_text(json.dumps(restored, indent=2))
    with api.api.factory() as db:
        assert db.scalar(select(FileRecord.sha256).where(FileRecord.id == rows[0][0]))


def test_wrong_master_key_is_reported_without_database_writes(recovery_case):
    _recovery, _args, api, *_rest, master = recovery_case
    engine = create_engine(api.api.engine.url, isolation_level="REPEATABLE READ")
    try:
        with Session(engine, autoflush=False) as db:
            good = scan_database(db, master)
        with Session(engine, autoflush=False) as db:
            bad = scan_database(db, base64.b64encode(os.urandom(32)).decode())
        assert database_readable(good) and not database_readable(bad)
        assert all(row["status"] == "CREDENTIAL_DECRYPTION_FAILED" for row in bad["credentials"])
        assert good["tables"] == bad["tables"]
    finally:
        engine.dispose()


@pytest.mark.parametrize("name", ["SESSION_SECRET", "UPLOAD_SIGNING_SECRET"])
def test_wrong_paired_key_cannot_produce_successful_bundle(recovery_case, name):
    recovery, args, *_ = recovery_case
    secrets = json.loads(Path(args.secrets_file).read_text())
    secrets[name] = "wrong-environment-key-with-valid-length-32"
    Path(args.secrets_file).write_text(json.dumps(secrets))
    from geo_recovery_bundle import RecoveryError

    with pytest.raises(RecoveryError, match="SOURCE_SECRET_PAIRING_MISMATCH"):
        recovery.backup(args)
    assert not Path(args.bundle).exists()


def test_sigterm_cleans_owned_database_and_decrypted_files(recovery_case, tmp_path):
    recovery, args, *_ = recovery_case
    assert recovery.backup(args)["complete"]
    tools = tmp_path / "signal-tools"
    tools.mkdir(mode=0o700)
    for name in ("pg_dump", "pg_restore"):
        shutil.copyfile(Path(os.environ["RECOVERY_PG_BIN"]) / name, tools / name)
        (tools / name).chmod(0o700)
    ready = tmp_path / "signal-ready"
    blocker = tools / "psql"
    blocker.write_text(
        "#!/usr/bin/env python3\nimport os,sys,time,json\nfrom pathlib import Path\n"
        + f"ready = Path({str(ready)!r})\n"
        + "ready.write_text(json.dumps({'database':os.environ['PGDATABASE'],\n"
        + "'plaintext_root':str(Path(sys.argv[-1]).parent),'pg_child_pid':os.getpid()}))\n"
        + "time.sleep(120)\n"
    )
    blocker.chmod(0o700)
    env = dict(os.environ, RECOVERY_PG_BIN=str(tools), PYTHONPATH=str(Path("backend").resolve()))
    process = subprocess.Popen(
        [
            sys.executable,
            "deploy/scripts/geo-recovery.py",
            "restore",
            args.bundle,
            "--backup-key-file",
            args.backup_key_file,
        ],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        deadline = time.monotonic() + 15
        while not ready.exists():
            assert process.poll() is None
            assert time.monotonic() < deadline
            time.sleep(0.05)
        owned = json.loads(ready.read_text())
        process.terminate()
        output, error = process.communicate(timeout=15)
        assert process.returncode == 2 and not error
        assert json.loads(output)["error_code"] == "RECOVERY_CANCELLED"
        assert not Path(owned["plaintext_root"]).exists()
        with pytest.raises(ProcessLookupError):
            os.kill(owned["pg_child_pid"], 0)
        with psycopg.connect(
            os.environ["PARTSIGNAL_TEST_DATABASE_URL"].replace(
                "postgresql+psycopg://", "postgresql://", 1
            )
        ) as connection:
            assert (
                connection.execute(
                    "SELECT 1 FROM pg_database WHERE datname=%s", (owned["database"],)
                ).fetchone()
                is None
            )
        if evidence := os.environ.get("GEO_RECOVERY_EVIDENCE_DIR"):
            (Path(evidence) / "cancelled-restore.json").write_text(
                json.dumps(
                    {
                        "error_code": "RECOVERY_CANCELLED",
                        "owned_database_absent": True,
                        "plaintext_directory_absent": True,
                        "pg_child_absent": True,
                        "exit_code": process.returncode,
                    },
                    indent=2,
                )
            )
    finally:
        if process.poll() is None:
            process.terminate()
            process.communicate(timeout=15)
        shutil.rmtree(tools)
        ready.unlink(missing_ok=True)
