"""异步生成、不可变 Markdown 版本、差异比较和内容审核接口。"""

from __future__ import annotations

import difflib
import hashlib
import json
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Request, status
from sqlalchemy import func, select

from app.audit import append_audit
from app.config import settings
from app.deps import CsrfProtected, CurrentUser, DbSession, require_roles
from app.errors import AppError, not_found
from app.models import (
    ContentReviewRecord,
    ContentTask,
    ContentVersion,
    FactVersion,
    GenerationJob,
    PlatformProfileVersion,
    Product,
    QueryTopic,
    User,
)
from app.schemas import (
    CommandRequest,
    ContentDiff,
    ContentRevisionCreate,
    ContentVersionList,
    ContentVersionOut,
    DiffLine,
    GeneratedDraft,
    GenerationJobList,
    GenerationJobOut,
    ProductFactsBody,
    RoleName,
)
from app.services.generation import (
    PROMPT_TEMPLATE_VERSION,
    DevelopmentContentGenerator,
    add_near_duplicate_warning,
    content_hash,
    process_generation_job,
    run_quality_checks,
)
from app.worker import generate_content

router = APIRouter(prefix="/api/v1", tags=["production", "review"])

ContentEditor = Annotated[User, Depends(require_roles(RoleName.CONTENT_EDITOR))]
ContentReviewer = Annotated[User, Depends(require_roles(RoleName.CONTENT_REVIEWER))]


def content_version_out(content: ContentVersion) -> ContentVersionOut:
    return ContentVersionOut.model_validate(content)


def generation_job_out(job: GenerationJob) -> GenerationJobOut:
    return GenerationJobOut.model_validate(job)


def build_generation_input(db: DbSession, task: ContentTask) -> dict[str, Any]:
    """只从任务锁定的已批准事实和 ACTIVE 平台版本构造生成输入。"""
    fact = db.get(FactVersion, task.fact_version_id)
    if fact is None or fact.status != "APPROVED":
        raise AppError("FACT_NOT_APPROVED", "任务绑定的事实版本不再可用于生成", 409)
    product = db.get(Product, task.product_id)
    if product is None or product.status != "ACTIVE":
        raise AppError("FACT_NOT_APPROVED", "产品已停用，不能生成新内容", 409)
    platform = db.get(PlatformProfileVersion, task.platform_profile_version_id)
    if platform is None or platform.status not in {"ACTIVE", "RETIRED"}:
        raise AppError("INVALID_STATE_TRANSITION", "任务绑定的平台规则不是已激活版本", 409)
    topic = db.get(QueryTopic, task.query_topic_id)
    if topic is None:
        raise not_found("目标问题")
    return {
        "fact_version_id": str(fact.id),
        "facts": ProductFactsBody.model_validate(fact.snapshot_json).model_dump(mode="json"),
        "product": {
            "id": str(product.id),
            "part_number": product.part_number,
            "brand": product.brand,
            "category": product.category,
        },
        "query_topic": {
            "id": str(topic.id),
            "canonical_question": topic.canonical_question,
            "intent_type": topic.intent_type,
            "variants": topic.variants,
        },
        "platform_rules": platform.rules,
        "task": {
            "id": str(task.id),
            "target_audience": task.target_audience,
            "content_angle": task.content_angle,
            "conversion_goal": task.conversion_goal,
            "desired_format": task.desired_format,
            "desired_length_min": task.desired_length_min,
            "desired_length_max": task.desired_length_max,
            "canonical_url": task.canonical_url,
        },
    }


