"""输入规范化与未接线公共组件的真实合同验证。"""

from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from pydantic import ValidationError

from app.geo_prompt_variants import normalize_prompt_text
from app.schemas.geo_prompt_variants import (
    GeoPromptVariantCreate,
    GeoPromptVariantOut,
    GeoPromptVariantRevisionRequest,
    GeoPromptVariantUpdate,
)


def payload(**patch: Any) -> dict[str, Any]:
    return {
        "query_topic_id": str(uuid4()),
        "prompt_text": "  ＰＳ-10Ａ\u00a0 替代？  ",
        "mention_mode": "BRANDED",
        "language_code": "ZH-Hans",
        "region_code": "cn",
        "priority": "CORE",
        **patch,
    }


@pytest.fixture(scope="module")
def contract() -> dict[str, Any]:
    return yaml.safe_load(
        (Path(__file__).resolve().parents[3] / "contracts/openapi.yaml").read_text()
    )


def validate_component(contract: dict[str, Any], name: str, value: Any) -> None:
    Draft202012Validator(
        {"$ref": f"#/components/schemas/{name}", "components": contract["components"]},
        format_checker=FormatChecker(),
    ).validate(value)


def test_normalization_preserves_question_semantics() -> None:
    model = GeoPromptVariantCreate.model_validate(payload())
    assert model.prompt_text == "PS-10A 替代?"
    assert model.language_code == "zh-hans"
    assert model.region_code == "CN"
    assert normalize_prompt_text("PS-10A") != normalize_prompt_text("ps-10a")
    assert normalize_prompt_text("PS-10A") != normalize_prompt_text("PS-10B")
    assert normalize_prompt_text("e\u0301\t型  号") == "é 型 号"


@pytest.mark.parametrize(
    "patch",
    [
        {"prompt_text": "\u2003\t"},
        {"prompt_text": "abc\x00def"},
        {"prompt_text": "a" * 8001},
        {"prompt_text": "ﷺ" * 1000},
        {"mention_mode": "AUTO"},
        {"language_code": "unknown_language"},
        {"region_code": "中国"},
        {"priority": "P0"},
        {"created_by": str(uuid4())},
        {"normalized_hash": "a" * 64},
    ],
)
def test_rejects_invalid_or_client_owned_fields(patch: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        GeoPromptVariantCreate.model_validate(payload(**patch))


def test_patch_only_contains_explicit_write_intent() -> None:
    value = GeoPromptVariantUpdate.model_validate({"expected_revision": 3, "region_code": "us"})
    assert value.model_dump(exclude_unset=True) == {"expected_revision": 3, "region_code": "US"}
    for bad in [
        {"expected_revision": 0},
        {"expected_revision": True, "priority": "CORE"},
        {"expected_revision": 0, "prompt_text": None},
    ]:
        with pytest.raises(ValidationError):
            GeoPromptVariantUpdate.model_validate(bad)


def test_public_components_match_pydantic_schema(contract: dict[str, Any]) -> None:
    def clean(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                k: clean(v) for k, v in value.items() if k not in {"title", "description", "$defs"}
            }
        if isinstance(value, list):
            return [clean(v) for v in value]
        if isinstance(value, str):
            return value.replace("#/$defs/", "#/components/schemas/")
        return value

    for model in [
        GeoPromptVariantCreate,
        GeoPromptVariantUpdate,
        GeoPromptVariantRevisionRequest,
        GeoPromptVariantOut,
    ]:
        assert clean(model.model_json_schema()) == clean(
            contract["components"]["schemas"][model.__name__]
        )
    validate_component(contract, "GeoPromptVariantCreate", payload())
    validate_component(
        contract, "GeoPromptVariantUpdate", {"expected_revision": 0, "priority": "CORE"}
    )
    assert not any("prompt-variants" in path for path in contract["paths"])
