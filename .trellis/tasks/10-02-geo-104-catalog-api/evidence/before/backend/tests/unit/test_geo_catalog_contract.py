"""GEO-101 的公共 Schema 实例与待接线操作合同，不伪造 Catalog runtime。"""

from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
import yaml
from jsonschema import Draft202012Validator

from app.tools.contract_check import operation_map, resolve_schema

CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
SUBJECT_ID = "00000000-0000-4000-8000-000000000101"
PRODUCT_ID = "00000000-0000-4000-8000-000000000102"
TIME = "2026-10-01T00:00:00Z"


@pytest.fixture(scope="module")
def document() -> dict[str, Any]:
    return yaml.safe_load(CONTRACT.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def valid(document: dict[str, Any], name: str, payload: object) -> bool:
    schema = {
        "$ref": f"#/components/schemas/{name}",
        "components": document["components"],
    }
    validator = Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)
    return validator.is_valid(payload)


def subject(*, own: bool = False) -> dict[str, Any]:
    value: dict[str, Any] = {
        "id": SUBJECT_ID,
        "subject_type": "COMPETITOR_PRODUCT",
        "product_id": None,
        "product": None,
        "parent_subject_id": None,
        "parent": None,
        "canonical_name": "虚构 CP-101",
        "display_name": "虚构竞品",
        "description": "监测用途说明",
        "is_active": True,
        "aliases": [],
        "domains": [],
        "references": {
            "child_subject_count": 0,
            "monitoring_plan_count": 0,
            "observation_run_count": 0,
            "analysis_count": 0,
            "opportunity_count": 0,
        },
        "workflow_stage": "ACTIVE",
        "primary_task": "MANAGE_SUBJECT",
        "available_actions": ["UPDATE", "DISABLE", "DELETE", "CREATE_ALIAS", "CREATE_DOMAIN"],
        "deletion": {"blockers": []},
        "revision": 0,
        "created_by": SUBJECT_ID,
        "created_at": TIME,
        "updated_at": TIME,
    }
    if own:
        value.update(
            subject_type="OWN_PRODUCT",
            product_id=PRODUCT_ID,
            canonical_name="PS-101",
            display_name="虚构品牌 PS-101",
            product={
                "id": PRODUCT_ID,
                "part_number": "PS-101",
                "brand": "虚构品牌",
                "category": "虚构类别",
                "revision": 3,
            },
        )
    return value


def test_catalog_schema_definitions_and_references_are_valid(document: dict[str, Any]) -> None:
    schemas = document["components"]["schemas"]
    names = [n for n in schemas if n.startswith(("GeoSubject", "GeoOwnProduct", "GeoNamed"))]
    names.append("GeoCatalogErrorCode")
    for name in names:
        Draft202012Validator.check_schema(schemas[name])

    def inspect(value: Any) -> None:
        if isinstance(value, dict):
            if "$ref" in value:
                assert value["$ref"].startswith("#/components/")
                assert resolve_schema(document, value)
            for nested in value.values():
                inspect(nested)
        elif isinstance(value, list):
            for nested in value:
                inspect(nested)

    inspect(document["x-geo-catalog-contract"])
    for name in names:
        inspect(schemas[name])


@pytest.mark.parametrize(
    "payload, expected",
    [
        ({"subject_type": "OWN_PRODUCT", "product_id": PRODUCT_ID}, True),
        ({"subject_type": "OWN_PRODUCT"}, False),
        ({"subject_type": "OWN_PRODUCT", "product_id": None}, False),
        ({"subject_type": "OWN_PRODUCT", "product_id": "invalid"}, False),
        ({"subject_type": "UNKNOWN", "product_id": PRODUCT_ID}, False),
        ({"subject_type": "OWN_PRODUCT", "product_id": PRODUCT_ID, "is_active": False}, False),
    ],
)
def test_own_product_create_binding(
    document: dict[str, Any], payload: dict[str, Any], expected: bool
) -> None:
    assert valid(document, "GeoSubjectCreate", payload) is expected


