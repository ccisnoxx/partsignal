"""Catalog 聚合锁序与锁后校验；身份初读仅用于选择锁集合。"""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.models.geo_catalog import GeoSubject
from app.models.product_facts import Product
from app.schemas.geo_catalog import GeoSubjectType
from app.services.geo_catalog_policy import require_subject_parent

BRAND_TYPES = ("OWN_BRAND", "COMPETITOR_BRAND")


@dataclass(frozen=True)
class LockedSubject:
    subject: GeoSubject
    product: Product | None
    parent: GeoSubject | None


def lock_product(db: Session, product_id: UUID | None) -> Product | None:
    if product_id is None:
        return None
    product = db.scalar(
        select(Product)
        .where(Product.id == product_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if product is None:
        raise not_found("产品")
    return product


def lock_brands(db: Session, ids: set[UUID]) -> dict[UUID, GeoSubject]:
    """只锁真实品牌；非法父级不能反向锁另一个产品聚合而形成锁环。"""
    return (
        {
            row.id: row
            for row in db.scalars(
                select(GeoSubject)
                .where(GeoSubject.id.in_(ids), GeoSubject.subject_type.in_(BRAND_TYPES))
                .order_by(GeoSubject.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        }
        if ids
        else {}
    )


def require_parent(
    db: Session,
    *,
    kind: str,
    subject_id: UUID | None,
    parent_id: UUID | None,
    brands: dict[UUID, GeoSubject],
) -> GeoSubject | None:
    parent = brands.get(parent_id) if parent_id else None
    if parent_id is not None and parent is None:
        parent = db.get(GeoSubject, parent_id, populate_existing=True)
        if parent is None:
            raise not_found("父级监测对象")
    require_subject_parent(
        GeoSubjectType(kind),
        subject_id=subject_id,
        parent_id=parent_id,
        parent_type=GeoSubjectType(parent.subject_type) if parent else None,
    )
    return parent


def lock_subject(
    db: Session,
    subject_id: UUID,
    expected_revision: int,
    *,
    replace_parent: bool = False,
    parent_id: UUID | None = None,
    expected_type: str | None = None,
) -> LockedSubject:
    identity = db.execute(
        select(
            GeoSubject.subject_type,
            GeoSubject.product_id,
            GeoSubject.parent_subject_id,
        ).where(GeoSubject.id == subject_id)
    ).one_or_none()
    if identity is None:
        raise not_found("监测对象")
    kind, product_id, old_parent_id = identity
    product = lock_product(db, product_id)
    desired_parent_id = parent_id if replace_parent else old_parent_id
    brand_ids = {value for value in (old_parent_id, desired_parent_id) if value is not None}
    if kind in BRAND_TYPES:
        brand_ids.add(subject_id)
    brands = lock_brands(db, brand_ids)
    subject = (
        brands.get(subject_id)
        if kind in BRAND_TYPES
        else db.scalar(
            select(GeoSubject)
            .where(GeoSubject.id == subject_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )
    if subject is None:
        raise not_found("监测对象")
    if subject.revision != expected_revision or (
        subject.subject_type,
        subject.product_id,
        subject.parent_subject_id,
    ) != tuple(identity):
        raise AppError("REVISION_CONFLICT", "监测对象已被其他请求修改", 409)
    if expected_type is not None and expected_type != subject.subject_type:
        raise AppError(
            "VALIDATION_ERROR",
            "监测对象类型不可修改",
            422,
            {
                "errors": [
                    {
                        "loc": ["body", "subject_type"],
                        "msg": "监测对象类型不可修改",
                        "type": "value_error",
                    }
                ]
            },
        )
    parent = require_parent(
        db,
        kind=kind,
        subject_id=subject_id,
        parent_id=desired_parent_id,
        brands=brands,
    )
    return LockedSubject(subject, product, parent)
