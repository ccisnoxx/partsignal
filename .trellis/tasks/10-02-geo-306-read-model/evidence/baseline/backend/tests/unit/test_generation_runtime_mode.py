"""业务运行模式、测试注入与启动配置的独立边界测试。"""

from __future__ import annotations

import base64
import uuid
from typing import Any, cast

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.config import Settings, settings
from app.errors import AppError
from app.models.ai_generation import GenerationJob
from app.models.content import ContentTask
from app.models.identity import User
from app.schemas.content import HumanizationJobCreate, OriginalGenerationJobCreate
from app.schemas.geo_files import GeneratedDraft
from app.services import content_production, generation
from app.services.content_task_queries import generation_model_options
from tests.unit.test_generation import generation_input, humanization_input


class UnusedSession:
    """关闭模式必须在任何数据库访问或副作用前拒绝。"""

    def __getattr__(self, name: str) -> Any:
        raise AssertionError(f"关闭模式访问了 Session.{name}")


class TestGenerator:
    """显式注入且记录调用次数的测试生成器。"""

    __test__ = False

    def __init__(self) -> None:
        self.calls = 0

    def generate(self, generation_input: dict[str, Any]) -> GeneratedDraft:
        self.calls += 1
        return GeneratedDraft(title="测试标题", summary="摘要", body_markdown="正文", tags=["测试"])


@pytest.mark.parametrize("command", ["GENERATE", "HUMANIZE", "RETRY"])
def test_disabled_commands_reject_before_session_or_dispatch(
    monkeypatch: pytest.MonkeyPatch,
    command: str,
) -> None:
    monkeypatch.setattr(settings, "content_generator", "deterministic")
    identity = uuid.uuid4()
    kwargs = {
        "db": cast(Session, UnusedSession()),
        "actor": User(id=identity),
        "request_id": "mode-test",
        "idempotency_key": "existing-or-new-key",
    }
    with pytest.raises(AppError) as captured:
        if command == "GENERATE":
            content_production.create_generation_job(
                **kwargs,
                content_task_id=identity,
                payload=OriginalGenerationJobCreate(
                    ai_model_id=identity,
                    platform_prompt_id=identity,
                    platform_prompt_revision=0,
                ),
            )
        elif command == "HUMANIZE":
            content_production.create_humanization_job(
                **kwargs,
                content_version_id=identity,
                payload=HumanizationJobCreate(ai_model_id=identity),
            )
        else:
            content_production.retry_generation_job(**kwargs, generation_job_id=identity)
    assert (captured.value.code, captured.value.status_code, captured.value.details) == (
        "AI_GENERATION_DISABLED",
        409,
        {},
    )


@pytest.mark.parametrize("job_type", ["GENERATE", "HUMANIZE"])
def test_disabled_mode_removes_retry_and_model_options(
    monkeypatch: pytest.MonkeyPatch,
    job_type: str,
) -> None:
    job = GenerationJob(
        job_type=job_type,
        status="FAILED",
        input_snapshot=generation_input() if job_type == "GENERATE" else humanization_input(),
    )
    task = ContentTask(status="OPEN")
    assert content_production.generation_job_retryable(job, task)
    monkeypatch.setattr(settings, "content_generator", "deterministic")
    assert content_production.generation_job_contract_retryable(job)
    assert not content_production.generation_job_retryable(job, task)
    assert generation_model_options(cast(Session, UnusedSession())) == []


@pytest.mark.parametrize("job_type", ["GENERATE", "HUMANIZE"])
def test_direct_provider_boundary_rejects_disabled_mode(
    monkeypatch: pytest.MonkeyPatch,
    job_type: str,
) -> None:
    monkeypatch.setattr(settings, "content_generator", "deterministic")
    with pytest.raises(AppError) as captured:
        generation.generate_for_job(
            cast(Session, UnusedSession()),
            GenerationJob(job_type=job_type),
            {},
            None,
        )
    assert captured.value.code == "AI_GENERATION_DISABLED"


