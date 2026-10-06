"""GEO-405 运行参数边界与既有 runtime 的兼容入口。"""

import pytest
from pydantic import ValidationError

from app.config import Settings
from tests.unit.test_geo_configuration import GEO_FLAGS
from tests.unit.test_geo_configuration import (
    test_production_input_checker_preserves_safe_defaults_and_strict_boundaries as check_runtime,
)

PARAMETERS = {
    "CELERY_CONCURRENCY": (1, 1, 10),
    "GEO_PENDING_REDISPATCH_SECONDS": (120, 1, 86400),
    "GEO_COLLECTION_FINALIZE_GRACE_SECONDS": (120, 1, 3600),
    "GEO_RECOVERY_SCAN_SECONDS": (60, 5, 3600),
    "GEO_RECOVERY_BATCH_SIZE": (100, 1, 1000),
}


@pytest.mark.parametrize("name", PARAMETERS)
def test_worker_parameter_defaults_and_limits(name, monkeypatch):
    for variable in [*GEO_FLAGS, *PARAMETERS]:
        monkeypatch.delenv(variable, raising=False)
    default, minimum, maximum = PARAMETERS[name]
    value = Settings(_env_file=None, APP_ENV="test")
    assert getattr(value, name.lower()) == default
    for valid in (minimum, maximum):
        assert (
            getattr(Settings(_env_file=None, APP_ENV="test", **{name: valid}), name.lower())
            == valid
        )
    for invalid in (minimum - 1, maximum + 1, "invalid"):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, APP_ENV="test", **{name: invalid})


def test_existing_runtime_can_omit_all_geo_settings(tmp_path):
    check_runtime(tmp_path, dict.fromkeys([*GEO_FLAGS, *[p for p in PARAMETERS
                                                   if p != "CELERY_CONCURRENCY"]]),
                  "PASSED", None)


def test_worker_consumes_concurrency_without_compose_override(tmp_path):
    """进程启动后的真实Celery consumer接受env，部署命令不覆盖它。"""
    import os
    import subprocess
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    code = """
from celery.worker.worker import WorkController
from app.worker import celery_app
controller = WorkController.__new__(WorkController)
controller.app = celery_app
controller.setup_defaults()
print(controller.concurrency)
"""
    for concurrency in (1, 10):
        result = subprocess.run(
            [sys.executable, "-c", code], cwd=tmp_path, capture_output=True, text=True,
            env={**os.environ, "APP_ENV": "test", "CELERY_CONCURRENCY": str(concurrency),
                 "PYTHONPATH": str(root / "backend")}, check=True,
        )
        assert result.stdout.strip() == str(concurrency)
    for name in ("dev", "staging", "prod"):
        assert "--concurrency" not in (root / f"deploy/compose.{name}.yaml").read_text()
