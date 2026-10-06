"""真实 ORM 输入的显式公共投影；不查询数据库，不暴露产品事实。"""

from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
import yaml
from jsonschema import Draft202012Validator
from pydantic import TypeAdapter

from app.models.geo_catalog import GeoSubject, GeoSubjectAlias, GeoSubjectDomain
from app.models.product_facts import Product
from app.schemas.common import AccountType
from app.schemas.geo_catalog import GeoSubjectOut
from app.services.geo_catalog_policy import SubjectReferenceCounts
from app.services.geo_subjects import subject_out
from tests.unit.test_geo_catalog_contract import valid

NOW = datetime(2026, 10, 1, tzinfo=UTC)
EMPTY = SubjectReferenceCounts(0, 0, 0, 0, 0)


def subject(**patch: Any) -> GeoSubject:
    values = dict(
        id=UUID(int=103),
        subject_type="COMPETITOR_PRODUCT",
        product_id=None,
        parent_subject_id=None,
        parent_subject_type=None,
        canonical_name="CP-103",
        normalized_name="cp-103",
        display_name="虚构竞品",
        description="监测用途",
        is_active=True,
        revision=7,
        created_by=UUID(int=100),
        created_at=NOW,
        updated_at=NOW,
    )
    values.update(patch)
    return GeoSubject(**values)


@pytest.fixture(scope="module")
def document() -> dict[str, Any]:
    return yaml.safe_load(
        (Path(__file__).resolve().parents[3] / "contracts/openapi.yaml").read_text()
    )


@pytest.mark.parametrize("actor", [AccountType.ADMIN, AccountType.ENGINEER])
@pytest.mark.parametrize("active", [True, False])
def test_complete_projection_matches_contract_for_each_actor_and_stage(
    document: dict[str, Any],
    actor: AccountType,
    active: bool,
) -> None:
    row = subject(is_active=active)
    alias = GeoSubjectAlias(
        id=UUID(int=104),
        subject_id=row.id,
        alias="CP-103",
        normalized_alias="cp-103",
        alias_kind="PART_NUMBER",
        language_code=None,
        is_active=False,
        created_at=NOW,
    )
    domain = GeoSubjectDomain(
        id=UUID(int=105),
        subject_id=row.id,
        hostname="xn--fa-hia.example",
        relation_type="OFFICIAL",
        is_active=True,
        created_at=NOW,
    )
    result = subject_out(
        row,
        actor_type=actor,
        product=None,
        parent=None,
        aliases=[alias],
        domains=[domain],
        references=SubjectReferenceCounts(1, 2, 3, 4, 5),
    )
    wire = result.model_dump(mode="json")
    assert valid(document, "GeoSubjectOut", wire)
    assert Draft202012Validator(TypeAdapter(GeoSubjectOut).json_schema()).is_valid(wire)
    assert result.revision == row.revision == 7
    if actor == AccountType.ADMIN:
        assert [b.count for b in result.deletion.blockers] == [1, 2, 3, 4, 5]
        assert "DELETE" not in result.available_actions
        assert result.aliases[0].available_actions == ["UPDATE", "DELETE"]
        assert result.domains[0].available_actions == ["DELETE"]
    else:
        assert result.deletion is None
        assert (
            result.available_actions
            == result.aliases[0].available_actions
            == result.domains[0].available_actions
            == []
        )


def test_current_product_projection_never_copies_facts(document: dict[str, Any]) -> None:
    row = subject(
        subject_type="OWN_PRODUCT",
        product_id=UUID(int=106),
        canonical_name=None,
        normalized_name=None,
        display_name=None,
    )
    product = Product(
        id=row.product_id,
        part_number="PS-103",
        brand="虚构品牌",
        category="虚构类别",
        revision=2,
        facts_body_markdown="不可进入 Catalog 响应的内部事实",
    )
    first = subject_out(
        row,
        actor_type=AccountType.ADMIN,
        product=product,
        parent=None,
        aliases=[],
        domains=[],
        references=EMPTY,
    )
    assert first.canonical_name == "PS-103"
    assert first.display_name == "虚构品牌 PS-103"
    assert first.product.revision == 2
    assert valid(document, "GeoSubjectOut", first.model_dump(mode="json"))
    assert Draft202012Validator(TypeAdapter(GeoSubjectOut).json_schema()).is_valid(
        first.model_dump(mode="json")
    )
    assert "facts_body_markdown" not in first.product.model_dump()
    product.part_number = "PS-103A"
    product.revision = 3
    second = subject_out(
        row,
        actor_type=AccountType.ADMIN,
        product=product,
        parent=None,
        aliases=[],
        domains=[],
        references=EMPTY,
    )
    assert second.canonical_name == "PS-103A" and second.product.revision == 3
    assert first.canonical_name == "PS-103"
    assert row.canonical_name is row.normalized_name is row.display_name is None
    assert row.revision == second.revision == first.revision == 7
    assert valid(document, "GeoSubjectOut", second.model_dump(mode="json"))


def test_parent_disabled_is_still_legal_and_response_is_consistent(
    document: dict[str, Any],
) -> None:
    parent = subject(id=UUID(int=107), subject_type="COMPETITOR_BRAND", is_active=False)
    row = subject(parent_subject_id=parent.id, parent_subject_type=parent.subject_type)
    result = subject_out(
        row,
        actor_type=AccountType.ADMIN,
        product=None,
        parent=parent,
        aliases=[],
        domains=[],
        references=EMPTY,
    )
    assert not result.parent.is_active
    assert valid(document, "GeoSubjectOut", result.model_dump(mode="json"))


def test_projection_rejects_incomplete_or_cross_subject_inputs() -> None:
    row = subject(parent_subject_id=UUID(int=107), parent_subject_type="COMPETITOR_BRAND")
    with pytest.raises(ValueError):
        subject_out(
            row,
            actor_type=AccountType.ADMIN,
            product=None,
            parent=None,
            aliases=[],
            domains=[],
            references=EMPTY,
        )
    row = subject()
    alias = GeoSubjectAlias(subject_id=UUID(int=999))
    with pytest.raises(ValueError):
        subject_out(
            row,
            actor_type=AccountType.ADMIN,
            product=None,
            parent=None,
            aliases=[alias],
            domains=[],
            references=EMPTY,
        )
    row.subject_type = "UNKNOWN"
    with pytest.raises(ValueError):
        subject_out(
            row,
            actor_type=AccountType.ADMIN,
            product=None,
            parent=None,
            aliases=[],
            domains=[],
            references=EMPTY,
        )
