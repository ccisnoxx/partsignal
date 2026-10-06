"""独立动作组件的required/typed合同与真实wire正反例。"""

from typing import Any

import pytest
from jsonschema.exceptions import ValidationError as JsonError
from pydantic import ValidationError

from app.schemas import geo_run_workflow as schemas
from tests.unit.test_geo_run_contract import (
    annotations_removed,
    contract,
    validate,
)

__all__ = ["contract"]


@pytest.mark.parametrize(
    "model", [schemas.GeoRunWorkflowProjection, schemas.GeoBatchWorkflowProjection]
)
def test_all_workflow_components_match_openapi(contract: dict[str, Any], model: type) -> None:
    component = model.model_json_schema(ref_template="#/components/schemas/{model}")
    definitions = component.pop("$defs", {})
    assert annotations_removed(
        contract["components"]["schemas"][model.__name__]
    ) == annotations_removed(component)
    for name, definition in definitions.items():
        assert annotations_removed(contract["components"]["schemas"][name]) == annotations_removed(
            definition
        )


@pytest.mark.parametrize(
    "model,payload",
    [
        (
            schemas.GeoRunWorkflowProjection,
            {
                "workflow_stage": "MANUAL_ENTRY_REQUIRED",
                "primary_task": "ENTER_MANUAL_OBSERVATION",
                "available_actions": ["ENTER_MANUAL_OBSERVATION", "CANCEL"],
            },
        ),
        (
            schemas.GeoBatchWorkflowProjection,
            {
                "status": "FAILED",
                "workflow_stage": "FAILED",
                "primary_task": "HANDLE_FAILURE",
                "available_actions": [],
            },
        ),
    ],
)
def test_real_dump_and_required_closed_tokens(
    contract: dict[str, Any], model: type, payload: dict[str, Any]
) -> None:
    parsed = model.model_validate(payload)
    validate(contract, model.__name__, parsed.model_dump(mode="json"))
    invalid = [
        payload | {"secret": "虚构值"},
        payload | {"available_actions": ["UNKNOWN"]},
        payload | {"workflow_stage": "UNKNOWN"},
        payload | {"primary_task": "UNKNOWN"},
    ]
    invalid.extend({k: v for k, v in payload.items() if k != missing} for missing in payload)
    for value in invalid:
        with pytest.raises(ValidationError):
            model.model_validate(value)
        with pytest.raises(JsonError):
            validate(contract, model.__name__, value)
