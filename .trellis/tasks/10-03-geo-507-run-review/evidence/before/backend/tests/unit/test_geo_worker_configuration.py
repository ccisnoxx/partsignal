"""GEO-405 运行参数边界与既有 runtime 的兼容入口。"""

import pytest
from pydantic import ValidationError

from app.config import Settings
from tests.unit.test_geo_configuration import GEO_FLAGS
from tests.unit.test_geo_configuration import (
    test_production_input_checker_preserves_safe_defaults_and_strict_boundaries as check_runtime,
)

PARAMETERS = {
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
    check_runtime(tmp_path, dict.fromkeys([*GEO_FLAGS, *PARAMETERS]), "PASSED", None)
