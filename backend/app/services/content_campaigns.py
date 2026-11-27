"""内容活动策划（ContentCampaign）查询、状态投影与事务命令服务。"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Set as AbstractSet
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import delete, exists, func, select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.deps import DbSession
from app.errors import AppError, in_use, not_found
from app.models.campaign import (
    ContentCampaign,
    ContentCampaignMonitoringPlan,
    ContentCampaignPlatform,
    ContentCampaignProduct,
    ContentCampaignTopic,
)
from app.models.configuration import PlatformProfile, QueryTopic
from app.models.content import ContentTask, ContentTaskBatchRequest
from app.models.cost_accounting import OperatingCostEntry
from app.models.geo_interventions import GeoIntervention
from app.models.geo_monitoring_plans import GeoMonitoringPlan
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.models.publication import PublicationWork, PublishedArticle
from app.schemas.campaign import (
    ContentCampaignAction,
    ContentCampaignCounts,
    ContentCampaignCreate,
    ContentCampaignDetail,
    ContentCampaignListItem,
    ContentCampaignListPage,
    ContentCampaignMonitoringPlanItem,
    ContentCampaignOptions,
    ContentCampaignOwner,
    ContentCampaignPlatformItem,
    ContentCampaignPrimaryTask,
    ContentCampaignProductItem,
    ContentCampaignStatus,
    ContentCampaignTargetMetrics,
    ContentCampaignTopicItem,
    ContentCampaignUpdate,
    WorkPriority,
)
from app.schemas.common import DeletionBlocker, DeletionBlockerType, DeletionProjection
from app.services.product_facts import db_utc_now, product_facts_freshness

CampaignTransitionOperation = Literal["activate", "pause", "resume", "complete", "archive"]

_TRANSITION_RULES: dict[
    CampaignTransitionOperation, tuple[frozenset[str], ContentCampaignStatus, str, str]
] = {
    "activate": (frozenset({"DRAFT"}), "ACTIVE", "content_campaign.activated", "内容活动已激活"),
    "pause": (frozenset({"ACTIVE"}), "PAUSED", "content_campaign.paused", "内容活动已暂停"),
    "resume": (frozenset({"PAUSED"}), "ACTIVE", "content_campaign.resumed", "内容活动已恢复"),
    "complete": (
        frozenset({"ACTIVE", "PAUSED"}),
        "COMPLETED",
        "content_campaign.completed",
        "内容活动已完成",
    ),
    "archive": (
        frozenset({"DRAFT", "ACTIVE", "PAUSED", "COMPLETED"}),
        "ARCHIVED",
        "content_campaign.archived",
        "内容活动已归档",
    ),
}


def read_campaign_snapshot(db: DbSession) -> None:
    """在认证和查询前建立一致的 REPEATABLE READ 快照并禁用隐式刷写。"""
    db.autoflush = False
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})


def _campaign_workflow(
    status: str,
    counts: ContentCampaignCounts,
    *,
    batch_request_count: int = 0,
    intervention_count: int = 0,
    cost_entry_count: int = 0,
) -> tuple[
    ContentCampaignStatus,
    ContentCampaignPrimaryTask,
    list[ContentCampaignAction],
    DeletionProjection | None,
]:
    has_scope = counts.product_count > 0 and counts.topic_count > 0 and counts.platform_count > 0
    if status == "DRAFT":
        actions: list[ContentCampaignAction] = ["UPDATE"]
        if has_scope:
            actions.extend(["ACTIVATE", "PLAN_TASKS"])
        actions.append("ARCHIVE")
        blockers: list[DeletionBlocker] = []
        blocker_count = max(counts.task_count, batch_request_count)
        if blocker_count > 0:
            blockers.append(
                DeletionBlocker(type=DeletionBlockerType.CONTENT_TASK, count=blocker_count)
            )
        if intervention_count > 0:
            blockers.append(
                DeletionBlocker(
                    type=DeletionBlockerType.GEO_INTERVENTION, count=intervention_count
                )
            )
        if cost_entry_count > 0:
            blockers.append(
                DeletionBlocker(
                    type=DeletionBlockerType.OPERATING_COST_ENTRY, count=cost_entry_count
                )
            )
        if not blockers:
            actions.append("DELETE")
        return (
            "DRAFT",
            "ACTIVATE_CAMPAIGN" if has_scope else "CONFIGURE_CAMPAIGN",
            actions,
            DeletionProjection(blockers=blockers),
        )
    if status == "ACTIVE":
        actions = ["UPDATE"]
        if has_scope:
            actions.append("PLAN_TASKS")
        actions.extend(["PAUSE", "COMPLETE", "ARCHIVE"])
        return ("ACTIVE", "MANAGE_CAMPAIGN", actions, None)
    if status == "PAUSED":
        return ("PAUSED", "RESUME_CAMPAIGN", ["UPDATE", "RESUME", "COMPLETE", "ARCHIVE"], None)
    if status == "COMPLETED":
        return ("COMPLETED", "ARCHIVE_CAMPAIGN", ["ARCHIVE"], None)
    return ("ARCHIVED", "VIEW_HISTORY", [], None)


def _campaign_counts_by_id(
    db: Session, campaign_ids: list[uuid.UUID]
) -> dict[uuid.UUID, ContentCampaignCounts]:
    if not campaign_ids:
        return {}
    product_counts = {
        cid: int(count)
        for cid, count in db.execute(
            select(ContentCampaignProduct.campaign_id, func.count())
            .where(ContentCampaignProduct.campaign_id.in_(campaign_ids))
            .group_by(ContentCampaignProduct.campaign_id)
        ).tuples()
    }
    topic_counts = {
        cid: int(count)
        for cid, count in db.execute(
            select(ContentCampaignTopic.campaign_id, func.count())
            .where(ContentCampaignTopic.campaign_id.in_(campaign_ids))
            .group_by(ContentCampaignTopic.campaign_id)
        ).tuples()
    }
    platform_counts = {
        cid: int(count)
        for cid, count in db.execute(
            select(ContentCampaignPlatform.campaign_id, func.count())
            .where(ContentCampaignPlatform.campaign_id.in_(campaign_ids))
            .group_by(ContentCampaignPlatform.campaign_id)
        ).tuples()
    }
    plan_counts = {
        cid: int(count)
        for cid, count in db.execute(
            select(ContentCampaignMonitoringPlan.campaign_id, func.count())
            .where(ContentCampaignMonitoringPlan.campaign_id.in_(campaign_ids))
            .group_by(ContentCampaignMonitoringPlan.campaign_id)
        ).tuples()
    }
    task_counts = {
        cid: int(count)
        for cid, count in db.execute(
            select(ContentTask.campaign_id, func.count(ContentTask.id))
            .where(ContentTask.campaign_id.in_(campaign_ids))
            .group_by(ContentTask.campaign_id)
        ).tuples()
        if cid is not None
    }
    article_counts = {
        cid: int(count)
        for cid, count in db.execute(
            select(ContentTask.campaign_id, func.count(PublishedArticle.id))
            .join(PublicationWork, PublicationWork.content_task_id == ContentTask.id)
            .join(PublishedArticle, PublishedArticle.id == PublicationWork.id)
            .where(ContentTask.campaign_id.in_(campaign_ids))
            .group_by(ContentTask.campaign_id)
        ).tuples()
        if cid is not None
    }
    return {
        cid: ContentCampaignCounts(
            product_count=int(product_counts.get(cid, 0)),
            topic_count=int(topic_counts.get(cid, 0)),
            platform_count=int(platform_counts.get(cid, 0)),
            monitoring_plan_count=int(plan_counts.get(cid, 0)),
            task_count=int(task_counts.get(cid, 0)),
            published_article_count=int(article_counts.get(cid, 0)),
        )
        for cid in campaign_ids
    }


def _campaigns_list_items(
    db: Session, campaigns: list[ContentCampaign]
) -> list[ContentCampaignListItem]:
    if not campaigns:
        return []
    campaign_ids = [item.id for item in campaigns]
    counts_by_id = _campaign_counts_by_id(db, campaign_ids)
    batch_counts_by_id = {
        cid: int(count)
        for cid, count in db.execute(
            select(ContentTaskBatchRequest.campaign_id, func.count(ContentTaskBatchRequest.id))
            .where(ContentTaskBatchRequest.campaign_id.in_(campaign_ids))
            .group_by(ContentTaskBatchRequest.campaign_id)
        ).tuples()
        if cid is not None
    }
    intervention_counts_by_id = {
        cid: int(count)
        for cid, count in db.execute(
            select(GeoIntervention.campaign_id, func.count(GeoIntervention.id))
            .where(GeoIntervention.campaign_id.in_(campaign_ids))
            .group_by(GeoIntervention.campaign_id)
        ).tuples()
        if cid is not None
    }
    cost_entry_counts_by_id = {
        cid: int(count)
        for cid, count in db.execute(
            select(OperatingCostEntry.campaign_id, func.count(OperatingCostEntry.id))
            .where(OperatingCostEntry.campaign_id.in_(campaign_ids))
            .group_by(OperatingCostEntry.campaign_id)
        ).tuples()
        if cid is not None
    }
    owner_ids = {item.owner_id for item in campaigns}
    owners_by_id = {
        user.id: ContentCampaignOwner(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
        )
        for user in db.scalars(select(User).where(User.id.in_(owner_ids)))
    }
    output: list[ContentCampaignListItem] = []
    for campaign in campaigns:
        owner = owners_by_id.get(campaign.owner_id)
        if owner is None:
            raise RuntimeError(f"内容活动 {campaign.id} 的负责人 {campaign.owner_id} 不存在")
        counts = counts_by_id[campaign.id]
        stage, primary_task, actions, deletion = _campaign_workflow(
            campaign.status,
            counts,
            batch_request_count=batch_counts_by_id.get(campaign.id, 0),
            intervention_count=intervention_counts_by_id.get(campaign.id, 0),
            cost_entry_count=cost_entry_counts_by_id.get(campaign.id, 0),
        )
        output.append(
            ContentCampaignListItem.model_validate(
                {
                    "id": campaign.id,
                    "name": campaign.name,
                    "description": campaign.description,
                    "target_audience": campaign.target_audience,
                    "owner": owner,
                    "priority": campaign.priority,
                    "status": campaign.status,
                    "start_date": campaign.start_date,
                    "end_date": campaign.end_date,
                    "target_metrics": ContentCampaignTargetMetrics.model_validate(
                        campaign.target_metrics or {}
                    ),
                    "budget_amount": campaign.budget_amount,
                    "budget_currency": campaign.budget_currency,
                    "counts": counts,
                    "workflow_stage": stage,
                    "primary_task": primary_task,
                    "available_actions": actions,
                    "deletion": deletion,
                    "revision": campaign.revision,
                    "created_by": campaign.created_by,
                    "updated_by": campaign.updated_by,
                    "created_at": campaign.created_at,
                    "updated_at": campaign.updated_at,
                }
            )
        )
    return output


def _product_items(
    db: Session, products: list[Product], *, now: datetime
) -> list[ContentCampaignProductItem]:
    if not products:
        return []
    product_ids = [product.id for product in products]
    approved_ids = set(
        db.scalars(
            select(FactVersion.product_id)
            .where(
                FactVersion.product_id.in_(product_ids),
                FactVersion.status == "APPROVED",
                func.btrim(FactVersion.body_markdown) != "",
            )
            .distinct()
        )
    )
    return [
        ContentCampaignProductItem(
            id=product.id,
            brand=product.brand,
            part_number=product.part_number,
            status=product.status,
            has_approved_fact=product.id in approved_ids,
            facts_freshness=product_facts_freshness(product.next_review_at, now=now),
        )
        for product in products
    ]


def get_content_campaign_detail(
    db: Session, campaign_id: uuid.UUID, *, now: datetime | None = None
) -> ContentCampaignDetail:
    """投影单个内容活动完整配置、多对多关联与实时统计。"""
    campaign = db.get(ContentCampaign, campaign_id)
    if campaign is None:
        raise not_found("内容活动")
    summary = _campaigns_list_items(db, [campaign])[0]
    reference_now = now if now is not None else db_utc_now(db)
    products = list(
        db.scalars(
            select(Product)
            .join(ContentCampaignProduct, ContentCampaignProduct.product_id == Product.id)
            .where(ContentCampaignProduct.campaign_id == campaign.id)
            .order_by(func.lower(Product.brand), func.lower(Product.part_number), Product.id)
        )
    )
    topics = list(
        db.scalars(
            select(QueryTopic)
            .join(ContentCampaignTopic, ContentCampaignTopic.query_topic_id == QueryTopic.id)
            .where(ContentCampaignTopic.campaign_id == campaign.id)
            .order_by(func.lower(QueryTopic.canonical_question), QueryTopic.id)
        )
    )
    platforms = list(
        db.scalars(
            select(PlatformProfile)
            .join(
                ContentCampaignPlatform,
                ContentCampaignPlatform.platform_profile_id == PlatformProfile.id,
            )
            .where(ContentCampaignPlatform.campaign_id == campaign.id)
            .order_by(func.lower(PlatformProfile.name), PlatformProfile.id)
        )
    )
    plans = list(
        db.scalars(
            select(GeoMonitoringPlan)
            .join(
                ContentCampaignMonitoringPlan,
                ContentCampaignMonitoringPlan.plan_id == GeoMonitoringPlan.id,
            )
            .where(ContentCampaignMonitoringPlan.campaign_id == campaign.id)
            .order_by(func.lower(GeoMonitoringPlan.name), GeoMonitoringPlan.id)
        )
    )
    return ContentCampaignDetail.model_validate(
        {
            **summary.model_dump(),
            "products": _product_items(db, products, now=reference_now),
            "topics": [
                ContentCampaignTopicItem(
                    id=topic.id,
                    canonical_question=topic.canonical_question,
                    intent_type=topic.intent_type,
                    is_active=topic.is_active,
                    description=topic.description,
                )
                for topic in topics
            ],
            "platforms": [
                ContentCampaignPlatformItem(
                    id=profile.id,
                    name=profile.name,
                    is_active=profile.is_active,
                    configuration_complete=profile.platform_prompt_id is not None,
                )
                for profile in platforms
            ],
            "monitoring_plans": [
                ContentCampaignMonitoringPlanItem(
                    id=plan.id,
                    name=plan.name,
                    status=plan.status,
                )
                for plan in plans
            ],
        }
    )


def list_content_campaigns(
    db: Session,
    *,
    q: str | None = None,
    status: ContentCampaignStatus | None = None,
    priority: WorkPriority | None = None,
    owner_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
    query_topic_id: uuid.UUID | None = None,
    page: int = 1,
    page_size: Literal[10, 20, 50] = 20,
) -> ContentCampaignListPage:
    """分页筛选内容活动列表，使用固定批量聚合无 N+1 查询。"""
    query = select(ContentCampaign)
    if q is not None and (term := q.strip()):
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.where(
            ContentCampaign.name.ilike(pattern, escape="\\")
            | ContentCampaign.description.ilike(pattern, escape="\\")
            | ContentCampaign.target_audience.ilike(pattern, escape="\\")
        )
    if status is not None:
        query = query.where(ContentCampaign.status == status)
    if priority is not None:
        query = query.where(ContentCampaign.priority == priority)
    if owner_id is not None:
        query = query.where(ContentCampaign.owner_id == owner_id)
    if product_id is not None:
        query = query.where(
            exists(
                select(1).where(
                    ContentCampaignProduct.campaign_id == ContentCampaign.id,
                    ContentCampaignProduct.product_id == product_id,
                )
            )
        )
    if query_topic_id is not None:
        query = query.where(
            exists(
                select(1).where(
                    ContentCampaignTopic.campaign_id == ContentCampaign.id,
                    ContentCampaignTopic.query_topic_id == query_topic_id,
                )
            )
        )
    total = int(db.scalar(select(func.count()).select_from(query.subquery())) or 0)
    rows = list(
        db.scalars(
            query.order_by(ContentCampaign.updated_at.desc(), ContentCampaign.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return ContentCampaignListPage(
        items=_campaigns_list_items(db, rows),
        page=page,
        page_size=page_size,
        total=total,
    )


def get_content_campaign_options(
    db: Session, *, now: datetime | None = None
) -> ContentCampaignOptions:
    """返回创建或编辑内容活动所需的活跃范围候选。"""
    reference_now = now if now is not None else db_utc_now(db)
    owners = [
        ContentCampaignOwner(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
        )
        for user in db.scalars(
            select(User)
            .where(User.is_active.is_(True))
            .order_by(func.lower(User.display_name), User.id)
        )
    ]
    products = list(
        db.scalars(
            select(Product)
            .where(Product.status == "ACTIVE")
            .order_by(func.lower(Product.brand), func.lower(Product.part_number), Product.id)
        )
    )
    topics = [
        ContentCampaignTopicItem(
            id=topic.id,
            canonical_question=topic.canonical_question,
            intent_type=topic.intent_type,
            is_active=topic.is_active,
            description=topic.description,
        )
        for topic in db.scalars(
            select(QueryTopic)
            .where(QueryTopic.is_active.is_(True))
            .order_by(func.lower(QueryTopic.canonical_question), QueryTopic.id)
        )
    ]
    platforms = [
        ContentCampaignPlatformItem(
            id=profile.id,
            name=profile.name,
            is_active=profile.is_active,
            configuration_complete=profile.platform_prompt_id is not None,
        )
        for profile in db.scalars(
            select(PlatformProfile)
            .where(PlatformProfile.is_active.is_(True))
            .order_by(func.lower(PlatformProfile.name), PlatformProfile.id)
        )
    ]
    monitoring_plans = [
        ContentCampaignMonitoringPlanItem(
            id=plan.id,
            name=plan.name,
            status=plan.status,
        )
        for plan in db.scalars(
            select(GeoMonitoringPlan)
            .where(GeoMonitoringPlan.status != "ARCHIVED")
            .order_by(func.lower(GeoMonitoringPlan.name), GeoMonitoringPlan.id)
        )
    ]
    return ContentCampaignOptions(
        owners=owners,
        products=_product_items(db, products, now=reference_now),
        topics=topics,
        platforms=platforms,
        monitoring_plans=monitoring_plans,
    )


def _lock_campaign_references(
    db: Session,
    *,
    actor_id: uuid.UUID,
    owner_id: uuid.UUID,
    product_ids: set[uuid.UUID],
    topic_ids: set[uuid.UUID],
    platform_ids: set[uuid.UUID],
    plan_ids: set[uuid.UUID],
    existing_products: AbstractSet[uuid.UUID] = frozenset(),
    existing_topics: AbstractSet[uuid.UUID] = frozenset(),
    existing_platforms: AbstractSet[uuid.UUID] = frozenset(),
    existing_plans: AbstractSet[uuid.UUID] = frozenset(),
    existing_owner_id: uuid.UUID | None = None,
) -> None:
    """按全局无死锁顺序锁定并校验活动引用：User(sorted) -> Platform -> Product -> Topic -> Plan。"""
    user_ids = sorted({actor_id, owner_id})
    locked_users = {
        row.id: row
        for row in db.scalars(
            select(User)
            .where(User.id.in_(user_ids))
            .order_by(User.id)
            .execution_options(populate_existing=True)
            .with_for_update(key_share=True)
        )
    }
    owner = locked_users.get(owner_id)
    if owner is None:
        raise not_found("活动负责人")
    if not owner.is_active and owner_id != existing_owner_id:
        raise AppError("VALIDATION_ERROR", "活动负责人账号已停用，请选择活跃用户", 422)

    all_platforms = sorted(platform_ids | existing_platforms)
    if all_platforms:
        found_platforms = {
            row.id: row
            for row in db.scalars(
                select(PlatformProfile)
                .where(PlatformProfile.id.in_(all_platforms))
                .order_by(PlatformProfile.id)
                .execution_options(populate_existing=True)
                .with_for_update(key_share=True)
            )
        }
        missing = platform_ids - set(found_platforms)
        if missing:
            raise AppError("VALIDATION_ERROR", "所选目标平台不存在", 422)
        for pid in platform_ids - existing_platforms:
            if not found_platforms[pid].is_active:
                raise AppError("INVALID_STATE_TRANSITION", "不能将已停用的平台加入内容活动", 409)

    all_products = sorted(product_ids | existing_products)
    if all_products:
        found_products = {
            row.id: row
            for row in db.scalars(
                select(Product)
                .where(Product.id.in_(all_products))
                .order_by(Product.id)
                .execution_options(populate_existing=True)
                .with_for_update(key_share=True)
            )
        }
        missing = product_ids - set(found_products)
        if missing:
            raise AppError("VALIDATION_ERROR", "所选产品不存在", 422)
        for pid in product_ids - existing_products:
            if found_products[pid].status != "ACTIVE":
                raise AppError("INVALID_STATE_TRANSITION", "不能将已停用的产品加入内容活动", 409)

    all_topics = sorted(topic_ids | existing_topics)
    if all_topics:
        found_topics = {
            row.id: row
            for row in db.scalars(
                select(QueryTopic)
                .where(QueryTopic.id.in_(all_topics))
                .order_by(QueryTopic.id)
                .execution_options(populate_existing=True)
                .with_for_update(key_share=True)
            )
        }
        missing = topic_ids - set(found_topics)
        if missing:
            raise AppError("VALIDATION_ERROR", "所选问题主题不存在", 422)
        for tid in topic_ids - existing_topics:
            if not found_topics[tid].is_active:
                raise AppError(
                    "INVALID_STATE_TRANSITION", "不能将已停用的问题主题加入内容活动", 409
                )

    all_plans = sorted(plan_ids | existing_plans)
    if all_plans:
        found_plans = {
            row.id: row
            for row in db.scalars(
                select(GeoMonitoringPlan)
                .where(GeoMonitoringPlan.id.in_(all_plans))
                .order_by(GeoMonitoringPlan.id)
                .execution_options(populate_existing=True)
                .with_for_update(key_share=True)
            )
        }
        missing = plan_ids - set(found_plans)
        if missing:
            raise AppError("VALIDATION_ERROR", "所选 GEO 监测计划不存在", 422)
        for pid in plan_ids - existing_plans:
            if found_plans[pid].status == "ARCHIVED":
                raise AppError(
                    "INVALID_STATE_TRANSITION", "不能将已归档的监测计划加入内容活动", 409
                )


def _metrics_dict(metrics: ContentCampaignTargetMetrics) -> dict[str, Any]:
    return metrics.model_dump(mode="json", exclude_none=True)


def create_content_campaign(
    *,
    db: Session,
    payload: ContentCampaignCreate,
    actor: User,
    request_id: str,
) -> ContentCampaignDetail:
    """创建草稿态内容活动及其范围关联。"""
    owner_id = payload.owner_id or actor.id
    product_ids = set(payload.product_ids)
    topic_ids = set(payload.query_topic_ids)
    platform_ids = set(payload.platform_profile_ids)
    plan_ids = set(payload.monitoring_plan_ids)
    _lock_campaign_references(
        db,
        actor_id=actor.id,
        owner_id=owner_id,
        product_ids=product_ids,
        topic_ids=topic_ids,
        platform_ids=platform_ids,
        plan_ids=plan_ids,
    )
    now = db_utc_now(db)
    campaign = ContentCampaign(
        name=payload.name,
        description=payload.description,
        target_audience=payload.target_audience,
        owner_id=owner_id,
        priority=payload.priority,
        status="DRAFT",
        start_date=payload.start_date,
        end_date=payload.end_date,
        target_metrics=_metrics_dict(payload.target_metrics),
        budget_amount=payload.budget_amount,
        budget_currency=payload.budget_currency,
        revision=0,
        created_by=actor.id,
        updated_by=actor.id,
        created_at=now,
        updated_at=now,
    )
    db.add(campaign)
    db.flush()
    for product_id in sorted(product_ids):
        db.add(ContentCampaignProduct(campaign_id=campaign.id, product_id=product_id))
    for topic_id in sorted(topic_ids):
        db.add(ContentCampaignTopic(campaign_id=campaign.id, query_topic_id=topic_id))
    for platform_id in sorted(platform_ids):
        db.add(ContentCampaignPlatform(campaign_id=campaign.id, platform_profile_id=platform_id))
    for plan_id in sorted(plan_ids):
        db.add(ContentCampaignMonitoringPlan(campaign_id=campaign.id, plan_id=plan_id))
    db.flush()
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONTENT_PLANNING,
            action="content_campaign.created",
            target_type="ContentCampaign",
            target_id=campaign.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="内容活动已创建",
            details={
                "facts": {
                    "status": campaign.status,
                    "priority": campaign.priority,
                    "revision": campaign.revision,
                    "product_count": len(product_ids),
                    "topic_count": len(topic_ids),
                    "platform_count": len(platform_ids),
                    "monitoring_plan_count": len(plan_ids),
                }
            },
        ),
    )
    db.commit()
    return get_content_campaign_detail(db, campaign.id, now=now)


def update_content_campaign(
    *,
    db: Session,
    campaign_id: uuid.UUID,
    payload: ContentCampaignUpdate,
    actor: User,
    request_id: str,
) -> ContentCampaignDetail:
    """以 revision 乐观锁更新活动元数据与关联范围；no-op 不递增版本。"""
    current_row = db.get(ContentCampaign, campaign_id)
    if current_row is None:
        raise not_found("内容活动")
    observed_revision = current_row.revision
    observed_owner_id = current_row.owner_id
    existing_products = set(
        db.scalars(
            select(ContentCampaignProduct.product_id).where(
                ContentCampaignProduct.campaign_id == campaign_id
            )
        )
    )
    existing_topics = set(
        db.scalars(
            select(ContentCampaignTopic.query_topic_id).where(
                ContentCampaignTopic.campaign_id == campaign_id
            )
        )
    )
    existing_platforms = set(
        db.scalars(
            select(ContentCampaignPlatform.platform_profile_id).where(
                ContentCampaignPlatform.campaign_id == campaign_id
            )
        )
    )
    existing_plans = set(
        db.scalars(
            select(ContentCampaignMonitoringPlan.plan_id).where(
                ContentCampaignMonitoringPlan.campaign_id == campaign_id
            )
        )
    )
    new_products = set(payload.product_ids)
    new_topics = set(payload.query_topic_ids)
    new_platforms = set(payload.platform_profile_ids)
    new_plans = set(payload.monitoring_plan_ids)

    _lock_campaign_references(
        db,
        actor_id=actor.id,
        owner_id=payload.owner_id,
        product_ids=new_products,
        topic_ids=new_topics,
        platform_ids=new_platforms,
        plan_ids=new_plans,
        existing_products=existing_products,
        existing_topics=existing_topics,
        existing_platforms=existing_platforms,
        existing_plans=existing_plans,
        existing_owner_id=observed_owner_id,
    )
    campaign = db.scalar(
        select(ContentCampaign)
        .where(ContentCampaign.id == campaign_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    if campaign is None:
        raise not_found("内容活动")
    if (
        campaign.revision != payload.expected_revision
        or campaign.revision != observed_revision
        or campaign.owner_id != observed_owner_id
    ):
        raise AppError("REVISION_CONFLICT", "内容活动已被其他请求修改", 409)
    if campaign.status in {"COMPLETED", "ARCHIVED"}:
        raise AppError("INVALID_STATE_TRANSITION", "已完成或已归档的内容活动不能修改", 409)
    if campaign.status == "ACTIVE" and (
        not new_products or not new_topics or not new_platforms
    ):
        raise AppError(
            "CAMPAIGN_SCOPE_INCOMPLETE",
            "进行中的内容活动至少保留 1 个产品、1 个问题主题和 1 个目标平台",
            409,
        )

    locked_products = set(
        db.scalars(
            select(ContentCampaignProduct.product_id).where(
                ContentCampaignProduct.campaign_id == campaign.id
            )
        )
    )
    locked_topics = set(
        db.scalars(
            select(ContentCampaignTopic.query_topic_id).where(
                ContentCampaignTopic.campaign_id == campaign.id
            )
        )
    )
    locked_platforms = set(
        db.scalars(
            select(ContentCampaignPlatform.platform_profile_id).where(
                ContentCampaignPlatform.campaign_id == campaign.id
            )
        )
    )
    locked_plans = set(
        db.scalars(
            select(ContentCampaignMonitoringPlan.plan_id).where(
                ContentCampaignMonitoringPlan.campaign_id == campaign.id
            )
        )
    )
    # 锁后重验：防止并发事务在初读与加锁间修改过关联集合导致跳过活跃性检查
    if (
        locked_products != existing_products
        or locked_topics != existing_topics
        or locked_platforms != existing_platforms
        or locked_plans != existing_plans
    ):
        raise AppError("REVISION_CONFLICT", "内容活动关联范围已被其他请求修改", 409)

    metrics = _metrics_dict(payload.target_metrics)
    if (
        campaign.name == payload.name
        and campaign.description == payload.description
        and campaign.target_audience == payload.target_audience
        and campaign.owner_id == payload.owner_id
        and campaign.priority == payload.priority
        and campaign.start_date == payload.start_date
        and campaign.end_date == payload.end_date
        and (campaign.target_metrics or {}) == metrics
        and campaign.budget_amount == payload.budget_amount
        and campaign.budget_currency == payload.budget_currency
        and locked_products == new_products
        and locked_topics == new_topics
        and locked_platforms == new_platforms
        and locked_plans == new_plans
    ):
        return get_content_campaign_detail(db, campaign.id)

    now = db_utc_now(db)
    campaign.name = payload.name
    campaign.description = payload.description
    campaign.target_audience = payload.target_audience
    campaign.owner_id = payload.owner_id
    campaign.priority = payload.priority
    campaign.start_date = payload.start_date
    campaign.end_date = payload.end_date
    campaign.target_metrics = metrics
    campaign.budget_amount = payload.budget_amount
    campaign.budget_currency = payload.budget_currency
    campaign.revision += 1
    campaign.updated_by = actor.id
    campaign.updated_at = now

    if removed := locked_products - new_products:
        db.execute(
            delete(ContentCampaignProduct).where(
                ContentCampaignProduct.campaign_id == campaign.id,
                ContentCampaignProduct.product_id.in_(removed),
            )
        )
    for pid in sorted(new_products - locked_products):
        db.add(ContentCampaignProduct(campaign_id=campaign.id, product_id=pid))

    if removed := locked_topics - new_topics:
        db.execute(
            delete(ContentCampaignTopic).where(
                ContentCampaignTopic.campaign_id == campaign.id,
                ContentCampaignTopic.query_topic_id.in_(removed),
            )
        )
    for tid in sorted(new_topics - locked_topics):
        db.add(ContentCampaignTopic(campaign_id=campaign.id, query_topic_id=tid))

    if removed := locked_platforms - new_platforms:
        db.execute(
            delete(ContentCampaignPlatform).where(
                ContentCampaignPlatform.campaign_id == campaign.id,
                ContentCampaignPlatform.platform_profile_id.in_(removed),
            )
        )
    for pid in sorted(new_platforms - locked_platforms):
        db.add(ContentCampaignPlatform(campaign_id=campaign.id, platform_profile_id=pid))

    if removed := locked_plans - new_plans:
        db.execute(
            delete(ContentCampaignMonitoringPlan).where(
                ContentCampaignMonitoringPlan.campaign_id == campaign.id,
                ContentCampaignMonitoringPlan.plan_id.in_(removed),
            )
        )
    for pid in sorted(new_plans - locked_plans):
        db.add(ContentCampaignMonitoringPlan(campaign_id=campaign.id, plan_id=pid))

    db.flush()
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONTENT_PLANNING,
            action="content_campaign.updated",
            target_type="ContentCampaign",
            target_id=campaign.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="内容活动已更新",
            details={
                "facts": {
                    "status": campaign.status,
                    "priority": campaign.priority,
                    "revision": campaign.revision,
                    "product_count": len(new_products),
                    "topic_count": len(new_topics),
                    "platform_count": len(new_platforms),
                    "monitoring_plan_count": len(new_plans),
                }
            },
        ),
    )
    db.commit()
    return get_content_campaign_detail(db, campaign.id, now=now)


def transition_content_campaign_status(
    *,
    db: Session,
    campaign_id: uuid.UUID,
    expected_revision: int,
    operation: CampaignTransitionOperation,
    actor: User,
    request_id: str,
) -> ContentCampaignDetail:
    """执行内容活动受控状态转换。"""
    allowed_from, target_status, action, message = _TRANSITION_RULES[operation]
    db.scalar(
        select(User.id)
        .where(User.id == actor.id)
        .with_for_update(key_share=True)
    )
    campaign = db.scalar(
        select(ContentCampaign)
        .where(ContentCampaign.id == campaign_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    if campaign is None:
        raise not_found("内容活动")
    if campaign.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "内容活动已被其他请求修改", 409)
    if campaign.status not in allowed_from:
        raise AppError("INVALID_STATE_TRANSITION", "当前活动状态不允许执行该操作", 409)
    if operation in {"activate", "resume"}:
        counts = _campaign_counts_by_id(db, [campaign.id])[campaign.id]
        if counts.product_count < 1 or counts.topic_count < 1 or counts.platform_count < 1:
            raise AppError(
                "CAMPAIGN_SCOPE_INCOMPLETE",
                "激活或恢复活动前请至少关联 1 个产品、1 个问题主题和 1 个目标平台",
                409,
            )
    now = db_utc_now(db)
    campaign.status = target_status
    campaign.revision += 1
    campaign.updated_by = actor.id
    campaign.updated_at = now
    db.flush()
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONTENT_PLANNING,
            action=action,
            target_type="ContentCampaign",
            target_id=campaign.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message=message,
            details={
                "facts": {
                    "status": campaign.status,
                    "revision": campaign.revision,
                }
            },
        ),
    )
    db.commit()
    return get_content_campaign_detail(db, campaign.id, now=now)


def delete_content_campaign(
    *,
    db: Session,
    campaign_id: uuid.UUID,
    expected_revision: int,
    actor: User,
    request_id: str,
) -> None:
    """仅允许物理删除无关联任务的草稿内容活动。"""
    db.scalar(
        select(User.id)
        .where(User.id == actor.id)
        .with_for_update(key_share=True)
    )
    campaign = db.scalar(
        select(ContentCampaign)
        .where(ContentCampaign.id == campaign_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    if campaign is None:
        raise not_found("内容活动")
    if campaign.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "内容活动已被其他请求修改", 409)
    if campaign.status != "DRAFT":
        raise AppError("INVALID_STATE_TRANSITION", "仅草稿活动可以删除，其余状态请归档", 409)
    task_count = int(
        db.scalar(
            select(func.count())
            .select_from(ContentTask)
            .where(ContentTask.campaign_id == campaign.id)
        )
        or 0
    )
    batch_count = int(
        db.scalar(
            select(func.count())
            .select_from(ContentTaskBatchRequest)
            .where(ContentTaskBatchRequest.campaign_id == campaign.id)
        )
        or 0
    )
    intervention_count = int(
        db.scalar(
            select(func.count())
            .select_from(GeoIntervention)
            .where(GeoIntervention.campaign_id == campaign.id)
        )
        or 0
    )
    cost_entry_count = int(
        db.scalar(
            select(func.count())
            .select_from(OperatingCostEntry)
            .where(OperatingCostEntry.campaign_id == campaign.id)
        )
        or 0
    )
    if task_count > 0 or batch_count > 0 or intervention_count > 0 or cost_entry_count > 0:
        blockers: list[tuple[str, str, int]] = []
        if task_count > 0 or batch_count > 0:
            blockers.append(
                ("CONTENT_TASK", "内容任务或批量规划回执", max(task_count, batch_count))
            )
        if intervention_count > 0:
            blockers.append(("GEO_INTERVENTION", "GEO 干预归因记录", intervention_count))
        if cost_entry_count > 0:
            blockers.append(("OPERATING_COST_ENTRY", "运营费用台账记录", cost_entry_count))
        raise in_use("CONTENT_CAMPAIGN_IN_USE", "内容活动", blockers)
    deleted_revision = campaign.revision
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONTENT_PLANNING,
            action="content_campaign.deleted",
            target_type="ContentCampaign",
            target_id=campaign.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="内容活动已删除",
            details={"facts": {"status": campaign.status, "revision": deleted_revision}},
        ),
    )
    db.delete(campaign)
    db.commit()


def campaign_scope_map(
    db: Session, campaign_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[list[uuid.UUID], list[uuid.UUID], list[uuid.UUID]]]:
    """批量加载活动关联的产品、主题与平台 ID 集合，供任务创建选项与批量规划复用。"""
    if not campaign_ids:
        return {}
    products: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    topics: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    platforms: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for cid, pid in db.execute(
        select(ContentCampaignProduct.campaign_id, ContentCampaignProduct.product_id)
        .where(ContentCampaignProduct.campaign_id.in_(campaign_ids))
        .order_by(ContentCampaignProduct.product_id)
    ).tuples():
        products[cid].append(pid)
    for cid, tid in db.execute(
        select(ContentCampaignTopic.campaign_id, ContentCampaignTopic.query_topic_id)
        .where(ContentCampaignTopic.campaign_id.in_(campaign_ids))
        .order_by(ContentCampaignTopic.query_topic_id)
    ).tuples():
        topics[cid].append(tid)
    for cid, pid in db.execute(
        select(ContentCampaignPlatform.campaign_id, ContentCampaignPlatform.platform_profile_id)
        .where(ContentCampaignPlatform.campaign_id.in_(campaign_ids))
        .order_by(ContentCampaignPlatform.platform_profile_id)
    ).tuples():
        platforms[cid].append(pid)
    return {cid: (products[cid], topics[cid], platforms[cid]) for cid in campaign_ids}
