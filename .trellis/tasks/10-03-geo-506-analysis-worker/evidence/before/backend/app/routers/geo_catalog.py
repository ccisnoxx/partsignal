"""GEO Catalog HTTP 边界；业务事务、锁与聚合投影交给应用服务。"""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BeforeValidator

from app.deps import AdminUser, CsrfProtected, DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.common import AccountType
from app.schemas.geo_catalog import (
    GeoSubjectAliasCreate,
    GeoSubjectAliasUpdate,
    GeoSubjectCreate,
    GeoSubjectDomainCreate,
    GeoSubjectListPage,
    GeoSubjectOut,
    GeoSubjectRevisionRequest,
    GeoSubjectType,
    GeoSubjectUpdate,
)
from app.services import geo_catalog as commands
from app.services import geo_catalog_queries as queries

router = APIRouter(prefix="/api/v1/geo/subjects", tags=["geo-catalog"])


@router.get(
    "",
    response_model=GeoSubjectListPage,
    operation_id="listGeoSubjects",
    dependencies=[Depends(queries.read_snapshot)],
    responses=error_responses(401, 403, 422),
)
def list_subjects(
    db: DbSession,
    user: EngineerUser,
    q: Annotated[str | None, Query(max_length=240)] = None,
    subject_type: GeoSubjectType | None = None,
    product_id: UUID | None = None,
    parent_subject_id: UUID | None = None,
    is_active: bool | None = None,
    sort: Literal["NAME_ASC", "UPDATED_DESC"] = "NAME_ASC",
    page: int = Query(1, ge=1),
    page_size: Annotated[Literal[10, 20, 50], BeforeValidator(int), Query()] = 20,
) -> GeoSubjectListPage:
    return queries.list_subjects(
        db,
        actor_type=AccountType(user.account_type),
        q=q,
        subject_type=subject_type,
        product_id=product_id,
        parent_subject_id=parent_subject_id,
        is_active=is_active,
        sort=sort,
        page=page,
        page_size=page_size,
    )


@router.post(
    "",
    response_model=GeoSubjectOut,
    status_code=201,
    operation_id="createGeoSubject",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_subject(
    payload: GeoSubjectCreate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoSubjectOut:
    return commands.create_subject(
        db=db,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.get(
    "/{subject_id}",
    response_model=GeoSubjectOut,
    operation_id="getGeoSubject",
    dependencies=[Depends(queries.read_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def get_subject(subject_id: UUID, db: DbSession, user: EngineerUser) -> GeoSubjectOut:
    return queries.get_subject(db, subject_id, actor_type=AccountType(user.account_type))


@router.patch(
    "/{subject_id}",
    response_model=GeoSubjectOut,
    operation_id="updateGeoSubject",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_subject(
    subject_id: UUID,
    payload: GeoSubjectUpdate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoSubjectOut:
    return commands.update_subject(
        db=db,
        subject_id=subject_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.delete(
    "/{subject_id}",
    status_code=204,
    operation_id="deleteGeoSubject",
    responses=error_responses(401, 403, 404, 409, 422),
)
def delete_subject(
    subject_id: UUID,
    expected_revision: Annotated[int, Query(ge=0)],
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
    commands.delete_subject(
        db=db,
        subject_id=subject_id,
        expected_revision=expected_revision,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/{subject_id}/enable",
    response_model=GeoSubjectOut,
    operation_id="enableGeoSubject",
    responses=error_responses(401, 403, 404, 409, 422),
)
def enable_subject(
    subject_id: UUID,
    payload: GeoSubjectRevisionRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoSubjectOut:
    return commands.set_subject_active(
        db=db,
        subject_id=subject_id,
        expected_revision=payload.expected_revision,
        is_active=True,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/{subject_id}/disable",
    response_model=GeoSubjectOut,
    operation_id="disableGeoSubject",
    responses=error_responses(401, 403, 404, 409, 422),
)
def disable_subject(
    subject_id: UUID,
    payload: GeoSubjectRevisionRequest,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoSubjectOut:
    return commands.set_subject_active(
        db=db,
        subject_id=subject_id,
        expected_revision=payload.expected_revision,
        is_active=False,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/{subject_id}/aliases",
    response_model=GeoSubjectOut,
    operation_id="createGeoSubjectAlias",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_alias(
    subject_id: UUID,
    payload: GeoSubjectAliasCreate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoSubjectOut:
    return commands.create_alias(
        db=db,
        subject_id=subject_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.patch(
    "/{subject_id}/aliases/{alias_id}",
    response_model=GeoSubjectOut,
    operation_id="updateGeoSubjectAlias",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_alias(
    subject_id: UUID,
    alias_id: UUID,
    payload: GeoSubjectAliasUpdate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoSubjectOut:
    return commands.update_alias(
        db=db,
        subject_id=subject_id,
        alias_id=alias_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.delete(
    "/{subject_id}/aliases/{alias_id}",
    response_model=GeoSubjectOut,
    operation_id="deleteGeoSubjectAlias",
    responses=error_responses(401, 403, 404, 409, 422),
)
def delete_alias(
    subject_id: UUID,
    alias_id: UUID,
    expected_revision: Annotated[int, Query(ge=0)],
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoSubjectOut:
    return commands.delete_alias(
        db=db,
        subject_id=subject_id,
        alias_id=alias_id,
        expected_revision=expected_revision,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.post(
    "/{subject_id}/domains",
    response_model=GeoSubjectOut,
    operation_id="createGeoSubjectDomain",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_domain(
    subject_id: UUID,
    payload: GeoSubjectDomainCreate,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoSubjectOut:
    return commands.create_domain(
        db=db,
        subject_id=subject_id,
        payload=payload,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.delete(
    "/{subject_id}/domains/{domain_id}",
    response_model=GeoSubjectOut,
    operation_id="deleteGeoSubjectDomain",
    responses=error_responses(401, 403, 404, 409, 422),
)
def delete_domain(
    subject_id: UUID,
    domain_id: UUID,
    expected_revision: Annotated[int, Query(ge=0)],
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> GeoSubjectOut:
    return commands.delete_domain(
        db=db,
        subject_id=subject_id,
        domain_id=domain_id,
        expected_revision=expected_revision,
        actor=admin,
        request_id=request.state.request_id,
    )
