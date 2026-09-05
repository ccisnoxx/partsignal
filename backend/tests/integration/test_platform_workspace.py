"""Platform Workspace 首屏读模型的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import app.routers.configuration as configuration_routes
from app.db import get_db
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.models.configuration import PlatformProfile, PlatformPrompt
from app.models.identity import AuditLog, User
from app.models.publication import PlatformAccount
from app.schemas.configuration import (
    ContentHumanizationPromptPut,
    PlatformPromptCreate,
    PlatformPromptUpdate,
)
from app.services.platform_configuration import (
    create_platform_prompt,
    get_platform_profile_detail,
    put_content_humanization_prompt,
    update_platform_prompt,
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


@pytest.mark.integration
def test_platform_prompt_duplicate_paths_share_field_error_and_diagnostics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Prompt 预检与绕过预检的真实约束路径返回同一字段错误。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            assert isinstance(actor, User)
            create_platform_prompt(
                db=db,
                payload=PlatformPromptCreate(name="共享 Prompt", template_markdown="初始模板"),
                actor=actor,
                request_id="prompt-first",
            )
            prompt_before = db.scalar(
                select(PlatformPrompt).where(PlatformPrompt.name == "共享 Prompt")
            )
            assert prompt_before is not None
            prompt_snapshot = tuple(
                getattr(prompt_before, field)
                for field in ("id", "name", "template_markdown", "revision")
            )
            with pytest.raises(AppError) as prechecked:
                create_platform_prompt(
                    db=db,
                    payload=PlatformPromptCreate(name="共享 Prompt", template_markdown="重复模板"),
                    actor=actor,
                    request_id="prompt-precheck",
                )
            db.rollback()
            real_scalar = db.scalar
            monkeypatch.setattr(db, "scalar", lambda *_args, **_kwargs: None)
            with pytest.raises(AppError) as constrained:
                create_platform_prompt(
                    db=db,
                    payload=PlatformPromptCreate(name="共享 Prompt", template_markdown="重复模板"),
                    actor=actor,
                    request_id="prompt-constraint",
                )
            assert prechecked.value.code == constrained.value.code == "PLATFORM_PROMPT_NAME_EXISTS"
            assert prechecked.value.details == constrained.value.details
            cause = constrained.value.__cause__
            assert cause is not None
            assert getattr(cause.orig, "sqlstate", None) == "23505"
            assert getattr(getattr(cause.orig, "diag", None), "constraint_name", None) == (
                "uq_platform_prompt_templates_name"
            )
            monkeypatch.setattr(db, "scalar", real_scalar)
            db.rollback()
            with Session(engine, expire_on_commit=False) as verification_db:
                prompts = list(verification_db.scalars(select(PlatformPrompt)))
                assert len(prompts) == 1
                persisted_prompt = prompts[0]
                assert tuple(
                    getattr(persisted_prompt, field)
                    for field in ("id", "name", "template_markdown", "revision")
                ) == prompt_snapshot
                assert verification_db.scalar(
                    select(AuditLog.id).where(
                        AuditLog.request_id.in_(
                            ["prompt-precheck", "prompt-constraint"]
                        ),
                        AuditLog.action == "platform_prompt.created",
                        AuditLog.outcome == "SUCCESS",
                    )
                ) is None

            duplicate_target = create_platform_prompt(
                db=db,
                payload=PlatformPromptCreate(name="另一个 Prompt", template_markdown="目标模板"),
                actor=actor,
                request_id="prompt-duplicate-target",
            )
            profile = graph["profile"]
            assert isinstance(profile, PlatformProfile)
            stale_revision = prompt_before.revision
            profile.platform_prompt_id = prompt_before.id
            prompt_before.revision += 1
            db.commit()
            prompt_update_snapshot = (
                prompt_before.id,
                prompt_before.name,
                prompt_before.template_markdown,
                prompt_before.revision,
            )
            with pytest.raises(AppError) as stale_duplicate:
                update_platform_prompt(
                    db=db,
                    platform_prompt_id=prompt_before.id,
                    payload=PlatformPromptUpdate(
                        name=duplicate_target.name,
                        template_markdown="不应覆盖",
                        expected_revision=stale_revision,
                    ),
                    actor=actor,
                    request_id="prompt-update-stale-duplicate",
                )
            assert stale_duplicate.value.code == "REVISION_CONFLICT"
            db.rollback()
            with Session(engine, expire_on_commit=False) as verification_db:
                persisted_prompt = verification_db.get(PlatformPrompt, prompt_before.id)
                assert persisted_prompt is not None
                assert (
                    persisted_prompt.id,
                    persisted_prompt.name,
                    persisted_prompt.template_markdown,
                    persisted_prompt.revision,
                ) == prompt_update_snapshot
                persisted_profile = verification_db.get(PlatformProfile, profile.id)
                assert persisted_profile is not None
                assert persisted_profile.platform_prompt_id == prompt_before.id
                assert verification_db.scalar(
                    select(AuditLog.id).where(
                        AuditLog.request_id == "prompt-update-stale-duplicate",
                        AuditLog.action == "platform_prompt.updated",
                        AuditLog.outcome == "SUCCESS",
                    )
                ) is None


@pytest.mark.integration
def test_humanization_prompt_put_has_distinct_missing_stale_and_current_states() -> None:
    """自然化 Prompt 首次创建、缺失 revision、过期 revision 和当前 revision 语义分离。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db)
            actor = graph["user"]
            assert isinstance(actor, User)
            actor_id = actor.id

            first = put_content_humanization_prompt(
                db=db,
                payload=ContentHumanizationPromptPut(
                    template_markdown="自然化模板 v0",
                    expected_revision=None,
                ),
                actor=actor,
                request_id="humanization-first",
            )
            assert first.revision == 0
            with pytest.raises(AppError) as stale:
                put_content_humanization_prompt(
                    db=db,
                    payload=ContentHumanizationPromptPut(
                        template_markdown="不应覆盖",
                        expected_revision=1,
                    ),
                    actor=actor,
                    request_id="humanization-stale",
                )
            assert stale.value.code == "REVISION_CONFLICT"
            assert stale.value.details == {}
            db.rollback()
            assert db.scalar(
                select(AuditLog.id).where(AuditLog.request_id == "humanization-stale")
            ) is None

            current = put_content_humanization_prompt(
                db=db,
                payload=ContentHumanizationPromptPut(
                    template_markdown="自然化模板 v1",
                    expected_revision=0,
                ),
                actor=actor,
                request_id="humanization-current",
            )
            assert current.revision == 1
            assert current.template_markdown == "自然化模板 v1"

        with Session(engine, expire_on_commit=False) as db:
            actor = db.get(User, actor_id)
            assert actor is not None
            prompt = db.get(type(first), 1)
            assert prompt is not None
            db.delete(prompt)
            db.commit()
            actor.account_type = "ADMIN"

            def database_session() -> Iterator[Session]:
                with Session(engine, expire_on_commit=False) as session:
                    yield session

            app.dependency_overrides[get_db] = database_session
            app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(user=actor)
            try:
                missing_get = TestClient(app).get("/api/v1/content-humanization-prompt")
            finally:
                app.dependency_overrides.clear()
            assert missing_get.status_code == 204

            with pytest.raises(AppError) as missing:
                put_content_humanization_prompt(
                    db=db,
                    payload=ContentHumanizationPromptPut(
                        template_markdown="不得自动创建",
                        expected_revision=0,
                    ),
                    actor=actor,
                    request_id="humanization-missing",
                )
            assert missing.value.code == "HUMANIZATION_PROMPT_MISSING"
            assert missing.value.message == "自然化 Prompt 尚不存在"
            assert missing.value.details == {}
            db.rollback()
            assert db.get(type(first), 1) is None
            assert db.scalar(
                select(AuditLog.id).where(AuditLog.request_id == "humanization-missing")
            ) is None
