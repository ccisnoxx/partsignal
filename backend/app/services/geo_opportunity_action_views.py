"""行动的批量只读导航；目标消失仍保留不可变ID及来源。"""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.content import ContentTask
from app.models.geo_opportunities import GeoOpportunityAction
from app.models.product_facts import Product
from app.models.publication import PublishedContentIssue
from app.schemas.geo_opportunity_workbench import GeoOpportunityActionRecord


def action_records(
    db: Session, actions: Sequence[GeoOpportunityAction]
) -> list[GeoOpportunityActionRecord]:
    type TargetModel = type[Product] | type[ContentTask] | type[PublishedContentIssue]
    targets: dict[str, tuple[TargetModel, str]] = {
        "Product": (Product, "/products/{id}/facts"),
        "ContentTask": (ContentTask, "/content/tasks/{id}"),
        "PublishedContentIssue": (PublishedContentIssue, "/publishing/issues/{id}"),
    }
    available = {}
    for kind, (model, _path) in targets.items():
        ids = {
            a.target_id for a in actions if a.source_snapshot is not None and a.target_type == kind
        }
        available[kind] = (
            set(db.scalars(select(model.id).where(model.id.in_(ids)))) if ids else set()
        )
    result = []
    for action in actions:
        value = GeoOpportunityActionRecord.model_validate(action)
        if action.source_snapshot is not None:
            found = action.target_id in available[action.target_type]
            value.target_available = found
            value.navigation_path = (
                targets[action.target_type][1].format(id=action.target_id)
                + f"?source_opportunity_id={action.opportunity_id}"
                if found
                else None
            )
        result.append(value)
    return result
