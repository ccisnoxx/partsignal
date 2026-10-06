"""Overview GET及组成样本；事务和聚合属于应用读服务。"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.deps import DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.geo_insights import (
    GeoOverview,
    GeoOverviewFilters,
    GeoOverviewRunPage,
    GeoOverviewSampleFilters,
)
from app.services import geo_overview as service
from app.services.geo_plan_queries import read_snapshot

router = APIRouter(
    prefix="/api/v1/geo/overview", tags=["geo-overview"], dependencies=[Depends(read_snapshot)]
)


@router.get(
    "",
    response_model=GeoOverview,
    operation_id="getGeoOverview",
    responses=error_responses(401, 403, 409, 422),
)
def overview(
    db: DbSession,
    user: EngineerUser,
    response: Response,
    filters: Annotated[GeoOverviewFilters, Query()],
) -> GeoOverview:
    response.headers["Cache-Control"] = "no-store"
    return service.get_overview(db, filters)


@router.get(
    "/runs",
    response_model=GeoOverviewRunPage,
    operation_id="listGeoOverviewRuns",
    responses=error_responses(401, 403, 404, 409, 422),
)
def samples(
    db: DbSession,
    user: EngineerUser,
    response: Response,
    filters: Annotated[GeoOverviewSampleFilters, Query()],
) -> GeoOverviewRunPage:
    response.headers["Cache-Control"] = "no-store"
    return service.list_overview_runs(db, filters)
