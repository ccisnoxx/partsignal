"""Slice 1B：产品资料数据手册附件管理服务。"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.articles import ProductMaterialAttachment
from app.models.geo_files import FileRecord
from app.models.identity import User
from app.models.product_facts import Product
from app.schemas.articles import (
    ProductMaterialAttachmentList,
    ProductMaterialAttachmentOut,
    ProductMaterialAttachRequest,
)
from app.schemas.common import AccountType
from app.services.current_actor import current_actor_command


def list_product_materials(db: Session, product_id: uuid.UUID) -> ProductMaterialAttachmentList:
    if db.get(Product, product_id) is None:
        raise not_found("产品")
    rows = db.execute(
        select(ProductMaterialAttachment, FileRecord)
        .join(FileRecord, FileRecord.id == ProductMaterialAttachment.file_id)
        .where(ProductMaterialAttachment.product_id == product_id)
        .order_by(ProductMaterialAttachment.created_at.desc())
    ).all()
    return ProductMaterialAttachmentList(
        items=[
            ProductMaterialAttachmentOut(
                product_id=att.product_id,
                file_id=att.file_id,
                display_label=att.display_label or file_rec.original_filename,
                original_filename=file_rec.original_filename,
                content_type=file_rec.content_type,
                size=file_rec.size,
                created_by=att.created_by,
                created_at=att.created_at,
            )
            for att, file_rec in rows
        ]
    )


def attach_product_material(
    db: Session,
    *,
    product_id: uuid.UUID,
    payload: ProductMaterialAttachRequest,
    actor: User,
    request_id: str,
) -> ProductMaterialAttachmentOut:
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN, AccountType.ENGINEER)) as cur:
        product = db.scalar(select(Product).where(Product.id == product_id).with_for_update())
        if product is None:
            raise not_found("产品")
        file_rec = db.get(FileRecord, payload.file_id)
        if file_rec is None:
            raise not_found("资料文件")
        if file_rec.status != "VERIFIED" or file_rec.category not in {
            "PRODUCT_DATASHEET",
            "EVIDENCE",
        }:
            raise AppError(
                "VALIDATION_ERROR",
                "仅已校验的 PRODUCT_DATASHEET 或 EVIDENCE 文件可关联为产品资料",
                422,
            )
        existing = db.get(ProductMaterialAttachment, (product.id, file_rec.id))
        if existing is not None:
            existing.display_label = payload.display_label or file_rec.original_filename
            att = existing
        else:
            att = ProductMaterialAttachment(
                product_id=product.id,
                file_id=file_rec.id,
                display_label=payload.display_label or file_rec.original_filename,
                created_by=cur.id,
            )
            db.add(att)
        db.flush()
        append_audit(
            db,
            AuditEntry(
                actor_id=cur.id,
                business_module=AuditModule.PRODUCT_FACTS,
                action="product_material.attached",
                target_type="Product",
                target_id=product.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已关联产品资料附件",
                details={"facts": {"file_id": str(file_rec.id)}},
            ),
        )
        db.commit()
        return ProductMaterialAttachmentOut(
            product_id=att.product_id,
            file_id=att.file_id,
            display_label=att.display_label,
            original_filename=file_rec.original_filename,
            content_type=file_rec.content_type,
            size=file_rec.size,
            created_by=att.created_by,
            created_at=att.created_at,
        )


def detach_product_material(
    db: Session,
    *,
    product_id: uuid.UUID,
    file_id: uuid.UUID,
    actor: User,
    request_id: str,
) -> None:
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN, AccountType.ENGINEER)) as cur:
        att = db.get(ProductMaterialAttachment, (product_id, file_id))
        if att is None:
            raise not_found("产品资料附件")
        db.delete(att)
        append_audit(
            db,
            AuditEntry(
                actor_id=cur.id,
                business_module=AuditModule.PRODUCT_FACTS,
                action="product_material.detached",
                target_type="Product",
                target_id=product_id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已移除产品资料附件",
                details={"facts": {"file_id": str(file_id)}},
            ),
        )
        db.commit()
