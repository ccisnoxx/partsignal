"""Catalog 写命令：统一维护聚合版本、锁、审计及精确数据库错误。"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.geo_catalog import GeoSubject, GeoSubjectAlias, GeoSubjectDomain
from app.models.identity import User
from app.schemas.common import AccountType
from app.schemas.geo_catalog import (
    GeoNamedSubjectCreate,
    GeoNamedSubjectUpdate,
    GeoSubjectAliasCreate,
    GeoSubjectAliasUpdate,
    GeoSubjectCreate,
    GeoSubjectDomainCreate,
    GeoSubjectOut,
    GeoSubjectUpdate,
)
from app.services.current_actor import current_actor_command, require_command_session
from app.services.geo_catalog_locks import lock_brands, lock_product, lock_subject, require_parent
from app.services.geo_catalog_normalization import catalog_text_key
from app.services.geo_catalog_queries import subject_references, subjects_out


def field_conflict(code: str, field: str, message: str) -> AppError:
    return AppError(
        code,
        message,
        409,
        {
            "errors": [
                {
                    "loc": ["body", field],
                    "msg": message,
                    "type": code.lower(),
                }
            ]
        },
    )


def product_conflict(subject: GeoSubject) -> AppError:
    error = field_conflict("GEO_SUBJECT_PRODUCT_EXISTS", "product_id", "产品已有活动监测身份")
    error.details["product_id"] = str(subject.product_id)
    if subject.id is not None:
        error.details["subject_id"] = str(subject.id)
    return error


def _diagnostics(error: IntegrityError) -> tuple[object, object]:
    original = error.orig
    return getattr(original, "sqlstate", None), getattr(
        getattr(original, "diag", None),
        "constraint_name",
        None,
    )


def _flush_subject(db: Session, subject: GeoSubject, *, deleting: bool = False) -> None:
    # failed flush 会过期已有 ORM 行；异常分类只能使用 flush 前保存的身份事实。
    own_product_conflict = (
        product_conflict(subject) if not deleting and subject.product_id is not None else None
    )
    try:
        db.flush()
    except IntegrityError as error:
        pair = _diagnostics(error)
        mapped: AppError | None = None
        if deleting:
            if pair in {
                ("23503", "fk_geo_subjects_parent_identity"),
                ("23503", "fk_geo_monitoring_plan_subjects_subject"),
                ("23503", "fk_geo_batch_subjects_subject"),
            }:
                mapped = AppError("GEO_SUBJECT_IN_USE", "监测对象仍有直接引用，不能删除", 409)
        elif pair == ("23505", "uq_geo_subjects_active_own_product"):
            mapped = own_product_conflict
        elif pair in {
            ("23514", "ck_geo_subjects_parent_type"),
            ("23514", "ck_geo_subjects_parent_not_self"),
        }:
            mapped = field_conflict(
                "GEO_SUBJECT_PARENT_INVALID",
                "parent_subject_id",
                "监测对象的父级类型不合法或指向自身",
            )
        if mapped is None:
            raise
        db.rollback()
        raise mapped from error


def _flush_alias(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError as error:
        if _diagnostics(error) != ("23505", "uq_geo_subject_aliases_subject_normalized"):
            raise
        db.rollback()
        raise field_conflict(
            "GEO_SUBJECT_ALIAS_EXISTS", "alias", "监测对象已有相同规范化别名"
        ) from error


def _flush_domain(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError as error:
        if _diagnostics(error) != ("23505", "uq_geo_subject_domains_subject_hostname"):
            raise
        db.rollback()
        raise field_conflict(
            "GEO_SUBJECT_DOMAIN_EXISTS", "hostname", "监测对象已有相同域名"
        ) from error


def _audit(
    db: Session,
    subject: GeoSubject,
    actor: User,
    request_id: str,
    action: str,
) -> None:
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action=action,
            target_type="GeoSubject",
            target_id=subject.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="GEO 监测对象配置已变更",
            details={"facts": {"revision": subject.revision, "is_active": subject.is_active}},
        ),
    )


def _changed(subject: GeoSubject) -> None:
    subject.revision += 1
    subject.updated_at = datetime.now(UTC)


def _finish(
    db: Session,
    subject: GeoSubject,
    actor: User,
    request_id: str,
    action: str | None,
) -> GeoSubjectOut:
    if action is not None:
        _audit(db, subject, actor, request_id, action)
    # 审计 flush 与 commit 保持 unknown，不能冒充业务唯一性冲突。
    db.flush()
    result = subjects_out(db, [subject], actor_type=AccountType(actor.account_type))[0]
    require_command_session(db, actor.id)
    db.commit()
    return result


def _require_product_available(db: Session, subject: GeoSubject) -> None:
    if (
        subject.product_id is not None
        and db.scalar(
            select(GeoSubject.id).where(
                GeoSubject.product_id == subject.product_id,
                GeoSubject.is_active,
                GeoSubject.id != subject.id,
            )
        )
        is not None
    ):
        raise product_conflict(subject)


def create_subject(
    *,
    db: Session,
    payload: GeoSubjectCreate,
    actor: User,
    request_id: str,
) -> GeoSubjectOut:
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current:
        product_id = payload.product_id if not isinstance(payload, GeoNamedSubjectCreate) else None
        lock_product(db, product_id)
        brands = lock_brands(
            db, {payload.parent_subject_id} if payload.parent_subject_id else set()
        )
        parent = require_parent(
            db,
            kind=payload.subject_type,
            subject_id=None,
            parent_id=payload.parent_subject_id,
            brands=brands,
        )
        subject = GeoSubject(
            subject_type=payload.subject_type,
            product_id=product_id,
            parent_subject_id=parent.id if parent else None,
            parent_subject_type=parent.subject_type if parent else None,
            canonical_name=payload.canonical_name
            if isinstance(payload, GeoNamedSubjectCreate)
            else None,
            normalized_name=catalog_text_key(payload.canonical_name)
            if isinstance(payload, GeoNamedSubjectCreate)
            else None,
            display_name=payload.display_name
            if isinstance(payload, GeoNamedSubjectCreate)
            else None,
            description=payload.description,
            created_by=current.id,
            is_active=True,
            revision=0,
        )
        _require_product_available(db, subject)
        db.add(subject)
        _flush_subject(db, subject)
        return _finish(db, subject, current, request_id, "geo_subject.created")


def update_subject(
    *,
    db: Session,
    subject_id: UUID,
    payload: GeoSubjectUpdate,
    actor: User,
    request_id: str,
) -> GeoSubjectOut:
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current:
        locked = lock_subject(
            db,
            subject_id,
            payload.expected_revision,
            replace_parent="parent_subject_id" in payload.model_fields_set,
            parent_id=payload.parent_subject_id,
            expected_type=payload.subject_type,
        )
        subject = locked.subject
        changed = False
        for field in payload.model_fields_set - {"subject_type", "expected_revision"}:
            value = getattr(payload, field)
            if getattr(subject, field) != value:
                setattr(subject, field, value)
                changed = True
        if "parent_subject_id" in payload.model_fields_set:
            subject.parent_subject_type = locked.parent.subject_type if locked.parent else None
        if (
            isinstance(payload, GeoNamedSubjectUpdate)
            and "canonical_name" in payload.model_fields_set
        ):
            subject.normalized_name = catalog_text_key(payload.canonical_name)
        if changed:
            _changed(subject)
            _flush_subject(db, subject)
        return _finish(db, subject, current, request_id, "geo_subject.updated" if changed else None)


def set_subject_active(
    *,
    db: Session,
    subject_id: UUID,
    expected_revision: int,
    is_active: bool,
    actor: User,
    request_id: str,
) -> GeoSubjectOut:
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current:
        subject = lock_subject(db, subject_id, expected_revision).subject
        changed = subject.is_active != is_active
        if changed:
            if is_active:
                _require_product_available(db, subject)
            subject.is_active = is_active
            _changed(subject)
            _flush_subject(db, subject)
        action = "geo_subject.enabled" if is_active else "geo_subject.disabled"
        return _finish(db, subject, current, request_id, action if changed else None)


def delete_subject(
    *,
    db: Session,
    subject_id: UUID,
    expected_revision: int,
    actor: User,
    request_id: str,
) -> None:
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current:
        subject = lock_subject(db, subject_id, expected_revision).subject
        blockers = subject_references(db, [subject.id])[subject.id].blockers()
        if blockers:
            raise AppError(
                "GEO_SUBJECT_IN_USE",
                "监测对象仍有直接引用，不能删除",
                409,
                {
                    "references": [
                        {"type": kind.value, "count": count} for kind, count in blockers
                    ],
                },
            )
        db.delete(subject)
        _flush_subject(db, subject, deleting=True)
        _audit(db, subject, current, request_id, "geo_subject.deleted")
        db.flush()
        require_command_session(db, current.id)
        db.commit()


def create_alias(
    *,
    db: Session,
    subject_id: UUID,
    payload: GeoSubjectAliasCreate,
    actor: User,
    request_id: str,
) -> GeoSubjectOut:
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current:
        subject = lock_subject(db, subject_id, payload.expected_revision).subject
        db.add(
            GeoSubjectAlias(
                subject_id=subject.id,
                alias=payload.alias,
                normalized_alias=catalog_text_key(payload.alias),
                alias_kind=payload.alias_kind,
                language_code=payload.language_code,
                is_active=payload.is_active,
            )
        )
        _changed(subject)
        _flush_alias(db)
        return _finish(db, subject, current, request_id, "geo_subject_alias.created")


def update_alias(
    *,
    db: Session,
    subject_id: UUID,
    alias_id: UUID,
    payload: GeoSubjectAliasUpdate,
    actor: User,
    request_id: str,
) -> GeoSubjectOut:
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current:
        subject = lock_subject(db, subject_id, payload.expected_revision).subject
        alias = db.scalar(
            select(GeoSubjectAlias)
            .where(
                GeoSubjectAlias.id == alias_id,
                GeoSubjectAlias.subject_id == subject_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if alias is None:
            raise not_found("别名")
        changed = False
        for field in payload.model_fields_set - {"expected_revision"}:
            value = getattr(payload, field)
            if getattr(alias, field) != value:
                setattr(alias, field, value)
                changed = True
        if "alias" in payload.model_fields_set:
            alias.normalized_alias = catalog_text_key(payload.alias)
        if changed:
            _changed(subject)
            _flush_alias(db)
        return _finish(
            db, subject, current, request_id, "geo_subject_alias.updated" if changed else None
        )


def delete_alias(
    *,
    db: Session,
    subject_id: UUID,
    alias_id: UUID,
    expected_revision: int,
    actor: User,
    request_id: str,
) -> GeoSubjectOut:
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current:
        subject = lock_subject(db, subject_id, expected_revision).subject
        alias = db.scalar(
            select(GeoSubjectAlias)
            .where(
                GeoSubjectAlias.id == alias_id,
                GeoSubjectAlias.subject_id == subject_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if alias is None:
            raise not_found("别名")
        db.delete(alias)
        _changed(subject)
        db.flush()
        return _finish(db, subject, current, request_id, "geo_subject_alias.deleted")


def create_domain(
    *,
    db: Session,
    subject_id: UUID,
    payload: GeoSubjectDomainCreate,
    actor: User,
    request_id: str,
) -> GeoSubjectOut:
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current:
        subject = lock_subject(db, subject_id, payload.expected_revision).subject
        db.add(
            GeoSubjectDomain(
                subject_id=subject.id,
                hostname=payload.hostname,
                relation_type=payload.relation_type,
            )
        )
        _changed(subject)
        _flush_domain(db)
        return _finish(db, subject, current, request_id, "geo_subject_domain.created")


def delete_domain(
    *,
    db: Session,
    subject_id: UUID,
    domain_id: UUID,
    expected_revision: int,
    actor: User,
    request_id: str,
) -> GeoSubjectOut:
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current:
        subject = lock_subject(db, subject_id, expected_revision).subject
        domain = db.scalar(
            select(GeoSubjectDomain)
            .where(
                GeoSubjectDomain.id == domain_id,
                GeoSubjectDomain.subject_id == subject_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if domain is None:
            raise not_found("域名")
        db.delete(domain)
        _changed(subject)
        db.flush()
        return _finish(db, subject, current, request_id, "geo_subject_domain.deleted")
