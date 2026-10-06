"""Response comparator 的最小 mutation 契约测试。"""

from __future__ import annotations

import json
import sys
from copy import deepcopy
from typing import Any

import pytest
from fastapi import FastAPI, Header, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.tools.contract_check import check, compare_response_contracts, json_pointer, main


class _ItemPayload(BaseModel):
    name: str


def _document(response: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "openapi": "3.1.0",
        "paths": {
            "/items/{id}": {"get": {"responses": {"200": response or {"description": "ok"}}}}
        },
    }


def _operation_document(method: str) -> dict[str, Any]:
    return {
        "openapi": "3.1.0",
        "paths": {
            "/probe": {
                method: {
                    "operationId": f"probe_{method}",
                    "responses": {"200": {"description": "ok"}},
                }
            }
        },
    }


def _json_response(schema: dict[str, Any], status: str = "200") -> dict[str, Any]:
    document = _document()
    document["paths"]["/items/{id}"]["get"]["responses"] = {
        status: {
            "description": "ok",
            "content": {"application/json": {"schema": schema}},
        }
    }
    return document


def _failures(contract: dict[str, Any], runtime: dict[str, Any]) -> list[dict[str, Any]]:
    return compare_response_contracts(contract, runtime)


def _default_gate_document() -> dict[str, Any]:
    document = _json_response(
        {
            "type": "object",
            "required": ["code"],
            "properties": {"code": {"type": "string"}},
        }
    )
    document["paths"]["/items/{id}"]["get"]["responses"]["200"]["headers"] = {
        "X-Request-ID": {"required": True, "schema": {"type": "string"}}
    }
    document["paths"]["/items/{id}"]["get"]["responses"]["404"] = {
        "description": "not found",
        "content": {
            "application/json": {
                "schema": {
                    "type": "object",
                    "required": ["code"],
                    "properties": {"code": {"type": "string"}},
                }
            }
        },
    }
    return document


def _csv_document() -> dict[str, Any]:
    return _document(
        {
            "description": "ok",
            "content": {"text/csv": {"schema": {"type": "string"}}},
            "headers": {
                "X-Request-ID": {"required": True, "schema": {"type": "string"}},
                "Content-Disposition": {
                    "required": True,
                    "schema": {"type": "string"},
                },
            },
        }
    )


def _check_document(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
    contract: dict[str, Any],
    runtime: dict[str, Any],
) -> list[str]:
    from app.main import app

    path = tmp_path / "contract.json"
    path.write_text(json.dumps(contract), encoding="utf-8")
    monkeypatch.setattr(app, "openapi", lambda: deepcopy(runtime))
    return check(path)


def _structured_failures(failures: list[str]) -> list[dict[str, Any]]:
    return [json.loads(failure) for failure in failures if failure.startswith("{")]


def test_equal_no_body_and_annotation_only_mutation_pass() -> None:
    contract = _document()
    runtime = deepcopy(contract)
    runtime["paths"]["/items/{id}"]["get"]["responses"]["200"]["description"] = "changed prose"
    assert _failures(contract, runtime) == []


@pytest.mark.parametrize(
    ("mutation", "kind"),
    [("missing", "missing_status"), ("extra", "extra_status"), ("schema", "schema_drift")],
)
def test_status_and_schema_mutations_are_reported(mutation: str, kind: str) -> None:
    contract = _json_response({"type": "object", "required": ["name"]})
    runtime = deepcopy(contract)
    responses = runtime["paths"]["/items/{id}"]["get"]["responses"]
    if mutation == "missing":
        del responses["200"]
    elif mutation == "extra":
        responses["201"] = {"description": "created"}
    else:
        responses["200"]["content"]["application/json"]["schema"]["required"] = []
    failures = _failures(contract, runtime)
    assert any(item["kind"] == kind for item in failures)


def test_all_statuses_are_compared_including_non_2xx_and_no_body_protocol() -> None:
    contract = _document()
    responses = contract["paths"]["/items/{id}"]["get"]["responses"]
    responses["204"] = {"description": "none"}
    responses["404"] = {"description": "not found", "content": {"application/json": {"schema": {}}}}
    runtime = deepcopy(contract)
    runtime["paths"]["/items/{id}"]["get"]["responses"]["204"]["content"] = {
        "application/json": {"schema": {}}
    }
    runtime["paths"]["/items/{id}"]["get"]["responses"]["404"]["content"]["application/json"][
        "schema"
    ] = {"type": "object"}
    failures = _failures(contract, runtime)
    assert any(item["kind"] == "invalid_no_body" for item in failures)
    assert any(
        item["pointer"].endswith("/404/content/application~1json/schema/additionalProperties")
        for item in failures
    )


def test_media_and_header_sets_and_header_serialization_are_compared() -> None:
    response = {
        "description": "ok",
        "content": {"text/csv": {"schema": {"type": "string"}}},
        "headers": {"X-Trace": {"required": True, "schema": {"type": "string"}}},
    }
    contract = _document(response)
    runtime = deepcopy(contract)
    runtime_response = runtime["paths"]["/items/{id}"]["get"]["responses"]["200"]
    runtime_response["content"] = {"application/json": {"schema": {"type": "string"}}}
    runtime_response["headers"]["X-Trace"]["required"] = False
    failures = _failures(contract, runtime)
    assert any(item["kind"] == "missing_media" for item in failures)
    assert any(item["kind"] == "extra_media" for item in failures)
    assert any(item["kind"] == "header_drift" for item in failures)


