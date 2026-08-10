"""内容任务列表的权威筛选、分页与投影查询。"""

from __future__ import annotations

import uuid

from sqlalchemy import String, cast, func, literal, or_, select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.configuration import PlatformProfile
from app.models.content import ContentTask
from app.models.product_facts import Product
from app.schemas.content import (
    ContentTaskArchiveStatus,
    ContentTaskList,
    ContentTaskWorkflowStage,
)
from app.services.projections import content_task_workflow_projection, content_tasks_out


def list_content_tasks(
    *,
    db: Session,
    q: str | None,
    workflow_stage: ContentTaskWorkflowStage | None,
    platform_profile_id: uuid.UUID | None,
    filter_product_id: uuid.UUID | None,
    filter_fact_version_id: uuid.UUID | None,
    archive_status: ContentTaskArchiveStatus,
    page: int | None,
    page_size: int | None,
    can_permanently_delete: bool,
) -> ContentTaskList:
    """返回兼容全量模式或成对分页的内容任务列表。"""
    if (page is None) != (page_size is None):
        raise AppError("VALIDATION_ERROR", "page 与 page_size 必须同时提供或同时省略", 422)

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
