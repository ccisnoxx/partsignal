"""Platform Prompt Preview Options 的 PostgreSQL 与权限集成测试。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import get_db
from app.deps import get_current_session
from app.main import app
from app.models.ai_generation import AIChannel, AIModel
from app.models.configuration import PlatformProfile, PlatformPrompt, PlatformType
from app.models.content import ContentTask
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.services.content_task_queries import get_platform_prompt_preview_options
from tests.integration.test_publication_workflow import temporary_database


def _add_task(
    db: Session,
    *,
    actor: User,
    platform: PlatformProfile,
    suffix: str,
    updated_at: datetime,
    classification: str = "PUBLIC",
) -> ContentTask:
    product = Product(
        part_number=f"PS-{suffix}",
        normalized_part_number=f"ps-{suffix}",
        brand="PartSignal",
        normalized_brand=f"partsignal-{suffix}",
        category="MCU",
    )
    db.add(product)
    db.flush()
    fact = FactVersion(
        product_id=product.id,
        version=1,
        status="APPROVED",
        body_markdown="## 参数\n\n典型工作电压为 3.3 V。",
        classification=classification,
        change_summary="Preview 测试事实",
        created_by=actor.id,
        approved_by=actor.id,
    )
    db.add(fact)
    db.flush()
    task = ContentTask(
        product_id=product.id,
        fact_version_id=fact.id,
        platform_profile_id=platform.id,
        platform_profile_name_snapshot=platform.name,
        platform_website_url_snapshot=platform.website_url,
        created_by=actor.id,
        updated_at=updated_at,
    )
    db.add(task)
    db.flush()
    return task


def _statement_count(engine: Engine, prompt_id: uuid.UUID) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with Session(engine) as db:
            get_platform_prompt_preview_options(db, prompt_id)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


@pytest.mark.integration
def test_prompt_preview_options_are_authoritative_private_and_fixed_query() -> None:
    """选项复用任务动作与模型资格，并只允许管理员读取窄身份。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        factory = sessionmaker(bind=engine, expire_on_commit=False)
        with factory() as db:
            admin = User(
                username=f"prompt-preview-admin-{uuid.uuid4().hex[:8]}",
                display_name="Prompt Preview 管理员",
                password_hash="not-used",
                account_type="ADMIN",
            )
            engineer = User(
                username=f"prompt-preview-engineer-{uuid.uuid4().hex[:8]}",
                display_name="Prompt Preview 工程师",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            db.add_all([admin, engineer])
            db.flush()
            prompt = PlatformPrompt(
                name="Preview Prompt",
                template_markdown="# 机密 Prompt 正文不得进入选项响应",
                revision=3,
                updated_by=admin.id,
            )
            other_prompt = PlatformPrompt(
                name="其他 Prompt",
                template_markdown="# 其他正文",
                updated_by=admin.id,
            )
            platform_type = PlatformType(
                name="技术社区",
                slug=f"preview-community-{uuid.uuid4().hex[:8]}",
                created_by=admin.id,
            )
            db.add_all([prompt, other_prompt, platform_type])
            db.flush()
            platform = PlatformProfile(
                name="Preview 平台",
                slug=f"preview-platform-{uuid.uuid4().hex[:8]}",
                allowed_domains=["preview.example.invalid"],
                platform_type_id=platform_type.id,
                platform_prompt_id=prompt.id,
            )
            other_platform = PlatformProfile(
                name="其他平台",
                slug=f"other-platform-{uuid.uuid4().hex[:8]}",
                allowed_domains=["other.example.invalid"],
                platform_type_id=platform_type.id,
                platform_prompt_id=other_prompt.id,
            )
            channel = AIChannel(
                name="可用渠道",
                description="Preview 测试渠道",
                protocol_type="openai-compatible-chat-completions",
                provider_brand="CUSTOM",
                base_url="https://ai.example.invalid",
                api_key_ciphertext="不得返回的密文",
                api_key_updated_at=datetime.now(UTC),
                timeout_seconds=30,
                is_enabled=True,
                created_by=admin.id,
            )
            disabled_channel = AIChannel(
                name="停用渠道",
                description="Preview 停用测试渠道",
                protocol_type="openai-compatible-chat-completions",
                provider_brand="CUSTOM",
                base_url="https://disabled-ai.example.invalid",
                api_key_ciphertext="不得返回的停用密文",
                api_key_updated_at=datetime.now(UTC),
                timeout_seconds=30,
                is_enabled=False,
                created_by=admin.id,
            )
            db.add_all([platform, other_platform, channel, disabled_channel])
            db.flush()
            available_model = AIModel(
                channel_id=channel.id,
                display_name="已验证模型",
                model_id="verified-model",
                is_enabled=True,
                test_status="PASSED",
                created_by=admin.id,
            )
            db.add_all(
                [
                    available_model,
                    AIModel(
                        channel_id=channel.id,
                        display_name="未验证模型",
                        model_id="untested-model",
                        is_enabled=True,
                        test_status="UNTESTED",
                        created_by=admin.id,
                    ),
                    AIModel(
                        channel_id=disabled_channel.id,
                        display_name="停用渠道模型",
                        model_id="disabled-channel-model",
                        is_enabled=True,
                        test_status="PASSED",
                        created_by=admin.id,
                    ),
                ]
            )
            base_time = datetime(2026, 8, 14, 8, tzinfo=UTC)
            older = _add_task(
                db,
                actor=admin,
                platform=platform,
                suffix="older",
                updated_at=base_time,
            )
            newer = _add_task(
                db,
                actor=admin,
                platform=platform,
                suffix="newer",
                updated_at=base_time + timedelta(minutes=1),
            )
            _add_task(
                db,
                actor=admin,
                platform=platform,
                suffix="internal",
                updated_at=base_time + timedelta(minutes=2),
                classification="INTERNAL",
            )
            _add_task(
                db,
                actor=admin,
                platform=other_platform,
                suffix="other-prompt",
                updated_at=base_time + timedelta(minutes=3),
            )
            db.commit()

            options = get_platform_prompt_preview_options(db, prompt.id)
            assert options.platform_prompt.model_dump() == {
                "id": prompt.id,
                "name": "Preview Prompt",
                "revision": 3,
            }
            assert [item.content_task_id for item in options.contexts] == [newer.id, older.id]
            assert options.contexts[0].model_dump() == {
                "content_task_id": newer.id,
                "identifier": f"CT-{str(newer.id)[:8].upper()}",
                "product_id": options.contexts[0].product_id,
                "brand": "PartSignal",
                "part_number": "PS-newer",
                "platform_profile_id": platform.id,
                "platform_profile_name": "Preview 平台",
                "fact_version_id": newer.fact_version_id,
                "fact_version": 1,
            }
            assert [model.id for model in options.models] == [available_model.id]

        sparse_count = _statement_count(engine, prompt.id)
        with factory() as db:
            stored_admin = db.get(User, admin.id)
            stored_platform = db.get(PlatformProfile, platform.id)
            assert stored_admin is not None and stored_platform is not None
            for index in range(12):
                _add_task(
                    db,
                    actor=stored_admin,
                    platform=stored_platform,
                    suffix=f"dense-{index}",
                    updated_at=base_time + timedelta(hours=index + 1),
                )
            db.commit()
        assert _statement_count(engine, prompt.id) == sparse_count

        def override_db() -> Iterator[Session]:
            with factory() as db:
                yield db

        current = SimpleNamespace(user=engineer)
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: current
        client = TestClient(app)
        try:
            forbidden = client.get(
                f"/api/v1/platform-prompts/{prompt.id}/preview-options"
            )
            current.user = admin
            success = client.get(
                f"/api/v1/platform-prompts/{prompt.id}/preview-options"
            )
            missing = client.get(
                f"/api/v1/platform-prompts/{uuid.uuid4()}/preview-options"
            )
        finally:
            app.dependency_overrides.clear()
            engine.dispose()

        assert forbidden.status_code == 403
        assert success.status_code == 200
        assert set(success.json()) == {"platform_prompt", "contexts", "models"}
        assert set(success.json()["contexts"][0]) == {
            "content_task_id",
            "identifier",
            "product_id",
            "brand",
            "part_number",
            "platform_profile_id",
            "platform_profile_name",
            "fact_version_id",
            "fact_version",
        }
        assert "template_markdown" not in success.text
        assert "ciphertext" not in success.text
        assert missing.status_code == 404
