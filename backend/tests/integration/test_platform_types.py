"""平台类型设置合同的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_session
from app.main import app
from app.models.configuration import PlatformProfile, PlatformType
from app.models.identity import User
from app.security import hash_token
from app.services.platform_configuration import platform_types_out
from tests.integration.test_publication_workflow import _seed_graph, temporary_database


def _projection_statement_count(engine: Engine) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with Session(engine) as db:
            items = list(
                db.scalars(
                    select(PlatformType).order_by(func.lower(PlatformType.name), PlatformType.id)
                )
            )
            platform_types_out(db, items)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


@pytest.mark.integration
def test_platform_type_api_is_admin_only_and_supports_contract_crud() -> None:
    """管理接口保留字段输入，并以 revision 和服务端 blocker 裁决删除。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            profile = graph["profile"]
            assert isinstance(actor, User)
            assert isinstance(profile, PlatformProfile)
            platform_type_id = profile.platform_type_id
            db.add(
                PlatformProfile(
                    name="停用平台",
                    slug=f"disabled-{uuid.uuid4().hex[:8]}",
                    allowed_domains=["disabled.example.invalid"],
                    platform_type_id=platform_type_id,
                    is_active=False,
                )
            )
            db.commit()

        csrf_token = "platform-type-csrf-token-over-32-characters"

        def database_session() -> Iterator[Session]:
            with Session(engine, expire_on_commit=False) as db:
                yield db

        app.dependency_overrides[get_db] = database_session
        app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
            user=actor,
            csrf_hash=hash_token(csrf_token),
        )
        client = TestClient(app)
        headers = {"X-CSRF-Token": csrf_token}
        try:
            actor.account_type = "ENGINEER"
            forbidden = [
                client.get("/api/v1/platform-types"),
                client.post(
                    "/api/v1/platform-types",
                    headers=headers,
                    json={"name": "禁止创建", "slug": "forbidden-create"},
                ),
                client.patch(
                    f"/api/v1/platform-types/{uuid.uuid4()}",
                    headers=headers,
                    json={"name": "禁止更新", "slug": "forbidden-update", "expected_revision": 0},
                ),
                client.delete(
                    f"/api/v1/platform-types/{uuid.uuid4()}",
                    headers=headers,
                    params={"expected_revision": 0},
                ),
            ]

            actor.account_type = "ADMIN"
            initial = client.get("/api/v1/platform-types")
            created = client.post(
                "/api/v1/platform-types",
                headers=headers,
                json={"name": "  Alpha  ", "slug": "alpha"},
            )
            duplicate_slug = client.post(
                "/api/v1/platform-types",
                headers=headers,
                json={"name": "其他名称", "slug": "alpha"},
            )
            same_name = client.post(
                "/api/v1/platform-types",
                headers=headers,
                json={"name": "Alpha", "slug": "alpha-second"},
            )
            blank_name = client.post(
                "/api/v1/platform-types",
                headers=headers,
                json={"name": "   ", "slug": "blank-name"},
            )
            same_name_item = same_name.json()
            duplicate_update = client.patch(
                f"/api/v1/platform-types/{same_name_item['id']}",
                headers=headers,
                json={
                    "name": "Alpha",
                    "slug": "alpha",
                    "expected_revision": same_name_item["revision"],
                },
            )
            updated = client.patch(
                f"/api/v1/platform-types/{same_name_item['id']}",
                headers=headers,
                json={
                    "name": "Alpha",
                    "slug": "alpha-renamed",
                    "expected_revision": same_name_item["revision"],
                },
            )
            current = client.get("/api/v1/platform-types")
            source = next(
                item
                for item in initial.json()["items"]
                if item["id"] == str(platform_type_id)
            )
            source_update = client.patch(
                f"/api/v1/platform-types/{platform_type_id}",
                headers=headers,
                json={
                    "name": source["name"],
                    "slug": source["slug"],
                    "expected_revision": source["revision"],
                },
            )
            stale_delete = client.delete(
                f"/api/v1/platform-types/{platform_type_id}",
                headers=headers,
                params={"expected_revision": source["revision"]},
            )
            blocked_delete = client.delete(
                f"/api/v1/platform-types/{platform_type_id}",
                headers=headers,
                params={"expected_revision": source_update.json()["revision"]},
            )
            missing_revision = client.delete(
                f"/api/v1/platform-types/{same_name_item['id']}",
                headers=headers,
            )
            deleted = client.delete(
                f"/api/v1/platform-types/{same_name_item['id']}",
                headers=headers,
                params={"expected_revision": updated.json()["revision"]},
            )
        finally:
            app.dependency_overrides.clear()

        assert all(response.status_code == 403 for response in forbidden)
        assert initial.status_code == 200
        source = next(
            item
            for item in initial.json()["items"]
            if item["id"] == str(platform_type_id)
        )
        assert source["platform_count"] == 2
        assert source["available_actions"] == ["UPDATE"]
        assert source["deletion"] == {
            "blockers": [{"type": "PLATFORM_PROFILE", "count": 2}]
        }
        assert created.status_code == 201
        assert created.json()["name"] == "Alpha"
        assert duplicate_slug.status_code == 409
        assert duplicate_slug.json()["error"]["code"] == "PLATFORM_TYPE_SLUG_EXISTS"
        assert duplicate_slug.json()["error"]["details"]["errors"][0]["loc"] == [
            "body",
            "slug",
        ]
        assert same_name.status_code == 201
        assert blank_name.status_code == 422
        assert duplicate_update.status_code == 409
        assert duplicate_update.json()["error"]["code"] == "PLATFORM_TYPE_SLUG_EXISTS"
        assert updated.status_code == 200
        assert updated.json()["slug"] == "alpha-renamed"
        alpha_items = [item for item in current.json()["items"] if item["name"].lower() == "alpha"]
        assert [item["id"] for item in alpha_items] == sorted(item["id"] for item in alpha_items)
        assert source_update.status_code == 200
        assert stale_delete.status_code == 409
        assert stale_delete.json()["error"]["code"] == "REVISION_CONFLICT"
        assert blocked_delete.status_code == 409
        assert blocked_delete.json()["error"]["code"] == "PLATFORM_TYPE_IN_USE"
        assert blocked_delete.json()["error"]["details"]["references"] == [
            {"type": "PLATFORM_PROFILE", "count": 2}
        ]
        assert missing_revision.status_code == 422
        assert deleted.status_code == 204


@pytest.mark.integration
def test_platform_type_projection_uses_two_queries_at_any_list_size() -> None:
    """列表和平台数量投影固定为两条查询，不能随行数增长。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            assert isinstance(actor, User)

        assert _projection_statement_count(engine) == 2

        with Session(engine) as db:
            for index in range(5):
                item = PlatformType(
                    name=f"Type {index}",
                    slug=f"type-{index}-{uuid.uuid4().hex[:8]}",
                    created_by=actor.id,
                )
                db.add(item)
                db.flush()
                db.add_all(
                    [
                        PlatformProfile(
                            name=f"平台 {index}-{enabled}",
                            slug=f"profile-{index}-{enabled}-{uuid.uuid4().hex[:8]}",
                            allowed_domains=[f"{index}-{enabled}.example.invalid"],
                            platform_type_id=item.id,
                            is_active=enabled,
                        )
                        for enabled in (True, False)
                    ]
                )
            db.commit()

        assert _projection_statement_count(engine) == 2
