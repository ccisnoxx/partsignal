"""机会CSV固定低敏列；资格/筛选/排序/状态投影均由机会读模型拥有。"""

from collections.abc import Generator
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.identity import User
from app.schemas.geo_opportunity_workbench import GeoOpportunityFilters
from app.services.geo_opportunity_queries import iter_opportunities

COLUMNS = (
    "as_of",
    "opportunity_id",
    "revision",
    "title",
    "rule_code",
    "priority",
    "status",
    "workflow_stage",
    "subject_id",
    "subject_name",
    "product_id",
    "query_topic_id",
    "query_topic_name",
    "prompt_variant_id",
    "collection_profile_id",
    "collection_profile_name",
    "engine_surface_id",
    "engine_surface_name",
    "source_date_from",
    "source_date_to",
    "created_at",
    "last_seen_at",
    "acknowledged_at",
    "resolved_at",
    "source_count",
    "action_count",
)


def iter_rows(
    db: Session, filters: GeoOpportunityFilters, actor: User, as_of: datetime, *, batch_size: int
) -> Generator[dict[str, object], None, None]:
    for item in iter_opportunities(db, filters, actor=actor, batch_size=batch_size):
        yield {
            "as_of": as_of,
            "opportunity_id": item.id,
            **{
                name: getattr(item, name)
                for name in (
                    "revision",
                    "title",
                    "rule_code",
                    "priority",
                    "status",
                    "workflow_stage",
                    "subject_name",
                    "product_id",
                    "query_topic_name",
                    "collection_profile_name",
                    "engine_surface_name",
                    "source_date_from",
                    "source_date_to",
                    "created_at",
                    "last_seen_at",
                    "acknowledged_at",
                    "resolved_at",
                    "source_count",
                    "action_count",
                )
            },
            **{
                name: getattr(item.scope, name)
                for name in (
                    "subject_id",
                    "query_topic_id",
                    "prompt_variant_id",
                    "collection_profile_id",
                    "engine_surface_id",
                )
            },
        }
