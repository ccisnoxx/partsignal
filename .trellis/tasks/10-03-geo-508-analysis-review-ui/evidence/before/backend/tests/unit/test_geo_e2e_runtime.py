"""GEO-408 测试装配的隔离拒绝、真实默认边界与闭合场景合同。"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from tests import geo_e2e_environment as boundary
from tests.geo_e2e_runtime import (
    _loopback_transport,
    fictional_input,
    require_provider_url,
    scenario_name,
    scenario_payload,
)


def values() -> dict[str, str]:
    return {
        "APP_ENV": "test",
        "AI_ALLOW_LOCAL_HTTP": "true",
        "DATABASE_URL": (
            f"postgresql+psycopg://test:test@127.0.0.1/partsignal_e2e_20261003_{'a' * 32}"
        ),
        "REDIS_URL": "redis://127.0.0.1/14",
        "PARTSIGNAL_E2E_DATABASE_OWNER_TOKEN": "b" * 32,
        "PARTSIGNAL_E2E_GEO_MODE": "enabled",
        "PARTSIGNAL_E2E_GEO_PROVIDER_URL": boundary.PROVIDER_URL,
        "GEO_MONITORING_ENABLED": "true",
        "GEO_API_COLLECTION_ENABLED": "true",
    }


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("APP_ENV", "production"),
        ("AI_ALLOW_LOCAL_HTTP", "false"),
        ("PARTSIGNAL_E2E_GEO_PROVIDER_URL", "http://localhost:19012"),
        ("PARTSIGNAL_E2E_GEO_PROVIDER_URL", "https://example.com"),
        ("PARTSIGNAL_E2E_GEO_PROVIDER_URL", "http://127.0.0.1:19012/v1"),
        ("PARTSIGNAL_E2E_GEO_MODE", "other"),
        ("GEO_API_COLLECTION_ENABLED", "false"),
        ("DATABASE_URL", "postgresql://127.0.0.1/partsignal"),
        ("DATABASE_URL", f"postgresql://127.0.0.1/partsignal_e2e_２０２６１００３_{'a' * 32}"),
        ("PARTSIGNAL_E2E_DATABASE_OWNER_TOKEN", "invalid"),
        ("REDIS_URL", "redis://127.0.0.1/0"),
    ],
)
def test_unsafe_environment_refused_before_database_access(key: str, value: str) -> None:
    with pytest.raises(ValueError):
        boundary.environment_values({**values(), key: value})


@pytest.mark.parametrize("marker", [None, "partsignal-e2e-owner:other", ""])
def test_database_actual_owner_marker_is_required(
    monkeypatch: pytest.MonkeyPatch, marker: str | None
) -> None:
    for key, value in values().items():
        monkeypatch.setenv(key, value)
    environment = boundary.environment_values(values())
    connection = MagicMock()
    connection.__enter__.return_value.execute.return_value.fetchone.return_value = (
        environment.database_name,
        marker,
    )
    monkeypatch.setattr(boundary.psycopg, "connect", lambda *args, **kwargs: connection)
    with pytest.raises(ValueError, match="实际归属"):
        boundary.validate_owned_environment()


def test_correct_database_owner_is_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in values().items():
        monkeypatch.setenv(key, value)
    environment = boundary.environment_values(values())
    connection = MagicMock()
    connection.__enter__.return_value.execute.return_value.fetchone.return_value = (
        environment.database_name,
        f"partsignal-e2e-owner:{environment.owner_token}",
    )
    monkeypatch.setattr(boundary.psycopg, "connect", lambda *args, **kwargs: connection)
    assert boundary.validate_owned_environment() == environment


def test_only_closed_fictional_prompt_and_subject_can_be_public() -> None:
    snapshot = {
        "prompt": {"prompt_text": f"GEO408 SUCCESS {uuid4()}"},
        "subjects": [{"canonical_name": "GEO408 fictional", "product_id": None}],
        "data_classification": "INTERNAL",
    }
    assert fictional_input(snapshot)["data_classification"] == "PUBLIC"
    assert snapshot["data_classification"] == "INTERNAL"
    with pytest.raises(ValueError):
        fictional_input(
            {**snapshot, "subjects": [{"canonical_name": "Real brand", "product_id": None}]}
        )
    with pytest.raises(ValueError):
        fictional_input(
            {
                **snapshot,
                "subjects": [{"canonical_name": "GEO408 fake", "product_id": str(uuid4())}],
            }
        )
    internal = {**snapshot, "prompt": {"prompt_text": f"GEO408 INTERNAL {uuid4()}"}}
    assert fictional_input(internal)["data_classification"] == "INTERNAL"


@pytest.mark.parametrize(
    "prompt",
    [
        "GEO408 SUCCESS arbitrary",
        f"GEO408 SUCCESS {uuid4()} extra",
        f"GEO408 OTHER {uuid4()}",
        f"GEO408 SUCCESS {str(uuid4()).upper()}",
    ],
)
def test_prompt_does_not_admit_arbitrary_external_input(prompt: str) -> None:
    with pytest.raises(ValueError):
        scenario_name(prompt)


@pytest.mark.parametrize(("name", "first"), [("RATE_LIMIT", "429"), ("UNKNOWN", "disconnect")])
def test_failure_scenario_uses_actual_attempt_number(name: str, first: str) -> None:
    prompt = f"GEO408 {name} {uuid4()}"
    assert scenario_payload(prompt, 1)["mode"] == first
    successor = scenario_payload(prompt, 2)
    assert successor["mode"] == "citations"
    assert successor["partial_usage"] is True and successor["web_search_observed"] is None
    with pytest.raises(ValueError):
        scenario_payload(prompt, 0)


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/v1",
        "http://localhost:19012/v1",
        "http://127.0.0.1:9001/v1",
        "http://127.0.0.1:19012/v1/",
        "http://user:secret@127.0.0.1:19012/v1",
    ],
)
def test_transport_refuses_any_other_destination_before_network(url: str) -> None:
    with pytest.raises(ValueError):
        require_provider_url(url)
    with pytest.raises(ValueError):
        _loopback_transport(uuid4()).request(method="POST", base_url=url)


@pytest.mark.parametrize("mode", list(boundary.MODES))
def test_fresh_factory_import_assembles_one_registry_for_all_real_callers(
    mode: str, tmp_path: Path
) -> None:
    receipts = tmp_path / "partsignal-e2e-storage.unit" / "geo-message-receipts"
    receipts.mkdir(parents=True)
    monitoring, api = boundary.MODES[mode]
    environment = {
        **os.environ,
        **values(),
        "PYTHONPATH": str(Path(__file__).parents[2]),
        "PARTSIGNAL_E2E_GEO_MODE": mode,
        "GEO_MONITORING_ENABLED": str(monitoring).lower(),
        "GEO_API_COLLECTION_ENABLED": str(api).lower(),
        "PARTSIGNAL_E2E_GEO_MESSAGE_RECEIPTS": str(receipts),
    }
    environment.pop("GEO_DAILY_BUDGET_LIMIT", None)
    # 此子进程只验证真实模块装配；数据库 owner 的网络边界由上面的拒绝测试独立覆盖。
    script = """
import os
from tests import geo_e2e_runtime as runtime
from tests.geo_e2e_environment import environment_values
from app.collectors import registry
assert not registry.collector_registry.resolve('openai-compatible-chat').approved
runtime.validate_owned_environment = lambda: environment_values(os.environ)
app = runtime.app
celery = runtime.celery_app
from app.services.geo_plans import RunMatrixBuilder
from app.services import geo_collection_execution, geo_read_projections
assert RunMatrixBuilder().registry is registry.collector_registry
assert geo_read_projections.collector_registry is registry.collector_registry
assert geo_collection_execution.collector_registry is registry.collector_registry
assert registry.collector_registry.resolve('openai-compatible-chat').approved
assert app.title and 'partsignal.collect_geo_run' in celery.tasks
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        env=environment,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    assert result.returncode == 0, result.stderr
