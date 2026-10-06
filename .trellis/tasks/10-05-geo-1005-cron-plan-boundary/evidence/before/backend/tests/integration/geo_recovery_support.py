"""GEO-903：真实PG dump/restore、本地HTTP对象字节、凭据及恢复后调度去重。"""

import argparse
import base64
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import time
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine, text

from app.config import settings
from app.models.ai_generation import AIChannel, AIChannelHeader
from app.models.geo_files import FileRecord
from app.models.geo_runs import GeoObservationRun
from app.services import geo_analysis_runs, geo_batches
from app.services.credentials import CredentialCipher
from app.services.storage import DevelopmentEvidenceStorage
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_questions_support import questions_api as questions_api
from tests.integration.test_geo_manual_collection import batch_run, payload, submit
from tests.integration.test_migrations import run_alembic, temporary_database
from tests.unit.test_geo_recovery_boundaries import load_recovery


@pytest.fixture
def questions_engine():
    # 每个场景有独立来源库，避免不可变历史和缺失对象场景相互污染。
    with temporary_database("partsignal_geo903_source") as (url, env, backend):
        run_alembic(env, backend, "head")
        engine = create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1))
        try:
            yield engine
        finally:
            engine.dispose()


@pytest.fixture
def recovery_pg_tools(tmp_path, monkeypatch):
    container = os.environ.get("GEO_RECOVERY_PG_CONTAINER")
    if container:
        # 显式选择同一隔离 PG 容器的工具，不给生产连接提供自动回退。
        from sqlalchemy.engine import make_url

        admin = make_url(os.environ["PARTSIGNAL_TEST_DATABASE_URL"])
        mapped = subprocess.check_output(["docker", "port", container, "5432/tcp"], text=True)
        assert admin.host == "127.0.0.1" and f":{admin.port}" in mapped.splitlines()[0]
        tools = tmp_path / "pg-tools"
        tools.mkdir(mode=0o700)
        wrapper = """#!/usr/bin/env python3
import os, subprocess, sys
from pathlib import Path
container = CONTAINER
name = Path(sys.argv[0]).name
args = sys.argv[1:]
database = os.environ['PGDATABASE']
if not database.startswith(('partsignal_geo903_source_', 'partsignal_e2e_')):
    raise SystemExit('隔离演练工具拒绝非测试库')
command = ['docker', 'exec', '-i', '-e', 'PGUSER', '-e', 'PGDATABASE', container, name]
if name in ('pg_dump', 'pg_restore'):
    index = args.index('--file')
    path = args[index+1]
    del args[index:index+2]
    if name == 'pg_dump':
        with open(path, 'xb') as output:
            raise SystemExit(subprocess.run(command+args, stdout=output).returncode)
    with open(args.pop(), 'rb') as incoming, open(path, 'xb') as output:
        result = subprocess.run(command+['--file=-']+args, stdin=incoming, stdout=output)
        raise SystemExit(result.returncode)
index = args.index('--file')
path = args[index+1]
del args[index:index+2]
with open(path, 'rb') as incoming:
    raise SystemExit(subprocess.run(command+args, stdin=incoming).returncode)
""".replace("CONTAINER", repr(container))
        for tool in ("pg_dump", "pg_restore", "psql"):
            (tools / tool).write_text(wrapper)
            (tools / tool).chmod(0o700)
        monkeypatch.setenv("RECOVERY_PG_BIN", str(tools))
    if "RECOVERY_PG_BIN" not in os.environ:
        pytest.fail("真实恢复需显式 RECOVERY_PG_BIN 或 GEO_RECOVERY_PG_CONTAINER，不能 skip")


