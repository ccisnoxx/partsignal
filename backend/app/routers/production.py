"""异步生成、不可变 Markdown 版本、差异比较和内容审核接口。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Header, Request, status
from sqlalchemy import select

from app.deps import CsrfProtected, CurrentUser, DbSession, EngineerUser
from app.errors import AppError, not_found
from app.models.ai_generation import (
    AIChannel,
    AIModel,
    GenerationJob,
)
from app.models.configuration import (
    PlatformProfile,
    PlatformProfileVersion,
    PlatformPrompt,
)
from app.models.content import (
    ContentTask,
    ContentVersion,
)
from app.schemas.common import (
    CommandRequest,
    RequestChangesCommand,
)
from app.schemas.content import (
    ContentDiff,
    ContentReviewContext,
    ContentRevisionCreate,
    ContentVersionList,
    ContentVersionOut,
    GenerationJobCreate,
    GenerationJobDetail,
    GenerationJobList,
    GenerationJobOut,
    GenerationOptionModel,
    GenerationOptions,
)
from app.services.content_production import (
    create_content_revision as create_content_revision_command,
)
from app.services.content_production import (
    create_generation_job as create_generation_job_command,
)
from app.services.content_production import (
    retry_generation_job as retry_generation_job_command,
)
from app.services.projections import content_diff, content_version_out
from app.services.review import get_content_review_context, transition_content_version

router = APIRouter(prefix="/api/v1", tags=["production", "review"])

ContentEditor = EngineerUser
ContentReviewer = EngineerUser


def generation_job_out(job: GenerationJob) -> GenerationJobOut:
    return GenerationJobOut.model_validate(job)


def generation_job_detail(job: GenerationJob) -> GenerationJobDetail:
    return GenerationJobDetail.model_validate(job)


@router.get(
    "/content-tasks/{content_task_id}/generation-options",
    response_model=GenerationOptions,
    operation_id="getContentTaskGenerationOptions",
)
def get_generation_options(
    content_task_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> GenerationOptions:
    """返回任务锁定平台的当前 Prompt 和可选择模型。"""
    task = db.get(ContentTask, content_task_id)
    if task is None:
        raise not_found("内容任务")
    if task.platform_type_id is None or task.platform_type_snapshot is None:
        raise AppError("PLATFORM_TYPE_MISSING", "内容任务没有锁定平台类型", 409)
    platform_version = db.get(PlatformProfileVersion, task.platform_profile_version_id)
    platform_profile = (
        db.get(PlatformProfile, platform_version.platform_profile_id)
        if platform_version is not None
        else None
    )
    if platform_profile is None:
        raise AppError("INVALID_STATE_TRANSITION", "内容任务锁定的平台不存在", 409)
    prompt = db.get(PlatformPrompt, platform_profile.id)
    if prompt is None:
        raise AppError("PLATFORM_PROMPT_MISSING", "任务平台缺少当前 Prompt", 409)
    rows = db.execute(
        select(AIModel, AIChannel)
        .join(AIChannel, AIChannel.id == AIModel.channel_id)
        .where(
            AIModel.is_enabled.is_(True),
            AIModel.test_status == "PASSED",
            AIChannel.is_enabled.is_(True),
        )
        .order_by(AIChannel.name, AIModel.display_name)
    ).all()
    return GenerationOptions(
        platform_profile_version_id=task.platform_profile_version_id,
        platform_profile_name=platform_profile.name,
        platform_type_id=task.platform_type_id,
        platform_type_name=str(task.platform_type_snapshot["name"]),
        platform_type_slug=str(task.platform_type_snapshot["slug"]),
        system_prompt_markdown=prompt.template_markdown,
        models=[
            GenerationOptionModel(
                id=model.id,
                channel_id=channel.id,
                channel_name=channel.name,
                display_name=model.display_name,
                model_id=model.model_id,
            )
            for model, channel in rows
        ],
    )


@router.post(
    "/content-tasks/{content_task_id}/generation-jobs",
    response_model=GenerationJobOut,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="createGenerationJob",
)
def create_generation_job(
    content_task_id: uuid.UUID,
    payload: GenerationJobCreate,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)],
) -> GenerationJobOut:
    job = create_generation_job_command(
        db=db,
        content_task_id=content_task_id,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
        idempotency_key=idempotency_key,
    )
    return generation_job_out(job)


@router.get(
    "/content-tasks/{content_task_id}/generation-jobs",
    response_model=GenerationJobList,
    operation_id="listGenerationJobs",
)
def list_generation_jobs(
    content_task_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> GenerationJobList:
    """返回任务全部生成作业，使刷新页面后仍可查看和重试。"""
    if db.get(ContentTask, content_task_id) is None:
        raise not_found("内容任务")
    jobs = list(
        db.scalars(
            select(GenerationJob)
            .where(GenerationJob.content_task_id == content_task_id)
            .order_by(GenerationJob.created_at.desc())
        )
    )
    return GenerationJobList(items=[generation_job_out(job) for job in jobs])


@router.get(
    "/generation-jobs/{generation_job_id}",
    response_model=GenerationJobDetail,
    operation_id="getGenerationJob",
)
def get_generation_job(
    generation_job_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> GenerationJobDetail:
    job = db.get(GenerationJob, generation_job_id)
    if job is None:
        raise not_found("生成作业")
    return generation_job_detail(job)


@router.post(
    "/generation-jobs/{generation_job_id}/retry",
    response_model=GenerationJobOut,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="retryGenerationJob",
)
def retry_generation_job(
    generation_job_id: uuid.UUID,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)],
) -> GenerationJobOut:
    job = retry_generation_job_command(
        db=db,
        generation_job_id=generation_job_id,
        actor=editor,
        request_id=request.state.request_id,
        idempotency_key=idempotency_key,
    )
    return generation_job_out(job)


@router.get(
    "/content-tasks/{content_task_id}/content-versions",
    response_model=ContentVersionList,
    operation_id="listContentTaskVersions",
)
def list_content_task_versions(
    content_task_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> ContentVersionList:
    if db.get(ContentTask, content_task_id) is None:
        raise not_found("内容任务")
    versions = list(
        db.scalars(
            select(ContentVersion)
            .where(ContentVersion.task_id == content_task_id)
            .order_by(ContentVersion.version.desc())
        )
    )
    return ContentVersionList(items=[content_version_out(item) for item in versions])


@router.get(
    "/content-versions/{content_version_id}",
    response_model=ContentVersionOut,
    operation_id="getContentVersion",
)
def get_content_version(
    content_version_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> ContentVersionOut:
    content = db.get(ContentVersion, content_version_id)
    if content is None:
        raise not_found("内容版本")
    return content_version_out(content)


@router.get(
    "/content-versions/{content_version_id}/review-context",
    response_model=ContentReviewContext,
    operation_id="getContentReviewContext",
)
def content_review_context(
    content_version_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> ContentReviewContext:
    """返回不可变内容、锁定事实、证据、差异和追加式审核历史。"""
    return get_content_review_context(db, content_version_id)


@router.post(
    "/content-versions/{content_version_id}/revisions",
    response_model=ContentVersionOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createContentRevision",
)
def create_content_revision(
    content_version_id: uuid.UUID,
    payload: ContentRevisionCreate,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> ContentVersionOut:
    content = create_content_revision_command(
        db=db,
        content_version_id=content_version_id,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
    )
    return content_version_out(content)


@router.post(
    "/content-versions/{content_version_id}/submit-review",
    response_model=ContentVersionOut,
    operation_id="submitContentVersion",
)
def submit_content_version(
    content_version_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> ContentVersionOut:
    return transition_content_version(
        db=db,
        content_version_id=content_version_id,
        expected_revision=payload.expected_revision,
        comment=payload.comment,
        actor=editor,
        request_id=request.state.request_id,
        action="submit-review",
    )


@router.post(
    "/content-versions/{content_version_id}/approve",
    response_model=ContentVersionOut,
    operation_id="approveContentVersion",
)
def approve_content_version(
    content_version_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    reviewer: ContentReviewer,
    _csrf: CsrfProtected,
) -> ContentVersionOut:
    return transition_content_version(
        db=db,
        content_version_id=content_version_id,
        expected_revision=payload.expected_revision,
        comment=payload.comment,
        actor=reviewer,
        request_id=request.state.request_id,
        action="approve",
    )


@router.post(
    "/content-versions/{content_version_id}/request-changes",
    response_model=ContentVersionOut,
    operation_id="requestContentVersionChanges",
)
def request_content_changes(
    content_version_id: uuid.UUID,
    payload: RequestChangesCommand,
    request: Request,
    db: DbSession,
    reviewer: ContentReviewer,
    _csrf: CsrfProtected,
) -> ContentVersionOut:
    return transition_content_version(
        db=db,
        content_version_id=content_version_id,
        expected_revision=payload.expected_revision,
        comment=payload.comment,
        actor=reviewer,
        request_id=request.state.request_id,
        action="request-changes",
    )


@router.get(
    "/content-versions/{content_version_id}/compare/{other_version_id}",
    response_model=ContentDiff,
    operation_id="compareContentVersions",
)
def compare_content_versions(
    content_version_id: uuid.UUID, other_version_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> ContentDiff:
    left = db.get(ContentVersion, content_version_id)
    right = db.get(ContentVersion, other_version_id)
    if left is None or right is None:
        raise not_found("内容版本")
    if left.task_id != right.task_id:
        raise AppError("VALIDATION_ERROR", "只能比较同一任务的内容版本", 422)
    return content_diff(left, right)