@pytest.mark.parametrize(
    "field",
    [
        "canonical_name",
        "display_name",
        "normalized_name",
        "brand",
        "category",
        "part_number",
        "facts_body_markdown",
        "fact_version_id",
        "revision",
        "created_by",
        "available_actions",
    ],
)
def test_own_product_cannot_submit_duplicate_facts_or_server_fields(
    document: dict[str, Any], field: str
) -> None:
    payload = {"subject_type": "OWN_PRODUCT", "product_id": PRODUCT_ID, field: "伪造值"}
    assert not valid(document, "GeoSubjectCreate", payload)
    update = {"subject_type": "OWN_PRODUCT", "expected_revision": 0, field: "伪造值"}
    assert not valid(document, "GeoSubjectUpdate", update)


@pytest.mark.parametrize(
    "kind", ["OWN_BRAND", "COMPETITOR_BRAND", "COMPETITOR_PRODUCT", "REFERENCE_PART"]
)
def test_named_subject_creation_and_parent_shape(document: dict[str, Any], kind: str) -> None:
    payload = {"subject_type": kind, "canonical_name": "虚构身份", "display_name": "虚构对象"}
    assert valid(document, "GeoSubjectCreate", payload)
    assert not valid(document, "GeoSubjectCreate", payload | {"product_id": PRODUCT_ID})
    assert not valid(document, "GeoSubjectCreate", payload | {"canonical_name": "  "})
    assert not valid(document, "GeoSubjectCreate", payload | {"display_name": "x" * 241})
    assert valid(document, "GeoSubjectCreate", payload | {"parent_subject_id": SUBJECT_ID}) is (
        kind == "COMPETITOR_PRODUCT"
    )


def test_patch_and_aggregate_revision_contract(document: dict[str, Any]) -> None:
    assert valid(
        document,
        "GeoSubjectUpdate",
        {
            "subject_type": "OWN_PRODUCT",
            "expected_revision": 0,
            "description": "新用途",
        },
    )
    assert not valid(
        document,
        "GeoSubjectUpdate",
        {
            "subject_type": "OWN_PRODUCT",
            "expected_revision": 0,
        },
    )
    cases = {
        "GeoSubjectRevisionRequest": {},
        "GeoSubjectAliasCreate": {"alias": "虚构型号", "alias_kind": "PART_NUMBER"},
        "GeoSubjectAliasUpdate": {"is_active": False},
        "GeoSubjectDomainCreate": {"hostname": "example.test", "relation_type": "OWNED"},
    }
    for name, payload in cases.items():
        assert valid(document, name, payload | {"expected_revision": 0})
        for revision in [None, -1, True, "0"]:
            assert not valid(document, name, payload | {"expected_revision": revision})
        assert not valid(document, name, payload)
    assert not valid(document, "GeoSubjectAliasUpdate", {"expected_revision": 0})


def test_alias_enum_language_and_domain_boundaries(document: dict[str, Any]) -> None:
    alias = {"expected_revision": 2, "alias": "虚构型號", "alias_kind": "NAME"}
    assert valid(document, "GeoSubjectAliasCreate", alias | {"language_code": "zh-Hans"})
    assert not valid(document, "GeoSubjectAliasCreate", alias | {"alias_kind": "EXACT"})
    assert not valid(document, "GeoSubjectAliasCreate", alias | {"normalized_alias": "客户端值"})
    assert not valid(document, "GeoSubjectAliasCreate", alias | {"language_code": "../zh"})
    domain = {"expected_revision": 2, "hostname": "虚构.example", "relation_type": "OFFICIAL"}
    assert valid(document, "GeoSubjectDomainCreate", domain)
    for host in ["https://example.test", "a.test:443", "*.test", "a.test/path", "a test", "x"]:
        assert not valid(document, "GeoSubjectDomainCreate", domain | {"hostname": host})
    for host in ["example.test", "xn--fsqu00a.example"]:
        assert valid(document, "GeoSubjectHostname", host)
    for host in [
        "EXAMPLE.test",
        "127.0.0.1",
        "example.test.",
        "a..test",
        "-a.test",
        "x" * 64 + ".test",
    ]:
        assert not valid(document, "GeoSubjectHostname", host)


