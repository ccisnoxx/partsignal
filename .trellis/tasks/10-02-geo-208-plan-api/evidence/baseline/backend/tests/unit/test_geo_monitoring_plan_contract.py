"""计划完整配置的可观察输入边界和 OpenAPI 数据组件。"""

from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError as SchemaValidationError
from pydantic import TypeAdapter, ValidationError

from app.schemas import geo_monitoring_plans as schemas


def payload(**patch: Any) -> dict[str, Any]:
    return {
        "name": "虚构监测计划",
        "subjects": [{"subject_id": str(uuid4()), "role": "PRIMARY"}],
        "prompt_variant_ids": [str(uuid4())],
        "collection_profile_ids": [str(uuid4())],
        **patch,
    }


@pytest.fixture(scope="module")
def contract() -> dict[str, Any]:
    return yaml.safe_load(
        (Path(__file__).resolve().parents[3] / "contracts/openapi.yaml").read_text()
    )


def validate(contract: dict[str, Any], name: str, value: Any) -> None:
    Draft202012Validator(
        {"$ref": f"#/components/schemas/{name}", "components": contract["components"]},
        format_checker=FormatChecker(),
    ).validate(value)


@pytest.mark.parametrize(
    "model",
    [
        schemas.GeoMonitoringPlanCreate,
        schemas.GeoMonitoringPlanUpdate,
        schemas.GeoMonitoringPlanOut,
        schemas.GeoMonitoringPlanRevisionRequest,
    ],
)
def test_components_match_pydantic(contract: dict[str, Any], model: type) -> None:
    component = TypeAdapter(model).json_schema(
        ref_template="#/components/schemas/{model}",
        mode="serialization" if model is schemas.GeoMonitoringPlanOut else "validation",
    )
    definitions = component.pop("$defs", {})
    assert contract["components"]["schemas"][model.__name__] == component
    for name, definition in definitions.items():
        assert contract["components"]["schemas"][name] == definition


def test_defaults_decimal_and_response_exclude_runtime(contract: dict[str, Any]) -> None:
    raw = payload(budget_limit="123.000001")
    plan = schemas.GeoMonitoringPlanCreate.model_validate(raw)
    assert plan.repeat_count == 3 and plan.timezone == "Asia/Shanghai"
    assert plan.schedule_kind == "MANUAL_ONLY" and plan.cron_expression is None
    assert plan.budget_limit == Decimal("123.000001")
    validate(contract, "GeoMonitoringPlanCreate", raw)
    now = datetime.now(UTC)
    response = schemas.GeoMonitoringPlanOut(
        **plan.model_dump(),
        id=uuid4(),
        status="DISABLED",
        revision=0,
        created_by=uuid4(),
        updated_by=uuid4(),
        created_at=now,
        updated_at=now,
    ).model_dump(mode="json")
    assert response["budget_limit"] == "123.000001"
    validate(contract, "GeoMonitoringPlanOut", response)
    assert (
        not {"run_count", "last_batch_id", "next_run_at", "lease", "answer", "spent_cost"}
        & response.keys()
    )
    assert not any("monitoring-plans" in path for path in contract["paths"])


