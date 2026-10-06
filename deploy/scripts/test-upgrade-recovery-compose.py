#!/usr/bin/env python3
"""仅本地空闲 Engine：权威 Compose、独立 PG16 与真实升级故障演练。"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "deploy/scripts"
PROJECT = "partsignal-staging"
NETWORKS = {PROJECT + "-" + suffix for suffix in ("internal", "egress", "edge")}


def main():
    def docker(*args, **kwargs):
        return subprocess.run(
            ["docker", *args], capture_output=True, text=True, **kwargs
        )

    endpoint = docker(
        "context",
        "inspect",
        "--format",
        '{{(index .Endpoints "docker").Host}}',
        check=True,
    ).stdout.strip()
    if os.environ.get("DOCKER_HOST", endpoint).startswith("unix://") is False:
        raise RuntimeError("演练只允许本地 Unix socket Engine")
    if docker(
        "ps",
        "-aq",
        "--filter",
        f"label=com.docker.compose.project={PROJECT}",
        check=True,
    ).stdout.strip():
        raise RuntimeError("固定 Compose project 已占用，禁止接管")
    if NETWORKS.intersection(
        docker("network", "ls", "--format", "{{.Name}}", check=True).stdout.splitlines()
    ):
        raise RuntimeError("固定 Compose network 已占用，禁止接管")
    for image in (
        "partsignal-backend:test",
        "partsignal-frontend-v2:test",
        "postgres:16-alpine",
        "redis:7.4-alpine",
    ):
        docker("image", "inspect", image, check=True)
    cache = ROOT / ".cache"
    cache.mkdir(exist_ok=True)
    temporary = tempfile.TemporaryDirectory(prefix="geo1007-compose-", dir=cache)
    root = Path(temporary.name).resolve()
    live = root / "live"
    for leaf in ("postgres", "redis"):
        (live / leaf).mkdir(parents=True)
    owner_id = "geo1007-" + uuid.uuid4().hex
    failed_release, fixed_release = owner_id + "-failed", owner_id + "-fixed"
    backend = owner_id + "-backend"
    frontend = owner_id + "-frontend-v2"
    fixed_ref, failed_ref = (
        backend + ":" + fixed_release,
        backend + ":" + failed_release,
    )
    image_refs = [
        fixed_ref,
        failed_ref,
        frontend + ":" + fixed_release,
        frontend + ":" + failed_release,
    ]
    runtime = root / "runtime.env"
    values = dict(
        line.split("=", 1)
        for line in (ROOT / ".env.production.example").read_text().splitlines()
        if line and not line.startswith("#")
    )
    for key in (
        "POSTGRES_PASSWORD",
        "SESSION_SECRET",
        "UPLOAD_SIGNING_SECRET",
        "PARTSIGNAL_SEED_ADMIN_PASSWORD",
        "PARTSIGNAL_SEED_ENGINEER_PASSWORD",
    ):
        values[key] = secrets.token_urlsafe(36)
    values.update(
        AI_CREDENTIAL_ENCRYPTION_KEY=base64.b64encode(secrets.token_bytes(32)).decode(),
        DATABASE_URL=f"postgresql+psycopg://{values['POSTGRES_USER']}:{values['POSTGRES_PASSWORD']}@postgres:5432/{values['POSTGRES_DB']}",
        OSS_ENDPOINT="https://oss-cn-hangzhou.aliyuncs.com",
        OSS_BUCKET="geo1007-fixture",
        OSS_ACCESS_KEY_ID="synthetic-not-a-credential",
        OSS_ACCESS_KEY_SECRET="synthetic-not-a-secret",
    )
    runtime.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
    runtime.chmod(0o600)
    environment = {
        **os.environ,
        "ENV_FILE": str(runtime),
        "PARTSIGNAL_RUNTIME_ENV_FILE": str(runtime),
        "PARTSIGNAL_DATA_ROOT": str(live),
        "PARTSIGNAL_QUARANTINE_ROOT": str(root / "quarantine"),
        "PARTSIGNAL_MAINTENANCE_LOCK_FILE": str(root / "maintenance.lock"),
        "PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS": "1",
        "PARTSIGNAL_BACKEND_IMAGE": backend,
        "PARTSIGNAL_FRONTEND_IMAGE": frontend,
        "PARTSIGNAL_VERSION": fixed_release,
        "PARTSIGNAL_IMAGE_DELIVERY_MODE": "local",
        "PARTSIGNAL_DEPLOY_MODE": "upgrade",
        "COMPOSE_PROJECT_NAME": PROJECT,
    }
    compose = [
        "docker",
        "compose",
        "--profile",
        "production-async",
        "--env-file",
        str(runtime),
        "-f",
        str(ROOT / "deploy/compose.prod.yaml"),
    ]

    def run(command, *, expected=0, reason=None):
        result = subprocess.run(
            command, env=environment, capture_output=True, text=True
        )
        if result.returncode != expected or (reason and reason not in result.stderr):
            # Docker 输出可能含运行配置；失败报告只给阶段/exit，不回显材料。
            safe = [
                line
                for line in result.stderr.splitlines()
                if line.startswith("Production 数据状态操作失败：")
                or line.startswith("Production 部署边界校验失败")
                or line.startswith("缺少")
                or line.startswith("Production 候选")
            ]
            raise RuntimeError(
                f"演练命令失败：{command[0:2]} expected={expected}, actual={result.returncode}; {safe}"
            )
        return result

    def state():
        return json.loads((live / ".partsignal-production-cutover.json").read_text())

    def cli(command, manifest, *, expected=0, reason=None, extra=()):
        return run(
            [
                sys.executable,
                str(SCRIPTS / "prepare-production-data.py"),
                command,
                str(manifest),
                *extra,
            ],
            expected=expected,
            reason=reason,
        )

    def sql(statement):
        return run(
            [
                *compose,
                "exec",
                "-T",
                "postgres",
                "psql",
                "-XAt",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                values["POSTGRES_USER"],
                "-d",
                values["POSTGRES_DB"],
                "-c",
                statement,
            ]
        ).stdout.strip()

    def data_hashes(tables=None):
        tables = (
            tables
            or sql(
                "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('alembic_version','geo_operation_health') ORDER BY tablename"
            ).splitlines()
        )
        return {
            table: hashlib.sha256(
                sql(
                    f"SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]') FROM \"{table}\" t"
                ).encode()
            ).hexdigest()
            for table in tables
        }

    def snapshot_archive(release):
        archive = root / f"{release}.tar.gz"
        with tarfile.open(archive, "w:gz") as output:
            for path in sorted((ROOT / "backend/alembic").rglob("*")):
                if (
                    path.is_file()
                    and "__pycache__" not in path.parts
                    and path.suffix != ".pyc"
                ):
                    output.add(
                        path, arcname=path.relative_to(ROOT).as_posix(), recursive=False
                    )
            output.add(ROOT / "backend/alembic.ini", arcname="backend/alembic.ini")
        return archive

    def manifest(release, archive):
        # 测试夹具不伪装 clean main 候选；producer 仅在明确测试边界跳过 Git source gate。
        path = root / f"{release}.json"
        command = [
            sys.executable,
            str(SCRIPTS / "create-release-manifest.py"),
            "--release-id",
            release,
            "--commit",
            "a" * 40,
            "--source-archive",
            str(archive),
            "--backend-image",
            backend + ":" + release,
            "--frontend-image",
            frontend + ":" + release,
            "--rollback-frontend-image",
            "partsignal-frontend-v2:test",
            "--schema-head",
            "0066_geo_manual_evaluation",
            "--output",
            str(path),
        ]
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "producer", SCRIPTS / "create-release-manifest.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for name in sorted(module.REQUIRED_TRACKED_FILES):
            command.extend(["--tracked-file", str(ROOT / name)])
        old = environment.get("PARTSIGNAL_ALLOW_UNVERIFIED_RELEASE_SOURCE_FOR_TESTS")
        environment["PARTSIGNAL_ALLOW_UNVERIFIED_RELEASE_SOURCE_FOR_TESTS"] = "1"
        try:
            run(command)
        finally:
            if old is None:
                environment.pop("PARTSIGNAL_ALLOW_UNVERIFIED_RELEASE_SOURCE_FOR_TESTS")
            else:
                environment["PARTSIGNAL_ALLOW_UNVERIFIED_RELEASE_SOURCE_FOR_TESTS"] = (
                    old
                )
        return path

    def interrupted(signum, _frame):
        raise KeyboardInterrupt(f"演练收到 signal {signum}")

    previous = {
        s: signal.signal(s, interrupted) for s in (signal.SIGINT, signal.SIGTERM)
    }
    started = False
    try:
        build = root / "build"
        shutil.copytree(
            ROOT / "backend",
            build,
            ignore=shutil.ignore_patterns(
                ".venv",
                "__pycache__",
                "*.pyc",
                ".pytest_cache",
                ".mypy_cache",
                ".ruff_cache",
                "*.egg-info",
            ),
        )
        (build / "Dockerfile").write_text("FROM partsignal-backend:test\nCOPY . /app\nRUN find alembic -type f \\( -name '*.pyc' -o -name '*.pyo' \\) -delete\n")
        run(["docker", "build", "--pull=false", "-t", fixed_ref, str(build)])
        (build / "Dockerfile").write_text(
            f'FROM {fixed_ref}\nCOPY failure.sh /failure.sh\nENTRYPOINT ["/bin/sh", "/failure.sh"]\n'
        )
        (build / "failure.sh").write_text("""#!/bin/sh
