"""管理员维护平台类型、Prompt、AI 渠道、Header 与模型。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Request, status
from sqlalchemy import select

from app.config import settings
from app.deps import AdminUser, CsrfProtected, DbSession
from app.errors import not_found
from app.models.ai_generation import (
    AIChannel,
    AIModel,
)
from app.models.configuration import (
    PlatformPrompt,
    PlatformType,
)
from app.schemas.common import RevisionRequest
from app.schemas.configuration import (
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
)
from app.services.ai_configuration import create_ai_channel as create_ai_channel_command
from app.services.ai_configuration import (
    create_ai_channel_header as create_ai_channel_header_command,
)
from app.services.ai_configuration import create_ai_model as create_ai_model_command
from app.services.ai_configuration import delete_ai_channel as delete_ai_channel_command
from app.services.ai_configuration import (
    delete_ai_channel_header as delete_ai_channel_header_command,
)
from app.services.ai_configuration import delete_ai_model as delete_ai_model_command
from app.services.ai_configuration import (
    replace_ai_channel_api_key as replace_ai_channel_api_key_command,
)
from app.services.ai_configuration import (
    request_credentials,
)
from app.services.ai_configuration import (
    set_channel_enabled as set_channel_enabled_command,
)
from app.services.ai_configuration import (
    set_model_enabled as set_model_enabled_command,
)
from app.services.ai_configuration import (
    test_ai_model as test_ai_model_command,
)
from app.services.ai_configuration import (
    update_ai_channel as update_ai_channel_command,
)
from app.services.ai_configuration import (
    update_ai_channel_header as update_ai_channel_header_command,
)
from app.services.ai_configuration import (
    update_ai_model as update_ai_model_command,
)
from app.services.openai_client import OpenAICompatibleClient
from app.services.platform_configuration import (
    create_platform_type as create_platform_type_command,
)
from app.services.platform_configuration import (
    delete_platform_prompt as delete_platform_prompt_command,
)
from app.services.platform_configuration import (
    delete_platform_type as delete_platform_type_command,
)
from app.services.platform_configuration import (
    put_platform_prompt as put_platform_prompt_command,
)
from app.services.platform_configuration import (
    update_platform_profile as update_platform_profile_command,
)
from app.services.platform_configuration import (
    update_platform_type as update_platform_type_command,
)
from app.services.projections import platform_profile_out

router = APIRouter(prefix="/api/v1", tags=["configuration"])


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
    item = create_platform_type_command(
        db=db,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
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
    item = update_platform_type_command(
        db=db,
        platform_type_id=platform_type_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
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
    delete_platform_type_command(
        db=db,
        platform_type_id=platform_type_id,
        actor=admin,
        request_id=request.state.request_id,
    )


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
    prompt = put_platform_prompt_command(
        db=db,
        platform_type_id=platform_type_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
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
    delete_platform_prompt_command(
        db=db,
        platform_type_id=platform_type_id,
        actor=admin,
        request_id=request.state.request_id,
    )


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
    profile = update_platform_profile_command(
        db=db,
        platform_profile_id=platform_profile_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
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
    channel = create_ai_channel_command(
        db=db, payload=payload, actor=admin, request_id=request.state.request_id
    )
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
    channel = update_ai_channel_command(
        db=db,
        channel_id=channel_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
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
    channel = replace_ai_channel_api_key_command(
        db=db,
        channel_id=channel_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
    return channel_out(channel)


def set_channel_enabled(
    channel_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    enabled: bool,
) -> AIChannelOut:
    channel = set_channel_enabled_command(
        db=db,
        channel_id=channel_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
        enabled=enabled,
    )
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
    delete_ai_channel_command(
        db=db, channel_id=channel_id, actor=admin, request_id=request.state.request_id
    )


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
    channel = create_ai_channel_header_command(
        db=db,
        channel_id=channel_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
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
    channel = update_ai_channel_header_command(
        db=db,
        header_id=header_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
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
    delete_ai_channel_header_command(
        db=db, header_id=header_id, actor=admin, request_id=request.state.request_id
    )


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
    model = create_ai_model_command(
        db=db,
        channel_id=channel_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
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
    model = update_ai_model_command(
        db=db,
        model_id=model_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
    return model_out(model)


@router.post("/ai-models/{model_id}/test", response_model=AIModelOut, operation_id="testAIModel")
def test_ai_model(
    model_id: uuid.UUID, db: DbSession, _admin: AdminUser, _csrf: CsrfProtected
) -> AIModelOut:
    return model_out(test_ai_model_command(db, model_id))


def set_model_enabled(
    model_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    enabled: bool,
) -> AIModelOut:
    model = set_model_enabled_command(
        db=db,
        model_id=model_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
        enabled=enabled,
    )
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
    delete_ai_model_command(
        db=db, model_id=model_id, actor=admin, request_id=request.state.request_id
    )
