"""Slice 4C：内容生产漏斗、审核通过率与公开页面健康 SQL 下推计算服务。"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import datetime
from typing import Any

from sqlalchemy import Text, any_, bindparam, cast, column, exists, func, select
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Session

from app.models.content import ContentReviewRecord, ContentTask, ContentVersion
from app.models.product_facts import Product
from app.models.publication import (
    PublicationVerification,
    PublicationWork,
    PublishedArticle,
    PublishedArticleHealthCheck,
    PublishedContentIssue,
)
from app.schemas.operations_dashboard import (
    ProductionMetricsOut,
    PublishingHealthOut,
)


def any_uuid(field: Any, values: Iterable[uuid.UUID]) -> Any:
    """使用单个类型化 UUID 数组参数，避免巨量 IN (...) 触碰 PG 65,535 参数上限。"""
    return field == any_(bindparam(None, list(values), type_=ARRAY(PGUUID(as_uuid=True))))


def ratio(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round(numerator / denominator, 4)


def _round_hours(avg_seconds: float | None) -> float | None:
    if avg_seconds is None:
        return None
    return round(max(0.0, float(avg_seconds)) / 3600.0, 2)


def compute_production_metrics(
    db: Session,
    *,
    campaign_id: uuid.UUID | None,
    product_ids: list[uuid.UUID] | None,
    since: datetime,
    now: datetime,
) -> ProductionMetricsOut:
    """按统一时间窗口 [since, now] 计算内容生产漏斗、事件口径产出与周期耗时。"""
    # 1. 产品事实逾期复核数（存量健康状态）
    if product_ids is not None:
        overdue_fact_count = (
            int(
                db.scalar(
                    select(func.count())
                    .select_from(Product)
                    .where(
                        any_uuid(Product.id, product_ids),
                        Product.status == "ACTIVE",
                        Product.next_review_at.is_not(None),
                        Product.next_review_at <= now,
                    )
                )
                or 0
            )
            if product_ids
            else 0
        )
    else:
        overdue_fact_count = int(
            db.scalar(
                select(func.count())
                .select_from(Product)
                .where(
                    Product.status == "ACTIVE",
                    Product.next_review_at.is_not(None),
                    Product.next_review_at <= now,
                )
            )
            or 0
        )

    task_scope = (
        [ContentTask.campaign_id == campaign_id] if campaign_id is not None else []
    )

    # 2. 窗口内新建任务数
    task_count = int(
        db.scalar(
            select(func.count())
            .select_from(ContentTask)
            .where(
                *task_scope,
                ContentTask.created_at >= since,
                ContentTask.created_at <= now,
            )
        )
        or 0
    )

    # 3. 窗口内存在高重复告警标记的当前内容版本数（JSONB 条件完全下推至 PG）
    issue_elem = func.jsonb_array_elements(ContentVersion.quality_issues).table_valued(
        column("value", JSONB)
    )
    has_near_dup = exists(
        select(1)
        .select_from(issue_elem)
        .where(cast(issue_elem.c.value["code"].astext, Text) == "NEAR_DUPLICATE_CONTENT")
    )
    near_dup_count = int(
        db.scalar(
            select(func.count())
            .select_from(ContentTask)
            .join(ContentVersion, ContentVersion.id == ContentTask.current_content_version_id)
            .where(
                *task_scope,
                ContentTask.created_at >= since,
                ContentTask.created_at <= now,
                has_near_dup,
            )
        )
        or 0
    )

    # 4. 窗口内审批通过的任务数（事件口径：ContentReviewRecord.action='approve' 落在 [since, now]）
    approved_task_count = int(
        db.scalar(
            select(func.count(func.distinct(ContentVersion.task_id)))
            .select_from(ContentReviewRecord)
            .join(ContentVersion, ContentVersion.id == ContentReviewRecord.content_version_id)
            .join(ContentTask, ContentTask.id == ContentVersion.task_id)
            .where(
                *task_scope,
                ContentReviewRecord.action == "approve",
                ContentReviewRecord.created_at >= since,
                ContentReviewRecord.created_at <= now,
            )
        )
        or 0
    )

    # 5. 审核一次通过率（对在窗口内完成首次审核裁决的任务统计）
    first_decision_subq = (
        select(
            ContentVersion.task_id.label("task_id"),
            ContentReviewRecord.action.label("first_action"),
            ContentReviewRecord.created_at.label("first_decided_at"),
        )
        .join(ContentVersion, ContentVersion.id == ContentReviewRecord.content_version_id)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .where(
            *task_scope,
            ContentReviewRecord.action.in_(("approve", "request-changes")),
        )
        .distinct(ContentVersion.task_id)
        .order_by(
            ContentVersion.task_id,
            ContentReviewRecord.created_at.asc(),
            ContentReviewRecord.id.asc(),
        )
        .subquery()
    )
    review_agg = db.execute(
        select(
            func.count().label("total"),
            func.count()
            .filter(first_decision_subq.c.first_action == "approve")
            .label("approved_first"),
        )
        .select_from(first_decision_subq)
        .where(
            first_decision_subq.c.first_decided_at >= since,
            first_decision_subq.c.first_decided_at <= now,
        )
    ).one()
    first_pass_rate = ratio(int(review_agg.approved_first or 0), int(review_agg.total or 0))

    # 6. 草稿 -> 首次批准平均耗时（窗口内批准事件）
    first_draft_subq = (
        select(
            ContentVersion.task_id.label("task_id"),
            func.min(ContentVersion.created_at).label("first_draft_at"),
        )
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .where(*task_scope)
        .group_by(ContentVersion.task_id)
        .subquery()
    )
    first_approve_subq = (
        select(
            ContentVersion.task_id.label("task_id"),
            func.min(ContentReviewRecord.created_at).label("first_approved_at"),
        )
        .join(ContentVersion, ContentVersion.id == ContentReviewRecord.content_version_id)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .where(*task_scope, ContentReviewRecord.action == "approve")
        .group_by(ContentVersion.task_id)
        .subquery()
    )
    avg_draft_to_approve_sec = db.scalar(
        select(
            func.avg(
                func.greatest(
                    0.0,
                    func.extract(
                        "epoch",
                        first_approve_subq.c.first_approved_at - first_draft_subq.c.first_draft_at,
                    ),
                )
            )
        )
        .select_from(first_approve_subq)
        .join(first_draft_subq, first_draft_subq.c.task_id == first_approve_subq.c.task_id)
        .where(
            first_approve_subq.c.first_approved_at >= since,
            first_approve_subq.c.first_approved_at <= now,
        )
    )

    # 7. 批准 -> 发布平均耗时（窗口内登记发布事件）
    ver_approve_subq = (
        select(
            ContentReviewRecord.content_version_id.label("cv_id"),
            func.min(ContentReviewRecord.created_at).label("approved_at"),
        )
        .where(ContentReviewRecord.action == "approve")
        .group_by(ContentReviewRecord.content_version_id)
        .subquery()
    )
    avg_approve_to_pub_sec = db.scalar(
        select(
            func.avg(
                func.greatest(
                    0.0,
                    func.extract(
                        "epoch",
                        PublicationWork.published_at - ver_approve_subq.c.approved_at,
                    ),
                )
            )
        )
        .select_from(PublicationWork)
        .join(ContentTask, ContentTask.id == PublicationWork.content_task_id)
        .join(ver_approve_subq, ver_approve_subq.c.cv_id == PublicationWork.content_version_id)
        .where(
            *task_scope,
            PublicationWork.published_at.is_not(None),
            PublicationWork.published_at >= since,
            PublicationWork.published_at <= now,
        )
    )

    # 8. 窗口内核验发布数与发布 -> 核验平均耗时（事件口径：PublicationVerification.created_at）
    verif_agg = db.execute(
        select(
            func.count(PublishedArticle.id).label("pub_count"),
            func.avg(
                func.greatest(
                    0.0,
                    func.extract(
                        "epoch",
                        PublicationVerification.created_at
                        - PublicationVerification.published_at_snapshot,
                    ),
                )
            ).label("avg_verify_sec"),
        )
        .select_from(PublishedArticle)
        .join(PublicationWork, PublicationWork.id == PublishedArticle.id)
        .join(ContentTask, ContentTask.id == PublicationWork.content_task_id)
        .join(
            PublicationVerification,
            PublicationVerification.id == PublishedArticle.verification_id,
        )
        .where(
            *task_scope,
            PublicationVerification.created_at >= since,
            PublicationVerification.created_at <= now,
        )
    ).one()

    return ProductionMetricsOut(
        task_count=task_count,
        approved_task_count=approved_task_count,
        published_article_count=int(verif_agg.pub_count or 0),
        first_pass_review_rate=first_pass_rate,
        avg_draft_to_approval_hours=_round_hours(avg_draft_to_approve_sec),
        avg_approval_to_publish_hours=_round_hours(avg_approve_to_pub_sec),
        avg_publish_to_verify_hours=_round_hours(verif_agg.avg_verify_sec),
        near_duplicate_version_count=near_dup_count,
        overdue_fact_product_count=overdue_fact_count,
    )


def compute_publishing_health(
    db: Session,
    *,
    campaign_id: uuid.UUID | None,
) -> PublishingHealthOut:
    """SQL 下推计算范围内全部存量公开文章的最新健康分布与发布后问题处置效率。"""
    scope_cond = (
        [ContentTask.campaign_id == campaign_id] if campaign_id is not None else []
    )
    scoped_articles = (
        select(PublishedArticle.id.label("article_id"))
        .join(PublicationWork, PublicationWork.id == PublishedArticle.id)
        .join(ContentTask, ContentTask.id == PublicationWork.content_task_id)
        .where(*scope_cond)
        .subquery()
    )

    total_articles = int(
        db.scalar(select(func.count()).select_from(scoped_articles)) or 0
    )
    if total_articles == 0:
        return PublishingHealthOut(
            published_article_count=0,
            healthy_articles=0,
            fetch_blocked_articles=0,
            confirmed_anomaly_articles=0,
            unchecked_articles=0,
            open_issues=0,
            resolved_issues=0,
        )

    latest_checks_subq = (
        select(
            PublishedArticleHealthCheck.published_article_id.label("article_id"),
            PublishedArticleHealthCheck.status.label("status"),
        )
        .join(
            scoped_articles,
            scoped_articles.c.article_id == PublishedArticleHealthCheck.published_article_id,
        )
        .distinct(PublishedArticleHealthCheck.published_article_id)
        .order_by(
            PublishedArticleHealthCheck.published_article_id,
            PublishedArticleHealthCheck.checked_at.desc(),
            PublishedArticleHealthCheck.id.desc(),
        )
        .subquery()
    )
    status_counts = {
        st: int(cnt)
        for st, cnt in db.execute(
            select(latest_checks_subq.c.status, func.count())
            .select_from(latest_checks_subq)
            .group_by(latest_checks_subq.c.status)
        ).tuples()
    }
    healthy = status_counts.get("HEALTHY", 0)
    blocked = status_counts.get("FETCH_BLOCKED", 0)
    anomaly = status_counts.get("CONFIRMED_ANOMALY", 0)
    unchecked = max(0, total_articles - (healthy + blocked + anomaly))

    issue_agg = db.execute(
        select(
            func.count().filter(PublishedContentIssue.status == "OPEN").label("open_cnt"),
            func.count().filter(PublishedContentIssue.status == "RESOLVED").label("res_cnt"),
            func.avg(
                func.greatest(
                    0.0,
                    func.extract(
                        "epoch",
                        PublishedContentIssue.resolved_at - PublishedContentIssue.opened_at,
                    ),
                )
            )
            .filter(
                PublishedContentIssue.status == "RESOLVED",
                PublishedContentIssue.resolved_at.is_not(None),
            )
            .label("avg_res_sec"),
        )
        .select_from(PublishedContentIssue)
        .join(
            scoped_articles,
            scoped_articles.c.article_id == PublishedContentIssue.published_article_id,
        )
    ).one()

    return PublishingHealthOut(
        published_article_count=total_articles,
        healthy_articles=healthy,
        fetch_blocked_articles=blocked,
        confirmed_anomaly_articles=anomaly,
        unchecked_articles=unchecked,
        open_issues=int(issue_agg.open_cnt or 0),
        resolved_issues=int(issue_agg.res_cnt or 0),
        avg_issue_resolution_hours=_round_hours(issue_agg.avg_res_sec),
    )