def test_refs_pointer_escape_and_schema_composition_semantics() -> None:
    contract = _json_response({"$ref": "#/components/schemas/Thing~1Value"})
    contract["components"] = {"schemas": {"Thing/Value": {"type": "string"}}}
    runtime = deepcopy(contract)
    runtime["paths"]["/items/{id}"]["get"]["responses"]["200"]["content"]["application/json"][
        "schema"
    ] = {"type": "string"}
    assert _failures(contract, runtime) == []
    assert json_pointer("paths", "/items/{id}", "x/y", "a~b") == "/paths/~1items~1{id}/x~1y/a~0b"

    runtime = deepcopy(contract)
    runtime["components"]["schemas"]["Thing/Value"] = {"type": "integer"}
    assert any(item["kind"] == "schema_drift" for item in _failures(contract, runtime))


def test_composition_nullability_and_oneof_multiplicity() -> None:
    base = {"type": "string"}
    contract = _json_response({"anyOf": [base, {"type": "null"}]})
    runtime = _json_response({"type": ["null", "string"]})
    assert _failures(contract, runtime) == []

    runtime = _json_response({"anyOf": [{"type": "null"}, base]})
    assert _failures(contract, runtime) == []

    contract = _json_response({"oneOf": [{"type": "string"}, {"type": "string"}]})
    runtime = _json_response({"oneOf": [{"type": "string"}]})
    assert any(item["kind"] == "schema_drift" for item in _failures(contract, runtime))

    object_schema = {"type": "object", "properties": {"name": {"type": "string"}}}
    contract = _json_response({"anyOf": [object_schema, {"type": "null"}]})
    runtime = _json_response(
        {"type": ["object", "null"], "properties": object_schema["properties"]}
    )
    assert _failures(contract, runtime) == []


def test_additional_properties_default_matches_true() -> None:
    contract = _json_response({"type": "object"})
    runtime = _json_response({"type": "object", "additionalProperties": True})
    assert _failures(contract, runtime) == []


def test_all_of_with_closed_branches_is_not_unsafely_flattened() -> None:
    contract = _json_response(
        {
            "allOf": [
                {
                    "type": "object",
                    "properties": {"left": {"type": "string"}},
                    "additionalProperties": False,
                },
                {
                    "type": "object",
                    "properties": {"right": {"type": "string"}},
                    "additionalProperties": False,
                },
            ]
        }
    )
    runtime = _json_response(
        {
            "type": "object",
            "properties": {
                "left": {"type": "string"},
                "right": {"type": "string"},
            },
            "additionalProperties": False,
        }
    )
    assert any(item["kind"] == "schema_drift" for item in _failures(contract, runtime))

    contract = _json_response({"allOf": [{"properties": {"x": {"type": "string"}}}]})
    runtime = _json_response(
        {"type": "object", "properties": {"x": {"type": "string"}}}
    )
    assert any(item["kind"] == "schema_drift" for item in _failures(contract, runtime))


def test_schema_ref_machine_siblings_and_recursive_refs_are_safe() -> None:
    contract = _json_response(
        {"$ref": "#/components/schemas/Base", "maxLength": 5, "description": "ignored"}
    )
    contract["components"] = {
        "schemas": {
            "Base": {"type": "string", "minLength": 1},
            "Node": {
                "type": "object",
                "properties": {"next": {"$ref": "#/components/schemas/Node"}},
            },
        }
    }
    runtime = _json_response({"type": "string", "minLength": 1, "maxLength": 5})
    runtime["components"] = deepcopy(contract["components"])
    assert _failures(contract, runtime) == []

    node = contract["components"]["schemas"]["Node"]
    contract = _json_response({"$ref": "#/components/schemas/Node"})
    contract["components"] = {"schemas": {"Node": node}}
    runtime = deepcopy(contract)
    assert _failures(contract, runtime) == []

    node = {
        "type": "object",
        "properties": {"next": {"$ref": "#/components/schemas/Node"}},
    }
    contract = _json_response({"$ref": "#/components/schemas/AliasA"})
    contract["components"] = {
        "schemas": {
            "AliasA": {"$ref": "#/components/schemas/AliasB"},
            "AliasB": {"$ref": "#/components/schemas/Node"},
            "Node": node,
        }
    }
    runtime = _json_response({"$ref": "#/components/schemas/Node"})
    runtime["components"] = {"schemas": {"Node": node}}
    assert _failures(contract, runtime) == []

    contract = _json_response({"$ref": "#/components/schemas/AliasA"})
    contract["components"] = {
        "schemas": {
            "AliasA": {"$ref": "#/components/schemas/AliasB"},
            "AliasB": {"$ref": "#/components/schemas/AliasA"},
        }
    }
    failures = _failures(contract, deepcopy(contract))
    assert {item["direction"] for item in failures} == {
        "invalid_in_contract",
        "invalid_in_runtime",
    }

    contract = _json_response(
        {"$ref": "#/components/schemas/Base", "maxLength": 10}
    )
    contract["components"] = {"schemas": {"Base": {"type": "string", "maxLength": 5}}}
    runtime = _json_response({"type": "string", "maxLength": 10})
    assert any(item["kind"] == "schema_drift" for item in _failures(contract, runtime))

    contract = _json_response(
        {"$ref": "#/components/schemas/Base", "properties": {"y": {"type": "string"}}}
    )
    contract["components"] = {
        "schemas": {
            "Base": {"type": "object", "properties": {"x": {"type": "string"}}}
        }
    }
    runtime = _json_response(
        {
            "type": "object",
            "properties": {"x": {"type": "string"}, "y": {"type": "string"}},
        }
    )
    assert _failures(contract, runtime) == []


