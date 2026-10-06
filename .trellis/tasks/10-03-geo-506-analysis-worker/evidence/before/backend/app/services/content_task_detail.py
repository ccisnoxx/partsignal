"""Content Task Detail 单请求只读投影。"""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import TypeAdapter
from sqlalchemy import func, literal, select, union_all
from sqlalchemy.orm import Session

from app.errors import not_found
from app.models.ai_generation import GenerationJob
from app.models.configuration import QueryTopic
from app.models.content import (
    ContentReviewRecord,
    ContentTask,
    ContentTaskGeoSource,
    ContentVersion,
)
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.models.publication import (
    PublicationVerification,
    PublicationWork,
    PublicationWorkEvent,
    PublishedArticle,
    PublishedContentIssue,
)
from app.schemas.content import ActorSummary
from app.schemas.content_task_detail import (
    ContentTaskDetail,
    ContentTaskDetailActivityItem,
    ContentTaskDetailSource,
)
from app.schemas.geo_files import (
    GeoContentDeclineBasis,
    GeoLongUnmentionedBasis,
    GeoQuestionCoverageGapBasis,
)
from app.services.projections import content_tasks_out

_GENERATION_ACTIVITY_SUMMARIES = {
    "GENERATE:PENDING": "创建原始生成作业",
    "GENERATE:RUNNING": "原始生成作业开始执行",
    "GENERATE:SUCCEEDED": "原始生成作业完成",
    "GENERATE:FAILED": "原始生成作业失败",
    "HUMANIZE:PENDING": "创建自然化作业",
    "HUMANIZE:RUNNING": "自然化作业开始执行",
    "HUMANIZE:SUCCEEDED": "自然化作业完成",
    "HUMANIZE:FAILED": "自然化作业失败",
}
_REVIEW_ACTIVITY_SUMMARIES = {
    "submit-review": "提交内容审核",
    "approve": "批准内容版本",
    "request-changes": "要求修订内容版本",
}
_PUBLICATION_ACTIVITY_SUMMARIES = {
    "CREATED": "开始发布工作",
    "CONTENT_VERSION_CHANGED": "切换发布内容版本",
    "PREPARATION_UPDATED": "更新发布准备信息",
    "PLATFORM_REVIEW_MARKED": "标记平台审核中",
    "RESULT_REGISTERED": "登记发布结果",
    "VERIFICATION_FAILED": "发布核验失败",
    "COMPLETED": "发布核验通过",
    "CLOSED": "关闭发布工作",
}
_GEO_BASIS_ADAPTER: TypeAdapter[
    GeoContentDeclineBasis | GeoLongUnmentionedBasis | GeoQuestionCoverageGapBasis
] = TypeAdapter(GeoContentDeclineBasis | GeoLongUnmentionedBasis | GeoQuestionCoverageGapBasis)


def _compact_geo_basis(snapshot: dict[str, Any]) -> dict[str, Any]:
    """先按 GEO 权威合同校验冻结快照，再只投影 Detail 实际绘制字段。"""
    basis = _GEO_BASIS_ADAPTER.validate_python(snapshot)
    if basis.rule_code == "CONTENT_DECLINE":
        return {
            "rule_code": basis.rule_code,
            "item": {
                "title": basis.item.title,
                "content_platform": basis.item.content_platform,
            },
        }
    if basis.rule_code == "LONG_UNMENTIONED":
        return {
            "rule_code": basis.rule_code,
            "item": {
                "title": basis.item.title,
                "unmentioned_days": basis.item.unmentioned_days,
            },
        }
    return {
        "rule_code": basis.rule_code,
        "item": {
            "canonical_question": basis.item.canonical_question,
            "geo_platform": basis.item.geo_platform,
        },
    }


def _activity_rows(db: Session, task_id: uuid.UUID) -> list[Any]:
    """从任务拥有的权威记录稳定选取最近十项 Activity。"""
    task_events = select(
        ContentTask.id.label("source_id"),
        literal("TASK").label("kind"),
        literal("CREATED").label("action"),
        ContentTask.created_at.label("timestamp"),
        ContentTask.created_by.label("actor_id"),
        literal("CONTENT_TASK").label("target_kind"),
        ContentTask.id.label("target_id"),
    ).where(ContentTask.id == task_id)
    generation_events = select(
        GenerationJob.id,
        literal("GENERATION"),
        GenerationJob.job_type + literal(":") + GenerationJob.status,
        func.coalesce(
            GenerationJob.finished_at,
            GenerationJob.started_at,
            GenerationJob.created_at,
        ),
        GenerationJob.created_by,
        literal("GENERATION_JOB"),
        GenerationJob.id,
    ).where(GenerationJob.content_task_id == task_id)
    content_events = select(
        ContentVersion.id,
        literal("CONTENT_VERSION"),
        literal("CREATED"),
        ContentVersion.created_at,
        ContentVersion.created_by,
        literal("CONTENT_VERSION"),
        ContentVersion.id,
    ).where(ContentVersion.task_id == task_id)
    review_events = (
        select(
            ContentReviewRecord.id,
            literal("CONTENT_REVIEW"),
            ContentReviewRecord.action,
            ContentReviewRecord.created_at,
            ContentReviewRecord.actor_id,
            literal("CONTENT_VERSION"),
            ContentReviewRecord.content_version_id,
        )
        .join(ContentVersion, ContentVersion.id == ContentReviewRecord.content_version_id)
        .where(ContentVersion.task_id == task_id)
    )
    publication_events = (
        select(
            PublicationWorkEvent.id,
            literal("PUBLICATION"),
            PublicationWorkEvent.action,
            PublicationWorkEvent.created_at,
            PublicationWorkEvent.actor_id,
            literal("PUBLICATION_WORK"),
            PublicationWorkEvent.publication_work_id,
        )
        .join(PublicationWork, PublicationWork.id == PublicationWorkEvent.publication_work_id)
        .where(PublicationWork.content_task_id == task_id)
    )
    activity = union_all(
        task_events,
        generation_events,
        content_events,
        review_events,
        publication_events,
    ).subquery()
    return list(
        db.execute(
            select(activity)
            .order_by(
                activity.c.timestamp.desc(),
                activity.c.kind.asc(),
                activity.c.source_id.desc(),
            )
            .limit(10)
        ).all()
    )


