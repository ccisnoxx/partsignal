#!/usr/bin/env python3
"""在发布准备阶段只读检查 runtime 文件与 AI 非 secret 输入，不交付或激活配置。"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
GENERATED_SECRETS = (
    "POSTGRES_PASSWORD",
    "SESSION_SECRET",
    "UPLOAD_SIGNING_SECRET",
    "PARTSIGNAL_SEED_ADMIN_PASSWORD",
    "PARTSIGNAL_SEED_ENGINEER_PASSWORD",
)
# 既有 runtime 无需补键或轮换密钥；功能默认关闭，Worker 参数使用 Settings 默认值。
OPTIONAL_GEO_SETTINGS = {
    "GEO_MONITORING_ENABLED",
    "GEO_API_COLLECTION_ENABLED",
    "GEO_BROWSER_COLLECTION_ENABLED",
    "GEO_OPPORTUNITY_EVALUATION_ENABLED",
    "GEO_PENDING_REDISPATCH_SECONDS",
    "GEO_COLLECTION_FINALIZE_GRACE_SECONDS",
    "GEO_RECOVERY_SCAN_SECONDS",
    "GEO_RECOVERY_BATCH_SIZE",
    "GEO_RETENTION_DRY_RUN",
    "GEO_RETENTION_BATCH_SIZE",
    "GEO_RAW_PAYLOAD_RETENTION_DAYS",
    "GEO_TERMINAL_DRAFT_RETENTION_DAYS",
    "GEO_UNREFERENCED_FILE_RETENTION_DAYS",
}


class InputError(ValueError):
    """错误仅包含固定 code 与已知字段名，禁止携带输入值。"""


def read_private(path: Path) -> str:
    """拒绝非普通文件与宽松权限；只读一个显式输入，不发现其他 env。"""
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as source:
        metadata = os.fstat(source.fileno())
        if (
            not stat.S_ISREG(metadata.st_mode)
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or metadata.st_uid != os.geteuid()
        ):
            raise InputError("INPUT_FILE_METADATA_INVALID")
        raw = source.read(131073)
    if len(raw) > 131072:
        raise InputError("INPUT_FILE_TOO_LARGE")
    return raw.decode("utf-8")


def parse_runtime(text: str) -> dict[str, str]:
    """只接受无插值、无引号或内联注释的单行 literal key=value。"""
    if any(
        ord(character) < 32 and character != "\n" or ord(character) == 127 for character in text
    ):
        raise InputError("ENV_CONTROL_CHARACTER")
    values: dict[str, str] = {}
    for line in text.split("\n"):
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            raise InputError("ENV_LITERAL_SYNTAX_REQUIRED")
        if key in values:
            raise InputError("ENV_DUPLICATE_KEY")
        if any(character in value for character in "$`\"'#") or value != value.strip():
            raise InputError("ENV_INTERPOLATION_OR_QUOTING")
        values[key] = value
    return values


def check_runtime(values: dict[str, str]) -> list[str]:
    """补足 Compose 消费前的输入合同；应用类型和边界继续由真实 backend 预检拥有。"""
    template = parse_runtime((ROOT / ".env.production.example").read_text())
    if not set(template) - OPTIONAL_GEO_SETTINGS <= set(values) <= set(template) | OPTIONAL_GEO_SETTINGS:
        raise InputError("ENV_KEY_SET_MISMATCH")
    # Browser 是生产固定边界；不能因 Monitoring 开启或模板被改写而放行。
    if values.get("GEO_BROWSER_COLLECTION_ENABLED", "false") != "false":
        raise InputError("PRODUCTION_FIXED_VALUE_REQUIRED:GEO_BROWSER_COLLECTION_ENABLED")
    missing = sorted(key for key in values if key != "VITE_API_BASE_URL" and not values[key])
    if missing:
        return missing
    for key in (
        "APP_ENV",
        "REDIS_URL",
        "SESSION_COOKIE_SECURE",
        "CORS_ALLOWED_ORIGINS",
        "CONTENT_GENERATOR",
        "AI_ALLOW_LOCAL_HTTP",
        "GENERATION_EAGER",
        "OBJECT_STORAGE_BACKEND",
        "VITE_API_BASE_URL",
    ):
        if values[key] != template[key]:
            raise InputError(f"PRODUCTION_FIXED_VALUE_REQUIRED:{key}")
    for key in GENERATED_SECRETS:
        if not re.fullmatch(r"[A-Za-z0-9_-]{43,}", values[key]):
            raise InputError(f"URL_SAFE_SECRET_REQUIRED:{key}")
    generated = [values[key] for key in GENERATED_SECRETS] + [
        values["AI_CREDENTIAL_ENCRYPTION_KEY"]
    ]
    if len(set(generated)) != len(generated):
        raise InputError("GENERATED_SECRETS_MUST_BE_DISTINCT")
    database = urlsplit(values["DATABASE_URL"])
    if not (
        database.scheme == "postgresql+psycopg"
        and database.hostname == "postgres"
        and database.port == 5432
        and not database.query
        and not database.fragment
        and unquote(database.username or "") == values["POSTGRES_USER"]
        and unquote(database.password or "") == values["POSTGRES_PASSWORD"]
        and unquote(database.path) == "/" + values["POSTGRES_DB"]
    ):
        raise InputError("DATABASE_IDENTITY_MISMATCH")
    endpoint = urlsplit(values["OSS_ENDPOINT"])
    host = endpoint.hostname or ""
    if not (
        endpoint.scheme == "https"
        and host.endswith(".aliyuncs.com")
        and endpoint.port in (None, 443)
        and endpoint.username is None
        and endpoint.password is None
        and endpoint.path in ("", "/")
        and not endpoint.query
        and not endpoint.fragment
    ):
        raise InputError("OSS_ENDPOINT_INVALID")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", values["OSS_BUCKET"]):
        raise InputError("OSS_BUCKET_INVALID")
    return []


def check_deployment_boundary(values: dict[str, str], environment: dict[str, str]) -> None:
    """在维护锁/状态变更/Compose 前拒绝 Browser 绕过；只依赖宿主机标准库。"""
    expected_compose = ROOT / "deploy/compose.prod.yaml"
    if Path(environment.get("COMPOSE_FILE", str(expected_compose))).resolve() != (
        expected_compose.resolve()
    ):
        raise InputError("PRODUCTION_COMPOSE_OVERLAY_FORBIDDEN")
    for source in (values, environment):
        profiles = source.get("COMPOSE_PROFILES", "").split(",")
        if any(profile.strip() not in {"", "production-async"} for profile in profiles):
            raise InputError("PRODUCTION_COMPOSE_PROFILE_FORBIDDEN")
        if source.get("GEO_BROWSER_COLLECTION_ENABLED", "false") != "false":
            raise InputError("PRODUCTION_FIXED_VALUE_REQUIRED:GEO_BROWSER_COLLECTION_ENABLED")
        if any(value for key, value in source.items() if key.startswith((
            "GEO_BROWSER_SESSION_", "PARTSIGNAL_GEO_BROWSER_SESSION_"
        ))):
            raise InputError("PRODUCTION_BROWSER_SESSION_FORBIDDEN")
    if values.get("APP_ENV") != "production":
        raise InputError("PRODUCTION_FIXED_VALUE_REQUIRED:APP_ENV")


def strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise InputError("AI_DUPLICATE_KEY")
        result[key] = value
    return result


def check_ai(path: Path) -> tuple[dict[str, object], list[str]]:
    value = json.loads(read_private(path), object_pairs_hook=strict_object)
    template = json.loads((ROOT / "deploy/production-ai.example.json").read_text())
    if not isinstance(value, dict) or set(value) != set(template):
        raise InputError("AI_KEY_SET_MISMATCH")
    missing = [
        key
        for key in (
            "channel_name",
            "provider_brand",
            "base_url",
            "model_display_name",
            "model_id",
            "credential_owner",
        )
        if not isinstance(value[key], str) or not value[key].strip()
    ]
    missing += [
        key
        for key in (
            "chat_completions_compatibility_confirmed",
            "credential_ready",
            "credential_owner_tty_handoff_confirmed",
        )
        if value[key] is not True
    ]
    if value["custom_headers_required"] is not False:
        raise InputError("AI_CUSTOM_HEADERS_UNSUPPORTED")
    credential_budget = value["credential_json_bytes_upper_bound"]
    if type(credential_budget) is not int or credential_budget < 0 or credential_budget in (1, 2):
        raise InputError("AI_CREDENTIAL_BUDGET_INVALID")
    if credential_budget == 0:
        missing.append("credential_json_bytes_upper_bound")
    if missing:
        return value, sorted(missing)
    endpoint = urlsplit(value["base_url"])
    if not (
        endpoint.scheme == "https"
        and endpoint.hostname
        and endpoint.username is None
        and endpoint.password is None
        and not endpoint.query
        and not endpoint.fragment
    ):
        raise InputError("AI_HTTPS_BASE_URL_REQUIRED")
    if type(value["timeout_seconds"]) is not int or not isinstance(
        value["request_parameters"], dict
    ):
        raise InputError("AI_METADATA_TYPE_INVALID")
    return value, []


BACKEND_CHECK = """
import io, ipaddress, json, sys
from urllib.parse import urlsplit
try:
    from app.cli import (PRODUCTION_AI_BOOTSTRAP_MAX_BYTES,
        production_configuration_summary, read_production_ai_bootstrap_envelope)
    document = json.load(sys.stdin)
    summary = production_configuration_summary() if document['check_runtime'] else 'NOT_CHECKED'
    ai = document['ai']
    if ai is not None:
        envelope = {
            'request_id': 'production-bootstrap-00000000-0000-4000-8000-000000000000',
            'credential': '',
            'channel': {'name': ai['channel_name'], 'description': ai['channel_description'],
                'protocol_type': ai['protocol_type'], 'provider_brand': ai['provider_brand'],
                'base_url': ai['base_url'], 'timeout_seconds': ai['timeout_seconds']},
            'model': {'display_name': ai['model_display_name'], 'model_id': ai['model_id'],
                'request_parameters': ai['request_parameters']},
        }
        def encode():
            return json.dumps(envelope, ensure_ascii=False, separators=(',', ':'),
                allow_nan=False).encode('utf-8')
        # Host 使用同一 UTF-8 紧凑 JSON 格式；所有 UUID request ID 长度固定。
        # 空 credential JSON 为 2 bytes；仅以 owner 声明的上界替代，绝不读取真实 Key。
        required_bytes = len(encode()) - 2 + ai['credential_json_bytes_upper_bound']
        if required_bytes > PRODUCTION_AI_BOOTSTRAP_MAX_BYTES:
            print(json.dumps({'status':'FAILED','code':'AI_BOOTSTRAP_ENVELOPE_TOO_LARGE'}))
            sys.exit(2)
        envelope['credential'] = 'x'
        parsed = read_production_ai_bootstrap_envelope(io.BytesIO(encode()))
        # HttpUrl 会把缩写、十六进制等 IPv4 写法规范化；必须检查真实 consumer 的值。
        hostname = urlsplit(str(parsed.channel.base_url)).hostname.rstrip('.')
        try:
            address = ipaddress.ip_address(hostname)
        except ValueError:
            address = None
        if hostname.lower() == 'localhost' or address is not None and not address.is_global:
            print(json.dumps({'status':'FAILED','code':'AI_PUBLIC_ADDRESS_REQUIRED'}))
            sys.exit(2)
    print(json.dumps({'status':'PASSED','runtime':summary}))
