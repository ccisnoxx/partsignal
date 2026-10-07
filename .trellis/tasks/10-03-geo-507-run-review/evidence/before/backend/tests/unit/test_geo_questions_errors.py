"""精确约束映射，未知失败保留默认服务错误边界。"""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy.exc import IntegrityError

from app.errors import AppError
from app.services.geo_prompt_variants import _flush


@pytest.mark.parametrize(
    ("state", "constraint", "deleting", "code"),
    [
        ("23505", "uq_geo_prompt_variants_identity", False, "GEO_PROMPT_VARIANT_EXISTS"),
        ("23514", "ck_geo_prompt_variants_history", True, "GEO_PROMPT_VARIANT_IN_USE"),
        ("23514", "ck_geo_prompt_variants_history", False, "GEO_PROMPT_VARIANT_IMMUTABLE"),
        ("23514", "uq_geo_prompt_variants_identity", False, None),
        ("23505", "ck_geo_prompt_variants_history", False, None),
        ("23505", "unknown_unique", False, None),
        ("23514", "ck_geo_prompt_variants_revision_step", False, None),
    ],
)
def test_business_flush_does_not_guess_error_identity(state, constraint, deleting, code):
    original = SimpleNamespace(sqlstate=state, diag=SimpleNamespace(constraint_name=constraint))
    failure = IntegrityError("not-public", None, original)
    db = Mock()
    db.flush.side_effect = failure
    if code is None:
        with pytest.raises(IntegrityError) as caught:
            _flush(db, deleting=deleting)
        assert caught.value is failure
    else:
        with pytest.raises(AppError) as caught:
            _flush(db, deleting=deleting)
        assert caught.value.code == code
        db.rollback.assert_called_once()
