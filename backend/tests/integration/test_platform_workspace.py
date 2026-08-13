"""Platform Workspace 首屏读模型的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import app.routers.configuration as configuration_routes
from app.db import get_db
from app.deps import get_current_session
from app.main import app
from app.models.configuration import PlatformProfile
from app.models.identity import User
from app.models.publication import PlatformAccount
from app.services.platform_configuration import get_platform_profile_detail
from tests.integration.test_publication_workflow import _seed_graph, temporary_database


def _statement_count(engine: Engine, platform_profile_id: uuid.UUID) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with Session(engine) as db:
            get_platform_profile_detail(db, platform_profile_id, can_manage=False)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


@pytest.mark.integration
def test_platform_workspace_detail_is_actor_aware_consistent_and_fixed_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """详情允许两类已认证用户读取，并在固定查询数内投影各自动作。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            profile = graph["profile"]
            assert isinstance(actor, User)
            assert isinstance(profile, PlatformProfile)

            engineer_detail = get_platform_profile_detail(
                db,
                profile.id,
                can_manage=False,
            )
            admin_detail = get_platform_profile_detail(
                db,
                profile.id,
                can_manage=True,
            )
            assert engineer_detail.account_summary.model_dump() == {
                "total": 1,
                "enabled": 1,
                "disabled": 0,
            }
            assert engineer_detail.reference_summary.all_time == 1
            assert [item.name for item in engineer_detail.platform_type_options] == ["技术社区"]
            assert engineer_detail.profile.available_actions == []
            assert engineer_detail.profile.deletion is None
            assert "UPDATE" in admin_detail.profile.available_actions

        sparse_count = _statement_count(engine, profile.id)
        with Session(engine) as db:
            db.add_all(
                PlatformAccount(
                    platform_profile_id=profile.id,
                    label=f"运营账号 {index}",
                    account_identifier=f"workspace-account-{index}",
                )
                for index in range(12)
            )
            db.commit()
        assert _statement_count(engine, profile.id) == sparse_count

        captured: list[tuple[str, bool]] = []
        real_query = configuration_routes.get_platform_profile_detail_query

        def inspected_query(
            db: Session,
            platform_profile_id: uuid.UUID,
            *,
            can_manage: bool,
        ) -> object:
            captured.append(
                (str(db.scalar(text("SHOW transaction_isolation"))), can_manage)
            )
            return real_query(db, platform_profile_id, can_manage=can_manage)

        monkeypatch.setattr(
            configuration_routes,
            "get_platform_profile_detail_query",
            inspected_query,
        )

        def database_session() -> Iterator[Session]:
            with Session(engine, expire_on_commit=False) as db:
                yield db

        app.dependency_overrides[get_db] = database_session
        try:
            actor.account_type = "ENGINEER"
            app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(user=actor)
            engineer_response = TestClient(app).get(
                f"/api/v1/platform-profiles/{profile.id}"
            )
            missing_response = TestClient(app).get(
                f"/api/v1/platform-profiles/{uuid.uuid4()}"
            )

            actor.account_type = "ADMIN"
            admin_response = TestClient(app).get(
                f"/api/v1/platform-profiles/{profile.id}"
            )
        finally:
            app.dependency_overrides.clear()

        assert engineer_response.status_code == 200
        assert engineer_response.json()["profile"]["available_actions"] == []
        assert missing_response.status_code == 404
        assert admin_response.status_code == 200
        assert "UPDATE" in admin_response.json()["profile"]["available_actions"]
        assert captured == [
            ("repeatable read", False),
            ("repeatable read", False),
            ("repeatable read", True),
        ]