def _activity_summary(kind: str, action: str) -> str:
    if kind == "TASK" and action == "CREATED":
        return "创建内容任务"
    if kind == "CONTENT_VERSION" and action == "CREATED":
        return "创建内容版本"
    mapping = {
        "GENERATION": _GENERATION_ACTIVITY_SUMMARIES,
        "CONTENT_REVIEW": _REVIEW_ACTIVITY_SUMMARIES,
        "PUBLICATION": _PUBLICATION_ACTIVITY_SUMMARIES,
    }.get(kind)
    summary = mapping.get(action) if mapping is not None else None
    if summary is None:
        raise RuntimeError(f"Content Task Detail 遇到未登记 Activity：{kind}/{action}")
    return summary


def _activity_items(
    rows: list[Any], actors: dict[uuid.UUID, ActorSummary]
) -> list[ContentTaskDetailActivityItem]:
    items: list[ContentTaskDetailActivityItem] = []
    for row in rows:
        actor = actors.get(row.actor_id)
        if actor is None:
            raise RuntimeError(f"Content Task Detail Activity 操作者不存在：{row.actor_id}")
        target_label = {
            "CONTENT_TASK": "内容任务",
            "GENERATION_JOB": "生成作业",
            "CONTENT_VERSION": "内容版本",
            "PUBLICATION_WORK": "发布工作",
        }.get(row.target_kind)
        if target_label is None:
            raise RuntimeError(f"Content Task Detail 遇到未登记目标：{row.target_kind}")
        items.append(
            ContentTaskDetailActivityItem.model_validate(
                {
                    "id": row.source_id,
                    "kind": row.kind,
                    "timestamp": row.timestamp,
                    "actor": actor,
                    "summary": _activity_summary(row.kind, row.action),
                    "target": {
                        "kind": row.target_kind,
                        "id": row.target_id,
                        "label": target_label,
                    },
                }
            )
        )
    return items


def content_task_source_out(db: Session, task: ContentTask) -> ContentTaskDetailSource | None:
    """复用权威来源关系形成紧凑来源摘要。"""
    geo_source = db.scalar(
        select(ContentTaskGeoSource).where(ContentTaskGeoSource.content_task_id == task.id)
    )
    topic_id = task.query_topic_id or (
        geo_source.query_topic_id if geo_source is not None else None
    )
    query_topic = db.scalar(select(QueryTopic).where(QueryTopic.id == topic_id))
    issue = db.scalar(
        select(PublishedContentIssue).where(
            PublishedContentIssue.id == task.source_published_content_issue_id
        )
    )

    if query_topic is None and geo_source is None and issue is None:
        return None
    return ContentTaskDetailSource.model_validate(
        {
            "query_topic": (
                {"id": query_topic.id, "canonical_question": query_topic.canonical_question}
                if query_topic is not None
                else None
            ),
            "geo_optimization": (
                {
                    "rule_code": geo_source.rule_code,
                    "date_from": geo_source.date_from,
                    "date_to": geo_source.date_to,
                    "published_article_id": geo_source.published_article_id,
                    "geo_platform": geo_source.geo_platform,
                    "basis": _compact_geo_basis(geo_source.basis_snapshot),
                }
                if geo_source is not None
                else None
            ),
            "published_content_issue": (
                {
                    "id": issue.id,
                    "kind": issue.kind,
                    "status": issue.status,
                    "published_article_id": issue.published_article_id,
                    "opened_at": issue.opened_at,
                }
                if issue is not None
                else None
            ),
        }
    )


