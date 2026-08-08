"""产品身份、规范化事实工作区与事实版本的应用服务。"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import delete, func, literal, select, union_all
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, in_use, not_found
from app.models.content import ContentTask, ContentVersion
from app.models.geo_files import GeoObservation
from app.models.identity import User
from app.models.product_facts import (
    FactReviewRecord,
    FactVersion,
    Product,
)
from app.schemas.product_facts import (
    FactReviewSubmissionRequest,
    ProductCreate,
    ProductFactsDraft,
    ProductFactsDraftUpdate,
    ProductFactStatus,
    ProductList,
    ProductListItem,
    ProductOut,
    ProductSort,
    ProductUpdate,
    ProductWorkflowStage,
)


def normalize_identity(value: str) -> str:
    """以大小写和常见分隔符无关的形式比较型号身份。"""
    return "".join(character for character in value.casefold().strip() if character.isalnum())


def products_out(
    db: Session,
    products: list[Product],
    *,
    can_delete: bool,
) -> list[ProductListItem]:
    """批量投影产品流程、事实摘要与无引用删除动作。"""
    if not products:
        return []
    product_ids = [product.id for product in products]
    direct_references = union_all(
        select(
            FactVersion.product_id.label("resource_id"),
            literal("FACT_VERSION").label("blocker_type"),
        ).where(FactVersion.product_id.in_(product_ids)),
        select(
            ContentTask.product_id.label("resource_id"),
            literal("CONTENT_TASK").label("blocker_type"),
        ).where(ContentTask.product_id.in_(product_ids)),
        select(
            GeoObservation.product_id.label("resource_id"),
            literal("GEO_OBSERVATION").label("blocker_type"),
        ).where(GeoObservation.product_id.in_(product_ids)),
    ).subquery()
    reference_counts = {
        (resource_id, blocker_type): int(count)
        for resource_id, blocker_type, count in db.execute(
            select(
                direct_references.c.resource_id,
                direct_references.c.blocker_type,
                func.count(),
            ).group_by(
                direct_references.c.resource_id,
                direct_references.c.blocker_type,
            )
        ).tuples()
    }
    versions = list(
        db.scalars(
            select(FactVersion)
            .where(FactVersion.product_id.in_(product_ids))
            .order_by(FactVersion.product_id, FactVersion.version.desc())
        )
    )
    latest_by_product: dict[uuid.UUID, FactVersion] = {}
    pending_by_product: dict[uuid.UUID, FactVersion] = {}
    for version in versions:
        latest_by_product.setdefault(version.product_id, version)
        if version.status == "PENDING_REVIEW":
            pending_by_product[version.product_id] = version
    review_activity = {
        product_id: reviewed_at
        for product_id, reviewed_at in db.execute(
            select(FactVersion.product_id, func.max(FactReviewRecord.created_at))
            .join(FactReviewRecord, FactReviewRecord.fact_version_id == FactVersion.id)
            .where(FactVersion.product_id.in_(product_ids))
            .group_by(FactVersion.product_id)
        ).tuples()
    }

    items: list[ProductListItem] = []
    for product in products:
        blockers = [
            {"type": blocker_type, "count": count}
            for blocker_type in ("FACT_VERSION", "CONTENT_TASK", "GEO_OBSERVATION")
            if (count := reference_counts.get((product.id, blocker_type), 0))
        ]
        actions = ["UPDATE"]
        if can_delete and not blockers:
            actions.append("DELETE")
        latest = latest_by_product.get(product.id)
        if product.status == "RETIRED":
            workflow_stage, primary_task = "RETIRED", "VIEW_FACT_HISTORY"
        elif not product.facts_body_markdown.strip():
            workflow_stage, primary_task = "FACTS_EMPTY", "ENTER_FACTS"
        elif product.id in pending_by_product:
            workflow_stage, primary_task = "FACT_REVIEW_PENDING", "REVIEW_FACT"
        elif latest is not None and (
            latest.body_markdown == product.facts_body_markdown
            and latest.classification == product.facts_classification
        ):
            if latest.status == "CHANGES_REQUESTED":
                workflow_stage, primary_task = "FACT_CHANGES_REQUESTED", "REVISE_FACT"
            elif latest.status == "APPROVED":
                workflow_stage, primary_task = "FACT_APPROVED", "CREATE_CONTENT_TASK"
            else:
                workflow_stage, primary_task = "FACTS_EDITING", "SUBMIT_FACT_REVIEW"
        else:
            workflow_stage, primary_task = "FACTS_EDITING", "SUBMIT_FACT_REVIEW"
        payload = {
            field: getattr(product, field)
            for field in ProductOut.model_fields
            if field
            not in {"available_actions", "deletion", "workflow_stage", "primary_task"}
        }
        payload["available_actions"] = actions
        payload["deletion"] = {"blockers": blockers} if can_delete else None
        payload["workflow_stage"] = workflow_stage
        payload["primary_task"] = primary_task
        payload["fact_status"] = latest.status if latest else "NOT_ENTERED"
        payload["current_fact"] = (
            {"version": latest.version, "status": latest.status} if latest else None
        )
        activity_times = [
            timestamp
            for timestamp in (
                product.updated_at,
                latest.created_at if latest else None,
                latest.approved_at if latest else None,
                review_activity.get(product.id),
            )
            if isinstance(timestamp, datetime)
        ]
        payload["updated_at"] = max(activity_times)
        items.append(ProductListItem.model_validate(payload))
    return items


def product_out(db: Session, product: Product, *, can_delete: bool) -> ProductOut:
    """投影单个产品及其当前动作。"""
    item = products_out(db, [product], can_delete=can_delete)[0]
    return ProductOut.model_validate(
        {field: getattr(item, field) for field in ProductOut.model_fields}
    )


def list_products(
    *,
    db: Session,
    can_delete: bool,
    page: int,
    page_size: int,
    search: str | None,
    sort: ProductSort,
    fact_status: ProductFactStatus | None,
    workflow_stage: ProductWorkflowStage | None,
) -> ProductList:
    """以单一批量投影完成产品列表筛选、排序和分页。"""
    query = select(Product)
    if search is not None and (term := search.strip()):
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.where(
            Product.part_number.ilike(pattern, escape="\\")
            | Product.brand.ilike(pattern, escape="\\")
        )
    projected = products_out(db, list(db.scalars(query)), can_delete=can_delete)
    if fact_status is not None:
        projected = [item for item in projected if item.fact_status == fact_status]
    if workflow_stage is not None:
        projected = [item for item in projected if item.workflow_stage == workflow_stage]

    # ponytail: 当前规模先复用唯一业务投影；产品量实测造成压力时再下推 SQL read projection。
    projected.sort(key=lambda item: str(item.id))
    if sort in {ProductSort.MODEL_ASC, ProductSort.MODEL_DESC}:
        projected.sort(
            key=lambda item: (item.part_number.casefold(), item.brand.casefold()),
            reverse=sort == ProductSort.MODEL_DESC,
        )
    else:
        projected.sort(
            key=lambda item: item.updated_at,
            reverse=sort == ProductSort.UPDATED_DESC,
        )
    total = len(projected)
    start = (page - 1) * page_size
    return ProductList(
        items=projected[start : start + page_size],
        page=page,
        page_size=page_size,
        total=total,
    )


def product_facts_draft_out(db: Session, product: Product) -> ProductFactsDraft:
    """投影事实工作区保存与原子提交审核动作。"""
    actions = ["SAVE"]
    has_pending = db.scalar(
        select(FactVersion.id).where(
            FactVersion.product_id == product.id,
            FactVersion.status == "PENDING_REVIEW",
        )
    )
    if product.status == "ACTIVE" and product.facts_body_markdown.strip() and has_pending is None:
        actions.append("SUBMIT_REVIEW")
    return ProductFactsDraft.model_validate(
        {
            "product_id": product.id,
            "body_markdown": product.facts_body_markdown,
            "classification": product.facts_classification,
            "revision": product.facts_revision,
            "available_actions": actions,
        }
    )


def create_product(*, db: Session, payload: ProductCreate, actor: User, request_id: str) -> Product:
    """创建公司产品，不推断任何产品参数。"""
    product = Product(
        part_number=payload.part_number.strip(),
        normalized_part_number=normalize_identity(payload.part_number),
        brand=payload.brand.strip(),
        normalized_brand=normalize_identity(payload.brand),
        category=payload.category.strip(),
    )
    db.add(product)
    db.flush()
    db.commit()
    return product


def update_product(
    *,
    db: Session,
    product_id: uuid.UUID,
    payload: ProductUpdate,
    actor: User,
    request_id: str,
) -> Product:
    """以 revision 更新产品，并保护已有批准事实的产品身份。"""
    product = db.scalar(select(Product).where(Product.id == product_id).with_for_update())
    if product is None:
        raise not_found("产品")
    if product.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "产品已被其他请求修改", 409)
    identity_changed = (
        product.part_number != payload.part_number.strip()
        or product.brand != payload.brand.strip()
        or product.category != payload.category.strip()
    )
    if identity_changed and db.scalar(
        select(FactVersion.id)
        .where(
            FactVersion.product_id == product.id,
            FactVersion.status.in_(["APPROVED", "RETIRED"]),
        )
        .limit(1)
    ):
        raise AppError(
            "IMMUTABLE_VERSION",
            "产品已有批准事实版本，型号、品牌和分类不能原地修改",
            409,
        )
    product.part_number = payload.part_number.strip()
    product.normalized_part_number = normalize_identity(payload.part_number)
    product.brand = payload.brand.strip()
    product.normalized_brand = normalize_identity(payload.brand)
    product.category = payload.category.strip()
    product.status = payload.status.value
    product.revision += 1
    db.commit()
    return product


def delete_product(
    *,
    db: Session,
    product_id: uuid.UUID,
    expected_revision: int,
    actor: User,
    request_id: str,
) -> None:
    """仅删除客户端当前读取且没有历史引用的产品。"""
    product = db.scalar(select(Product).where(Product.id == product_id).with_for_update())
    if product is None:
        raise not_found("产品")
    if product.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "产品已被其他请求修改", 409)
    references = [
        (
            "FACT_VERSION",
            "事实版本",
            int(
                db.scalar(
                    select(func.count())
                    .select_from(FactVersion)
                    .where(FactVersion.product_id == product.id)
                )
                or 0
            ),
        ),
        (
            "CONTENT_TASK",
            "内容任务",
            int(
                db.scalar(
                    select(func.count())
                    .select_from(ContentTask)
                    .where(ContentTask.product_id == product.id)
                )
                or 0
            ),
        ),
        (
            "GEO_OBSERVATION",
            "GEO 观测",
            int(
                db.scalar(
                    select(func.count())
                    .select_from(GeoObservation)
                    .where(GeoObservation.product_id == product.id)
                )
                or 0
            ),
        ),
    ]
    if any(count for _, _, count in references):
        raise in_use("PRODUCT_IN_USE", "产品", references)
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.PRODUCT_FACTS,
            action="product.deleted",
            target_type="Product",
            target_id=product.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="产品已删除",
            details={"facts": {"status": product.status}},
        ),
    )
    db.delete(product)
    db.commit()


def delete_fact_version(
    *, db: Session, fact_version_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """删除无内容引用的事实版本，并在同一事务清理其审核记录。"""
    version = db.scalar(
        select(FactVersion).where(FactVersion.id == fact_version_id).with_for_update()
    )
    if version is None:
        raise not_found("事实版本")
    references = [
        (
            "CONTENT_TASK",
            "内容任务",
            int(
                db.scalar(
                    select(func.count())
                    .select_from(ContentTask)
                    .where(ContentTask.fact_version_id == version.id)
                )
                or 0
            ),
        ),
        (
            "CONTENT_VERSION",
            "内容版本",
            int(
                db.scalar(
                    select(func.count())
                    .select_from(ContentVersion)
                    .where(ContentVersion.fact_version_id == version.id)
                )
                or 0
            ),
        ),
    ]
    if any(count for _, _, count in references):
        raise in_use("FACT_VERSION_IN_USE", "事实版本", references)
    review_record_count = int(
        db.scalar(
            select(func.count())
            .select_from(FactReviewRecord)
            .where(FactReviewRecord.fact_version_id == version.id)
        )
        or 0
    )
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.PRODUCT_FACTS,
            action="fact_version.deleted",
            target_type="FactVersion",
            target_id=version.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="事实版本已删除",
            details={
                "facts": {
                    "product_id": str(version.product_id),
                    "version": version.version,
                    "status": version.status,
                    "review_record_count": review_record_count,
                }
            },
        ),
    )
    # 专用触发器只在本事务内放行当前父版本的从属审核记录，提交或回滚后自动清除。
    db.scalar(select(func.set_config("partsignal.fact_version_delete_id", str(version.id), True)))
    db.execute(delete(FactReviewRecord).where(FactReviewRecord.fact_version_id == version.id))
    db.delete(version)
    db.commit()


def replace_product_facts(
    *,
    db: Session,
    product_id: uuid.UUID,
    payload: ProductFactsDraftUpdate,
    actor: User,
    request_id: str,
) -> ProductFactsDraft:
    """使用乐观锁原样保存产品的唯一 Markdown 事实工作区。"""
    product = db.scalar(select(Product).where(Product.id == product_id).with_for_update())
    if product is None:
        raise not_found("产品")
    if product.facts_revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "事实工作区已被其他请求修改", 409)
    if not payload.body_markdown.strip():
        raise AppError("VALIDATION_ERROR", "产品事实 Markdown 不能为空", 422)
    product.facts_body_markdown = payload.body_markdown
    product.facts_classification = payload.classification.value
    product.facts_revision += 1
    db.commit()
    return product_facts_draft_out(db, product)


def submit_fact_review(
    *,
    db: Session,
    product_id: uuid.UUID,
    payload: FactReviewSubmissionRequest,
    actor: User,
    request_id: str,
) -> FactVersion:
    """锁定事实工作区并直接创建一条待审核不可变快照。"""
    product = db.scalar(select(Product).where(Product.id == product_id).with_for_update())
    if product is None:
        raise not_found("产品")
    if product.status != "ACTIVE":
        raise AppError("INVALID_STATE_TRANSITION", "已停用产品不能提交新的事实审核", 409)
    if product.facts_revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "事实工作区已被其他请求修改", 409)
    if not product.facts_body_markdown.strip():
        raise AppError("VALIDATION_ERROR", "产品事实 Markdown 不能为空", 422)
    if db.scalar(
        select(FactVersion.id).where(
            FactVersion.product_id == product.id,
            FactVersion.status == "PENDING_REVIEW",
        )
    ) is not None:
        raise AppError("FACT_REVIEW_PENDING", "该产品已有待审核事实版本", 409)
    next_version = (
        int(
            db.scalar(
                select(func.coalesce(func.max(FactVersion.version), 0)).where(
                    FactVersion.product_id == product.id
                )
            )
            or 0
        )
        + 1
    )
    version = FactVersion(
        product_id=product.id,
        version=next_version,
        body_markdown=product.facts_body_markdown,
        classification=product.facts_classification,
        change_summary=payload.change_summary,
        status="PENDING_REVIEW",
        created_by=actor.id,
    )
    db.add(version)
    db.flush()
    db.add(
        FactReviewRecord(
            fact_version_id=version.id,
            action="submit-review",
            comment=payload.change_summary,
            actor_id=actor.id,
        )
    )
    db.commit()
    return version
