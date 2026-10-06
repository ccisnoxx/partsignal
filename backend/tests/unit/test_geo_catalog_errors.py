"""Catalog 约束错误的公共分类必须同时匹配 SQLSTATE 和约束名。"""

from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.geo_catalog import GeoSubject
from app.services import geo_catalog as catalog


def database_error(state: str | None, constraint: str | None) -> IntegrityError:
    original = Exception("uq_geo_subjects_active_own_product 23505")
    original.sqlstate = state  # type: ignore[attr-defined]
    original.diag = SimpleNamespace(constraint_name=constraint)  # type: ignore[attr-defined]
    return IntegrityError("test-only SQL", {}, original)


def invoke(kind: str, db: Session) -> None:
    if kind in {"subject", "delete"}:
        catalog._flush_subject(
            db, GeoSubject(id=uuid4(), product_id=uuid4()), deleting=kind == "delete"
        )
    elif kind == "alias":
        catalog._flush_alias(db)
    else:
        catalog._flush_domain(db)


@pytest.mark.parametrize(
    ("kind", "state", "constraint", "code"),
    [
        ("subject", "23505", "uq_geo_subjects_active_own_product", "GEO_SUBJECT_PRODUCT_EXISTS"),
        ("subject", "23514", "ck_geo_subjects_parent_type", "GEO_SUBJECT_PARENT_INVALID"),
        ("subject", "23514", "ck_geo_subjects_parent_not_self", "GEO_SUBJECT_PARENT_INVALID"),
        ("delete", "23503", "fk_geo_subjects_parent_identity", "GEO_SUBJECT_IN_USE"),
        ("alias", "23505", "uq_geo_subject_aliases_subject_normalized", "GEO_SUBJECT_ALIAS_EXISTS"),
        ("domain", "23505", "uq_geo_subject_domains_subject_hostname", "GEO_SUBJECT_DOMAIN_EXISTS"),
    ],
)
def test_exact_constraint_pair_maps_to_business_conflict(
    kind: str, state: str, constraint: str, code: str
) -> None:
    db = Mock(spec=Session)
    db.flush.side_effect = database_error(state, constraint)
    with pytest.raises(AppError) as caught:
        invoke(kind, db)
    assert (caught.value.status_code, caught.value.code) == (409, code)


@pytest.mark.parametrize(
    ("kind", "state", "constraint"),
    [
        ("subject", "23503", "uq_geo_subjects_active_own_product"),
        ("subject", "23505", "uq_unrelated"),
        ("subject", None, "uq_geo_subjects_active_own_product"),
        ("subject", "23505", None),
        ("delete", "23505", "uq_geo_subjects_active_own_product"),
        ("delete", "23503", "fk_unrelated"),
        ("alias", "23514", "uq_geo_subject_aliases_subject_normalized"),
        ("domain", "23505", "uq_geo_subject_aliases_subject_normalized"),
    ],
)
def test_unknown_diagnostics_and_other_command_constraints_are_not_mapped(
    kind: str, state: str | None, constraint: str | None
) -> None:
    original = database_error(state, constraint)
    db = Mock(spec=Session)
    db.flush.side_effect = original
    with pytest.raises(IntegrityError) as caught:
        invoke(kind, db)
    assert caught.value is original
