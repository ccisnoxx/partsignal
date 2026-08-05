"""验证配置路由不再持久化失败或权限拒绝审计。"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.errors import AppError
from app.routers import configuration


class RollbackSession:
    """记录路由是否越权控制服务事务。"""

    def __init__(self) -> None:
        self.rollback_count = 0

    def rollback(self) -> None:
        self.rollback_count += 1


@pytest.mark.parametrize(
    ("handler_name", "command_name"),
    [
        (
            "update_platform_prompt",
            "update_platform_prompt_command",
        ),
        (
            "update_platform_profile",
            "update_platform_profile_command",
        ),
        (
            "enable_platform_profile",
            "set_platform_profile_enabled_command",
        ),
        (
            "disable_platform_profile",
            "set_platform_profile_enabled_command",
        ),
    ],
)
def test_configuration_key_command_propagates_app_error_without_audit_transaction(
    monkeypatch: pytest.MonkeyPatch,
    handler_name: str,
    command_name: str,
) -> None:
    """业务 AppError 原样抛出，不由路由另开审计事务。"""
    expected_error = AppError("REVISION_CONFLICT", "不应进入审计的自由文本", 409)

    def fail_command(**_kwargs: Any) -> None:
        raise expected_error

    monkeypatch.setattr(configuration, command_name, fail_command)
    db = RollbackSession()
    actor = SimpleNamespace(id=uuid.uuid4(), account_type="ADMIN")
    request = SimpleNamespace(state=SimpleNamespace(request_id="configuration-failed"))
    handler = getattr(configuration, handler_name)

    with pytest.raises(AppError) as caught:
        handler(uuid.uuid4(), object(), request, db, actor, None)

    assert caught.value is expected_error
    assert db.rollback_count == 0


@pytest.mark.parametrize(
    ("handler_name", "command_name"),
    [
        (
            "update_platform_prompt",
            "update_platform_prompt_command",
        ),
        (
            "update_platform_profile",
            "update_platform_profile_command",
        ),
        (
            "enable_platform_profile",
            "set_platform_profile_enabled_command",
        ),
        (
            "disable_platform_profile",
            "set_platform_profile_enabled_command",
        ),
    ],
)
def test_configuration_key_command_rejects_account_type_without_audit_transaction(
    monkeypatch: pytest.MonkeyPatch,
    handler_name: str,
    command_name: str,
) -> None:
    """账号类型拒绝不得进入业务服务，也不产生独立审计事务。"""

    def unexpected_command(**_kwargs: Any) -> None:
        raise AssertionError("权限拒绝后不应调用业务服务")

    monkeypatch.setattr(configuration, command_name, unexpected_command)
    db = RollbackSession()
    actor = SimpleNamespace(id=uuid.uuid4(), account_type="ENGINEER")
    request = SimpleNamespace(state=SimpleNamespace(request_id="configuration-denied"))
    handler = getattr(configuration, handler_name)

    with pytest.raises(AppError) as caught:
        handler(uuid.uuid4(), object(), request, db, actor, None)

    assert caught.value.code == "PERMISSION_DENIED"
    assert db.rollback_count == 0
