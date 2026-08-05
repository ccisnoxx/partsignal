"""产品、规范化事实工作区和不可变事实版本接口。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import func, or_, select

from app.deps import (
    AdminUser,
    CsrfProtected,
    CurrentUser,
    DbSession,
    EngineerUser,
    assert_account_types,
)
from app.errors import not_found
from app.models.product_facts import (
    FactVersion,
    Product,
)
from app.schemas.common import AccountType, CommandRequest, RequestChangesCommand
from app.schemas.content import FactReviewContext
from app.schemas.product_facts import (
    FactReviewSubmissionRequest,
    FactVersionList,
    FactVersionOut,
    ProductCreate,
    ProductFactsDraft,
    ProductFactsDraftUpdate,
    ProductList,
    ProductOut,
    ProductUpdate,
)
from app.services.product_facts import (
    create_product as create_product_command,
)
from app.services.product_facts import delete_fact_version as delete_fact_version_command
from app.services.product_facts import delete_product as delete_product_command
from app.services.product_facts import product_facts_draft_out, product_out, products_out
from app.services.product_facts import (
    replace_product_facts as replace_product_facts_command,
)
from app.services.product_facts import submit_fact_review as submit_fact_review_command
from app.services.product_facts import (
    update_product as update_product_command,
)
from app.services.projections import fact_version_out, fact_versions_out
from app.services.review import get_fact_review_context, transition_fact_version

router = APIRouter(prefix="/api/v1", tags=["product-facts", "review"])

ProductEditor = EngineerUser
ProductReviewer = EngineerUser


@router.get("/products", response_model=ProductList, operation_id="listProducts")
def list_products(
    db: DbSession,
    user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = None,
) -> ProductList:
    """分页搜索产品稳定身份。"""
    query = select(Product)
    count_query = select(func.count()).select_from(Product)
    if search:
        pattern = f"%{search.strip()}%"
        condition = or_(Product.part_number.ilike(pattern), Product.brand.ilike(pattern))
        query = query.where(condition)
        count_query = count_query.where(condition)
    total = int(db.scalar(count_query) or 0)
    items = list(
        db.scalars(
            query.order_by(Product.created_at).offset((page - 1) * page_size).limit(page_size)
        )
    )
    return ProductList(
        items=products_out(db, items, can_delete=user.account_type == "ADMIN"),
        page=page,
        page_size=page_size,
        total=total,
    )


@router.post(
    "/products",
    response_model=ProductOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createProduct",
)
def create_product(
    payload: ProductCreate,
    request: Request,
    db: DbSession,
    editor: ProductEditor,
    _csrf: CsrfProtected,
) -> ProductOut:
    product = create_product_command(
        db=db, payload=payload, actor=editor, request_id=request.state.request_id
    )
    return product_out(db, product, can_delete=editor.account_type == "ADMIN")


@router.get("/products/{product_id}", response_model=ProductOut, operation_id="getProduct")
def get_product(product_id: uuid.UUID, db: DbSession, user: CurrentUser) -> ProductOut:
    product = db.get(Product, product_id)
    if product is None:
        raise not_found("产品")
    return product_out(db, product, can_delete=user.account_type == "ADMIN")


@router.patch("/products/{product_id}", response_model=ProductOut, operation_id="updateProduct")
def update_product(
    product_id: uuid.UUID,
    payload: ProductUpdate,
    request: Request,
    db: DbSession,
    editor: ProductEditor,
    _csrf: CsrfProtected,
) -> ProductOut:
    product = update_product_command(
        db=db,
        product_id=product_id,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
    )
    return product_out(db, product, can_delete=editor.account_type == "ADMIN")


@router.delete(
    "/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="deleteProduct"
)
def delete_product(
    product_id: uuid.UUID,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
    delete_product_command(
        db=db, product_id=product_id, actor=admin, request_id=request.state.request_id
    )


@router.get(
    "/products/{product_id}/facts",
    response_model=ProductFactsDraft,
    operation_id="getProductFactsDraft",
)
def get_product_facts(
    product_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> ProductFactsDraft:
    product = db.get(Product, product_id)
    if product is None:
        raise not_found("产品")
    return product_facts_draft_out(db, product)


@router.put(
    "/products/{product_id}/facts",
    response_model=ProductFactsDraft,
    operation_id="replaceProductFactsDraft",
)
def replace_product_facts(
    product_id: uuid.UUID,
    payload: ProductFactsDraftUpdate,
    request: Request,
    db: DbSession,
    editor: ProductEditor,
    _csrf: CsrfProtected,
) -> ProductFactsDraft:
    return replace_product_facts_command(
        db=db,
        product_id=product_id,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
    )


@router.get(
    "/products/{product_id}/fact-versions",
    response_model=FactVersionList,
    operation_id="listFactVersions",
)
def list_fact_versions(product_id: uuid.UUID, db: DbSession, user: CurrentUser) -> FactVersionList:
    if db.get(Product, product_id) is None:
        raise not_found("产品")
    versions = list(
        db.scalars(
            select(FactVersion)
            .where(FactVersion.product_id == product_id)
            .order_by(FactVersion.version.desc())
        )
    )
    return FactVersionList(
        items=fact_versions_out(db, versions, can_delete=user.account_type == "ADMIN")
    )


@router.post(
    "/products/{product_id}/fact-review-submissions",
    response_model=FactVersionOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="submitProductFactReview",
)
def submit_product_fact_review(
    product_id: uuid.UUID,
    payload: FactReviewSubmissionRequest,
    request: Request,
    db: DbSession,
    editor: CurrentUser,
    _csrf: CsrfProtected,
) -> FactVersionOut:
    assert_account_types(editor, (AccountType.ADMIN, AccountType.ENGINEER))
    version = submit_fact_review_command(
        db=db,
        product_id=product_id,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
    )
    return fact_version_out(db, version, can_delete=editor.account_type == "ADMIN")


@router.get(
    "/fact-versions/{fact_version_id}",
    response_model=FactVersionOut,
    operation_id="getFactVersion",
)
def get_fact_version(
    fact_version_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> FactVersionOut:
    version = db.get(FactVersion, fact_version_id)
    if version is None:
        raise not_found("事实版本")
    return fact_version_out(db, version, can_delete=user.account_type == "ADMIN")


@router.delete(
    "/fact-versions/{fact_version_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteFactVersion",
)
def delete_fact_version(
    fact_version_id: uuid.UUID,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    _csrf: CsrfProtected,
) -> None:
    delete_fact_version_command(
        db=db,
        fact_version_id=fact_version_id,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.get(
    "/fact-versions/{fact_version_id}/review-context",
    response_model=FactReviewContext,
    operation_id="getFactReviewContext",
)
def fact_review_context(
    fact_version_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> FactReviewContext:
    """返回冻结事实证据和当前版本自身的追加式审核历史。"""
    return get_fact_review_context(
        db, fact_version_id, can_delete=user.account_type == "ADMIN"
    )


@router.post(
    "/fact-versions/{fact_version_id}/approve",
    response_model=FactVersionOut,
    operation_id="approveFactVersion",
)
def approve_fact_version(
    fact_version_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    reviewer: ProductReviewer,
    _csrf: CsrfProtected,
) -> FactVersionOut:
    return transition_fact_version(
        db=db,
        fact_version_id=fact_version_id,
        expected_revision=payload.expected_revision,
        comment=payload.comment,
        actor=reviewer,
        request_id=request.state.request_id,
        action="approve",
    )


@router.post(
    "/fact-versions/{fact_version_id}/request-changes",
    response_model=FactVersionOut,
    operation_id="requestFactVersionChanges",
)
def request_fact_changes(
    fact_version_id: uuid.UUID,
    payload: RequestChangesCommand,
    request: Request,
    db: DbSession,
    reviewer: ProductReviewer,
    _csrf: CsrfProtected,
) -> FactVersionOut:
    return transition_fact_version(
        db=db,
        fact_version_id=fact_version_id,
        expected_revision=payload.expected_revision,
        comment=payload.comment,
        actor=reviewer,
        request_id=request.state.request_id,
        action="request-changes",
    )


@router.post(
    "/fact-versions/{fact_version_id}/retire",
    response_model=FactVersionOut,
    operation_id="retireFactVersion",
)
def retire_fact_version(
    fact_version_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    reviewer: ProductReviewer,
    _csrf: CsrfProtected,
) -> FactVersionOut:
    return transition_fact_version(
        db=db,
        fact_version_id=fact_version_id,
        expected_revision=payload.expected_revision,
        comment=payload.comment,
        actor=reviewer,
        request_id=request.state.request_id,
        action="retire",
    )
