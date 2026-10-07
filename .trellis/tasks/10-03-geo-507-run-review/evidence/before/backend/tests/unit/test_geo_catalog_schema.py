"""Catalog 请求合同、Unicode 规范化和严格 IDNA 边界。"""

from copy import deepcopy
from typing import Any
from uuid import UUID

import pytest
from jsonschema import Draft202012Validator
from pydantic import TypeAdapter, ValidationError

from app.schemas import geo_catalog
from app.schemas.geo_catalog import (
    GeoSubjectAliasCreate,
    GeoSubjectAliasUpdate,
    GeoSubjectCreate,
    GeoSubjectDomainCreate,
    GeoSubjectUpdate,
)
from app.services.geo_catalog_normalization import catalog_text_key, normalize_catalog_text

PRODUCT_ID = UUID(int=103)
CREATE = TypeAdapter(GeoSubjectCreate)
UPDATE = TypeAdapter(GeoSubjectUpdate)


@pytest.mark.parametrize(
    "kind",
    [
        "OWN_BRAND",
        "OWN_PRODUCT",
        "COMPETITOR_BRAND",
        "COMPETITOR_PRODUCT",
        "REFERENCE_PART",
    ],
)
def test_create_discriminator_and_fact_boundary(kind: str) -> None:
    payload = {"subject_type": kind}
    payload.update(
        {"product_id": str(PRODUCT_ID)}
        if kind == "OWN_PRODUCT"
        else {
            "canonical_name": "  ＰＳ-１０３\u2003A  ",
            "display_name": "虚构监测对象",
        }
    )
    parsed = CREATE.validate_python(payload)
    if kind != "OWN_PRODUCT":
        assert parsed.canonical_name == "PS-103 A"
    for key in ["created_by", "revision", "normalized_name", "facts_body_markdown", "is_active"]:
        with pytest.raises(ValidationError):
            CREATE.validate_python(payload | {key: "客户端值"})
    if kind == "OWN_PRODUCT":
        for key in ["canonical_name", "display_name", "brand", "category", "part_number"]:
            with pytest.raises(ValidationError):
                CREATE.validate_python(payload | {key: "产品事实副本"})
    else:
        with pytest.raises(ValidationError):
            CREATE.validate_python(payload | {"product_id": str(PRODUCT_ID)})


def test_unknown_type_and_root_parent_are_rejected() -> None:
    for kind in ["UNKNOWN", "own_product", None]:
        with pytest.raises(ValidationError):
            CREATE.validate_python({"subject_type": kind, "product_id": str(PRODUCT_ID)})
    for kind in ["OWN_BRAND", "COMPETITOR_BRAND", "REFERENCE_PART"]:
        with pytest.raises(ValidationError):
            CREATE.validate_python(
                {
                    "subject_type": kind,
                    "canonical_name": "虚构",
                    "display_name": "虚构",
                    "parent_subject_id": str(PRODUCT_ID),
                }
            )


def test_normalization_preserves_model_boundaries_and_checks_expansion() -> None:
    assert normalize_catalog_text("\u3000 Ａ-１０３\t\n后缀 \u00a0") == "A-103 后缀"
    assert catalog_text_key(" ＳＴＲＡＳＳＥ ") == catalog_text_key("Straße")
    assert len({catalog_text_key(s) for s in ["PS-103", "PS103", "PS-103A", "PS-103 A"]}) == 4
    assert normalize_catalog_text("ß" * 240) == "ß" * 240
    for value in ["\u2003\t\n", "x" * 241, "ß" * 121, "\ufdfa" * 20]:
        with pytest.raises(ValueError):
            catalog_text_key(value)
    with pytest.raises(ValidationError):
        GeoSubjectAliasCreate(expected_revision=0, alias="ß" * 121, alias_kind="NAME")


