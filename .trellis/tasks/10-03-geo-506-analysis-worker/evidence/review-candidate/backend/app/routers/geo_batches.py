"""批次创建 HTTP 边界；事务、锁和写入均属于应用服务。"""

from typing import Annotated

from fastapi import APIRouter, Header, Request

from app.deps import CsrfProtected, DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.geo_batch_creation import GeoBatchCreated, GeoObservationBatchCreate
from app.services.geo_batches import create_manual_batch

router = APIRouter(prefix="/api/v1/geo/observation-batches", tags=["geo-batches"])


@router.post(
    "",
    status_code=201,
    response_model=GeoBatchCreated,
    operation_id="createGeoObservationBatch",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_batch(
    payload: GeoObservationBatchCreate,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=1, max_length=160, pattern=r"^[\x21-\x7E]+$"),
    ],
) -> GeoBatchCreated:
    return create_manual_batch(
        db=db,
        payload=payload,
        idempotency_key=idempotency_key,
        actor=user,
        request_id=request.state.request_id,
    )
