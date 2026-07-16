"""目标问题、版本化平台规则与内容任务接口。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Request, status
from sqlalchemy import select

from app.deps import AdminUser, CsrfProtected, CurrentUser, DbSession, EngineerUser
from app.errors import not_found
from app.models.configuration import (
    PlatformProfile,
    PlatformProfileVersion,
    QueryTopic,
)
from app.models.content import ContentTask
from app.schemas.common import CommandRequest
from app.schemas.configuration import (
    PlatformProfileCreate,
    PlatformProfileList,
    PlatformProfileOut,
    PlatformProfileVersionCreate,
    PlatformProfileVersionList,
    PlatformProfileVersionOut,
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
    update_query_topic as update_query_topic_command,
)
from app.services.projections import (
    content_task_out,
    platform_profile_out,
    platform_profiles_out,
    platform_version_out,
)
from app.services.publication import cancel_content_task as cancel_content_task_service

router = APIRouter(prefix="/api/v1", tags=["planning"])

ContentEditor = EngineerUser
SystemAdmin = AdminUser


def query_topic_out(topic: QueryTopic) -> QueryTopicOut:
    return QueryTopicOut(
        id=topic.id,
        canonical_question=topic.canonical_question,
        intent_type=topic.intent_type,
        variants=topic.variants,
        revision=topic.revision,
        created_at=topic.created_at,
    )


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
def list_platform_profiles(db: DbSession, _user: CurrentUser) -> PlatformProfileList:
    profiles = list(db.scalars(select(PlatformProfile).order_by(PlatformProfile.name)))
    return PlatformProfileList(items=platform_profiles_out(db, profiles))


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
    return PlatformProfileVersionList(items=[platform_version_out(item) for item in versions])


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
    admin: SystemAdmin,
    _csrf: CsrfProtected,
) -> PlatformProfileVersionOut:
    version = activate_platform_profile_version_command(
        db=db,
        platform_profile_version_id=platform_profile_version_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
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


@router.get("/content-tasks", response_model=ContentTaskList, operation_id="listContentTasks")
def list_content_tasks(db: DbSession, _user: CurrentUser) -> ContentTaskList:
    tasks = list(db.scalars(select(ContentTask).order_by(ContentTask.created_at.desc())))
    return ContentTaskList(items=[content_task_out(db, task) for task in tasks])


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