@pytest.mark.parametrize("kind", ["OWN_PRODUCT", "COMPETITOR_PRODUCT", "OWN_BRAND"])
def test_patch_omission_null_and_nonnullable_fields(kind: str) -> None:
    base = {"subject_type": kind, "expected_revision": 4}
    with pytest.raises(ValidationError):
        UPDATE.validate_python(base)
    patch = UPDATE.validate_python(base | {"description": ""})
    assert patch.model_dump(exclude_unset=True) == base | {"description": ""}
    cleared = UPDATE.validate_python(base | {"parent_subject_id": None})
    assert cleared.model_dump(exclude_unset=True) == base | {"parent_subject_id": None}
    for key in (
        ["description"]
        if kind == "OWN_PRODUCT"
        else ["description", "canonical_name", "display_name"]
    ):
        with pytest.raises(ValidationError):
            UPDATE.validate_python(base | {key: None})
    for revision in [-1, True, "4", None]:
        with pytest.raises(ValidationError):
            UPDATE.validate_python(base | {"description": "新用途", "expected_revision": revision})
    with pytest.raises(ValidationError):
        UPDATE.validate_python(base | {"description": "新用途", "product_id": str(PRODUCT_ID)})


def test_alias_patch_and_language_are_explicit() -> None:
    create = GeoSubjectAliasCreate(
        expected_revision=0,
        alias="  ＰＳ-１０３  ",
        alias_kind="PART_NUMBER",
        language_code="ZH-Hans",
    )
    assert (create.alias, create.language_code) == ("PS-103", "zh-hans")
    patch = GeoSubjectAliasUpdate(expected_revision=1, language_code=None)
    assert patch.model_dump(exclude_unset=True) == {"expected_revision": 1, "language_code": None}
    for payload in [
        {},
        {"alias": None},
        {"alias_kind": None},
        {"is_active": None},
        {"is_active": "false"},
        {"language_code": " zh"},
        {"language_code": "z"},
        {"language_code": "zh_ Hans"},
        {"alias_kind": "EXACT"},
    ]:
        with pytest.raises(ValidationError):
            GeoSubjectAliasUpdate.model_validate({"expected_revision": 0} | payload)


@pytest.mark.parametrize(
    "value,expected",
    [
        ("EXAMPLE.test", "example.test"),
        ("例子.测试", "xn--fsqu00a.xn--0zwm56d"),
        ("faß.example", "xn--fa-hia.example"),
        ("ＥＸＡＭＰＬＥ。test", "example.test"),
        ("xn--fa-hia.example", "xn--fa-hia.example"),
        ("a" * 63 + ".test", "a" * 63 + ".test"),
    ],
)
def test_idna2008_nontransitional(value: str, expected: str) -> None:
    parsed = GeoSubjectDomainCreate(expected_revision=0, hostname=value, relation_type="OWNED")
    assert parsed.hostname == expected


@pytest.mark.parametrize(
    "value",
    [
        "127.0.0.1",
        "１２７。０。０。１",
        "[::1]",
        "::1",
        "https://example.test",
        "a.test/path",
        "a.test?query",
        "a.test#hash",
        "a.test:443",
        "a@b.test",
        "*.test",
        "a\\b.test",
        " example.test",
        "example.test\n",
        "example.test.",
        "example。test。",
        "a..test",
        "-a.test",
        "a-.test",
        "a_b.test",
        "localhost",
        "xn--.test",
        "xn--a.test",
        "a" * 64 + ".test",
        ".test",
        "a.\u200dtest",
        "😀.test",
        "אa.test",
        ".".join(["é" * 57] * 4),
    ],
)
def test_invalid_hostname_fails_at_request_boundary(value: str) -> None:
    with pytest.raises(ValidationError):
        GeoSubjectDomainCreate(expected_revision=0, hostname=value, relation_type="OFFICIAL")


