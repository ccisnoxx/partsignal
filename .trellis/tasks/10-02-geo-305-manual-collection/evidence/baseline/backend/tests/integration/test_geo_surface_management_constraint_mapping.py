"""GEO-205 用真实 PostgreSQL diagnostics 证明命令 mapper 与 unknown 回滚边界。"""

from uuid import UUID

import pytest
from pydantic import TypeAdapter
from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError

from app.errors import AppError
from app.models.geo_surfaces import GeoEngineSurface
from app.schemas.geo_surfaces import GeoCollectionProfileCreate, GeoEngineSurfaceCreate
from app.services import geo_surface_commands as commands
from tests.integration.geo_surface_management_support import SurfaceAPI, actor
from tests.integration.geo_surface_management_support import surface_api as surface_api
from tests.integration.geo_surface_management_support import surface_engine as surface_engine
from tests.integration.test_geo_surface_management_transactions import (
    api_registry,
    model_binding,
    state,
)
from tests.unit.test_geo_surface_contract import profile_payload, surface_payload

pytestmark = pytest.mark.integration


def test_unique_mapper_preserves_real_sqlstate_constraint_and_session_reuse(
    surface_api: SurfaceAPI,
) -> None:
    api = surface_api
    row = api.surface()
    payload = GeoEngineSurfaceCreate.model_validate(surface_payload(slug=row["summary"]["slug"]))
    with api.factory() as db:
        with pytest.raises(AppError) as caught:
            commands.create_surface(
                db=db, actor=actor(db, api), payload=payload, request_id="geo205-real-unique"
            )
        cause = caught.value.__cause__
        assert isinstance(cause, IntegrityError)
        assert cause.orig.sqlstate == "23505"
        assert cause.orig.diag.constraint_name == "uq_geo_engine_surfaces_slug"
        assert db.execute(text("SELECT 1")).scalar_one() == 1
    profile = api.profile(row)
    payload = TypeAdapter(GeoCollectionProfileCreate).validate_python(
        profile_payload(
            engine_surface_id=row["summary"]["id"],
        )
    )
    with api.factory() as db:
        with pytest.raises(AppError) as caught:
            commands.create_profile(
                db=db,
                actor=actor(db, api),
                payload=payload,
                request_id="geo205-real-profile-unique",
            )
        cause = caught.value.__cause__
        assert isinstance(cause, IntegrityError)
        assert cause.orig.sqlstate == "23505"
        assert cause.orig.diag.constraint_name == "uq_geo_collection_profiles_surface_name"
    assert state(api, "geo_collection_profiles", profile["summary"]["id"])[0]["revision"] == 0


def test_real_model_fk_and_surface_history_are_final_guards(
    surface_api: SurfaceAPI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = surface_api
    api_registry(monkeypatch)
    _, model = model_binding(api)
    other_channel, _ = model_binding(api)
    surface = api.surface()
    payload = TypeAdapter(GeoCollectionProfileCreate).validate_python(
        profile_payload(
            "API",
            engine_surface_id=surface["summary"]["id"],
            adapter_key="test-api",
            ai_channel_id=other_channel,
            ai_model_id=model,
        )
    )
    # 测试专用旁路只绕过友好预检；真实 FK 仍是最终归属权威。
    monkeypatch.setattr(commands, "lock_bindings", lambda *args: {(other_channel, model)})
    with api.factory() as db, pytest.raises(AppError) as caught:
        commands.create_profile(
            db=db, actor=actor(db, api), payload=payload, request_id="geo205-real-fk"
        )
    assert caught.value.code == "GEO_MODEL_BINDING_INVALID"
    cause = caught.value.__cause__
    assert isinstance(cause, IntegrityError) and cause.orig.sqlstate == "23503"
    assert cause.orig.diag.constraint_name == "fk_geo_collection_profiles_model_channel"
    sid = UUID(surface["summary"]["id"])
    with api.factory() as db:
        db.execute(
            text(
                "UPDATE geo_engine_surfaces SET first_referenced_at=now(), "
                "revision=revision+1, "
                "updated_at=greatest(clock_timestamp(),updated_at) WHERE id=:id"
            ),
            {"id": sid},
        )
        db.commit()
    monkeypatch.setattr(commands, "surface_deletion", lambda *args: [])
    with api.factory() as db, pytest.raises(AppError) as caught:
        commands.delete_surface(
            db=db,
            actor=actor(db, api),
            surface_id=sid,
            expected_revision=1,
            request_id="geo205-real-history",
        )
    cause = caught.value.__cause__
    assert isinstance(cause, IntegrityError) and cause.orig.sqlstate == "23514"
    assert cause.orig.diag.constraint_name == "ck_geo_engine_surfaces_history"
    assert state(api, "geo_engine_surfaces", str(sid))[0]["first_referenced_at"] is not None


def test_unknown_business_check_remains_integrity_failure_and_rolls_back(
    surface_api: SurfaceAPI,
) -> None:
    api = surface_api
    payload = GeoEngineSurfaceCreate.model_validate(surface_payload())

    def violate_check(mapper, connection, surface):
        surface.surface_kind = "UNKNOWN"

    event.listen(GeoEngineSurface, "before_insert", violate_check)
    try:
        with api.factory() as db:
            with pytest.raises(IntegrityError) as caught:
                commands.create_surface(
                    db=db,
                    actor=actor(db, api),
                    payload=payload,
                    request_id="geo205-unknown-check",
                )
            assert caught.value.orig.sqlstate == "23514"
            assert caught.value.orig.diag.constraint_name == "ck_geo_engine_surfaces_kind"
            assert db.execute(text("SELECT 1")).scalar_one() == 1
            assert (
                db.execute(
                    text("SELECT count(*) FROM audit_logs WHERE request_id='geo205-unknown-check'")
                ).scalar_one()
                == 0
            )
    finally:
        event.remove(GeoEngineSurface, "before_insert", violate_check)
