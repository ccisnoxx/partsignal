"""GEO 管理 HTTP 合同；事务、锁与角色投影由应用服务拥有。"""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BeforeValidator

from app.deps import AdminUser, CsrfProtected, DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.common import AccountType
from app.schemas.geo_surface_management import (
    GeoCollectionProfileListPage,
    GeoCollectionProfileRead,
    GeoConfigurationRevisionRequest,
    GeoEngineSurfaceListPage,
    GeoEngineSurfaceRead,
)
from app.schemas.geo_surfaces import (
    GeoCollectionMode,
    GeoCollectionProfileCreate,
    GeoCollectionProfileUpdate,
    GeoEngineSurfaceCreate,
    GeoEngineSurfaceUpdate,
    GeoSurfaceKind,
)
from app.services import geo_surface_commands as commands
from app.services import geo_surface_queries as queries
from app.services.geo_catalog_queries import read_snapshot
from app.services.geo_profile_tests import test_profile as run_profile_test

router = APIRouter(prefix="/api/v1/geo", tags=["geo-surface-management"])


@router.post(
    "/collection-profiles/{profile_id}/test",
    response_model=GeoCollectionProfileRead,
    operation_id="testGeoCollectionProfile",
    responses=error_responses(401, 403, 404, 409, 422),
)
def test_profile(
    profile_id: UUID,
    payload: GeoConfigurationRevisionRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoCollectionProfileRead:
    return run_profile_test(
        db=db, profile_id=profile_id, expected_revision=payload.expected_revision,
        actor=admin, request_id=request.state.request_id,
    )


@router.get(
    "/engine-surfaces",
    response_model=GeoEngineSurfaceListPage,
    operation_id="listGeoEngineSurfaces",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 422),
)
def list_surfaces(
    db: DbSession,
    user: EngineerUser,
    q: Annotated[str | None, Query(max_length=240, pattern=r"^[^\x00]*$")] = None,
    surface_kind: GeoSurfaceKind | None = None,
    is_active: bool | None = None,
    sort: Literal["NAME_ASC", "UPDATED_DESC"] = "NAME_ASC",
    page: int = Query(1, ge=1),
    page_size: Annotated[Literal[10, 20, 50], BeforeValidator(int), Query()] = 20,
) -> GeoEngineSurfaceListPage:
    return queries.list_surfaces(
        db,
        actor_type=AccountType(user.account_type),
        q=q,
        surface_kind=surface_kind,
        is_active=is_active,
        sort=sort,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/engine-surfaces",
    response_model=GeoEngineSurfaceRead,
    status_code=201,
    operation_id="createGeoEngineSurface",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_surface(
    payload: GeoEngineSurfaceCreate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoEngineSurfaceRead:
    return commands.create_surface(
        db=db,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.get(
    "/engine-surfaces/{surface_id}",
    response_model=GeoEngineSurfaceRead,
    operation_id="getGeoEngineSurface",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def get_surface(surface_id: UUID, db: DbSession, user: EngineerUser) -> GeoEngineSurfaceRead:
    return queries.get_surface(db, surface_id, actor_type=AccountType(user.account_type))


@router.patch(
    "/engine-surfaces/{surface_id}",
    response_model=GeoEngineSurfaceRead,
    operation_id="updateGeoEngineSurface",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_surface(
    surface_id: UUID,
    payload: GeoEngineSurfaceUpdate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoEngineSurfaceRead:
    return commands.update_surface(
        db=db,
        surface_id=surface_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.delete(
    "/engine-surfaces/{surface_id}",
    status_code=204,
    operation_id="deleteGeoEngineSurface",
    responses=error_responses(401, 403, 404, 409, 422),
)
def delete_surface(
    surface_id: UUID,
    expected_revision: Annotated[int, Query(ge=0)],
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
    commands.delete_surface(
        db=db,
        surface_id=surface_id,
        expected_revision=expected_revision,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/engine-surfaces/{surface_id}/enable",
    response_model=GeoEngineSurfaceRead,
    operation_id="enableGeoEngineSurface",
    responses=error_responses(401, 403, 404, 409, 422),
)
def enable_surface(
    surface_id: UUID,
    payload: GeoConfigurationRevisionRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoEngineSurfaceRead:
    return commands.set_surface_active(
        db=db,
        surface_id=surface_id,
        expected_revision=payload.expected_revision,
        is_active=True,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/engine-surfaces/{surface_id}/disable",
    response_model=GeoEngineSurfaceRead,
    operation_id="disableGeoEngineSurface",
    responses=error_responses(401, 403, 404, 409, 422),
)
def disable_surface(
    surface_id: UUID,
    payload: GeoConfigurationRevisionRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoEngineSurfaceRead:
    return commands.set_surface_active(
        db=db,
        surface_id=surface_id,
        expected_revision=payload.expected_revision,
        is_active=False,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.get(
    "/collection-profiles",
    response_model=GeoCollectionProfileListPage,
    operation_id="listGeoCollectionProfiles",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 422),
)
def list_profiles(
    db: DbSession,
    user: EngineerUser,
    q: Annotated[str | None, Query(max_length=240, pattern=r"^[^\x00]*$")] = None,
    engine_surface_id: UUID | None = None,
    collection_mode: GeoCollectionMode | None = None,
    is_active: bool | None = None,
    sort: Literal["NAME_ASC", "UPDATED_DESC"] = "NAME_ASC",
    page: int = Query(1, ge=1),
    page_size: Annotated[Literal[10, 20, 50], BeforeValidator(int), Query()] = 20,
) -> GeoCollectionProfileListPage:
    return queries.list_profiles(
        db,
        actor_type=AccountType(user.account_type),
        q=q,
        engine_surface_id=engine_surface_id,
        collection_mode=collection_mode,
        is_active=is_active,
        sort=sort,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/collection-profiles",
    response_model=GeoCollectionProfileRead,
    status_code=201,
    operation_id="createGeoCollectionProfile",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_profile(
    payload: GeoCollectionProfileCreate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoCollectionProfileRead:
    return commands.create_profile(
        db=db,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.get(
    "/collection-profiles/{profile_id}",
    response_model=GeoCollectionProfileRead,
    operation_id="getGeoCollectionProfile",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def get_profile(profile_id: UUID, db: DbSession, user: EngineerUser) -> GeoCollectionProfileRead:
    return queries.get_profile(db, profile_id, actor_type=AccountType(user.account_type))


@router.patch(
    "/collection-profiles/{profile_id}",
    response_model=GeoCollectionProfileRead,
    operation_id="updateGeoCollectionProfile",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_profile(
    profile_id: UUID,
    payload: GeoCollectionProfileUpdate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoCollectionProfileRead:
    return commands.update_profile(
        db=db,
        profile_id=profile_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.delete(
    "/collection-profiles/{profile_id}",
    status_code=204,
    operation_id="deleteGeoCollectionProfile",
    responses=error_responses(401, 403, 404, 409, 422),
)
def delete_profile(
    profile_id: UUID,
    expected_revision: Annotated[int, Query(ge=0)],
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
    commands.delete_profile(
        db=db,
        profile_id=profile_id,
        expected_revision=expected_revision,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/collection-profiles/{profile_id}/enable",
    response_model=GeoCollectionProfileRead,
    operation_id="enableGeoCollectionProfile",
    responses=error_responses(401, 403, 404, 409, 422),
)
def enable_profile(
    profile_id: UUID,
    payload: GeoConfigurationRevisionRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoCollectionProfileRead:
    return commands.set_profile_active(
        db=db,
        profile_id=profile_id,
        expected_revision=payload.expected_revision,
        is_active=True,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/collection-profiles/{profile_id}/disable",
    response_model=GeoCollectionProfileRead,
    operation_id="disableGeoCollectionProfile",
    responses=error_responses(401, 403, 404, 409, 422),
)
def disable_profile(
    profile_id: UUID,
    payload: GeoConfigurationRevisionRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoCollectionProfileRead:
    return commands.set_profile_active(
        db=db,
        profile_id=profile_id,
        expected_revision=payload.expected_revision,
        is_active=False,
        actor=admin,
        request_id=request.state.request_id,
    )
