"""同步 SDK 经真实本机 HTTP 与 PostgreSQL 执行配置命令。"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.db import get_db
from app.deps import get_current_session
from app.main import app
from app.models.ai_generation import AIChannel, AIModel
from app.models.identity import AuditLog, User
from app.schemas.configuration import (
    AIChannelCreate,
    AIChannelHeaderCreate,
    AIModelCreate,
)
from app.security import hash_token
from app.services.ai_configuration import (
    create_ai_channel,
    create_ai_channel_header,
    create_ai_model,
)
from tests.ai_provider_support import fake_ai_provider
from tests.integration.test_ai_channel_management import temporary_database


def seed_configuration(db: Session, base_url: str) -> tuple[User, AIChannel, AIModel]:
    actor = User(
        username=f"psr001-{uuid.uuid4()}",
        display_name="SDK 测试管理员",
        password_hash="not-used",
        account_type="ADMIN",
    )
    db.add(actor)
    db.commit()
    channel = create_ai_channel(
        db=db,
        actor=actor,
        request_id="psr001-setup",
        payload=AIChannelCreate(
            name="SDK 本地替身",
            description="仅使用虚构凭据的 SDK 集成验证",
            protocol_type="openai-compatible-chat-completions",
            provider_brand="CUSTOM",
            base_url=base_url,
            api_key="fake-sdk-api-key",
            timeout_seconds=10,
        ),
    )
    channel = create_ai_channel_header(
        db=db,
        actor=actor,
        request_id="psr001-setup",
        channel_id=channel.id,
        payload=AIChannelHeaderCreate(
            expected_channel_revision=channel.revision,
            name="X-Secret",
            value="fake-sdk-header-secret",
            is_sensitive=True,
        ),
    )
    model = create_ai_model(
        db=db,
        actor=actor,
        request_id="psr001-setup",
        channel_id=channel.id,
        payload=AIModelCreate(
            display_name="本地模型", model_id="fake-model", request_parameters={"temperature": 0}
        ),
    )
    return actor, channel, model


@pytest.mark.integration
def test_sdk_configuration_http_flow_keeps_secrets_and_test_state_safe(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(settings, "ai_allow_local_http", True)
    caplog.set_level(logging.DEBUG)
    with fake_ai_provider() as provider, temporary_database("head") as (_, database_url, _, _):
        engine = create_engine(database_url)
        factory = sessionmaker(engine, expire_on_commit=False)
        with factory() as db:
            actor, channel, model = seed_configuration(db, provider.base_url)
            initial_audits = db.scalar(select(func.count()).select_from(AuditLog))
            ciphertext = channel.api_key_ciphertext
        csrf = "psr001-fake-csrf-more-than-32-characters"

        def override_db() -> Iterator[Session]:
            with factory() as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
            user=actor, csrf_hash=hash_token(csrf), last_seen_at=None
        )
        responses = []
        try:
            with TestClient(app) as client:
                discovered = client.post(
                    f"/api/v1/ai-channels/{channel.id}/discover-models",
                    headers={"X-CSRF-Token": csrf},
                    json={"expected_revision": channel.revision},
                )
                responses.append(discovered.text)
                assert discovered.status_code == 200
                assert [item["model_id"] for item in discovered.json()["items"]] == ["fake-model"]
                tested = client.post(
                    f"/api/v1/ai-models/{model.id}/test",
                    headers={"X-CSRF-Token": csrf},
                    json={"expected_revision": model.revision},
                )
                responses.append(tested.text)
                assert tested.status_code == 200
                assert tested.json()["test_status"] == "PASSED"
                assert tested.json()["is_enabled"] is False
                provider.status = 429
                failed = client.post(
                    f"/api/v1/ai-models/{model.id}/test",
                    headers={"X-CSRF-Token": csrf},
                    json={"expected_revision": tested.json()["revision"]},
                )
                responses.append(failed.text)
                assert failed.status_code == 200
                assert failed.json()["test_status"] == "FAILED"
                assert failed.json()["is_enabled"] is False
                assert failed.json()["last_test_error_summary"] == "AI 渠道返回 HTTP 429"
                discovery_failed = client.post(
                    f"/api/v1/ai-channels/{channel.id}/discover-models",
                    headers={"X-CSRF-Token": csrf},
                    json={"expected_revision": channel.revision},
                )
                responses.append(discovery_failed.text)
                assert discovery_failed.status_code == 502
                assert discovery_failed.json()["error"]["code"] == "AI_PROVIDER_ERROR"
            assert len(provider.requests) == 4
            assert [request["path"] for request in provider.requests] == [
                "/custom/v1/models",
                "/custom/v1/chat/completions",
                "/custom/v1/chat/completions",
                "/custom/v1/models",
            ]
            for request in provider.requests:
                headers = {name.casefold(): value for name, value in request["headers"].items()}
                assert headers["authorization"] == "Bearer fake-sdk-api-key"
                assert headers["x-secret"] == "fake-sdk-header-secret"
                if request["method"] == "POST":
                    assert request["body"] == {
                        "model": "fake-model",
                        "stream": False,
                        "messages": [{"role": "user", "content": "hi"}],
                        "temperature": 0,
                    }
            with factory() as db:
                assert db.scalar(select(func.count()).select_from(AuditLog)) == initial_audits
                assert db.scalar(select(func.count()).select_from(AIModel)) == 1
                stored = db.get(AIChannel, channel.id)
                assert stored is not None and stored.api_key_ciphertext == ciphertext
                assert "fake-sdk-api-key" not in ciphertext
                audit_data = json.dumps([item.details for item in db.scalars(select(AuditLog))])
            exposed = " ".join(responses) + caplog.text + audit_data
            for secret in (
                "fake-sdk-api-key",
                "fake-sdk-header-secret",
                "fake-provider-secret-body",
            ):
                assert secret not in exposed
        finally:
            app.dependency_overrides.clear()
            engine.dispose()


@pytest.mark.integration
@pytest.mark.parametrize(
    "operation,provider_status",
    [
        ("discover", 200),
        ("discover", 500),
        ("test", 200),
        ("test", 500),
        ("discover", "invalid_utf8"),
        ("test", "invalid_utf8"),
    ],
)
def test_sdk_in_flight_configuration_change_discards_success_and_failure(
    operation: str,
    provider_status: int | str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """替身在另一连接修改配置；证明外部 I/O 不持锁、回写仍重新复核。"""
    from app.errors import AppError
    from app.schemas.common import RevisionRequest
    from app.services import ai_configuration

    monkeypatch.setattr(settings, "ai_allow_local_http", True)
    with fake_ai_provider() as provider, temporary_database("head") as (_, database_url, _, _):
        engine = create_engine(database_url)
        factory = sessionmaker(engine, expire_on_commit=False)
        try:
            with factory() as db:
                actor, channel, model = seed_configuration(db, provider.base_url)
                initial_audits = db.scalar(select(func.count()).select_from(AuditLog))
                if provider_status == "invalid_utf8":
                    provider.response_body = b"\xff"
                else:
                    assert isinstance(provider_status, int)
                    provider.status = provider_status

                def change_configuration() -> None:
                    assert db.in_transaction() is False
                    with factory() as other:
                        other.execute(text("SET LOCAL lock_timeout = '2s'"))
                        changed_channel = other.get(AIChannel, channel.id)
                        changed_model = other.get(AIModel, model.id)
                        assert changed_channel is not None and changed_model is not None
                        changed_channel.revision += 1
                        changed_model.revision += 1
                        changed_model.test_status = "UNTESTED"
                        changed_model.is_enabled = False
                        other.commit()

                provider.before_response = change_configuration
                with pytest.raises(AppError) as caught:
                    if operation == "discover":
                        ai_configuration.discover_ai_channel_models(
                            db=db,
                            actor=actor,
                            request_id="psr001-race",
                            channel_id=channel.id,
                            payload=RevisionRequest(expected_revision=channel.revision),
                        )
                    else:
                        ai_configuration.test_ai_model(
                            db=db,
                            actor=actor,
                            request_id="psr001-race",
                            model_id=model.id,
                            payload=RevisionRequest(expected_revision=model.revision),
                        )
                assert caught.value.code == "REVISION_CONFLICT"
                db.rollback()
                db.expire_all()
                stored_model = db.get(AIModel, model.id)
                assert stored_model is not None
                assert stored_model.revision == 1
                assert stored_model.test_status == "UNTESTED"
                assert stored_model.is_enabled is False
                assert stored_model.last_tested_at is None
                assert stored_model.last_test_error_summary is None
                assert db.scalar(select(func.count()).select_from(AuditLog)) == initial_audits
                assert len(provider.requests) == 1
        finally:
            engine.dispose()


@pytest.mark.integration
def test_invalid_utf8_provider_response_disables_a_previously_enabled_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.errors import AppError
    from app.schemas.common import RevisionRequest
    from app.services import ai_configuration

    monkeypatch.setattr(settings, "ai_allow_local_http", True)
    with fake_ai_provider() as provider, temporary_database("head") as (_, database_url, _, _):
        engine = create_engine(database_url)
        try:
            with Session(engine, expire_on_commit=False) as db:
                actor, channel, model = seed_configuration(db, provider.base_url)
                model.test_status = "PASSED"
                model.is_enabled = True
                db.commit()
                provider.response_body = b"\xff"
                revision = model.revision
                tested = ai_configuration.test_ai_model(
                    db=db,
                    actor=actor,
                    request_id="psr001-invalid-utf8",
                    model_id=model.id,
                    payload=RevisionRequest(expected_revision=revision),
                )
                assert tested.test_status == "FAILED"
                assert tested.is_enabled is False
                assert tested.revision == revision + 1
                assert tested.last_test_error_summary == "AI 渠道响应结构无效"
                with pytest.raises(AppError) as caught:
                    ai_configuration.discover_ai_channel_models(
                        db=db,
                        actor=actor,
                        request_id="psr001-invalid-utf8",
                        channel_id=channel.id,
                        payload=RevisionRequest(expected_revision=channel.revision),
                    )
                assert (caught.value.code, caught.value.status_code) == ("AI_RESPONSE_INVALID", 502)
                assert len(provider.requests) == 2
        finally:
            engine.dispose()
