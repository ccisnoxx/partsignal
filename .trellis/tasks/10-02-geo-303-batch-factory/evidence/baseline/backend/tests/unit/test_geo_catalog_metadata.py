"""验证 Catalog 注册、事实边界与公共枚举，不以 SQLite 模拟约束。"""

import re
from pathlib import Path

import pytest
import yaml
from sqlalchemy import CheckConstraint
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable

from app import models  # noqa: F401
from app.db import Base
from app.models.geo_catalog import GeoSubject, GeoSubjectAlias, GeoSubjectDomain


def test_catalog_models_are_registered_with_single_revision_owner() -> None:
    for model in [GeoSubject, GeoSubjectAlias, GeoSubjectDomain]:
        assert Base.metadata.tables[model.__tablename__] is model.__table__
    subject = GeoSubject.__table__
    assert {"product_id", "parent_subject_id", "parent_subject_type", "revision"} <= set(
        subject.c.keys()
    )
    assert {
        "part_number",
        "brand",
        "category",
        "facts_body_markdown",
        "fact_version_id",
    }.isdisjoint(subject.c.keys())
    assert all(
        subject.c[name].nullable for name in ["canonical_name", "normalized_name", "display_name"]
    )
    for model in [GeoSubjectAlias, GeoSubjectDomain]:
        assert "revision" not in model.__table__.c
    assert subject.c.revision.onupdate is None
    assert subject.c.updated_at.onupdate is None


def test_postgresql_ddl_preserves_stable_names_and_parent_identity() -> None:
    dialect = postgresql.dialect()
    table = GeoSubject.__table__
    ddl = str(CreateTable(table).compile(dialect=dialect))
    assert (
        "CONSTRAINT fk_geo_subjects_parent_identity "
        "FOREIGN KEY(parent_subject_id, parent_subject_type)"
        in ddl
    )
    assert (
        "REFERENCES geo_subjects (id, subject_type) MATCH FULL "
        "ON DELETE RESTRICT ON UPDATE RESTRICT"
        in ddl
    )
    for model in [GeoSubject, GeoSubjectAlias, GeoSubjectDomain]:
        for constraint in model.__table__.constraints:
            assert constraint.name is not None
            assert f"ck_{model.__tablename__}_ck_" not in constraint.name
    index = next(i for i in table.indexes if i.name == "uq_geo_subjects_active_own_product")
    assert str(CreateIndex(index).compile(dialect=dialect)) == (
        "CREATE UNIQUE INDEX uq_geo_subjects_active_own_product ON geo_subjects (product_id) "
        "WHERE subject_type = 'OWN_PRODUCT' AND is_active"
    )


@pytest.mark.parametrize(
    "model,constraint_name,schema_name",
    [
        (GeoSubject, "ck_geo_subjects_type", "GeoSubjectType"),
        (GeoSubjectAlias, "ck_geo_subject_aliases_kind", "GeoSubjectAliasKind"),
        (GeoSubjectDomain, "ck_geo_subject_domains_relation", "GeoSubjectDomainRelationType"),
    ],
)
def test_persisted_enum_matches_public_catalog_contract(
    model: type[Base], constraint_name: str, schema_name: str
) -> None:
    contract = Path(__file__).resolve().parents[3] / "contracts/openapi.yaml"
    document = yaml.safe_load(contract.read_text())
    constraint = next(c for c in model.__table__.constraints if c.name == constraint_name)
    assert isinstance(constraint, CheckConstraint)
    assert set(re.findall(r"'([^']+)'", str(constraint.sqltext))) == set(
        document["components"]["schemas"][schema_name]["enum"]
    )
