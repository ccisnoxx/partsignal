"""Frontend V2 Workbench 的单请求 PostgreSQL 聚合读模型。"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select, union
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.content import ContentTask, ContentVersion
from app.models.geo_files import GeoObservation, GeoObservationPublication
from app.models.product_facts import FactVersion, Product
from app.models.publication import (
    PublicationWork,
    PublicationWorkEvent,
    PublishedContentIssue,
)
from app.schemas.workbench import (
    WorkbenchAggregate,
    WorkbenchAttentionItem,
    WorkbenchRate,
    WorkbenchWorkflowHealthItem,
)
from app.services.geo_observation import (
    GeoObservationListFilters,
    geo_observation_list_query,
)
from app.services.publication_queries import (
    publication_work_actions,
    published_content_issue_actions,
)

_ATTENTION_LIMIT = 10
_PUBLICATION_ACTION_STATUSES = ("PREPARING", "PLATFORM_REVIEW", "ACTION_REQUIRED")
_PUBLICATION_ATTENTION_STATUSES = (
    *_PUBLICATION_ACTION_STATUSES,
    "AWAITING_VERIFICATION",
)


def _health(value: int) -> WorkbenchWorkflowHealthItem:
    return WorkbenchWorkflowHealthItem(
        status="CLEAR" if value == 0 else "ATTENTION",
        summary="无待处理项" if value == 0 else f"{value} 项待处理",
    )


def _rate(numerator: int, denominator: int) -> WorkbenchRate:
    return WorkbenchRate(
        numerator=numerator,
        denominator=denominator,
        value=numerator / denominator if denominator else None,
    )


def _window_count(rows: Sequence[Any]) -> int:
    return int(rows[0].total_count) if rows else 0


def _fact_review_items(db: Session) -> tuple[int, list[WorkbenchAttentionItem]]:
    rows = db.execute(
        select(
            FactVersion.id,
            FactVersion.product_id,
            Product.brand,
            Product.part_number,
            FactVersion.created_at,
            func.count().over().label("total_count"),
        )
        .join(Product, Product.id == FactVersion.product_id)
        .where(FactVersion.status == "PENDING_REVIEW")
        .order_by(FactVersion.created_at.desc(), FactVersion.id)
        .limit(_ATTENTION_LIMIT)
    ).all()
    return _window_count(rows), [
        WorkbenchAttentionItem(
            category="FACT_REVIEW",
            resource_id=fact_id,
            title=f"{brand} {part_number}",
            summary="事实版本待审核",
            occurred_at=created_at,
            href=f"/products/{product_id}/facts/review",
        )
        for fact_id, product_id, brand, part_number, created_at, _total in rows
    ]


def _content_review_items(db: Session) -> tuple[int, list[WorkbenchAttentionItem]]:
    rows = db.execute(
        select(
            ContentVersion.id,
            ContentVersion.task_id,
            ContentVersion.title,
            ContentVersion.created_at,
            func.count().over().label("total_count"),
        )
        .join(
            ContentTask,
            ContentTask.current_content_version_id == ContentVersion.id,
        )
        .where(ContentVersion.status == "PENDING_REVIEW")
        .order_by(ContentVersion.created_at.desc(), ContentVersion.id)
        .limit(_ATTENTION_LIMIT)
    ).all()
    return _window_count(rows), [
        WorkbenchAttentionItem(
            category="CONTENT_REVIEW",
            resource_id=content_id,
            title=title,
            summary="内容版本待审核",
            occurred_at=created_at,
            href=f"/content/tasks/{task_id}/review",
        )
        for content_id, task_id, title, created_at, _total in rows
    ]


def _publication_items(
    db: Session,
) -> tuple[int, int, list[WorkbenchAttentionItem]]:
    counts = {
        status: int(count)
        for status, count in db.execute(
            select(PublicationWork.status, func.count())
            .where(PublicationWork.status.in_(_PUBLICATION_ATTENTION_STATUSES))
            .group_by(PublicationWork.status)
        )
    }
    latest_event_action = (
        select(PublicationWorkEvent.action)
        .where(PublicationWorkEvent.publication_work_id == PublicationWork.id)
        .order_by(PublicationWorkEvent.created_at.desc(), PublicationWorkEvent.id.desc())
        .limit(1)
        .correlate(PublicationWork)
        .scalar_subquery()
    )
    rows = db.execute(
        select(
            PublicationWork.id,
            PublicationWork.status,
            ContentVersion.title,
            PublicationWork.platform_profile_name_snapshot,
            PublicationWork.updated_at,
            latest_event_action.label("latest_event_action"),
        )
        .join(ContentVersion, ContentVersion.id == PublicationWork.content_version_id)
        .where(PublicationWork.status.in_(_PUBLICATION_ATTENTION_STATUSES))
        .order_by(PublicationWork.updated_at.desc(), PublicationWork.id)
        .limit(_ATTENTION_LIMIT)
    ).all()
    primary_sections = {
        "CONTINUE_PREPARATION": "preparation",
        "REGISTER_RESULT": "result",
        "RUN_FIRST_VERIFICATION": "verification",
        "FIX_AND_REVERIFY": "verification",
    }
    status_labels = {
        "PREPARING": "继续准备",
        "PLATFORM_REVIEW": "登记发布结果",
        "AWAITING_VERIFICATION": "等待首次核验",
        "ACTION_REQUIRED": "修复并复核",
    }
    items: list[WorkbenchAttentionItem] = []
    for work_id, status, title, platform_name, updated_at, event_action in rows:
        if event_action is None:
            raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布工作缺少状态事件", 409)
        _actions, primary_task = publication_work_actions(status, event_action)
        section = primary_sections[primary_task]
        items.append(
            WorkbenchAttentionItem(
                category=(
                    "PUBLICATION_VERIFICATION"
                    if status == "AWAITING_VERIFICATION"
                    else "PUBLICATION_ACTION"
                ),
                resource_id=work_id,
                title=title,
                summary=f"{platform_name} · {status_labels[status]}",
                occurred_at=updated_at,
                href=f"/publishing/work/{work_id}#{section}",
            )
        )
    verification_count = counts.get("AWAITING_VERIFICATION", 0)
    action_count = sum(counts.get(status, 0) for status in _PUBLICATION_ACTION_STATUSES)
    return verification_count, action_count, items


def _content_issue_items(db: Session) -> tuple[int, list[WorkbenchAttentionItem]]:
    rows = db.execute(
        select(
            PublishedContentIssue.id,
            PublishedContentIssue.kind,
            PublishedContentIssue.opened_at,
            ContentVersion.title,
            PublicationWork.platform_profile_name_snapshot,
            ContentTask.id.label("repair_task_id"),
            ContentTask.status.label("repair_task_status"),
            func.count().over().label("total_count"),
        )
        .join(PublicationWork, PublicationWork.id == PublishedContentIssue.published_article_id)
        .join(ContentVersion, ContentVersion.id == PublicationWork.content_version_id)
        .outerjoin(
            ContentTask,
            ContentTask.source_published_content_issue_id == PublishedContentIssue.id,
        )
        .where(PublishedContentIssue.status == "OPEN")
        .order_by(PublishedContentIssue.opened_at.desc(), PublishedContentIssue.id)
        .limit(_ATTENTION_LIMIT)
    ).all()
    kind_labels = {
        "PAGE_UNAVAILABLE": "页面不可用",
        "CONTENT_CHANGED": "内容已变化",
        "OTHER": "其他内容问题",
    }
    items: list[WorkbenchAttentionItem] = []
    for (
        issue_id,
        kind,
        opened_at,
        title,
        platform_name,
        repair_task_id,
        repair_task_status,
        _total,
    ) in rows:
        _actions, _stage, primary_task = published_content_issue_actions(
            status="OPEN",
            repair_task_id=repair_task_id,
            repair_task_status=repair_task_status,
        )
        if primary_task == "CONTINUE_REPAIR":
            href = f"/content/tasks/{repair_task_id}"
        else:
            section = "repair" if primary_task == "HANDLE_CONTENT_ISSUE" else "resolution"
            href = f"/publishing/issues/{issue_id}#{section}"
        items.append(
            WorkbenchAttentionItem(
                category="CONTENT_ISSUE",
                resource_id=issue_id,
                title=title,
                summary=f"{platform_name} · {kind_labels[kind]}",
                occurred_at=opened_at,
                href=href,
            )
        )
    return _window_count(rows), items


def _geo_issue_ids(date_from: date, date_to: date) -> Any:
    return union(
        geo_observation_list_query(
            GeoObservationListFilters(
                accuracy="PARTIAL",
                date_from=date_from,
                date_to=date_to,
            )
        ).with_only_columns(GeoObservation.id),
        geo_observation_list_query(
            GeoObservationListFilters(
                accuracy="INCORRECT",
                date_from=date_from,
                date_to=date_to,
            )
        ).with_only_columns(GeoObservation.id),
    ).subquery()


def _geo_accuracy_items(
    db: Session,
    *,
    date_from: date,
    date_to: date,
) -> tuple[int, list[WorkbenchAttentionItem]]:
    issue_ids = _geo_issue_ids(date_from, date_to)
    rows = db.execute(
        select(
            GeoObservation.id,
            GeoObservation.observation_kind,
            GeoObservation.search_query,
            GeoObservation.search_platform,
            GeoObservation.model_name,
            GeoObservation.accuracy,
            GeoObservation.tested_at,
            Product.brand,
            Product.part_number,
            func.count().over().label("total_count"),
        )
        .join(issue_ids, issue_ids.c.id == GeoObservation.id)
        .join(Product, Product.id == GeoObservation.product_id)
        .order_by(GeoObservation.tested_at.desc(), GeoObservation.id)
        .limit(_ATTENTION_LIMIT)
    ).all()
    items: list[WorkbenchAttentionItem] = []
    for (
        observation_id,
        kind,
        search_query,
        search_platform,
        model_name,
        legacy_accuracy,
        tested_at,
        brand,
        part_number,
        _total,
    ) in rows:
        if kind == "MANUAL_ARTICLE_SEARCH":
            title = search_query
            summary = f"{search_platform} · 存在部分或不准确结果"
        else:
            title = f"{brand} {part_number}"
            summary = f"{model_name} · {legacy_accuracy}"
        if not title or not summary:
            raise AppError("GEO_OBSERVATION_CONTEXT_INCOMPLETE", "GEO 观测摘要不完整", 409)
        items.append(
            WorkbenchAttentionItem(
                category="GEO_ACCURACY_ISSUE",
                resource_id=observation_id,
                title=title,
                summary=summary,
                occurred_at=tested_at,
                href=f"/geo/observations/{observation_id}",
            )
        )
    return _window_count(rows), items


def _geo_rates(
    db: Session,
    *,
    date_from: date,
    date_to: date,
) -> tuple[WorkbenchRate, WorkbenchRate, WorkbenchRate]:
    current_manual_ids = (
        geo_observation_list_query(
            GeoObservationListFilters(date_from=date_from, date_to=date_to)
        )
        .where(GeoObservation.observation_kind == "MANUAL_ARTICLE_SEARCH")
        .with_only_columns(GeoObservation.id)
        .subquery()
    )
    row = db.execute(
        select(
            func.count().label("total"),
            func.count().filter(GeoObservationPublication.discovered.is_(True)).label("discovered"),
            func.count().filter(GeoObservationPublication.mentioned.is_(True)).label("mentioned"),
            func.count()
            .filter(
                GeoObservationPublication.accuracy.is_not(None),
                GeoObservationPublication.accuracy != "UNJUDGEABLE",
            )
            .label("accuracy_denominator"),
            func.count()
            .filter(GeoObservationPublication.accuracy == "ACCURATE")
            .label("accurate"),
        )
        .select_from(GeoObservationPublication)
        .join(
            current_manual_ids,
            current_manual_ids.c.id == GeoObservationPublication.observation_id,
        )
    ).one()
    total = int(row.total)
    return (
        _rate(int(row.discovered), total),
        _rate(int(row.mentioned), total),
        _rate(int(row.accurate), int(row.accuracy_denominator)),
    )


def get_workbench_aggregate(db: Session) -> WorkbenchAggregate:
    """从一个一致快照返回首页所需的最小、可操作聚合。"""
    generated_at = datetime.now(UTC)
    date_to = generated_at.date()
    date_from = date_to - timedelta(days=29)

    fact_count, fact_items = _fact_review_items(db)
    content_count, content_items = _content_review_items(db)
    verification_count, publication_action_count, publication_items = _publication_items(db)
    issue_count, issue_items = _content_issue_items(db)
    geo_issue_count, geo_items = _geo_accuracy_items(
        db,
        date_from=date_from,
        date_to=date_to,
    )
    discovery_rate, mention_rate, accuracy_rate = _geo_rates(
        db,
        date_from=date_from,
        date_to=date_to,
    )

    attention_items = sorted(
        [*fact_items, *content_items, *publication_items, *issue_items, *geo_items],
        key=lambda item: (
            -item.occurred_at.timestamp(),
            item.category,
            str(item.resource_id),
        ),
    )[:_ATTENTION_LIMIT]
    publication_health_count = verification_count + publication_action_count + issue_count
    return WorkbenchAggregate.model_validate(
        {
            "generated_at": generated_at,
            "actionable_counts": {
                "fact_reviews": {
                    "value": fact_count,
                    "href": (
                        "/products?page=1&factStatus=PENDING_REVIEW"
                        "&workflowStage=FACT_REVIEW_PENDING"
                    ),
                },
                "content_reviews": {
                    "value": content_count,
                    "href": (
                        "/content/tasks?workflowStage=REVIEW_PENDING"
                        "&archiveStatus=ACTIVE&page=1&pageSize=20"
                    ),
                },
                "publication_verifications": {
                    "value": verification_count,
                    "href": "/publishing/work?status=AWAITING_VERIFICATION&page=1&pageSize=20",
                },
                "publication_actions": {
                    "value": publication_action_count,
                    "links": [
                        {
                            "label": "继续准备",
                            "href": "/publishing/work?status=PREPARING&page=1&pageSize=20",
                        },
                        {
                            "label": "平台处理中",
                            "href": "/publishing/work?status=PLATFORM_REVIEW&page=1&pageSize=20",
                        },
                        {
                            "label": "需要处理",
                            "href": "/publishing/work?status=ACTION_REQUIRED&page=1&pageSize=20",
                        },
                    ],
                },
                "content_issues": {
                    "value": issue_count,
                    "href": "/publishing/issues?status=OPEN&page=1&pageSize=20",
                },
                "geo_accuracy_issues": {
                    "value": geo_issue_count,
                    "links": [
                        {
                            "label": "部分准确",
                            "href": "/geo/observations?accuracy=PARTIAL&page=1&pageSize=20",
                        },
                        {
                            "label": "不准确",
                            "href": "/geo/observations?accuracy=INCORRECT&page=1&pageSize=20",
                        },
                    ],
                },
            },
            "workflow_health": {
                "product_facts": _health(fact_count),
                "content": _health(content_count),
                "publication": _health(publication_health_count),
                "geo": _health(geo_issue_count),
            },
            "geo_summary": {
                "window": {"date_from": date_from, "date_to": date_to},
                "discovery_rate": discovery_rate,
                "mention_rate": mention_rate,
                "accuracy_rate": accuracy_rate,
            },
            "recent_attention_items": attention_items,
        }
    )
