"""AI 配置在持久化与外部调用之间的共享业务边界。"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.config import settings
from app.errors import AppError, not_found
from app.models.ai_generation import (
    AIChannel,
    AIChannelHeader,
    AIModel,
)
from app.models.base import new_uuid
from app.models.identity import User
from app.schemas.common import RevisionRequest
from app.schemas.configuration import (
    AIChannelApiKeyReplace,
    AIChannelCreate,
    AIChannelHeaderCreate,
    AIChannelHeaderUpdate,
    AIChannelUpdate,
    AIModelCreate,
    AIModelUpdate,
)
from app.services.credentials import CredentialCipher
from app.services.openai_client import OpenAICompatibleClient, validate_base_url, validate_header


def _cipher() -> CredentialCipher:
    return CredentialCipher(settings.ai_credential_encryption_key)


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
    channel_id = new_uuid()
    channel = AIChannel(
        id=channel_id,
        name=payload.name.strip(),
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
        actor_id=actor.id,
        action="ai_channel.created",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request_id,
    )
    db.commit()
    return channel


def delete_ai_channel(
    *, db: Session, channel_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """删除渠道及数据库约束定义的子配置。"""
    channel = db.get(AIChannel, channel_id)
    if channel is None:
        raise not_found("AI 渠道")
    append_audit(
        db,
        actor_id=actor.id,
        action="ai_channel.deleted",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request_id,
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
            _cipher().encrypt(
                payload.value, associated_data=f"ai_channel_header:{header_id}:value"
            )
            if payload.is_sensitive
            else None
        ),
    )
    channel.headers.append(header)
    invalidate_channel_models(db, channel)
    append_audit(
        db,
        actor_id=actor.id,
        action="ai_channel_header.created",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request_id,
        details={"header_name": payload.name, "is_sensitive": payload.is_sensitive},
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
        actor_id=actor.id,
        action="ai_channel_header.updated",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request_id,
        details={"header_name": payload.name, "is_sensitive": payload.is_sensitive},
    )
    db.commit()
    db.refresh(channel)
    return channel


def delete_ai_channel_header(
    *, db: Session, header_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """删除 Header，并撤销渠道与模型的旧测试结论。"""
    header = db.get(AIChannelHeader, header_id)
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
        actor_id=actor.id,
        action="ai_channel_header.deleted",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request_id,
        details={"header_name": header.name},
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
        actor_id=actor.id,
        action="ai_model.created",
        target_type="AIModel",
        target_id=model.id,
        request_id=request_id,
    )
    db.commit()
    return model


def delete_ai_model(
    *, db: Session, model_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """按统一锁序删除模型并追加审计。"""
    model, _channel = lock_model_configuration(db, model_id)
    append_audit(
        db,
        actor_id=actor.id,
        action="ai_model.deleted",
        target_type="AIModel",
        target_id=model.id,
        request_id=request_id,
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
    base_url = validate_base_url(
        str(payload.base_url), allow_local_http=settings.ai_allow_local_http
    )
    connection_changed = (
        channel.base_url != base_url or channel.timeout_seconds != payload.timeout_seconds
    )
    channel.name = payload.name.strip()
    channel.base_url = base_url
    channel.timeout_seconds = payload.timeout_seconds
    if connection_changed:
        invalidate_channel_models(db, channel)
    else:
        channel.revision += 1
    append_audit(
        db,
        actor_id=actor.id,
        action="ai_channel.updated",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request_id,
        details={"revision": channel.revision},
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
        actor_id=actor.id,
        action="ai_channel.api_key_replaced",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request_id,
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
    if enabled and not db.scalar(
        select(AIModel.id)
        .where(AIModel.channel_id == channel.id, AIModel.test_status == "PASSED")
        .limit(1)
    ):
        raise AppError("AI_MODEL_NOT_TESTED", "渠道至少需要一个测试通过的模型", 409)
    channel.is_enabled = enabled
    channel.revision += 1
    append_audit(
        db,
        actor_id=actor.id,
        action=f"ai_channel.{'enabled' if enabled else 'disabled'}",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request_id,
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
    model, _channel = lock_model_configuration(db, model_id)
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
        actor_id=actor.id,
        action="ai_model.updated",
        target_type="AIModel",
        target_id=model.id,
        request_id=request_id,
        details={"revision": model.revision},
    )
    db.commit()
    return model


def test_ai_model(db: Session, model_id: uuid.UUID) -> AIModel:
    """释放外部调用期间的行锁，并在回写前复核渠道和模型 revision。"""
    model, channel = lock_model_configuration(db, model_id)
    model_revision = model.revision
    channel_revision = channel.revision
    api_key, headers = request_credentials(db, channel)
    base_url = channel.base_url
    timeout_seconds = channel.timeout_seconds
    provider_model_id = model.model_id
    request_parameters = dict(model.request_parameters)
    db.commit()
    try:
        OpenAICompatibleClient(allow_local_http=settings.ai_allow_local_http).complete(
            base_url=base_url,
            api_key=api_key,
            headers=headers,
            timeout_seconds=timeout_seconds,
            model_id=provider_model_id,
            request_parameters=request_parameters,
            system_message="Return one JSON object with title, summary, body_markdown, and tags.",
            user_message="Return a short non-business connectivity test response.",
        )
    except AppError as error:
        test_status = "FAILED"
        error_summary: str | None = error.message[:500]
    else:
        test_status = "PASSED"
        error_summary = None
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


def set_model_enabled(
    *,
    db: Session,
    model_id: uuid.UUID,
    payload: RevisionRequest,
    actor: User,
    request_id: str,
    enabled: bool,
) -> AIModel:
    """校验测试结论后切换模型启用状态。"""
    model, _channel = lock_model_configuration(db, model_id)
    if model.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "AI 模型已被其他请求修改", 409)
    if enabled and model.test_status != "PASSED":
        raise AppError("AI_MODEL_NOT_TESTED", "模型必须先通过完整测试", 409)
    model.is_enabled = enabled
    model.revision += 1
    append_audit(
        db,
        actor_id=actor.id,
        action=f"ai_model.{'enabled' if enabled else 'disabled'}",
        target_type="AIModel",
        target_id=model.id,
        request_id=request_id,
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
