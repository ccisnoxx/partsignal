"""验证后端维护命令的生产初始化与脱敏预检合同。"""

from __future__ import annotations

import json
import sys
import uuid
from io import BytesIO
from types import SimpleNamespace

import pytest

from app import cli
from app.schemas.configuration import AIChannelHeaderCreate
from app.services.ai_configuration import ProductionAIBootstrapResult


def _bootstrap_envelope(**overrides: object) -> bytes:
    payload: dict[str, object] = {
        "request_id": "production-bootstrap-123e4567-e89b-42d3-a456-426614174000",
        "credential": "credential-must-not-leak",
        "channel": {
            "name": "Production channel",
            "description": "Production bootstrap",
            "protocol_type": "openai-compatible-chat-completions",
            "provider_brand": "CUSTOM",
            "base_url": "https://provider.example/v1",
            "timeout_seconds": 30,
        },
        "model": {
            "display_name": "Production model",
            "model_id": "exact-model-id",
            "request_parameters": {"temperature": 0},
        },
    }
    payload.update(overrides)
    return json.dumps(payload).encode()


@pytest.mark.parametrize("length", [160, 161])
def test_production_bootstrap_header_name_fits_database(length: int) -> None:
    """maintenance 名称容量在任何数据库写入前与现有 varchar(160) 一致。"""
    payload = _bootstrap_envelope(
        headers=[{"name": "X-" + "a" * (length - 2), "value": "test", "is_sensitive": True}]
    )
    if length == 161:
        with pytest.raises(cli.ProductionAIBootstrapInputError):
            cli.read_production_ai_bootstrap_envelope(BytesIO(payload))
    else:
        parsed = cli.read_production_ai_bootstrap_envelope(BytesIO(payload))
        assert len(parsed.headers[0].name) == 160


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
            geo_browser_collection_enabled=False,
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
    assert '"environment": "production"' in encoded
    assert '"geo_browser_collection_enabled": false' in encoded
    assert '"oss_access_key_secret_configured": true' in encoded


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


