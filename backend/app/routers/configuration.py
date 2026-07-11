"""管理员维护平台类型、Prompt、AI 渠道、Header 与模型。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Request, status
from sqlalchemy import func, select

from app.audit import append_audit
from app.config import settings
from app.deps import AdminUser, CsrfProtected, DbSession
from app.errors import AppError, not_found
from app.models import (
    AIChannel,
    AIChannelHeader,
    AIModel,
    PlatformProfile,
    PlatformPrompt,
    PlatformType,
    new_uuid,
)
from app.schemas import (
    AIChannelApiKeyReplace,
    AIChannelCreate,
    AIChannelHeaderCreate,
    AIChannelHeaderOut,
    AIChannelHeaderUpdate,
    AIChannelList,
    AIChannelOut,
    AIChannelUpdate,
    AIModelCreate,
    AIModelList,
    AIModelOut,
    AIModelUpdate,
    DiscoveredModel,
    DiscoveredModelList,
    PlatformProfileOut,
    PlatformProfileUpdate,
    PlatformPromptOut,
    PlatformPromptPut,
    PlatformTypeCreate,
    PlatformTypeList,
    PlatformTypeOut,
    PlatformTypeUpdate,
    RevisionRequest,
)
from app.services.ai_configuration import request_credentials
from app.services.credentials import CredentialCipher
from app.services.openai_client import OpenAICompatibleClient, validate_base_url, validate_header

router = APIRouter(prefix="/api/v1", tags=["configuration"])


def cipher() -> CredentialCipher:
    """按进程配置创建无状态凭据加密器。"""
    return CredentialCipher(settings.ai_credential_encryption_key)


def channel_out(channel: AIChannel) -> AIChannelOut:
    """投影渠道，敏感 Header 只返回配置状态。"""
    return AIChannelOut(
        id=channel.id,
        name=channel.name,
        base_url=channel.base_url,
        timeout_seconds=channel.timeout_seconds,
        is_enabled=channel.is_enabled,
        api_key_configured=bool(channel.api_key_ciphertext),
        api_key_updated_at=channel.api_key_updated_at,
        headers=[
            AIChannelHeaderOut(
                id=item.id,
                name=item.name,
                is_sensitive=item.is_sensitive,
                is_configured=bool(item.encrypted_value if item.is_sensitive else item.plain_value),
                value=None if item.is_sensitive else item.plain_value,
            )
            for item in sorted(channel.headers, key=lambda value: value.normalized_name)
        ],
        revision=channel.revision,
        created_by=channel.created_by,
        created_at=channel.created_at,
        updated_at=channel.updated_at,
    )


def model_out(model: AIModel) -> AIModelOut:
    return AIModelOut.model_validate(model)


def platform_type_out(platform_type: PlatformType) -> PlatformTypeOut:
    return PlatformTypeOut.model_validate(platform_type)


def platform_prompt_out(prompt: PlatformPrompt) -> PlatformPromptOut:
    return PlatformPromptOut.model_validate(prompt)


def invalidate_channel_models(db: DbSession, channel: AIChannel) -> None:
    """连接级配置变化会停用渠道和全部子模型。"""
    channel.is_enabled = False
    channel.revision += 1
    for model in db.scalars(select(AIModel).where(AIModel.channel_id == channel.id)):
        model.is_enabled = False
        model.test_status = "UNTESTED"
        model.last_tested_at = None
        model.last_test_error_summary = None
        model.revision += 1


def lock_model_configuration(
    db: DbSession, model_id: uuid.UUID
) -> tuple[AIModel, AIChannel]:
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


@router.get("/platform-types", response_model=PlatformTypeList, operation_id="listPlatformTypes")
def list_platform_types(db: DbSession, _admin: AdminUser) -> PlatformTypeList:
    items = list(db.scalars(select(PlatformType).order_by(PlatformType.created_at)))
    return PlatformTypeList(items=[platform_type_out(item) for item in items])


@router.post(
    "/platform-types",
    response_model=PlatformTypeOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createPlatformType",
)
def create_platform_type(
    payload: PlatformTypeCreate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> PlatformTypeOut:
    item = PlatformType(
        name=payload.name.strip(), slug=payload.slug, created_by=admin.id
    )
    db.add(item)
    db.flush()
    append_audit(
        db,
        actor_id=admin.id,
        action="platform_type.created",
        target_type="PlatformType",
        target_id=item.id,
        request_id=request.state.request_id,
    )
    db.commit()
    return platform_type_out(item)


@router.patch(
    "/platform-types/{platform_type_id}",
    response_model=PlatformTypeOut,
    operation_id="updatePlatformType",
)
def update_platform_type(
    platform_type_id: uuid.UUID,
    payload: PlatformTypeUpdate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> PlatformTypeOut:
    item = db.scalar(
        select(PlatformType).where(PlatformType.id == platform_type_id).with_for_update()
    )
    if item is None:
        raise not_found("平台类型")
    if item.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "平台类型已被其他请求修改", 409)
    item.name = payload.name.strip()
    item.slug = payload.slug
    item.revision += 1
    append_audit(
        db,
        actor_id=admin.id,
        action="platform_type.updated",
        target_type="PlatformType",
        target_id=item.id,
        request_id=request.state.request_id,
        details={"revision": item.revision},
    )
    db.commit()
    return platform_type_out(item)


@router.delete(
    "/platform-types/{platform_type_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deletePlatformType",
)
def delete_platform_type(
    platform_type_id: uuid.UUID,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
    item = db.get(PlatformType, platform_type_id)
    if item is None:
        raise not_found("平台类型")
    if db.scalar(
        select(func.count()).select_from(PlatformProfile).where(
            PlatformProfile.platform_type_id == item.id
        )
    ):
        raise AppError("PLATFORM_TYPE_IN_USE", "平台类型仍被具体平台引用", 409)
    append_audit(
        db,
        actor_id=admin.id,
        action="platform_type.deleted",
        target_type="PlatformType",
        target_id=item.id,
        request_id=request.state.request_id,
    )
    db.delete(item)
    db.commit()


@router.get(
    "/platform-types/{platform_type_id}/prompt",
    response_model=PlatformPromptOut,
    operation_id="getPlatformPrompt",
)
def get_platform_prompt(
    platform_type_id: uuid.UUID, db: DbSession, _admin: AdminUser
) -> PlatformPromptOut:
    prompt = db.get(PlatformPrompt, platform_type_id)
    if prompt is None:
        raise not_found("平台 Prompt")
    return platform_prompt_out(prompt)


@router.put(
    "/platform-types/{platform_type_id}/prompt",
    response_model=PlatformPromptOut,
    operation_id="putPlatformPrompt",
)
def put_platform_prompt(
    platform_type_id: uuid.UUID,
    payload: PlatformPromptPut,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> PlatformPromptOut:
    if db.get(PlatformType, platform_type_id) is None:
        raise not_found("平台类型")
    prompt = db.scalar(
        select(PlatformPrompt)
        .where(PlatformPrompt.platform_type_id == platform_type_id)
        .with_for_update()
    )
    markdown = payload.template_markdown.strip()
    if not markdown:
        raise AppError("VALIDATION_ERROR", "平台 Prompt 不能为空", 422)
    if prompt is None:
        if payload.expected_revision is not None:
            raise AppError("REVISION_CONFLICT", "平台 Prompt 尚不存在", 409)
        prompt = PlatformPrompt(
            platform_type_id=platform_type_id,
            template_markdown=markdown,
            updated_by=admin.id,
        )
        db.add(prompt)
    else:
        if payload.expected_revision != prompt.revision:
            raise AppError("REVISION_CONFLICT", "平台 Prompt 已被其他请求修改", 409)
        prompt.template_markdown = markdown
        prompt.updated_by = admin.id
        prompt.revision += 1
    db.flush()
    append_audit(
        db,
        actor_id=admin.id,
        action="platform_prompt.saved",
        target_type="PlatformType",
        target_id=platform_type_id,
        request_id=request.state.request_id,
        details={"revision": prompt.revision},
    )
    db.commit()
    return platform_prompt_out(prompt)


@router.delete(
    "/platform-types/{platform_type_id}/prompt",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deletePlatformPrompt",
)
def delete_platform_prompt(
    platform_type_id: uuid.UUID,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
    prompt = db.get(PlatformPrompt, platform_type_id)
    if prompt is None:
        raise not_found("平台 Prompt")
    db.delete(prompt)
    append_audit(
        db,
        actor_id=admin.id,
        action="platform_prompt.deleted",
        target_type="PlatformType",
        target_id=platform_type_id,
        request_id=request.state.request_id,
    )
    db.commit()


@router.patch(
    "/platform-profiles/{platform_profile_id}",
    response_model=PlatformProfileOut,
    operation_id="updatePlatformProfile",
)
def update_platform_profile(
    platform_profile_id: uuid.UUID,
    payload: PlatformProfileUpdate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> PlatformProfileOut:
    from app.routers.planning import platform_profile_out

    profile = db.scalar(
        select(PlatformProfile).where(PlatformProfile.id == platform_profile_id).with_for_update()
    )
    if profile is None:
        raise not_found("平台")
    if profile.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "平台已被其他请求修改", 409)
    if db.get(PlatformType, payload.platform_type_id) is None:
        raise not_found("平台类型")
    profile.name = payload.name.strip()
    profile.allowed_domains = payload.allowed_domains
    profile.platform_type_id = payload.platform_type_id
    profile.revision += 1
    append_audit(
        db,
        actor_id=admin.id,
        action="platform_profile.updated",
        target_type="PlatformProfile",
        target_id=profile.id,
        request_id=request.state.request_id,
        details={"platform_type_id": str(profile.platform_type_id), "revision": profile.revision},
    )
    db.commit()
    return platform_profile_out(db, profile)


@router.get("/ai-channels", response_model=AIChannelList, operation_id="listAIChannels")
def list_ai_channels(db: DbSession, _admin: AdminUser) -> AIChannelList:
    channels = list(db.scalars(select(AIChannel).order_by(AIChannel.created_at)))
    return AIChannelList(items=[channel_out(item) for item in channels])


@router.post(
    "/ai-channels",
    response_model=AIChannelOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createAIChannel",
)
def create_ai_channel(
    payload: AIChannelCreate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> AIChannelOut:
    channel_id = new_uuid()
    base_url = validate_base_url(
        str(payload.base_url), allow_local_http=settings.ai_allow_local_http
    )
    channel = AIChannel(
        id=channel_id,
        name=payload.name.strip(),
        base_url=base_url,
        api_key_ciphertext=cipher().encrypt(
            payload.api_key, associated_data=f"ai_channel:{channel_id}:api_key"
        ),
        api_key_updated_at=datetime.now(UTC),
        timeout_seconds=payload.timeout_seconds,
        created_by=admin.id,
    )
    db.add(channel)
    db.flush()
    append_audit(
        db,
        actor_id=admin.id,
        action="ai_channel.created",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request.state.request_id,
    )
    db.commit()
    return channel_out(channel)


@router.get(
    "/ai-channels/{channel_id}", response_model=AIChannelOut, operation_id="getAIChannel"
)
def get_ai_channel(channel_id: uuid.UUID, db: DbSession, _admin: AdminUser) -> AIChannelOut:
    channel = db.get(AIChannel, channel_id)
    if channel is None:
        raise not_found("AI 渠道")
    return channel_out(channel)


@router.patch(
    "/ai-channels/{channel_id}", response_model=AIChannelOut, operation_id="updateAIChannel"
)
def update_ai_channel(
    channel_id: uuid.UUID,
    payload: AIChannelUpdate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> AIChannelOut:
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
        actor_id=admin.id,
        action="ai_channel.updated",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request.state.request_id,
        details={"revision": channel.revision},
    )
    db.commit()
    return channel_out(channel)


@router.put(
    "/ai-channels/{channel_id}/api-key",
    response_model=AIChannelOut,
    operation_id="replaceAIChannelApiKey",
)
def replace_ai_channel_api_key(
    channel_id: uuid.UUID,
    payload: AIChannelApiKeyReplace,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> AIChannelOut:
    channel = db.scalar(select(AIChannel).where(AIChannel.id == channel_id).with_for_update())
    if channel is None:
        raise not_found("AI 渠道")
    if channel.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "AI 渠道已被其他请求修改", 409)
    channel.api_key_ciphertext = cipher().encrypt(
        payload.api_key, associated_data=f"ai_channel:{channel.id}:api_key"
    )
    channel.api_key_updated_at = datetime.now(UTC)
    invalidate_channel_models(db, channel)
    append_audit(
        db,
        actor_id=admin.id,
        action="ai_channel.api_key_replaced",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request.state.request_id,
    )
    db.commit()
    return channel_out(channel)


def set_channel_enabled(
    channel_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    enabled: bool,
) -> AIChannelOut:
    channel = db.scalar(select(AIChannel).where(AIChannel.id == channel_id).with_for_update())
    if channel is None:
        raise not_found("AI 渠道")
    if channel.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "AI 渠道已被其他请求修改", 409)
    if enabled and not db.scalar(
        select(AIModel.id).where(
            AIModel.channel_id == channel.id, AIModel.test_status == "PASSED"
        ).limit(1)
    ):
        raise AppError("AI_MODEL_NOT_TESTED", "渠道至少需要一个测试通过的模型", 409)
    channel.is_enabled = enabled
    channel.revision += 1
    append_audit(
        db,
        actor_id=admin.id,
        action=f"ai_channel.{'enabled' if enabled else 'disabled'}",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request.state.request_id,
    )
    db.commit()
    return channel_out(channel)


@router.post(
    "/ai-channels/{channel_id}/enable",
    response_model=AIChannelOut,
    operation_id="enableAIChannel",
)
def enable_ai_channel(
    channel_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> AIChannelOut:
    return set_channel_enabled(channel_id, payload, request, db, admin, True)


@router.post(
    "/ai-channels/{channel_id}/disable",
    response_model=AIChannelOut,
    operation_id="disableAIChannel",
)
def disable_ai_channel(
    channel_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> AIChannelOut:
    return set_channel_enabled(channel_id, payload, request, db, admin, False)


@router.delete(
    "/ai-channels/{channel_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteAIChannel",
)
def delete_ai_channel(
    channel_id: uuid.UUID,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
    channel = db.get(AIChannel, channel_id)
    if channel is None:
        raise not_found("AI 渠道")
    append_audit(
        db,
        actor_id=admin.id,
        action="ai_channel.deleted",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request.state.request_id,
    )
    db.delete(channel)
    db.commit()


@router.post(
    "/ai-channels/{channel_id}/discover-models",
    response_model=DiscoveredModelList,
    operation_id="discoverAIChannelModels",
)
def discover_ai_channel_models(
    channel_id: uuid.UUID, db: DbSession, _admin: AdminUser, _csrf: CsrfProtected
) -> DiscoveredModelList:
    channel = db.get(AIChannel, channel_id)
    if channel is None:
        raise not_found("AI 渠道")
    api_key, headers = request_credentials(db, channel)
    model_ids = OpenAICompatibleClient(
        allow_local_http=settings.ai_allow_local_http
    ).discover_models(
        base_url=channel.base_url,
        api_key=api_key,
        headers=headers,
        timeout_seconds=channel.timeout_seconds,
    )
    return DiscoveredModelList(items=[DiscoveredModel(model_id=item) for item in model_ids])


@router.post(
    "/ai-channels/{channel_id}/headers",
    response_model=AIChannelOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createAIChannelHeader",
)
def create_ai_channel_header(
    channel_id: uuid.UUID,
    payload: AIChannelHeaderCreate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> AIChannelOut:
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
            cipher().encrypt(
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
        actor_id=admin.id,
        action="ai_channel_header.created",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request.state.request_id,
        details={"header_name": payload.name, "is_sensitive": payload.is_sensitive},
    )
    db.commit()
    return channel_out(channel)


@router.patch(
    "/ai-channel-headers/{header_id}",
    response_model=AIChannelOut,
    operation_id="updateAIChannelHeader",
)
def update_ai_channel_header(
    header_id: uuid.UUID,
    payload: AIChannelHeaderUpdate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> AIChannelOut:
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
        cipher().encrypt(
            payload.value, associated_data=f"ai_channel_header:{header.id}:value"
        )
        if payload.is_sensitive
        else None
    )
    invalidate_channel_models(db, channel)
    append_audit(
        db,
        actor_id=admin.id,
        action="ai_channel_header.updated",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request.state.request_id,
        details={"header_name": payload.name, "is_sensitive": payload.is_sensitive},
    )
    db.commit()
    db.refresh(channel)
    return channel_out(channel)


@router.delete(
    "/ai-channel-headers/{header_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteAIChannelHeader",
)
def delete_ai_channel_header(
    header_id: uuid.UUID,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
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
        actor_id=admin.id,
        action="ai_channel_header.deleted",
        target_type="AIChannel",
        target_id=channel.id,
        request_id=request.state.request_id,
        details={"header_name": header.name},
    )
    db.commit()


@router.get(
    "/ai-channels/{channel_id}/models", response_model=AIModelList, operation_id="listAIModels"
)
def list_ai_models(channel_id: uuid.UUID, db: DbSession, _admin: AdminUser) -> AIModelList:
    if db.get(AIChannel, channel_id) is None:
        raise not_found("AI 渠道")
    models = list(
        db.scalars(
            select(AIModel)
            .where(AIModel.channel_id == channel_id)
            .order_by(AIModel.created_at)
        )
    )
    return AIModelList(items=[model_out(item) for item in models])


@router.post(
    "/ai-channels/{channel_id}/models",
    response_model=AIModelOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createAIModel",
)
def create_ai_model(
    channel_id: uuid.UUID,
    payload: AIModelCreate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> AIModelOut:
    if db.get(AIChannel, channel_id) is None:
        raise not_found("AI 渠道")
    model = AIModel(
        channel_id=channel_id,
        display_name=payload.display_name.strip(),
        model_id=payload.model_id.strip(),
        request_parameters=payload.request_parameters,
        created_by=admin.id,
    )
    db.add(model)
    db.flush()
    append_audit(
        db,
        actor_id=admin.id,
        action="ai_model.created",
        target_type="AIModel",
        target_id=model.id,
        request_id=request.state.request_id,
    )
    db.commit()
    return model_out(model)


@router.patch("/ai-models/{model_id}", response_model=AIModelOut, operation_id="updateAIModel")
def update_ai_model(
    model_id: uuid.UUID,
    payload: AIModelUpdate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> AIModelOut:
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
        actor_id=admin.id,
        action="ai_model.updated",
        target_type="AIModel",
        target_id=model.id,
        request_id=request.state.request_id,
        details={"revision": model.revision},
    )
    db.commit()
    return model_out(model)


@router.post("/ai-models/{model_id}/test", response_model=AIModelOut, operation_id="testAIModel")
def test_ai_model(
    model_id: uuid.UUID, db: DbSession, _admin: AdminUser, _csrf: CsrfProtected
) -> AIModelOut:
    model, channel = lock_model_configuration(db, model_id)
    model_revision = model.revision
    channel_revision = channel.revision
    api_key, headers = request_credentials(db, channel)
    base_url = channel.base_url
    timeout_seconds = channel.timeout_seconds
    provider_model_id = model.model_id
    request_parameters = dict(model.request_parameters)
    # 外部调用最长可达 600 秒，释放行锁后再调用；回写时重新校验两级修订号。
    db.commit()
    test_status: str
    error_summary: str | None
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
        error_summary = error.message[:500]
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
    return model_out(model)


def set_model_enabled(
    model_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    enabled: bool,
) -> AIModelOut:
    model, _channel = lock_model_configuration(db, model_id)
    if model.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "AI 模型已被其他请求修改", 409)
    if enabled and model.test_status != "PASSED":
        raise AppError("AI_MODEL_NOT_TESTED", "模型必须先通过完整测试", 409)
    model.is_enabled = enabled
    model.revision += 1
    append_audit(
        db,
        actor_id=admin.id,
        action=f"ai_model.{'enabled' if enabled else 'disabled'}",
        target_type="AIModel",
        target_id=model.id,
        request_id=request.state.request_id,
    )
    db.commit()
    return model_out(model)


@router.post(
    "/ai-models/{model_id}/enable", response_model=AIModelOut, operation_id="enableAIModel"
)
def enable_ai_model(
    model_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> AIModelOut:
    return set_model_enabled(model_id, payload, request, db, admin, True)


@router.post(
    "/ai-models/{model_id}/disable", response_model=AIModelOut, operation_id="disableAIModel"
)
def disable_ai_model(
    model_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> AIModelOut:
    return set_model_enabled(model_id, payload, request, db, admin, False)


@router.delete(
    "/ai-models/{model_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteAIModel",
)
def delete_ai_model(
    model_id: uuid.UUID,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
    model, _channel = lock_model_configuration(db, model_id)
    append_audit(
        db,
        actor_id=admin.id,
        action="ai_model.deleted",
        target_type="AIModel",
        target_id=model.id,
        request_id=request.state.request_id,
    )
    db.delete(model)
    db.commit()
