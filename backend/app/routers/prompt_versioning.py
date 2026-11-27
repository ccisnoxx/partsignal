"""Slice 3A：Prompt 不可变版本化与平台版本绑定/回滚 API 路由。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, status

from app.deps import AdminUser, CsrfProtected, CurrentUser, DbSession, assert_account_types
from app.errors import error_responses
from app.schemas.common import AccountType
from app.schemas.prompt_versioning import (
    PlatformPromptBindingOut,
    PlatformPromptVersionActionCommand,
    PlatformPromptVersionBindCommand,
    PlatformPromptVersionCreate,
    PlatformPromptVersionDraftUpdate,
    PlatformPromptVersionList,
    PlatformPromptVersionOut,
)
from app.services.prompt_version_queries import (
    get_platform_prompt_binding,
    list_platform_prompt_versions,
)
from app.services.prompt_versioning import (
    bind_platform_prompt_version,
    create_platform_prompt_version,
    transition_platform_prompt_version,
    update_platform_prompt_version_draft,
)

router = APIRouter(prefix="/api/v1", tags=["configuration"])


def _prompt_version_read_snapshot(db: DbSession) -> None:
    """确保版本列表、效果统计与平台绑定在单次一致快照内完成。"""
    db.autoflush = False
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})


@router.get(
    "/platform-prompts/{platform_prompt_id}/versions",
    response_model=PlatformPromptVersionList,
    operation_id="listPlatformPromptVersions",
    responses=error_responses(401, 403, 404, 422),
    dependencies=[Depends(_prompt_version_read_snapshot)],
)
def list_prompt_versions_route(
    platform_prompt_id: uuid.UUID,
    db: DbSession,
    _admin: AdminUser,
) -> PlatformPromptVersionList:
    """列出指定 Prompt 全部不可变版本及实时效果指标。"""
    return list_platform_prompt_versions(db, platform_prompt_id)


@router.post(
    "/platform-prompts/{platform_prompt_id}/versions",
    response_model=PlatformPromptVersionOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createPlatformPromptVersion",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_prompt_version_route(
    platform_prompt_id: uuid.UUID,
    payload: PlatformPromptVersionCreate,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
    _csrf: CsrfProtected,
) -> PlatformPromptVersionOut:
    """为指定 Prompt 创建新草稿或直接发布不可变版本。"""
    assert_account_types(admin, (AccountType.ADMIN,))
    return create_platform_prompt_version(
        db=db,
        platform_prompt_id=platform_prompt_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.put(
    "/platform-prompt-versions/{version_id}",
    response_model=PlatformPromptVersionOut,
    operation_id="updatePlatformPromptVersionDraft",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_prompt_version_draft_route(
    version_id: uuid.UUID,
    payload: PlatformPromptVersionDraftUpdate,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
    _csrf: CsrfProtected,
) -> PlatformPromptVersionOut:
    """更新尚未发布的 Prompt 草稿版本。"""
    assert_account_types(admin, (AccountType.ADMIN,))
    return update_platform_prompt_version_draft(
        db=db,
        version_id=version_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/platform-prompt-versions/{version_id}/publish",
    response_model=PlatformPromptVersionOut,
    operation_id="publishPlatformPromptVersion",
    responses=error_responses(401, 403, 404, 409, 422),
)
def publish_prompt_version_route(
    version_id: uuid.UUID,
    payload: PlatformPromptVersionActionCommand,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
    _csrf: CsrfProtected,
) -> PlatformPromptVersionOut:
    """发布并永久冻结 Prompt 草稿版本。"""
    assert_account_types(admin, (AccountType.ADMIN,))
    return transition_platform_prompt_version(
        db=db,
        version_id=version_id,
        expected_revision=payload.expected_revision,
        action="publish",
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/platform-prompt-versions/{version_id}/archive",
    response_model=PlatformPromptVersionOut,
    operation_id="archivePlatformPromptVersion",
    responses=error_responses(401, 403, 404, 409, 422),
)
def archive_prompt_version_route(
    version_id: uuid.UUID,
    payload: PlatformPromptVersionActionCommand,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
    _csrf: CsrfProtected,
) -> PlatformPromptVersionOut:
    """归档未被任何平台绑定的已发布 Prompt 版本。"""
    assert_account_types(admin, (AccountType.ADMIN,))
    return transition_platform_prompt_version(
        db=db,
        version_id=version_id,
        expected_revision=payload.expected_revision,
        action="archive",
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/platform-prompt-versions/{version_id}/restore",
    response_model=PlatformPromptVersionOut,
    operation_id="restorePlatformPromptVersion",
    responses=error_responses(401, 403, 404, 409, 422),
)
def restore_prompt_version_route(
    version_id: uuid.UUID,
    payload: PlatformPromptVersionActionCommand,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
    _csrf: CsrfProtected,
) -> PlatformPromptVersionOut:
    """将已归档 Prompt 版本恢复为可绑定发布状态以支持回滚。"""
    assert_account_types(admin, (AccountType.ADMIN,))
    return transition_platform_prompt_version(
        db=db,
        version_id=version_id,
        expected_revision=payload.expected_revision,
        action="restore",
        actor=admin,
        request_id=request.state.request_id,
    )


@router.get(
    "/platform-profiles/{platform_profile_id}/prompt-binding",
    response_model=PlatformPromptBindingOut,
    operation_id="getPlatformPromptBinding",
    responses=error_responses(401, 403, 404, 422),
    dependencies=[Depends(_prompt_version_read_snapshot)],
)
def get_platform_prompt_binding_route(
    platform_profile_id: uuid.UUID,
    db: DbSession,
    _admin: AdminUser,
) -> PlatformPromptBindingOut:
    """读取平台当前的 Prompt 版本绑定与全部可供切换/回滚的已发布版本。"""
    return get_platform_prompt_binding(db, platform_profile_id)


@router.post(
    "/platform-profiles/{platform_profile_id}/bind-prompt-version",
    response_model=PlatformPromptBindingOut,
    operation_id="bindPlatformPromptVersion",
    responses=error_responses(401, 403, 404, 409, 422),
)
def bind_platform_prompt_version_route(
    platform_profile_id: uuid.UUID,
    payload: PlatformPromptVersionBindCommand,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
    _csrf: CsrfProtected,
) -> PlatformPromptBindingOut:
    """显式将平台绑定或回滚到指定的已发布不可变 Prompt 版本。"""
    assert_account_types(admin, (AccountType.ADMIN,))
    return bind_platform_prompt_version(
        db=db,
        platform_profile_id=platform_profile_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
