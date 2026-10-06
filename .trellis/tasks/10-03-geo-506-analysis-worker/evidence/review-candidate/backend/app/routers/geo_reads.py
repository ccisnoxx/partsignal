"""只读HTTP入口；一致快照依赖先于身份读取，事务与组装属于应用服务。"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.deps import DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.geo_read_filters import GeoBatchFilters, GeoGlobalRunFilters, GeoRunFilters
from app.schemas.geo_read_models import (
    GeoBatchDetail,
    GeoBatchListPage,
    GeoRunDetail,
    GeoRunListPage,
)
from app.services import geo_read_queries as service
from app.services.geo_plan_queries import read_snapshot

router = APIRouter(prefix="/api/v1/geo", tags=["geo-reads"], dependencies=[Depends(read_snapshot)])


@router.get(
    "/observation-batches",
    response_model=GeoBatchListPage,
    operation_id="listGeoObservationBatches",
    responses=error_responses(401, 403, 404, 409, 422),
)
def list_batches(
    db: DbSession, user: EngineerUser, filters: Annotated[GeoBatchFilters, Query()]
) -> GeoBatchListPage:
    return service.list_batches(db, filters=filters, actor=user)


@router.get(
    "/observation-batches/{batch_id}",
    response_model=GeoBatchDetail,
    operation_id="getGeoObservationBatch",
    responses=error_responses(401, 403, 404, 409, 422),
)
def get_batch(batch_id: UUID, db: DbSession, user: EngineerUser) -> GeoBatchDetail:
    return service.get_batch(db, batch_id=batch_id, actor=user)


@router.get(
    "/observation-batches/{batch_id}/runs",
    response_model=GeoRunListPage,
    operation_id="listGeoObservationBatchRuns",
    responses=error_responses(401, 403, 404, 409, 422),
)
def list_batch_runs(
    batch_id: UUID, db: DbSession, user: EngineerUser, filters: Annotated[GeoRunFilters, Query()]
) -> GeoRunListPage:
    return service.list_runs(db, filters=filters, actor=user, batch_id=batch_id)


@router.get(
    "/observation-runs",
    response_model=GeoRunListPage,
    operation_id="listGeoObservationRuns",
    responses=error_responses(401, 403, 404, 409, 422),
)
def list_runs(
    db: DbSession, user: EngineerUser, filters: Annotated[GeoGlobalRunFilters, Query()]
) -> GeoRunListPage:
    return service.list_runs(db, filters=filters, actor=user)


@router.get(
    "/observation-runs/{run_id}",
    response_model=GeoRunDetail,
    operation_id="getGeoObservationRun",
    responses=error_responses(401, 403, 404, 409, 422, 503),
)
def get_run(run_id: UUID, response: Response, db: DbSession, user: EngineerUser) -> GeoRunDetail:
    response.headers["Cache-Control"] = "no-store"
    return service.get_run(db, run_id=run_id, actor=user)