if test "$1" = alembic; then
  "$@" || exit "$?"
  exit 23
fi
if test "$1" = uvicorn; then exit 24; fi
exec "$@"
""")
        run(["docker", "build", "--pull=false", "-t", failed_ref, str(build)])
        for release in (failed_release, fixed_release):
            run(
                [
                    "docker",
                    "tag",
                    "partsignal-frontend-v2:test",
                    frontend + ":" + release,
                ]
            )
        failed_archive, fixed_archive = (
            snapshot_archive(failed_release),
            snapshot_archive(fixed_release),
        )
        failed_manifest, fixed_manifest = (
            manifest(failed_release, failed_archive),
            manifest(fixed_release, fixed_archive),
        )
        run([*compose, "config", "--quiet"])
        started = True
        run([*compose, "up", "--pull", "never", "-d", "--wait", "postgres", "redis"])
        run(
            [
                *compose,
                "run",
                "--rm",
                "--pull",
                "never",
                "migrate",
                "alembic",
                "upgrade",
                "0065_geo_observability",
            ]
        )
        run(
            [
                *compose,
                "run",
                "--rm",
                "--pull",
                "never",
                "api",
                "python",
                "-m",
                "app.cli",
                "initialize-accounts",
            ]
        )
        before = data_hashes()
        (live / ".partsignal-production-cutover.json").write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "data_root": str(live),
                    "phase": "PRODUCTION_INITIALIZED",
                    "candidate": {"release_id": "fixture-initialized-0065"},
                }
            )
        )
        environment.update(
            PARTSIGNAL_VERSION=failed_release,
            PARTSIGNAL_RELEASE_MANIFEST=str(failed_manifest),
        )
        run([str(SCRIPTS / "deploy.sh")], expected=23)
        assert state()["phase"] == "UPGRADE_DEPLOYING"
        assert (
            sql("SELECT version_num FROM alembic_version")
            == "0066_geo_manual_evaluation"
        )
        assert data_hashes(list(before)) == before, [table for table in before if data_hashes([table]) != {table: before[table]}]
        print(
            "真实迁移提交后 artifact exit23：UPGRADE_DEPLOYING；既有表完整行摘要不变",
            flush=True,
        )
        failed_candidate = state()["candidate"]
        if "--sigterm-after-failure" in sys.argv:
            os.kill(os.getpid(), signal.SIGTERM)
        environment["PARTSIGNAL_VERSION"] = fixed_release
        cli("begin-upgrade", fixed_manifest, expected=2, reason="候选不一致")
        environment["PARTSIGNAL_VERSION"] = failed_release
        cli(
            "verify-rollback-frontend",
            failed_manifest,
            expected=2,
            reason="要求 PRODUCTION_INITIALIZED",
        )
        run([*compose, "up", "--pull", "never", "-d", "api"])
        api_id = run([*compose, "ps", "-aq", "api"]).stdout.strip()
        assert run(["docker", "wait", api_id]).stdout.strip() == "24"
        print(
            "真实启动 artifact exit24；新候选和 frontend rollback 原路径均拒绝",
            flush=True,
        )
        extra = [
            "--failed-manifest",
            str(failed_manifest),
            "--failed-source-archive",
            str(failed_archive),
            "--source-archive",
            str(fixed_archive),
            "--failed-release-id",
            failed_release,
            "--failed-manifest-sha256",
            failed_candidate["manifest_sha256"],
            "--recovery-id",
            "upr_20261005_120000",
            "--approval-ref",
            "local-fixture/approval",
        ]
        environment.update(
            PARTSIGNAL_VERSION=fixed_release,
            PARTSIGNAL_RELEASE_MANIFEST=str(fixed_manifest),
        )
        cli(
            "recover-upgrade",
            fixed_manifest,
            expected=2,
            reason="仍有运行容器",
            extra=extra,
        )
        run(
            [
                *compose,
                "stop",
                "api",
                "worker",
                "scheduler",
                "frontend",
                "postgres",
                "redis",
            ]
        )
        cli("recover-upgrade", fixed_manifest, extra=extra)
        first_receipt = state()
        cli("recover-upgrade", fixed_manifest, extra=extra)
        assert state() == first_receipt and state()["phase"] == "UPGRADE_DEPLOYING"
        run([str(SCRIPTS / "deploy.sh")])
        assert state()["phase"] == "UPGRADE_PREPARED"
        assert data_hashes(list(before)) == before, [table for table in before if data_hashes([table]) != {table: before[table]}]
        environment["PARTSIGNAL_EXTERNAL_SERVICES_GATE"] = (
            "MET"  # 仅合成隔离夹具，不是生产批准。
        )
        run([str(SCRIPTS / "activate-production.sh")])
        assert state()["phase"] == "PRODUCTION_INITIALIZED"
        assert data_hashes(list(before)) == before, [table for table in before if data_hashes([table]) != {table: before[table]}]
        cli(
            "recover-upgrade",
            fixed_manifest,
            expected=2,
            reason="未初始化",
            extra=extra,
        )
        print(
            f"显式接管/重复回执/完整 deploy→activate 通过；{len(before)} 张既有表逐行摘要不变",
            flush=True,
        )
    finally:
        # 本次启动前证明固定 project/network 空闲，cleanup 只处理精确 project 资源。
        for signum in previous:
            signal.signal(signum, signal.SIG_IGN)
        if started:
            run([*compose, "down", "--volumes"])
            assert not docker(
                "ps",
                "-aq",
                "--filter",
                f"label=com.docker.compose.project={PROJECT}",
                check=True,
            ).stdout.strip()
            assert not NETWORKS.intersection(
                docker(
                    "network", "ls", "--format", "{{.Name}}", check=True
                ).stdout.splitlines()
            )
        for reference in image_refs:
            result = docker("image", "rm", reference)
            if (
                result.returncode
                and docker("image", "inspect", reference).returncode == 0
            ):
                raise RuntimeError("本次演练镜像未清理")
        temporary.cleanup()
        assert not root.exists()
        print(
            "清理确认：本次 container/network/image/temp=0；共享开发 PG 未访问",
            flush=True,
        )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit(143) from None