def test_runtime_requests_dump_to_accepted_public_contract(document: dict[str, Any]) -> None:
    from tests.unit.test_geo_catalog_contract import valid

    cases = [
        (
            "GeoSubjectCreate",
            CREATE.validate_python({"subject_type": "OWN_PRODUCT", "product_id": str(PRODUCT_ID)}),
        ),
        (
            "GeoSubjectUpdate",
            UPDATE.validate_python(
                {
                    "subject_type": "COMPETITOR_PRODUCT",
                    "expected_revision": 0,
                    "parent_subject_id": None,
                }
            ),
        ),
        (
            "GeoSubjectAliasCreate",
            GeoSubjectAliasCreate(
                expected_revision=0, alias="虚构型号", alias_kind="NAME", language_code="ZH-Hans"
            ),
        ),
        ("GeoSubjectAliasUpdate", GeoSubjectAliasUpdate(expected_revision=1, is_active=False)),
        (
            "GeoSubjectDomainCreate",
            GeoSubjectDomainCreate(
                expected_revision=1, hostname="例子.测试", relation_type="OTHER"
            ),
        ),
    ]
    for name, model in cases:
        wire = model.model_dump(mode="json", exclude_unset=True)
        assert valid(document, name, wire)
        generated = TypeAdapter(getattr(geo_catalog, name)).json_schema()
        assert Draft202012Validator(generated).is_valid(wire)


def test_generated_catalog_schemas_match_accepted_contract(document: dict[str, Any]) -> None:
    from app.tools.contract_check import compare_response_contracts

    names = [
        "GeoSubjectCreate",
        "GeoSubjectUpdate",
        "GeoSubjectRevisionRequest",
        "GeoSubjectAliasCreate",
        "GeoSubjectAliasUpdate",
        "GeoSubjectDomainCreate",
        "GeoSubjectOut",
        "GeoSubjectListPage",
        "GeoSubjectInUseDetails",
    ]
    contract = {"paths": {}, "components": document["components"]}
    runtime: dict[str, Any] = {"paths": {}, "components": {"schemas": {}}}
    for name in names:
        schema = TypeAdapter(getattr(geo_catalog, name)).json_schema(
            ref_template="#/components/schemas/{model}"
        )
        runtime["components"]["schemas"].update(schema.pop("$defs", {}))
        runtime["components"]["schemas"][name] = schema
        # 只构造内存合同对照，不注册 Router 或增加真实操作。
        operation = {
            "get": {
                "responses": {
                    "200": {
                        "description": "Catalog Schema 对照",
                        "content": {
                            "application/json": {"schema": {"$ref": f"#/components/schemas/{name}"}}
                        },
                    }
                }
            }
        }
        contract["paths"][f"/{name}"] = deepcopy(operation)
        runtime["paths"][f"/{name}"] = deepcopy(operation)
    assert compare_response_contracts(contract, runtime) == []


def test_generated_schema_conditions_reject_contract_counterexamples(
    document: dict[str, Any],
) -> None:
    from tests.unit.test_geo_catalog_contract import SUBJECT_ID, subject, valid

    cases = [
        ("GeoSubjectAliasUpdate", {"expected_revision": 0}),
        ("GeoSubjectUpdate", {"subject_type": "OWN_PRODUCT", "expected_revision": 0}),
        (
            "GeoSubjectCreate",
            {
                "subject_type": "OWN_BRAND",
                "canonical_name": "虚构品牌",
                "display_name": "虚构品牌",
                "parent_subject_id": SUBJECT_ID,
            },
        ),
        ("GeoSubjectOut", subject() | {"workflow_stage": "DISABLED"}),
        ("GeoSubjectOut", subject() | {"parent_subject_id": SUBJECT_ID}),
        (
            "GeoSubjectOut",
            subject(own=True)
            | {
                "parent_subject_id": SUBJECT_ID,
                "parent": {
                    "id": SUBJECT_ID,
                    "subject_type": "COMPETITOR_BRAND",
                    "display_name": "虚构父级",
                    "is_active": True,
                },
            },
        ),
    ]
    for name, wire in cases:
        generated = TypeAdapter(getattr(geo_catalog, name)).json_schema()
        assert not valid(document, name, wire)
        assert not Draft202012Validator(generated).is_valid(wire)


@pytest.fixture(scope="module")
def document() -> dict[str, Any]:
    from pathlib import Path

    import yaml

    return yaml.safe_load(
        (Path(__file__).resolve().parents[3] / "contracts/openapi.yaml").read_text()
    )