except Exception:
    print(json.dumps({'status':'FAILED','code':'BACKEND_CONFIG_OR_AI_SCHEMA_INVALID'}))
    sys.exit(2)
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runtime_file", type=Path, nargs="?")
    parser.add_argument("--ai-inputs", type=Path)
    parser.add_argument(
        "--deployment-boundary", action="store_true",
        help="部署入口在维护锁和状态变更前检查 production Browser/profile/overlay 边界",
    )
    parser.add_argument(
        "--ai-only", action="store_true", help="只检查 AI 输入，复用已验证的服务器 runtime 文件"
    )
    args = parser.parse_args()
    if args.deployment_boundary and (args.ai_only or args.ai_inputs is not None):
        parser.error("--deployment-boundary 仅检查 runtime_file，不能组合 AI 检查")
    if args.ai_only:
        if args.runtime_file is not None or args.ai_inputs is None:
            parser.error("--ai-only 需要 --ai-inputs，不能同时提供 runtime_file")
    elif args.runtime_file is None:
        parser.error("需要 runtime_file；只检查 AI 时使用 --ai-only --ai-inputs")
    try:
        values = (
            {"APP_ENV": "test"} if args.ai_only else parse_runtime(read_private(args.runtime_file))
        )
        if args.deployment_boundary:
            check_deployment_boundary(values, dict(os.environ))
            print(json.dumps({"status": "PASSED", "production_browser_boundary": "PASSED"}))
            return 0
        missing_runtime = [] if args.ai_only else check_runtime(values)
        ai, missing_ai = check_ai(args.ai_inputs) if args.ai_inputs else (None, [])
        if missing_runtime or missing_ai:
            print(
                json.dumps(
                    {
                        "status": "NOT_READY",
                        "missing_runtime": missing_runtime,
                        "missing_ai": missing_ai,
                    },
                    ensure_ascii=False,
                )
            )
            return 2
        # 清空继承配置并隔离 cwd，不能让另一份 .env 或已导出的开发变量影响结果。
        with tempfile.TemporaryDirectory(prefix="partsignal-input-check-") as directory:
            result = subprocess.run(
                [sys.executable, "-B", "-c", BACKEND_CHECK],
                cwd=directory,
                env={**values, "PYTHONPATH": str(ROOT / "backend")},
                input=json.dumps({"ai": ai, "check_runtime": not args.ai_only}, allow_nan=False),
                capture_output=True,
                text=True,
            )
        # 只接受固定输出结构，不把异常、URL、凭据或子进程原始 stderr 写到终端。
        summary = json.loads(result.stdout)
        if result.returncode or result.stderr or summary.get("status") != "PASSED":
            if not result.stderr and summary.get("code") in {
                "AI_BOOTSTRAP_ENVELOPE_TOO_LARGE",
                "AI_PUBLIC_ADDRESS_REQUIRED",
            }:
                raise InputError(summary["code"])
            raise InputError("BACKEND_CONFIG_OR_AI_SCHEMA_INVALID")
        print(
            json.dumps(
                {
                    "status": "PASSED",
                    "runtime": summary["runtime"],
                    "ai_inputs": "PASSED" if ai is not None else "NOT_CHECKED",
                    "external_services_gate": "NOT_RUN",
                },
                ensure_ascii=False,
            )
        )
        return 0
    except InputError as error:
        print(json.dumps({"status": "FAILED", "code": str(error)}, ensure_ascii=False))
    except Exception:
        print(json.dumps({"status": "FAILED", "code": "INPUT_CHECK_FAILED"}))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
