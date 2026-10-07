"""创建输入与持久化身份的公共合同，不执行 Collector。"""

from datetime import UTC, datetime, timedelta, timezone
from uuid import uuid4

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.geo_batch_creation import (
    GeoAdHocBatchCreate,
    GeoBatchCreated,
    GeoObservationBatchCreate,
    GeoPlanBatchCreate,
)
from app.services.geo_batches import manual_identity, schedule_identity
from tests.unit.test_geo_monitoring_plan_contract import contract as contract
from tests.unit.test_geo_monitoring_plan_contract import payload, validate


@pytest.mark.parametrize("model", [GeoAdHocBatchCreate, GeoPlanBatchCreate, GeoBatchCreated])
def test_creation_components_match_authority(contract, model):
    schema = TypeAdapter(model).json_schema(
        ref_template="#/components/schemas/{model}",
        mode="serialization" if model is GeoBatchCreated else "validation",
    )
    definitions = schema.pop("$defs", {})
    assert contract["components"]["schemas"][model.__name__] == schema
    for name, definition in definitions.items():
        assert contract["components"]["schemas"][name] == definition


@pytest.mark.parametrize("source", ["PLAN", "AD_HOC"])
def test_closed_request_and_response(contract, source):
    value = (
        {"source": source, "plan_id": str(uuid4()), "expected_revision": 0}
        if source == "PLAN"
        else {"source": source, "configuration": payload()}
    )
    model = GeoPlanBatchCreate if source == "PLAN" else GeoAdHocBatchCreate
    parsed = TypeAdapter(GeoObservationBatchCreate).validate_python(value)
    validate(contract, model.__name__, value)
    for field in ("created_by", "scheduled_for", "status", "input_snapshot", "trigger_type"):
        with pytest.raises(ValidationError):
            TypeAdapter(GeoObservationBatchCreate).validate_python(value | {field: "untrusted"})
    assert parsed.source == source
    receipt = GeoBatchCreated(
        batch_id=uuid4(), requested_run_count=1000, created_at=datetime.now(UTC)
    )
    validate(contract, "GeoBatchCreated", receipt.model_dump(mode="json"))


def test_identity_namespaces_and_timezone_normalization():
    user, plan = uuid4(), uuid4()
    window = datetime(2026, 10, 3, tzinfo=UTC)
    assert manual_identity(user, "same-key") == manual_identity(user, "same-key")
    assert manual_identity(user, "same-key") != manual_identity(uuid4(), "same-key")
    assert schedule_identity(plan, window) == schedule_identity(
        plan, window.astimezone(timezone(timedelta(hours=8)))
    )
    assert schedule_identity(plan, window) != schedule_identity(plan, window + timedelta(hours=1))
    with pytest.raises(ValueError, match="时区"):
        schedule_identity(plan, datetime(2026, 10, 3))
