"""GEO-205 隔离 PostgreSQL、真实会话与无外部采集的测试支持。"""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.db import get_db
from app.main import app
from app.models.identity import SessionRecord, User
from app.security import hash_token
from tests.integration.test_migrations import run_alembic, temporary_database

SURFACES = "/api/v1/geo/engine-surfaces"
PROFILES = "/api/v1/geo/collection-profiles"
CSRF = "geo205-fake-csrf-token-at-least-32-bytes"


@dataclass
class SurfaceAPI:
    engine: Engine
    factory: sessionmaker[Session]
    admin_id: UUID
    engineer_id: UUID
    admin: TestClient
    engineer: TestClient

    def surface(self, **values: object) -> dict:
        from tests.unit.test_geo_surface_contract import surface_payload

        response = self.admin.post(
            SURFACES, json=surface_payload(slug=f"test-{uuid4().hex}", **values)
        )
        assert response.status_code == 201, response.text
        return response.json()

    def profile(self, surface: dict, mode: str = "MANUAL", **values: object) -> dict:
        from tests.unit.test_geo_surface_contract import profile_payload

        response = self.admin.post(
            PROFILES,
            json=profile_payload(mode, engine_surface_id=surface["summary"]["id"], **values),
        )
        assert response.status_code == 201, response.text
        return response.json()


@pytest.fixture(scope="module")
def surface_engine() -> Iterator[Engine]:
    with temporary_database("partsignal_geo205") as (url, env, backend_dir):
        run_alembic(env, backend_dir, "head")
        engine = create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1))
        try:
            yield engine
        finally:
            engine.dispose()


@pytest.fixture
def surface_api(surface_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[SurfaceAPI]:
    monkeypatch.setattr(settings, "geo_monitoring_enabled", True)
    factory = sessionmaker(bind=surface_engine, expire_on_commit=False)
    with factory() as db:
        admin = User(
            username=f"admin-{uuid4().hex}",
            display_name="虚构管理员",
            password_hash="unused",
            account_type="ADMIN",
            is_active=True,
            must_change_password=False,
            revision=0,
        )
        engineer = User(
            username=f"engineer-{uuid4().hex}",
            display_name="虚构工程师",
            password_hash="unused",
            account_type="ENGINEER",
            is_active=True,
            must_change_password=False,
            revision=0,
        )
        db.add_all([admin, engineer])
        db.flush()
        tokens = [f"geo205-session-{user.id}" for user in (admin, engineer)]
        for user, token in zip((admin, engineer), tokens, strict=True):
            db.add(
                SessionRecord(
                    user_id=user.id,
                    token_hash=hash_token(token),
                    csrf_hash=hash_token(CSRF),
                    expires_at=datetime.now(UTC) + timedelta(hours=1),
                )
            )
        db.commit()
        ids = admin.id, engineer.id

    def request_db() -> Iterator[Session]:
        with factory() as db:
            try:
                yield db
            except Exception:
                db.rollback()
                raise

    app.dependency_overrides[get_db] = request_db
    try:
        with (
            TestClient(app) as admin_client,
            TestClient(app) as engineer_client,
        ):
            for client, token in zip((admin_client, engineer_client), tokens, strict=True):
                client.cookies.set(settings.session_cookie_name, token)
                client.headers["X-CSRF-Token"] = CSRF
            yield SurfaceAPI(surface_engine, factory, *ids, admin_client, engineer_client)
    finally:
        app.dependency_overrides.pop(get_db, None)


def actor(db: Session, api: SurfaceAPI) -> User:
    user = db.get(User, api.admin_id)
    assert user is not None
    return user
