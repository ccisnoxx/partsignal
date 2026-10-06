"""命令局部 mapper 仅识别已冻结 SQLSTATE 与具名约束，未知失败原样上抛。"""

from types import SimpleNamespace

import pytest
from sqlalchemy.exc import IntegrityError

from app.errors import AppError
from app.services.geo_surface_commands import _flush_business


class FailingSession:
    def __init__(self, error: IntegrityError) -> None:
        self.error = error
        self.rolled_back = False

    def flush(self) -> None:
        raise self.error

    def rollback(self) -> None:
        self.rolled_back = True


def integrity(state: str | None, constraint: str | None) -> IntegrityError:
    original = Exception("数据库细节不能决定分类")
    original.sqlstate = state
    original.diag = SimpleNamespace(constraint_name=constraint)
    return IntegrityError("testing", {}, original)


@pytest.mark.parametrize(
    "state,constraint",
    [
        ("23503", "uq_geo_engine_surfaces_slug"),
        ("23514", "uq_geo_collection_profiles_surface_name"),
        ("23505", "pk_geo_engine_surfaces"),
        ("23503", "fk_geo_collection_profiles_creator"),
        ("23514", "ck_geo_engine_surfaces_revision_step"),
        (None, "uq_geo_engine_surfaces_slug"),
        ("23505", None),
    ],
)
def test_unknown_constraint_and_wrong_sqlstate_remain_original(
    state: str | None,
    constraint: str | None,
) -> None:
    original = integrity(state, constraint)
    db = FailingSession(original)
    with pytest.raises(IntegrityError) as error:
        _flush_business(db)
    assert error.value is original


@pytest.mark.parametrize(
    "state,constraint,deleting,code",
    [
        ("23505", "uq_geo_engine_surfaces_slug", False, "GEO_SURFACE_SLUG_EXISTS"),
        ("23505", "uq_geo_collection_profiles_surface_name", False, "GEO_PROFILE_NAME_EXISTS"),
        ("23503", "fk_geo_collection_profiles_model_channel", False, "GEO_MODEL_BINDING_INVALID"),
        ("23503", "fk_geo_collection_profiles_surface", True, "GEO_SURFACE_IN_USE"),
        ("23514", "ck_geo_engine_surfaces_history", True, "GEO_SURFACE_IN_USE"),
    ],
)
def test_exact_business_constraint_is_mapped_after_root_rollback(
    state: str,
    constraint: str,
    deleting: bool,
    code: str,
) -> None:
    original = integrity(state, constraint)
    db = FailingSession(original)
    with pytest.raises(AppError) as error:
        _flush_business(db, deleting_surface=deleting)
    assert error.value.code == code and error.value.__cause__ is original and db.rolled_back
