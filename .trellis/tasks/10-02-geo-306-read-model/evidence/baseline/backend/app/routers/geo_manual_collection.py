"""人工录入 HTTP 边界；不拥有事务、行锁或持久化写入。"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request

from app.deps import CsrfProtected, DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.geo_manual_collection import (
    GeoManualDraftOut,
    GeoManualDraftSave,
    GeoManualEntryContext,
    GeoManualObservationSubmit,
    GeoManualObservationSubmitted,
)
from app.services import geo_manual_collection as service
from app.services.geo_plan_queries import read_snapshot

router = APIRouter(prefix="/api/v1/geo/observation-runs", tags=["geo-manual-collection"])


@router.get(
    "/{run_id}/manual-entry",
    response_model=GeoManualEntryContext,
    operation_id="getGeoManualEntryContext",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 404, 409, 422),
)
def manual_entry(run_id: UUID, db: DbSession, user: EngineerUser) -> GeoManualEntryContext:
    return service.manual_entry_context(db, run_id=run_id, actor=user)


@router.put(
    "/{run_id}/manual-draft",
    response_model=GeoManualDraftOut,
    operation_id="saveGeoManualDraft",
    responses=error_responses(401, 403, 404, 409, 422, 503),
)
def save_manual_draft(
    run_id: UUID,
    payload: GeoManualDraftSave,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoManualDraftOut:
    return service.save_manual_draft(
        db, run_id=run_id, payload=payload, actor=user, request_id=request.state.request_id
    )


@router.post(
    "/{run_id}/manual-submit",
    status_code=201,
    response_model=GeoManualObservationSubmitted,
    operation_id="submitGeoManualObservation",
    responses=error_responses(401, 403, 404, 409, 422, 503),
)
def submit_manual_observation(
    run_id: UUID,
    payload: GeoManualObservationSubmit,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=1, max_length=160, pattern=r"^[\x21-\x7E]+$"),
    ],
) -> GeoManualObservationSubmitted:
    return service.submit_manual_observation(
        db,
        run_id=run_id,
        payload=payload,
        actor=user,
        idempotency_key=idempotency_key,
        request_id=request.state.request_id,
    )
