"""GEO 渐进启用的启动配置与生产输入边界。"""

from __future__ import annotations

import base64
import itertools
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings

ROOT = Path(__file__).resolve().parents[3]
GEO_FLAGS = (
    "GEO_MONITORING_ENABLED",
    "GEO_API_COLLECTION_ENABLED",
    "GEO_BROWSER_COLLECTION_ENABLED",
    "GEO_OPPORTUNITY_EVALUATION_ENABLED",
)


@pytest.fixture(autouse=True)
def isolate_geo_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in GEO_FLAGS:
        monkeypatch.delenv(name, raising=False)


def production_configuration() -> dict[str, str]:
    """虚构且完整的生产输入；不读取工作区的真实 env 文件。"""
    values = dict(
        line.split("=", 1)
        for line in (ROOT / ".env.production.example").read_text().splitlines()
        if line and not line.startswith("#")
    )
    values.update(
        POSTGRES_PASSWORD="p" * 48,
        SESSION_SECRET="s" * 48,
        UPLOAD_SIGNING_SECRET="u" * 48,
        PARTSIGNAL_SEED_ADMIN_PASSWORD="a" * 48,
        PARTSIGNAL_SEED_ENGINEER_PASSWORD="e" * 48,
        AI_CREDENTIAL_ENCRYPTION_KEY=base64.b64encode(bytes(range(32))).decode(),
        DATABASE_URL="postgresql+psycopg://partsignal:" + "p" * 48 + "@postgres:5432/partsignal",
        OSS_ENDPOINT="https://oss-cn-hangzhou.aliyuncs.com",
        OSS_BUCKET="synthetic-geo-configuration",
        OSS_ACCESS_KEY_ID="synthetic-access-id",
        OSS_ACCESS_KEY_SECRET="synthetic-access-secret",
    )
    return values


@pytest.mark.parametrize("environment", ["development", "test", "staging", "production"])
def test_geo_flags_default_off_in_every_environment(environment: str) -> None:
    configuration = production_configuration()
    for name in GEO_FLAGS:
        configuration.pop(name)
    configured = Settings(_env_file=None, **{**configuration, "APP_ENV": environment})
    assert all(getattr(configured, name.lower()) is False for name in GEO_FLAGS)


@pytest.mark.parametrize("flags", list(itertools.product([False, True], repeat=4)))
def test_geo_flags_require_monitoring_but_children_are_independent(
    flags: tuple[bool, bool, bool, bool],
) -> None:
    configuration = dict(zip(GEO_FLAGS, flags, strict=True))
    if not flags[0] and any(flags[1:]):
        with pytest.raises(ValidationError, match="必须同时启用 GEO_MONITORING_ENABLED"):
            Settings(_env_file=None, APP_ENV="test", **configuration)
    else:
        configured = Settings(_env_file=None, APP_ENV="test", **configuration)
        assert tuple(getattr(configured, name.lower()) for name in GEO_FLAGS) == flags


@pytest.mark.parametrize("name", GEO_FLAGS)
@pytest.mark.parametrize("value", ["", "automatic", None])
def test_geo_flags_reject_invalid_values_without_echoing_input(name: str, value: object) -> None:
    with pytest.raises(ValidationError) as captured:
        Settings(_env_file=None, APP_ENV="test", **{name: value})
    assert captured.value.errors()[0]["loc"] == (name,)
    assert "input_value=" not in str(captured.value)


def test_geo_env_file_is_a_startup_snapshot(tmp_path: Path) -> None:
    env_file = tmp_path / "runtime.env"
    env_file.write_text("GEO_MONITORING_ENABLED=true\nGEO_API_COLLECTION_ENABLED=true\n")
    original = Settings(_env_file=env_file, APP_ENV="test")
    env_file.write_text("GEO_MONITORING_ENABLED=false\nGEO_API_COLLECTION_ENABLED=false\n")
    assert original.geo_monitoring_enabled and original.geo_api_collection_enabled
    reloaded = Settings(_env_file=env_file, APP_ENV="test")
    assert not reloaded.geo_monitoring_enabled and not reloaded.geo_api_collection_enabled


@pytest.mark.parametrize(
    ("change", "expected_status", "expected_code"),
    [
        ({}, "PASSED", None),
        ({name: None for name in GEO_FLAGS}, "PASSED", None),
        ({"GEO_MONITORING_ENABLED": "true"}, "PASSED", None),
        ({name: "true" for name in GEO_FLAGS}, "PASSED", None),
        ({"GEO_API_COLLECTION_ENABLED": "true"}, "FAILED", "BACKEND_CONFIG_OR_AI_SCHEMA_INVALID"),
        ({"GEO_BROWSER_COLLECTION_ENABLED": "true"}, "FAILED",
         "BACKEND_CONFIG_OR_AI_SCHEMA_INVALID"),
        ({"GEO_OPPORTUNITY_EVALUATION_ENABLED": "true"}, "FAILED",
         "BACKEND_CONFIG_OR_AI_SCHEMA_INVALID"),
        ({"GEO_MONITORING_ENABLED": "invalid"}, "FAILED", "BACKEND_CONFIG_OR_AI_SCHEMA_INVALID"),
        ({"GEO_MONITORING_ENABLED": ""}, "NOT_READY", None),
        ({"UNKNOWN_GEO_FLAG": "false"}, "FAILED", "ENV_KEY_SET_MISMATCH"),
        ({"SESSION_SECRET": None}, "FAILED", "ENV_KEY_SET_MISMATCH"),
        ({"AI_ALLOW_LOCAL_HTTP": "true"}, "FAILED",
         "PRODUCTION_FIXED_VALUE_REQUIRED:AI_ALLOW_LOCAL_HTTP"),
    ],
)
def test_production_input_checker_preserves_safe_defaults_and_strict_boundaries(
    tmp_path: Path,
    change: dict[str, str | None],
    expected_status: str,
    expected_code: str | None,
) -> None:
    values = production_configuration()
    for key, value in change.items():
        if value is None:
            values.pop(key, None)
        else:
            values[key] = value
    runtime = tmp_path / "runtime.env"
    runtime.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
    runtime.chmod(0o600)
    result = subprocess.run(
        [sys.executable, str(ROOT / "deploy/scripts/check-production-inputs.py"), str(runtime)],
        cwd=tmp_path,
        env={**os.environ, **{name: "true" for name in GEO_FLAGS}},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == (0 if expected_status == "PASSED" else 2)
    assert result.stderr == ""
    summary = json.loads(result.stdout)
    assert summary["status"] == expected_status
    if expected_code:
        assert summary["code"] == expected_code
    if expected_status == "NOT_READY":
        assert summary["missing_runtime"] == ["GEO_MONITORING_ENABLED"]
    assert "synthetic-access-secret" not in result.stdout
    assert "s" * 48 not in result.stdout