def content_task_detail_out(
    db: Session,
    task_id: uuid.UUID,
    *,
    actor: User,
) -> ContentTaskDetail:
    """在当前请求事务快照内形成 Content Task Detail 完整投影。"""
    task = db.get(ContentTask, task_id)
    if task is None:
        raise not_found("内容任务")

    task_projection = content_tasks_out(
        db,
        [task],
        can_permanently_delete=actor.account_type == "ADMIN",
    )[0]
    context = db.execute(
        select(Product, FactVersion)
        .join(FactVersion, FactVersion.product_id == Product.id)
        .where(Product.id == task.product_id, FactVersion.id == task.fact_version_id)
    ).one_or_none()
    if context is None:
        raise RuntimeError(f"内容任务 {task.id} 的产品或事实关联不存在")
    product, fact = context

    current_content = db.scalar(
        select(ContentVersion).where(ContentVersion.id == task.current_content_version_id)
    )
    if task.current_content_version_id is not None and (
        current_content is None or current_content.task_id != task.id
    ):
        raise RuntimeError(f"内容任务 {task.id} 的当前内容指针无效")

    generation = db.scalar(
        select(GenerationJob)
        .where(GenerationJob.content_task_id == task.id)
        .order_by(GenerationJob.created_at.desc(), GenerationJob.id.desc())
        .limit(1)
    )
    latest_review = db.scalar(
        select(ContentReviewRecord)
        .where(ContentReviewRecord.content_version_id == task.current_content_version_id)
        .order_by(ContentReviewRecord.created_at.desc(), ContentReviewRecord.id.desc())
        .limit(1)
    )
    publication = db.execute(
        select(PublicationWork, PublishedArticle, PublicationVerification)
        .outerjoin(PublishedArticle, PublishedArticle.id == PublicationWork.id)
        .outerjoin(
            PublicationVerification,
            PublicationVerification.id == PublishedArticle.verification_id,
        )
        .where(PublicationWork.content_task_id == task.id)
    ).one_or_none()

    source_payload = content_task_source_out(db, task)
    activity_rows = _activity_rows(db, task.id)
    actor_ids = {row.actor_id for row in activity_rows}
    if latest_review is not None:
        actor_ids.add(latest_review.actor_id)
    actors = {
        item.id: ActorSummary(
            id=item.id,
            username=item.username,
            display_name=item.display_name,
        )
        for item in db.scalars(select(User).where(User.id.in_(actor_ids)))
    }

    review_actor = actors.get(latest_review.actor_id) if latest_review is not None else None
    if latest_review is not None and review_actor is None:
        raise RuntimeError(f"Content Task Detail 审核操作者不存在：{latest_review.actor_id}")

    publishing_payload = None
    if publication is not None:
        work, article, verification = publication
        result = None
        if article is not None:
            if (
                verification is None
                or work.actual_title is None
                or work.final_url is None
                or work.published_at is None
            ):
                raise RuntimeError(f"发布成果 {article.id} 的核验结果不完整")
            result = {
                "id": article.id,
                "status": "VERIFIED",
                "actual_title": work.actual_title,
                "final_url": work.final_url,
                "published_at": work.published_at,
                "verified_at": verification.created_at,
            }
        publishing_payload = {
            "work": {"id": work.id, "status": work.status, "updated_at": work.updated_at},
            "result": result,
        }

    return ContentTaskDetail.model_validate(
        {
            "task": {
                "id": task.id,
                "identifier": task_projection.identifier,
                "status": task.status,
                "workflow_stage": task_projection.workflow_stage,
                "primary_task": task_projection.primary_task,
                "available_actions": task_projection.available_actions,
                "deletion": task_projection.deletion,
                "revision": task.revision,
                "created_by": task.created_by,
                "created_at": task.created_at,
                "archived_at": task.archived_at,
            },
            "product": {
                "id": product.id,
                "brand": product.brand,
                "part_number": product.part_number,
                "status": product.status,
            },
            "platform": task_projection.platform,
            "fact": {
                "id": fact.id,
                "version": fact.version,
                "status": fact.status,
                "classification": fact.classification,
            },
            "current_content": (
                {
                    "id": current_content.id,
                    "version": current_content.version,
                    "source_type": current_content.source_type,
                    "status": current_content.status,
                    "title": current_content.title,
                    "summary": current_content.summary,
                }
                if current_content is not None
                else None
            ),
            "generation": (
                {
                    "id": generation.id,
                    "job_type": generation.job_type,
                    "status": generation.status,
                    "attempt_count": generation.attempt_count,
                    "error_code": generation.error_code,
                    "error_summary": generation.error_summary,
                    "created_at": generation.created_at,
                    "started_at": generation.started_at,
                    "finished_at": generation.finished_at,
                }
                if generation is not None
                else None
            ),
            "review": (
                {
                    "content_version_id": current_content.id,
                    "status": current_content.status,
                    "latest_result": (
                        {
                            "action": latest_review.action,
                            "actor": review_actor,
                            "created_at": latest_review.created_at,
                        }
                        if latest_review is not None
                        else None
                    ),
                }
                if current_content is not None
                else None
            ),
            "publishing": publishing_payload,
            "source": source_payload,
            "activity": _activity_items(activity_rows, actors),
        }
    )
