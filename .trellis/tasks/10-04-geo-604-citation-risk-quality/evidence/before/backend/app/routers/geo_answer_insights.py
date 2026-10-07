"""回答级洞察只读HTTP边界；保留旧文章关系级洞察。"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.deps import DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.geo_answer_insights import (
    GeoAnswerInsightFilters,
    GeoAnswerInsightRunPage,
    GeoAnswerInsights,
    GeoAnswerInsightSampleFilters,
)
from app.services import geo_answer_insights as service
from app.services.geo_plan_queries import read_snapshot

router = APIRouter(
    prefix="/api/v1/geo/insights",
    tags=["geo-answer-insights"],
    dependencies=[Depends(read_snapshot)],
)


@router.get(
    "",
    response_model=GeoAnswerInsights,
    operation_id="getGeoAnswerInsights",
    responses=error_responses(401, 403, 409, 422),
)
def insights(
    db: DbSession,
    user: EngineerUser,
    response: Response,
    filters: Annotated[GeoAnswerInsightFilters, Query()],
) -> GeoAnswerInsights:
    response.headers["Cache-Control"] = "no-store"
    return service.get_insights(db, filters)


@router.get(
    "/runs",
    response_model=GeoAnswerInsightRunPage,
    operation_id="listGeoAnswerInsightRuns",
    responses=error_responses(401, 403, 404, 409, 422),
)
def samples(
    db: DbSession,
    user: EngineerUser,
    response: Response,
    filters: Annotated[GeoAnswerInsightSampleFilters, Query()],
) -> GeoAnswerInsightRunPage:
    response.headers["Cache-Control"] = "no-store"
    return service.list_insight_runs(db, filters)