def create_job(
    *,
    db: DbSession,
    task: ContentTask,
    idempotency_key: str,
    actor: User,
    retry_of: GenerationJob | None = None,
) -> tuple[GenerationJob, bool]:
    """创建幂等作业；同一键不能被另一业务请求复用。"""
    existing = db.scalar(
        select(GenerationJob).where(GenerationJob.idempotency_key == idempotency_key)
    )
    if existing is not None:
        if existing.content_task_id != task.id or existing.retry_of_id != (
            retry_of.id if retry_of else None
        ):
            raise AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一生成请求", 409)
        return existing, False
    current_input = build_generation_input(db, task)
    # 重试保留原始输入快照，但仍必须通过当前事实、产品和任务状态校验。
    generation_input = retry_of.input_snapshot if retry_of else current_input
    prompt_hash = hashlib.sha256(
        json.dumps(generation_input, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    job = GenerationJob(
        content_task_id=task.id,
        idempotency_key=idempotency_key,
        input_snapshot=generation_input,
        adapter_name=DevelopmentContentGenerator.name,
        prompt_template_version=PROMPT_TEMPLATE_VERSION,
        prompt_hash=prompt_hash,
        retry_of_id=retry_of.id if retry_of else None,
        created_by=actor.id,
    )
    db.add(job)
    db.flush()
    return job, True


def dispatch_job(job: GenerationJob, db: DbSession) -> None:
    """提交后投递 UUID；投递失败显式标记数据库作业失败。"""
    if settings.generation_eager:
        process_generation_job(job.id)
        return
    try:
        generate_content.delay(str(job.id))
    except Exception as error:
        job.status = "FAILED"
        job.error_code = "BROKER_UNAVAILABLE"
        job.error_summary = "Redis Broker 不可用"
        job.finished_at = datetime.now(UTC)
        db.commit()
        raise AppError("GENERATION_FAILED", "生成作业无法投递到 Worker", 503) from error


@router.post(
    "/content-tasks/{content_task_id}/generation-jobs",
    response_model=GenerationJobOut,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="createGenerationJob",
)
def create_generation_job(
    content_task_id: uuid.UUID,
    request: Request,
    db: DbSession,
    editor: ContentEditor,
    _csrf: CsrfProtected,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)],
) -> GenerationJobOut:
    task = db.get(ContentTask, content_task_id)
    if task is None:
        raise not_found("内容任务")
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "只有 OPEN 内容任务可以生成草稿", 409)
    job, created = create_job(db=db, task=task, idempotency_key=idempotency_key, actor=editor)
    if created:
        append_audit(
            db,
            actor_id=editor.id,
            action="generation_job.created",
            target_type="GenerationJob",
            target_id=job.id,
            request_id=request.state.request_id,
        )
        db.commit()
        dispatch_job(job, db)
        db.refresh(job)
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
    response_model=GenerationJobOut,
    operation_id="getGenerationJob",
)
def get_generation_job(
    generation_job_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> GenerationJobOut:
    job = db.get(GenerationJob, generation_job_id)
    if job is None:
        raise not_found("生成作业")
    return generation_job_out(job)


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
    previous = db.get(GenerationJob, generation_job_id)
    if previous is None:
        raise not_found("生成作业")
    if previous.status != "FAILED":
        raise AppError("INVALID_STATE_TRANSITION", "只有 FAILED 作业可以重试", 409)
    task = db.get(ContentTask, previous.content_task_id)
    if task is None or task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "内容任务不可再生成", 409)
    job, created = create_job(
        db=db, task=task, idempotency_key=idempotency_key, actor=editor, retry_of=previous
    )
    if created:
        append_audit(
            db,
            actor_id=editor.id,
            action="generation_job.retried",
            target_type="GenerationJob",
            target_id=job.id,
            request_id=request.state.request_id,
            details={"retry_of_id": str(previous.id)},
        )
        db.commit()
        dispatch_job(job, db)
        db.refresh(job)
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
    source = db.get(ContentVersion, content_version_id)
    if source is None:
        raise not_found("内容版本")
    task = db.scalar(
        select(ContentTask).where(ContentTask.id == source.task_id).with_for_update()
    )
    if task is None or task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态任务不能创建内容修订", 409)
    generation_input = build_generation_input(db, task)
    draft = GeneratedDraft(
        title=payload.title,
        summary=payload.summary,
        body_markdown=payload.body_markdown,
        tags=payload.tags,
        used_fact_ids=source.used_fact_ids,
        used_evidence_ids=source.used_evidence_ids,
        required_disclosure_ids=source.required_disclosure_ids,
        review_warnings=[],
    )
    quality_issues = run_quality_checks(draft, generation_input)
    add_near_duplicate_warning(db, task, draft, quality_issues)
    next_version = (
        int(
            db.scalar(
                select(func.coalesce(func.max(ContentVersion.version), 0)).where(
                    ContentVersion.task_id == source.task_id
                )
            )
            or 0
        )
        + 1
    )
    content = ContentVersion(
        task_id=source.task_id,
        fact_version_id=source.fact_version_id,
        based_on_id=source.id,
        version=next_version,
        source_type="HUMAN",
        title=payload.title,
        summary=payload.summary,
        body_markdown=payload.body_markdown,
        tags=payload.tags,
        used_fact_ids=source.used_fact_ids,
        used_evidence_ids=source.used_evidence_ids,
        required_disclosure_ids=source.required_disclosure_ids,
        content_hash=content_hash(
            payload.title, payload.summary, payload.body_markdown, payload.tags
        ),
        quality_issues=quality_issues,
        change_summary=payload.change_summary,
        created_by=editor.id,
    )
    db.add(content)
    db.flush()
    append_audit(
        db,
        actor_id=editor.id,
        action="content_version.revised",
        target_type="ContentVersion",
        target_id=content.id,
        request_id=request.state.request_id,
        details={"based_on_id": str(source.id), "version": next_version},
    )
    db.commit()
    return content_version_out(content)


