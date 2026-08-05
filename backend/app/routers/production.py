"""异步生成、不可变 Markdown 版本、差异比较和内容审核接口。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Header, Request, status
from sqlalchemy import select

from app.deps import (
    CsrfProtected,
    CurrentUser,
    DbSession,
    EngineerUser,
    assert_account_types,
)
from app.errors import AppError, not_found
from app.models.ai_generation import (
    AIChannel,
    AIModel,
    GenerationJob,
)
from app.models.configuration import (
    ContentHumanizationPrompt,
    PlatformProfile,
    PlatformPrompt,
)
from app.models.content import (
    ContentTask,
    ContentVersion,
)
from app.schemas.common import (
    AccountType,
    CommandRequest,
    RequestChangesCommand,
)
from app.schemas.content import (
    ContentDiff,
    ContentReviewContext,
    ContentRevisionCreate,
    ContentVersionList,
    ContentVersionOut,
    GenerationJobDetail,
    GenerationJobList,
    GenerationJobOut,
    GenerationOptionModel,
    GenerationOptions,
    GenerationPromptOption,
    HumanizationJobCreate,
    OriginalGenerationJobCreate,
)
from app.services.content_production import (
    abandon_content_version as abandon_content_version_command,
)
from app.services.content_production import (
    create_content_revision as create_content_revision_command,
)
from app.services.content_production import (
    create_generation_job as create_generation_job_command,
)
from app.services.content_production import (
    create_humanization_job as create_humanization_job_command,
)
from app.services.content_production import (
    create_manual_content_version as create_manual_content_version_command,
)
from app.services.content_production import generation_job_retryable
from app.services.content_production import (
    retry_generation_job as retry_generation_job_command,
)
from app.services.projections import content_diff, content_version_out, content_versions_out
from app.services.review import get_content_review_context, transition_content_version

router = APIRouter(prefix="/api/v1", tags=["production", "review"])

ContentEditor = EngineerUser


def generation_jobs_out(db: DbSession, jobs: list[GenerationJob]) -> list[GenerationJobOut]:
    """批量投影作业重试动作，避免逐行读取父任务。"""
    task_ids = {job.content_task_id for job in jobs}
    tasks_by_id = {
        task.id: task
        for task in db.scalars(select(ContentTask).where(ContentTask.id.in_(task_ids)))
    }
    latest_by_task: dict[uuid.UUID, uuid.UUID] = {}
    for job in sorted(jobs, key=lambda item: (item.created_at, item.id), reverse=True):
        latest_by_task.setdefault(job.content_task_id, job.id)
    items: list[GenerationJobOut] = []
    for job in jobs:
        retryable = bool(
            latest_by_task.get(job.content_task_id) == job.id
            and generation_job_retryable(job, tasks_by_id.get(job.content_task_id))
        )
        if job.status in {"PENDING", "RUNNING"}:
            workflow_stage, primary_task = "IN_PROGRESS", "VIEW_EXECUTION_PROGRESS"
        elif job.status == "SUCCEEDED":
            workflow_stage, primary_task = "SUCCEEDED", "VIEW_GENERATED_CONTENT"
        elif retryable:
            workflow_stage, primary_task = "RETRYABLE_FAILURE", "HANDLE_FAILURE"
        else:
            workflow_stage, primary_task = "HISTORICAL_FAILURE", "VIEW_FAILURE"
        payload = {
            field: getattr(job, field)
            for field in GenerationJobOut.model_fields
            if field not in {"available_actions", "workflow_stage", "primary_task"}
        }
        payload["available_actions"] = ["RETRY"] if retryable else []
        payload["workflow_stage"] = workflow_stage
        payload["primary_task"] = primary_task
        items.append(GenerationJobOut.model_validate(payload))
    return items


def generation_job_out(db: DbSession, job: GenerationJob) -> GenerationJobOut:
    return generation_jobs_out(db, [job])[0]


def generation_job_detail(db: DbSession, job: GenerationJob) -> GenerationJobDetail:
    payload = generation_job_out(db, job).model_dump()
    payload["input_snapshot"] = job.input_snapshot
    return GenerationJobDetail.model_validate(payload)


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
    platform_profile = db.get(PlatformProfile, task.platform_profile_id)
    if platform_profile is None or not platform_profile.is_active:
        raise AppError("INVALID_STATE_TRANSITION", "内容任务锁定的平台不存在", 409)
    prompt = (
        db.get(PlatformPrompt, platform_profile.platform_prompt_id)
        if platform_profile.platform_prompt_id is not None
        else None
    )
    if prompt is None or not prompt.template_markdown.strip():
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
        platform_profile_id=task.platform_profile_id,
        platform_profile_name=platform_profile.name,
        platform_prompt=GenerationPromptOption(
            id=prompt.id,
            name=prompt.name,
            revision=prompt.revision,
            template_markdown=prompt.template_markdown,
        ),
        humanization_prompt_configured=db.get(ContentHumanizationPrompt, 1) is not None,
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
    payload: OriginalGenerationJobCreate,
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
    return generation_job_out(db, job)


@router.post(
    "/content-versions/{content_version_id}/humanization-jobs",
    response_model=GenerationJobOut,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="createHumanizationJob",
)
def create_humanization_job(
    content_version_id: uuid.UUID,
    payload: HumanizationJobCreate,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)],
) -> GenerationJobOut:
    """对具体 AI 内容版本创建一次可追溯的自然化作业。"""
    job = create_humanization_job_command(
        db=db,
        content_version_id=content_version_id,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
        idempotency_key=idempotency_key,
    )
    return generation_job_out(db, job)


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
    return GenerationJobList(items=generation_jobs_out(db, jobs))


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
    return generation_job_detail(db, job)


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
    return generation_job_out(db, job)


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
    return ContentVersionList(items=content_versions_out(db, versions))


@router.post(
    "/content-tasks/{content_task_id}/manual-versions",
    response_model=ContentVersionOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createManualContentVersion",
)
def create_manual_content_version(
    content_task_id: uuid.UUID,
    payload: ContentRevisionCreate,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> ContentVersionOut:
    """创建不依赖 Prompt、模型或既有内容版本的人工首稿。"""
    content = create_manual_content_version_command(
        db=db,
        content_task_id=content_task_id,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
    )
    return content_version_out(db, content)


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
    return content_version_out(db, content)


@router.get(
    "/content-versions/{content_version_id}/review-context",
    response_model=ContentReviewContext,
    operation_id="getContentReviewContext",
)
def content_review_context(
    content_version_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> ContentReviewContext:
    """返回不可变内容、锁定事实、证据、差异和追加式审核历史。"""
    return get_content_review_context(
        db, content_version_id, can_delete_fact=user.account_type == "ADMIN"
    )


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
    return content_version_out(db, content)


@router.post(
    "/content-versions/{content_version_id}/abandon",
    response_model=ContentVersionOut,
    operation_id="abandonContentVersion",
)
def abandon_content_version(
    content_version_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
) -> ContentVersionOut:
    content = abandon_content_version_command(
        db=db,
        content_version_id=content_version_id,
        expected_revision=payload.expected_revision,
        comment=payload.comment,
        actor=editor,
        request_id=request.state.request_id,
    )
    return content_version_out(db, content)


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
    reviewer: CurrentUser,
    _csrf: CsrfProtected,
) -> ContentVersionOut:
    assert_account_types(reviewer, (AccountType.ADMIN, AccountType.ENGINEER))
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
    reviewer: CurrentUser,
    _csrf: CsrfProtected,
) -> ContentVersionOut:
    assert_account_types(reviewer, (AccountType.ADMIN, AccountType.ENGINEER))
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
