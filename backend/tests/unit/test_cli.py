"""验证后端维护命令的生产初始化与脱敏预检合同。"""

from __future__ import annotations

import json
import sys
from types import SimpleNamespace

import pytest

from app import cli


def test_initialize_accounts_command_uses_public_initialization_owner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """CLI 只把两个受控初始密码交给唯一账号初始化实现。"""
    received: list[tuple[str, str]] = []
    monkeypatch.setattr(
        cli,
        "initialize_accounts",
        lambda admin, engineer: received.append((admin, engineer)),
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "app.cli",
            "initialize-accounts",
            "--password",
            "admin-password",
            "--engineer-password",
            "engineer-password",
        ],
    )

    cli.main()

    assert received == [("admin-password", "engineer-password")]


def test_production_configuration_summary_contains_status_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """生产预检输出状态与固定枚举，不泄露 URL、密钥或存储名称。"""
    monkeypatch.setattr(
        cli,
        "settings",
        SimpleNamespace(
            environment="production",
            ai_allow_local_http=False,
            content_generator="openai-compatible",
            database_url="postgresql://user:secret@postgres/database",
            object_storage_backend="aliyun_oss",
            oss_access_key_id="secret-id",
            oss_access_key_secret="secret-key",
            oss_bucket="private-bucket",
            oss_endpoint="https://private-endpoint.example",
            redis_url="redis://redis:6379/0",
            cookie_secure=True,
        ),
    )
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:secret@postgres/database")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/0")
    monkeypatch.setenv("PARTSIGNAL_SEED_ADMIN_PASSWORD", "admin-secret-value")
    monkeypatch.setenv("PARTSIGNAL_SEED_ENGINEER_PASSWORD", "engineer-secret-value")

    encoded = json.dumps(cli.production_configuration_summary(), sort_keys=True)

    for secret_value in (
        "user:secret",
        "secret-id",
        "secret-key",
        "private-bucket",
        "private-endpoint",
        "admin-secret-value",
        "engineer-secret-value",
    ):
        assert secret_value not in encoded
    assert '\"environment\": \"production\"' in encoded
    assert '\"oss_access_key_secret_configured\": true' in encoded


def test_production_configuration_summary_rejects_non_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """防止把开发或预发布配置误报为 Production 已通过。"""
    monkeypatch.setattr(cli, "settings", SimpleNamespace(environment="staging"))

    with pytest.raises(ValueError, match="APP_ENV=production"):
        cli.production_configuration_summary()


def test_production_configuration_summary_requires_explicit_runtime_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """默认数据库或 Redis URL 不得被误报为 Production 已配置。"""
    monkeypatch.setattr(cli, "settings", SimpleNamespace(environment="production"))
    for name in (
        "DATABASE_URL",
        "PARTSIGNAL_DATABASE_URL",
        "REDIS_URL",
        "PARTSIGNAL_REDIS_URL",
        "PARTSIGNAL_SEED_ADMIN_PASSWORD",
        "PARTSIGNAL_SEED_ENGINEER_PASSWORD",
    ):
        monkeypatch.delenv(name, raising=False)

    with pytest.raises(ValueError, match="DATABASE_URL.*REDIS_URL"):
        cli.production_configuration_summary()
