"""账号初始化与生成诊断等后端维护命令。"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from typing import Any, BinaryIO

from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models.identity import User
from app.schemas.configuration import AIChannelCreate, AIModelCreate
from app.security import hash_password
from app.services.ai_configuration import bootstrap_production_ai_configuration
from app.services.generation_dispatch import generation_diagnostics
from app.services.integrity import publication_integrity_issues

PRODUCTION_AI_BOOTSTRAP_MAX_BYTES = 64 * 1024
PRODUCTION_AI_BOOTSTRAP_REQUEST_ID = re.compile(
    r"production-bootstrap-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
)


class ProductionAIBootstrapInputError(ValueError):
    """严格 stdin envelope 不满足 maintenance 命令合同。"""

    def __init__(self, *, request_id: str | None = None) -> None:
        super().__init__("Production AI bootstrap 输入无效")
        self.request_id = request_id


@dataclass(frozen=True, slots=True)
class ProductionAIBootstrapEnvelope:
    """已通过严格边界校验的 bootstrap 输入。"""

    request_id: str
    channel: AIChannelCreate
    model: AIModelCreate


def _strict_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    """拒绝重复键，避免同一 envelope 出现两套解释。"""
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ProductionAIBootstrapInputError()
        result[key] = value
    return result


def _require_exact_keys(value: Any, expected: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise ProductionAIBootstrapInputError()
    return value


def read_production_ai_bootstrap_envelope(
    stream: BinaryIO,
) -> ProductionAIBootstrapEnvelope:
    """有界读取完整 EOF，并以严格键集合复用现有 AI 请求 Schema。"""
    raw = stream.read(PRODUCTION_AI_BOOTSTRAP_MAX_BYTES + 1)
    if not raw or len(raw) > PRODUCTION_AI_BOOTSTRAP_MAX_BYTES:
        raise ProductionAIBootstrapInputError()
    try:
        document = json.loads(raw.decode("utf-8"), object_pairs_hook=_strict_json_object)
    except (UnicodeDecodeError, json.JSONDecodeError, ProductionAIBootstrapInputError) as error:
        raise ProductionAIBootstrapInputError() from error
    root = _require_exact_keys(document, {"request_id", "credential", "channel", "model"})
    request_id = root["request_id"]
    if not isinstance(request_id, str) or not PRODUCTION_AI_BOOTSTRAP_REQUEST_ID.fullmatch(
        request_id
    ):
        raise ProductionAIBootstrapInputError()
    try:
        channel_values = _require_exact_keys(
            root["channel"],
            {
                "name",
                "description",
                "protocol_type",
                "provider_brand",
                "base_url",
                "timeout_seconds",
            },
        )
        model_values = _require_exact_keys(
            root["model"], {"display_name", "model_id", "request_parameters"}
        )
        credential = root["credential"]
        if not isinstance(credential, str):
            raise ProductionAIBootstrapInputError(request_id=request_id)
        channel = AIChannelCreate(api_key=credential, **channel_values)
        model = AIModelCreate(**model_values)
    except ProductionAIBootstrapInputError:
        raise
    except Exception as error:
        raise ProductionAIBootstrapInputError(request_id=request_id) from error
    return ProductionAIBootstrapEnvelope(
        request_id=request_id,
        channel=channel,
        model=model,
    )


def _production_ai_bootstrap_output(result: Any) -> dict[str, object]:
    """把 service 结果限制为固定、非敏感的 maintenance 输出。"""
    return {
        "status": result.status,
        "request_id": result.request_id,
        "channel_id": str(result.channel_id),
        "channel_revision": result.channel_revision,
        "channel_enabled": result.channel_enabled,
        "channel_configured": result.channel_configured,
        "model_id": str(result.model_id),
        "model_revision": result.model_revision,
        "model_test_status": result.model_test_status,
        "model_enabled": result.model_enabled,
        "model_configured": result.model_configured,
    }


def run_production_ai_bootstrap(stream: BinaryIO) -> tuple[dict[str, object], int]:
    """加载 Production 配置并执行一次严格 stdin maintenance bootstrap。"""
    request_id: str | None = None
    try:
        envelope = read_production_ai_bootstrap_envelope(stream)
        request_id = envelope.request_id
        if (
            settings.environment != "production"
            or settings.ai_allow_local_http
            or settings.content_generator != "openai-compatible"
        ):
            raise ProductionAIBootstrapInputError(request_id=request_id)
        with SessionLocal() as db:
            result = bootstrap_production_ai_configuration(
                db=db,
                channel_payload=envelope.channel,
                model_payload=envelope.model,
                request_id=request_id,
            )
    except ProductionAIBootstrapInputError as error:
        output: dict[str, object] = {"status": "REJECTED"}
        if error.request_id is not None:
            output["request_id"] = error.request_id
        return output, 2
    except Exception:
        # service 异常可能发生在任一事务提交之后，不能把未知结局伪装成
        # provider 已明确失败的终态。host 会据此保留 durable STARTED。
        output = {"status": "UNKNOWN"}
        if request_id is not None:
            output["request_id"] = request_id
        return output, 2
    output = _production_ai_bootstrap_output(result)
    return output, 0 if result.status == "SUCCEEDED" else 1


def initialize_accounts(admin_password: str, engineer_password: str) -> None:
    """幂等创建管理员和内容工程师，不覆盖任何既有账号。"""
    if len(admin_password) < 12:
        raise ValueError("管理员初始密码至少需要 12 个字符")
    if len(engineer_password) < 12:
        raise ValueError("工程师初始密码至少需要 12 个字符")
    with SessionLocal.begin() as db:
        admin = db.scalar(select(User).where(User.username == "admin"))
        if admin is None:
            db.add(
                User(
                    username="admin",
                    display_name="系统管理员",
                    password_hash=hash_password(admin_password),
                    account_type="ADMIN",
                )
            )
        content_editor = db.scalar(select(User).where(User.username == "content_editor"))
        if content_editor is None:
            db.add(
                User(
                    username="content_editor",
                    display_name="内容运营",
                    password_hash=hash_password(engineer_password),
                    account_type="ENGINEER",
                    must_change_password=True,
                )
            )
    print("已创建或确认管理员和内容工程师账号。")


def production_configuration_summary() -> dict[str, object]:
    """返回不包含凭据值的生产配置预检摘要。"""
    if settings.environment != "production":
        raise ValueError("生产配置预检要求 APP_ENV=production")
    explicit_environment = {
        "DATABASE_URL": bool(os.getenv("DATABASE_URL") or os.getenv("PARTSIGNAL_DATABASE_URL")),
        "REDIS_URL": bool(os.getenv("REDIS_URL") or os.getenv("PARTSIGNAL_REDIS_URL")),
        "PARTSIGNAL_SEED_ADMIN_PASSWORD": bool(os.getenv("PARTSIGNAL_SEED_ADMIN_PASSWORD")),
        "PARTSIGNAL_SEED_ENGINEER_PASSWORD": bool(os.getenv("PARTSIGNAL_SEED_ENGINEER_PASSWORD")),
    }
    missing = [name for name, configured in explicit_environment.items() if not configured]
    if missing:
        raise ValueError(f"Production 环境缺少显式配置：{', '.join(missing)}")
    return {
        "ai_allow_local_http": settings.ai_allow_local_http,
        "content_generator": settings.content_generator,
        "database_configured": explicit_environment["DATABASE_URL"],
        "environment": settings.environment,
        "geo_browser_collection_enabled": settings.geo_browser_collection_enabled,
        "object_storage_backend": settings.object_storage_backend,
        "oss_access_key_id_configured": bool(settings.oss_access_key_id),
        "oss_access_key_secret_configured": bool(settings.oss_access_key_secret),
        "oss_bucket_configured": bool(settings.oss_bucket),
        "oss_endpoint_configured": bool(settings.oss_endpoint),
        "redis_configured": explicit_environment["REDIS_URL"],
        "seed_admin_password_configured": explicit_environment["PARTSIGNAL_SEED_ADMIN_PASSWORD"],
        "seed_engineer_password_configured": explicit_environment[
            "PARTSIGNAL_SEED_ENGINEER_PASSWORD"
        ],
        "session_cookie_secure": settings.cookie_secure,
    }


def main() -> None:
    """解析并执行后端维护子命令。"""
    parser = argparse.ArgumentParser(description="PartSignal 后端维护命令")
    subparsers = parser.add_subparsers(dest="command", required=True)
    initialize_parser = subparsers.add_parser(
        "initialize-accounts",
        help="幂等创建管理员和内容工程师账号",
    )
    initialize_parser.add_argument(
        "--password",
        default=os.getenv("PARTSIGNAL_SEED_ADMIN_PASSWORD"),
        help="管理员初始密码，也可通过 PARTSIGNAL_SEED_ADMIN_PASSWORD 提供",
    )
    initialize_parser.add_argument(
        "--engineer-password",
        default=os.getenv("PARTSIGNAL_SEED_ENGINEER_PASSWORD"),
        help="内容工程师初始密码，也可通过 PARTSIGNAL_SEED_ENGINEER_PASSWORD 提供",
    )
    subparsers.add_parser(
        "generation-diagnostics",
        help="输出生成作业积压、近期失败和供应商耗时摘要",
    )
    integrity_parser = subparsers.add_parser(
        "preflight-integrity",
        help="只读检查阻断上线的历史业务完整性问题",
    )
    integrity_parser.add_argument(
        "--require-schema",
        action="store_true",
        help="迁移后要求核心发布表完整存在",
    )
    subparsers.add_parser(
        "preflight-production-config",
        help="校验生产配置并输出不含凭据值的摘要",
    )
    subparsers.add_parser(
        "bootstrap-production-ai",
        help="从严格 stdin envelope 初始化 Production AI 配置",
    )
    args = parser.parse_args()
    if args.command == "initialize-accounts":
        if not args.password:
            print("缺少管理员初始密码，请设置 PARTSIGNAL_SEED_ADMIN_PASSWORD。", file=sys.stderr)
            raise SystemExit(2)
        if not args.engineer_password:
            print(
                "缺少工程师初始密码，请设置 PARTSIGNAL_SEED_ENGINEER_PASSWORD。",
                file=sys.stderr,
            )
            raise SystemExit(2)
        initialize_accounts(args.password, args.engineer_password)
    elif args.command == "generation-diagnostics":
        print(json.dumps(generation_diagnostics(), ensure_ascii=False, sort_keys=True))
    elif args.command == "preflight-integrity":
        with SessionLocal() as db:
            issues = publication_integrity_issues(db, require_schema=args.require_schema)
        print(json.dumps(issues, ensure_ascii=False, sort_keys=True))
        if issues:
            raise SystemExit(1)
    elif args.command == "preflight-production-config":
        try:
            summary = production_configuration_summary()
        except ValueError as error:
            print(str(error), file=sys.stderr)
            raise SystemExit(2) from error
        print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    elif args.command == "bootstrap-production-ai":
        output, exit_code = run_production_ai_bootstrap(sys.stdin.buffer)
        print(json.dumps(output, ensure_ascii=False, sort_keys=True))
        if exit_code:
            print("Production AI bootstrap 未完成。", file=sys.stderr)
            raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
