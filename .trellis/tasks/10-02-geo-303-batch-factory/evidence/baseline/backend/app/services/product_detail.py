"""Product Detail 单请求只读投影。"""

from __future__ import annotations

import uuid

from sqlalchemy import case, func, literal, select, union_all
from sqlalchemy.orm import Session

from app.errors import not_found
from app.models.content import ContentReviewRecord, ContentTask, ContentVersion
from app.models.geo_files import GeoObservation
from app.models.identity import AuditLog, User
from app.models.product_facts import FactReviewRecord, FactVersion, Product
from app.models.publication import PublicationWork, PublicationWorkEvent, PublishedArticle
from app.schemas.content import ActorSummary
from app.schemas.product_detail import (
    ProductDetail,
    ProductDetailActivityItem,
    ProductDetailContentSummary,
    ProductDetailGeoSummary,
    ProductDetailPublishingSummary,
)
from app.services.geo_observation import GeoObservationFilters, get_geo_metrics
from app.services.product_facts import product_out
from app.services.projections import content_tasks_out

_ACTIVITY_LABELS = {
    ("PRODUCT", "product.created"): "创建产品",
    ("PRODUCT", "product.updated"): "更新产品基本信息",
    ("FACT_REVIEW", "submit-review"): "提交事实审核",
    ("FACT_REVIEW", "approve"): "批准事实版本",
    ("FACT_REVIEW", "request-changes"): "要求修订事实版本",
    ("FACT_REVIEW", "retire"): "退役事实版本",
    ("CONTENT_TASK", "CREATED"): "创建内容任务",
    ("CONTENT_REVIEW", "submit-review"): "提交内容审核",
    ("CONTENT_REVIEW", "approve"): "批准内容版本",
    ("CONTENT_REVIEW", "request-changes"): "要求修订内容版本",
    ("PUBLICATION", "CREATED"): "开始发布工作",
    ("PUBLICATION", "CONTENT_VERSION_CHANGED"): "切换发布内容版本",
    ("PUBLICATION", "PREPARATION_UPDATED"): "更新发布准备信息",
    ("PUBLICATION", "PLATFORM_REVIEW_MARKED"): "标记平台审核中",
    ("PUBLICATION", "RESULT_REGISTERED"): "登记发布结果",
    ("PUBLICATION", "VERIFICATION_FAILED"): "发布核验失败",
    ("PUBLICATION", "COMPLETED"): "发布核验通过",
    ("PUBLICATION", "CLOSED"): "关闭发布工作",
    ("GEO_OBSERVATION", "CREATED"): "创建 GEO 观测",
    ("GEO_OBSERVATION", "CORRECTED"): "更正 GEO 观测",
}

_TARGET_LABELS = {
    "PRODUCT": "产品",
    "FACT_VERSION": "事实版本",
    "CONTENT_TASK": "内容任务",
    "CONTENT_VERSION": "内容版本",
    "PUBLICATION_WORK": "发布工作",
    "GEO_OBSERVATION": "GEO 观测",
}


def _activity_items(db: Session, product_id: uuid.UUID) -> list[ProductDetailActivityItem]:
    """按权威追加记录汇总并稳定排序最近十项 Activity。"""
    product_events = select(
        AuditLog.id.label("source_id"),
        literal("PRODUCT").label("kind"),
        AuditLog.action.label("action"),
        AuditLog.created_at.label("timestamp"),
        AuditLog.actor_id.label("actor_id"),
        literal("PRODUCT").label("target_kind"),
        literal(product_id).label("target_id"),
    ).where(
        AuditLog.target_type == "Product",
        AuditLog.target_id == str(product_id),
        AuditLog.action.in_(("product.created", "product.updated")),
    )
    fact_events = (
        select(
            FactReviewRecord.id,
            literal("FACT_REVIEW"),
            FactReviewRecord.action,
            FactReviewRecord.created_at,
            FactReviewRecord.actor_id,
            literal("FACT_VERSION"),
            FactReviewRecord.fact_version_id,
        )
        .join(FactVersion, FactVersion.id == FactReviewRecord.fact_version_id)
        .where(FactVersion.product_id == product_id)
    )
    task_events = select(
        ContentTask.id,
        literal("CONTENT_TASK"),
        literal("CREATED"),
        ContentTask.created_at,
        ContentTask.created_by,
        literal("CONTENT_TASK"),
        ContentTask.id,
    ).where(ContentTask.product_id == product_id)
    content_review_events = (
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
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .where(ContentTask.product_id == product_id)
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
        .join(
            PublicationWork,
            PublicationWork.id == PublicationWorkEvent.publication_work_id,
        )
        .join(ContentTask, ContentTask.id == PublicationWork.content_task_id)
        .where(ContentTask.product_id == product_id)
    )
    geo_events = select(
        GeoObservation.id,
        literal("GEO_OBSERVATION"),
        case(
            (GeoObservation.supersedes_id.is_not(None), literal("CORRECTED")),
            else_=literal("CREATED"),
        ),
        GeoObservation.created_at,
        GeoObservation.tested_by,
        literal("GEO_OBSERVATION"),
        GeoObservation.id,
    ).where(GeoObservation.product_id == product_id)
    activity = union_all(
        product_events,
        fact_events,
        task_events,
        content_review_events,
        publication_events,
        geo_events,
    ).subquery()
    rows = db.execute(
        select(activity)
        .order_by(
            activity.c.timestamp.desc(),
            activity.c.kind.asc(),
            activity.c.source_id.desc(),
        )
        .limit(10)
    ).all()
    actor_ids = {row.actor_id for row in rows if row.actor_id is not None}
    actors = {
        actor.id: ActorSummary(
            id=actor.id,
            username=actor.username,
            display_name=actor.display_name,
        )
        for actor in db.scalars(select(User).where(User.id.in_(actor_ids)))
    }

    items: list[ProductDetailActivityItem] = []
    for row in rows:
        label = _ACTIVITY_LABELS.get((row.kind, row.action))
        target_label = _TARGET_LABELS.get(row.target_kind)
        if label is None or target_label is None:
            raise RuntimeError(f"Product Detail 遇到未登记 Activity：{row.kind}/{row.action}")
        items.append(
            ProductDetailActivityItem.model_validate(
                {
                    "id": row.source_id,
                    "kind": row.kind,
                    "label": label,
                    "timestamp": row.timestamp,
                    "actor": actors.get(row.actor_id),
                    "target": {
                        "kind": row.target_kind,
                        "id": row.target_id,
                        "label": target_label,
                    },
                }
            )
        )
    return items


