"""内容任务列表的权威筛选、分页与投影查询。"""

from __future__ import annotations

import uuid

from sqlalchemy import String, cast, func, literal, or_, select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.configuration import PlatformProfile
from app.models.content import ContentTask, ContentTaskGeoSource
from app.models.product_facts import FactVersion, Product
from app.schemas.content import (
    ContentTaskArchiveStatus,
    ContentTaskCreationFactOption,
    ContentTaskCreationOptions,
    ContentTaskCreationPlatformOption,
    ContentTaskCreationProductOption,
    ContentTaskList,
    ContentTaskQueryTopicReference,
    ContentTaskRequestedProduct,
    ContentTaskWorkflowStage,
)
from app.services.projections import content_task_workflow_projection, content_tasks_out


def get_content_task_creation_options(
    *, db: Session, requested_product_id: uuid.UUID | None
) -> ContentTaskCreationOptions:
    """批量返回新建任务的可选范围；写命令仍须持锁重新校验。"""
    rows = db.execute(
        select(Product, FactVersion)
        .join(FactVersion, FactVersion.product_id == Product.id)
        .where(
            Product.status == "ACTIVE",
            FactVersion.status == "APPROVED",
            func.btrim(FactVersion.body_markdown) != "",
        )
        .order_by(
            func.lower(Product.brand),
            func.lower(Product.part_number),
            Product.id,
            FactVersion.version.desc(),
            FactVersion.id,
        )
    ).all()
    grouped: dict[
        uuid.UUID, tuple[Product, list[ContentTaskCreationFactOption]]
    ] = {}
    for product, fact in rows:
        _, facts = grouped.setdefault(product.id, (product, []))
        facts.append(
            ContentTaskCreationFactOption(
                id=fact.id, version=fact.version, classification=fact.classification
            )
        )
    products = [
        ContentTaskCreationProductOption(
            id=product.id,
            brand=product.brand,
            part_number=product.part_number,
            approved_fact_versions=facts,
        )
        for product, facts in grouped.values()
    ]

    platforms = [
        ContentTaskCreationPlatformOption(id=profile.id, name=profile.name)
        for profile in db.scalars(
            select(PlatformProfile)
            .where(PlatformProfile.is_active.is_(True))
            .order_by(func.lower(PlatformProfile.name), PlatformProfile.id)
        )
    ]

    requested_product = None
    if requested_product_id is not None:
        eligible = grouped.get(requested_product_id)
        if eligible is not None:
            product, _ = eligible
            requested_product = ContentTaskRequestedProduct(
                product_id=requested_product_id,
                brand=product.brand,
                part_number=product.part_number,
                eligibility="ELIGIBLE",
            )
        else:
            product = db.get(Product, requested_product_id)
            requested_product = ContentTaskRequestedProduct(
                product_id=requested_product_id,
                brand=product.brand if product is not None else None,
                part_number=product.part_number if product is not None else None,
                eligibility=(
                    "NOT_FOUND"
                    if product is None
                    else "PRODUCT_INACTIVE"
                    if product.status != "ACTIVE"
                    else "NO_APPROVED_FACTS"
                ),
            )

    return ContentTaskCreationOptions(
        products=products,
        platforms=platforms,
        requested_product=requested_product,
    )


def list_content_tasks(
    *,
    db: Session,
    q: str | None,
    workflow_stage: ContentTaskWorkflowStage | None,
    platform_profile_id: uuid.UUID | None,
    filter_product_id: uuid.UUID | None,
    filter_fact_version_id: uuid.UUID | None,
    query_topic_id: uuid.UUID | None,
    query_topic_reference: ContentTaskQueryTopicReference | None,
    archive_status: ContentTaskArchiveStatus,
    page: int | None,
    page_size: int | None,
    can_permanently_delete: bool,
) -> ContentTaskList:
    """返回兼容全量模式或成对分页的内容任务列表。"""
    if (page is None) != (page_size is None):
        raise AppError("VALIDATION_ERROR", "page 与 page_size 必须同时提供或同时省略", 422)
    if (query_topic_id is None) != (query_topic_reference is None):
        raise AppError(
            "VALIDATION_ERROR",
            "query_topic_id 与 query_topic_reference 必须同时提供或同时省略",
            422,
        )

    projection = content_task_workflow_projection()
    query = (
        select(ContentTask)
        .join(projection, projection.c.task_id == ContentTask.id)
        .join(Product, Product.id == ContentTask.product_id)
        .outerjoin(PlatformProfile, PlatformProfile.id == ContentTask.platform_profile_id)
    )
    if q is not None and (term := q.strip()):
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        identifier = func.concat(
            literal("CT-"),
            func.upper(func.substr(cast(ContentTask.id, String), 1, 8)),
        )
        query = query.where(
            or_(
                identifier.ilike(pattern, escape="\\"),
                Product.brand.ilike(pattern, escape="\\"),
                Product.part_number.ilike(pattern, escape="\\"),
                func.coalesce(
                    PlatformProfile.name,
                    ContentTask.platform_profile_name_snapshot,
                ).ilike(pattern, escape="\\"),
            )
        )
    if workflow_stage is not None:
        query = query.where(projection.c.workflow_stage == workflow_stage)
    if platform_profile_id is not None:
        query = query.where(ContentTask.platform_profile_id == platform_profile_id)
    if filter_product_id is not None:
        query = query.where(ContentTask.product_id == filter_product_id)
    if filter_fact_version_id is not None:
        query = query.where(ContentTask.fact_version_id == filter_fact_version_id)
    if query_topic_id is not None:
        if query_topic_reference == ContentTaskQueryTopicReference.CONTENT_TASK:
            query = query.where(ContentTask.query_topic_id == query_topic_id)
        else:
            query = query.join(
                ContentTaskGeoSource,
                ContentTaskGeoSource.content_task_id == ContentTask.id,
            ).where(ContentTaskGeoSource.query_topic_id == query_topic_id)
    if archive_status == ContentTaskArchiveStatus.ACTIVE:
        query = query.where(ContentTask.archived_at.is_(None))
    elif archive_status == ContentTaskArchiveStatus.ARCHIVED:
        query = query.where(ContentTask.archived_at.is_not(None))

    total = int(db.scalar(select(func.count()).select_from(query.subquery())) or 0)
    query = query.order_by(projection.c.updated_at.desc(), ContentTask.id.desc())
    if page is None:
        tasks = list(db.scalars(query))
        response_page, response_page_size = 1, total
    else:
        assert page_size is not None
        tasks = list(db.scalars(query.offset((page - 1) * page_size).limit(page_size)))
        response_page, response_page_size = page, page_size
    return ContentTaskList(
        items=content_tasks_out(
            db,
            tasks,
            can_permanently_delete=can_permanently_delete,
        ),
        page=response_page,
        page_size=response_page_size,
        total=total,
    )
