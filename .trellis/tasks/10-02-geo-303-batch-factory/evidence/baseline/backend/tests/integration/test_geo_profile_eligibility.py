"""真实 PostgreSQL 当前资格投影；无 provider、HTTP 或配置写命令。"""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import Engine, create_engine, event, select
from sqlalchemy.orm import Session

from app.collectors.registry import (
    ProfileBlockerCode,
    collector_registry,
)
from app.config import Settings
from app.errors import AppError
from app.models.ai_generation import AIChannel, AIModel
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.models.identity import User
from app.services.geo_collection_profiles import profile_eligibility
from tests.integration.test_migrations import run_alembic, temporary_database
from tests.unit.test_geo_collector_registry import registration

pytestmark = pytest.mark.integration
CONFIGURATION = Settings(
    _env_file=None,
    APP_ENV="test",
    GEO_MONITORING_ENABLED=True,
    GEO_API_COLLECTION_ENABLED=True,
    GEO_BROWSER_COLLECTION_ENABLED=False,
    GEO_OPPORTUNITY_EVALUATION_ENABLED=False,
)


@pytest.fixture(scope="module")
def eligibility_engine() -> Iterator[Engine]:
    with temporary_database("partsignal_geo204") as (url, env, backend_dir):
        run_alembic(env, backend_dir, "head")
        engine = create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1))
        try:
            yield engine
        finally:
            engine.dispose()


@dataclass
class ProfileRows:
    db: Session
    surface: GeoEngineSurface
    profile: GeoCollectionProfile
    channel: AIChannel
    model: AIModel


@pytest.fixture
def rows(eligibility_engine: Engine) -> Iterator[ProfileRows]:
    with Session(eligibility_engine) as db:
        user = User(
            username=f"geo204-{uuid4()}",
            display_name="虚构管理员",
            password_hash="unused",
            account_type="ADMIN",
            is_active=True,
            must_change_password=False,
            revision=0,
        )
        db.add(user)
        db.flush()
        channel = AIChannel(
            name="虚构渠道",
            description="不请求外部平台",
            protocol_type="openai-compatible-chat-completions",
            provider_brand="CUSTOM",
            base_url="https://example.com",
            api_key_ciphertext="fictional-ciphertext-marker",
            api_key_updated_at=datetime.now(UTC),
            timeout_seconds=30,
            is_enabled=True,
            revision=0,
            created_by=user.id,
        )
        db.add(channel)
        db.flush()
        model = AIModel(
            channel_id=channel.id,
            display_name="虚构模型",
            model_id="fictional-model",
            request_parameters={},
            is_enabled=True,
            test_status="PASSED",
            last_tested_at=datetime.now(UTC),
            revision=0,
            created_by=user.id,
        )
        surface = GeoEngineSurface(
            name="虚构观测面",
            slug=f"test-{uuid4().hex}",
            surface_kind="MODEL_API",
            provider_brand="CUSTOM",
            compliance_status="APPROVED",
            capabilities={
                "answer_text": True,
                "citations": False,
                "web_search_signal": False,
                "model_version": True,
                "usage": True,
                "cost": False,
            },
            is_active=True,
            revision=0,
            created_by=user.id,
        )
        db.add_all([model, surface])
        db.flush()
        profile = GeoCollectionProfile(
            engine_surface_id=surface.id,
            name="虚构配置",
            collection_mode="API",
            adapter_key="test-api",
            ai_channel_id=channel.id,
            ai_model_id=model.id,
            language_code="zh-hans",
            region_code="CN",
            login_state="NOT_APPLICABLE",
            web_search_policy="UNKNOWN",
            settings_json={},
            is_active=True,
            last_test_status="PASSED",
            last_tested_at=datetime.now(UTC),
            revision=0,
            created_by=user.id,
        )
        db.add(profile)
        db.flush()
        try:
            yield ProfileRows(db, surface, profile, channel, model)
        finally:
            db.rollback()


def qualified(rows: ProfileRows):
    from app.collectors.registry import CollectorRegistry

    return profile_eligibility(
        rows.db,
        rows.profile.id,
        configuration=CONFIGURATION,
        registry=CollectorRegistry(
            [
                registration(model_protocol="openai-compatible-chat-completions"),
                registration(key="test-adapter-only"),
            ]
        ),
    )


@pytest.mark.parametrize("deleted", ["model", "channel"])
def test_current_deleted_binding_rejects_old_passed_and_cached_orm(
    rows: ProfileRows,
    deleted: str,
) -> None:
    assert qualified(rows).eligible
    old_model, old_channel = rows.profile.ai_model_id, rows.profile.ai_channel_id
    rows.db.delete(getattr(rows, deleted))
    rows.db.flush()
    # DB 的成对 SET NULL 不会更新旧实例；必须用列投影重读，而不是复用 PASSED。
    assert rows.profile.ai_model_id == old_model and rows.profile.ai_channel_id == old_channel
    result = qualified(rows)
    assert {b.code for b in result.blockers} == {ProfileBlockerCode.MODEL_BINDING_REQUIRED}
    assert result.profile_revision == 0
    current = rows.db.execute(
        select(
            GeoCollectionProfile.ai_model_id,
            GeoCollectionProfile.ai_channel_id,
            GeoCollectionProfile.last_test_status,
        ).where(GeoCollectionProfile.id == rows.profile.id)
    ).one()
    assert current == (None, None, "PASSED")


def test_current_columns_ignore_dirty_cache_do_not_autoflush_or_load_secrets(
    rows: ProfileRows,
) -> None:
    queries: list[str] = []

    def collect(conn, cursor, statement, parameters, context, executemany):
        queries.append(statement)

    event.listen(rows.db.bind, "before_cursor_execute", collect)
    try:
        rows.profile.adapter_key = "unsaved-adapter"
        rows.profile.is_active = False
        rows.channel.is_enabled = False
        assert qualified(rows).eligible
    finally:
        event.remove(rows.db.bind, "before_cursor_execute", collect)
    assert len(queries) == 1 and queries[0].lstrip().startswith("SELECT")
    assert "ai_channel_headers" not in queries[0]
    assert "base_url" not in queries[0] and "request_parameters" not in queries[0]
    assert "api_key_ciphertext !=" in queries[0]
    result = qualified(rows)
    assert "fictional-ciphertext-marker" not in repr(result)
    assert rows.profile in rows.db.dirty and rows.channel in rows.db.dirty


def test_current_disabled_model_is_a_blocker_even_if_cached_model_is_enabled(
    rows: ProfileRows,
) -> None:
    from sqlalchemy import text

    rows.db.execute(
        text("UPDATE ai_models SET is_enabled=false WHERE id=:id"), {"id": rows.model.id}
    )
    assert rows.model.is_enabled
    result = qualified(rows)
    assert {b.code for b in result.blockers} == {ProfileBlockerCode.MODEL_DISABLED}


def test_default_registry_does_not_recognize_test_metadata_and_missing_profile_is_404(
    rows: ProfileRows,
) -> None:
    result = profile_eligibility(
        rows.db, rows.profile.id, configuration=CONFIGURATION, registry=collector_registry
    )
    assert {b.code for b in result.blockers} == {ProfileBlockerCode.ADAPTER_UNKNOWN}
    with pytest.raises(AppError) as missing:
        profile_eligibility(rows.db, uuid4(), configuration=CONFIGURATION)
    assert missing.value.code == "NOT_FOUND" and missing.value.status_code == 404
