"""PostgreSQL16 的观测配置约束、前滚、敏感数据和真实引用生命周期。"""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from psycopg.types.json import Jsonb
from pydantic import TypeAdapter
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.errors import AppError
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.models.identity import User
from app.schemas.geo_surfaces import GeoCollectionProfileOut, GeoEngineSurfaceOut
from app.services.identity import delete_user, users_out
from tests.integration.test_geo_catalog import insert_row
from tests.integration.test_migrations import run_alembic, temporary_database
from tests.unit.test_geo_surface_contract import capabilities, profile_payload, surface_payload

pytestmark = pytest.mark.integration


@dataclass
class SurfaceDatabase:
    url: str
    env: dict[str, str]
    backend_dir: Path
    actor: UUID
    admin: UUID
    channel: UUID
    other_channel: UUID
    model: UUID
    before: list[Any]


def snapshot(connection: psycopg.Connection[Any]) -> list[Any]:
    return [
        connection.execute(f"SELECT to_jsonb(t) FROM {table} t ORDER BY id").fetchall()
        for table in [
            "users",
            "ai_channels",
            "ai_models",
            "geo_observations",
            "geo_prompt_variants",
        ]
    ]


@contextmanager
def prepared_surface_database(target_revision: str) -> Iterator[SurfaceDatabase]:
    with temporary_database("partsignal_geo203") as (url, env, backend_dir):
        run_alembic(env, backend_dir, "0045_geo_prompt_variants")
        actor, admin, channel, other, model = (uuid4() for _ in range(5))
        with psycopg.connect(url) as connection:
            for user, active in [(actor, False), (admin, True)]:
                insert_row(
                    connection,
                    "users",
                    {
                        "id": user,
                        "username": f"geo203-{user}",
                        "display_name": "虚构用户",
                        "password_hash": "not-used",
                        "account_type": "ADMIN",
                        "is_active": active,
                        "must_change_password": False,
                        "revision": 0,
                    },
                )
            for identity in [channel, other]:
                insert_row(
                    connection,
                    "ai_channels",
                    {
                        "id": identity,
                        "name": "虚构渠道",
                        "description": "测试",
                        "protocol_type": "openai-compatible-chat-completions",
                        "provider_brand": "CUSTOM",
                        "base_url": "https://example.com",
                        "api_key_ciphertext": "fictional-encrypted-marker",
                        "api_key_updated_at": datetime.now(UTC),
                        "timeout_seconds": 30,
                        "is_enabled": False,
                        "revision": 0,
                        "created_by": admin,
                    },
                )
            insert_row(
                connection,
                "ai_models",
                {
                    "id": model,
                    "channel_id": channel,
                    "display_name": "虚构模型",
                    "model_id": "fictional-model",
                    "request_parameters": Jsonb({}),
                    "is_enabled": False,
                    "test_status": "UNTESTED",
                    "revision": 0,
                    "created_by": admin,
                },
            )
            before = snapshot(connection)
        run_alembic(env, backend_dir, target_revision)
        yield SurfaceDatabase(url, env, backend_dir, actor, admin, channel, other, model, before)


@pytest.fixture(scope="module")
def surface_database() -> Iterator[SurfaceDatabase]:
    with prepared_surface_database("head") as db:
        yield db


@pytest.fixture(scope="module")
def surface_migration_database() -> Iterator[SurfaceDatabase]:
    # 历史前滚/拒绝降级只验收 0046，业务测试继续运行当前 head。
    with prepared_surface_database("0046_geo_surfaces_profiles") as db:
        yield db


@pytest.fixture
def connection(surface_database: SurfaceDatabase) -> Iterator[psycopg.Connection[Any]]:
    with psycopg.connect(surface_database.url) as connection:
        try:
            yield connection
        finally:
            connection.rollback()


def insert_surface(connection: psycopg.Connection[Any], db: SurfaceDatabase, **patch: Any) -> UUID:
    identity = uuid4()
    values = {
        "id": identity,
        "created_by": db.actor,
        **surface_payload(slug=f"fictional-{identity.hex}"),
        **patch,
    }
    if isinstance(values["capabilities"], (dict, list)):
        values["capabilities"] = Jsonb(values["capabilities"])
    insert_row(connection, "geo_engine_surfaces", values)
    return identity