def test_outer_constraints_are_preserved_when_normalizing_compositions() -> None:
    contract = _json_response(
        {
            "type": "object",
            "properties": {"outer": {"type": "string"}},
            "allOf": [{"type": "object", "properties": {"inner": {"type": "string"}}}],
        }
    )
    runtime = _json_response({"type": "object", "properties": {"inner": {"type": "string"}}})
    assert any(item["kind"] == "schema_drift" for item in _failures(contract, runtime))

    contract = _json_response(
        {
            "maxLength": 3,
            "anyOf": [{"type": "string", "maxLength": 5}, {"type": "null"}],
        }
    )
    runtime = _json_response({"type": ["string", "null"], "maxLength": 5})
    assert any(item["kind"] == "schema_drift" for item in _failures(contract, runtime))

    contract = _json_response(
        {
            "properties": {"x": {"type": "string"}},
            "anyOf": [
                {"type": "object", "properties": {"y": {"type": "string"}}},
                {"type": "null"},
            ],
        }
    )
    runtime = _json_response(
        {
            "type": ["object", "null"],
            "properties": {"x": {"type": "string"}, "y": {"type": "string"}},
        }
    )
    assert _failures(contract, runtime) == []

    contract = _json_response(
        {"type": "object", "properties": {"nested": {"properties": {"name": {"type": "string"}}}}}
    )
    runtime = deepcopy(contract)
    runtime["paths"]["/items/{id}"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]["properties"]["nested"]["properties"]["name"] = {"type": "integer"}
    failures = _failures(contract, runtime)
    assert any(
        item["pointer"].endswith("/properties/nested/properties/name/type")
        for item in failures
    )


def test_response_refs_links_and_body_presence_are_fail_closed() -> None:
    contract = _document({"$ref": "#/components/responses/Outer"})
    contract["components"] = {
        "responses": {
            "Outer": {"$ref": "#/components/responses/Inner"},
            "Inner": {"description": "ok"},
        }
    }
    runtime = _document({"description": "different prose"})
    assert _failures(contract, runtime) == []

    contract = _document({"$ref": "#/components/responses/Ok", "summary": "summary"})
    contract["components"] = {"responses": {"Ok": {"description": "ok"}}}
    runtime = _document({"description": "ok"})
    assert _failures(contract, runtime) == []

    contract = _document(
        {
            "description": "ok",
            "headers": {"X-Trace": {"$ref": "#/components/headers/Trace", "summary": "s"}},
        }
    )
    contract["components"] = {"headers": {"Trace": {"schema": {"type": "string"}}}}
    runtime = _document(
        {"description": "ok", "headers": {"X-Trace": {"schema": {"type": "string"}}}}
    )
    assert _failures(contract, runtime) == []

    contract = _document({"type": "string"})
    runtime = _document({"type": "string"})
    failures = _failures(contract, runtime)
    assert failures[0]["kind"] == "unsupported"
    assert failures[0]["direction"] == "invalid_in_contract"
    assert failures[1]["direction"] == "invalid_in_runtime"

    contract = _document({"$ref": "#/components/responses/Outer"})
    contract["components"] = {
        "responses": {
            "Outer": {"$ref": "#/components/responses/Inner"},
            "Inner": {"$ref": "#/components/responses/Outer"},
        }
    }
    failures = _failures(contract, _document())
    assert failures[0]["kind"] == "unsupported"
    assert failures[0]["direction"] == "invalid_in_contract"

    contract = _document({"description": "ok", "links": {}})
    runtime = _document({"description": "ok", "links": {}})
    failures = _failures(contract, runtime)
    assert any(item["kind"] == "unsupported" for item in failures)

    contract = _document({"description": "ok", "content": {"application/json": {}}})
    runtime = _document(
        {"description": "ok", "content": {"application/json": {"schema": {}}}}
    )
    failures = _failures(contract, runtime)
    assert any(item["kind"] == "schema_presence" for item in failures)

    assert _failures(_document(), _document({"description": "ok", "content": {}})) == []

    contract = _document({"description": "ok", "content": None})
    failures = _failures(contract, _document({"description": "ok"}))
    assert failures[0]["kind"] == "invalid_content"
    assert failures[0]["direction"] == "invalid_in_contract"


@pytest.mark.parametrize("status", ["2000", "020", "default ", "1xx", "6XX", "000"])
def test_invalid_status_direction_is_explicit(status: str) -> None:
    contract = _document()
    contract["paths"]["/items/{id}"]["get"]["responses"] = {status: {"description": "bad"}}
    failures = _failures(contract, _document())
    invalid = [item for item in failures if item["kind"] == "invalid_status"]
    assert invalid and invalid[0]["direction"] == "invalid_in_contract"


