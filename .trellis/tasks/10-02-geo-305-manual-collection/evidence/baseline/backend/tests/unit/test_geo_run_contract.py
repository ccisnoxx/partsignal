"""冻结输入的真实合同、模式闭合与公共组件一致性。"""

from copy import deepcopy
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError as JsonError
from pydantic import TypeAdapter, ValidationError

from app.schemas import geo_runs as schemas
from app.schemas.geo_monitoring_plans import GeoMonitoringPlanConfiguration
from tests.unit.test_geo_surface_contract import capabilities, profile_payload


def input_snapshot(mode: str = "MANUAL") -> dict[str, Any]:
    profile = profile_payload(mode)
    profile.pop("engine_surface_id")
    profile.update(
        id=str(uuid4()),
        revision=0,
        adapter_version="fixture-v1",
        surface={
            "id": str(uuid4()),
            "revision": 0,
            "name": "虚构观测面",
            "surface_kind": "CONSUMER_UI",
            "provider_brand": "CUSTOM",
            "compliance_status": "NOT_REVIEWED",
            "capabilities": capabilities(),
        },
    )
    value = {
        "schema_version": 1,
        "data_classification": "PUBLIC",
        "rule_set_revision": 1,
        "prompt": {
            "id": str(uuid4()),
            "revision": 0,
            "query_topic_id": str(uuid4()),
            "query_topic_revision": 0,
            "canonical_question": "虚构问题",
            "intent_type": "REPLACEMENT",
            "prompt_text": "虚构变体问题",
            "mention_mode": "UNBRANDED",
            "priority": "CORE",
            "language_code": "zh-hans",
            "region_code": "CN",
        },
        "profile": profile,
        "subjects": [
            {
                "id": str(uuid4()),
                "revision": 0,
                "subject_type": "OWN_BRAND",
                "role": "PRIMARY",
                "product_id": None,
                "parent_subject_id": None,
                "canonical_name": "虚构品牌",
                "display_name": "虚构品牌",
                "aliases": [],
                "domains": [],
            }
        ],
    }
    return schemas.GeoRunInputSnapshot.model_validate(value).model_dump(mode="json")


def plan_snapshot(value: dict[str, Any], **patch: Any) -> dict[str, Any]:
    configuration = GeoMonitoringPlanConfiguration.model_validate(
        {
            "name": "虚构批次配置",
            "subjects": [{"subject_id": value["subjects"][0]["id"], "role": "PRIMARY"}],
            "prompt_variant_ids": [value["prompt"]["id"]],
            "collection_profile_ids": [value["profile"]["id"]],
            "repeat_count": 1,
        }
    ).model_dump(mode="json")
    return {**configuration, "schema_version": 1, "plan_id": None, "plan_revision": None, **patch}


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


def annotations_removed(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            k: annotations_removed(v) for k, v in value.items() if k not in {"title", "description"}
        }
    if isinstance(value, list):
        return [annotations_removed(v) for v in value]
    return value


@pytest.mark.parametrize(
    "model",
    [
        schemas.GeoObservationBatchOut,
        schemas.GeoObservationRunOut,
        schemas.GeoRunInputSnapshot,
        schemas.GeoRunCommandErrorCode,
    ],
)
def test_public_components_match_pydantic(contract: dict[str, Any], model: type) -> None:
    component = TypeAdapter(model).json_schema(ref_template="#/components/schemas/{model}")
    definitions = component.pop("$defs", {})
    assert contract["components"]["schemas"][model.__name__] == component
    for name, definition in definitions.items():
        assert annotations_removed(contract["components"]["schemas"][name]) == annotations_removed(
            definition
        )


@pytest.mark.parametrize("mode", ["MANUAL", "API", "BROWSER"])
def test_complete_snapshot_and_plan_dump_validate_in_openapi(
    mode: str, contract: dict[str, Any]
) -> None:
    value = input_snapshot(mode)
    parsed = schemas.GeoRunInputSnapshot.model_validate(value)
    assert parsed.model_dump(mode="json") == value
    validate(contract, "GeoRunInputSnapshot", value)
    configuration = plan_snapshot(value)
    validate(
        contract,
        "GeoBatchPlanSnapshot",
        schemas.GeoBatchPlanSnapshot.model_validate(configuration).model_dump(mode="json"),
    )
    assert (
        "lease_token" not in contract["components"]["schemas"]["GeoObservationRunOut"]["properties"]
    )
    assert "/api/v1/geo/runs" not in contract["paths"]


@pytest.mark.parametrize("key", ["api_key", "headers", "Cookie", "session_path", "answer"])
@pytest.mark.parametrize("location", ["root", "profile", "settings", "subject"])
def test_sensitive_or_result_fields_rejected(
    key: str, location: str, contract: dict[str, Any]
) -> None:
    value = input_snapshot()
    target = {
        "root": value,
        "profile": value["profile"],
        "settings": value["profile"]["settings"],
        "subject": value["subjects"][0],
    }[location]
    target[key] = "虚构值"
    with pytest.raises(ValidationError):
        schemas.GeoRunInputSnapshot.model_validate(value)
    with pytest.raises(JsonError):
        validate(contract, "GeoRunInputSnapshot", value)


@pytest.mark.parametrize(
    "patch",
    [
        {"data_classification": "UNKNOWN"},
        {"rule_set_revision": 0},
        {"schema_version": 2},
        {"subjects": []},
    ],
)
def test_invalid_envelope_rejected(patch: dict[str, Any], contract: dict[str, Any]) -> None:
    value = input_snapshot() | patch
    with pytest.raises(ValidationError):
        schemas.GeoRunInputSnapshot.model_validate(value)
    with pytest.raises(JsonError):
        validate(contract, "GeoRunInputSnapshot", value)


def test_subject_identity_and_primary_are_input_invariants(contract: dict[str, Any]) -> None:
    value = input_snapshot()
    value["subjects"].append(deepcopy(value["subjects"][0]))
    with pytest.raises(ValidationError):
        schemas.GeoRunInputSnapshot.model_validate(value)
    value["subjects"] = [value["subjects"][0] | {"role": "COMPETITOR"}]
    with pytest.raises(ValidationError):
        schemas.GeoRunInputSnapshot.model_validate(value)
    with pytest.raises(JsonError):
        validate(contract, "GeoRunInputSnapshot", value)
    value["subjects"][0].update(role="PRIMARY", subject_type="OWN_PRODUCT")
    with pytest.raises(ValidationError):
        schemas.GeoRunInputSnapshot.model_validate(value)
    with pytest.raises(JsonError):
        validate(contract, "GeoRunInputSnapshot", value)


def test_plan_source_identity_must_be_paired(contract: dict[str, Any]) -> None:
    value = plan_snapshot(input_snapshot(), plan_id=str(uuid4()))
    with pytest.raises(ValidationError):
        schemas.GeoBatchPlanSnapshot.model_validate(value)
    with pytest.raises(JsonError):
        validate(contract, "GeoBatchPlanSnapshot", value)


def test_own_product_derived_display_name_preserves_product_limits(
    contract: dict[str, Any],
) -> None:
    value = input_snapshot()
    value["subjects"][0].update(
        subject_type="OWN_PRODUCT",
        product_id=str(uuid4()),
        canonical_name="M" * 160,
        display_name="B" * 160 + " " + "M" * 160,
    )
    parsed = schemas.GeoRunInputSnapshot.model_validate(value)
    validate(contract, "GeoRunInputSnapshot", parsed.model_dump(mode="json"))
