"""观测配置模式、闭合数据与OpenAPI数据组件一致性。"""

from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema import ValidationError as JsonError
from pydantic import TypeAdapter, ValidationError

from app.schemas import geo_surfaces as schemas


def capabilities() -> dict[str, bool]:
    return {
        "answer_text": True,
        "citations": False,
        "web_search_signal": False,
        "model_version": False,
        "usage": False,
        "cost": False,
    }


def surface_payload(**patch: Any) -> dict[str, Any]:
    return {
        "name": "虚构观测面",
        "slug": "fictional-ui",
        "surface_kind": "CONSUMER_UI",
        "provider_brand": "CUSTOM",
        "website_url": "https://example.com/ai",
        "compliance_status": "NOT_REVIEWED",
        "capabilities": capabilities(),
        **patch,
    }


def profile_payload(mode: str = "MANUAL", **patch: Any) -> dict[str, Any]:
    return {
        "engine_surface_id": str(uuid4()),
        "name": "虚构配置",
        "collection_mode": mode,
        "adapter_key": "manual" if mode == "MANUAL" else "fictional-adapter",
        "ai_channel_id": None,
        "ai_model_id": None,
        "language_code": "zh-hans",
        "region_code": "CN",
        "login_state": "NOT_APPLICABLE" if mode == "API" else "ANONYMOUS",
        "web_search_policy": "UNKNOWN",
        "settings": {},
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


@pytest.mark.parametrize("mode", ["MANUAL", "API", "BROWSER"])
def test_supported_profiles_validate_in_schema_and_openapi(
    mode: str, contract: dict[str, Any]
) -> None:
    value = profile_payload(mode)
    parsed = TypeAdapter(schemas.GeoCollectionProfileCreate).validate_python(value)
    assert parsed.collection_mode == mode
    validate(contract, "GeoCollectionProfileCreate", value)
    if mode == "API":
        value.update(ai_channel_id=str(uuid4()), ai_model_id=str(uuid4()))
        TypeAdapter(schemas.GeoCollectionProfileCreate).validate_python(value)
        validate(contract, "GeoCollectionProfileCreate", value)


@pytest.mark.parametrize("mode", ["MANUAL", "API", "BROWSER"])
@pytest.mark.parametrize(
    "key", ["api_key", "api_key_ciphertext", "Cookie", "headers", "session_path"]
)
def test_secrets_rejected_at_every_configuration_level(
    mode: str, key: str, contract: dict[str, Any]
) -> None:
    for location in ["root", "settings"]:
        value = profile_payload(mode)
        target = value if location == "root" else value["settings"]
        target[key] = "fictional-secret-marker"
        with pytest.raises(ValidationError):
            TypeAdapter(schemas.GeoCollectionProfileCreate).validate_python(value)
        with pytest.raises(JsonError):
            validate(contract, "GeoCollectionProfileCreate", value)


@pytest.mark.parametrize(
    "mode,patch",
    [
        ("MANUAL", {"ai_model_id": str(uuid4()), "ai_channel_id": str(uuid4())}),
        ("BROWSER", {"ai_model_id": str(uuid4()), "ai_channel_id": str(uuid4())}),
        ("API", {"ai_model_id": str(uuid4())}),
        ("API", {"ai_channel_id": str(uuid4())}),
        ("API", {"login_state": "AUTHENTICATED"}),
        ("BROWSER", {"login_state": "NOT_APPLICABLE"}),
        ("MANUAL", {"adapter_key": "some-api"}),
        ("API", {"settings": {"temperature": True}}),
        ("API", {"settings": {"temperature": 2.01}}),
        ("API", {"settings": {"max_output_tokens": 1.0}}),
        ("API", {"settings": {"max_output_tokens": 0}}),
        ("BROWSER", {"settings": {"answer_timeout_seconds": 601}}),
        ("MANUAL", {"settings": {"require_screenshot": "secret"}}),
        ("BROWSER", {"settings": {"answer_timeout_seconds": {"Cookie": "fake"}}}),
        ("API", {"web_search_policy": "GUESSED"}),
        ("MANUAL", {"collection_mode": "AUTO"}),
    ],
)
def test_invalid_combinations_fail_in_both_contracts(
    mode: str, patch: dict[str, Any], contract: dict[str, Any]
) -> None:
    value = profile_payload(mode, **patch)
    with pytest.raises(ValidationError):
        TypeAdapter(schemas.GeoCollectionProfileCreate).validate_python(value)
    # JSON Schema允许1.0代表数学整数；Pydantic的严格JSON输入再拒绝该Python float。
    if patch != {"settings": {"max_output_tokens": 1.0}}:
        with pytest.raises(JsonError):
            validate(contract, "GeoCollectionProfileCreate", value)


@pytest.mark.parametrize(
    "patch",
    [
        {"capabilities": {**capabilities(), "secret": False}},
        {"capabilities": {**capabilities(), "citations": 1}},
        {"capabilities": {**capabilities(), "answer_text": False}},
        {"capabilities": {**capabilities(), "answer_text": 1}},
        {"capabilities": {k: v for k, v in capabilities().items() if k != "cost"}},
        {"website_url": "https://user:fake@example.com"},
        {"website_url": "https://example.com/?api_key=fake"},
        {"website_url": "https://example.com/#fake"},
        {"surface_kind": "SEARCH_PRODUCT"},
        {"compliance_status": "BLOCKED"},
        {"provider_brand": "UNREGISTERED"},
        {"name": "\u00a0虚构平台"},
    ],
)
def test_surface_rejects_unknown_or_sensitive_configuration(patch: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        schemas.GeoEngineSurfaceCreate.model_validate(surface_payload(**patch))


@pytest.mark.parametrize("mode", ["MANUAL", "API", "BROWSER"])
def test_response_is_closed_and_contains_only_non_sensitive_settings(
    mode: str, contract: dict[str, Any]
) -> None:
    value = profile_payload(mode)
    now = datetime.now(UTC).isoformat()
    value.update(
        id=str(uuid4()),
        is_active=False,
        last_test_status="UNTESTED",
        last_tested_at=None,
        revision=0,
        created_by=str(uuid4()),
        created_at=now,
        updated_at=now,
    )
    output = (
        TypeAdapter(schemas.GeoCollectionProfileOut).validate_python(value).model_dump(mode="json")
    )
    validate(contract, "GeoCollectionProfileOut", output)
    for key in [
        "api_key",
        "api_key_ciphertext",
        "Cookie",
        "headers",
        "session_path",
        "settings_json",
    ]:
        assert key not in output and key not in output["settings"]
        bad = deepcopy(output)
        bad[key] = "fictional-secret-marker"
        with pytest.raises(ValidationError):
            TypeAdapter(schemas.GeoCollectionProfileOut).validate_python(bad)
    for status, tested_at in [("PASSED", None), ("FAILED", None), ("UNTESTED", now)]:
        bad = {**value, "last_test_status": status, "last_tested_at": tested_at}
        with pytest.raises(ValidationError):
            TypeAdapter(schemas.GeoCollectionProfileOut).validate_python(bad)
        with pytest.raises(JsonError):
            validate(contract, "GeoCollectionProfileOut", bad)
    if mode == "API":
        bad = {**value, "ai_model_id": str(uuid4())}
        with pytest.raises(JsonError):
            validate(contract, "GeoCollectionProfileOut", bad)


@pytest.mark.parametrize("name", ["\x00", "\x00虚构", "虚构\x00", "虚\x00构"])
def test_surface_and_profile_names_reject_nul_in_public_schema(
    name: str, contract: dict[str, Any]
) -> None:
    for component, payload, model in [
        ("GeoEngineSurfaceCreate", surface_payload(name=name), schemas.GeoEngineSurfaceCreate),
        (
            "GeoCollectionProfileCreate",
            profile_payload(name=name),
            schemas.GeoCollectionProfileCreate,
        ),
    ]:
        with pytest.raises(ValidationError):
            TypeAdapter(model).validate_python(payload)
        with pytest.raises(JsonError):
            validate(contract, component, payload)


def test_full_update_requires_revision_and_no_client_metadata() -> None:
    value = profile_payload("API")
    value.pop("engine_surface_id")
    adapter = TypeAdapter(schemas.GeoCollectionProfileUpdate)
    with pytest.raises(ValidationError):
        adapter.validate_python(value)
    parsed = adapter.validate_python({**value, "expected_revision": 2})
    assert parsed.expected_revision == 2
    for patch in [
        {"expected_revision": True},
        {"expected_revision": -1},
        {"is_active": True},
        {"last_test_status": "PASSED"},
        {"created_by": str(uuid4())},
    ]:
        with pytest.raises(ValidationError):
            adapter.validate_python({**value, "expected_revision": 2, **patch})


def test_public_schema_components_match_pydantic(contract: dict[str, Any]) -> None:
    def clean(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                k: clean(v) for k, v in value.items() if k not in {"title", "description", "$defs"}
            }
        if isinstance(value, list):
            return [clean(v) for v in value]
        return value

    for name in [
        "GeoEngineSurfaceCreate",
        "GeoEngineSurfaceUpdate",
        "GeoEngineSurfaceOut",
        "GeoCollectionProfileCreate",
        "GeoCollectionProfileUpdate",
        "GeoCollectionProfileOut",
    ]:
        schema = TypeAdapter(getattr(schemas, name)).json_schema(
            ref_template="#/components/schemas/{model}"
        )
        for key, definition in schema.pop("$defs", {}).items():
            assert clean(definition) == clean(contract["components"]["schemas"][key])
        assert clean(schema) == clean(contract["components"]["schemas"][name])
