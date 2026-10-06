"""固定 API 诊断：预留当前资格、无锁出网、按依赖版本提交安全结果。"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.collectors import registry as collectors
from app.config import settings
from app.errors import AppError
from app.models.ai_generation import AIChannel, AIModel
from app.models.geo_surfaces import GeoCollectionProfile
from app.models.identity import User
from app.schemas.common import AccountType
from app.schemas.geo_surface_management import GeoCollectionProfileRead
from app.services.ai_configuration import request_credentials
from app.services.geo_collection_profiles import load_profile_facts
from app.services.geo_surface_locks import command, lock_profile, revision_conflict
from app.services.geo_surface_queries import profiles_read
from app.services.openai_client import OpenAICompatibleClient

# 禁止拼接 provider 正文、URL、Header 或 exception message。
ERROR_SUMMARIES = {
    "AI_URL_FORBIDDEN": "连接地址未通过网络安全校验",
    "AI_REDIRECT_FORBIDDEN": "服务返回了禁止的重定向",
    "AI_PROVIDER_TIMEOUT": "连接测试超时，请检查服务状态后重新测试",
    "AI_PROVIDER_UNAVAILABLE": "网络连接或 TLS 验证失败",
    "AI_PROVIDER_ERROR": "服务拒绝了诊断请求，请检查模型和凭据配置",
    "AI_RESPONSE_TOO_LARGE": "服务响应超过允许大小",
    "AI_RESPONSE_INVALID": "服务未返回有效的非空回答正文",
    "AI_CREDENTIAL_INVALID": "渠道凭据格式无效",
    "CREDENTIAL_DECRYPTION_FAILED": "渠道凭据无法读取，请重新配置",
    "INVALID_HEADER": "渠道请求头配置无效",
}


@dataclass(frozen=True)
class TestReservation:
    attempt_id: UUID
    revision: int
    surface_revision: int
    channel_revision: int
    model_revision: int
    arguments: dict[str, Any]
    credential_error: str | None


def _require_testable(db: Session, profile: GeoCollectionProfile) -> None:
    eligibility = load_profile_facts(db, [profile.id])[profile.id].eligibility(
        registry=collectors.collector_registry,
        configuration=settings,
        connection_test=True,
    )
    if not eligibility.eligible:
        raise AppError(
            "GEO_PROFILE_INELIGIBLE",
            "采集配置当前无法进行连接测试",
            409,
            {
                "blockers": [
                    {"code": item.code.value, "field": item.field} for item in eligibility.blockers
                ]
            },
        )
    # 诊断实现与批准采集分开：不得把未来登记的 adapter 默认为这个协议。
    if profile.adapter_key != "openai-compatible-chat":
        raise AppError("GEO_PROFILE_INELIGIBLE", "此 adapter 尚未实现连接测试", 409)


def _bindings(db: Session, profile: GeoCollectionProfile) -> tuple[AIChannel, AIModel]:
    channel = db.get(AIChannel, profile.ai_channel_id, populate_existing=True)
    model = db.get(AIModel, profile.ai_model_id, populate_existing=True)
    if channel is None or model is None:
        raise revision_conflict()
    return channel, model


def _changed(profile: GeoCollectionProfile) -> None:
    profile.revision += 1
    profile.updated_at = max(datetime.now(UTC), profile.updated_at)


def _reserve(db: Session, actor: User, profile_id: UUID, expected_revision: int) -> TestReservation:
    with command(db, actor):
        profile = lock_profile(db, profile_id, expected_revision)
        _require_testable(db, profile)
        channel, model = _bindings(db, profile)
        surface_revision = load_profile_facts(db, [profile.id])[profile.id].surface.revision
        error_code = None
        api_key = ""
        headers: dict[str, str] = {}
        try:
            api_key, headers = request_credentials(db, channel)
        except AppError as error:
            if error.code not in ERROR_SUMMARIES:
                raise
            error_code = error.code
        parameters = dict(model.request_parameters)
        if profile.settings_json.get("temperature") is not None:
            parameters["temperature"] = profile.settings_json["temperature"]
        # 不注入模型未选择的输出参数：既有协议可能显式使用 max_completion_tokens。
        # Profile 的显式覆盖沿用该键；未指定覆盖时原样保留模型参数。
        output_limit = profile.settings_json.get("max_output_tokens")
        if output_limit is not None:
            limit_key = (
                "max_completion_tokens" if "max_completion_tokens" in parameters else "max_tokens"
            )
            parameters[limit_key] = output_limit
        attempt_id = uuid4()
        profile.test_attempt_id = attempt_id
        profile.is_active = False
        profile.last_test_status = "UNTESTED"
        profile.last_tested_at = None
        profile.last_test_error_code = None
        profile.last_test_error_summary = None
        _changed(profile)
        db.flush()
        reservation = TestReservation(
            attempt_id,
            profile.revision,
            surface_revision,
            channel.revision,
            model.revision,
            {
                "base_url": channel.base_url,
                "api_key": api_key,
                "headers": headers,
                "timeout_seconds": channel.timeout_seconds,
                "model_id": model.model_id,
                "request_parameters": parameters,
            },
            error_code,
        )
        db.commit()
        return reservation


def test_profile(
    *, db: Session, profile_id: UUID, expected_revision: int, actor: User, request_id: str
) -> GeoCollectionProfileRead:
    reservation = _reserve(db, actor, profile_id, expected_revision)
    error_code = reservation.credential_error
    if error_code is None:
        try:
            content = OpenAICompatibleClient(
                allow_local_http=settings.ai_allow_local_http
            ).test_connection(**reservation.arguments)
            if not content.strip() or "\x00" in content:
                raise AppError("AI_RESPONSE_INVALID", "诊断回答无效", 502)
        except AppError as error:
            if error.code not in ERROR_SUMMARIES:
                raise
            error_code = error.code
    # 认证缓存和网络前的 ORM 状态不是完成授权。重新按固定锁序获取当前事实。
    db.expire_all()
    with command(db, actor) as current:
        profile = lock_profile(db, profile_id, reservation.revision)
        channel, model = _bindings(db, profile)
        facts = load_profile_facts(db, [profile.id])[profile.id]
        if (
            profile.test_attempt_id != reservation.attempt_id
            or channel.revision != reservation.channel_revision
            or model.revision != reservation.model_revision
            or facts.surface.revision != reservation.surface_revision
        ):
            raise revision_conflict()
        _require_testable(db, profile)
        profile.test_attempt_id = None
        profile.last_test_status = "FAILED" if error_code is not None else "PASSED"
        profile.last_tested_at = datetime.now(UTC)
        profile.last_test_error_code = error_code
        profile.last_test_error_summary = ERROR_SUMMARIES[error_code] if error_code else None
        profile.is_active = False
        _changed(profile)
        db.flush()
        # 永久审计的 SUCCESS 表示命令已提交；诊断成败单独存 test_status。
        append_audit(
            db,
            AuditEntry(
                actor_id=current.id,
                business_module=AuditModule.CONFIGURATION,
                action="geo_collection_profile.tested",
                target_type="GeoCollectionProfile",
                target_id=profile.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="GEO 连接测试结果已保存",
                details={
                    "facts": {
                        "revision": profile.revision,
                        "is_active": False,
                        "test_status": profile.last_test_status,
                    }
                },
            ),
        )
        result = profiles_read(db, [profile], actor_type=AccountType.ADMIN)[0]
        db.commit()
        return result
