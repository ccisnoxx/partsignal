"""产品、规范化事实工作区和不可变事实版本接口。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import func, or_, select

from app.audit import commit_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.deps import (
    AdminUser,
    CsrfProtected,
    CurrentUser,
    DbSession,
    EngineerUser,
    assert_account_types,
)
from app.errors import AppError, not_found
from app.models.product_facts import (
    FactVersion,
    Product,
)
from app.schemas.common import (
    AccountType,
    CommandRequest,
    RequestChangesCommand,
)
from app.schemas.content import FactReviewContext
from app.schemas.product_facts import (
    CreateVersionRequest,
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
    create_fact_version as create_fact_version_command,
)
from app.services.product_facts import (
    create_product as create_product_command,
)
from app.services.product_facts import delete_fact_version as delete_fact_version_command
from app.services.product_facts import delete_product as delete_product_command
from app.services.product_facts import (
    load_fact_body,
)
from app.services.product_facts import (
    replace_product_facts as replace_product_facts_command,
)
from app.services.product_facts import (
    update_product as update_product_command,
)
from app.services.projections import fact_version_out
from app.services.review import get_fact_review_context, transition_fact_version

router = APIRouter(prefix="/api/v1", tags=["product-facts", "review"])

ProductEditor = EngineerUser
ProductReviewer = EngineerUser


@router.get("/products", response_model=ProductList, operation_id="listProducts")
def list_products(
    db: DbSession,
    _user: CurrentUser,
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
        items=[ProductOut.model_validate(item) for item in items],
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
    return ProductOut.model_validate(product)


@router.get("/products/{product_id}", response_model=ProductOut, operation_id="getProduct")
def get_product(product_id: uuid.UUID, db: DbSession, _user: CurrentUser) -> ProductOut:
    product = db.get(Product, product_id)
    if product is None:
        raise not_found("产品")
    return ProductOut.model_validate(product)


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
    return ProductOut.model_validate(product)


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
    body = load_fact_body(db, product)
    return ProductFactsDraft(
        **body.model_dump(), product_id=product.id, revision=product.facts_revision
    )


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
def list_fact_versions(product_id: uuid.UUID, db: DbSession, _user: CurrentUser) -> FactVersionList:
    if db.get(Product, product_id) is None:
        raise not_found("产品")
    versions = list(
        db.scalars(
            select(FactVersion)
            .where(FactVersion.product_id == product_id)
            .order_by(FactVersion.version.desc())
        )
    )
    return FactVersionList(items=[fact_version_out(item) for item in versions])


@router.post(
    "/products/{product_id}/fact-versions",
    response_model=FactVersionOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createFactVersion",
)
def create_fact_version(
    product_id: uuid.UUID,
    payload: CreateVersionRequest,
    request: Request,
    db: DbSession,
    editor: ProductEditor,
    _csrf: CsrfProtected,
) -> FactVersionOut:
    version = create_fact_version_command(
        db=db,
        product_id=product_id,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
    )
    return fact_version_out(version)


@router.get(
    "/fact-versions/{fact_version_id}",
    response_model=FactVersionOut,
    operation_id="getFactVersion",
)
def get_fact_version(
    fact_version_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> FactVersionOut:
    version = db.get(FactVersion, fact_version_id)
    if version is None:
        raise not_found("事实版本")
    return fact_version_out(version)


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
    fact_version_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> FactReviewContext:
    """返回冻结事实证据和追加式审核历史。"""
    return get_fact_review_context(db, fact_version_id)


@router.post(
    "/fact-versions/{fact_version_id}/submit",
    response_model=FactVersionOut,
    operation_id="submitFactVersion",
)
def submit_fact_version(
    fact_version_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    editor: CurrentUser,
    _csrf: CsrfProtected,
) -> FactVersionOut:
    actor_id = editor.id
    command_request_id = request.state.request_id
    try:
        assert_account_types(editor, (AccountType.ADMIN, AccountType.ENGINEER))
        return transition_fact_version(
            db=db,
            fact_version_id=fact_version_id,
            expected_revision=payload.expected_revision,
            comment=payload.comment,
            actor=editor,
            request_id=command_request_id,
            action="submit",
        )
    except AppError as error:
        db.rollback()
        denied = error.code == "PERMISSION_DENIED"
        commit_audit(
            db,
            AuditEntry(
                actor_id=actor_id,
                business_module=AuditModule.PRODUCT_FACTS,
                action="fact_version.submit",
                target_type="FactVersion",
                target_id=fact_version_id,
                request_id=command_request_id,
                outcome=AuditOutcome.DENIED if denied else AuditOutcome.FAILED,
                result_message=("事实版本提交审核被拒绝" if denied else "事实版本提交审核未完成"),
                error_code=error.code,
            )
        )
        raise


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
