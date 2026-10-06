"""GEO-1003：真实启动与部署入口必须先拒绝生产 Browser，不能出现服务副作用。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings
from tests.unit.test_geo_configuration import ROOT, production_configuration


@pytest.mark.parametrize("browser", [True, "true", "TRUE", "1", "on", "yes"])
def test_production_monitoring_cannot_enable_browser(browser: object) -> None:
    with pytest.raises(ValidationError, match="生产环境禁止 GEO_BROWSER_COLLECTION_ENABLED=true"):
        Settings(_env_file=None, **{
            **production_configuration(),
            "GEO_MONITORING_ENABLED": True, "GEO_BROWSER_COLLECTION_ENABLED": browser,
        })


@pytest.mark.parametrize("name", [
    "GEO_BROWSER_SESSION_ROOT", "GEO_BROWSER_SESSION_PUBLIC_KEY_FILE",
    "GEO_BROWSER_SESSION_SERVICE_KEY_FILE", "GEO_BROWSER_SESSION_SERVICE_USER_ID",
])
def test_production_rejects_session_material_even_with_browser_off(name: str) -> None:
    value = "123e4567-e89b-42d3-a456-426614174000" if name.endswith("USER_ID") else "/synthetic"
    with pytest.raises(ValidationError, match="生产环境禁止配置 GEO_BROWSER_SESSION"):
        Settings(_env_file=None, **{**production_configuration(), name: value})


def test_production_browser_off_preserves_other_explicit_capabilities() -> None:
    configured = Settings(_env_file=None, **{
        **production_configuration(), "GEO_MONITORING_ENABLED": True,
        "GEO_API_COLLECTION_ENABLED": True, "GEO_OPPORTUNITY_EVALUATION_ENABLED": True,
    })
    assert configured.geo_monitoring_enabled and configured.geo_api_collection_enabled
    assert configured.geo_opportunity_evaluation_enabled
    assert not configured.geo_browser_collection_enabled


@pytest.mark.parametrize("command", [
    ["-c", "from app.main import app"],
    ["-m", "celery", "-A", "app.worker:celery_app", "worker", "--help"],
    ["-m", "celery", "-A", "app.worker:celery_app", "beat", "--help"],
    ["-m", "app.cli", "preflight-production-config"],
])
def test_production_entrypoints_fail_before_network_or_session_access(
    tmp_path: Path, command: list[str],
) -> None:
    configuration = {
        **production_configuration(), "GEO_MONITORING_ENABLED": "true",
        "GEO_BROWSER_COLLECTION_ENABLED": "true", "PYTHONPATH": str(ROOT / "backend"),
    }
    # sitecustomize 的审计钩子先于 app/CLI 加载；禁止连接、解析及会话文件读取。
    (tmp_path / "sitecustomize.py").write_text('''import sys
def reject(event, args):
    if event in {'socket.connect', 'socket.getaddrinfo'}:
        raise AssertionError('NETWORK_SIDE_EFFECT_FORBIDDEN')
    if event == 'open' and isinstance(args[0], str) and '/run/geo-browser' in args[0]:
        raise AssertionError('SESSION_SIDE_EFFECT_FORBIDDEN')
sys.addaudithook(reject)
''')
    configuration["PYTHONPATH"] = str(tmp_path) + os.pathsep + configuration["PYTHONPATH"]
    result = subprocess.run(
        [sys.executable, "-B", *command], cwd=tmp_path, env=configuration,
        capture_output=True, text=True, timeout=30, check=False,
    )
    output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "生产环境禁止 GEO_BROWSER_COLLECTION_ENABLED=true" in output
    assert "SIDE_EFFECT_FORBIDDEN" not in output
    assert "synthetic-access-secret" not in output
    assert "input_value=" not in output


@pytest.mark.parametrize("browser", [None, "false"])
def test_production_preflight_reports_browser_false(tmp_path: Path, browser: str | None) -> None:
    configuration = production_configuration()
    if browser is None:
        configuration.pop("GEO_BROWSER_COLLECTION_ENABLED")
    result = subprocess.run(
        [sys.executable, "-B", "-m", "app.cli", "preflight-production-config"],
        cwd=tmp_path, env={**configuration, "PYTHONPATH": str(ROOT / "backend")},
        capture_output=True, text=True, timeout=30, check=True,
    )
    assert json.loads(result.stdout)["geo_browser_collection_enabled"] is False


@pytest.mark.parametrize("script", [
    "deploy.sh", "activate-production.sh", "rollback-production-frontend.sh",
])
@pytest.mark.parametrize(("runtime_change", "shell_change", "code"), [
    ({"GEO_MONITORING_ENABLED": "true", "GEO_BROWSER_COLLECTION_ENABLED": "true"}, {},
     "PRODUCTION_FIXED_VALUE_REQUIRED:GEO_BROWSER_COLLECTION_ENABLED"),
    ({}, {"GEO_BROWSER_COLLECTION_ENABLED": "true"},
     "PRODUCTION_FIXED_VALUE_REQUIRED:GEO_BROWSER_COLLECTION_ENABLED"),
    ({}, {"COMPOSE_PROFILES": "production-async,geo-browser"},
     "PRODUCTION_COMPOSE_PROFILE_FORBIDDEN"),
    ({}, {"COMPOSE_PROFILES": "*"}, "PRODUCTION_COMPOSE_PROFILE_FORBIDDEN"),
    ({}, {"COMPOSE_FILE": str(ROOT / "deploy/compose.prod.yaml") + ":" +
      str(ROOT / "deploy/compose.geo-browser.yaml")}, "PRODUCTION_COMPOSE_OVERLAY_FORBIDDEN"),
    ({}, {"COMPOSE_FILE": str(ROOT / "deploy/compose.geo-browser-sessions.yaml")},
     "PRODUCTION_COMPOSE_OVERLAY_FORBIDDEN"),
    ({"GEO_BROWSER_SESSION_ROOT": "/synthetic"}, {}, "PRODUCTION_BROWSER_SESSION_FORBIDDEN"),
    ({}, {"PARTSIGNAL_GEO_BROWSER_SESSION_PRIVATE_KEY_FILE": "/synthetic"},
     "PRODUCTION_BROWSER_SESSION_FORBIDDEN"),
    ({"APP_ENV": "development"}, {}, "PRODUCTION_FIXED_VALUE_REQUIRED:APP_ENV"),
])
def test_deployment_entrypoints_reject_before_lock_or_compose(
    tmp_path: Path, script: str, runtime_change: dict[str, str],
    shell_change: dict[str, str], code: str,
) -> None:
    runtime = tmp_path / "runtime.env"
    runtime.write_text("".join(
        f"{key}={value}\n" for key, value in {
            **production_configuration(), **runtime_change,
        }.items()
    ))
    runtime.chmod(0o600)
    result = subprocess.run(
        ["/bin/sh", str(ROOT / "deploy/scripts" / script)], cwd=tmp_path,
        env={"PATH": os.environ["PATH"], "ENV_FILE": str(runtime), **shell_change},
        capture_output=True, text=True, timeout=30, check=False,
    )
    assert result.returncode == 2 and result.stderr == ""
    assert json.loads(result.stdout) == {"status": "FAILED", "code": code}
    # 未提供后续维护锁/manifest/data-root 输入；进入它们即无法产生上述明确拒绝。
    assert not list(tmp_path.glob("**/*lock*"))


def test_deployment_boundary_accepts_production_async_without_browser(tmp_path: Path) -> None:
    runtime = tmp_path / "runtime.env"
    runtime.write_text("APP_ENV=production\n")
    runtime.chmod(0o600)
    result = subprocess.run(
        [sys.executable, str(ROOT / "deploy/scripts/check-production-inputs.py"),
         "--deployment-boundary", str(runtime)], cwd=tmp_path,
        env={"COMPOSE_PROFILES": "production-async"}, capture_output=True, text=True,
        timeout=30, check=True,
    )
    assert json.loads(result.stdout)["production_browser_boundary"] == "PASSED"
