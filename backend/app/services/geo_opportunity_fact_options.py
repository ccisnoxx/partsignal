"""事实修订的合法产品选项；读取不取得领域写锁、不创建草稿或行动。"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import not_found
from app.models.geo_opportunities import GeoOpportunity
from app.models.identity import User
from app.models.product_facts import Product
from app.schemas.geo_opportunities import GeoOpportunityActionType, GeoOpportunityStatus
from app.schemas.geo_opportunity_actions import (
    GeoOpportunityFactRevisionOptions,
    GeoOpportunityFactRevisionProduct,
)
from app.schemas.geo_rules import GeoRuleCode
from app.services.geo_opportunity_policy import action_types
from app.services.geo_opportunity_product_scope import saved_own_product_ids
from app.services.geo_opportunity_queries import _as_of


def get_fact_revision_options(
    db: Session, opportunity_id: UUID, *, actor: User
) -> GeoOpportunityFactRevisionOptions:
    as_of = _as_of(db)
    opportunity = db.scalar(
        select(GeoOpportunity)
        .where(GeoOpportunity.id == opportunity_id)
        .execution_options(populate_existing=True)
    )
    if opportunity is None:
        raise not_found("GEO机会")
    offered = GeoOpportunityActionType.FACT_REVISION in action_types(
        GeoOpportunityStatus(opportunity.status), GeoRuleCode(opportunity.rule_code), actor
    )
    products = []
    if offered:
        products = [
            GeoOpportunityFactRevisionProduct(
                product_id=row.id, brand=row.brand, part_number=row.part_number
            )
            for row in db.execute(
                select(Product.id, Product.brand, Product.part_number)
                .where(
                    Product.id.in_(saved_own_product_ids(db, opportunity)),
                    Product.status == "ACTIVE",
                )
                .order_by(Product.brand, Product.part_number, Product.id)
            )
        ]
    return GeoOpportunityFactRevisionOptions(
        opportunity_id=opportunity.id,
        opportunity_revision=opportunity.revision,
        available_action_types=["FACT_REVISION"] if offered else [],
        products=products,
        as_of=as_of,
    )
