"""Slice 1B：统一文章台账、多平台 URL 发布记录、产品资料附件与一键复制/轻量生稿 HTTP 路由。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request, status

from app.deps import CsrfProtected, DbSession, EngineerUser, ReaderUser
from app.errors import error_responses
from app.schemas.articles import (
    ArticleCreateRequest,
    ArticleDetail,
    ArticleGenerateDraftRequest,
    ArticleList,
    ArticleOriginType,
    ArticlePublicationCreateRequest,
    ArticlePublicationList,
    ArticlePublicationOut,
    ArticlePublicationRegistrationStatus,
    ArticlePublicationUpdateRequest,
    ArticlePublicationVerificationStatus,
    ArticleStatus,
    ArticleUpdateRequest,
    ProductMaterialAttachmentList,
    ProductMaterialAttachmentOut,
    ProductMaterialAttachRequest,
    ProductPromptCopyBundleOut,
    ProductPromptCopyBundleRequest,
)
from app.services import article_ai_draft, article_publications, articles, product_materials

router = APIRouter(prefix="/api/v1", tags=["articles"])


def _repeatable_read(db: DbSession) -> None:
    db.autoflush = False
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})


@router.get(
    "/products/{product_id}/materials",
    response_model=ProductMaterialAttachmentList,
    operation_id="listProductMaterials",
    dependencies=[Depends(_repeatable_read)],
    responses=error_responses(401, 403, 404, 422),
)
def list_product_materials_route(
    product_id: uuid.UUID, db: DbSession, _user: ReaderUser
) -> ProductMaterialAttachmentList:
    return product_materials.list_product_materials(db, product_id)


@router.post(
    "/products/{product_id}/materials",
    response_model=ProductMaterialAttachmentOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="attachProductMaterial",
    responses=error_responses(401, 403, 404, 422),
)
def attach_product_material_route(
    product_id: uuid.UUID,
    payload: ProductMaterialAttachRequest,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> ProductMaterialAttachmentOut:
    return product_materials.attach_product_material(
        db, product_id=product_id, payload=payload, actor=actor, request_id=request.state.request_id
    )


@router.delete(
    "/products/{product_id}/materials/{file_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="detachProductMaterial",
    responses=error_responses(401, 403, 404, 422),
)
def detach_product_material_route(
    product_id: uuid.UUID,
    file_id: uuid.UUID,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> None:
    product_materials.detach_product_material(
        db, product_id=product_id, file_id=file_id, actor=actor, request_id=request.state.request_id
    )


@router.post(
    "/products/{product_id}/prompt-copy-bundle",
    response_model=ProductPromptCopyBundleOut,
    operation_id="buildProductPromptCopyBundle",
    dependencies=[Depends(_repeatable_read)],
    responses=error_responses(401, 403, 404, 409, 422),
)
def build_product_prompt_copy_bundle_route(
    product_id: uuid.UUID,
    payload: ProductPromptCopyBundleRequest,
    db: DbSession,
    _actor: EngineerUser,
    _csrf: CsrfProtected,
) -> ProductPromptCopyBundleOut:
    return article_ai_draft.build_product_prompt_copy_bundle(
        db, product_id=product_id, payload=payload
    )


@router.get(
    "/articles",
    response_model=ArticleList,
    operation_id="listArticles",
    dependencies=[Depends(_repeatable_read)],
    responses=error_responses(401, 403, 422),
)
def list_articles_route(
    db: DbSession,
    _user: ReaderUser,
    product_id: uuid.UUID | None = None,
    origin_type: ArticleOriginType | None = None,
    article_status: Annotated[ArticleStatus | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ArticleList:
    return articles.list_articles(
        db,
        product_id=product_id,
        origin_type=origin_type,
        status=article_status,
        q=q,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/articles",
    response_model=ArticleDetail,
    status_code=status.HTTP_201_CREATED,
    operation_id="createArticle",
    responses=error_responses(401, 403, 404, 422),
)
def create_article_route(
    payload: ArticleCreateRequest,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> ArticleDetail:
    return articles.create_article(
        db, payload=payload, actor=actor, request_id=request.state.request_id
    )


@router.post(
    "/articles/generate-draft",
    response_model=ArticleDetail,
    status_code=status.HTTP_201_CREATED,
    operation_id="generateArticleDraftFromProduct",
    responses=error_responses(401, 403, 404, 409, 422, 502),
)
def generate_article_draft_route(
    payload: ArticleGenerateDraftRequest,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=1, max_length=128, pattern=r"^[\x21-\x7E]+$"),
    ],
) -> ArticleDetail:
    return article_ai_draft.generate_article_draft_from_product(
        db,
        payload=payload,
        actor=actor,
        idempotency_key=idempotency_key,
        request_id=request.state.request_id,
    )


@router.get(
    "/articles/{article_id}",
    response_model=ArticleDetail,
    operation_id="getArticle",
    dependencies=[Depends(_repeatable_read)],
    responses=error_responses(401, 403, 404, 422),
)
def get_article_route(article_id: uuid.UUID, db: DbSession, _user: ReaderUser) -> ArticleDetail:
    return articles.get_article_detail(db, article_id)


@router.patch(
    "/articles/{article_id}",
    response_model=ArticleDetail,
    operation_id="updateArticle",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_article_route(
    article_id: uuid.UUID,
    payload: ArticleUpdateRequest,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> ArticleDetail:
    return articles.update_article(
        db, article_id=article_id, payload=payload, actor=actor, request_id=request.state.request_id
    )


@router.get(
    "/article-publications",
    response_model=ArticlePublicationList,
    operation_id="listArticlePublications",
    dependencies=[Depends(_repeatable_read)],
    responses=error_responses(401, 403, 422),
)
def list_article_publications_route(
    db: DbSession,
    _user: ReaderUser,
    article_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
    platform_profile_id: uuid.UUID | None = None,
    registration_status: ArticlePublicationRegistrationStatus | None = None,
    verification_status: ArticlePublicationVerificationStatus | None = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ArticlePublicationList:
    return article_publications.list_article_publications(
        db,
        article_id=article_id,
        product_id=product_id,
        platform_profile_id=platform_profile_id,
        registration_status=registration_status,
        verification_status=verification_status,
        q=q,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/articles/{article_id}/publications",
    response_model=ArticlePublicationOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createArticlePublication",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_article_publication_route(
    article_id: uuid.UUID,
    payload: ArticlePublicationCreateRequest,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> ArticlePublicationOut:
    return article_publications.create_article_publication(
        db, article_id=article_id, payload=payload, actor=actor, request_id=request.state.request_id
    )


@router.patch(
    "/article-publications/{publication_id}",
    response_model=ArticlePublicationOut,
    operation_id="updateArticlePublication",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_article_publication_route(
    publication_id: uuid.UUID,
    payload: ArticlePublicationUpdateRequest,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> ArticlePublicationOut:
    return article_publications.update_article_publication(
        db,
        publication_id=publication_id,
        payload=payload,
        actor=actor,
        request_id=request.state.request_id,
    )
