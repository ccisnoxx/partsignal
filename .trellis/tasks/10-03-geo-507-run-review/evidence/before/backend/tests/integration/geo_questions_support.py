"""GEO-202 使用专用 PostgreSQL 和真实会话，不伪造回答级运行。"""

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
from app.models.configuration import QueryTopic
from app.models.identity import SessionRecord, User
from app.security import hash_token
from tests.integration.test_migrations import run_alembic, temporary_database

PREFIX = "/api/v1/geo/prompt-variants"
CSRF = "geo202-fake-csrf-at-least-32-bytes-long"


@pytest.fixture(scope="module")
def questions_engine() -> Iterator[Engine]:
    with temporary_database("partsignal_geo202") as (url, env, backend_dir):
        run_alembic(env, backend_dir, "head")
        engine = create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1))
        try:
            yield engine
        finally:
            engine.dispose()


@dataclass
class QuestionsAPI:
    engine: Engine
    factory: sessionmaker[Session]
    topic: UUID
    admin_id: UUID
    engineer_id: UUID
    admin: TestClient
    engineer: TestClient

    def create(self, **values: object) -> dict:
        response = self.engineer.post(
            f"/api/v1/geo/query-topics/{self.topic}/prompt-variants", json=self.payload(**values)
        )
        assert response.status_code == 201, response.text
        return response.json()

    def payload(self, **values: object) -> dict:
        return {
            "query_topic_id": str(self.topic),
            "prompt_text": "虚构品牌 CP-202 有哪些替代？",
            "mention_mode": "UNBRANDED",
            "language_code": "zh-Hans",
            "region_code": "cn",
            "priority": "CORE",
            **values,
        }


@pytest.fixture
def questions_api(questions_engine: Engine) -> Iterator[QuestionsAPI]:
    factory = sessionmaker(bind=questions_engine, expire_on_commit=False)
    with factory() as db:
        users = [
            User(
                username=f"geo202-{uuid4()}",
                display_name="虚构用户",
                password_hash="unused",
                account_type=kind,
                is_active=True,
                must_change_password=False,
                revision=0,
            )
            for kind in ("ADMIN", "ENGINEER")
        ]
        topic = QueryTopic(
            canonical_question="主题 CP-202",
            intent_type="REPLACEMENT",
            variants=["旧数组不得导入"],
            revision=0,
        )
        db.add_all([*users, topic])
        db.flush()
        tokens = [f"geo202-session-{user.id}" for user in users]
        for user, token in zip(users, tokens, strict=True):
            db.add(
                SessionRecord(
                    user_id=user.id,
                    token_hash=hash_token(token),
                    csrf_hash=hash_token(CSRF),
                    expires_at=datetime.now(UTC) + timedelta(hours=1),
                )
            )
        db.commit()
        ids = topic.id, users[0].id, users[1].id

    def request_db() -> Iterator[Session]:
        with factory() as db:
            try:
                yield db
            except Exception:
                db.rollback()
                raise

    app.dependency_overrides[get_db] = request_db
    try:
        with TestClient(app) as admin, TestClient(app) as engineer:
            for client, token in zip((admin, engineer), tokens, strict=True):
                client.cookies.set(settings.session_cookie_name, token)
                client.headers["X-CSRF-Token"] = CSRF
            yield QuestionsAPI(questions_engine, factory, *ids, admin, engineer)
    finally:
        app.dependency_overrides.pop(get_db, None)