@pytest.mark.parametrize("environment", ["development", "staging", "production"])
def test_generator_injection_rejected_outside_test_before_database(
    monkeypatch: pytest.MonkeyPatch,
    environment: str,
) -> None:
    monkeypatch.setattr(settings, "environment", environment)
    generator = TestGenerator()
    with pytest.raises(ValueError, match="仅允许 APP_ENV=test"):
        generation.process_generation_job(uuid.uuid4(), generator)
    with pytest.raises(ValueError, match="仅允许 APP_ENV=test"):
        generation.generate_for_job(
            cast(Session, UnusedSession()),
            GenerationJob(job_type="GENERATE"),
            {},
            generator,
        )
    assert generator.calls == 0


@pytest.mark.parametrize("job_type", ["GENERATE", "HUMANIZE"])
def test_test_injection_bypasses_only_mode_and_preserves_public_snapshot_validation(
    monkeypatch: pytest.MonkeyPatch,
    job_type: str,
) -> None:
    monkeypatch.setattr(settings, "environment", "test")
    monkeypatch.setattr(settings, "content_generator", "deterministic")
    generator = TestGenerator()
    snapshot = generation_input if job_type == "GENERATE" else humanization_input
    job = GenerationJob(job_type=job_type)
    draft, completion = generation.generate_for_job(
        cast(Session, UnusedSession()),
        job,
        snapshot(),
        generator,
    )
    assert draft.title == "测试标题" and completion is None and generator.calls == 1
    with pytest.raises(AppError) as captured:
        generation.generate_for_job(
            cast(Session, UnusedSession()),
            job,
            snapshot(classification="INTERNAL"),
            generator,
        )
    assert captured.value.code == "AI_DATA_CLASSIFICATION_FORBIDDEN"
    with pytest.raises(AppError) as captured:
        generation.generate_for_job(cast(Session, UnusedSession()), job, {}, generator)
    assert captured.value.code == "GENERATION_SNAPSHOT_INVALID"
    assert generator.calls == 1


@pytest.mark.parametrize("environment", ["development", "staging", "test"])
@pytest.mark.parametrize("mode", ["deterministic", "openai-compatible"])
def test_settings_accepts_both_modes_without_production(
    environment: str,
    mode: str,
) -> None:
    configured = Settings(
        _env_file=None,
        APP_ENV=environment,
        CONTENT_GENERATOR=mode,
        AI_ALLOW_LOCAL_HTTP=False,
    )
    assert configured.content_generator == mode


def test_settings_rejects_unknown_mode() -> None:
    with pytest.raises(ValidationError, match="仅支持 deterministic 或 openai-compatible"):
        Settings(_env_file=None, APP_ENV="test", CONTENT_GENERATOR="unknown")


def test_environment_change_does_not_reload_business_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONTENT_GENERATOR", "deterministic")
    assert generation.business_generation_enabled()
    assert Settings(_env_file=None, APP_ENV="test").content_generator == "deterministic"


@pytest.mark.parametrize("mode", ["deterministic", "openai-compatible"])
def test_production_requires_enabled_mode(mode: str) -> None:
    configuration = {
        "APP_ENV": "production",
        "CONTENT_GENERATOR": mode,
        "SESSION_SECRET": "test-production-session-boundary-32-bytes",
        "AI_CREDENTIAL_ENCRYPTION_KEY": base64.b64encode(b"1" * 32).decode(),
        "AI_ALLOW_LOCAL_HTTP": False,
        "SESSION_COOKIE_SECURE": True,
        "OBJECT_STORAGE_BACKEND": "aliyun_oss",
        "OSS_ENDPOINT": "https://oss.example.invalid",
        "OSS_BUCKET": "fixture",
        "OSS_ACCESS_KEY_ID": "fixture-id",
        "OSS_ACCESS_KEY_SECRET": "fixture-secret",
    }
    if mode == "deterministic":
        with pytest.raises(ValidationError, match="CONTENT_GENERATOR 必须为 openai-compatible"):
            Settings(_env_file=None, **configuration)
    else:
        assert Settings(_env_file=None, **configuration).content_generator == mode