@pytest.mark.parametrize(
    "headers",
    [
        None,
        [],
        [
            {"name": "X-Workspace", "value": "plain-must-not-leak", "is_sensitive": False},
            {"name": "X-Access", "value": "sensitive-must-not-leak", "is_sensitive": True},
        ],
    ],
    ids=["omitted", "empty", "plain-and-sensitive"],
)
def test_production_ai_bootstrap_stdin_reuses_schemas_and_outputs_status_only(
    headers: list[dict[str, object]] | None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """maintenance stdin 只生成现有 Schema，并返回固定非敏感投影。"""
    received: list[object] = []
    monkeypatch.setattr(
        cli,
        "settings",
        SimpleNamespace(
            environment="production",
            ai_allow_local_http=False,
            content_generator="openai-compatible",
        ),
    )

    def bootstrap(**values: object) -> ProductionAIBootstrapResult:
        received.append(values)
        return ProductionAIBootstrapResult(
            status="SUCCEEDED",
            request_id="production-bootstrap-123e4567-e89b-42d3-a456-426614174000",
            channel_id=uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
            channel_revision=1,
            channel_enabled=True,
            channel_configured=True,
            model_id=uuid.UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
            model_revision=2,
            model_test_status="PASSED",
            model_enabled=True,
            model_configured=True,
        )

    monkeypatch.setattr(cli, "bootstrap_production_ai_configuration", bootstrap)

    envelope = _bootstrap_envelope(**({"headers": headers} if headers is not None else {}))
    output, exit_code = cli.run_production_ai_bootstrap(BytesIO(envelope))

    assert exit_code == 0
    assert output == {
        "status": "SUCCEEDED",
        "request_id": "production-bootstrap-123e4567-e89b-42d3-a456-426614174000",
        "channel_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "channel_revision": 1,
        "channel_enabled": True,
        "channel_configured": True,
        "model_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "model_revision": 2,
        "model_test_status": "PASSED",
        "model_enabled": True,
        "model_configured": True,
    }
    values = received[0]
    assert isinstance(values, dict)
    assert values["channel_payload"].api_key == "credential-must-not-leak"
    assert values["model_payload"].model_id == "exact-model-id"
    assert all(isinstance(item, AIChannelHeaderCreate) for item in values["header_payloads"])
    assert [
        item.model_dump(exclude={"expected_channel_revision"}) for item in values["header_payloads"]
    ] == (headers or [])
    assert "credential-must-not-leak" not in json.dumps(output)
    assert "provider.example" not in json.dumps(output)
    for item in headers or []:
        assert item["name"] not in json.dumps(output)
        assert item["value"] not in json.dumps(output)


@pytest.mark.parametrize(
    "payload",
    [
        b"not-json",
        _bootstrap_envelope() + b" trailing",
        _bootstrap_envelope(custom_headers=[]),
        _bootstrap_envelope().replace(
            b'"credential": "credential-must-not-leak",',
            b'"credential": "first-value", "credential": "duplicate-value",',
        ),
        b"{" + b"x" * cli.PRODUCTION_AI_BOOTSTRAP_MAX_BYTES + b"}",
    ],
)
def test_production_ai_bootstrap_rejects_malformed_oversized_or_unknown_input(
    payload: bytes,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """malformed、trailing、超限与未知键都在 service 前 fail closed。"""
    monkeypatch.setattr(
        cli,
        "bootstrap_production_ai_configuration",
        lambda **_values: pytest.fail("无效输入不得进入 service"),
    )

    output, exit_code = cli.run_production_ai_bootstrap(BytesIO(payload))

    assert exit_code == 2
    assert output["status"] == "REJECTED"
    assert "credential-must-not-leak" not in json.dumps(output)


@pytest.mark.parametrize(
    "headers",
    [
        None,
        {},
        "header-value-must-not-leak",
        [None],
        [{"name": "X-Valid", "value": "header-value-must-not-leak"}],
        [
            {
                "name": "X-Valid",
                "value": "header-value-must-not-leak",
                "is_sensitive": True,
                "expected_channel_revision": 0,
            }
        ],
        [
            {
                "name": "X-Valid",
                "value": "header-value-must-not-leak",
                "is_sensitive": True,
                "unexpected": "header-value-must-not-leak",
            }
        ],
        [{"name": 1, "value": "header-value-must-not-leak", "is_sensitive": True}],
        [{"name": "X-Valid", "value": 1, "is_sensitive": True}],
        [{"name": "X-Valid", "value": "header-value-must-not-leak", "is_sensitive": 1}],
        [{"name": "X-Valid", "value": "header-value-must-not-leak", "is_sensitive": "true"}],
        [{"name": "", "value": "header-value-must-not-leak", "is_sensitive": True}],
        [{"name": "X-Valid", "value": "", "is_sensitive": True}],
        [{"name": "X Bad", "value": "header-value-must-not-leak", "is_sensitive": True}],
        [{"name": "X-Bad\n", "value": "header-value-must-not-leak", "is_sensitive": True}],
        [
            {"name": "X-Valid", "value": "header-value-must-not-leak", "is_sensitive": True},
            {"name": "x-valid", "value": "second-must-not-leak", "is_sensitive": False},
        ],
        *[
            [{"name": name, "value": "header-value-must-not-leak", "is_sensitive": True}]
            for name in (
                "Authorization",
                "HOST",
                "Content-Length",
                "Connection",
                "Transfer-Encoding",
            )
        ],
        *[
            [
                {
                    "name": "X-Valid",
                    "value": f"header-value-must-not-leak{character}",
                    "is_sensitive": True,
                }
            ]
            for character in ("\r", "\n", "\t", "\0", "\x7f", "\u0100")
        ],
    ],
    ids=[
        "null-list",
        "object-list",
        "string-list",
        "null-item",
        "missing-key",
        "external-revision",
        "unknown-key",
        "non-string-name",
        "non-string-value",
        "numeric-sensitive",
        "string-sensitive",
        "empty-name",
        "empty-value",
        "invalid-token",
        "name-control-character",
        "casefold-duplicate",
        "reserved-authorization",
        "reserved-host",
        "reserved-content-length",
        "reserved-connection",
        "reserved-transfer-encoding",
        "value-cr",
        "value-lf",
        "value-tab",
        "value-nul",
        "value-del",
        "value-non-latin1",
    ],
)
def test_production_ai_bootstrap_rejects_invalid_headers_without_disclosure(
    headers: object,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Header 只接受精确键和类型，注入、保留名与重复名称不进入 service。"""
    monkeypatch.setattr(
        cli,
        "bootstrap_production_ai_configuration",
        lambda **_values: pytest.fail("无效 Header 不得进入 service"),
    )
    monkeypatch.setattr(sys, "argv", ["app.cli", "bootstrap-production-ai"])
    monkeypatch.setattr(
        sys, "stdin", SimpleNamespace(buffer=BytesIO(_bootstrap_envelope(headers=headers)))
    )

    with pytest.raises(SystemExit) as error:
        cli.main()

    captured = capsys.readouterr()
    assert error.value.code == 2
    assert json.loads(captured.out)["status"] == "REJECTED"
    assert captured.err == "Production AI bootstrap 未完成。\n"
    assert "header-value-must-not-leak" not in captured.out + captured.err
    assert "second-must-not-leak" not in captured.out + captured.err
    assert "credential-must-not-leak" not in captured.out + captured.err


def test_production_ai_bootstrap_rejects_duplicate_header_object_keys() -> None:
    """JSON 重复键不能绕过 Header item 的精确 envelope。"""
    envelope = _bootstrap_envelope(
        headers=[{"name": "X-Valid", "value": "original", "is_sensitive": True}]
    ).replace(b'"value": "original",', b'"value": "original", "value": "replacement",')

    output, exit_code = cli.run_production_ai_bootstrap(BytesIO(envelope))

    assert exit_code == 2
    assert output == {"status": "REJECTED"}


def test_production_ai_bootstrap_rejects_valid_envelope_outside_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """合法 envelope 在非 Production Settings 下也不得进入 service。"""
    monkeypatch.setattr(
        cli,
        "settings",
        SimpleNamespace(
            environment="staging",
            ai_allow_local_http=False,
            content_generator="openai-compatible",
        ),
    )
    monkeypatch.setattr(
        cli,
        "bootstrap_production_ai_configuration",
        lambda **_values: pytest.fail("非 Production 不得进入 service"),
    )

    output, exit_code = cli.run_production_ai_bootstrap(BytesIO(_bootstrap_envelope()))

    assert exit_code == 2
    assert output == {
        "status": "REJECTED",
        "request_id": "production-bootstrap-123e4567-e89b-42d3-a456-426614174000",
    }


def test_production_ai_bootstrap_unknown_never_serializes_secret_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Pydantic、SQL 或 provider 异常正文都不能跨 maintenance 输出边界。"""
    monkeypatch.setattr(
        cli,
        "settings",
        SimpleNamespace(
            environment="production",
            ai_allow_local_http=False,
            content_generator="openai-compatible",
        ),
    )
    monkeypatch.setattr(
        cli,
        "bootstrap_production_ai_configuration",
        lambda **_values: (_ for _ in ()).throw(
            RuntimeError(
                "credential-must-not-leak header-value-must-not-leak "
                "provider response SQL traceback"
            )
        ),
    )

    output, exit_code = cli.run_production_ai_bootstrap(
        BytesIO(
            _bootstrap_envelope(
                headers=[
                    {"name": "X-Valid", "value": "header-value-must-not-leak", "is_sensitive": True}
                ]
            )
        )
    )
    encoded = json.dumps(output)

    assert exit_code == 2
    assert output == {
        "status": "UNKNOWN",
        "request_id": "production-bootstrap-123e4567-e89b-42d3-a456-426614174000",
    }
    assert "credential-must-not-leak" not in encoded
    assert "header-value-must-not-leak" not in encoded
    assert "provider response" not in encoded
    assert "traceback" not in encoded
