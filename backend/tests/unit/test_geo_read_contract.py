"""读取合同闭合、nullable占位与筛选时间窗口。"""

from datetime import UTC, datetime, timedelta

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas import geo_read_models as read
from app.schemas.geo_read_filters import GeoGlobalRunFilters
from tests.unit.test_geo_run_contract import annotations_removed, validate
from tests.unit.test_geo_run_contract import contract as contract


@pytest.mark.parametrize(
    "model",
    [read.GeoBatchListPage, read.GeoBatchDetail, read.GeoRunListPage, read.GeoRunDetail],
)
def test_read_components_match_authority(contract, model):
    schema = TypeAdapter(model).json_schema(
        ref_template="#/components/schemas/{model}", mode="serialization"
    )
    definitions = schema.pop("$defs", {})
    assert contract["components"]["schemas"][model.__name__] == schema
    for name, value in definitions.items():
        assert annotations_removed(contract["components"]["schemas"][name]) == annotations_removed(
            value
        )


def test_quality_placeholder_does_not_claim_metric_eligibility(contract):
    value = {
        "assessment": "NOT_IMPLEMENTED",
        "metric_eligible": None,
        "reason_code": "METRIC_ELIGIBILITY_NOT_IMPLEMENTED",
        "unavailable_sections": ["ANALYSIS", "REVIEW", "METRICS", "OPPORTUNITIES", "RETEST"],
    }
    parsed = read.GeoRunDataQuality.model_validate(value)
    validate(contract, "GeoRunDataQuality", parsed.model_dump(mode="json"))
    for patch in ({"metric_eligible": False}, {"assessment": "PASSED"}, {"eligible_count": 0}):
        with pytest.raises(ValidationError):
            read.GeoRunDataQuality.model_validate(value | patch)


@pytest.mark.parametrize(
    "value",
    [
        {"page": 0},
        {"page_size": 1000},
        {"status": "UNKNOWN"},
        {"created_from": "2026-10-02T00:00:00"},
        {"q": "bad\x00"},
        {"unknown": "unsupported"},
    ],
)
def test_filters_reject_invalid_input(value):
    with pytest.raises(ValidationError):
        GeoGlobalRunFilters.model_validate(value)


def test_filter_window_is_aware_half_open_and_latest_by_default():
    now = datetime.now(UTC)
    with pytest.raises(ValidationError):
        GeoGlobalRunFilters(created_from=now, created_to=now)
    parsed = GeoGlobalRunFilters(created_from=now, created_to=now + timedelta(seconds=1))
    assert parsed.latest_only and parsed.page == 1 and parsed.page_size == 20


def test_evidence_schema_is_signed_access_without_payload_or_storage_metadata():
    properties = read.GeoRunEvidenceFile.model_json_schema()["properties"]
    assert set(properties) == {
        "id",
        "kind",
        "content_type",
        "size",
        "sha256",
        "access_level",
        "download",
    }
    assert "lease_token" not in read.GeoRunListItem.model_fields