def insert_profile(
    connection: psycopg.Connection[Any],
    db: SurfaceDatabase,
    surface: UUID,
    mode: str = "MANUAL",
    **patch: Any,
) -> UUID:
    identity = uuid4()
    values = {
        "id": identity,
        "created_by": db.actor,
        **profile_payload(mode, engine_surface_id=surface, name=f"配置-{identity.hex}"),
    }
    values["settings_json"] = Jsonb(values.pop("settings"))
    values.update(patch)
    if isinstance(values["settings_json"], (dict, list)):
        values["settings_json"] = Jsonb(values["settings_json"])
    insert_row(connection, "geo_collection_profiles", values)
    return identity


def test_old_head_forward_preserves_rows_metadata_and_downgrade_stops(
    surface_migration_database: SurfaceDatabase,
) -> None:
    db = surface_migration_database
    with psycopg.connect(db.url) as connection:
        assert snapshot(connection) == db.before
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0046_geo_surfaces_profiles",
        )
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://", 1))
    try:
        with engine.connect() as conn:
            context = MigrationContext.configure(
                conn,
                opts={
                    "compare_type": True,
                    # 既有 AIModel 的默认值差异不属于本次新增复合唯一键的范围。
                    "compare_server_default": lambda ctx, inspected, metadata, *rest: (
                        False if metadata.table.name == "ai_models" else None
                    ),
                    "include_object": lambda obj, name, kind, reflected, compared: (
                        (
                            kind != "table"
                            or name
                            in {"geo_engine_surfaces", "geo_collection_profiles", "ai_models"}
                        )
                        # 0046只比较当时合同；新增字段由0052/0063迁移测试核对。
                        and not (
                            kind == "column"
                            and obj.table.name == "geo_collection_profiles"
                            and name
                            in {
                                "last_test_error_code",
                                "last_test_error_summary",
                                "test_attempt_id",
                                "session_revision",
                            }
                        )
                    ),
                },
            )
            assert compare_metadata(context, Base.metadata) == []
    finally:
        engine.dispose()
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0045_geo_prompt_variants"],
        env=db.env,
        cwd=db.backend_dir,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "0046 GEO Surface/Profile 无法安全降级" in result.stdout + result.stderr
    with psycopg.connect(db.url) as connection:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0046_geo_surfaces_profiles",
        )


@pytest.mark.parametrize("mode", ["MANUAL", "API", "BROWSER"])
def test_valid_modes_defaults_and_public_response_no_secret(
    connection: psycopg.Connection[Any], surface_database: SurfaceDatabase, mode: str
) -> None:
    db = surface_database
    surface = insert_surface(connection, db)
    profile = insert_profile(connection, db, surface, mode)
    surface_row = connection.execute(
        "SELECT to_jsonb(t) FROM geo_engine_surfaces t WHERE id=%s", (surface,)
    ).fetchone()[0]
    GeoEngineSurfaceOut.model_validate(surface_row)
    row = connection.execute(
        "SELECT to_jsonb(t) FROM geo_collection_profiles t WHERE id=%s", (profile,)
    ).fetchone()[0]
    assert row["is_active"] is False and row["revision"] == 0
    assert row["last_test_status"] == "UNTESTED" and row["last_tested_at"] is None
    row["settings"] = row.pop("settings_json")
    for internal in (
        "last_test_error_code", "last_test_error_summary", "test_attempt_id", "session_revision"
    ):
        row.pop(internal)
    output = TypeAdapter(GeoCollectionProfileOut).validate_python(row).model_dump_json()
    for secret in ["fictional-encrypted-marker", "api_key", "Cookie", "headers", "session_path"]:
        assert secret not in output


