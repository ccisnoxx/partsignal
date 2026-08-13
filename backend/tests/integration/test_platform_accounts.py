"""Platform Workspace 发布账号合同的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import app.services.publication as publication_service
from app.db import get_db
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.models.configuration import PlatformProfile
from app.models.identity import User
from app.models.publication import PlatformAccount
from app.schemas.publication import (
    PlatformAccountCreate,
    PublicationWorkCloseRequest,
    PublicationWorkCreate,
)
from app.security import hash_token
from app.services.projections import platform_accounts_out
from app.services.publication import (
    close_publication_work,
    create_platform_account,
    create_publication_work,
    delete_platform_account,
)
from tests.integration.test_publication_workflow import _seed_graph, temporary_database


def _statement_count(engine: Engine, platform_profile_id: uuid.UUID) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with Session(engine) as db:
            accounts = list(
                db.scalars(
                    select(PlatformAccount).where(
                        PlatformAccount.platform_profile_id == platform_profile_id
                    )
                )
            )
            platform_accounts_out(db, accounts, can_delete=True)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


@pytest.mark.integration
def test_platform_account_api_projects_actor_actions_and_supports_crud() -> None:
    """两类真实角色共享管理命令，删除只向管理员开放。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            profile = graph["profile"]
            assert isinstance(actor, User)
            assert isinstance(profile, PlatformProfile)

        csrf_token = "platform-account-csrf-token-over-32-characters"

        def database_session() -> Iterator[Session]:
            with Session(engine, expire_on_commit=False) as db:
                yield db

        actor.account_type = "ENGINEER"
        app.dependency_overrides[get_db] = database_session
        app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
            user=actor,
            csrf_hash=hash_token(csrf_token),
        )
        client = TestClient(app)
        try:
            engineer_list = client.get(
                "/api/v1/platform-accounts",
                params={"platform_profile_id": str(profile.id)},
            )
            created = client.post(
                "/api/v1/platform-accounts",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "platform_profile_id": str(profile.id),
                    "label": "工程师运营账号",
                    "account_identifier": "engineer-operator",
                },
            )
            account = created.json()
            updated = client.patch(
                f"/api/v1/platform-accounts/{account['id']}",
                headers={"X-CSRF-Token": csrf_token},
                json={
                    "label": "工程师运营账号（更新）",
                    "account_identifier": "engineer-operator-updated",
                    "expected_revision": account["revision"],
                },
            )
            disabled = client.post(
                f"/api/v1/platform-accounts/{account['id']}/disable",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": updated.json()["revision"]},
            )
            enabled = client.post(
                f"/api/v1/platform-accounts/{account['id']}/enable",
                headers={"X-CSRF-Token": csrf_token},
                json={"expected_revision": disabled.json()["revision"]},
            )
            engineer_delete = client.delete(
                f"/api/v1/platform-accounts/{account['id']}",
                headers={"X-CSRF-Token": csrf_token},
                params={"expected_revision": enabled.json()["revision"]},
            )

            actor.account_type = "ADMIN"
            admin_list = client.get(
                "/api/v1/platform-accounts",
                params={"platform_profile_id": str(profile.id)},
            )
            admin_delete = client.delete(
                f"/api/v1/platform-accounts/{account['id']}",
                headers={"X-CSRF-Token": csrf_token},
                params={"expected_revision": enabled.json()["revision"]},
            )
        finally:
            app.dependency_overrides.clear()

        assert engineer_list.status_code == 200
        assert all(item["deletion"] is None for item in engineer_list.json()["items"])
        assert created.status_code == 201
        assert updated.status_code == 200
        assert disabled.status_code == 200
        assert enabled.status_code == 200
        assert engineer_delete.status_code == 403
        assert any("DELETE" in item["available_actions"] for item in admin_list.json()["items"])
        assert admin_delete.status_code == 204