@pytest.mark.parametrize("own", [False, True])
def test_required_projection_and_product_read_summary(document: dict[str, Any], own: bool) -> None:
    payload = subject(own=own)
    assert valid(document, "GeoSubjectOut", payload)
    for key in [
        "revision",
        "workflow_stage",
        "primary_task",
        "available_actions",
        "deletion",
        "references",
    ]:
        incomplete = deepcopy(payload)
        incomplete.pop(key)
        assert not valid(document, "GeoSubjectOut", incomplete)
    assert not valid(document, "GeoSubjectOut", payload | {"workflow_stage": "DISABLED"})
    assert not valid(document, "GeoSubjectOut", payload | {"available_actions": ["RUN_NOW"]})
    if own:
        value = deepcopy(payload)
        value["product"]["facts_body_markdown"] = "不应回显的事实正文"
        assert not valid(document, "GeoSubjectOut", value)
        assert not valid(document, "GeoSubjectOut", payload | {"product": None})
    else:
        assert not valid(document, "GeoSubjectOut", payload | {"product_id": PRODUCT_ID})


def test_deletion_projection_null_empty_and_historical_blockers(document: dict[str, Any]) -> None:
    readonly = subject() | {"available_actions": [], "deletion": None}
    blocked = subject() | {
        "available_actions": ["UPDATE", "DISABLE"],
        "deletion": {"blockers": [{"type": "OBSERVATION_RUN", "count": 1}]},
    }
    for value in [subject(), readonly, blocked]:
        assert valid(document, "GeoSubjectOut", value)
    for count in [0, -1]:
        assert not valid(
            document, "GeoSubjectDeletionBlocker", {"type": "OBSERVATION_RUN", "count": count}
        )
    assert not valid(document, "GeoSubjectDeletionBlocker", {"type": "ALIAS", "count": 1})
    assert valid(
        document, "GeoSubjectInUseDetails", {"references": blocked["deletion"]["blockers"]}
    )
    assert not valid(document, "GeoSubjectInUseDetails", {"references": []})


def test_list_pagination_and_nonnegative_total(document: dict[str, Any]) -> None:
    payload = {"items": [subject(own=True)], "page": 1, "page_size": 20, "total": 1}
    assert valid(document, "GeoSubjectListPage", payload)
    for patch in [{"total": -1}, {"page_size": 100}, {"page": 0}]:
        assert not valid(document, "GeoSubjectListPage", payload | patch)


def test_planned_operations_do_not_claim_runtime_and_preserve_security(
    document: dict[str, Any],
) -> None:
    catalog = document["x-geo-catalog-contract"]
    assert (catalog["status"], catalog["activation_task"]) == ("CONTRACT_ONLY", "GEO-104")
    operations = operation_map({"paths": catalog["paths"]})
    assert len(operations) == 12
    runtime = operation_map(document)
    assert set(runtime).isdisjoint(operations)
    assert (
        len({op["operationId"] for op in [*runtime.values(), *operations.values()]})
        == len(runtime) + 12
    )
    domain_errors = set(document["components"]["schemas"]["GeoCatalogErrorCode"]["enum"])
    seen_errors: set[str] = set()
    for (path, method), op in operations.items():
        assert op["security"] == [{"sessionCookie": []}]
        parameters = [resolve_schema(document, p) for p in op["parameters"]]
        assert any(p["name"] == "X-Request-ID" for p in parameters)
        assert "Idempotency-Key" not in [p["name"] for p in parameters]
        if method != "get":
            assert op["x-required-account-types"] == ["ADMIN"]
            assert any(p["name"] == "X-CSRF-Token" and p["required"] for p in parameters)
        if method == "delete":
            assert any(p["name"] == "expected_revision" and p["required"] for p in parameters)
        else:
            assert op["x-required-account-types"] in [["ADMIN"], ["ADMIN", "ENGINEER"]]
        for status, response in op["responses"].items():
            response = resolve_schema(document, response)
            assert response["headers"]["X-Request-ID"] == {
                "$ref": "#/components/headers/RequestIdResponseHeader"
            }
            if status == "204":
                assert path.endswith("/{subject_id}") and method == "delete"
                assert "content" not in response
            elif status.startswith("2"):
                result = response["content"]["application/json"]["schema"]["$ref"]
                assert result.endswith(
                    "GeoSubjectListPage"
                    if op["operationId"] == "listGeoSubjects"
                    else "GeoSubjectOut"
                )
        for codes in op["x-error-codes"].values():
            seen_errors.update(set(codes) & domain_errors)
    assert seen_errors == domain_errors
