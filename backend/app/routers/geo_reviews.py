"""复核 HTTP 边界；事务与 ORM 写入只属于应用服务。"""

from uuid import UUID

from fastapi import APIRouter, Request

from app.deps import CsrfProtected, DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.geo_reviews import GeoRunReviewCreated, GeoRunReviewRequest
from app.services.geo_reviews import review_run

router = APIRouter(prefix="/api/v1/geo/observation-runs", tags=["geo-run-reviews"])


@router.post(
    "/{run_id}/review",
    status_code=201,
    response_model=GeoRunReviewCreated,
    operation_id="reviewGeoObservationRun",
    responses=error_responses(401, 403, 404, 409, 422),
)
def review_run_http(
    run_id: UUID,
    payload: GeoRunReviewRequest,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoRunReviewCreated:
    return review_run(
        db, run_id=run_id, payload=payload, actor=user, request_id=request.state.request_id
    )
