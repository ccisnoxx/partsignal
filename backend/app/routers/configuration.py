"""管理员维护平台类型、Prompt、AI 渠道、Header 与模型。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request, Response, status
from pydantic import BeforeValidator, HttpUrl
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import commit_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.deps import (
    AdminUser,
    CsrfProtected,
    CurrentUser,
    DbSession,
    assert_account_types,
)
from app.errors import AppError, not_found
from app.models.ai_generation import (
    AIChannel,
    AIModel,
)
from app.models.configuration import (
    ContentHumanizationPrompt,
    PlatformPrompt,
    PlatformType,
)
from app.schemas.common import AccountType, AuditLogList, RevisionRequest
from app.schemas.configuration import (
    AIChannelApiKeyReplace,
    AIChannelCreate,
    AIChannelHeaderCreate,
    AIChannelHeaderOut,
    AIChannelHeaderUpdate,
    AIChannelList,
    AIChannelModelSummary,
    AIChannelOut,
    AIChannelSort,
    AIChannelStatus,
    AIChannelUpdate,
    AIChannelUsageSummary,
    AIModelCreate,
    AIModelList,
    AIModelOut,
    AIModelTestStatus,
    AIModelUpdate,
    AIProtocolType,
    AIProviderBrand,
    AIUsagePeriod,
    ContentHumanizationPromptOut,
    ContentHumanizationPromptPut,
    DiscoveredModel,
    DiscoveredModelList,
    PlatformConfigurationStatus,
    PlatformProfileDetail,
    PlatformProfileOut,
    PlatformProfileStatus,
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
    discover_ai_channel_models as discover_ai_channel_models_command,
)
from app.services.ai_configuration import (
    get_ai_channel_usage_summary as get_ai_channel_usage_summary_query,
)
from app.services.ai_configuration import (
    list_ai_channel_audit_logs as list_ai_channel_audit_logs_query,
)
from app.services.ai_configuration import list_ai_channels as list_ai_channels_query
from app.services.ai_configuration import (
    replace_ai_channel_api_key as replace_ai_channel_api_key_command,
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
from app.services.platform_configuration import (
    create_platform_type as create_platform_type_command,
)
from app.services.platform_configuration import (
    delete_platform_profile as delete_platform_profile_command,
)
from app.services.platform_configuration import (
    delete_platform_prompt as delete_platform_prompt_command,
)
from app.services.platform_configuration import (
    delete_platform_type as delete_platform_type_command,
)
from app.services.platform_configuration import (
    export_platform_profiles as export_platform_profiles_query,
)
from app.services.platform_configuration import (
    get_platform_profile_detail as get_platform_profile_detail_query,
)
from app.services.platform_configuration import (
    put_content_humanization_prompt as put_content_humanization_prompt_command,
)
from app.services.platform_configuration import (
    put_platform_prompt as put_platform_prompt_command,
)
from app.services.platform_configuration import (
    set_platform_profile_enabled as set_platform_profile_enabled_command,
)
from app.services.platform_configuration import (
    update_platform_profile as update_platform_profile_command,
)
from app.services.platform_configuration import (
    update_platform_type as update_platform_type_command,
)
from app.services.projections import platform_profile_out

router = APIRouter(prefix="/api/v1", tags=["configuration"])


def _commit_configuration_error(
    *,
    db: Session,
    actor_id: uuid.UUID,
    action: str,
    target_type: str,
    target_id: uuid.UUID,
    request_id: str,
    error: AppError,
    failure_message: str,
) -> None:
    """业务事务回滚后，以独立事务记录配置命令的失败或权限拒绝。"""
    db.rollback()
    denied = error.code == "PERMISSION_DENIED"
    commit_audit(
        db,
        AuditEntry(
            actor_id=actor_id,
            business_module=AuditModule.CONFIGURATION,
            action=action,
            target_type=target_type,
            target_id=target_id,
            request_id=request_id,
            outcome=AuditOutcome.DENIED if denied else AuditOutcome.FAILED,
            result_message=("操作因账号类型权限不足被拒绝" if denied else failure_message),
            error_code=error.code,
        )
    )


def channel_out(channel: AIChannel) -> AIChannelOut:
    """投影渠道，敏感 Header 只返回配置状态。"""
    latest_tested_model = max(
        (model for model in channel.models if model.last_tested_at is not None),
        key=lambda model: (model.last_tested_at, model.id),
        default=None,
    )
    return AIChannelOut(
        id=channel.id,
        name=channel.name,
        description=channel.description,
        protocol_type=AIProtocolType(channel.protocol_type),
        provider_brand=AIProviderBrand(channel.provider_brand),
        base_url=HttpUrl(channel.base_url),
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
        enabled_models=[
            AIChannelModelSummary(display_name=model.display_name, model_id=model.model_id)
            for model in sorted(channel.models, key=lambda value: value.display_name)
            if model.is_enabled
        ],
        latest_test_status=AIModelTestStatus(
            latest_tested_model.test_status if latest_tested_model else "UNTESTED"
        ),
        last_tested_at=(latest_tested_model.last_tested_at if latest_tested_model else None),
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


def content_humanization_prompt_out(
    prompt: ContentHumanizationPrompt,
) -> ContentHumanizationPromptOut:
    return ContentHumanizationPromptOut.model_validate(prompt)


@router.get(
    "/content-humanization-prompt",
    response_model=ContentHumanizationPromptOut,
    responses={
        status.HTTP_204_NO_CONTENT: {"description": "全局自然化 Prompt 尚未配置"}
    },
    operation_id="getContentHumanizationPrompt",
)
def get_content_humanization_prompt(
    db: DbSession, _admin: AdminUser
) -> ContentHumanizationPromptOut | Response:
    """返回当前自然化 Prompt；尚未配置时以空的 204 表达合法缺失态。"""
    prompt = db.get(ContentHumanizationPrompt, 1)
    if prompt is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return content_humanization_prompt_out(prompt)


@router.put(
    "/content-humanization-prompt",
    response_model=ContentHumanizationPromptOut,
    operation_id="putContentHumanizationPrompt",
)
def put_content_humanization_prompt(
    payload: ContentHumanizationPromptPut,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> ContentHumanizationPromptOut:
    prompt = put_content_humanization_prompt_command(
        db=db,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
    return content_humanization_prompt_out(prompt)


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


@router.get("/platform-profiles/export", operation_id="exportPlatformProfiles")
def export_platform_profiles(
    db: DbSession,
    _admin: AdminUser,
    q: str | None = Query(None, max_length=200),
    platform_type_id: uuid.UUID | None = None,
    profile_status: Annotated[PlatformProfileStatus | None, Query(alias="status")] = None,
    configuration_status: PlatformConfigurationStatus | None = None,
) -> Response:
    """导出当前筛选、权限范围和稳定排序下的平台事实列。"""
    content = export_platform_profiles_query(
        db=db,
        q=q,
        platform_type_id=platform_type_id,
        profile_status=profile_status,
        configuration_status=configuration_status,
    )
    generated_at = datetime.now(UTC).strftime("%Y%m%d-%H%M%SZ")
    return Response(
        content=content.encode("utf-8"),
        media_type="text/csv",
        headers={
            "Content-Disposition": (f'attachment; filename="platform-profiles-{generated_at}.csv"')
        },
    )


@router.get(
    "/platform-profiles/{platform_profile_id}",
    response_model=PlatformProfileDetail,
    operation_id="getPlatformProfile",
)
def get_platform_profile(
    platform_profile_id: uuid.UUID,
    db: DbSession,
    _admin: AdminUser,
) -> PlatformProfileDetail:
    return get_platform_profile_detail_query(db, platform_profile_id)


@router.get(
    "/platform-profiles/{platform_profile_id}/prompt",
    response_model=PlatformPromptOut,
    operation_id="getPlatformPrompt",
)
def get_platform_prompt(
    platform_profile_id: uuid.UUID, db: DbSession, _admin: AdminUser
) -> PlatformPromptOut:
    prompt = db.get(PlatformPrompt, platform_profile_id)
    if prompt is None:
        raise not_found("平台 Prompt")
    return platform_prompt_out(prompt)


@router.put(
    "/platform-profiles/{platform_profile_id}/prompt",
    response_model=PlatformPromptOut,
    operation_id="putPlatformPrompt",
)
def put_platform_prompt(
    platform_profile_id: uuid.UUID,
    payload: PlatformPromptPut,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
    _csrf: CsrfProtected,
) -> PlatformPromptOut:
    try:
        assert_account_types(admin, (AccountType.ADMIN,))
        prompt = put_platform_prompt_command(
            db=db,
            platform_profile_id=platform_profile_id,
            payload=payload,
            actor=admin,
            request_id=request.state.request_id,
        )
    except AppError as error:
        _commit_configuration_error(
            db=db,
            actor_id=admin.id,
            action="platform_prompt.saved",
            target_type="PlatformProfile",
            target_id=platform_profile_id,
            request_id=request.state.request_id,
            error=error,
            failure_message="平台 Prompt 保存失败",
        )
        raise
    return platform_prompt_out(prompt)


@router.delete(
    "/platform-profiles/{platform_profile_id}/prompt",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deletePlatformPrompt",
)
def delete_platform_prompt(
    platform_profile_id: uuid.UUID,
    expected_revision: Annotated[int, Query(ge=0)],
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
    delete_platform_prompt_command(
        db=db,
        platform_profile_id=platform_profile_id,
        expected_revision=expected_revision,
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
    admin: CurrentUser,
    _csrf: CsrfProtected,
) -> PlatformProfileOut:
    try:
        assert_account_types(admin, (AccountType.ADMIN,))
        profile = update_platform_profile_command(
            db=db,
            platform_profile_id=platform_profile_id,
            payload=payload,
            actor=admin,
            request_id=request.state.request_id,
        )
    except AppError as error:
        _commit_configuration_error(
            db=db,
            actor_id=admin.id,
            action="platform_profile.updated",
            target_type="PlatformProfile",
            target_id=platform_profile_id,
            request_id=request.state.request_id,
            error=error,
            failure_message="平台配置更新失败",
        )
        raise
    return platform_profile_out(db, profile)


def set_platform_profile_status(
    platform_profile_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
    enabled: bool,
) -> PlatformProfileOut:
    """复用启用和停用路由的权限、审计与投影流程。"""
    action = f"platform_profile.{'enabled' if enabled else 'disabled'}"
    try:
        assert_account_types(admin, (AccountType.ADMIN,))
        profile = set_platform_profile_enabled_command(
            db=db,
            platform_profile_id=platform_profile_id,
            payload=payload,
            actor=admin,
            request_id=request.state.request_id,
            enabled=enabled,
        )
    except AppError as error:
        _commit_configuration_error(
            db=db,
            actor_id=admin.id,
            action=action,
            target_type="PlatformProfile",
            target_id=platform_profile_id,
            request_id=request.state.request_id,
            error=error,
            failure_message=f"平台{'启用' if enabled else '停用'}失败",
        )
        raise
    return platform_profile_out(db, profile)


@router.post(
    "/platform-profiles/{platform_profile_id}/enable",
    response_model=PlatformProfileOut,
    operation_id="enablePlatformProfile",
)
def enable_platform_profile(
    platform_profile_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
    _csrf: CsrfProtected,
) -> PlatformProfileOut:
    return set_platform_profile_status(platform_profile_id, payload, request, db, admin, True)


@router.post(
    "/platform-profiles/{platform_profile_id}/disable",
    response_model=PlatformProfileOut,
    operation_id="disablePlatformProfile",
)
def disable_platform_profile(
    platform_profile_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
    _csrf: CsrfProtected,
) -> PlatformProfileOut:
    return set_platform_profile_status(platform_profile_id, payload, request, db, admin, False)


@router.delete(
    "/platform-profiles/{platform_profile_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deletePlatformProfile",
)
def delete_platform_profile(
    platform_profile_id: uuid.UUID,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
    delete_platform_profile_command(
        db=db,
        platform_profile_id=platform_profile_id,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.get("/ai-channels", response_model=AIChannelList, operation_id="listAIChannels")
def list_ai_channels(
    db: DbSession,
    _admin: AdminUser,
    q: str | None = Query(None, max_length=200),
    channel_status: Annotated[AIChannelStatus | None, Query(alias="status")] = None,
    provider_brand: AIProviderBrand | None = None,
    sort: AIChannelSort = AIChannelSort.CREATED_DESC,
    page: int = Query(1, ge=1),
    page_size: Annotated[Literal[10, 20, 50], BeforeValidator(int), Query()] = 20,
) -> AIChannelList:
    return list_ai_channels_query(
        db=db,
        q=q,
        channel_status=channel_status,
        provider_brand=provider_brand,
        sort=sort,
        page=page,
        page_size=page_size,
    )


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


@router.get("/ai-channels/{channel_id}", response_model=AIChannelOut, operation_id="getAIChannel")
def get_ai_channel(channel_id: uuid.UUID, db: DbSession, _admin: AdminUser) -> AIChannelOut:
    channel = db.get(AIChannel, channel_id)
    if channel is None:
        raise not_found("AI 渠道")
    return channel_out(channel)


@router.get(
    "/ai-channels/{channel_id}/usage-summary",
    response_model=AIChannelUsageSummary,
    operation_id="getAIChannelUsageSummary",
)
def get_ai_channel_usage_summary(
    channel_id: uuid.UUID,
    db: DbSession,
    _admin: AdminUser,
    period: AIUsagePeriod = AIUsagePeriod.THIRTY_DAYS,
) -> AIChannelUsageSummary:
    return get_ai_channel_usage_summary_query(db=db, channel_id=channel_id, period=period)


@router.get(
    "/ai-channels/{channel_id}/audit-logs",
    response_model=AuditLogList,
    operation_id="listAIChannelAuditLogs",
)
def list_ai_channel_audit_logs(
    channel_id: uuid.UUID,
    db: DbSession,
    _admin: AdminUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> AuditLogList:
    return list_ai_channel_audit_logs_query(
        db=db, channel_id=channel_id, page=page, page_size=page_size
    )


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
    channel_id: uuid.UUID,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> DiscoveredModelList:
    model_ids = discover_ai_channel_models_command(
        db=db,
        channel_id=channel_id,
        actor=admin,
        request_id=request.state.request_id,
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
            select(AIModel).where(AIModel.channel_id == channel_id).order_by(AIModel.created_at)
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
    model_id: uuid.UUID,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> AIModelOut:
    return model_out(
        test_ai_model_command(
            db=db,
            model_id=model_id,
            actor=admin,
            request_id=request.state.request_id,
        )
    )


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
