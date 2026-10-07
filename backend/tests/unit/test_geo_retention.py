"""保留策略的配置边界与无载荷调度。"""

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.services.file_records import cleanup_file_records
from app.services.geo_retention import cleanup_terminal_drafts
from app.worker import celery_app


def test_new_retention_policies_require_explicit_days_and_default_to_dry_run():
    value = Settings(_env_file=None)
    assert value.geo_retention_dry_run
    assert value.geo_raw_payload_retention_days is None
    assert value.geo_terminal_draft_retention_days is None
    assert value.geo_unreferenced_file_retention_days is None
    assert value.geo_retention_batch_size == 100


@pytest.mark.parametrize("values", [
    {"GEO_RAW_PAYLOAD_RETENTION_DAYS": 89},
    {"GEO_RAW_PAYLOAD_RETENTION_DAYS": 181},
    {"GEO_TERMINAL_DRAFT_RETENTION_DAYS": 0},
    {"GEO_UNREFERENCED_FILE_RETENTION_DAYS": 6},
    {"GEO_RETENTION_BATCH_SIZE": 1001},
])
def test_invalid_policy_fails_at_configuration_boundary(values):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **values)


@pytest.mark.parametrize("size", [0, 1001, True])
def test_batch_validation_precedes_any_database_or_storage_access(size):
    with pytest.raises(ValueError):
        cleanup_file_records(batch_size=size)
    with pytest.raises(ValueError):
        cleanup_terminal_drafts(retention_days=None, batch_size=size, dry_run=True)


def test_geo_cleanup_schedule_has_no_message_payload():
    assert celery_app.conf.beat_schedule["cleanup-geo-artifacts"] == {
        "task": "partsignal.geo_cleanup_artifacts", "schedule": 3600.0,
    }