@pytest.mark.parametrize(
    "patch",
    [
        {"subjects": []},
        {"prompt_variant_ids": []},
        {"collection_profile_ids": []},
        {"subjects": [{"subject_id": str(uuid4()), "role": "COMPETITOR"}]},
        {"repeat_count": 0},
        {"repeat_count": 11},
        {"repeat_count": True},
        {"repeat_count": "3"},
        {"schedule_kind": "DAILY"},
        {"schedule_kind": "CRON"},
        {"cron_expression": "0 0 * * *"},
        {"schedule_kind": "CRON", "cron_expression": ""},
        {"budget_limit": -1},
        {"budget_limit": "NaN"},
        {"budget_limit": "Infinity"},
        {"budget_limit": "100000000"},
        {"budget_limit": "0.0000001"},
        {"rule_set_revision": 0},
        {"name": " "},
        {"name": "\x00"},
        {"timezone": "Unknown/Zone"},
        {"timezone": "/etc/passwd"},
        {"timezone": "posix/Asia/Shanghai"},
        {"timezone": "right/Asia/Shanghai"},
        {"status": "ACTIVE"},
        {"revision": 0},
        {"run_count": 1},
        {"api_key": "fake-secret"},
    ],
)
def test_invalid_configuration_rejected(patch: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        schemas.GeoMonitoringPlanCreate.model_validate(payload(**patch))


@pytest.mark.parametrize("field", ["prompt_variant_ids", "collection_profile_ids", "subjects"])
def test_duplicate_resources_rejected_even_if_subject_role_differs(field: str) -> None:
    value = payload()
    item = value[field][0]
    value[field].append({**item, "role": "REFERENCE"} if field == "subjects" else item)
    with pytest.raises(ValidationError):
        schemas.GeoMonitoringPlanCreate.model_validate(value)


@pytest.mark.parametrize(
    "expression",
    [
        "60 * * * *",
        "0 24 * * *",
        "0 0 32 * *",
        "0 0 * 13 *",
        "0 0 * * 7",
        "*/0 * * * *",
        "1,,2 * * * *",
        "@daily",
        "* * * * * *",
        "*  * * * *",
        "0-5/2/3 * * * *",
        "*/5/2 * * * *",
        "0-5/2! * * * *",
        "0 0 * jan/0 *",
        "0 0 * * mon/0",
        "0 0 * jan/2 *",
        "0 0 * * mon/2",
    ],
)
def test_invalid_cron_is_validation_error(expression: str) -> None:
    with pytest.raises(ValidationError):
        schemas.GeoMonitoringPlanCreate.model_validate(
            payload(schedule_kind="CRON", cron_expression=expression)
        )


@pytest.mark.parametrize(
    "expression",
    ["* * * * *", "*/15 9-17 * * mon-fri", "0 0 1,15 * 0", "0 0 * JAN-MAR/2 Mon-Fri/2"],
)
def test_cron_timezone_and_budget_boundaries(expression: str) -> None:
    plan = schemas.GeoMonitoringPlanCreate.model_validate(
        payload(
            schedule_kind="CRON",
            cron_expression=expression,
            timezone="America/Los_Angeles",
            repeat_count=10,
            budget_limit="99999999.999999",
        )
    )
    assert plan.cron_expression == expression


def test_update_requires_full_configuration_and_revision() -> None:
    with pytest.raises(ValidationError):
        schemas.GeoMonitoringPlanUpdate.model_validate({"expected_revision": 0, "name": "新名称"})
    with pytest.raises(ValidationError):
        schemas.GeoMonitoringPlanUpdate.model_validate(payload(expected_revision=-1))
    assert (
        schemas.GeoMonitoringPlanUpdate.model_validate(
            payload(expected_revision=0)
        ).expected_revision
        == 0
    )


@pytest.mark.parametrize(
    "budget", ["-1", "1garbage", 100000000, 0.0000001, "1\n", "+1", "01", "1e-6", 1]
)
def test_budget_wire_negatives_rejected_by_static_and_runtime(
    contract: dict[str, Any], budget: Any
) -> None:
    raw = payload(budget_limit=budget)
    with pytest.raises(SchemaValidationError):
        validate(contract, "GeoMonitoringPlanCreate", raw)
    with pytest.raises(ValidationError):
        schemas.GeoMonitoringPlanCreate.model_validate(raw)


@pytest.mark.parametrize("budget", ["0", "0.000001", "123.000001", "99999999.999999"])
def test_budget_string_boundaries_round_trip_contract(
    contract: dict[str, Any], budget: str
) -> None:
    raw = payload(budget_limit=budget)
    validate(contract, "GeoMonitoringPlanCreate", raw)
    model = schemas.GeoMonitoringPlanCreate.model_validate(raw)
    assert model.budget_limit == Decimal(budget)
    encoded = model.model_dump(mode="json")
    assert encoded["budget_limit"] == budget
    validate(contract, "GeoMonitoringPlanCreate", encoded)
