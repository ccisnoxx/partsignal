"""显式重试 HTTP 边界；事务、锁和 ORM 写入属于 Application Service。"""

from uuid import UUID

from fastapi import APIRouter, Request

from app.deps import CsrfProtected, DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.geo_run_retry import GeoRunRetryCreated, GeoRunRetryRequest
from app.services.geo_run_retries import retry_collection_run

router = APIRouter(prefix="/api/v1/geo/observation-runs", tags=["geo-run-commands"])


@router.post(
    "/{run_id}/retry",
    status_code=201,
    response_model=GeoRunRetryCreated,
    operation_id="retryGeoObservationRun",
    responses=error_responses(401, 403, 404, 409, 422),
)
def retry_run(
    run_id: UUID,
    payload: GeoRunRetryRequest,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoRunRetryCreated:
    return retry_collection_run(
        db, run_id=run_id, payload=payload, actor=user, request_id=request.state.request_id
    )