@pytest.mark.parametrize(
    "mode,patch,constraint",
    [
        ("MANUAL", {"ai_channel_id": uuid4(), "ai_model_id": uuid4()}, "model_mode"),
        ("BROWSER", {"ai_channel_id": uuid4(), "ai_model_id": uuid4()}, "model_mode"),
        ("API", {"login_state": "ANONYMOUS"}, "login"),
        ("BROWSER", {"login_state": "NOT_APPLICABLE"}, "login"),
        ("MANUAL", {"adapter_key": "fictional-api"}, "adapter"),
        ("API", {"adapter_key": "UNKNOWN KEY"}, "adapter"),
        ("API", {"settings_json": {"temperature": True}}, "settings"),
        ("API", {"settings_json": {"temperature": 2.1}}, "settings"),
        ("API", {"settings_json": {"max_output_tokens": 1.0}}, "settings"),
        ("API", {"settings_json": {"max_output_tokens": 0}}, "settings"),
        ("API", {"settings_json": {"max_output_tokens": 65537}}, "settings"),
        ("MANUAL", {"settings_json": {"require_screenshot": "fake"}}, "settings"),
        ("BROWSER", {"settings_json": {"answer_timeout_seconds": 601}}, "settings"),
        ("BROWSER", {"settings_json": {"answer_timeout_seconds": None}}, "settings"),
        ("MANUAL", {"settings_json": {"api_key": "fake"}}, "settings"),
        ("API", {"settings_json": {"headers": {"Authorization": "fake"}}}, "settings"),
        ("BROWSER", {"settings_json": {"Cookie": "fake"}}, "settings"),
        ("BROWSER", {"settings_json": []}, "settings"),
        ("API", {"language_code": "ZH"}, "language"),
        ("API", {"region_code": "cn"}, "region"),
        ("API", {"web_search_policy": "AUTO"}, "search"),
        ("API", {"last_test_status": "PASSED"}, "test"),
        ("MANUAL", {"name": "\u00a0虚构"}, "name"),
    ],
)
def test_sql_rejects_invalid_combinations(
    connection: psycopg.Connection[Any],
    surface_database: SurfaceDatabase,
    mode: str,
    patch: dict[str, Any],
    constraint: str,
) -> None:
    surface = insert_surface(connection, surface_database)
    with pytest.raises(psycopg.errors.CheckViolation) as error, connection.transaction():
        insert_profile(connection, surface_database, surface, mode, **patch)
    assert error.value.diag.constraint_name == f"ck_geo_collection_profiles_{constraint}"


@pytest.mark.parametrize(
    "patch,constraint",
    [
        ({"capabilities": {**capabilities(), "api_key": False}}, "capabilities"),
        ({"capabilities": {**capabilities(), "answer_text": 1}}, "capabilities"),
        ({"capabilities": {**capabilities(), "answer_text": False}}, "capabilities"),
        ({"capabilities": {}}, "capabilities"),
        ({"capabilities": []}, "capabilities"),
        ({"compliance_status": "BLOCKED"}, "compliance"),
        ({"surface_kind": "SEARCH_PRODUCT"}, "kind"),
        ({"provider_brand": "GUESSED"}, "provider"),
        ({"website_url": "https://user:fake@example.com"}, "website"),
        ({"website_url": "https://example.com/?token=fake"}, "website"),
    ],
)
def test_sql_surface_closed_capabilities_and_enums(
    connection: psycopg.Connection[Any],
    surface_database: SurfaceDatabase,
    patch: dict[str, Any],
    constraint: str,
) -> None:
    with pytest.raises(psycopg.errors.CheckViolation) as error, connection.transaction():
        insert_surface(connection, surface_database, **patch)
    assert error.value.diag.constraint_name == f"ck_geo_engine_surfaces_{constraint}"


@pytest.mark.parametrize("patch", ["channel_only", "model_only", "wrong_channel", "missing_model"])
def test_model_pair_must_exist_and_belong_to_channel(
    connection: psycopg.Connection[Any], surface_database: SurfaceDatabase, patch: str
) -> None:
    db = surface_database
    refs = {"ai_model_id": db.model, "ai_channel_id": db.channel}
    if patch == "channel_only":
        refs["ai_model_id"] = None
    if patch == "model_only":
        refs["ai_channel_id"] = None
    if patch == "wrong_channel":
        refs["ai_channel_id"] = db.other_channel
    if patch == "missing_model":
        refs["ai_model_id"] = uuid4()
    surface = insert_surface(connection, db)
    with pytest.raises(psycopg.errors.ForeignKeyViolation) as error, connection.transaction():
        insert_profile(connection, db, surface, "API", **refs)
    assert error.value.diag.constraint_name == "fk_geo_collection_profiles_model_channel"


@pytest.mark.parametrize("delete_table", ["ai_models", "ai_channels"])
def test_ai_delete_nulls_pair_keeps_profile_and_existing_lifecycle(
    connection: psycopg.Connection[Any], surface_database: SurfaceDatabase, delete_table: str
) -> None:
    db = surface_database
    surface = insert_surface(connection, db)
    profile = insert_profile(
        connection, db, surface, "API", ai_channel_id=db.channel, ai_model_id=db.model
    )
    before = connection.execute(
        "SELECT to_jsonb(t) FROM geo_collection_profiles t WHERE id=%s", (profile,)
    ).fetchone()[0]
    connection.execute(
        f"DELETE FROM {delete_table} WHERE id=%s",
        (db.model if delete_table == "ai_models" else db.channel,),
    )
    after = connection.execute(
        "SELECT to_jsonb(t) FROM geo_collection_profiles t WHERE id=%s", (profile,)
    ).fetchone()[0]
    assert after == {**before, "ai_channel_id": None, "ai_model_id": None}


