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
from app.schemas.geo_insight_details import (
    GeoInsightCitationFilters,
    GeoInsightCitationPage,
    GeoInsightClaimFilters,
    GeoInsightClaimPage,
    GeoInsightQualityFilters,
    GeoInsightQualityPage,
)
from app.services import geo_answer_insights as service
from app.services import geo_insight_details, geo_insight_quality
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


@router.get(
    "/citations",
    response_model=GeoInsightCitationPage,
    operation_id="listGeoInsightCitations",
    responses=error_responses(401, 403, 404, 409, 422),
)
def citations(
    db: DbSession,
    user: EngineerUser,
    response: Response,
    filters: Annotated[GeoInsightCitationFilters, Query()],
) -> GeoInsightCitationPage:
    response.headers["Cache-Control"] = "no-store"
    return geo_insight_details.list_citations(db, filters)


@router.get(
    "/claims",
    response_model=GeoInsightClaimPage,
    operation_id="listGeoInsightClaims",
    responses=error_responses(401, 403, 404, 409, 422),
)
def claims(
    db: DbSession,
    user: EngineerUser,
    response: Response,
    filters: Annotated[GeoInsightClaimFilters, Query()],
) -> GeoInsightClaimPage:
    response.headers["Cache-Control"] = "no-store"
    return geo_insight_details.list_claims(db, filters)


@router.get(
    "/quality/runs",
    response_model=GeoInsightQualityPage,
    operation_id="listGeoInsightQualityRuns",
    responses=error_responses(401, 403, 409, 422),
)
def quality_runs(
    db: DbSession,
    user: EngineerUser,
    response: Response,
    filters: Annotated[GeoInsightQualityFilters, Query()],
) -> GeoInsightQualityPage:
    response.headers["Cache-Control"] = "no-store"
    return geo_insight_quality.list_quality_runs(db, filters)
