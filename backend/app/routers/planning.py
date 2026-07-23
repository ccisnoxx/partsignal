"""目标问题、版本化平台规则与内容任务接口。"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request, status
from pydantic import BeforeValidator
from sqlalchemy import select

from app.audit import commit_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.deps import (
    AdminUser,
    CsrfProtected,
    CurrentUser,
    DbSession,
    EngineerUser,
    assert_account_types,
)
from app.errors import AppError, not_found
from app.models.configuration import (
    PlatformProfile,
    PlatformProfileVersion,
    QueryTopic,
)
from app.models.content import ContentTask
from app.schemas.common import AccountType, CommandRequest
from app.schemas.configuration import (
    PlatformConfigurationStatus,
    PlatformProfileCreate,
    PlatformProfileList,
    PlatformProfileOut,
    PlatformProfileStatus,
    PlatformProfileVersionCreate,
    PlatformProfileVersionList,
    PlatformProfileVersionOut,
    PlatformProfileVersionUpdate,
    PlatformRuleImpactSummary,
    QueryTopicCreate,
    QueryTopicList,
    QueryTopicOut,
    QueryTopicUpdate,
)
from app.schemas.content import (
    ContentTaskCreate,
    ContentTaskList,
    ContentTaskOut,
    ContentTaskUserPromptUpdate,
)
from app.services.content_planning import (
    activate_platform_profile_version as activate_platform_profile_version_command,
)
from app.services.content_planning import (
    create_content_task as create_content_task_command,
)
from app.services.content_planning import (
    create_platform_profile as create_platform_profile_command,
)
from app.services.content_planning import (
    create_platform_profile_version as create_platform_profile_version_command,
)
from app.services.content_planning import (
    create_query_topic as create_query_topic_command,
)
from app.services.content_planning import (
    retire_platform_profile_version as retire_platform_profile_version_command,
)
from app.services.content_planning import (
    update_content_task_user_prompt as update_content_task_user_prompt_command,
)
from app.services.content_planning import (
    update_platform_profile_version as update_platform_profile_version_command,
)
from app.services.content_planning import (
    update_query_topic as update_query_topic_command,
)
from app.services.platform_configuration import (
    list_platform_profiles as list_platform_profiles_query,
)
from app.services.projections import (
    content_task_out,
    content_tasks_out,
    platform_profile_out,
    platform_rule_impact,
    platform_version_out,
    platform_versions_out,
)
from app.services.publication import cancel_content_task as cancel_content_task_service

router = APIRouter(prefix="/api/v1", tags=["planning"])

ContentEditor = EngineerUser
SystemAdmin = AdminUser


def query_topic_out(topic: QueryTopic) -> QueryTopicOut:
    """把数据库枚举字符串显式解析为目标问题响应契约。"""
    return QueryTopicOut.model_validate(topic)


@router.get("/query-topics", response_model=QueryTopicList, operation_id="listQueryTopics")
def list_query_topics(db: DbSession, _user: CurrentUser) -> QueryTopicList:
    topics = list(db.scalars(select(QueryTopic).order_by(QueryTopic.created_at)))
    return QueryTopicList(items=[query_topic_out(topic) for topic in topics])


@router.post(
    "/query-topics",
    response_model=QueryTopicOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createQueryTopic",
)
def create_query_topic(
    payload: QueryTopicCreate,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> QueryTopicOut:
    topic = create_query_topic_command(
        db=db, payload=payload, actor=editor, request_id=request.state.request_id
    )
    return query_topic_out(topic)


@router.patch(
    "/query-topics/{query_topic_id}",
    response_model=QueryTopicOut,
    operation_id="updateQueryTopic",
)
def update_query_topic(
    query_topic_id: uuid.UUID,
    payload: QueryTopicUpdate,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> QueryTopicOut:
    topic = update_query_topic_command(
        db=db,
        query_topic_id=query_topic_id,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
    )
    return query_topic_out(topic)


@router.get(
    "/platform-profiles", response_model=PlatformProfileList, operation_id="listPlatformProfiles"
)
def list_platform_profiles(
    db: DbSession,
    _user: CurrentUser,
    q: str | None = Query(None, max_length=200),
    platform_type_id: uuid.UUID | None = None,
    profile_status: Annotated[PlatformProfileStatus | None, Query(alias="status")] = None,
    configuration_status: PlatformConfigurationStatus | None = None,
    page: int | None = Query(None, ge=1),
    page_size: Annotated[Literal[10, 20, 50] | None, BeforeValidator(int), Query()] = None,
) -> PlatformProfileList:
    return list_platform_profiles_query(
        db=db,
        q=q,
        platform_type_id=platform_type_id,
        profile_status=profile_status,
        configuration_status=configuration_status,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/platform-profiles",
    response_model=PlatformProfileOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createPlatformProfile",
)
def create_platform_profile(
    payload: PlatformProfileCreate,
    request: Request,
    db: DbSession,
    admin: SystemAdmin,
    _csrf: CsrfProtected,
) -> PlatformProfileOut:
    profile = create_platform_profile_command(
        db=db, payload=payload, actor=admin, request_id=request.state.request_id
    )
    return platform_profile_out(db, profile)


@router.post(
    "/platform-profiles/{platform_profile_id}/versions",
    response_model=PlatformProfileVersionOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createPlatformProfileVersion",
)
def create_platform_profile_version(
    platform_profile_id: uuid.UUID,
    payload: PlatformProfileVersionCreate,
    request: Request,
    db: DbSession,
    admin: SystemAdmin,
    _csrf: CsrfProtected,
) -> PlatformProfileVersionOut:
    version = create_platform_profile_version_command(
        db=db,
        platform_profile_id=platform_profile_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
    return platform_version_out(version)


@router.get(
    "/platform-profile-versions",
    response_model=PlatformProfileVersionList,
    operation_id="listAllPlatformProfileVersions",
)
def list_all_platform_profile_versions(
    db: DbSession, _user: CurrentUser
) -> PlatformProfileVersionList:
    """按平台名称和版本倒序返回全局规则清单。"""
    versions = list(
        db.scalars(
            select(PlatformProfileVersion)
            .join(PlatformProfile)
            .order_by(PlatformProfile.name, PlatformProfileVersion.version.desc())
        )
    )
    return PlatformProfileVersionList(items=platform_versions_out(db, versions))


@router.get(
    "/platform-profiles/{platform_profile_id}/versions",
    response_model=PlatformProfileVersionList,
    operation_id="listPlatformProfileVersions",
)
def list_platform_profile_versions(
    platform_profile_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> PlatformProfileVersionList:
    """返回平台全部规则版本，便于恢复未激活的草稿。"""
    if db.get(PlatformProfile, platform_profile_id) is None:
        raise not_found("平台配置")
    versions = list(
        db.scalars(
            select(PlatformProfileVersion)
            .where(PlatformProfileVersion.platform_profile_id == platform_profile_id)
            .order_by(PlatformProfileVersion.version.desc())
        )
    )
    return PlatformProfileVersionList(items=platform_versions_out(db, versions))


@router.patch(
    "/platform-profile-versions/{platform_profile_version_id}",
    response_model=PlatformProfileVersionOut,
    operation_id="updatePlatformProfileVersion",
)
def update_platform_profile_version(
    platform_profile_version_id: uuid.UUID,
    payload: PlatformProfileVersionUpdate,
    request: Request,
    db: DbSession,
    admin: SystemAdmin,
    _csrf: CsrfProtected,
) -> PlatformProfileVersionOut:
    version = update_platform_profile_version_command(
        db=db,
        platform_profile_version_id=platform_profile_version_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
    return platform_version_out(version)


@router.post(
    "/platform-profile-versions/{platform_profile_version_id}/activate",
    response_model=PlatformProfileVersionOut,
    operation_id="activatePlatformProfileVersion",
)
def activate_platform_profile_version(
    platform_profile_version_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
    _csrf: CsrfProtected,
) -> PlatformProfileVersionOut:
    actor_id = admin.id
    command_request_id = request.state.request_id
    try:
        assert_account_types(admin, (AccountType.ADMIN,))
        version = activate_platform_profile_version_command(
            db=db,
            platform_profile_version_id=platform_profile_version_id,
            payload=payload,
            actor=admin,
            request_id=command_request_id,
        )
    except AppError as error:
        db.rollback()
        denied = error.code == "PERMISSION_DENIED"
        commit_audit(
            db,
            AuditEntry(
                actor_id=actor_id,
                business_module=AuditModule.CONFIGURATION,
                action="platform_profile_version.activated",
                target_type="PlatformProfileVersion",
                target_id=platform_profile_version_id,
                request_id=command_request_id,
                outcome=AuditOutcome.DENIED if denied else AuditOutcome.FAILED,
                result_message=("平台规则版本激活被拒绝" if denied else "平台规则版本激活未完成"),
                error_code=error.code,
            )
        )
        raise
    return platform_version_out(version)


@router.post(
    "/platform-profile-versions/{platform_profile_version_id}/retire",
    response_model=PlatformProfileVersionOut,
    operation_id="retirePlatformProfileVersion",
)
def retire_platform_profile_version(
    platform_profile_version_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    admin: SystemAdmin,
    _csrf: CsrfProtected,
) -> PlatformProfileVersionOut:
    version = retire_platform_profile_version_command(
        db=db,
        platform_profile_version_id=platform_profile_version_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
    return platform_version_out(version)


@router.get(
    "/platform-profile-versions/{platform_profile_version_id}/impact",
    response_model=PlatformRuleImpactSummary,
    operation_id="getPlatformProfileVersionImpact",
)
def get_platform_profile_version_impact(
    platform_profile_version_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> PlatformRuleImpactSummary:
    """返回直接绑定当前规则版本的互斥内容任务影响摘要。"""
    return platform_rule_impact(db, platform_profile_version_id)


@router.get("/content-tasks", response_model=ContentTaskList, operation_id="listContentTasks")
def list_content_tasks(
    db: DbSession,
    _user: CurrentUser,
    platform_profile_id: uuid.UUID | None = None,
    platform_profile_version_id: uuid.UUID | None = None,
) -> ContentTaskList:
    query = select(ContentTask)
    if platform_profile_version_id is not None:
        query = query.where(ContentTask.platform_profile_version_id == platform_profile_version_id)
    if platform_profile_id is not None:
        query = query.join(
            PlatformProfileVersion,
            PlatformProfileVersion.id == ContentTask.platform_profile_version_id,
        ).where(PlatformProfileVersion.platform_profile_id == platform_profile_id)
    tasks = list(db.scalars(query.order_by(ContentTask.created_at.desc())))
    return ContentTaskList(items=content_tasks_out(db, tasks))


@router.post(
    "/content-tasks",
    response_model=ContentTaskOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createContentTask",
)
def create_content_task(
    payload: ContentTaskCreate,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> ContentTaskOut:
    task = create_content_task_command(
        db=db, payload=payload, actor=editor, request_id=request.state.request_id
    )
    return content_task_out(db, task)


@router.get(
    "/content-tasks/{content_task_id}",
    response_model=ContentTaskOut,
    operation_id="getContentTask",
)
def get_content_task(
    content_task_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> ContentTaskOut:
    task = db.get(ContentTask, content_task_id)
    if task is None:
        raise not_found("内容任务")
    return content_task_out(db, task)


@router.patch(
    "/content-tasks/{content_task_id}/user-prompt",
    response_model=ContentTaskOut,
    operation_id="updateContentTaskUserPrompt",
)
def update_content_task_user_prompt(
    content_task_id: uuid.UUID,
    payload: ContentTaskUserPromptUpdate,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> ContentTaskOut:
    task = update_content_task_user_prompt_command(
        db=db,
        content_task_id=content_task_id,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
    )
    return content_task_out(db, task)


@router.post(
    "/content-tasks/{content_task_id}/cancel",
    response_model=ContentTaskOut,
    operation_id="cancelContentTask",
)
def cancel_content_task(
    content_task_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> ContentTaskOut:
    task = cancel_content_task_service(
        db=db,
        task_id=content_task_id,
        expected_revision=payload.expected_revision,
        comment=payload.comment,
        actor=editor,
        request_id=request.state.request_id,
    )
    return content_task_out(db, task)
