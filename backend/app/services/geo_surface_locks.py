"""GEO 管理锁序：User → 稳定 UUID Channel → Model → Surface → Profile。"""

from collections.abc import Iterator
from contextlib import contextmanager
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import assert_account_types
from app.errors import AppError, not_found
from app.models.ai_generation import AIChannel, AIModel
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.models.identity import SessionRecord, User
from app.schemas.common import AccountType

type SequenceBindings = tuple[tuple[UUID | None, UUID | None], ...]


def revision_conflict() -> AppError:
    return AppError("REVISION_CONFLICT", "GEO 配置已被其他请求修改", 409)


def binding_invalid() -> AppError:
    return AppError(
        "GEO_MODEL_BINDING_INVALID",
        "模型必须属于指定的当前渠道",
        422,
        {
            "errors": [
                {
                    "loc": ["body", "ai_model_id"],
                    "msg": "模型必须属于指定的当前渠道",
                    "type": "geo_model_binding_invalid",
                }
            ]
        },
    )


@contextmanager
def command(db: Session, actor: User) -> Iterator[User]:
    """命令独占事务；舍弃认证 heartbeat，避免 Session→User 与改密锁环。"""
    db.autoflush = False
    for record in list(db.dirty):
        if isinstance(record, SessionRecord):
            db.expire(record, ["last_seen_at"])
    try:
        current = db.scalar(
            select(User)
            .where(User.id == actor.id)
            .with_for_update(key_share=True)
            .execution_options(populate_existing=True)
        )
        if current is None or not current.is_active:
            raise AppError("AUTH_REQUIRED", "账号已停用或不存在", 401)
        assert_account_types(current, (AccountType.ADMIN,))
        if current.must_change_password:
            raise AppError("PASSWORD_CHANGE_REQUIRED", "必须先修改临时密码", 403)
        yield current
    except Exception:
        db.rollback()
        raise


def lock_surface(
    db: Session,
    surface_id: UUID,
    expected_revision: int | None = None,
) -> GeoEngineSurface:
    surface = db.scalar(
        select(GeoEngineSurface)
        .where(GeoEngineSurface.id == surface_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if surface is None:
        raise not_found("GEO 观测面")
    if expected_revision is not None and surface.revision != expected_revision:
        raise revision_conflict()
    return surface


def lock_bindings(
    db: Session,
    bindings: SequenceBindings,
    *,
    no_key_update: bool = False,
) -> set[tuple[UUID, UUID]]:
    channels = {channel for channel, _ in bindings if channel is not None}
    models = {model for _, model in bindings if model is not None}
    if models:
        # 请求的 channel 不是归属权威；错误配对也必须先锁真实模型父渠道。
        channels.update(db.scalars(select(AIModel.channel_id).where(AIModel.id.in_(models))))
    current_channels = (
        set(
            db.scalars(
                select(AIChannel.id)
                .where(AIChannel.id.in_(channels))
                .order_by(AIChannel.id)
                .with_for_update(key_share=no_key_update)
            )
        )
        if channels
        else set()
    )
    current_models = (
        db.execute(
            select(AIModel.channel_id, AIModel.id)
            .where(AIModel.id.in_(models))
            .order_by(AIModel.id)
            .with_for_update(key_share=no_key_update)
        )
        .tuples()
        .all()
        if models
        else []
    )
    return {(channel, model) for channel, model in current_models if channel in current_channels}


def lock_profile(
    db: Session,
    profile_id: UUID,
    expected_revision: int,
    *,
    desired_binding: tuple[UUID | None, UUID | None] | None = None,
) -> GeoCollectionProfile:
    initial = db.execute(
        select(
            GeoCollectionProfile.engine_surface_id,
            GeoCollectionProfile.ai_channel_id,
            GeoCollectionProfile.ai_model_id,
        ).where(GeoCollectionProfile.id == profile_id)
    ).one_or_none()
    if initial is None:
        raise not_found("GEO 采集配置")
    surface_id, old_channel, old_model = initial
    old_binding = (old_channel, old_model)
    requested = desired_binding if desired_binding is not None else old_binding
    valid_bindings = lock_bindings(db, (old_binding, requested))
    lock_surface(db, surface_id)
    profile = db.scalar(
        select(GeoCollectionProfile)
        .where(GeoCollectionProfile.id == profile_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if profile is None:
        raise not_found("GEO 采集配置")
    if profile.revision != expected_revision or (
        profile.engine_surface_id,
        profile.ai_channel_id,
        profile.ai_model_id,
    ) != tuple(initial):
        raise revision_conflict()
    if requested != (None, None) and requested not in valid_bindings:
        raise binding_invalid()
    return profile
