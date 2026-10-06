"""预览组件机器形状与真实序列化实例；不声明未接线Plan操作。"""

from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, FormatChecker
from pydantic import TypeAdapter

from app.schemas.geo_plan_preview import GeoMonitoringPlanPreview
from tests.unit.test_geo_run_matrix import build, matrix_inputs


def test_preview_component_and_serialized_unknown_match_contract() -> None:
    contract = yaml.safe_load(
        (Path(__file__).resolve().parents[3] / "contracts/openapi.yaml").read_text()
    )
    actual = TypeAdapter(GeoMonitoringPlanPreview).json_schema(
        ref_template="#/components/schemas/{model}", mode="serialization"
    )
    definitions = actual.pop("$defs")
    components = contract["components"]["schemas"]
    assert components["GeoMonitoringPlanPreview"] == actual
    for name, definition in definitions.items():
        assert components[name] == definition
    validator = Draft202012Validator(
        {
            "$ref": "#/components/schemas/GeoMonitoringPlanPreview",
            "components": contract["components"],
        },
        format_checker=FormatChecker(),
    )
    payload = build(matrix_inputs()).preview().model_dump(mode="json")
    validator.validate(payload)
    assert payload["estimated_cost"]["value"] is None
    assert not any("monitoring-plans" in path for path in contract["paths"])
    assert (
        not {"run_count", "estimated_cost"}
        & components["GeoMonitoringPlanCreate"]["properties"].keys()
    )