def test_valid_default_ranges_are_independent_and_no_body_statuses_are_checked() -> None:
    statuses = {str(code): {"description": "ok"} for code in (200, 205, 304)}
    statuses.update({"default": {"description": "fallback"}, "1XX": {"description": "info"}})
    contract = _document()
    contract["paths"]["/items/{id}"]["get"]["responses"] = statuses
    runtime = deepcopy(contract)
    assert _failures(contract, runtime) == []
    for status in ("1XX", "205", "304"):
        runtime["paths"]["/items/{id}"]["get"]["responses"][status]["content"] = {
            "application/json": {"schema": {}}
        }
    failures = _failures(contract, runtime)
    assert {"invalid_no_body"}.issubset({item["kind"] for item in failures})


def test_header_inline_and_ref_forms_are_equivalent_and_null_is_invalid() -> None:
    inline = {"schema": {"type": "string"}}
    contract = _document({"description": "ok", "headers": {"X-Trace": inline}})
    runtime = _document(
        {"description": "ok", "headers": {"X-Trace": {"$ref": "#/components/headers/Trace"}}}
    )
    runtime["components"] = {"headers": {"Trace": inline}}
    assert _failures(contract, runtime) == []

    contract = _document({"description": "ok", "headers": {"X-Trace": {"content": None}}})
    failures = _failures(contract, deepcopy(contract))
    assert {item["direction"] for item in failures} == {
        "invalid_in_contract",
        "invalid_in_runtime",
    }

    contract = _document({"description": "ok", "headers": None})
    failures = _failures(contract, _document({"description": "ok"}))
    assert failures[0]["kind"] == "unsupported"
    assert failures[0]["direction"] == "invalid_in_contract"
    failures = _failures(_document({"description": "ok"}), contract)
    assert failures[0]["direction"] == "invalid_in_runtime"


def test_object_projection_intersects_explicit_types() -> None:
    contract = _json_response(
        {
            "$ref": "#/components/schemas/Base",
            "type": ["object", "null"],
            "properties": {"y": {"type": "string"}},
        }
    )
    contract["components"] = {
        "schemas": {"Base": {"type": "object", "properties": {"x": {"type": "string"}}}}
    }
    runtime = _json_response(
        {
            "type": ["object", "null"],
            "properties": {"x": {"type": "string"}, "y": {"type": "string"}},
        }
    )
    failures = _failures(contract, runtime)
    assert any(item["kind"] == "schema_drift" for item in failures)

    contract = _json_response(
        {
            "$ref": "#/components/schemas/Base",
            "type": "object",
            "properties": {"y": {"type": "string"}},
        }
    )
    contract["components"] = {
        "schemas": {"Base": {"type": "object", "properties": {"x": {"type": "string"}}}}
    }
    assert _failures(
        contract,
        _json_response(
            {"type": "object", "properties": {"x": {"type": "string"}, "y": {"type": "string"}}}
        ),
    ) == []

    contract = _json_response(
        {
            "$ref": "#/components/schemas/Base",
            "properties": {"y": {"type": "string"}},
        }
    )
    contract["components"] = {
        "schemas": {
            "Base": {
                "type": "object",
                "properties": {"x": {"type": "string"}},
                "additionalProperties": False,
            }
        }
    }
    runtime = _json_response(
        {
            "type": "object",
            "properties": {"x": {"type": "string"}, "y": {"type": "string"}},
            "additionalProperties": False,
        }
    )
    assert any(item["kind"] == "schema_drift" for item in _failures(contract, runtime))

    contract = _json_response(
        {
            "properties": {"x": {"type": "string"}},
            "anyOf": [
                {
                    "type": "object",
                    "properties": {"y": {"type": "string"}},
                    "additionalProperties": False,
                },
                {"type": "null"},
            ],
        }
    )
    runtime = _json_response(
        {
            "type": ["object", "null"],
            "properties": {"x": {"type": "string"}, "y": {"type": "string"}},
            "additionalProperties": False,
        }
    )
    assert any(item["kind"] == "schema_drift" for item in _failures(contract, runtime))


def test_recursive_shape_mutation_and_failure_order_are_deterministic() -> None:
    node = {
        "type": "object",
        "properties": {"next": {"$ref": "#/components/schemas/Node"}},
    }
    contract = _json_response({"$ref": "#/components/schemas/Node"})
    contract["components"] = {"schemas": {"Node": node}}
    runtime = deepcopy(contract)
    runtime["components"]["schemas"]["Node"]["properties"]["next"] = {"type": "integer"}
    failures = _failures(contract, runtime)
    assert any(item["kind"] == "schema_drift" for item in failures)

    contract = _document()
    contract["paths"]["/items/{id}"]["get"]["responses"] = {
        "404": {"description": "not found"},
        "200": {"description": "ok"},
    }
    runtime = deepcopy(contract)
    runtime["paths"]["/items/{id}"]["get"]["responses"]["200"]["headers"] = {
        "X-Trace": {"schema": {"type": "string"}}
    }
    pointers = [item["pointer"] for item in _failures(contract, runtime)]
    assert pointers == sorted(pointers)


