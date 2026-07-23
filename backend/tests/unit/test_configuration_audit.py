"""验证配置关键命令的失败与权限拒绝审计边界。"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.audit_types import AuditOutcome
from app.errors import AppError
from app.routers import configuration


class RollbackSession:
    """只记录路由在独立审计前是否回滚业务事务。"""

    def __init__(self) -> None:
        self.rollback_count = 0

    def rollback(self) -> None:
        self.rollback_count += 1


@pytest.mark.parametrize(
    ("handler_name", "command_name", "action"),
    [
        ("put_platform_prompt", "put_platform_prompt_command", "platform_prompt.saved"),
        (
            "update_platform_profile",
            "update_platform_profile_command",
            "platform_profile.updated",
        ),
        (
            "enable_platform_profile",
            "set_platform_profile_enabled_command",
            "platform_profile.enabled",
        ),
        (
            "disable_platform_profile",
            "set_platform_profile_enabled_command",
            "platform_profile.disabled",
        ),
    ],
)
def test_configuration_key_command_records_failed_app_error(
    monkeypatch: pytest.MonkeyPatch,
    handler_name: str,
    command_name: str,
    action: str,
) -> None:
    """业务 AppError 必须先回滚，再以受控说明记录 FAILED 并原样抛出。"""
    entries: list[Any] = []
    expected_error = AppError("REVISION_CONFLICT", "不应进入审计的自由文本", 409)

    def fail_command(**_kwargs: Any) -> None:
        raise expected_error

    monkeypatch.setattr(configuration, command_name, fail_command)
    monkeypatch.setattr(configuration, "commit_audit", lambda _db, entry: entries.append(entry))
    db = RollbackSession()
    actor = SimpleNamespace(id=uuid.uuid4(), account_type="ADMIN")
    request = SimpleNamespace(state=SimpleNamespace(request_id="configuration-failed"))
    handler = getattr(configuration, handler_name)

    with pytest.raises(AppError) as caught:
        handler(uuid.uuid4(), object(), request, db, actor, None)

    assert caught.value is expected_error
    assert db.rollback_count == 1
    assert len(entries) == 1
    entry = entries[0]
    assert entry.action == action
    assert entry.outcome == AuditOutcome.FAILED
    assert entry.error_code == "REVISION_CONFLICT"
    assert "不应进入审计的自由文本" not in entry.result_message


@pytest.mark.parametrize(
    ("handler_name", "command_name", "action"),
    [
        ("put_platform_prompt", "put_platform_prompt_command", "platform_prompt.saved"),
        (
            "update_platform_profile",
            "update_platform_profile_command",
            "platform_profile.updated",
        ),
        (
            "enable_platform_profile",
            "set_platform_profile_enabled_command",
            "platform_profile.enabled",
        ),
        (
            "disable_platform_profile",
            "set_platform_profile_enabled_command",
            "platform_profile.disabled",
        ),
    ],
)
def test_configuration_key_command_records_account_type_denial(
    monkeypatch: pytest.MonkeyPatch,
    handler_name: str,
    command_name: str,
    action: str,
) -> None:
    """已认证工程师的账号类型拒绝必须留痕，且不得进入业务服务。"""
    entries: list[Any] = []

    def unexpected_command(**_kwargs: Any) -> None:
        raise AssertionError("权限拒绝后不应调用业务服务")

    monkeypatch.setattr(configuration, command_name, unexpected_command)
    monkeypatch.setattr(configuration, "commit_audit", lambda _db, entry: entries.append(entry))
    db = RollbackSession()
    actor = SimpleNamespace(id=uuid.uuid4(), account_type="ENGINEER")
    request = SimpleNamespace(state=SimpleNamespace(request_id="configuration-denied"))
    handler = getattr(configuration, handler_name)

    with pytest.raises(AppError) as caught:
        handler(uuid.uuid4(), object(), request, db, actor, None)

    assert caught.value.code == "PERMISSION_DENIED"
    assert db.rollback_count == 1
    assert len(entries) == 1
    entry = entries[0]
    assert entry.action == action
    assert entry.outcome == AuditOutcome.DENIED
    assert entry.error_code == "PERMISSION_DENIED"
