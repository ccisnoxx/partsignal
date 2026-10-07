"""GEO-104 隔离 PostgreSQL、真实会话及有界并发测试支持。"""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.db import get_db
from app.main import app
from app.models.geo_catalog import GeoSubject
from app.models.identity import SessionRecord, User
from app.models.product_facts import Product
from app.security import hash_token
from tests.integration.test_migrations import run_alembic, temporary_database

PREFIX = "/api/v1/geo/subjects"
CSRF = "geo104-fake-csrf-token-at-least-32-bytes"


@dataclass
class CatalogAPI:
    engine: Engine
    factory: sessionmaker[Session]
    admin_id: UUID
    engineer_id: UUID
    product_id: UUID
    admin: TestClient
    engineer: TestClient

    def create(self, **values: object) -> dict:
        response = self.admin.post(
            PREFIX,
            json={
                "subject_type": "COMPETITOR_PRODUCT",
                "canonical_name": "虚构 CP-104",
                "display_name": "虚构竞品",
                **values,
            },
        )
        assert response.status_code == 201, response.text
        return response.json()


@pytest.fixture(scope="module")
def catalog_engine() -> Iterator[Engine]:
    with temporary_database("partsignal_geo104") as (url, env, backend_dir):
        run_alembic(env, backend_dir, "head")
        engine = create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1))
        try:
            yield engine
        finally:
            engine.dispose()


@pytest.fixture
def catalog_api(catalog_engine: Engine) -> Iterator[CatalogAPI]:
    factory = sessionmaker(bind=catalog_engine, expire_on_commit=False)
    with factory() as db:
        # 清理仅发生在本套件创建的隔离数据库；保留追加式审计。
        db.execute(text("DELETE FROM geo_subjects WHERE parent_subject_id IS NOT NULL"))
        db.execute(text("DELETE FROM geo_subjects"))
        db.execute(text("DELETE FROM products"))
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
        product = Product(
            part_number="PS-104",
            normalized_part_number="ps104",
            brand="虚构品牌",
            normalized_brand="虚构品牌",
            category="虚构类别",
            status="ACTIVE",
        )
        db.add_all([admin, engineer, product])
        db.flush()
        tokens = [f"geo104-session-{user.id}" for user in (admin, engineer)]
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
        ids = admin.id, engineer.id, product.id

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
            yield CatalogAPI(catalog_engine, factory, *ids, admin_client, engineer_client)
    finally:
        app.dependency_overrides.pop(get_db, None)


def actor(db: Session, api: CatalogAPI) -> User:
    user = db.get(User, api.admin_id)
    assert user is not None
    return user


def subject(db: Session, subject_id: str) -> GeoSubject:
    value = db.get(GeoSubject, UUID(subject_id), populate_existing=True)
    assert value is not None
    return value


def catalog_state(api: CatalogAPI, subject_id: str) -> tuple:
    """失败原子性：完整聚合与其成功审计的数据库快照。"""
    with api.factory() as db:
        return tuple(
            db.execute(
                text(
                    "SELECT to_jsonb(s), "
                    "(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM geo_subject_aliases a "
                    "WHERE a.subject_id=s.id), "
                    "(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM geo_subject_domains d "
                    "WHERE d.subject_id=s.id), "
                    "(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM audit_logs l "
                    "WHERE l.target_id=CAST(s.id AS text)) "
                    "FROM geo_subjects s WHERE s.id=:id"
                ),
                {"id": subject_id},
            ).one()
        )