def product_detail_out(
    db: Session,
    product_id: uuid.UUID,
    *,
    actor: User,
) -> ProductDetail:
    """在当前请求事务快照内形成 Product Detail 完整投影。"""
    product = db.get(Product, product_id)
    if product is None:
        raise not_found("产品")

    versions = list(
        db.scalars(
            select(FactVersion)
            .where(FactVersion.product_id == product_id)
            .order_by(FactVersion.version.desc())
        )
    )
    approved = next((version for version in versions if version.status == "APPROVED"), None)
    latest_version = versions[0] if versions else None
    pending = (
        latest_version
        if latest_version is not None
        and latest_version.status in {"PENDING_REVIEW", "CHANGES_REQUESTED"}
        else None
    )

    task_count = int(
        db.scalar(
            select(func.count())
            .select_from(ContentTask)
            .where(ContentTask.product_id == product_id)
        )
        or 0
    )
    latest_task = db.scalar(
        select(ContentTask)
        .where(ContentTask.product_id == product_id)
        .order_by(ContentTask.created_at.desc(), ContentTask.id.desc())
        .limit(1)
    )
    latest_task_projection = (
        content_tasks_out(
            db,
            [latest_task],
            can_permanently_delete=actor.account_type == "ADMIN",
        )[0]
        if latest_task is not None
        else None
    )

    article_count = int(
        db.scalar(
            select(func.count())
            .select_from(PublishedArticle)
            .join(PublicationWork, PublicationWork.id == PublishedArticle.id)
            .join(ContentTask, ContentTask.id == PublicationWork.content_task_id)
            .where(ContentTask.product_id == product_id)
        )
        or 0
    )
    latest_publication = db.execute(
        select(PublicationWork, PublishedArticle.id.label("article_id"))
        .join(ContentTask, ContentTask.id == PublicationWork.content_task_id)
        .outerjoin(PublishedArticle, PublishedArticle.id == PublicationWork.id)
        .where(ContentTask.product_id == product_id)
        .order_by(PublicationWork.updated_at.desc(), PublicationWork.id.desc())
        .limit(1)
    ).one_or_none()

    geo_metrics = get_geo_metrics(
        db,
        filters=GeoObservationFilters(product_id=product_id),
        actor=actor,
    )
    return ProductDetail(
        product=product_out(db, product, can_delete=actor.account_type == "ADMIN"),
        approved_fact=(
            {
                "id": approved.id,
                "version": approved.version,
                "status": approved.status,
                "classification": approved.classification,
                "approved_at": approved.approved_at,
            }
            if approved is not None
            else None
        ),
        pending_fact=(
            {
                "id": pending.id,
                "version": pending.version,
                "status": pending.status,
                "classification": pending.classification,
                "created_at": pending.created_at,
            }
            if pending is not None
            else None
        ),
        content=ProductDetailContentSummary(
            task_count=task_count,
            latest_task=(
                {
                    "task_id": latest_task.id,
                    "workflow_stage": latest_task_projection.workflow_stage,
                    "created_at": latest_task.created_at,
                }
                if latest_task is not None and latest_task_projection is not None
                else None
            ),
        ),
        publishing=ProductDetailPublishingSummary(
            published_article_count=article_count,
            latest=(
                {
                    "work_id": latest_publication.PublicationWork.id,
                    "article_id": latest_publication.article_id,
                    "status": latest_publication.PublicationWork.status,
                    "actual_title": latest_publication.PublicationWork.actual_title,
                    "updated_at": latest_publication.PublicationWork.updated_at,
                }
                if latest_publication is not None
                else None
            ),
        ),
        geo=ProductDetailGeoSummary(
            observation_count=(
                geo_metrics.legacy_sample_count + geo_metrics.manual_observation_count
            ),
            article_result_count=geo_metrics.article_result_count,
            discovery_rate=geo_metrics.article_discovery_rate,
            mention_rate=geo_metrics.article_mention_rate,
            accuracy_rate=geo_metrics.article_accuracy_rate,
        ),
        activity=_activity_items(db, product_id),
    )