def test_productive_recursive_aliases_are_bisimilar_across_hops() -> None:
    alias_node = {
        "type": "object",
        "properties": {"next": {"$ref": "#/components/schemas/Alias"}},
    }
    contract = _json_response({"$ref": "#/components/schemas/Alias"})
    contract["components"] = {
        "schemas": {
            "Alias": {"$ref": "#/components/schemas/Node"},
            "Node": alias_node,
        }
    }
    direct_node = {
        "type": "object",
        "properties": {"next": {"$ref": "#/components/schemas/Node"}},
    }
    runtime = _json_response({"$ref": "#/components/schemas/Node"})
    runtime["components"] = {"schemas": {"Node": direct_node}}
    assert _failures(contract, runtime) == []

    contract = _json_response({"$ref": "#/components/schemas/A"})
    contract["components"] = {
        "schemas": {
            "A": {"type": "array", "items": {"$ref": "#/components/schemas/A"}},
        }
    }
    runtime = _json_response({"$ref": "#/components/schemas/A"})
    runtime["components"] = {
        "schemas": {
            "A": {"type": "array", "items": {"$ref": "#/components/schemas/B"}},
            "B": {
                "type": "object",
                "properties": {"next": {"$ref": "#/components/schemas/B"}},
            },
        }
    }
    assert any(item["kind"] == "schema_drift" for item in _failures(contract, runtime))

    # 相似的浅层 shape 不能在单侧提前折叠：有限 A→B→string 链不等于自递归 Node。
    contract = _json_response({"$ref": "#/components/schemas/A"})
    contract["components"] = {
        "schemas": {
            "A": {
                "type": "object",
                "properties": {"next": {"$ref": "#/components/schemas/B"}},
            },
            "B": {
                "type": "object",
                "properties": {"next": {"$ref": "#/components/schemas/C"}},
            },
            "C": {"type": "string"},
        }
    }
    runtime = _json_response({"$ref": "#/components/schemas/Node"})
    runtime["components"] = {"schemas": {"Node": direct_node}}
    assert any(item["kind"] == "schema_drift" for item in _failures(contract, runtime))

    contract = _json_response({"$ref": "#/components/schemas/A"})
    contract["components"] = {
        "schemas": {
            "A": {"type": "object", "properties": {"next": {"$ref": "#/components/schemas/B"}}},
            "B": {"type": "object", "properties": {"next": {"$ref": "#/components/schemas/A"}}},
        }
    }
    runtime = _json_response({"$ref": "#/components/schemas/Node"})
    runtime["components"] = {"schemas": {"Node": direct_node}}
    assert _failures(contract, runtime) == []


def test_schema_ref_failure_retains_terminal_target_diagnostics() -> None:
    contract = _json_response({"$ref": "#/components/schemas/Foo"})
    contract["components"] = {
        "schemas": {
            "Foo": {"$ref": "#/components/schemas/Bar"},
            "Bar": {"type": "object", "properties": {"x": {"type": "string"}}},
        }
    }
    runtime = _json_response({"type": "object", "properties": {"x": {"type": "integer"}}})
    failures = _failures(contract, runtime)
    drift = next(item for item in failures if item["kind"] == "schema_drift")
    assert drift["contract_target"] == "#/components/schemas/Bar"
    assert drift["runtime_target"] is None

def test_const_and_enum_are_conjunctive_and_comparator_is_pure() -> None:
    contract = _json_response({"const": "x", "enum": ["x", "y"]})
    runtime = _json_response({"enum": ["x"]})
    original = deepcopy(contract)
    assert _failures(contract, runtime) == []
    assert contract == original

    contract = _json_response({"const": "x", "enum": ["y"]})
    assert any(item["kind"] == "schema_drift" for item in _failures(contract, runtime))


@pytest.mark.parametrize(
    "header",
    [
        {"allowEmptyValue": True, "schema": {"type": "string"}},
        {"allowReserved": True, "schema": {"type": "string"}},
        {"style": "form", "schema": {"type": "string"}},
        {"required": "yes", "schema": {"type": "string"}},
    ],
)
def test_header_unsupported_fields_and_types_fail_closed(header: dict[str, Any]) -> None:
    response = {"description": "ok", "headers": {"X-Trace": header}}
    failures = _failures(_document(response), _document(response))
    assert any(item["kind"] == "unsupported" for item in failures)
    assert any(item["direction"] == "invalid_in_contract" for item in failures)


def test_media_parameters_are_not_case_folded_into_equivalence() -> None:
    response = {
        "description": "ok",
        "content": {"text/plain; charset=UTF-8": {"schema": {"type": "string"}}},
    }
    failures = _failures(_document(response), _document(response))
    assert any(item["kind"] == "invalid_content" for item in failures)


@pytest.mark.parametrize("token", ["-1", "+1", "01", "-"])
def test_json_pointer_rejects_noncanonical_array_indices(token: str) -> None:
    contract = _json_response({"$ref": f"#/components/schemas/Items/{token}"})
    contract["components"] = {"schemas": {"Items": [{"type": "string"}]}}
    failures = _failures(contract, _json_response({"type": "string"}))
    assert failures[0]["kind"] == "unsupported"


