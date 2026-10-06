"""Catalog 父子类型、字典候选歧义和角色动作的领域合同。"""

from dataclasses import replace
from itertools import product
from uuid import UUID

import pytest

from app.errors import AppError
from app.schemas.common import AccountType
from app.schemas.geo_catalog import GeoSubjectType
from app.services.geo_catalog_policy import (
    AliasAmbiguityError,
    AliasCandidate,
    SubjectReferenceCounts,
    alias_subject_candidates,
    require_subject_identity,
    require_subject_parent,
    require_unambiguous_alias,
    subject_workflow,
)

EMPTY = SubjectReferenceCounts(0, 0, 0, 0, 0)
CHILD = UUID(int=103)
PARENT = UUID(int=104)


@pytest.mark.parametrize("kind,parent_kind", list(product(GeoSubjectType, GeoSubjectType)))
def test_parent_type_matrix(kind: GeoSubjectType, parent_kind: GeoSubjectType) -> None:
    allowed = (kind, parent_kind) in {
        (GeoSubjectType.OWN_PRODUCT, GeoSubjectType.OWN_BRAND),
        (GeoSubjectType.COMPETITOR_PRODUCT, GeoSubjectType.COMPETITOR_BRAND),
    }
    if allowed:
        require_subject_parent(kind, subject_id=CHILD, parent_id=PARENT, parent_type=parent_kind)
    else:
        with pytest.raises(AppError) as error:
            require_subject_parent(
                kind, subject_id=CHILD, parent_id=PARENT, parent_type=parent_kind
            )
        assert (error.value.code, error.value.status_code) == ("GEO_SUBJECT_PARENT_INVALID", 409)
        assert error.value.details["errors"][0]["loc"] == ["body", "parent_subject_id"]


@pytest.mark.parametrize("kind", list(GeoSubjectType))
def test_nullable_parent_and_product_identity(kind: GeoSubjectType) -> None:
    require_subject_parent(kind, subject_id=CHILD, parent_id=None, parent_type=None)
    valid_product = CHILD if kind == GeoSubjectType.OWN_PRODUCT else None
    require_subject_identity(kind, valid_product)
    with pytest.raises(ValueError):
        require_subject_identity(kind, None if valid_product else CHILD)


def test_self_parent_missing_identity_and_unknown_type_fail() -> None:
    with pytest.raises(AppError):
        require_subject_parent(
            GeoSubjectType.OWN_PRODUCT,
            subject_id=CHILD,
            parent_id=CHILD,
            parent_type=GeoSubjectType.OWN_BRAND,
        )
    for args in [
        {"parent_id": PARENT, "parent_type": None},
        {"parent_id": None, "parent_type": GeoSubjectType.OWN_BRAND},
    ]:
        with pytest.raises(ValueError):
            require_subject_parent(GeoSubjectType.OWN_PRODUCT, subject_id=CHILD, **args)
    with pytest.raises(ValueError):
        require_subject_identity("UNKNOWN", None)


def test_dictionary_ambiguity_preserves_candidates_instead_of_picking_one() -> None:
    candidates = [
        AliasCandidate(PARENT, "ＰＳ-１０３", True),
        AliasCandidate(CHILD, "ps-103", True),
        AliasCandidate(CHILD, "PS-103", True),
        AliasCandidate(UUID(int=105), "PS-103", False),
    ]
    ids = alias_subject_candidates(" PS-103 ", candidates)
    assert ids == (CHILD, PARENT)
    with pytest.raises(AliasAmbiguityError) as error:
        require_unambiguous_alias(ids)
    assert error.value.subject_ids == (CHILD, PARENT)
    assert alias_subject_candidates("PS103", candidates) == ()
    assert alias_subject_candidates("PS-103A", candidates) == ()
    require_unambiguous_alias((CHILD, CHILD))
    require_unambiguous_alias(())


@pytest.mark.parametrize("active", [True, False])
@pytest.mark.parametrize("actor", [AccountType.ADMIN, AccountType.ENGINEER])
def test_workflow_actor_and_activity(active: bool, actor: AccountType) -> None:
    result = subject_workflow(is_active=active, actor_type=actor, references=EMPTY)
    assert result.stage == ("ACTIVE" if active else "DISABLED")
    if actor == AccountType.ENGINEER:
        assert result.primary_task == "MANAGE_SUBJECT"
        assert result.actions == result.alias_actions == result.domain_actions == ()
        assert result.deletion_blockers is None
    else:
        assert result.primary_task == ("MANAGE_SUBJECT" if active else "ENABLE_SUBJECT")
        assert set(result.actions) == {
            "UPDATE",
            "DISABLE" if active else "ENABLE",
            "CREATE_ALIAS",
            "CREATE_DOMAIN",
            "DELETE",
        }
        assert result.deletion_blockers == ()
        assert set(result.alias_actions) == {"UPDATE", "DELETE"}
        assert result.domain_actions == ("DELETE",)


@pytest.mark.parametrize(
    "field,token",
    [
        ("child_subject_count", "CHILD_SUBJECT"),
        ("monitoring_plan_count", "MONITORING_PLAN"),
        ("observation_run_count", "OBSERVATION_RUN"),
        ("analysis_count", "ANALYSIS"),
        ("opportunity_count", "OPPORTUNITY"),
    ],
)
def test_each_direct_reference_blocks_delete_but_not_current_dictionary(
    field: str, token: str
) -> None:
    counts = replace(EMPTY, **{field: 2})
    result = subject_workflow(is_active=True, actor_type=AccountType.ADMIN, references=counts)
    assert result.deletion_blockers == ((token, 2),)
    assert "DELETE" not in result.actions
    assert {"CREATE_ALIAS", "CREATE_DOMAIN"} <= set(result.actions)
    assert set(result.alias_actions) == {"UPDATE", "DELETE"}
    assert result.domain_actions == ("DELETE",)


def test_unknown_role_and_invalid_reference_counts_fail() -> None:
    with pytest.raises(ValueError):
        subject_workflow(is_active=True, actor_type="UNKNOWN", references=EMPTY)
    for count in [-1, True, "1", None]:
        with pytest.raises(ValueError):
            SubjectReferenceCounts(count, 0, 0, 0, 0)
