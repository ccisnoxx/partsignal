"""GEO 配置管理命令，拥有 revision、当前绑定、权限与成功审计的原子事务。"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.collectors import registry as collectors
from app.collectors.registry import CollectionProfileSnapshot, UnknownCollectorAdapter
from app.config import settings
from app.errors import AppError
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.models.identity import User
from app.schemas.common import AccountType
from app.schemas.geo_surface_management import GeoCollectionProfileRead, GeoEngineSurfaceRead
from app.schemas.geo_surfaces import (
    GeoCollectionMode,
    GeoCollectionProfileCreate,
    GeoCollectionProfileUpdate,
    GeoEngineSurfaceCreate,
    GeoEngineSurfaceUpdate,
    GeoProfileLoginState,
    GeoProfileTestStatus,
    GeoWebSearchPolicy,
)
from app.services.geo_collection_profiles import load_profile_facts
from app.services.geo_surface_locks import (
    binding_invalid,
    command,
    lock_bindings,
    lock_profile,
    lock_surface,
)
from app.services.geo_surface_projections import surface_deletion
from app.services.geo_surface_queries import (
    profile_plan_counts,
    profile_run_counts,
    profiles_read,
    surface_profile_counts,
    surfaces_read,
)


def _field_error(code: str, field: str, message: str, status: int = 409) -> AppError:
    return AppError(
        code,
        message,
        status,
        {"errors": [{"loc": ["body", field], "msg": message, "type": code.lower()}]},
    )


def _surface_in_use() -> AppError:
    return AppError("GEO_SURFACE_IN_USE", "GEO 观测面仍有配置或历史引用，不能删除", 409)


def _flush_business(
    db: Session, *, deleting_surface: bool = False, deleting_profile: bool = False
) -> None:
    try:
        db.flush()
    except IntegrityError as error:
        pair = (
            getattr(error.orig, "sqlstate", None),
            getattr(getattr(error.orig, "diag", None), "constraint_name", None),
        )
        mapped: AppError | None = None
        if pair == ("23505", "uq_geo_engine_surfaces_slug"):
            mapped = _field_error("GEO_SURFACE_SLUG_EXISTS", "slug", "观测面标识已存在")
        elif pair == ("23505", "uq_geo_collection_profiles_surface_name"):
            mapped = _field_error("GEO_PROFILE_NAME_EXISTS", "name", "此观测面下的配置名称已存在")
        elif pair == ("23503", "fk_geo_collection_profiles_model_channel"):
            mapped = binding_invalid()
        elif deleting_surface and pair in {
            ("23503", "fk_geo_collection_profiles_surface"),
            ("23514", "ck_geo_engine_surfaces_history"),
        }:
            mapped = _surface_in_use()
        if deleting_profile and pair in {
            ("23503", "fk_geo_monitoring_plan_profiles_profile"),
            ("23503", "fk_geo_runs_profile"),
        }:
            mapped = AppError("GEO_PROFILE_IN_USE", "采集配置仍被监测计划引用，不能删除", 409)
        if mapped is None:
            raise
        db.rollback()
        raise mapped from error


def _audit(
    db: Session,
    resource: GeoEngineSurface | GeoCollectionProfile,
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
            target_type="GeoEngineSurface"
            if isinstance(resource, GeoEngineSurface)
            else "GeoCollectionProfile",
            target_id=resource.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="GEO 观测配置已变更",
            details={"facts": {"revision": resource.revision, "is_active": resource.is_active}},
        ),
    )


def _changed(resource: GeoEngineSurface | GeoCollectionProfile) -> None:
    resource.revision += 1
    resource.updated_at = max(datetime.now(UTC), resource.updated_at)


def _finish_surface(
    db: Session,
    surface: GeoEngineSurface,
    actor: User,
    request_id: str,
    action: str | None,
) -> GeoEngineSurfaceRead:
    if action is not None:
        _audit(db, surface, actor, request_id, action)
    # 审计 flush/commit 与业务约束分类分离，未知失败整体回滚。
    db.flush()
    result = surfaces_read(db, [surface], actor_type=AccountType.ADMIN)[0]
    db.commit()
    return result


def _finish_profile(
    db: Session,
    profile: GeoCollectionProfile,
    actor: User,
    request_id: str,
    action: str | None,
) -> GeoCollectionProfileRead:
    if action is not None:
        _audit(db, profile, actor, request_id, action)
    db.flush()
    result = profiles_read(db, [profile], actor_type=AccountType.ADMIN)[0]
    db.commit()
    return result


def create_surface(
    *,
    db: Session,
    payload: GeoEngineSurfaceCreate,
    actor: User,
    request_id: str,
) -> GeoEngineSurfaceRead:
    with command(db, actor) as current:
        surface = GeoEngineSurface(
            **payload.model_dump(), created_by=current.id, is_active=False, revision=0
        )
        db.add(surface)
        _flush_business(db)
        return _finish_surface(db, surface, current, request_id, "geo_engine_surface.created")


def update_surface(
    *,
    db: Session,
    surface_id: UUID,
    payload: GeoEngineSurfaceUpdate,
    actor: User,
    request_id: str,
) -> GeoEngineSurfaceRead:
    with command(db, actor) as current:
        surface = lock_surface(db, surface_id, payload.expected_revision)
        changed = False
        for field, value in payload.model_dump(exclude={"expected_revision"}).items():
            if getattr(surface, field) != value:
                setattr(surface, field, value)
                changed = True
        if changed:
            _changed(surface)
            _flush_business(db)
        return _finish_surface(
            db, surface, current, request_id, "geo_engine_surface.updated" if changed else None
        )


def set_surface_active(
    *,
    db: Session,
    surface_id: UUID,
    expected_revision: int,
    is_active: bool,
    actor: User,
    request_id: str,
) -> GeoEngineSurfaceRead:
    with command(db, actor) as current:
        surface = lock_surface(db, surface_id, expected_revision)
        changed = surface.is_active != is_active
        if changed:
            # 观测面启用只改变配置，不启动采集；门禁在 Profile 的资格 owner 维护。
            surface.is_active = is_active
            _changed(surface)
            _flush_business(db)
        action = "geo_engine_surface.enabled" if is_active else "geo_engine_surface.disabled"
        return _finish_surface(db, surface, current, request_id, action if changed else None)


def delete_surface(
    *,
    db: Session,
    surface_id: UUID,
    expected_revision: int,
    actor: User,
    request_id: str,
) -> None:
    with command(db, actor) as current:
        surface = lock_surface(db, surface_id, expected_revision)
        counts = surface_profile_counts(db, [surface.id])
        blockers = surface_deletion(surface, counts.get(surface.id, 0))
        if blockers:
            error = _surface_in_use()
            error.details = {"references": [item.model_dump(mode="json") for item in blockers]}
            raise error
        db.delete(surface)
        _flush_business(db, deleting_surface=True)
        _audit(db, surface, current, request_id, "geo_engine_surface.deleted")
        db.flush()
        db.commit()


def _configuration_snapshot(
    payload: GeoCollectionProfileCreate | GeoCollectionProfileUpdate,
    *,
    profile_id: UUID,
    surface_id: UUID,
) -> CollectionProfileSnapshot:
    return CollectionProfileSnapshot(
        id=profile_id,
        engine_surface_id=surface_id,
        revision=0,
        name=payload.name,
        collection_mode=GeoCollectionMode(payload.collection_mode),
        adapter_key=payload.adapter_key,
        ai_channel_id=payload.ai_channel_id,
        ai_model_id=payload.ai_model_id,
        language_code=payload.language_code,
        region_code=payload.region_code,
        login_state=GeoProfileLoginState(payload.login_state),
        web_search_policy=GeoWebSearchPolicy(payload.web_search_policy),
        settings=tuple(sorted(payload.settings.model_dump().items())),
        is_active=False,
        last_test_status=GeoProfileTestStatus.UNTESTED,
        last_tested_at=None,
    )


def _validate_configuration(snapshot: CollectionProfileSnapshot) -> None:
    try:
        adapter = collectors.collector_registry.resolve(snapshot.adapter_key)
    except UnknownCollectorAdapter as error:
        raise _field_error("GEO_ADAPTER_UNKNOWN", "adapter_key", "采集适配器未登记", 422) from error
    blockers = adapter.validate_profile(snapshot)
    if blockers:
        raise AppError(
            "GEO_PROFILE_CONFIGURATION_INVALID",
            "采集配置不受此适配器支持",
            422,
            {"blockers": [{"code": item.code.value, "field": item.field} for item in blockers]},
        )


def create_profile(
    *,
    db: Session,
    payload: GeoCollectionProfileCreate,
    actor: User,
    request_id: str,
) -> GeoCollectionProfileRead:
    with command(db, actor) as current:
        profile_id = uuid4()
        _validate_configuration(
            _configuration_snapshot(
                payload,
                profile_id=profile_id,
                surface_id=payload.engine_surface_id,
            )
        )
        binding = (payload.ai_channel_id, payload.ai_model_id)
        valid_bindings = lock_bindings(db, (binding,))
        lock_surface(db, payload.engine_surface_id)
        if binding != (None, None) and binding not in valid_bindings:
            raise binding_invalid()
        values = payload.model_dump(exclude={"settings"})
        profile = GeoCollectionProfile(
            **values,
            id=profile_id,
            settings_json=payload.settings.model_dump(),
            created_by=current.id,
            is_active=False,
            revision=0,
            last_test_status="UNTESTED",
            last_tested_at=None,
        )
        db.add(profile)
        _flush_business(db)
        return _finish_profile(db, profile, current, request_id, "geo_collection_profile.created")


def update_profile(
    *,
    db: Session,
    profile_id: UUID,
    payload: GeoCollectionProfileUpdate,
    actor: User,
    request_id: str,
) -> GeoCollectionProfileRead:
    with command(db, actor) as current:
        profile = lock_profile(
            db,
            profile_id,
            payload.expected_revision,
            desired_binding=(payload.ai_channel_id, payload.ai_model_id),
        )
        if profile.collection_mode != payload.collection_mode:
            raise _field_error("VALIDATION_ERROR", "collection_mode", "采集模式创建后不可修改", 422)
        _validate_configuration(
            _configuration_snapshot(
                payload,
                profile_id=profile.id,
                surface_id=profile.engine_surface_id,
            )
        )
        changed = False
        values = payload.model_dump(exclude={"expected_revision", "collection_mode", "settings"})
        values["settings_json"] = payload.settings.model_dump()
        for field, value in values.items():
            if getattr(profile, field) != value:
                setattr(profile, field, value)
                changed = True
        if changed:
            # 管理更新不能创建测试事实，任何真实配置变化都失效旧测试并停用。
            profile.last_test_status = "UNTESTED"
            profile.last_tested_at = None
            profile.last_test_error_code = None
            profile.last_test_error_summary = None
            profile.test_attempt_id = None
            profile.is_active = False
            _changed(profile)
            _flush_business(db)
        return _finish_profile(
            db, profile, current, request_id, "geo_collection_profile.updated" if changed else None
        )


def set_profile_active(
    *,
    db: Session,
    profile_id: UUID,
    expected_revision: int,
    is_active: bool,
    actor: User,
    request_id: str,
) -> GeoCollectionProfileRead:
    with command(db, actor) as current:
        profile = lock_profile(db, profile_id, expected_revision)
        if is_active:
            facts = load_profile_facts(db, [profile.id])[profile.id]
            eligibility = facts.eligibility(
                registry=collectors.collector_registry,
                configuration=settings,
                assume_active=True,
            )
            if not eligibility.eligible:
                raise AppError(
                    "GEO_PROFILE_INELIGIBLE",
                    "采集配置当前无法启用",
                    409,
                    {
                        "blockers": [
                            {"code": item.code.value, "field": item.field}
                            for item in eligibility.blockers
                        ]
                    },
                )
        changed = profile.is_active != is_active
        if changed:
            profile.is_active = is_active
            _changed(profile)
            _flush_business(db)
        action = (
            "geo_collection_profile.enabled" if is_active else "geo_collection_profile.disabled"
        )
        return _finish_profile(db, profile, current, request_id, action if changed else None)


def delete_profile(
    *,
    db: Session,
    profile_id: UUID,
    expected_revision: int,
    actor: User,
    request_id: str,
) -> None:
    with command(db, actor) as current:
        profile = lock_profile(db, profile_id, expected_revision)
        count = profile_plan_counts(db, [profile.id]).get(profile.id, 0)
        if count:
            raise AppError(
                "GEO_PROFILE_IN_USE",
                "采集配置仍被监测计划引用，不能删除",
                409,
                {"blockers": [{"type": "MONITORING_PLAN", "count": count}]},
            )
        runs = profile_run_counts(db, [profile.id]).get(profile.id, 0)
        if runs:
            raise AppError(
                "GEO_PROFILE_IN_USE",
                "采集配置仍有运行历史，不能删除",
                409,
                {"blockers": [{"type": "HISTORICAL_REFERENCE", "count": runs}]},
            )
        db.delete(profile)
        _flush_business(db, deleting_profile=True)
        _audit(db, profile, current, request_id, "geo_collection_profile.deleted")
        db.flush()
        db.commit()