def test_surface_user_restrict_and_names_unique(
    connection: psycopg.Connection[Any], surface_database: SurfaceDatabase
) -> None:
    db = surface_database
    surface = insert_surface(connection, db, slug="unique-surface")
    insert_profile(connection, db, surface, name="唯一配置")
    for table, identity in [("geo_engine_surfaces", surface), ("users", db.actor)]:
        with pytest.raises(psycopg.errors.ForeignKeyViolation), connection.transaction():
            connection.execute(f"DELETE FROM {table} WHERE id=%s", (identity,))
    for kind in ["surface", "profile"]:
        with pytest.raises(psycopg.errors.UniqueViolation) as error, connection.transaction():
            if kind == "surface":
                insert_surface(connection, db, slug="unique-surface")
            else:
                insert_profile(connection, db, surface, name="唯一配置")
        assert error.value.diag.constraint_name == (
            "uq_geo_engine_surfaces_slug"
            if kind == "surface"
            else "uq_geo_collection_profiles_surface_name"
        )


def test_revision_identity_and_history_latch(
    connection: psycopg.Connection[Any], surface_database: SurfaceDatabase
) -> None:
    surface = insert_surface(connection, surface_database)
    profile = insert_profile(connection, surface_database, surface)
    for table, identity in [("geo_engine_surfaces", surface), ("geo_collection_profiles", profile)]:
        with pytest.raises(psycopg.errors.CheckViolation) as error, connection.transaction():
            connection.execute(f"UPDATE {table} SET name='新配置' WHERE id=%s", (identity,))
        assert error.value.diag.constraint_name == f"ck_{table}_revision_step"
        connection.execute(
            f"UPDATE {table} SET name='新配置', revision=revision+1, updated_at=now() WHERE id=%s",
            (identity,),
        )
        connection.execute(f"UPDATE {table} SET name=name WHERE id=%s", (identity,))
        with pytest.raises(psycopg.errors.CheckViolation) as error, connection.transaction():
            connection.execute(
                f"UPDATE {table} SET created_by=%s, revision=revision+1 WHERE id=%s",
                (surface_database.admin, identity),
            )
        assert error.value.diag.constraint_name == f"ck_{table}_identity"
    connection.execute(
        "UPDATE geo_engine_surfaces SET first_referenced_at=now(), revision=revision+1 WHERE id=%s",
        (surface,),
    )
    for statement in [
        "UPDATE geo_engine_surfaces SET first_referenced_at=NULL, revision=revision+1 WHERE id=%s",
        "DELETE FROM geo_engine_surfaces WHERE id=%s",
    ]:
        with pytest.raises(psycopg.errors.CheckViolation) as error, connection.transaction():
            connection.execute(statement, (surface,))
        assert error.value.diag.constraint_name == "ck_geo_engine_surfaces_history"


def test_orm_defaults_and_user_deletion_projection(surface_database: SurfaceDatabase) -> None:
    db = surface_database
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://", 1))
    try:
        with Session(engine) as session:
            surface = GeoEngineSurface(
                **{**surface_payload(slug=f"orm-{uuid4().hex}"), "created_by": db.actor}
            )
            session.add(surface)
            session.flush()
            values = profile_payload(engine_surface_id=surface.id)
            values["settings_json"] = values.pop("settings")
            profile = GeoCollectionProfile(**{**values, "created_by": db.actor})
            session.add(profile)
            session.flush()
            assert not surface.is_active and surface.revision == 0
            assert not profile.is_active and profile.revision == 0
            actor = session.get(User, db.admin)
            user = session.get(User, db.actor)
            assert actor is not None and user is not None
            projection = users_out(session, [user], actor=actor)[0]
            assert projection.deletion is not None
            assert projection.deletion.blockers[0].count == 2
            with pytest.raises(AppError) as error:
                delete_user(
                    db=session,
                    user_id=user.id,
                    expected_revision=user.revision,
                    actor=actor,
                    request_id="geo203-user-reference",
                )
            assert error.value.code == "USER_IN_USE"
    finally:
        engine.dispose()
