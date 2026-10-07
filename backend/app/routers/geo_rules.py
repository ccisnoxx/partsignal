"""HTTP 仅拥有协议及认证，规则事务由应用服务维护。"""

from fastapi import APIRouter, Depends, Request

from app.deps import AdminUser, CsrfProtected, DbSession
from app.errors import error_responses
from app.schemas.geo_rules import (
    GeoRulePreviewRead,
    GeoRulePreviewRequest,
    GeoRuleSetRead,
    GeoRuleUpdateRequest,
)
from app.services import geo_rules
from app.services.geo_catalog_queries import read_snapshot

router = APIRouter(prefix="/api/v1/geo/rules", tags=["geo-rules"])


@router.get(
    "",
    response_model=GeoRuleSetRead,
    operation_id="getGeoRules",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 503),
)
def get_rules(db: DbSession, admin: AdminUser) -> GeoRuleSetRead:
    return geo_rules.get_rules(db)


@router.put(
    "",
    response_model=GeoRuleSetRead,
    operation_id="updateGeoRules",
    responses=error_responses(401, 403, 409, 422, 503),
)
def update_rules(
    payload: GeoRuleUpdateRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoRuleSetRead:
    return geo_rules.update_rules(db, payload, actor=admin, request_id=request.state.request_id)


@router.post(
    "/preview",
    response_model=GeoRulePreviewRead,
    operation_id="previewGeoRules",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 409, 422, 503),
)
def preview_rules(
    payload: GeoRulePreviewRequest, db: DbSession, admin: AdminUser, _csrf: CsrfProtected
) -> GeoRulePreviewRead:
    return geo_rules.preview_rules(db, payload)
