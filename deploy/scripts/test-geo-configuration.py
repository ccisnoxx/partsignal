#!/usr/bin/env python3
"""无需 Docker Engine，以真实 Compose 和启动入口校验 GEO 配置。"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
GEO_FLAGS = (
    "GEO_MONITORING_ENABLED",
    "GEO_API_COLLECTION_ENABLED",
    "GEO_BROWSER_COLLECTION_ENABLED",
    "GEO_OPPORTUNITY_EVALUATION_ENABLED",
)
STARTUP_PROBE = """
import json, sys
attempts = []
def reject_network(event, args):
    if event in {'socket.connect', 'socket.getaddrinfo'}:
        attempts.append(event)
        raise AssertionError('GEO 配置启动不得访问网络')
sys.addaudithook(reject_network)
from app import config, main, worker
from starlette.testclient import TestClient
assert main.settings is worker.settings is config.settings
assert config.settings is config.get_settings()
with TestClient(main.app) as client:
    assert client.get('/api/health/live').json() == {'status': 'ok', 'checks': None}
# GEO-901 已批准限批清理；注册与声明调度不等于启动时执行任务。
# 精确集合仍拒绝新增未知入口，网络审计继续证明启动零外部调用。
assert {name for name in worker.celery_app.tasks if name.startswith('partsignal.geo_')} == {
    'partsignal.geo_cleanup_artifacts'
}
assert {item['task'] for item in worker.celery_app.conf.beat_schedule.values()
        if item['task'].startswith('partsignal.geo_')} == {'partsignal.geo_cleanup_artifacts'}
assert not attempts
print(json.dumps([config.settings.geo_monitoring_enabled,
                 config.settings.geo_api_collection_enabled,
                 config.settings.geo_browser_collection_enabled,
                 config.settings.geo_opportunity_evaluation_enabled]))
