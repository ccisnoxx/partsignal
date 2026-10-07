"""会话管理 HTTP 边界；管理员命令与专用 Collector 身份分开。"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response, Security
from fastapi.security import APIKeyHeader

from app.deps import AdminUser, CsrfProtected, DbSession
from app.errors import error_responses
from app.schemas.geo_browser_sessions import (
    GeoBrowserSessionAccessRequest,
    GeoBrowserSessionCommand,
    GeoBrowserSessionContext,
    GeoBrowserSessionEnvelope,
    GeoBrowserSessionImport,
    GeoBrowserSessionPurge,
)
from app.services import geo_browser_sessions as sessions


def no_cache(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(tags=["geo-browser-sessions"], dependencies=[Depends(no_cache)])
_service_key = APIKeyHeader(
    name="X-GEO-Browser-Service-Key", scheme_name="geoBrowserServiceKey", auto_error=False
)


@router.get(
    "/api/v1/geo/collection-profiles/{profile_id}/browser-session",
    response_model=GeoBrowserSessionContext,
    operation_id="getGeoBrowserSession",
    responses=error_responses(401, 403, 404, 409, 422),
)
def get_session(profile_id: UUID, db: DbSession, admin: AdminUser) -> GeoBrowserSessionContext:
    return sessions.get_context(db=db, profile_id=profile_id, actor=admin)


@router.post(
    "/api/v1/geo/collection-profiles/{profile_id}/browser-session/import",
    response_model=GeoBrowserSessionContext,
    operation_id="importGeoBrowserSession",
    responses=error_responses(401, 403, 404, 409, 422, 503),
)
def import_session(
    profile_id: UUID,
    payload: GeoBrowserSessionImport,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoBrowserSessionContext:
    return sessions.import_session(
        db=db,
        profile_id=profile_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/api/v1/geo/collection-profiles/{profile_id}/browser-session/health",
    response_model=GeoBrowserSessionContext,
    operation_id="checkGeoBrowserSessionHealth",
    responses=error_responses(401, 403, 404, 409, 422, 503),
)
def check_health(
    profile_id: UUID,
    payload: GeoBrowserSessionCommand,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoBrowserSessionContext:
    return sessions.check_health(
        db=db,
        profile_id=profile_id,
        expected_revision=payload.expected_revision,
        reference=payload.session_reference,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/api/v1/geo/collection-profiles/{profile_id}/browser-session/revoke",
    response_model=GeoBrowserSessionContext,
    operation_id="revokeGeoBrowserSession",
    responses=error_responses(401, 403, 404, 409, 422, 503),
)
def revoke_session(
    profile_id: UUID,
    payload: GeoBrowserSessionCommand,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoBrowserSessionContext:
    return sessions.revoke_session(
        db=db,
        profile_id=profile_id,
        expected_revision=payload.expected_revision,
        reference=payload.session_reference,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/api/v1/geo/collection-profiles/{profile_id}/browser-session/purge",
    response_model=GeoBrowserSessionContext,
    operation_id="purgeGeoBrowserSessions",
    responses=error_responses(401, 403, 404, 409, 422, 503),
)
def purge_sessions(
    profile_id: UUID,
    payload: GeoBrowserSessionPurge,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoBrowserSessionContext:
    return sessions.purge_sessions(
        db=db,
        profile_id=profile_id,
        expected_revision=payload.expected_revision,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/api/internal/geo/browser-sessions/{session_reference}/access",
    response_model=GeoBrowserSessionEnvelope,
    operation_id="accessGeoBrowserSession",
    responses=error_responses(401, 403, 404, 409, 422, 503),
)
def access_session(
    session_reference: UUID,
    payload: GeoBrowserSessionAccessRequest,
    request: Request,
    db: DbSession,
    service_key: Annotated[str | None, Security(_service_key)],
) -> GeoBrowserSessionEnvelope:
    return sessions.access_session(
        db=db,
        reference=session_reference,
        profile_id=payload.profile_id,
        supplied_key=service_key,
        request_id=request.state.request_id,
    )
