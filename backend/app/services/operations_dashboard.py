"""Slice 4C：Campaign 归因看板与全局经营指标（含内容衰退预警）查询服务。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import not_found
from app.models.campaign import (
    ContentCampaign,
    ContentCampaignMonitoringPlan,
    ContentCampaignProduct,
)
from app.models.geo_opportunities import GeoOpportunity
from app.models.product_facts import Product
from app.models.publication import (
    PublicationWork,
    PublishedArticle,
    PublishedArticleHealthCheck,
)
from app.schemas.operations_dashboard import (
    CampaignAttributionDashboardOut,
    ContentDecayAlertItem,
    OperationsMetricsOut,
)
from app.services.operations_content_metrics import (
    compute_production_metrics,
    compute_publishing_health,
)
from app.services.operations_cost_metrics import compute_unified_costs
from app.services.operations_geo_cost_metrics import compute_geo_attribution

_MAX_ALERTS_PER_KIND = 15


def get_campaign_attribution_dashboard(
    db: Session,
    campaign_id: uuid.UUID,
    *,
    window_days: int = 30,
) -> CampaignAttributionDashboardOut:
    """在 REPEATABLE READ 快照内计算单个内容活动的实时归因与多币种成本看板。"""
    campaign = db.get(ContentCampaign, campaign_id)
    if campaign is None:
        raise not_found("内容活动")

    now = datetime.now(UTC)
    since = now - timedelta(days=window_days)

    product_ids = list(
        db.scalars(
            select(ContentCampaignProduct.product_id).where(
                ContentCampaignProduct.campaign_id == campaign.id
            )
        )
    )
    plan_ids = list(
        db.scalars(
            select(ContentCampaignMonitoringPlan.plan_id).where(
                ContentCampaignMonitoringPlan.campaign_id == campaign.id
            )
        )
    )
    production = compute_production_metrics(
        db,
        campaign_id=campaign.id,
        product_ids=product_ids,
        since=since,
        now=now,
    )
    publishing_health = compute_publishing_health(db, campaign_id=campaign.id)
    geo_attribution, geo_costs = compute_geo_attribution(
        db,
        plan_ids=plan_ids,
        campaign_id=campaign.id,
        product_ids=product_ids,
        since=since,
        now=now,
    )
    cost_coverage, costs_by_currency, unit_economics = compute_unified_costs(
        db,
        campaign_id=campaign.id,
        geo_run_costs=geo_costs,
        since=since,
        now=now,
        approved_count=production.approved_task_count,
        published_count=production.published_article_count,
        resolved_opportunities=geo_attribution.resolved_opportunity_count,
    )

    return CampaignAttributionDashboardOut(
        campaign_id=campaign.id,
        campaign_name=campaign.name,
        campaign_status=campaign.status,
        causal_claim="NOT_ESTABLISHED",
        window_days=window_days,
        generated_at=now,
        production=production,
        publishing_health=publishing_health,
        geo_attribution=geo_attribution,
        cost_coverage=cost_coverage,
        costs_by_currency=costs_by_currency,
        unit_economics_by_currency=unit_economics,
    )


def _collect_decay_alerts(db: Session, *, now: datetime) -> list[ContentDecayAlertItem]:
    alerts: list[ContentDecayAlertItem] = []

    # 1. 产品事实逾期复核预警
    overdue_products = list(
        db.scalars(
            select(Product)
            .where(
                Product.status == "ACTIVE",
                Product.next_review_at.is_not(None),
                Product.next_review_at <= now,
            )
            .order_by(Product.next_review_at.asc(), Product.id.asc())
            .limit(_MAX_ALERTS_PER_KIND)
        )
    )
    for product in overdue_products:
        due_text = (
            product.next_review_at.date().isoformat()
            if product.next_review_at is not None
            else ""
        )
        alerts.append(
            ContentDecayAlertItem(
                kind="OVERDUE_FACT",
                severity="HIGH",
                target_type="Product",
                target_id=product.id,
                title=f"{product.brand} {product.part_number} 事实复核已逾期",
                detail=f"原定复核时间 {due_text} 已超期，请确认外部技术资料是否更新。",
                navigation_path=f"/products/{product.id}/facts",
            )
        )

    # 2. 已发布公开页面健康异常预警（取每篇文章最新一条检查记录）
    latest_subq = (
        select(
            PublishedArticleHealthCheck.published_article_id,
            PublishedArticleHealthCheck.status,
            PublishedArticleHealthCheck.checked_at,
            PublishedArticleHealthCheck.http_status,
            PublishedArticleHealthCheck.anomaly_reasons,
        )
        .distinct(PublishedArticleHealthCheck.published_article_id)
        .order_by(
            PublishedArticleHealthCheck.published_article_id,
            PublishedArticleHealthCheck.checked_at.desc(),
            PublishedArticleHealthCheck.id.desc(),
        )
        .subquery()
    )
    unhealthy_rows = db.execute(
        select(
            PublishedArticle.id,
            PublicationWork.actual_title,
            PublicationWork.platform_profile_name_snapshot,
            latest_subq.c.status,
            latest_subq.c.http_status,
            latest_subq.c.anomaly_reasons,
        )
        .join(PublicationWork, PublicationWork.id == PublishedArticle.id)
        .join(latest_subq, latest_subq.c.published_article_id == PublishedArticle.id)
        .where(latest_subq.c.status.in_(("CONFIRMED_ANOMALY", "FETCH_BLOCKED")))
        .order_by(latest_subq.c.checked_at.desc(), PublishedArticle.id.asc())
        .limit(_MAX_ALERTS_PER_KIND)
    ).all()
    for art_id, title, platform_name, status, http_status, reasons in unhealthy_rows:
        reason_list = [str(r) for r in (reasons or [])][:3]
        detail_parts = [f"平台：{platform_name}", f"状态：{status}"]
        if http_status is not None:
            detail_parts.append(f"HTTP {http_status}")
        if reason_list:
            detail_parts.append(f"原因：{', '.join(reason_list)}")
        alerts.append(
            ContentDecayAlertItem(
                kind="UNHEALTHY_PAGE",
                severity="HIGH" if status == "CONFIRMED_ANOMALY" else "MEDIUM",
                target_type="PublishedArticle",
                target_id=art_id,
                title=f"公开页面健康异常：{title or str(art_id)[:8]}",
                detail=" · ".join(detail_parts),
                navigation_path=f"/publishing/articles/{art_id}",
            )
        )

    # 3. 开放中（含 IN_PROGRESS）的 GEO 可见度下滑 / 自有引用丢失机会
    decay_opps = list(
        db.scalars(
            select(GeoOpportunity)
            .where(
                GeoOpportunity.status.in_(("OPEN", "ACKNOWLEDGED", "IN_PROGRESS")),
                GeoOpportunity.rule_code.in_(("VISIBILITY_DROP", "OWN_CITATION_LOST")),
            )
            .order_by(GeoOpportunity.last_seen_at.desc(), GeoOpportunity.id.asc())
            .limit(_MAX_ALERTS_PER_KIND)
        )
    )
    for opp in decay_opps:
        is_citation = opp.rule_code == "OWN_CITATION_LOST"
        alerts.append(
            ContentDecayAlertItem(
                kind="GEO_CITATION_LOST" if is_citation else "GEO_VISIBILITY_DROP",
                severity="HIGH" if opp.priority in {"HIGH", "CRITICAL"} else "MEDIUM",
                target_type="GeoOpportunity",
                target_id=opp.id,
                title=(
                    "自有域名引用丢失预警"
                    if is_citation
                    else "GEO 可见度下滑预警"
                ),
                detail=f"规则 {opp.rule_code} · 优先级 {opp.priority} · 状态 {opp.status}",
                navigation_path=f"/geo/opportunities?opportunity_id={opp.id}",
            )
        )
    return alerts


def get_workbench_operations_metrics(
    db: Session,
    *,
    window_days: int = 30,
) -> OperationsMetricsOut:
    """在 REPEATABLE READ 快照内计算全局内容运营经营指标与内容衰退预警。"""
    now = datetime.now(UTC)
    since = now - timedelta(days=window_days)

    active_campaigns = int(
        db.scalar(
            select(func.count())
            .select_from(ContentCampaign)
            .where(ContentCampaign.status == "ACTIVE")
        )
        or 0
    )
    production = compute_production_metrics(
        db,
        campaign_id=None,
        product_ids=None,
        since=since,
        now=now,
    )
    publishing_health = compute_publishing_health(db, campaign_id=None)
    geo_attribution, geo_costs = compute_geo_attribution(
        db,
        plan_ids=None,
        campaign_id=None,
        product_ids=None,
        since=since,
        now=now,
    )
    cost_coverage, costs_by_currency, unit_economics = compute_unified_costs(
        db,
        campaign_id=None,
        geo_run_costs=geo_costs,
        since=since,
        now=now,
        approved_count=production.approved_task_count,
        published_count=production.published_article_count,
        resolved_opportunities=geo_attribution.resolved_opportunity_count,
    )
    decay_alerts = _collect_decay_alerts(db, now=now)

    return OperationsMetricsOut(
        causal_claim="NOT_ESTABLISHED",
        window_days=window_days,
        generated_at=now,
        active_campaign_count=active_campaigns,
        production=production,
        publishing_health=publishing_health,
        geo_attribution=geo_attribution,
        cost_coverage=cost_coverage,
        costs_by_currency=costs_by_currency,
        unit_economics_by_currency=unit_economics,
        decay_alerts=decay_alerts,
    )