"""


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="partsignal-geo-config-") as temporary:
        owner = Path(temporary)
        project = owner / "deploy"
        project.mkdir()
        # --project-directory 决定 include 的相对路径；保留真实共享 profile 来源。
        (project / "compose.geo-browser.yaml").write_text(
            (ROOT / "deploy/compose.geo-browser.yaml").read_text()
        )
        probe = owner / "probe"
        probe.mkdir()  # 启动检查不能额外读取 .env，配置只能来自 Compose 解析结果。
        base = dict(
            line.split("=", 1)
            for line in (ROOT / ".env.example").read_text().splitlines()
            if line and not line.startswith("#")
        )
        scenarios = [
            ("omitted", {}),
            ("disabled", dict.fromkeys(GEO_FLAGS, "false")),
            ("monitoring", {GEO_FLAGS[0]: "true"}),
            ("api", {GEO_FLAGS[0]: "true", GEO_FLAGS[1]: "true"}),
            ("browser", {GEO_FLAGS[0]: "true", GEO_FLAGS[2]: "true"}),
            ("opportunity", {GEO_FLAGS[0]: "true", GEO_FLAGS[3]: "true"}),
        ]
        for environment in ("dev", "staging", "prod"):
            for scenario, flags in scenarios:
                values = {key: value for key, value in base.items() if key not in GEO_FLAGS}
                if environment == "prod":
                    values.update(
                        APP_ENV="production",
                        CONTENT_GENERATOR="openai-compatible",
                        SESSION_SECRET="synthetic-production-session-secret-32-bytes",
                        AI_CREDENTIAL_ENCRYPTION_KEY=base64.b64encode(bytes(range(32))).decode(),
                        AI_ALLOW_LOCAL_HTTP="false",
                        SESSION_COOKIE_SECURE="true",
                        OBJECT_STORAGE_BACKEND="aliyun_oss",
                        OSS_ENDPOINT="https://oss-cn-hangzhou.aliyuncs.com",
                        OSS_BUCKET="synthetic-geo-config",
                        OSS_ACCESS_KEY_ID="synthetic-id",
                        OSS_ACCESS_KEY_SECRET="synthetic-secret",
                    )
                elif environment == "staging":
                    values.update(APP_ENV="staging", AI_ALLOW_LOCAL_HTTP="false")
                values.update(flags)
                runtime = owner / (".env.staging" if environment == "staging" else ".env")
                runtime.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
                runtime.chmod(0o600)
                command = ["docker", "compose"]
                if environment == "prod":
                    command += ["--profile", "production-async"]
                command += [
                    "--env-file", str(runtime), "--project-directory", str(project),
                    "-f", str(ROOT / f"deploy/compose.{environment}.yaml"),
                    "config", "--format", "json",
                ]
                parsed = subprocess.run(
                    command, capture_output=True, text=True, check=False,
                    env={
                        "PATH": os.environ["PATH"],
                        "PARTSIGNAL_BACKEND_IMAGE": "partsignal-backend",
                        "PARTSIGNAL_FRONTEND_IMAGE": "partsignal-frontend-v2",
                        "PARTSIGNAL_VERSION": "geo-config-test",
                        "PARTSIGNAL_RUNTIME_ENV_FILE": str(runtime),
                        "PARTSIGNAL_DATA_ROOT": str(owner / "data"),
                    },
                )
                if parsed.returncode:
                    raise AssertionError(f"Compose config 失败：{environment}/{scenario}")
                services = json.loads(parsed.stdout)["services"]
                expected = [flags.get(name, "false") == "true" for name in GEO_FLAGS]
                selected = [
                    {key: services[role]["environment"].get(key) for key in GEO_FLAGS}
                    for role in ("api", "worker", "scheduler")
                ]
                assert selected[0] == selected[1] == selected[2], "三个进程的 GEO 配置不一致"
                assert selected[0] == {key: flags.get(key) for key in GEO_FLAGS}
                started = subprocess.run(
                    [sys.executable, "-B", "-c", STARTUP_PROBE],
                    cwd=probe,
                    env={**services["api"]["environment"], "PYTHONPATH": str(ROOT / "backend")},
                    capture_output=True, text=True, check=False,
                )
                if environment == "prod" and scenario == "browser":
                    assert started.returncode != 0
                    assert "生产环境禁止 GEO_BROWSER_COLLECTION_ENABLED=true" in started.stderr
                    continue
                if started.returncode:
                    raise AssertionError(f"入口启动或 no-egress 检查失败：{environment}/{scenario}")
                assert json.loads(started.stdout) == expected
                if environment == "prod":
                    # shell 环境不能改变生产身份，任何 profile 也不能添加 Browser/会话服务。
                    for profiles in ([], ["--profile", "geo-browser"], ["--profile", "*"]):
                        expanded = subprocess.run(
                            [*command[:2], *profiles, *command[4:]],
                            env={
                                "PATH": os.environ["PATH"], "APP_ENV": "test",
                                "GEO_MONITORING_ENABLED": "true",
                                "GEO_BROWSER_COLLECTION_ENABLED": "true",
                                "COMPOSE_PROFILES": "geo-browser",
                                "PARTSIGNAL_BACKEND_IMAGE": "partsignal-backend",
                                "PARTSIGNAL_FRONTEND_IMAGE": "partsignal-frontend-v2",
                                "PARTSIGNAL_VERSION": "geo-config-test",
                                "PARTSIGNAL_RUNTIME_ENV_FILE": str(runtime),
                                "PARTSIGNAL_DATA_ROOT": str(owner / "data"),
                            }, capture_output=True, text=True, check=True,
                        )
                        production = json.loads(expanded.stdout)
                        assert "browser-collector" not in production["services"]
                        for service in production["services"].values():
                            assert "geo-browser" not in service.get("profiles", [])
                            assert not any("geo-browser" in mount["target"]
                                           for mount in service.get("volumes", []))
                            assert not any(name.startswith("GEO_BROWSER_SESSION_")
                                           for name in service.get("environment", {}))
                        assert production["services"]["api"]["environment"]["APP_ENV"] == (
                            "production"
                        )
        print("GEO Compose/Settings/API/Worker/Beat：17 组启动一致、production Browser 负例拒绝；"
              "生产全部 profile/环境覆盖均为零 Browser 服务/会话，启动外部调用为 0")


if __name__ == "__main__":
    main()
