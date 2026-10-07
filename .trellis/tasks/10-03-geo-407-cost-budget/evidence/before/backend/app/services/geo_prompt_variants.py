"""问题变体命令唯一拥有事务、历史门禁、revision 和成功审计。"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.deps import assert_account_types
from app.errors import AppError, not_found
from app.models.configuration import QueryTopic
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.identity import SessionRecord, User
from app.schemas.common import AccountType
from app.schemas.geo_prompt_variants import (
    GeoPromptVariantCreate,
    GeoPromptVariantOut,
    GeoPromptVariantUpdate,
)
from app.services.geo_prompt_variant_queries import plan_prompt_referenced, variant_out


@contextmanager
def _command(db: Session, actor: User) -> Iterator[User]:
    try:
        # 身份读取只提供锁ID；锁后重新加载，不能用过期权限或创建者资格。
        with db.no_autoflush:
            # last_seen_at 只作活动提示，不参与过期/撤销裁决。舍弃认证的
            # pending heartbeat，避免业务持有 User 后再请求同 Cookie 的 Session 写锁。
            for record in list(db.dirty):
                if isinstance(record, SessionRecord) and record.user_id == actor.id:
                    db.expire(record, ["last_seen_at"])
            current = db.scalar(
                select(User)
                .where(User.id == actor.id)
                # 阻止权限/停用/删除变更，同时兼容既有主题审计 FK 的 KEY SHARE。
                .with_for_update(key_share=True)
                .execution_options(populate_existing=True)
            )
            if current is None or not current.is_active:
                raise AppError("AUTH_REQUIRED", "账号已停用或不存在", 401)
            if current.must_change_password:
                raise AppError("PASSWORD_CHANGE_REQUIRED", "必须先修改临时密码", 403)
            assert_account_types(current, (AccountType.ADMIN, AccountType.ENGINEER))
            yield current
    except Exception:
        db.rollback()
        raise


def _lock_topic(db: Session, topic_id: UUID) -> QueryTopic:
    topic = db.scalar(
        select(QueryTopic)
        .where(QueryTopic.id == topic_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if topic is None:
        raise not_found("问题主题")
    return topic


def _lock_variant(
    db: Session, variant_id: UUID, expected_revision: int
) -> tuple[GeoPromptVariant, QueryTopic]:
    topic_id = db.scalar(
        select(GeoPromptVariant.query_topic_id).where(GeoPromptVariant.id == variant_id)
    )
    if topic_id is None:
        raise not_found("问题变体")
    topic = _lock_topic(db, topic_id)
    variant = db.scalar(
        select(GeoPromptVariant)
        .where(GeoPromptVariant.id == variant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if variant is None:
        raise not_found("问题变体")
    if variant.query_topic_id != topic.id or variant.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "问题变体已被其他请求修改", 409)
    return variant, topic


def _history_error(*, deleting: bool = False) -> AppError:
    return AppError(
        "GEO_PROMPT_VARIANT_IN_USE" if deleting else "GEO_PROMPT_VARIANT_IMMUTABLE",
        "已引用的问题变体只能停用；新语义请复制为新变体",
        409,
    )


def _flush(db: Session, *, deleting: bool = False) -> None:
    try:
        db.flush()
    except IntegrityError as error:
        pair = (
            getattr(error.orig, "sqlstate", None),
            getattr(
                getattr(error.orig, "diag", None),
                "constraint_name",
                None,
            ),
        )
        if pair == ("23505", "uq_geo_prompt_variants_identity"):
            mapped = AppError("GEO_PROMPT_VARIANT_EXISTS", "主题已有相同语义的问题变体", 409)
        elif pair == ("23514", "ck_geo_prompt_variants_history"):
            mapped = _history_error(deleting=deleting)
        elif deleting and pair == ("23503", "fk_geo_monitoring_plan_prompts_prompt"):
            mapped = AppError(
                "GEO_PROMPT_VARIANT_IN_USE", "问题变体仍被监测计划引用，不能删除", 409
            )
        else:
            raise
        db.rollback()
        raise mapped from error


def _audit(
    db: Session, variant: GeoPromptVariant, actor: User, request_id: str, action: str
) -> None:
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action=action,
            target_type="GeoPromptVariant",
            target_id=variant.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="GEO 问题变体配置已变更",
            details={"facts": {"revision": variant.revision, "is_active": variant.is_active}},
        ),
    )


def _changed(variant: GeoPromptVariant) -> None:
    variant.revision += 1
    variant.updated_at = max(datetime.now(UTC), variant.updated_at)


def _finish(
    db: Session,
    variant: GeoPromptVariant,
    topic: QueryTopic,
    actor: User,
    request_id: str,
    action: str | None,
) -> GeoPromptVariantOut:
    if action is not None:
        _audit(db, variant, actor, request_id, action)
    # 审计失败不能映射为业务唯一性错误；业务与审计同事务。
    db.flush()
    result = variant_out(variant, topic, plan_referenced=plan_prompt_referenced(db, variant.id))
    db.commit()
    return result


def create_variant(
    *,
    db: Session,
    query_topic_id: UUID,
    payload: GeoPromptVariantCreate,
    actor: User,
    request_id: str,
) -> GeoPromptVariantOut:
    with _command(db, actor) as current:
        if payload.query_topic_id != query_topic_id:
            raise AppError(
                "VALIDATION_ERROR",
                "请求主题与路径不一致",
                422,
                {
                    "errors": [
                        {
                            "loc": ["body", "query_topic_id"],
                            "msg": "请求主题与路径不一致",
                            "type": "value_error",
                        }
                    ]
                },
            )
        topic = _lock_topic(db, query_topic_id)
        variant = GeoPromptVariant(
            **payload.model_dump(), created_by=current.id, revision=0, is_active=True
        )
        db.add(variant)
        _flush(db)
        return _finish(db, variant, topic, current, request_id, "geo_prompt_variant.created")


def update_variant(
    *, db: Session, variant_id: UUID, payload: GeoPromptVariantUpdate, actor: User, request_id: str
) -> GeoPromptVariantOut:
    with _command(db, actor) as current:
        variant, topic = _lock_variant(db, variant_id, payload.expected_revision)
        if variant.first_referenced_at is not None:
            raise _history_error()
        changed = False
        for field, value in payload.model_dump(
            exclude_unset=True, exclude={"expected_revision"}
        ).items():
            if getattr(variant, field) != value:
                setattr(variant, field, value)
                changed = True
        if changed:
            _changed(variant)
            _flush(db)
        return _finish(
            db,
            variant,
            topic,
            current,
            request_id,
            "geo_prompt_variant.updated" if changed else None,
        )


def set_variant_active(
    *,
    db: Session,
    variant_id: UUID,
    expected_revision: int,
    is_active: bool,
    actor: User,
    request_id: str,
) -> GeoPromptVariantOut:
    with _command(db, actor) as current:
        variant, topic = _lock_variant(db, variant_id, expected_revision)
        if is_active and variant.first_referenced_at is not None:
            raise _history_error()
        changed = variant.is_active != is_active
        if changed:
            variant.is_active = is_active
            _changed(variant)
            _flush(db)
        action = "geo_prompt_variant.enabled" if is_active else "geo_prompt_variant.disabled"
        return _finish(db, variant, topic, current, request_id, action if changed else None)


def delete_variant(
    *, db: Session, variant_id: UUID, expected_revision: int, actor: User, request_id: str
) -> None:
    with _command(db, actor) as current:
        variant, _ = _lock_variant(db, variant_id, expected_revision)
        if variant.first_referenced_at is not None:
            raise _history_error(deleting=True)
        if plan_prompt_referenced(db, variant.id):
            raise AppError("GEO_PROMPT_VARIANT_IN_USE", "问题变体仍被监测计划引用，不能删除", 409)
        db.delete(variant)
        _flush(db, deleting=True)
        _audit(db, variant, current, request_id, "geo_prompt_variant.deleted")
        db.commit()
