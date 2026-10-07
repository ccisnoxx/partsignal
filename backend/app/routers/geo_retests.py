"""复测HTTP入口；事务、锁、CAS与复制完全由RetestPlanner拥有。"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request, Response

from app.deps import CsrfProtected, DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.geo_retest_comparisons import (
    GeoOpportunityComparisonRead,
    GeoOpportunityContinueRequest,
    GeoOpportunityDecisionResult,
    GeoOpportunityResolveRequest,
)
from app.schemas.geo_retests import GeoRetestCreated, GeoRetestPreview, GeoRetestRequest
from app.services import geo_opportunity_decisions, geo_retest_comparisons, geo_retests
from app.services.geo_catalog_queries import read_snapshot

router = APIRouter(prefix="/api/v1/geo/opportunities", tags=["geo-opportunities"])


@router.get(
    "/{opportunity_id}/comparison",
    response_model=GeoOpportunityComparisonRead,
    operation_id="getGeoOpportunityComparison",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 404, 409, 422, 503),
)
def get_comparison(
    opportunity_id: UUID,
    db: DbSession,
    actor: EngineerUser,
    response: Response,
    retest_batch_id: UUID | None = None,
) -> GeoOpportunityComparisonRead:
    response.headers["Cache-Control"] = "no-store"
    return geo_retest_comparisons.get_comparison(db, opportunity_id, retest_batch_id, actor=actor)


@router.post(
    "/{opportunity_id}/resolve",
    response_model=GeoOpportunityDecisionResult,
    operation_id="resolveGeoOpportunity",
    responses=error_responses(401, 403, 404, 409, 422),
)
def resolve_opportunity(
    opportunity_id: UUID,
    payload: GeoOpportunityResolveRequest,
    request: Request,
    response: Response,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoOpportunityDecisionResult:
    response.headers["Cache-Control"] = "no-store"
    return geo_opportunity_decisions.resolve(
        db, opportunity_id, payload, actor=actor, request_id=request.state.request_id
    )


@router.post(
    "/{opportunity_id}/continue",
    response_model=GeoOpportunityDecisionResult,
    operation_id="continueGeoOpportunity",
    responses=error_responses(401, 403, 404, 409, 422),
)
def continue_opportunity(
    opportunity_id: UUID,
    payload: GeoOpportunityContinueRequest,
    request: Request,
    response: Response,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoOpportunityDecisionResult:
    response.headers["Cache-Control"] = "no-store"
    return geo_opportunity_decisions.continue_followup(
        db, opportunity_id, payload, actor=actor, request_id=request.state.request_id
    )


@router.get(
    "/{opportunity_id}/retest-preview",
    response_model=GeoRetestPreview,
    operation_id="previewGeoOpportunityRetest",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 404, 409, 422),
)
def preview_retest(
    opportunity_id: UUID,
    baseline_batch_id: UUID,
    db: DbSession,
    actor: EngineerUser,
    response: Response,
) -> GeoRetestPreview:
    response.headers["Cache-Control"] = "no-store"
    return geo_retests.preview_retest(db, opportunity_id, baseline_batch_id)


@router.post(
    "/{opportunity_id}/retest",
    response_model=GeoRetestCreated,
    status_code=201,
    operation_id="createGeoOpportunityRetest",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_retest(
    opportunity_id: UUID,
    payload: GeoRetestRequest,
    request: Request,
    response: Response,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=8, max_length=128, pattern=r"^[\x21-\x7E]+$"),
    ],
) -> GeoRetestCreated:
    response.headers["Cache-Control"] = "no-store"
    return geo_retests.create_retest(
        db,
        opportunity_id,
        payload,
        actor=actor,
        request_id=request.state.request_id,
        idempotency_key=idempotency_key,
    )