def test_paths_extensions_are_ignored_regardless_of_value_shape() -> None:
    contract = _document()
    runtime = deepcopy(contract)
    contract["paths"]["x-primitive"] = "extension value"
    contract["paths"]["x-object"] = {"nested": ["extension", {"value": True}]}
    runtime["paths"]["x-primitive"] = ["a different extension value"]
    runtime["paths"]["x-object"] = {"different": {"extension": None}}
    assert compare_response_contracts(contract, runtime) == []


@pytest.mark.parametrize("method", ["head", "options", "trace"])
def test_default_check_reports_contract_only_extended_http_operation(
    method: str, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    contract = _operation_document(method)
    failures = _structured_failures(
        _check_document(tmp_path, monkeypatch, contract, {"openapi": "3.1.0", "paths": {}})
    )
    expected_operation = {**contract["paths"]["/probe"][method], "parameters": []}

    assert failures == [
        {
            "contract": expected_operation,
            "direction": "missing_in_runtime",
            "kind": "missing_operation",
            "message": "operation 仅存在于 contract",
            "pointer": f"/paths/~1probe/{method}",
            "runtime": None,
        }
    ]


@pytest.mark.parametrize("method", ["head", "options", "trace"])
def test_default_check_reports_runtime_only_extended_http_operation(
    method: str, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = _operation_document(method)
    failures = _structured_failures(
        _check_document(tmp_path, monkeypatch, {"openapi": "3.1.0", "paths": {}}, runtime)
    )
    expected_operation = {**runtime["paths"]["/probe"][method], "parameters": []}

    assert failures == [
        {
            "contract": None,
            "direction": "missing_in_contract",
            "kind": "extra_operation",
            "message": "operation 仅存在于 runtime",
            "pointer": f"/paths/~1probe/{method}",
            "runtime": expected_operation,
        }
    ]


def test_default_check_ignores_path_item_metadata_and_merges_shared_parameters(
    tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    contract = _operation_document("get")
    contract["paths"]["/probe"].update(
        {
            "summary": "合同摘要",
            "description": "合同描述",
            "servers": [{"url": "https://contract.example"}],
            "parameters": [
                {
                    "name": "X-Trace",
                    "in": "header",
                    "required": True,
                    "schema": {"type": "string"},
                }
            ],
        }
    )
    runtime = deepcopy(contract)
    runtime["paths"]["/probe"].update(
        {
            "summary": "运行时摘要",
            "description": "运行时描述",
            "servers": [{"url": "https://runtime.example"}],
        }
    )
    runtime["paths"]["/probe"]["parameters"][0]["required"] = False

    failures = _check_document(tmp_path, monkeypatch, contract, runtime)

    assert failures == ["('/probe', 'get') 参数 ('X-Trace', 'header') required 漂移"]


@pytest.mark.parametrize(
    "mutation",
    [
        "missing_non_2xx",
        "extra_status",
        "second_success",
        "error_schema",
        "media",
        "request_id_header",
        "unsupported_links",
    ],
)
def test_default_check_catches_complete_response_mutations(
    mutation: str, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    contract = _default_gate_document()
    runtime = deepcopy(contract)
    operation = runtime["paths"]["/items/{id}"]["get"]
    expected_kind: str
    expected_pointer: str
    expected_direction: str
    if mutation == "missing_non_2xx":
        del operation["responses"]["404"]
        expected_kind = "missing_status"
        expected_pointer = "/paths/~1items~1{id}/get/responses/404"
        expected_direction = "missing_in_runtime"
    elif mutation == "extra_status":
        operation["responses"]["409"] = {"description": "conflict"}
        expected_kind = "extra_status"
        expected_pointer = "/paths/~1items~1{id}/get/responses/409"
        expected_direction = "missing_in_contract"
    elif mutation == "second_success":
        success_response = {
            "description": "created",
            "content": {"application/json": {"schema": {"type": "string"}}},
        }
        contract["paths"]["/items/{id}"]["get"]["responses"]["201"] = success_response
        operation["responses"]["201"] = deepcopy(success_response)
        operation["responses"]["201"]["content"]["application/json"]["schema"] = {
            "type": "integer"
        }
        expected_kind = "schema_drift"
        expected_pointer = (
            "/paths/~1items~1{id}/get/responses/201/content/application~1json/schema/type"
        )
        expected_direction = "different"
    elif mutation == "error_schema":
        operation["responses"]["404"]["content"]["application/json"]["schema"]["properties"][
            "code"
        ] = {"type": "integer"}
        expected_kind = "schema_drift"
        expected_pointer = (
            "/paths/~1items~1{id}/get/responses/404/content/application~1json/schema/"
            "properties/code/type"
        )
        expected_direction = "different"
    elif mutation == "media":
        operation["responses"]["200"]["content"] = {
            "text/plain": {"schema": {"type": "string"}}
        }
        expected_kind = "missing_media"
        expected_pointer = "/paths/~1items~1{id}/get/responses/200/content/application~1json"
        expected_direction = "missing_in_runtime"
    elif mutation == "request_id_header":
        operation["responses"]["200"]["headers"]["X-Request-ID"]["required"] = False
        expected_kind = "header_drift"
        expected_pointer = "/paths/~1items~1{id}/get/responses/200/headers/x-request-id"
        expected_direction = "different"
    else:
        operation["responses"]["200"]["links"] = {}
        expected_kind = "unsupported"
        expected_pointer = "/paths/~1items~1{id}/get/responses/200"
        expected_direction = "different"

    failures = _structured_failures(_check_document(tmp_path, monkeypatch, contract, runtime))
    matching = [item for item in failures if item["kind"] == expected_kind]
    assert matching
    assert any(
        item["pointer"] == expected_pointer and item["direction"] == expected_direction
        for item in matching
    )


def test_default_check_catches_csv_content_disposition_header_mutation(
    tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    contract = _csv_document()
    runtime = deepcopy(contract)
    runtime["paths"]["/items/{id}"]["get"]["responses"]["200"]["headers"][
        "Content-Disposition"
    ]["required"] = False

    failures = _structured_failures(_check_document(tmp_path, monkeypatch, contract, runtime))
    assert any(
        item["kind"] == "header_drift"
        and item["pointer"] == "/paths/~1items~1{id}/get/responses/200/headers/content-disposition"
        and item["direction"] == "different"
        for item in failures
    )


def test_default_check_uses_comparator_once_and_owns_operation_drift(
    tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.tools.contract_check as checker
    from app.main import app

    contract = _default_gate_document()
    runtime = deepcopy(contract)
    del runtime["paths"]["/items/{id}"]
    path = tmp_path / "contract.json"
    path.write_text(json.dumps(contract), encoding="utf-8")
    monkeypatch.setattr(app, "openapi", lambda: deepcopy(runtime))
    original = checker.compare_response_contracts
    calls = 0

    def counted_compare(left: dict[str, Any], right: dict[str, Any]) -> list[dict[str, Any]]:
        nonlocal calls
        calls += 1
        return original(left, right)

    monkeypatch.setattr(checker, "compare_response_contracts", counted_compare)
    failures = check(path)
    assert calls == 1
    assert any(json.loads(item)["kind"] == "missing_operation" for item in failures)
    assert not any(item.startswith("路径漂移:") for item in failures)


def test_cli_default_gate_positional_path_invalid_document_and_default_gate(
    tmp_path: Any, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from app.main import app

    valid = tmp_path / "contract.json"
    valid.write_text('{"openapi":"3.1.0","paths":{}}', encoding="utf-8")
    monkeypatch.setattr(app, "openapi", lambda: {"openapi": "3.1.0", "paths": {}})
    monkeypatch.setattr(sys, "argv", ["contract_check", str(valid)])
    main()
    assert "完整契约一致" in capsys.readouterr().out

    drift = tmp_path / "drift.json"
    drift.write_text(
        '{"openapi":"3.1.0","paths":{"/x":{"get":{"responses":{"200":{"description":"ok"}}}}}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(
        app,
        "openapi",
        lambda: {
            "openapi": "3.1.0",
            "paths": {
                "/x": {
                    "get": {
                        "responses": {
                            "200": {"description": "ok"},
                            "201": {"description": "created"},
                        }
                    }
                }
            },
        },
    )
    monkeypatch.setattr(sys, "argv", ["contract_check", str(drift)])
    with pytest.raises(SystemExit) as drift_exit:
        main()
    assert drift_exit.value.code == 1
    assert '"kind":"extra_status"' in capsys.readouterr().err

    unsupported = tmp_path / "unsupported.json"
    unsupported.write_text(
        '{"openapi":"3.1.0","paths":{"/x":{"get":{"responses":{"200":{"description":"ok","content":{"application/json":{"schema":{"future":true}}}}}}}}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(
        app,
        "openapi",
        lambda: {
            "openapi": "3.1.0",
            "paths": {
                "/x": {
                    "get": {
                        "responses": {
                            "200": {
                                "description": "ok",
                                "content": {
                                    "application/json": {"schema": {"future": True}}
                                },
                            }
                        }
                    }
                }
            },
        },
    )
    monkeypatch.setattr(sys, "argv", ["contract_check", str(unsupported)])
    with pytest.raises(SystemExit) as unsupported_exit:
        main()
    assert unsupported_exit.value.code == 1
    assert "unsupported" in capsys.readouterr().err

    invalid = tmp_path / "invalid.json"
    invalid.write_text('{"openapi":"3.1.0"}', encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["contract_check", str(invalid)])
    with pytest.raises(SystemExit) as invalid_exit:
        main()
    assert invalid_exit.value.code == 2
    assert "contract-check error" in capsys.readouterr().err

    malformed = tmp_path / "malformed.yaml"
    malformed.write_text("[unterminated", encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["contract_check", str(malformed)])
    with pytest.raises(SystemExit) as malformed_exit:
        main()
    assert malformed_exit.value.code == 2


@pytest.mark.parametrize(
    "document",
    [
        {"openapi": "3.1.0", "paths": {"items": {}}},
        {"openapi": "3.1.0", "paths": {"/x": None}},
        {"openapi": "3.1.0", "paths": {}, "components": []},
    ],
)
def test_cli_rejects_uninterpretable_document_sections(
    document: dict[str, Any],
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    from app.main import app

    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    monkeypatch.setattr(app, "openapi", lambda: {"openapi": "3.1.0", "paths": {}})
    monkeypatch.setattr(sys, "argv", ["contract_check", str(path)])
    with pytest.raises(SystemExit) as exit_info:
        main()
    assert exit_info.value.code == 2
    assert capsys.readouterr().err.startswith("contract-check error: ")


def test_status_collision_reports_the_invalid_document_side() -> None:
    contract = _document()
    contract["paths"]["/items/{id}"]["get"]["responses"] = {
        200: {"description": "first"},
        "200": {"description": "second"},
    }
    failures = _failures(contract, _document())
    collision = [item for item in failures if item["kind"] == "status_collision"]
    assert collision
    assert collision[0]["direction"] == "invalid_in_contract"

    runtime = _document()
    runtime["paths"]["/items/{id}"]["get"]["responses"] = {
        200: {"description": "first"},
        "200": {"description": "second"},
    }
    collision = [
        item for item in _failures(_document(), runtime) if item["kind"] == "status_collision"
    ]
    assert collision[0]["direction"] == "invalid_in_runtime"


def test_schema_constraints_and_header_ref_chain_are_compared() -> None:
    response = {
        "description": "ok",
        "headers": {"X-Trace": {"$ref": "#/components/headers/Outer"}},
    }
    contract = _document(response)
    contract["components"] = {
        "headers": {
            "Outer": {"$ref": "#/components/headers/Inner"},
            "Inner": {"schema": {"type": "string", "minLength": 2}},
        }
    }
    runtime = deepcopy(contract)
    runtime["components"]["headers"]["Inner"]["schema"]["minLength"] = 3
    failures = _failures(contract, runtime)
    assert any(item["kind"] == "header_drift" for item in failures)


@pytest.mark.parametrize(
    "parameter_kind",
    ["path", "query", "header", "cookie", "body"],
)
def test_fastapi_auto_422_covers_all_request_parameter_kinds(parameter_kind: str) -> None:
    app = FastAPI()
    if parameter_kind == "path":

        @app.get("/items/{item_id}")
        def read_path(item_id: int) -> dict[str, int]:
            return {"item_id": item_id}

        path = "/items/not-an-int"
    elif parameter_kind == "query":

        @app.get("/items")
        def read_query(limit: int = Query(...)) -> dict[str, int]:
            return {"limit": limit}

        path = "/items?limit=not-an-int"
    elif parameter_kind == "header":

        @app.get("/items")
        def read_header(token: int = Header(...)) -> dict[str, int]:
            return {"token": token}

        path = "/items"
    elif parameter_kind == "cookie":

        from fastapi import Cookie

        @app.get("/items")
        def read_cookie(token: int = Cookie(...)) -> dict[str, int]:
            return {"token": token}

        path = "/items"
    else:

        @app.post("/items")
        def read_body(item: _ItemPayload) -> dict[str, str]:
            return {"name": item.name}

        path = "/items"
    before = deepcopy(app.openapi())
    with TestClient(app) as client:
        response = client.get(path) if parameter_kind != "body" else client.post(path, json={})
    assert response.status_code == 422
    assert app.openapi() == before
    assert "422" in before["paths"][next(iter(before["paths"]))][
        "post" if parameter_kind == "body" else "get"
    ]["responses"]


@pytest.mark.parametrize(
    ("responses", "expected"),
    [
        ({"422": {"description": "explicit"}}, {"422"}),
        ({"4XX": {"description": "range"}}, {"4XX"}),
        ({"default": {"description": "fallback"}}, {"default"}),
    ],
)
def test_fastapi_explicit_validation_responses_suppress_auto_422(
    responses: dict[str, Any], expected: set[str]
) -> None:
    app = FastAPI()

    @app.get("/items", responses=responses)
    def read_item(limit: int = Query(...)) -> dict[str, int]:
        return {"limit": limit}

    operation = app.openapi()["paths"]["/items"]["get"]
    assert set(operation["responses"]) == {"200", *expected}
    if "422" in expected:
        assert operation["responses"]["422"]["description"] == "explicit"


def test_custom_validation_handler_does_not_change_openapi_metadata() -> None:
    app = FastAPI()

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_, __) -> JSONResponse:
        return JSONResponse({"error": "invalid"}, status_code=422)

    @app.get("/items/{item_id}")
    def read_item(item_id: int) -> dict[str, int]:
        return {"item_id": item_id}

    before = deepcopy(app.openapi())
    with TestClient(app) as client:
        response = client.get("/items/not-an-int")
    assert response.status_code == 422
    assert response.json() == {"error": "invalid"}
    assert app.openapi() == before


def test_bad_ref_unknown_machine_field_and_header_collision_fail_closed() -> None:
    contract = _json_response({"$ref": "#/components/schemas/Missing"})
    runtime = _json_response({"type": "string"})
    assert any(item["kind"] == "unsupported" for item in _failures(contract, runtime))

    contract = _json_response({"type": "string", "futureMachineFlag": True})
    assert any(item["kind"] == "unsupported" for item in _failures(contract, deepcopy(contract)))

    response = {
        "description": "ok",
        "headers": {
            "X-ID": {"schema": {"type": "string"}},
            "x-id": {"schema": {"type": "string"}},
        },
    }
    contract = _document(response)
    assert any(item["kind"] == "unsupported" for item in _failures(contract, deepcopy(contract)))
