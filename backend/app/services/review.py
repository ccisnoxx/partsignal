"""事实与内容审核状态机及冻结证据读取投影。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.content import (
    ContentReviewRecord,
    ContentTask,
    ContentVersion,
)
from app.models.identity import User
from app.models.product_facts import (
    FactReviewRecord,
    FactVersion,
)
from app.schemas.content import (
    ActorSummary,
    ContentReviewContext,
    ContentVersionOut,
    FactReviewContext,
    GenerationTrace,
    HumanizationTrace,
    ReviewRecord,
)
from app.schemas.product_facts import FactVersionOut
from app.services.content_lineage import ContentAILineage, resolve_content_ai_lineage
from app.services.projections import (
    content_diff,
    content_task_out,
    content_version_out,
    fact_version_out,
)
from app.services.review_policy import (
    CONTENT_TRANSITIONS,
    FACT_TRANSITIONS,
    ContentAction,
    FactAction,
    content_review_actions,
    fact_review_actions,
)


def _fact_history(db: Session, fact: FactVersion) -> list[ReviewRecord]:
    rows = db.execute(
        select(FactReviewRecord, FactVersion.version, User)
        .join(FactVersion, FactVersion.id == FactReviewRecord.fact_version_id)
        .join(User, User.id == FactReviewRecord.actor_id)
        .where(FactReviewRecord.fact_version_id == fact.id)
        .order_by(FactReviewRecord.created_at, FactReviewRecord.id)
    ).all()
    return [
        ReviewRecord(
            id=record.id,
            target_id=record.fact_version_id,
            target_version=version,
            action=record.action,
            comment=record.comment,
            actor=ActorSummary(
                id=actor.id,
                username=actor.username,
                display_name=actor.display_name,
            ),
            created_at=record.created_at,
        )
        for record, version, actor in rows
    ]


def _content_history(db: Session, content: ContentVersion) -> list[ReviewRecord]:
    rows = db.execute(
        select(ContentReviewRecord, ContentVersion.version, User)
        .join(ContentVersion, ContentVersion.id == ContentReviewRecord.content_version_id)
        .join(User, User.id == ContentReviewRecord.actor_id)
        .where(
            ContentVersion.task_id == content.task_id,
            ContentVersion.version <= content.version,
        )
        .order_by(ContentReviewRecord.created_at, ContentReviewRecord.id)
    ).all()
    return [
        ReviewRecord(
            id=record.id,
            target_id=record.content_version_id,
            target_version=version,
            action=record.action,
            comment=record.comment,
            actor=ActorSummary(
                id=actor.id,
                username=actor.username,
                display_name=actor.display_name,
            ),
            created_at=record.created_at,
        )
        for record, version, actor in rows
    ]


def get_fact_review_context(
    db: Session, fact_version_id: uuid.UUID, *, can_delete: bool
) -> FactReviewContext:
    """返回目标事实版本及其自身的完整审核时间线。"""
    fact = db.get(FactVersion, fact_version_id)
    if fact is None:
        raise not_found("事实版本")
    return FactReviewContext(
        fact_version=fact_version_out(db, fact, can_delete=can_delete),
        available_actions=fact_review_actions(fact),
        review_history=_fact_history(db, fact),
    )


def _source_ai_lineage(db: Session, content: ContentVersion) -> ContentAILineage | None:
    """将统一版本链解析错误映射为审核上下文错误。"""
    try:
        return resolve_content_ai_lineage(db, content)
    except AppError as error:
        raise AppError("REVIEW_CONTEXT_INCOMPLETE", "内容 AI 追溯链不完整", 409) from error


def get_content_review_context(
    db: Session, content_version_id: uuid.UUID, *, can_delete_fact: bool
) -> ContentReviewContext:
    """从不可变内容、任务事实和生成快照装配一次审核读取投影。"""
    content = db.get(ContentVersion, content_version_id)
    if content is None:
        raise not_found("内容版本")
    task = db.get(ContentTask, content.task_id)
    fact = db.get(FactVersion, content.fact_version_id)
    if task is None or fact is None or task.fact_version_id != fact.id:
        raise AppError("REVIEW_CONTEXT_INCOMPLETE", "内容审核绑定的任务或事实不完整", 409)
    comparison = None
    comparison_source = db.get(ContentVersion, content.based_on_id) if content.based_on_id else None
    if comparison_source is None:
        comparison_source = db.scalar(
            select(ContentVersion)
            .where(
                ContentVersion.task_id == content.task_id,
                ContentVersion.version < content.version,
            )
            .order_by(ContentVersion.version.desc())
            .limit(1)
        )
    if comparison_source is not None:
        comparison = content_diff(comparison_source, content)
    lineage = _source_ai_lineage(db, content)
    return ContentReviewContext(
        content=content_version_out(db, content),
        task=content_task_out(db, task),
        fact_version=fact_version_out(db, fact, can_delete=can_delete_fact),
        diff=comparison,
        generation_trace=(
            GenerationTrace(
                job_id=lineage.generation_job.id,
                input_snapshot=lineage.generation_snapshot,
            )
            if lineage is not None
            else None
        ),
        humanization_traces=[
            HumanizationTrace(
                job_id=item.job.id,
                source_content_version_id=item.snapshot.source_content.id,
                input_snapshot=item.snapshot,
            )
            for item in (lineage.humanizations if lineage is not None else ())
        ],
        available_actions=(
            content_review_actions(content, fact)
            if task.current_content_version_id == content.id
            else []
        ),
        review_history=_content_history(db, content),
    )


def transition_fact_version(
    *,
    db: Session,
    fact_version_id: uuid.UUID,
    expected_revision: int,
    comment: str,
    actor: User,
    request_id: str,
    action: FactAction,
) -> FactVersionOut:
    """事务化执行事实状态转换并追加审核与审计记录。"""
    version = db.scalar(
        select(FactVersion).where(FactVersion.id == fact_version_id).with_for_update()
    )
    if version is None:
        raise not_found("事实版本")
    if version.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "事实版本已被其他请求修改", 409)
    expected, target = FACT_TRANSITIONS[action]
    if version.status not in expected:
        raise AppError(
            "INVALID_STATE_TRANSITION", f"事实版本不能从 {version.status} 执行 {action}", 409
        )
    if action == "request-changes" and not comment.strip():
        raise AppError("REVIEW_COMMENT_REQUIRED", "退回意见不能为空", 422)
    previous_status = version.status
    version.status = target
    version.revision += 1
    if action == "approve":
        version.approved_by = actor.id
        version.approved_at = datetime.now(UTC)
    db.add(
        FactReviewRecord(
            fact_version_id=version.id,
            action=action,
            comment=comment.strip() if action == "request-changes" else comment,
            actor_id=actor.id,
        )
    )
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.PRODUCT_FACTS,
            action=f"fact_version.{action}",
            target_type="FactVersion",
            target_id=version.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message={
                "approve": "事实版本已审核通过",
                "request-changes": "事实版本已退回修改",
                "retire": "事实版本已退役",
            }[action],
            details={
                "changes": [
                    {
                        "field": "status",
                        "before": previous_status,
                        "after": version.status,
                    }
                ],
                "facts": {"revision": version.revision},
            },
        ),
    )
    db.commit()
    return fact_version_out(db, version, can_delete=actor.account_type == "ADMIN")


def transition_content_version(
    *,
    db: Session,
    content_version_id: uuid.UUID,
    expected_revision: int,
    comment: str,
    actor: User,
    request_id: str,
    action: ContentAction,
) -> ContentVersionOut:
    """事务化执行内容审核状态机和最终质量门禁。"""
    content = db.scalar(
        select(ContentVersion).where(ContentVersion.id == content_version_id).with_for_update()
    )
    if content is None:
        raise not_found("内容版本")
    if content.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "内容版本已被其他请求修改", 409)
    task = db.scalar(
        select(ContentTask).where(ContentTask.id == content.task_id).with_for_update()
    )
    if task is None or task.current_content_version_id != content.id:
        raise AppError("CONTENT_VERSION_NOT_CURRENT", "只有任务当前内容版本可以审核", 409)
    expected, target = CONTENT_TRANSITIONS[action]
    if content.status not in expected:
        raise AppError(
            "INVALID_STATE_TRANSITION", f"内容版本不能从 {content.status} 执行 {action}", 409
        )
    if action == "request-changes" and not comment.strip():
        raise AppError("REVIEW_COMMENT_REQUIRED", "退回意见不能为空", 422)
    blocking = any(issue.get("severity") == "BLOCKING" for issue in content.quality_issues)
    if action in {"submit-review", "approve"} and blocking:
        raise AppError("INVALID_STATE_TRANSITION", "内容存在阻断质量问题，不能审核通过", 409)
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
    previous_status = content.status
    content.status = target
    content.revision += 1
    db.add(
        ContentReviewRecord(
            content_version_id=content.id,
            action=action,
            comment=comment.strip() if action == "request-changes" else comment,
            actor_id=actor.id,
        )
    )
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONTENT_REVIEW,
            action=f"content_version.{action}",
            target_type="ContentVersion",
            target_id=content.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message={
                "submit-review": "内容版本已提交审核",
                "approve": "内容版本已审核通过",
                "request-changes": "内容版本已退回修改",
            }[action],
            details={
                "changes": [
                    {
                        "field": "status",
                        "before": previous_status,
                        "after": content.status,
                    }
                ],
                "facts": {"revision": content.revision},
            },
        ),
    )
    db.commit()
    return content_version_out(db, content)