@pytest.fixture
def recovery_case(plans_api, tmp_path, monkeypatch, recovery_pg_tools):
    api = plans_api
    recovery = load_recovery()
    monkeypatch.delenv("VERIFY_DATABASE_URL", raising=False)
    monkeypatch.setenv("RECOVERY_ADMIN_DATABASE_URL", os.environ["PARTSIGNAL_TEST_DATABASE_URL"])
    url = api.api.engine.url.render_as_string(hide_password=False)
    monkeypatch.setattr(settings, "database_url", url)
    for field in (
        "geo_browser_session_root",
        "geo_browser_session_public_key_file",
        "geo_browser_session_service_key_file",
    ):
        monkeypatch.setattr(settings, field, "")
    monkeypatch.setattr(settings, "geo_browser_collection_enabled", False)
    monkeypatch.setattr(settings, "geo_browser_session_service_user_id", None)
    monkeypatch.setattr(settings, "object_storage_backend", "development")
    source_objects = tmp_path / "source-objects"
    source_objects.mkdir(mode=0o700)
    browser_root = tmp_path / "browser-material-check"
    browser_root.mkdir(mode=0o700)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen()
    port = sock.getsockname()[1]
    endpoint = f"http://127.0.0.1:{port}"
    for field in ("development_storage_internal_url", "development_storage_public_url"):
        monkeypatch.setattr(settings, field, endpoint)
    env = {
        **os.environ,
        "APP_ENV": "test",
        "DATABASE_URL": url,
        "OBJECT_STORAGE_PATH": str(source_objects),
        "UPLOAD_SIGNING_SECRET": settings.development_storage_signing_key,
    }
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.dev_storage:app",
            "--fd",
            str(sock.fileno()),
            "--no-access-log",
            "--log-level",
            "error",
        ],
        env=env,
        pass_fds=(sock.fileno(),),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        import httpx

        deadline = time.monotonic() + 10
        while True:
            try:
                if httpx.get(endpoint + "/openapi.json", timeout=0.2).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            if process.poll() is not None or time.monotonic() >= deadline:
                pytest.fail("隔离对象服务未启动")
            time.sleep(0.05)
        master = base64.b64encode(os.urandom(32)).decode()
        monkeypatch.setattr(settings, "ai_credential_encryption_key", master)
        cipher = CredentialCipher(master)
        with api.api.factory.begin() as db:
            now = db.scalar(text("SELECT clock_timestamp()"))
            identity, header = uuid4(), uuid4()
            db.add(
                AIChannel(
                    id=identity,
                    name="恢复虚构渠道",
                    description="仅隔离演练",
                    protocol_type="openai-compatible-chat-completions",
                    provider_brand="CUSTOM",
                    base_url="https://example.invalid/v1",
                    timeout_seconds=60,
                    api_key_ciphertext=cipher.encrypt(
                        "geo903-api-secret-canary", associated_data=f"ai_channel:{identity}:api_key"
                    ),
                    api_key_updated_at=now,
                    created_by=api.api.admin_id,
                )
            )
            db.flush()
            db.add(
                AIChannelHeader(
                    id=header,
                    channel_id=identity,
                    name="X-Synthetic-Secret",
                    normalized_name="x-synthetic-secret",
                    is_sensitive=True,
                    encrypted_value=cipher.encrypt(
                        "geo903-header-secret-canary",
                        associated_data=f"ai_channel_header:{header}:value",
                    ),
                )
            )
        run = batch_run(api, screenshot=True)[0]
        rows = []
        data_by_id = {}
        for kind, data, content_type in (
            ("OPERATION_SCREENSHOT", b"geo903-redacted-screenshot", "image/png"),
            ("EVIDENCE", b"geo903-redacted-raw", "text/plain"),
        ):
            key = f"geo903/{uuid4()}"
            digest = hashlib.sha256(data).hexdigest()
            DevelopmentEvidenceStorage().put(key, data, content_type=content_type, sha256=digest)
            with api.api.factory.begin() as db:
                now = db.scalar(text("SELECT clock_timestamp()"))
                row = FileRecord(
                    id=uuid4(),
                    category=kind,
                    original_filename="虚构材料",
                    object_key=key,
                    content_type=content_type,
                    size=len(data),
                    sha256=digest,
                    access_level="INTERNAL",
                    status="VERIFIED",
                    uploader_id=api.api.engineer_id,
                    upload_expires_at=now + timedelta(hours=1),
                    verified_at=now,
                )
                db.add(row)
                rows.append((row.id, key))
                data_by_id[str(row.id)] = data
        with api.api.factory() as db:
            clock = db.scalar(text("SELECT clock_timestamp()"))
        response = submit(
            api,
            run,
            payload(
                run,
                collected_at=clock.isoformat(),
                screenshot_file_id=str(rows[0][0]),
                raw_payload_file_id=str(rows[1][0]),
                source_product="虚构恢复平台",
                source_model="fake-v1",
                source_version="v1",
                answer_text="虚构Plan品牌被提及。",
            ),
        )
        assert response.status_code == 201, response.text
        monkeypatch.setattr(geo_analysis_runs, "SessionLocal", api.api.factory)
        geo_analysis_runs.process_analysis_run(run.id)
        with api.api.factory() as db:
            analyzed = db.get(GeoObservationRun, run.id)
            review_payload = {
                "analysis_revision_id": str(analyzed.current_analysis_revision_id),
                "expected_run_revision": analyzed.revision,
                "decision": "CONFIRMED",
                "correction_payload": None,
                "comment": "虚构恢复演练确认",
            }
        review = api.api.engineer.post(
            f"/api/v1/geo/observation-runs/{run.id}/review", json=review_payload
        )
        assert review.status_code == 201, review.text
        with api.api.factory() as db:
            assert db.get(GeoObservationRun, run.id).status == "COMPLETED"
        plan = api.create(schedule_kind="CRON", cron_expression="0 * * * *")
        assert api.action(plan, "activate").status_code == 200
        window = datetime(2026, 10, 5, tzinfo=UTC)
        with api.api.factory() as db:
            scheduled = geo_batches.create_scheduled_batch(
                db=db, plan_id=UUID(plan["id"]), scheduled_for=window
            )
        for name, value in (
            ("backup-key", base64.b64encode(os.urandom(32))),
            (
                "secrets",
                json.dumps(
                    {
                        "AI_CREDENTIAL_ENCRYPTION_KEY": master,
                        "SESSION_SECRET": settings.session_secret,
                        "UPLOAD_SIGNING_SECRET": settings.development_storage_signing_key,
                    }
                ).encode(),
            ),
            ("release", b'{"environment":"isolated-test","release":"GEO-903-source"}'),
            (
                "deployment",
                json.dumps(
                    {
                        "environment": "GEO-903-owned-test-source",
                        "checked_at": datetime.now(UTC).isoformat(),
                        "r7_deployed": False,
                        "browser_service_running": False,
                        "session_mounts_present": False,
                        "material_roots": [str(browser_root)],
                        "quiesced": True,
                    }
                ).encode(),
            ),
        ):
            recovery.write_private(tmp_path / name, value)
        args = argparse.Namespace(
            bundle=str(tmp_path / "bundle"),
            backup_key_file=str(tmp_path / "backup-key"),
            secrets_file=str(tmp_path / "secrets"),
            deployment_evidence=str(tmp_path / "deployment"),
            release_manifest=str(tmp_path / "release"),
            runtime_env=None,
            nginx_config=None,
        )
        yield recovery, args, api, rows, data_by_id, scheduled, plan, window, master
    finally:
        process.terminate()
        process.wait(timeout=10)
        sock.close()
        for owned in (source_objects, browser_root, tmp_path / "bundle", tmp_path / "pg-tools"):
            shutil.rmtree(owned, ignore_errors=False) if owned.exists() else None
        for name in ("backup-key", "secrets", "release", "deployment"):
            (tmp_path / name).unlink(missing_ok=True)
