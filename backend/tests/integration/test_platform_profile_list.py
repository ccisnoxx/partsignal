"""Platform Profile V2 列表与写命令的 PostgreSQL 集成测试。"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.configuration import PlatformProfile, PlatformPrompt, PlatformType
from app.models.identity import User
from app.models.publication import PlatformAccount
from app.schemas.common import RevisionRequest
from app.schemas.configuration import PlatformProfileStatus, PlatformReadinessStatus
from app.services.platform_configuration import (
    delete_platform_profile,
    list_platform_profiles,
    set_platform_profile_enabled,
)
from tests.integration.test_publication_workflow import _seed_graph, temporary_database


def _statement_count(engine: Engine, *, q: str | None) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with Session(engine) as db:
            list_platform_profiles(
                db=db,
                q=q,
                platform_type_id=None,
                profile_status=None,
                configuration_status=None,
                readiness_status=None,
                page=1,
                page_size=20,
                can_manage=False,
            )
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


@pytest.mark.integration
def test_platform_list_projects_authoritative_readiness_filters_and_permissions() -> None:
    """列表服务端投影三态、筛选、分页、摘要、选项与 actor 动作。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            missing_prompt = graph["profile"]
            missing_prompt_account = graph["account"]
            assert isinstance(actor, User)
            assert isinstance(missing_prompt, PlatformProfile)
            assert isinstance(missing_prompt_account, PlatformAccount)
            actor.account_type = "ADMIN"
            missing_prompt.name = "Beta Missing Prompt"
            missing_prompt_account.is_active = False

            prompt = PlatformPrompt(
                name="平台列表 Prompt",
                template_markdown="你是平台列表测试助手。",
                updated_by=actor.id,
            )
            second_type = PlatformType(
                name="行业媒体",
                slug="industry-media",
                created_by=actor.id,
            )
            db.add_all([prompt, second_type])
            db.flush()
            ready = PlatformProfile(
                name="Alpha Ready",
                slug="alpha-ready",
                allowed_domains=["alpha.example.invalid"],
                platform_type_id=second_type.id,
                platform_prompt_id=prompt.id,
            )
            missing_account = PlatformProfile(
                name="Gamma Missing Account",
                slug="gamma-missing-account",
                allowed_domains=["gamma.example.invalid"],
                platform_type_id=second_type.id,
                platform_prompt_id=prompt.id,
                is_active=False,
            )
            db.add_all([ready, missing_account])
            db.flush()
            db.add(
                PlatformAccount(
                    platform_profile_id=ready.id,
                    label="Alpha 可用账号",
                    account_identifier="alpha-enabled",
                    is_active=True,
                )
            )
            db.commit()

            admin_page = list_platform_profiles(
                db=db,
                q=None,
                platform_type_id=None,
                profile_status=None,
                configuration_status=None,
                readiness_status=None,
                page=1,
                page_size=20,
                can_manage=True,
            )
            assert [item.name for item in admin_page.items] == [
                "Alpha Ready",
                "Beta Missing Prompt",
                "Gamma Missing Account",
            ]
            assert [item.readiness_status for item in admin_page.items] == [
                "COMPLETE",
                "MISSING_PROMPT",
                "MISSING_ACCOUNT",
            ]
            assert [item.enabled_platform_account_count for item in admin_page.items] == [1, 0, 0]
            assert admin_page.summary.model_dump() == {
                "platform_total": 3,
                "enabled_total": 2,
                "missing_prompt_total": 1,
                "configuration_complete_total": 2,
                "readiness_complete_total": 1,
                "missing_account_total": 1,
            }
            assert [item.name for item in admin_page.platform_type_options] == [
                "技术社区",
                "行业媒体",
            ]
            assert admin_page.items[0].primary_task == "VIEW_PLATFORM_OPERATION"
            assert admin_page.items[0].available_actions == ["UPDATE", "DISABLE"]

            engineer_page = list_platform_profiles(
                db=db,
                q="Alpha",
                platform_type_id=None,
                profile_status=PlatformProfileStatus.ENABLED,
                configuration_status=None,
                readiness_status=PlatformReadinessStatus.COMPLETE,
                page=1,
                page_size=10,
                can_manage=False,
            )
            assert engineer_page.total == 1
            assert engineer_page.items[0].id == ready.id
            assert engineer_page.items[0].primary_task is None
            assert engineer_page.items[0].available_actions == []
            assert engineer_page.items[0].deletion is None
            assert engineer_page.summary == admin_page.summary

            second_page = list_platform_profiles(
                db=db,
                q=None,
                platform_type_id=second_type.id,
                profile_status=None,
                configuration_status=None,
                readiness_status=None,
                page=2,
                page_size=1,
                can_manage=False,
            )
            assert second_page.total == 2
            assert [item.id for item in second_page.items] == [missing_account.id]

            full_reference = list_platform_profiles(
                db=db,
                q=None,
                platform_type_id=None,
                profile_status=None,
                configuration_status=None,
                readiness_status=None,
                page=None,
                page_size=None,
                can_manage=False,
            )
            assert full_reference.page == 1
            assert full_reference.page_size == full_reference.total == 3
            assert _statement_count(engine, q=None) == _statement_count(engine, q="Alpha")


@pytest.mark.integration
def test_platform_commands_enforce_state_and_delete_revision() -> None:
    """启停拒绝同态命令，删除在锁内先校验 revision。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            profile = graph["profile"]
            assert isinstance(actor, User)
            assert isinstance(profile, PlatformProfile)

            with pytest.raises(AppError) as same_state:
                set_platform_profile_enabled(
                    db=db,
                    platform_profile_id=profile.id,
                    payload=RevisionRequest(expected_revision=profile.revision),
                    actor=actor,
                    request_id="platform-list-enable-same-state",
                    enabled=True,
                )
            assert same_state.value.code == "INVALID_STATE_TRANSITION"
            db.rollback()

            disabled = set_platform_profile_enabled(
                db=db,
                platform_profile_id=profile.id,
                payload=RevisionRequest(expected_revision=profile.revision),
                actor=actor,
                request_id="platform-list-disable",
                enabled=False,
            )
            with pytest.raises(AppError) as stale:
                delete_platform_profile(
                    db=db,
                    platform_profile_id=disabled.id,
                    expected_revision=disabled.revision - 1,
                    actor=actor,
                    request_id="platform-list-delete-stale",
                )
            assert stale.value.code == "REVISION_CONFLICT"
            db.rollback()
            assert db.scalar(select(PlatformProfile).where(PlatformProfile.id == profile.id))
