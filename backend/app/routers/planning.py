"""目标问题、平台身份与内容任务接口。"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Query, Request, status
from pydantic import BeforeValidator
from sqlalchemy import select

from app.deps import AdminUser, CsrfProtected, CurrentUser, DbSession, EngineerUser
from app.errors import not_found
from app.models.configuration import QueryTopic
from app.models.content import ContentTask
from app.schemas.common import CommandRequest, RevisionRequest
from app.schemas.configuration import (
    PlatformConfigurationStatus,
    PlatformProfileCreate,
    PlatformProfileList,
    PlatformProfileOut,
    PlatformProfileStatus,
    QueryTopicCreate,
    QueryTopicList,
    QueryTopicOut,
    QueryTopicUpdate,
)
from app.schemas.content import (
    ContentTaskArchiveStatus,
    ContentTaskCreate,
    ContentTaskList,
    ContentTaskOut,
    ContentTaskPermanentDeleteRequest,
    ContentTaskPermanentDeletionPreview,
)
from app.services.content_planning import (
    create_content_task as create_content_task_command,
)
from app.services.content_planning import (
    create_platform_profile as create_platform_profile_command,
)
from app.services.content_planning import create_query_topic as create_query_topic_command
from app.services.content_planning import delete_query_topic as delete_query_topic_command
from app.services.content_planning import query_topic_out, query_topics_out
from app.services.content_planning import update_query_topic as update_query_topic_command
from app.services.platform_configuration import (
    list_platform_profiles as list_platform_profiles_query,
)
from app.services.projections import content_task_out, content_tasks_out, platform_profile_out
from app.services.publication import (
    archive_content_task as archive_content_task_service,
)
from app.services.publication import cancel_content_task as cancel_content_task_service
from app.services.publication import delete_content_task as delete_content_task_service
from app.services.publication import (
    permanently_delete_content_task as permanently_delete_content_task_service,
)
from app.services.publication import (
    preview_content_task_permanent_deletion as preview_content_task_permanent_deletion_service,
)
from app.services.publication import (
    restore_content_task as restore_content_task_service,
)

router = APIRouter(prefix="/api/v1", tags=["planning"])

ContentEditor = EngineerUser
SystemAdmin = AdminUser


@router.get("/query-topics", response_model=QueryTopicList, operation_id="listQueryTopics")
def list_query_topics(db: DbSession, user: CurrentUser) -> QueryTopicList:
    topics = list(db.scalars(select(QueryTopic).order_by(QueryTopic.created_at)))
    return QueryTopicList(
        items=query_topics_out(db, topics, can_delete=user.account_type == "ADMIN")
    )


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
    return query_topic_out(db, topic, can_delete=editor.account_type == "ADMIN")


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
    return query_topic_out(db, topic, can_delete=editor.account_type == "ADMIN")


@router.delete(
    "/query-topics/{query_topic_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteQueryTopic",
)
def delete_query_topic(
    query_topic_id: uuid.UUID,
    expected_revision: Annotated[int, Query(ge=0)],
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
    """删除管理员当前读取且没有业务历史引用的 GEO 问题。"""
    delete_query_topic_command(
        db=db,
        query_topic_id=query_topic_id,
        expected_revision=expected_revision,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.get(
    "/platform-profiles", response_model=PlatformProfileList, operation_id="listPlatformProfiles"
)
def list_platform_profiles(
    db: DbSession,
    user: CurrentUser,
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
        can_manage=user.account_type == "ADMIN",
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
    return platform_profile_out(db, profile, can_manage=True)


@router.get("/content-tasks", response_model=ContentTaskList, operation_id="listContentTasks")
def list_content_tasks(
    db: DbSession,
    user: CurrentUser,
    platform_profile_id: uuid.UUID | None = None,
    filter_product_id: uuid.UUID | None = None,
    filter_fact_version_id: uuid.UUID | None = None,
    archive_status: ContentTaskArchiveStatus = ContentTaskArchiveStatus.ACTIVE,
) -> ContentTaskList:
    query = select(ContentTask)
    if platform_profile_id is not None:
        query = query.where(ContentTask.platform_profile_id == platform_profile_id)
    if filter_product_id is not None:
        query = query.where(ContentTask.product_id == filter_product_id)
    if filter_fact_version_id is not None:
        query = query.where(ContentTask.fact_version_id == filter_fact_version_id)
    if archive_status == ContentTaskArchiveStatus.ACTIVE:
        query = query.where(ContentTask.archived_at.is_(None))
    elif archive_status == ContentTaskArchiveStatus.ARCHIVED:
        query = query.where(ContentTask.archived_at.is_not(None))
    tasks = list(db.scalars(query.order_by(ContentTask.created_at.desc())))
    return ContentTaskList(
        items=content_tasks_out(
            db,
            tasks,
            can_permanently_delete=user.account_type == "ADMIN",
        )
    )


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
    idempotency_key: Annotated[
        str, Header(alias="Idempotency-Key", min_length=8, max_length=128)
    ],
) -> ContentTaskOut:
    task = create_content_task_command(
        db=db,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
        idempotency_key=idempotency_key,
    )
    return content_task_out(
        db, task, can_permanently_delete=editor.account_type == "ADMIN"
    )


@router.get(
    "/content-tasks/{content_task_id}",
    response_model=ContentTaskOut,
    operation_id="getContentTask",
)
def get_content_task(
    content_task_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> ContentTaskOut:
    task = db.get(ContentTask, content_task_id)
    if task is None:
        raise not_found("内容任务")
    return content_task_out(db, task, can_permanently_delete=user.account_type == "ADMIN")


@router.delete(
    "/content-tasks/{content_task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteContentTask",
)
def delete_content_task(
    content_task_id: uuid.UUID,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> None:
    """删除服务端明确允许删除的已取消内容任务。"""
    delete_content_task_service(
        db=db,
        task_id=content_task_id,
        actor=editor,
        request_id=request.state.request_id,
    )


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


@router.post(
    "/content-tasks/{content_task_id}/archive",
    response_model=ContentTaskOut,
    operation_id="archiveContentTask",
)
def archive_content_task(
    content_task_id: uuid.UUID,
    payload: RevisionRequest,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> ContentTaskOut:
    task = archive_content_task_service(
        db=db,
        task_id=content_task_id,
        expected_revision=payload.expected_revision,
    )
    return content_task_out(
        db, task, can_permanently_delete=editor.account_type == "ADMIN"
    )


@router.post(
    "/content-tasks/{content_task_id}/restore",
    response_model=ContentTaskOut,
    operation_id="restoreContentTask",
)
def restore_content_task(
    content_task_id: uuid.UUID,
    payload: RevisionRequest,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> ContentTaskOut:
    task = restore_content_task_service(
        db=db,
        task_id=content_task_id,
        expected_revision=payload.expected_revision,
    )
    return content_task_out(
        db, task, can_permanently_delete=editor.account_type == "ADMIN"
    )


@router.get(
    "/content-tasks/{content_task_id}/permanent-deletion-preview",
    response_model=ContentTaskPermanentDeletionPreview,
    operation_id="getContentTaskPermanentDeletionPreview",
)
def get_content_task_permanent_deletion_preview(
    content_task_id: uuid.UUID,
    db: DbSession,
    _admin: AdminUser,
) -> ContentTaskPermanentDeletionPreview:
    return preview_content_task_permanent_deletion_service(
        db=db, task_id=content_task_id
    )


@router.post(
    "/content-tasks/{content_task_id}/permanent-delete",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="permanentlyDeleteContentTask",
)
def permanently_delete_content_task(
    content_task_id: uuid.UUID,
    payload: ContentTaskPermanentDeleteRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
    permanently_delete_content_task_service(
        db=db,
        task_id=content_task_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )
