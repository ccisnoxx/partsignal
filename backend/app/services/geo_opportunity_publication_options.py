"""机会发布修复候选：保存范围由GEO拥有，发布资格与修复上下文由原领域拥有。"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.models.geo_opportunities import GeoOpportunity
from app.models.identity import User
from app.schemas.geo_opportunities import GeoOpportunityActionType, GeoOpportunityStatus
from app.schemas.geo_opportunity_actions import (
    GeoOpportunityPublicationRepairCandidate,
    GeoOpportunityPublicationRepairOptions,
)
from app.schemas.geo_opportunity_actions import (
    GeoOpportunityPublicationRepairMode as Mode,
)
from app.schemas.geo_rules import GeoRuleCode
from app.services import publication_queries
from app.services.geo_opportunity_policy import action_types
from app.services.geo_opportunity_product_scope import saved_own_product_ids
from app.services.geo_opportunity_queries import _as_of


def get_publication_repair_options(
    db: Session,
    opportunity_id: UUID,
    *,
    actor: User,
    mode: Mode,
    page: int,
    page_size: int,
    selected_issue_id: UUID | None,
) -> GeoOpportunityPublicationRepairOptions:
    as_of = _as_of(db)
    if selected_issue_id is not None and mode != Mode.CREATE_REPAIR:
        raise AppError("VALIDATION_ERROR", "只有创建修复任务才读取所选问题的修复上下文", 422)
    opportunity = db.scalar(
        select(GeoOpportunity)
        .where(GeoOpportunity.id == opportunity_id)
        .execution_options(populate_existing=True)
    )
    if opportunity is None:
        raise not_found("GEO机会")
    offered = GeoOpportunityActionType.PUBLICATION_REPAIR in action_types(
        GeoOpportunityStatus(opportunity.status), GeoRuleCode(opportunity.rule_code), actor
    )
    candidates: list[GeoOpportunityPublicationRepairCandidate] = []
    total = 0
    repair_context = None
    if offered:
        product_ids = saved_own_product_ids(db, opportunity)
        if mode == Mode.OPEN_ISSUE:
            articles = publication_queries.list_published_articles(
                db, page=page, page_size=page_size, product_ids=product_ids
            )
            total = articles.total
            candidates = [
                GeoOpportunityPublicationRepairCandidate(
                    published_article_id=item.id,
                    published_content_issue_id=None,
                    issue_revision=None,
                    actual_title=item.actual_title,
                    platform_profile_name=item.platform_profile_name,
                    final_url=item.final_url,
                    available="OPEN_ISSUE" in item.available_actions,
                    unavailable_reason=None
                    if "OPEN_ISSUE" in item.available_actions
                    else "发布成果已有开放问题或已退役",
                )
                for item in articles.items
            ]
        else:
            issues = publication_queries.list_published_content_issues(
                db, page=page, page_size=page_size, status_filter="OPEN", product_ids=product_ids
            )
            total = issues.total
            candidates = [
                GeoOpportunityPublicationRepairCandidate(
                    published_article_id=item.published_article_id,
                    published_content_issue_id=item.id,
                    issue_revision=item.revision,
                    actual_title=item.actual_title,
                    platform_profile_name=item.platform_profile_name,
                    final_url=item.final_url,
                    available=mode == Mode.LINK_ISSUE
                    or "CREATE_REPAIR_TASK" in item.available_actions,
                    unavailable_reason="该问题已有修复任务"
                    if mode == Mode.CREATE_REPAIR
                    and "CREATE_REPAIR_TASK" not in item.available_actions
                    else None,
                )
                for item in issues.items
            ]
        if selected_issue_id is not None:
            repair_context = publication_queries.get_published_content_repair_context(
                db, selected_issue_id, can_delete=False
            )
            if repair_context.original_task.product_id not in product_ids:
                raise AppError("VALIDATION_ERROR", "所选问题不属于机会保存的自有产品来源", 422)
    return GeoOpportunityPublicationRepairOptions(
        opportunity_id=opportunity.id,
        opportunity_revision=opportunity.revision,
        available_action_types=["PUBLICATION_REPAIR"] if offered else [],
        mode=mode,
        candidates=candidates,
        page=page,
        page_size=page_size,
        total=total,
        repair_context=repair_context,
        as_of=as_of,
    )