@pytest.mark.integration
def test_platform_account_identifier_conflicts_share_one_field_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """预检与真实唯一约束竞态都返回同一个字段错误。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            profile = graph["profile"]
            existing = graph["account"]
            assert isinstance(actor, User)
            assert isinstance(profile, PlatformProfile)
            assert isinstance(existing, PlatformAccount)
            payload = PlatformAccountCreate(
                platform_profile_id=profile.id,
                label="重复账号",
                account_identifier=f"  {existing.account_identifier.upper()}  ",
            )

            with pytest.raises(AppError) as prechecked:
                create_platform_account(
                    db=db,
                    payload=payload,
                    actor=actor,
                    request_id="account-precheck-conflict",
                )

            monkeypatch.setattr(
                publication_service,
                "_platform_account_identifier_exists",
                lambda *_args, **_kwargs: False,
            )
            with pytest.raises(AppError) as constrained:
                create_platform_account(
                    db=db,
                    payload=payload,
                    actor=actor,
                    request_id="account-constraint-conflict",
                )

            for error in (prechecked.value, constrained.value):
                assert error.code == "PLATFORM_ACCOUNT_IDENTIFIER_EXISTS"
                assert error.status_code == 409
                assert error.details["errors"] == [
                    {
                        "loc": ["body", "account_identifier"],
                        "msg": "该平台已存在相同的运营账号标识",
                        "type": "platform_account_identifier_exists",
                    }
                ]
            assert db.scalar(select(func.count(PlatformAccount.id))) == 1


@pytest.mark.integration
def test_platform_account_delete_checks_revision_then_live_work_blocker() -> None:
    """删除先拒绝 stale revision，再持锁复核非终态发布工作。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            account = graph["account"]
            content = graph["content"]
            assert isinstance(actor, User)
            assert isinstance(account, PlatformAccount)

            with pytest.raises(AppError) as stale:
                delete_platform_account(
                    db=db,
                    platform_account_id=account.id,
                    expected_revision=account.revision + 1,
                    actor=actor,
                    request_id="account-stale-delete",
                )
            assert stale.value.code == "REVISION_CONFLICT"
            db.rollback()
            assert db.get(PlatformAccount, account.id) is not None

            work = create_publication_work(
                db=db,
                payload=PublicationWorkCreate(
                    content_version_id=content.id,
                    platform_account_id=account.id,
                ),
                actor=actor,
                request_id="account-blocker-create",
                idempotency_key="account-blocker-create-key",
            )
            with pytest.raises(AppError) as blocked:
                delete_platform_account(
                    db=db,
                    platform_account_id=account.id,
                    expected_revision=account.revision,
                    actor=actor,
                    request_id="account-blocked-delete",
                )
            assert blocked.value.code == "PLATFORM_ACCOUNT_IN_USE"
            assert blocked.value.details == {
                "references": [{"type": "PUBLICATION_WORK", "count": 1}]
            }
            db.rollback()
            db.refresh(actor)
            db.refresh(account)

            closed = close_publication_work(
                db=db,
                work_id=work.id,
                payload=PublicationWorkCloseRequest(
                    reason="BUSINESS_CANCELLED",
                    comment="释放账号删除阻断",
                    expected_revision=work.revision,
                ),
                actor=actor,
                request_id="account-blocker-close",
            )
            delete_platform_account(
                db=db,
                platform_account_id=account.id,
                expected_revision=account.revision,
                actor=actor,
                request_id="account-terminal-delete",
            )
            assert db.get(PlatformAccount, account.id) is None
            assert closed.platform_account_id == account.id


@pytest.mark.integration
def test_platform_account_projection_query_count_is_fixed_and_disabled_platform_is_explicit(
) -> None:
    """账号数量增长不增加投影查询，停用平台仍保留既有账号动作。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            profile = graph["profile"]
            actor = graph["user"]
            assert isinstance(profile, PlatformProfile)
            assert isinstance(actor, User)
            sparse_count = _statement_count(engine, profile.id)
            db.add_all(
                PlatformAccount(
                    platform_profile_id=profile.id,
                    label=f"账号 {index}",
                    account_identifier=f"fixed-query-{index}",
                )
                for index in range(12)
            )
            db.commit()
            assert _statement_count(engine, profile.id) == sparse_count

            profile.is_active = False
            db.commit()
            accounts = list(
                db.scalars(
                    select(PlatformAccount).where(
                        PlatformAccount.platform_profile_id == profile.id
                    )
                )
            )
            projected = platform_accounts_out(db, accounts, can_delete=True)
            assert all(item.workflow_stage == "PLATFORM_DISABLED" for item in projected)
            assert all(item.primary_task == "HANDLE_PLATFORM" for item in projected)
            assert all("UPDATE" in item.available_actions for item in projected)

            with pytest.raises(AppError) as disabled_create:
                create_platform_account(
                    db=db,
                    payload=PlatformAccountCreate(
                        platform_profile_id=profile.id,
                        label="停用平台新账号",
                        account_identifier="disabled-platform-new",
                    ),
                    actor=actor,
                    request_id="disabled-platform-account-create",
                )
            assert disabled_create.value.code == "PLATFORM_DISABLED"