def transition_content_version(
    *,
    content: ContentVersion,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    actor: User,
    action: str,
) -> ContentVersionOut:
    """集中执行内容审核状态机和禁止自审规则。"""
    if content.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "内容版本已被其他请求修改", 409)
    transitions = {
        "submit-review": ("DRAFT", "PENDING_REVIEW"),
        "approve": ("PENDING_REVIEW", "APPROVED"),
        "request-changes": ("PENDING_REVIEW", "CHANGES_REQUESTED"),
    }
    expected, target = transitions[action]
    if content.status != expected:
        raise AppError(
            "INVALID_STATE_TRANSITION", f"内容版本不能从 {content.status} 执行 {action}", 409
        )
    if action == "submit-review" and any(
        issue.get("severity") == "BLOCKING" for issue in content.quality_issues
    ):
        raise AppError("INVALID_STATE_TRANSITION", "内容存在阻断质量问题，不能提交审核", 409)
    if action in {"approve", "request-changes"} and content.created_by == actor.id:
        raise AppError("SELF_REVIEW_FORBIDDEN", "内容创建者不能审核自己的版本", 403)
    if action == "approve":
        fact = db.get(FactVersion, content.fact_version_id)
        if fact is None or fact.status != "APPROVED":
            raise AppError("FACT_NOT_APPROVED", "内容绑定的事实版本不再处于批准状态", 409)
        previous = db.scalar(
            select(ContentVersion).where(
                ContentVersion.task_id == content.task_id,
                ContentVersion.status == "APPROVED",
                ContentVersion.id != content.id,
            )
        )
        if previous is not None:
            previous.status = "SUPERSEDED"
            previous.revision += 1
            db.flush()
    content.status = target
    content.revision += 1
    db.add(
        ContentReviewRecord(
            content_version_id=content.id,
            action=action,
            comment=payload.comment,
            actor_id=actor.id,
        )
    )
    append_audit(
        db,
        actor_id=actor.id,
        action=f"content_version.{action}",
        target_type="ContentVersion",
        target_id=content.id,
        request_id=request.state.request_id,
        details={"status": target, "revision": content.revision},
    )
    db.commit()
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
    content = db.scalar(
        select(ContentVersion).where(ContentVersion.id == content_version_id).with_for_update()
    )
    if content is None:
        raise not_found("内容版本")
    return transition_content_version(
        content=content,
        payload=payload,
        request=request,
        db=db,
        actor=editor,
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
    content = db.scalar(
        select(ContentVersion).where(ContentVersion.id == content_version_id).with_for_update()
    )
    if content is None:
        raise not_found("内容版本")
    return transition_content_version(
        content=content, payload=payload, request=request, db=db, actor=reviewer, action="approve"
    )


@router.post(
    "/content-versions/{content_version_id}/request-changes",
    response_model=ContentVersionOut,
    operation_id="requestContentVersionChanges",
)
def request_content_changes(
    content_version_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    reviewer: ContentReviewer,
    _csrf: CsrfProtected,
) -> ContentVersionOut:
    content = db.scalar(
        select(ContentVersion).where(ContentVersion.id == content_version_id).with_for_update()
    )
    if content is None:
        raise not_found("内容版本")
    return transition_content_version(
        content=content,
        payload=payload,
        request=request,
        db=db,
        actor=reviewer,
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
    left_lines = left.body_markdown.splitlines()
    right_lines = right.body_markdown.splitlines()
    matcher = difflib.SequenceMatcher(a=left_lines, b=right_lines, autojunk=False)
    lines: list[DiffLine] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            lines.extend(
                DiffLine(kind="EQUAL", old_line=i + 1, new_line=j + 1, text=left_lines[i])
                for i, j in zip(range(i1, i2), range(j1, j2), strict=True)
            )
        else:
            if tag in {"delete", "replace"}:
                lines.extend(
                    DiffLine(kind="DELETE", old_line=i + 1, new_line=None, text=left_lines[i])
                    for i in range(i1, i2)
                )
            if tag in {"insert", "replace"}:
                lines.extend(
                    DiffLine(kind="ADD", old_line=None, new_line=j + 1, text=right_lines[j])
                    for j in range(j1, j2)
                )
    return ContentDiff(left_id=left.id, right_id=right.id, lines=lines)
