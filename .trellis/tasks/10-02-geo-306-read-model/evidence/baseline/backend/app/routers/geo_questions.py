"""问题变体 HTTP 边界，事务与资格全部交给 Application Service。"""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BeforeValidator

from app.deps import CsrfProtected, DbSession, EngineerUser
from app.errors import error_responses
from app.geo_prompt_variants import (
    LANGUAGE_PATTERN,
    REGION_PATTERN,
    GeoPromptMentionMode,
    GeoPromptPriority,
)
from app.schemas.configuration import IntentType
from app.schemas.geo_prompt_variants import (
    GeoPromptVariantCreate,
    GeoPromptVariantListPage,
    GeoPromptVariantOut,
    GeoPromptVariantRevisionRequest,
    GeoPromptVariantUpdate,
)
from app.services import geo_prompt_variant_queries as queries
from app.services import geo_prompt_variants as commands

router = APIRouter(prefix="/api/v1/geo", tags=["geo-questions"])


@router.get(
    "/prompt-variants",
    response_model=GeoPromptVariantListPage,
    operation_id="listGeoPromptVariants",
    dependencies=[Depends(queries.read_snapshot)],
    responses=error_responses(401, 403, 422),
)
def list_variants(
    db: DbSession,
    user: EngineerUser,
    q: Annotated[str | None, Query(max_length=240, pattern=r"^[^\x00]*$")] = None,
    query_topic_id: UUID | None = None,
    intent_type: IntentType | None = None,
    mention_mode: GeoPromptMentionMode | None = None,
    language_code: Annotated[
        str | None, Query(min_length=2, max_length=16, pattern=LANGUAGE_PATTERN)
    ] = None,
    region_code: Annotated[
        str | None, Query(min_length=2, max_length=2, pattern=REGION_PATTERN)
    ] = None,
    priority: GeoPromptPriority | None = None,
    is_active: bool | None = None,
    sort: Literal["UPDATED_DESC", "TEXT_ASC"] = "UPDATED_DESC",
    page: int = Query(1, ge=1),
    page_size: Annotated[Literal[10, 20, 50], BeforeValidator(int), Query()] = 20,
) -> GeoPromptVariantListPage:
    return queries.list_variants(
        db,
        q=q,
        query_topic_id=query_topic_id,
        intent_type=intent_type,
        mention_mode=mention_mode,
        language_code=language_code,
        region_code=region_code,
        priority=priority,
        is_active=is_active,
        sort=sort,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/query-topics/{query_topic_id}/prompt-variants",
    response_model=GeoPromptVariantOut,
    status_code=201,
    operation_id="createGeoPromptVariant",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_variant(
    query_topic_id: UUID,
    payload: GeoPromptVariantCreate,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoPromptVariantOut:
    return commands.create_variant(
        db=db,
        query_topic_id=query_topic_id,
        payload=payload,
        actor=user,
        request_id=request.state.request_id,
    )


@router.get(
    "/prompt-variants/{variant_id}",
    response_model=GeoPromptVariantOut,
    operation_id="getGeoPromptVariant",
    dependencies=[Depends(queries.read_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def get_variant(variant_id: UUID, db: DbSession, user: EngineerUser) -> GeoPromptVariantOut:
    return queries.get_variant(db, variant_id)


@router.patch(
    "/prompt-variants/{variant_id}",
    response_model=GeoPromptVariantOut,
    operation_id="updateGeoPromptVariant",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_variant(
    variant_id: UUID,
    payload: GeoPromptVariantUpdate,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoPromptVariantOut:
    return commands.update_variant(
        db=db,
        variant_id=variant_id,
        payload=payload,
        actor=user,
        request_id=request.state.request_id,
    )


@router.post(
    "/prompt-variants/{variant_id}/enable",
    response_model=GeoPromptVariantOut,
    operation_id="enableGeoPromptVariant",
    responses=error_responses(401, 403, 404, 409, 422),
)
def enable_variant(
    variant_id: UUID,
    payload: GeoPromptVariantRevisionRequest,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoPromptVariantOut:
    return commands.set_variant_active(
        db=db,
        variant_id=variant_id,
        expected_revision=payload.expected_revision,
        is_active=True,
        actor=user,
        request_id=request.state.request_id,
    )


@router.post(
    "/prompt-variants/{variant_id}/disable",
    response_model=GeoPromptVariantOut,
    operation_id="disableGeoPromptVariant",
    responses=error_responses(401, 403, 404, 409, 422),
)
def disable_variant(
    variant_id: UUID,
    payload: GeoPromptVariantRevisionRequest,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoPromptVariantOut:
    return commands.set_variant_active(
        db=db,
        variant_id=variant_id,
        expected_revision=payload.expected_revision,
        is_active=False,
        actor=user,
        request_id=request.state.request_id,
    )


@router.delete(
    "/prompt-variants/{variant_id}",
    status_code=204,
    operation_id="deleteGeoPromptVariant",
    responses=error_responses(401, 403, 404, 409, 422),
)
def delete_variant(
    variant_id: UUID,
    expected_revision: Annotated[int, Query(ge=0)],
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> None:
    commands.delete_variant(
        db=db,
        variant_id=variant_id,
        expected_revision=expected_revision,
        actor=user,
        request_id=request.state.request_id,
    )
