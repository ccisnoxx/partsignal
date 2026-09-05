"""平台类型设置合同的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import app.services.content_planning as content_planning_service
import app.services.platform_configuration as platform_configuration_service
from app.db import get_db
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.models.configuration import PlatformProfile, PlatformPrompt, PlatformType
from app.models.identity import User
from app.models.publication import PlatformAccount
from app.schemas.configuration import (
    PlatformProfileCreate,
    PlatformPromptCreate,
    PlatformTypeCreate,
)
from app.schemas.publication import PlatformAccountCreate
from app.security import hash_token
from app.services.platform_configuration import (
    create_platform_prompt,
    create_platform_type,
    platform_types_out,
)
from app.services.publication import create_platform_account
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
def test_platform_type_constraint_mapper_preserves_postgresql_diagnostics() -> None:
    """绕过预检触发真实 slug 约束，并保留可核验的 PostgreSQL diagnostics。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            source = graph["profile"]
            assert isinstance(actor, User)
            assert isinstance(source, PlatformProfile)
            duplicate = PlatformType(
                name="重复类型",
                slug=db.get(PlatformType, source.platform_type_id).slug,
                created_by=actor.id,
            )
            db.add(duplicate)
            with pytest.raises(AppError) as raised:
                platform_configuration_service._flush_platform_type(db)

            cause = raised.value.__cause__
            assert cause is not None
            assert getattr(cause.orig, "sqlstate", None) == "23505"
            assert (
                getattr(getattr(cause.orig, "diag", None), "constraint_name", None)
                == "uq_platform_types_slug"
            )
            assert raised.value.code == "PLATFORM_TYPE_SLUG_EXISTS"
            assert raised.value.details == {
                "errors": [
                    {
                        "loc": ["body", "slug"],
                        "msg": "平台类型 slug 已存在",
                        "type": "platform_type_slug_exists",
                    }
                ]
            }
            db.rollback()


@pytest.mark.integration
@pytest.mark.parametrize("owner", ["type", "profile", "prompt", "account"])
def test_platform_identity_concurrency_uses_owner_specific_contract(owner: str) -> None:
    """四类平台 identity 均在真实独立 Session 中验证并发最终结果。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            profile = graph["profile"]
            assert isinstance(actor, User)
            assert isinstance(profile, PlatformProfile)
            actor_id = actor.id
            platform_type_id = profile.platform_type_id
            profile_id = profile.id
        start_barrier = Barrier(2)

        def create_identity(request_id: str) -> tuple[str, AppError | None]:
            with Session(engine) as db:
                race_actor = db.get(User, actor_id)
                assert race_actor is not None
                if owner == "prompt":
                    original_scalar = db.scalar
                    synchronized = False

                    def synchronized_scalar(
                        statement: object, *args: object, **kwargs: object
                    ) -> object:
                        nonlocal synchronized
                        result = original_scalar(statement, *args, **kwargs)
                        if not synchronized:
                            synchronized = True
                            start_barrier.wait(timeout=30)
                        return result

                    db.scalar = synchronized_scalar
                else:
                    start_barrier.wait(timeout=30)
                try:
                    if owner == "type":
                        create_platform_type(
                            db=db,
                            payload=PlatformTypeCreate(
                                name="并发类型", slug="concurrent-type"
                            ),
                            actor=race_actor,
                            request_id=request_id,
                        )
                    elif owner == "profile":
                        content_planning_service.create_platform_profile(
                            db=db,
                            payload=PlatformProfileCreate(
                                name="并发平台",
                                slug="concurrent-profile",
                                allowed_domains=["concurrent.example.invalid"],
                                platform_type_id=platform_type_id,
                                platform_prompt_id=None,
                            ),
                            actor=race_actor,
                            request_id=request_id,
                        )
                    elif owner == "prompt":
                        create_platform_prompt(
                            db=db,
                            payload=PlatformPromptCreate(
                                name="并发 Prompt", template_markdown="并发模板"
                            ),
                            actor=race_actor,
                            request_id=request_id,
                        )
                    else:
                        create_platform_account(
                            db=db,
                            payload=PlatformAccountCreate(
                                platform_profile_id=profile_id,
                                label="并发账号",
                                account_identifier="concurrent-account",
                            ),
                            actor=race_actor,
                            request_id=request_id,
                        )
                except AppError as error:
                    return "error", error
                return "success", None

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(create_identity, [f"{owner}-race-1", f"{owner}-race-2"]))
        assert [result[0] for result in results].count("success") == 1
        conflict = next(result[1] for result in results if result[1] is not None)
        expected = {
            "type": ("PLATFORM_TYPE_SLUG_EXISTS", "uq_platform_types_slug"),
            "profile": ("PLATFORM_SLUG_EXISTS", None),
            "prompt": ("PLATFORM_PROMPT_NAME_EXISTS", "uq_platform_prompt_templates_name"),
            "account": ("PLATFORM_ACCOUNT_IDENTIFIER_EXISTS", None),
        }[owner]
        assert conflict.code == expected[0]
        if expected[1] is not None:
            cause = conflict.__cause__
            assert cause is not None
            assert getattr(cause.orig, "sqlstate", None) == "23505"
            assert getattr(getattr(cause.orig, "diag", None), "constraint_name", None) == (
                expected[1]
            )
        identity_rows = {
            "type": (PlatformType, PlatformType.slug == "concurrent-type"),
            "profile": (PlatformProfile, PlatformProfile.slug == "concurrent-profile"),
            "prompt": (PlatformPrompt, PlatformPrompt.name == "并发 Prompt"),
            "account": (
                PlatformAccount,
                PlatformAccount.account_identifier == "concurrent-account",
            ),
        }
        row_model, row_filter = identity_rows[owner]
        with Session(engine) as db:
            assert db.scalar(select(func.count()).select_from(row_model).where(row_filter)) == 1


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
