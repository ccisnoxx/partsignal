"""总览和报告共用的机会汇总；只读现存机会，不重新评估规则。"""

from collections import Counter
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.geo_opportunities import GeoOpportunity
from app.schemas.geo_insights import (
    GeoOpportunityPrioritySummary,
    GeoOpportunityStatusSummary,
    GeoOpportunitySummary,
    GeoOpportunitySummaryDrilldown,
    GeoOverviewFilters,
)
from app.schemas.geo_opportunities import GeoOpportunityPriority, GeoOpportunityStatus
from app.schemas.geo_opportunity_workbench import GeoOpportunityFilters
from app.services.geo_opportunity_policy import OPEN_STATUSES
from app.services.geo_opportunity_queries import opportunity_query


def get_opportunity_summary(
    db: Session, scope: GeoOverviewFilters, *, as_of: datetime
) -> GeoOpportunitySummary:
    """调用方持有已建立的 RR 快照，复用同一个统计时点。"""
    filters = GeoOpportunityFilters.model_validate(
        {
            "source_scope": scope.model_dump_json(),
            "open_only": True,
        }
    )
    candidates = (
        opportunity_query(filters)
        .with_only_columns(GeoOpportunity.id, GeoOpportunity.status, GeoOpportunity.priority)
        .subquery()
    )
    statuses: Counter[str] = Counter()
    priorities: Counter[str] = Counter()
    for status, priority, count in db.execute(
        select(candidates.c.status, candidates.c.priority, func.count()).group_by(
            candidates.c.status, candidates.c.priority
        )
    ):
        statuses[status] += count
        priorities[priority] += count

    def drilldown(
        *,
        status: GeoOpportunityStatus | None = None,
        priority: GeoOpportunityPriority | None = None,
    ) -> GeoOpportunitySummaryDrilldown:
        return GeoOpportunitySummaryDrilldown(
            source_scope=scope,
            open_only=True,
            status=status,
            priority=priority,
        )

    return GeoOpportunitySummary(
        as_of=as_of,
        open_count=sum(statuses.values()),
        drilldown=drilldown(),
        by_status=[
            GeoOpportunityStatusSummary.model_validate(
                {
                    "status": status,
                    "count": statuses[status],
                    "drilldown": drilldown(status=status),
                }
            )
            for status in OPEN_STATUSES
        ],
        by_priority=[
            GeoOpportunityPrioritySummary(
                priority=priority,
                count=priorities[priority],
                drilldown=drilldown(priority=priority),
            )
            for priority in reversed(GeoOpportunityPriority)
        ],
    )
