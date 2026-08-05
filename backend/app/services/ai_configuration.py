"""AI 配置在持久化与外部调用之间的共享业务边界。"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.config import settings
from app.errors import AppError, not_found
from app.models.ai_generation import (
    AIChannel,
    AIChannelHeader,
    AIModel,
    GenerationJob,
)
from app.models.base import new_uuid
from app.models.identity import AuditLog, User
from app.schemas.common import AuditLogList, RevisionRequest
from app.schemas.configuration import (
    AIChannelApiKeyReplace,
    AIChannelCounts,
    AIChannelCreate,
    AIChannelHeaderCreate,
    AIChannelHeaderUpdate,
    AIChannelList,
    AIChannelSort,
    AIChannelStatus,
    AIChannelSummary,
    AIChannelUpdate,
    AIChannelUsageSummary,
    AIModelCreate,
    AIModelTestStatus,
    AIModelUpdate,
    AIProtocolType,
    AIProviderBrand,
    AIUsagePeriod,
)
from app.services.audit_logs import project_audit_log
from app.services.credentials import CredentialCipher
from app.services.openai_client import OpenAICompatibleClient, validate_base_url, validate_header

SUPPORTED_BRAND_PROTOCOLS = frozenset(
    (AIProtocolType.OPENAI_COMPATIBLE_CHAT_COMPLETIONS, brand) for brand in AIProviderBrand
)

AIChannelAction = Literal[
    "UPDATE",
    "REPLACE_API_KEY",
    "ENABLE",
    "DISABLE",
    "DELETE",
    "DISCOVER_MODELS",
    "CREATE_HEADER",
    "CREATE_MODEL",
]
AIModelAction = Literal["UPDATE", "TEST", "ENABLE", "DISABLE", "DELETE"]


def ai_channel_stage(
    *,
    is_enabled: bool,
    api_key_configured: bool,
    model_count: int,
    passed_model_count: int,
) -> tuple[str, str]:
    """按真实配置与测试结论投影渠道治理阶段。"""
    if not api_key_configured or model_count == 0:
        return "INCOMPLETE", "COMPLETE_CONFIGURATION"
    if passed_model_count == 0:
        return "UNVERIFIED", "TEST_MODEL"
    if not is_enabled:
        return "READY_TO_ENABLE", "ENABLE_CHANNEL"
    return "RUNNING", "VIEW_RUNTIME"


def ai_model_stage(model: AIModel, *, channel_enabled: bool) -> tuple[str, str]:
    """按模型测试、启用和所属渠道状态投影治理阶段。"""
    if model.test_status == "UNTESTED":
        return "UNTESTED", "TEST_CONNECTION"
    if model.test_status == "FAILED":
        return "TEST_FAILED", "VIEW_FAILURE_AND_RETRY"
    if not model.is_enabled:
        return "READY_TO_ENABLE", "ENABLE_MODEL"
    if not channel_enabled:
        return "CHANNEL_DISABLED", "ENABLE_CHANNEL"
    return "RUNNING", "VIEW_MODEL_RUNTIME"


def can_enable_ai_channel(*, is_enabled: bool, has_passed_model: bool) -> bool:
    """渠道仅在当前停用且至少一个模型测试通过时可启用。"""
    return not is_enabled and has_passed_model


def ai_channel_actions(*, is_enabled: bool, has_passed_model: bool) -> list[AIChannelAction]:
    """投影管理员对渠道当前可执行的资源命令。"""
    actions: list[AIChannelAction] = [
        "UPDATE",
        "REPLACE_API_KEY",
        "DELETE",
        "DISCOVER_MODELS",
        "CREATE_HEADER",
        "CREATE_MODEL",
    ]
    if is_enabled:
        actions.append("DISABLE")
    elif can_enable_ai_channel(is_enabled=is_enabled, has_passed_model=has_passed_model):
        actions.append("ENABLE")
    return actions


def can_enable_ai_model(model: AIModel) -> bool:
    """模型只有测试通过时才满足启用命令的业务门禁。"""
    return model.test_status == "PASSED"


def ai_model_actions(model: AIModel) -> list[AIModelAction]:
    """投影管理员对模型当前可执行的资源命令。"""
    actions: list[AIModelAction] = ["UPDATE", "TEST", "DELETE"]
    if model.is_enabled:
        actions.append("DISABLE")
    elif can_enable_ai_model(model):
        actions.append("ENABLE")
    return actions


def _cipher() -> CredentialCipher:
    return CredentialCipher(settings.ai_credential_encryption_key)


def _validate_channel_identity(
    protocol_type: AIProtocolType, provider_brand: AIProviderBrand
) -> None:
    """品牌不选择适配器；只接受契约中显式登记的品牌—协议组合。"""
    if (protocol_type, provider_brand) not in SUPPORTED_BRAND_PROTOCOLS:
        raise AppError("AI_PROTOCOL_BRAND_UNSUPPORTED", "供应商品牌与协议组合未登记", 422)


def require_supported_protocol(
    protocol_type: str,
) -> Literal["openai-compatible-chat-completions"]:
    """未知或尚未实现的原生协议必须明确失败，不能兼容回退。"""
    if protocol_type != AIProtocolType.OPENAI_COMPATIBLE_CHAT_COMPLETIONS:
        raise AppError("AI_PROTOCOL_UNSUPPORTED", "AI 渠道协议尚未实现", 422)
    return "openai-compatible-chat-completions"


def _search_conditions(q: str | None) -> list[ColumnElement[bool]]:
    """把 SQL 通配符按普通字符匹配，并由 SQLAlchemy 参数化查询。"""
    if q is None or not (term := q.strip()):
        return []
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"
    return [
        or_(
            AIChannel.name.ilike(pattern, escape="\\"),
            AIChannel.description.ilike(pattern, escape="\\"),
            AIChannel.base_url.ilike(pattern, escape="\\"),
        )
    ]


def list_ai_channels(
    *,
    db: Session,
    q: str | None,
    channel_status: AIChannelStatus | None,
    provider_brand: AIProviderBrand | None,
    sort: AIChannelSort,
    page: int,
    page_size: Literal[10, 20, 50],
) -> AIChannelList:
    """在数据库一次完成渠道筛选、聚合、稳定排序与分页。"""
    base_conditions = _search_conditions(q)
    if provider_brand is not None:
        base_conditions.append(AIChannel.provider_brand == provider_brand.value)

    all_count, enabled_count, disabled_count = db.execute(
        select(
            func.count(AIChannel.id),
            func.count(AIChannel.id).filter(AIChannel.is_enabled.is_(True)),
            func.count(AIChannel.id).filter(AIChannel.is_enabled.is_(False)),
        ).where(*base_conditions)
    ).one()

    filtered_conditions = list(base_conditions)
    if channel_status is not None:
        filtered_conditions.append(
            AIChannel.is_enabled.is_(channel_status == AIChannelStatus.ENABLED)
        )
    total = int(
        db.execute(select(func.count(AIChannel.id)).where(*filtered_conditions)).scalar_one()
    )

    header_count = (
        select(func.count(AIChannelHeader.id))
        .where(AIChannelHeader.channel_id == AIChannel.id)
        .correlate(AIChannel)
        .scalar_subquery()
    )
    enabled_model_count = (
        select(func.count(AIModel.id))
        .where(AIModel.channel_id == AIChannel.id, AIModel.is_enabled.is_(True))
        .correlate(AIChannel)
        .scalar_subquery()
    )
    model_count = (
        select(func.count(AIModel.id))
        .where(AIModel.channel_id == AIChannel.id)
        .correlate(AIChannel)
        .scalar_subquery()
    )
    passed_model_count = (
        select(func.count(AIModel.id))
        .where(AIModel.channel_id == AIChannel.id, AIModel.test_status == "PASSED")
        .correlate(AIChannel)
        .scalar_subquery()
    )
    latest_test_status = (
        select(AIModel.test_status)
        .where(AIModel.channel_id == AIChannel.id, AIModel.last_tested_at.is_not(None))
        .order_by(AIModel.last_tested_at.desc(), AIModel.id.desc())
        .limit(1)
        .correlate(AIChannel)
        .scalar_subquery()
    )
    last_tested_at = (
        select(AIModel.last_tested_at)
        .where(AIModel.channel_id == AIChannel.id, AIModel.last_tested_at.is_not(None))
        .order_by(AIModel.last_tested_at.desc(), AIModel.id.desc())
        .limit(1)
        .correlate(AIChannel)
        .scalar_subquery()
    )
    query = select(
        AIChannel.id,
        AIChannel.name,
        AIChannel.description,
        AIChannel.protocol_type,
        AIChannel.provider_brand,
        AIChannel.base_url,
        AIChannel.is_enabled,
        AIChannel.api_key_ciphertext,
        AIChannel.revision,
        header_count.label("header_count"),
        enabled_model_count.label("enabled_model_count"),
        model_count.label("model_count"),
        passed_model_count.label("passed_model_count"),
        latest_test_status.label("latest_test_status"),
        last_tested_at.label("last_tested_at"),
    ).where(*filtered_conditions)
    order_by = cast(
        tuple[ColumnElement[Any], ...],
        {
            AIChannelSort.CREATED_DESC: (AIChannel.created_at.desc(), AIChannel.id.asc()),
            AIChannelSort.NAME_ASC: (AIChannel.name.asc(), AIChannel.id.asc()),
            AIChannelSort.NAME_DESC: (AIChannel.name.desc(), AIChannel.id.asc()),
            AIChannelSort.UPDATED_DESC: (AIChannel.updated_at.desc(), AIChannel.id.asc()),
            AIChannelSort.LAST_TESTED_DESC: (
                last_tested_at.desc().nulls_last(),
                AIChannel.id.asc(),
            ),
        }[sort],
    )
    rows = db.execute(
        query.order_by(*order_by).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return AIChannelList(
        items=[
            AIChannelSummary(
                id=row.id,
                name=row.name,
                description=row.description,
                protocol_type=row.protocol_type,
                provider_brand=row.provider_brand,
                base_url=row.base_url,
                is_enabled=row.is_enabled,
                api_key_configured=bool(row.api_key_ciphertext),
                header_count=row.header_count,
                enabled_model_count=row.enabled_model_count,
                latest_test_status=row.latest_test_status or AIModelTestStatus.UNTESTED,
                last_tested_at=row.last_tested_at,
                workflow_stage=ai_channel_stage(
                    is_enabled=row.is_enabled,
                    api_key_configured=bool(row.api_key_ciphertext),
                    model_count=row.model_count,
                    passed_model_count=row.passed_model_count,
                )[0],
                primary_task=ai_channel_stage(
                    is_enabled=row.is_enabled,
                    api_key_configured=bool(row.api_key_ciphertext),
                    model_count=row.model_count,
                    passed_model_count=row.passed_model_count,
                )[1],
                available_actions=ai_channel_actions(
                    is_enabled=row.is_enabled,
                    has_passed_model=row.passed_model_count > 0,
                ),
                revision=row.revision,
            )
            for row in rows
        ],
        page=page,
        page_size=page_size,
        total=total,
        counts=AIChannelCounts(
            all=int(all_count or 0),
            enabled=int(enabled_count or 0),
            disabled=int(disabled_count or 0),
        ),
    )


def get_ai_channel_usage_summary(
    *, db: Session, channel_id: uuid.UUID, period: AIUsagePeriod
) -> AIChannelUsageSummary:
    """实时聚合正式业务作业；缺失耗时和用量保持为空。"""
    if db.get(AIChannel, channel_id) is None:
        raise not_found("AI 渠道")
    period_ended_at = datetime.now(UTC)
    days = {
        AIUsagePeriod.SEVEN_DAYS: 7,
        AIUsagePeriod.THIRTY_DAYS: 30,
        AIUsagePeriod.NINETY_DAYS: 90,
    }.get(period)
    period_started_at = period_ended_at - timedelta(days=days) if days is not None else None
    conditions = [GenerationJob.ai_channel_id == channel_id]
    if period_started_at is not None:
        conditions.append(GenerationJob.created_at >= period_started_at)
    (
        total_jobs,
        succeeded_jobs,
        failed_jobs,
        average_duration,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        last_used_at,
    ) = db.execute(
        select(
            func.count(GenerationJob.id),
            func.count(GenerationJob.id).filter(GenerationJob.status == "SUCCEEDED"),
            func.count(GenerationJob.id).filter(GenerationJob.status == "FAILED"),
            func.avg(GenerationJob.response_duration_ms),
            func.sum(GenerationJob.prompt_tokens),
            func.sum(GenerationJob.completion_tokens),
            func.sum(GenerationJob.total_tokens),
            func.max(GenerationJob.started_at),
        ).where(*conditions)
    ).one()
    terminal_jobs = int(succeeded_jobs or 0) + int(failed_jobs or 0)
    return AIChannelUsageSummary(
        channel_id=channel_id,
        period=period,
        period_started_at=period_started_at,
        period_ended_at=period_ended_at,
        total_jobs=int(total_jobs or 0),
        succeeded_jobs=int(succeeded_jobs or 0),
        failed_jobs=int(failed_jobs or 0),
        success_rate=(int(succeeded_jobs or 0) / terminal_jobs if terminal_jobs else None),
        average_response_duration_ms=(
            float(average_duration) if average_duration is not None else None
        ),
        prompt_tokens=int(prompt_tokens) if prompt_tokens is not None else None,
        completion_tokens=(int(completion_tokens) if completion_tokens is not None else None),
        total_tokens=int(total_tokens) if total_tokens is not None else None,
        last_used_at=last_used_at,
    )


def list_ai_channel_audit_logs(
    *, db: Session, channel_id: uuid.UUID, page: int, page_size: int
) -> AuditLogList:
    """从全局追加式审计表投影渠道及当前或显式关联的模型事件。"""
    if db.get(AIChannel, channel_id) is None:
        raise not_found("AI 渠道")
    current_model_ids = [
        str(model_id)
        for model_id in db.scalars(select(AIModel.id).where(AIModel.channel_id == channel_id))
    ]
    model_conditions = [
        AuditLog.details["facts"]["channel_id"].as_string() == str(channel_id),
        # 0024 之前的模型审计把已确认安全的渠道 ID 存在 details 顶层。
        AuditLog.details["channel_id"].as_string() == str(channel_id),
    ]
    if current_model_ids:
        model_conditions.append(AuditLog.target_id.in_(current_model_ids))
    condition = or_(
        (AuditLog.target_type == "AIChannel") & (AuditLog.target_id == str(channel_id)),
        (AuditLog.target_type == "AIModel") & or_(*model_conditions),
    )
    base_query = (
        select(AuditLog, User)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(condition, AuditLog.actor_id.is_not(None))
    )
    total = int(
        db.scalar(select(func.count(AuditLog.id)).where(condition, AuditLog.actor_id.is_not(None)))
        or 0
    )
    records = list(
        db.execute(
            base_query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return AuditLogList(
        items=[project_audit_log(record, actor) for record, actor in records],
        page=page,
        page_size=page_size,
        total=total,
    )


def invalidate_channel_models(db: Session, channel: AIChannel) -> None:
    """连接级配置变化会停用渠道和全部子模型。"""
    channel.is_enabled = False
    channel.revision += 1
    for model in db.scalars(select(AIModel).where(AIModel.channel_id == channel.id)):
        model.is_enabled = False
        model.test_status = "UNTESTED"
        model.last_tested_at = None
        model.last_test_error_summary = None
        model.revision += 1


def lock_model_configuration(db: Session, model_id: uuid.UUID) -> tuple[AIModel, AIChannel]:
    """按渠道后模型的固定顺序加锁，避免配置更新与渠道门禁竞态。"""
    channel_id = db.scalar(select(AIModel.channel_id).where(AIModel.id == model_id))
    if channel_id is None:
        raise not_found("AI 模型")
    channel = db.scalar(select(AIChannel).where(AIChannel.id == channel_id).with_for_update())
    if channel is None:
        raise not_found("AI 渠道")
    model = db.scalar(select(AIModel).where(AIModel.id == model_id).with_for_update())
    if model is None:
        raise not_found("AI 模型")
    return model, channel


def create_ai_channel(
    *, db: Session, payload: AIChannelCreate, actor: User, request_id: str
) -> AIChannel:
    """加密凭据后创建默认停用的 AI 渠道。"""
    _validate_channel_identity(payload.protocol_type, payload.provider_brand)
    name = payload.name.strip()
    if not name:
        raise AppError("INVALID_AI_CHANNEL_NAME", "AI 渠道名称不能为空", 422)
    channel_id = new_uuid()
    channel = AIChannel(
        id=channel_id,
        name=name,
        description=payload.description,
        protocol_type=payload.protocol_type.value,
        provider_brand=payload.provider_brand.value,
        base_url=validate_base_url(
            str(payload.base_url), allow_local_http=settings.ai_allow_local_http
        ),
        api_key_ciphertext=_cipher().encrypt(
            payload.api_key, associated_data=f"ai_channel:{channel_id}:api_key"
        ),
        api_key_updated_at=datetime.now(UTC),
        timeout_seconds=payload.timeout_seconds,
        created_by=actor.id,
    )
    db.add(channel)
    db.flush()
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="ai_channel.created",
            target_type="AIChannel",
            target_id=channel.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="AI 渠道已创建",
            details={
                "facts": {
                    "protocol_type": payload.protocol_type.value,
                    "provider_brand": payload.provider_brand.value,
                }
            },
        ),
    )
    db.commit()
    return channel


def delete_ai_channel(*, db: Session, channel_id: uuid.UUID, actor: User, request_id: str) -> None:
    """删除渠道及数据库约束定义的子配置。"""
    channel = db.scalar(select(AIChannel).where(AIChannel.id == channel_id).with_for_update())
    if channel is None:
        raise not_found("AI 渠道")
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="ai_channel.deleted",
            target_type="AIChannel",
            target_id=channel.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="AI 渠道已删除",
        ),
    )
    db.delete(channel)
    db.commit()


def create_ai_channel_header(
    *,
    db: Session,
    channel_id: uuid.UUID,
    payload: AIChannelHeaderCreate,
    actor: User,
    request_id: str,
) -> AIChannel:
    """新增 Header，并统一撤销依赖旧连接配置的测试结论。"""
    channel = db.scalar(select(AIChannel).where(AIChannel.id == channel_id).with_for_update())
    if channel is None:
        raise not_found("AI 渠道")
    if channel.revision != payload.expected_channel_revision:
        raise AppError("REVISION_CONFLICT", "AI 渠道已被其他请求修改", 409)
    normalized = validate_header(payload.name, payload.value)
    header_id = new_uuid()
    header = AIChannelHeader(
        id=header_id,
        channel_id=channel.id,
        name=payload.name,
        normalized_name=normalized,
        is_sensitive=payload.is_sensitive,
        plain_value=None if payload.is_sensitive else payload.value,
        encrypted_value=(
            _cipher().encrypt(payload.value, associated_data=f"ai_channel_header:{header_id}:value")
            if payload.is_sensitive
            else None
        ),
    )
    channel.headers.append(header)
    invalidate_channel_models(db, channel)
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="ai_channel_header.created",
            target_type="AIChannel",
            target_id=channel.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="AI 渠道 Header 已创建",
            details={"facts": {"is_sensitive": payload.is_sensitive}},
        ),
    )
    db.commit()
    return channel


def update_ai_channel_header(
    *,
    db: Session,
    header_id: uuid.UUID,
    payload: AIChannelHeaderUpdate,
    actor: User,
    request_id: str,
) -> AIChannel:
    """锁定 Header 与渠道后更新值，并撤销旧测试结论。"""
    header = db.scalar(
        select(AIChannelHeader).where(AIChannelHeader.id == header_id).with_for_update()
    )
    if header is None:
        raise not_found("渠道 Header")
    channel = db.scalar(
        select(AIChannel).where(AIChannel.id == header.channel_id).with_for_update()
    )
    if channel is None:
        raise not_found("AI 渠道")
    if channel.revision != payload.expected_channel_revision:
        raise AppError("REVISION_CONFLICT", "AI 渠道已被其他请求修改", 409)
    header.name = payload.name
    header.normalized_name = validate_header(payload.name, payload.value)
    header.is_sensitive = payload.is_sensitive
    header.plain_value = None if payload.is_sensitive else payload.value
    header.encrypted_value = (
        _cipher().encrypt(payload.value, associated_data=f"ai_channel_header:{header.id}:value")
        if payload.is_sensitive
        else None
    )
    invalidate_channel_models(db, channel)
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="ai_channel_header.updated",
            target_type="AIChannel",
            target_id=channel.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="AI 渠道 Header 已更新",
            details={"facts": {"is_sensitive": payload.is_sensitive}},
        ),
    )
    db.commit()
    db.refresh(channel)
    return channel


def delete_ai_channel_header(
    *, db: Session, header_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """删除 Header，并撤销渠道与模型的旧测试结论。"""
    header = db.scalar(
        select(AIChannelHeader).where(AIChannelHeader.id == header_id).with_for_update()
    )
    if header is None:
        raise not_found("渠道 Header")
    channel = db.scalar(
        select(AIChannel).where(AIChannel.id == header.channel_id).with_for_update()
    )
    if channel is None:
        raise not_found("AI 渠道")
    db.delete(header)
    invalidate_channel_models(db, channel)
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="ai_channel_header.deleted",
            target_type="AIChannel",
            target_id=channel.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="AI 渠道 Header 已删除",
        ),
    )
    db.commit()


def create_ai_model(
    *,
    db: Session,
    channel_id: uuid.UUID,
    payload: AIModelCreate,
    actor: User,
    request_id: str,
) -> AIModel:
    """在现存渠道下创建默认未测试模型。"""
    if db.get(AIChannel, channel_id) is None:
        raise not_found("AI 渠道")
    model = AIModel(
        channel_id=channel_id,
        display_name=payload.display_name.strip(),
        model_id=payload.model_id.strip(),
        request_parameters=payload.request_parameters,
        created_by=actor.id,
    )
    db.add(model)
    db.flush()
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="ai_model.created",
            target_type="AIModel",
            target_id=model.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="AI 模型已创建",
            details={"facts": {"channel_id": str(channel_id)}},
        ),
    )
    db.commit()
    return model


def delete_ai_model(*, db: Session, model_id: uuid.UUID, actor: User, request_id: str) -> None:
    """按统一锁序删除模型并追加审计。"""
    model, channel = lock_model_configuration(db, model_id)
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="ai_model.deleted",
            target_type="AIModel",
            target_id=model.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="AI 模型已删除",
            details={"facts": {"channel_id": str(channel.id)}},
        ),
    )
    db.delete(model)
    db.commit()


def update_ai_channel(
    *,
    db: Session,
    channel_id: uuid.UUID,
    payload: AIChannelUpdate,
    actor: User,
    request_id: str,
) -> AIChannel:
    """按 revision 更新渠道，并在连接变化时统一失效全部模型。"""
    channel = db.scalar(select(AIChannel).where(AIChannel.id == channel_id).with_for_update())
    if channel is None:
        raise not_found("AI 渠道")
    if channel.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "AI 渠道已被其他请求修改", 409)
    _validate_channel_identity(payload.protocol_type, payload.provider_brand)
    name = payload.name.strip()
    if not name:
        raise AppError("INVALID_AI_CHANNEL_NAME", "AI 渠道名称不能为空", 422)
    base_url = validate_base_url(
        str(payload.base_url), allow_local_http=settings.ai_allow_local_http
    )
    connection_changed = (
        channel.base_url != base_url
        or channel.timeout_seconds != payload.timeout_seconds
        or channel.protocol_type != payload.protocol_type.value
    )
    channel.name = name
    channel.description = payload.description
    channel.protocol_type = payload.protocol_type.value
    channel.provider_brand = payload.provider_brand.value
    channel.base_url = base_url
    channel.timeout_seconds = payload.timeout_seconds
    if connection_changed:
        invalidate_channel_models(db, channel)
    else:
        channel.revision += 1
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="ai_channel.updated",
            target_type="AIChannel",
            target_id=channel.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="AI 渠道已更新",
            details={"facts": {"revision": channel.revision}},
        ),
    )
    db.commit()
    return channel


def replace_ai_channel_api_key(
    *,
    db: Session,
    channel_id: uuid.UUID,
    payload: AIChannelApiKeyReplace,
    actor: User,
    request_id: str,
) -> AIChannel:
    """替换渠道凭据，并强制失效渠道与全部模型。"""
    channel = db.scalar(select(AIChannel).where(AIChannel.id == channel_id).with_for_update())
    if channel is None:
        raise not_found("AI 渠道")
    if channel.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "AI 渠道已被其他请求修改", 409)
    channel.api_key_ciphertext = _cipher().encrypt(
        payload.api_key, associated_data=f"ai_channel:{channel.id}:api_key"
    )
    channel.api_key_updated_at = datetime.now(UTC)
    invalidate_channel_models(db, channel)
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="ai_channel.api_key_replaced",
            target_type="AIChannel",
            target_id=channel.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="AI 渠道凭据已更新",
        ),
    )
    db.commit()
    return channel


def set_channel_enabled(
    *,
    db: Session,
    channel_id: uuid.UUID,
    payload: RevisionRequest,
    actor: User,
    request_id: str,
    enabled: bool,
) -> AIChannel:
    """校验测试通过门禁后切换渠道启用状态。"""
    channel = db.scalar(select(AIChannel).where(AIChannel.id == channel_id).with_for_update())
    if channel is None:
        raise not_found("AI 渠道")
    if channel.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "AI 渠道已被其他请求修改", 409)
    has_passed_model = db.scalar(
        select(AIModel.id)
        .where(AIModel.channel_id == channel.id, AIModel.test_status == "PASSED")
        .limit(1)
    ) is not None
    if enabled and not has_passed_model:
        raise AppError("AI_MODEL_NOT_TESTED", "渠道至少需要一个测试通过的模型", 409)
    channel.is_enabled = enabled
    channel.revision += 1
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action=f"ai_channel.{'enabled' if enabled else 'disabled'}",
            target_type="AIChannel",
            target_id=channel.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message=f"AI 渠道已{'启用' if enabled else '停用'}",
        ),
    )
    db.commit()
    return channel


def update_ai_model(
    *,
    db: Session,
    model_id: uuid.UUID,
    payload: AIModelUpdate,
    actor: User,
    request_id: str,
) -> AIModel:
    """按固定锁序更新模型，并在调用参数变化时撤销测试结论。"""
    model, channel = lock_model_configuration(db, model_id)
    if model.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "AI 模型已被其他请求修改", 409)
    changed = (
        model.model_id != payload.model_id.strip()
        or model.request_parameters != payload.request_parameters
    )
    model.display_name = payload.display_name.strip()
    model.model_id = payload.model_id.strip()
    model.request_parameters = payload.request_parameters
    if changed:
        model.is_enabled = False
        model.test_status = "UNTESTED"
        model.last_tested_at = None
        model.last_test_error_summary = None
    model.revision += 1
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="ai_model.updated",
            target_type="AIModel",
            target_id=model.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="AI 模型已更新",
            details={"facts": {"channel_id": str(channel.id), "revision": model.revision}},
        ),
    )
    db.commit()
    return model


def test_ai_model(*, db: Session, model_id: uuid.UUID, actor: User, request_id: str) -> AIModel:
    """真实测试后停用模型，并在同一回写事务追加脱敏审计。"""
    model, channel = lock_model_configuration(db, model_id)
    require_supported_protocol(channel.protocol_type)
    model_revision = model.revision
    channel_revision = channel.revision
    api_key, headers = request_credentials(db, channel)
    base_url = channel.base_url
    timeout_seconds = channel.timeout_seconds
    provider_model_id = model.model_id
    request_parameters = dict(model.request_parameters)
    db.commit()
    try:
        OpenAICompatibleClient(allow_local_http=settings.ai_allow_local_http).test_connection(
            base_url=base_url,
            api_key=api_key,
            headers=headers,
            timeout_seconds=timeout_seconds,
            model_id=provider_model_id,
            request_parameters=request_parameters,
        )
    except AppError as error:
        test_status = "FAILED"
        error_summary: str | None = error.message[:500]
    else:
        test_status = "PASSED"
        error_summary = None
    # 外部调用期间配置可能被其他事务修改；当前会话不会在 commit 后自动过期对象。
    db.expire_all()
    model, channel = lock_model_configuration(db, model_id)
    if model.revision != model_revision or channel.revision != channel_revision:
        raise AppError("REVISION_CONFLICT", "测试期间 AI 配置已变更，请重新测试", 409)
    model.test_status = test_status
    model.last_test_error_summary = error_summary
    model.last_tested_at = datetime.now(UTC)
    model.is_enabled = False
    model.revision += 1
    db.commit()
    return model


def discover_ai_channel_models(
    *, db: Session, channel_id: uuid.UUID, actor: User, request_id: str
) -> list[str]:
    """使用渠道真实配置发现模型。"""
    channel = db.get(AIChannel, channel_id)
    if channel is None:
        raise not_found("AI 渠道")
    require_supported_protocol(channel.protocol_type)
    api_key, headers = request_credentials(db, channel)
    return OpenAICompatibleClient(
        allow_local_http=settings.ai_allow_local_http
    ).discover_models(
        base_url=channel.base_url,
        api_key=api_key,
        headers=headers,
        timeout_seconds=channel.timeout_seconds,
    )


def set_model_enabled(
    *,
    db: Session,
    model_id: uuid.UUID,
    payload: RevisionRequest,
    actor: User,
    request_id: str,
    enabled: bool,
) -> AIModel:
    """校验连接测试结论后切换模型启用状态。"""
    model, channel = lock_model_configuration(db, model_id)
    if model.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "AI 模型已被其他请求修改", 409)
    if enabled and not can_enable_ai_model(model):
        raise AppError("AI_MODEL_NOT_TESTED", "模型必须先通过连接测试", 409)
    model.is_enabled = enabled
    model.revision += 1
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action=f"ai_model.{'enabled' if enabled else 'disabled'}",
            target_type="AIModel",
            target_id=model.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message=f"AI 模型已{'启用' if enabled else '停用'}",
            details={"facts": {"channel_id": str(channel.id)}},
        ),
    )
    db.commit()
    return model


def request_credentials(
    db: Session,
    channel: AIChannel,
    *,
    sensitive_header_names: Sequence[str] | None = None,
) -> tuple[str, dict[str, str]]:
    """仅在外部调用边界解密渠道凭据；生成作业只读取快照锁定的敏感 Header。"""
    cipher = CredentialCipher(settings.ai_credential_encryption_key)
    api_key = cipher.decrypt(
        channel.api_key_ciphertext, associated_data=f"ai_channel:{channel.id}:api_key"
    )
    query = select(AIChannelHeader).where(AIChannelHeader.channel_id == channel.id)
    expected_names: set[str] | None = None
    if sensitive_header_names is not None:
        expected_names = {name.casefold() for name in sensitive_header_names}
        if not expected_names:
            return api_key, {}
        query = query.where(
            AIChannelHeader.is_sensitive.is_(True),
            AIChannelHeader.normalized_name.in_(expected_names),
        )
    headers: dict[str, str] = {}
    found_names: set[str] = set()
    for item in db.scalars(query):
        found_names.add(item.normalized_name)
        if item.is_sensitive:
            if item.encrypted_value is None:
                raise AppError("CREDENTIAL_DECRYPTION_FAILED", "敏感 Header 未配置", 409)
            value = cipher.decrypt(
                item.encrypted_value,
                associated_data=f"ai_channel_header:{item.id}:value",
            )
        else:
            if item.plain_value is None:
                raise AppError("INVALID_HEADER", "普通 Header 未配置", 409)
            value = item.plain_value
        headers[item.name] = value
    if expected_names is not None and found_names != expected_names:
        raise AppError(
            "AI_CONFIGURATION_DELETED",
            "作业快照引用的敏感 Header 已删除或已改为普通 Header",
            409,
        )
    return api_key, headers


def build_snapshot_request_headers(
    plain_headers: dict[str, str],
    sensitive_header_names: Sequence[str],
    current_sensitive_headers: dict[str, str],
) -> dict[str, str]:
    """以快照名称组装 Header，避免配置变更改变旧作业的请求边界。"""
    current_by_normalized = {
        name.casefold(): value for name, value in current_sensitive_headers.items()
    }
    headers = dict(plain_headers)
    for name in sensitive_header_names:
        value = current_by_normalized.get(name.casefold())
        if value is None:
            raise AppError(
                "AI_CONFIGURATION_DELETED",
                "作业快照引用的敏感 Header 当前不可用",
                409,
            )
        headers[name] = value
    return headers
