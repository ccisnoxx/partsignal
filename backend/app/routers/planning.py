"""目标问题、版本化平台规则与内容任务接口。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Request, status
from sqlalchemy import func, select

from app.audit import append_audit
from app.deps import AdminUser, CsrfProtected, CurrentUser, DbSession, EngineerUser
from app.errors import AppError, not_found
from app.models import (
    ContentTask,
    FactVersion,
    PlatformProfile,
    PlatformProfileVersion,
    PlatformType,
    Product,
    QueryTopic,
)
from app.schemas import (
    CommandRequest,
    ContentTaskCreate,
    ContentTaskList,
    ContentTaskOut,
    ContentTaskUserPromptUpdate,
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


def platform_version_out(version: PlatformProfileVersion) -> PlatformProfileVersionOut:
    return PlatformProfileVersionOut(
        id=version.id,
        version=version.version,
        status=version.status,
        rules=version.rules,
        revision=version.revision,
        created_at=version.created_at,
    )


def platform_profile_out(db: DbSession, profile: PlatformProfile) -> PlatformProfileOut:
    active = db.scalar(
        select(PlatformProfileVersion).where(
            PlatformProfileVersion.platform_profile_id == profile.id,
            PlatformProfileVersion.status == "ACTIVE",
        )
    )
    if active is None:
        raise AppError("INVALID_STATE_TRANSITION", "平台配置缺少 ACTIVE 版本", 409)
    return PlatformProfileOut(
        id=profile.id,
        name=profile.name,
        slug=profile.slug,
        allowed_domains=profile.allowed_domains,
        platform_type_id=profile.platform_type_id,
        revision=profile.revision,
        active_version=platform_version_out(active),
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
    topic = QueryTopic(
        canonical_question=payload.canonical_question.strip(),
        intent_type=payload.intent_type.value,
        variants=payload.variants,
    )
    db.add(topic)
    db.flush()
    append_audit(
        db,
        actor_id=editor.id,
        action="query_topic.created",
        target_type="QueryTopic",
        target_id=topic.id,
        request_id=request.state.request_id,
    )
    db.commit()
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
    topic = db.scalar(select(QueryTopic).where(QueryTopic.id == query_topic_id).with_for_update())
    if topic is None:
        raise not_found("目标问题")
    if topic.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "目标问题已被其他请求修改", 409)
    topic.canonical_question = payload.canonical_question.strip()
    topic.intent_type = payload.intent_type.value
    topic.variants = payload.variants
    topic.revision += 1
    append_audit(
        db,
        actor_id=editor.id,
        action="query_topic.updated",
        target_type="QueryTopic",
        target_id=topic.id,
        request_id=request.state.request_id,
        details={"revision": topic.revision},
    )
    db.commit()
    return query_topic_out(topic)


@router.get(
    "/platform-profiles", response_model=PlatformProfileList, operation_id="listPlatformProfiles"
)
def list_platform_profiles(db: DbSession, _user: CurrentUser) -> PlatformProfileList:
    profiles = list(db.scalars(select(PlatformProfile).order_by(PlatformProfile.name)))
    return PlatformProfileList(items=[platform_profile_out(db, profile) for profile in profiles])


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
    if db.get(PlatformType, payload.platform_type_id) is None:
        raise not_found("平台类型")
    profile = PlatformProfile(
        name=payload.name.strip(),
        slug=payload.slug,
        allowed_domains=[domain.casefold().strip(".") for domain in payload.allowed_domains],
        platform_type_id=payload.platform_type_id,
    )
    db.add(profile)
    db.flush()
    version = PlatformProfileVersion(
        platform_profile_id=profile.id,
        version=1,
        status="ACTIVE",
        rules=payload.rules.model_dump(mode="json"),
    )
    db.add(version)
    append_audit(
        db,
        actor_id=admin.id,
        action="platform_profile.created",
        target_type="PlatformProfile",
        target_id=profile.id,
        request_id=request.state.request_id,
    )
    db.commit()
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
    if db.scalar(
        select(PlatformProfile).where(PlatformProfile.id == platform_profile_id).with_for_update()
    ) is None:
        raise not_found("平台配置")
    next_version = (
        int(
            db.scalar(
                select(func.coalesce(func.max(PlatformProfileVersion.version), 0)).where(
                    PlatformProfileVersion.platform_profile_id == platform_profile_id
                )
            )
            or 0
        )
        + 1
    )
    version = PlatformProfileVersion(
        platform_profile_id=platform_profile_id,
        version=next_version,
        status="DRAFT",
        rules=payload.rules.model_dump(mode="json"),
    )
    db.add(version)
    db.flush()
    append_audit(
        db,
        actor_id=admin.id,
        action="platform_profile_version.created",
        target_type="PlatformProfileVersion",
        target_id=version.id,
        request_id=request.state.request_id,
        details={"version": next_version},
    )
    db.commit()
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
    version = db.scalar(
        select(PlatformProfileVersion)
        .where(PlatformProfileVersion.id == platform_profile_version_id)
        .with_for_update()
    )
    if version is None:
        raise not_found("平台规则版本")
    db.scalar(
        select(PlatformProfile)
        .where(PlatformProfile.id == version.platform_profile_id)
        .with_for_update()
    )
    if version.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "平台规则版本已被其他请求修改", 409)
    if version.status != "DRAFT":
        raise AppError("INVALID_STATE_TRANSITION", "只有 DRAFT 平台规则可以激活", 409)
    current = db.scalar(
        select(PlatformProfileVersion).where(
            PlatformProfileVersion.platform_profile_id == version.platform_profile_id,
            PlatformProfileVersion.status == "ACTIVE",
        )
    )
    if current is not None:
        current.status = "RETIRED"
        current.revision += 1
    version.status = "ACTIVE"
    version.revision += 1
    append_audit(
        db,
        actor_id=admin.id,
        action="platform_profile_version.activated",
        target_type="PlatformProfileVersion",
        target_id=version.id,
        request_id=request.state.request_id,
        details={"revision": version.revision},
    )
    db.commit()
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
    version = db.scalar(
        select(PlatformProfileVersion)
        .where(PlatformProfileVersion.id == platform_profile_version_id)
        .with_for_update()
    )
    if version is None:
        raise not_found("平台规则版本")
    if version.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "平台规则版本已被其他请求修改", 409)
    if version.status != "DRAFT":
        raise AppError(
            "INVALID_STATE_TRANSITION",
            "ACTIVE 版本只能在激活替代版本时停用，避免平台失去活动配置",
            409,
        )
    version.status = "RETIRED"
    version.revision += 1
    append_audit(
        db,
        actor_id=admin.id,
        action="platform_profile_version.retired",
        target_type="PlatformProfileVersion",
        target_id=version.id,
        request_id=request.state.request_id,
        details={"revision": version.revision},
    )
    db.commit()
    return platform_version_out(version)


@router.get("/content-tasks", response_model=ContentTaskList, operation_id="listContentTasks")
def list_content_tasks(db: DbSession, _user: CurrentUser) -> ContentTaskList:
    tasks = list(db.scalars(select(ContentTask).order_by(ContentTask.created_at.desc())))
    return ContentTaskList(items=[ContentTaskOut.model_validate(task) for task in tasks])


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
    fact_version = db.get(FactVersion, payload.fact_version_id)
    if fact_version is None or fact_version.status != "APPROVED":
        raise AppError("FACT_NOT_APPROVED", "内容任务只能绑定已批准事实版本", 409)
    if fact_version.product_id != payload.product_id:
        raise AppError("VALIDATION_ERROR", "事实版本不属于所选产品", 422)
    product = db.get(Product, payload.product_id)
    if product is None or product.status != "ACTIVE":
        raise AppError("FACT_NOT_APPROVED", "已停用产品不能创建新任务", 409)
    if db.get(QueryTopic, payload.query_topic_id) is None:
        raise not_found("目标问题")
    platform_version = db.get(PlatformProfileVersion, payload.platform_profile_version_id)
    if platform_version is None or platform_version.status != "ACTIVE":
        raise AppError("INVALID_STATE_TRANSITION", "内容任务只能绑定 ACTIVE 平台规则", 409)
    profile = db.get(PlatformProfile, platform_version.platform_profile_id)
    if profile is None or profile.platform_type_id is None:
        raise AppError("PLATFORM_TYPE_MISSING", "所选平台尚未归类，不能创建内容任务", 409)
    platform_type = db.get(PlatformType, profile.platform_type_id)
    if platform_type is None:
        raise AppError("PLATFORM_TYPE_MISSING", "所选平台类型不存在", 409)
    task = ContentTask(
        **payload.model_dump(mode="python", exclude={"canonical_url"}),
        canonical_url=str(payload.canonical_url),
        platform_type_id=platform_type.id,
        platform_type_snapshot={
            "id": str(platform_type.id),
            "name": platform_type.name,
            "slug": platform_type.slug,
        },
        user_prompt_markdown="",
        created_by=editor.id,
    )
    db.add(task)
    db.flush()
    append_audit(
        db,
        actor_id=editor.id,
        action="content_task.created",
        target_type="ContentTask",
        target_id=task.id,
        request_id=request.state.request_id,
        details={"fact_version_id": str(task.fact_version_id)},
    )
    db.commit()
    return ContentTaskOut.model_validate(task)


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
    return ContentTaskOut.model_validate(task)


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
    """使用任务修订号保存工程师可编辑的 Markdown Prompt。"""
    task = db.scalar(
        select(ContentTask).where(ContentTask.id == content_task_id).with_for_update()
    )
    if task is None:
        raise not_found("内容任务")
    if task.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "内容任务已被其他请求修改", 409)
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态内容任务不能修改 Prompt", 409)
    task.user_prompt_markdown = payload.user_prompt_markdown
    task.revision += 1
    append_audit(
        db,
        actor_id=editor.id,
        action="content_task.user_prompt_updated",
        target_type="ContentTask",
        target_id=task.id,
        request_id=request.state.request_id,
        details={"revision": task.revision},
    )
    db.commit()
    return ContentTaskOut.model_validate(task)


def transition_content_task(
    content_task_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    target: str,
) -> ContentTaskOut:
    """内容任务只允许从 OPEN 进入一个终态。"""
    task = db.scalar(
        select(ContentTask).where(ContentTask.id == content_task_id).with_for_update()
    )
    if task is None:
        raise not_found("内容任务")
    if task.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "内容任务已被其他请求修改", 409)
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态内容任务不能再次变更状态", 409)
    task.status = target
    task.revision += 1
    append_audit(
        db,
        actor_id=editor.id,
        action=f"content_task.{target.casefold()}",
        target_type="ContentTask",
        target_id=task.id,
        request_id=request.state.request_id,
        details={"comment": payload.comment, "revision": task.revision},
    )
    db.commit()
    return ContentTaskOut.model_validate(task)


@router.post(
    "/content-tasks/{content_task_id}/complete",
    response_model=ContentTaskOut,
    operation_id="completeContentTask",
)
def complete_content_task(
    content_task_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> ContentTaskOut:
    return transition_content_task(content_task_id, payload, request, db, editor, "COMPLETED")


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
    return transition_content_task(content_task_id, payload, request, db, editor, "CANCELLED")
