"""从同一快照的当前事实投影角色摘要、配置、动作与阻断，无查询或写入。"""

from pydantic import TypeAdapter

from app.collectors import registry as collectors
from app.config import settings
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.schemas.common import AccountType
from app.schemas.geo_surface_management import (
    GeoCollectionProfileRead,
    GeoCollectionProfileSummary,
    GeoConfigurationDeletionProjection,
    GeoEngineSurfaceRead,
    GeoEngineSurfaceSummary,
    GeoProfileActivationBlocker,
    GeoProfileTestError,
)
from app.schemas.geo_surface_management import (
    GeoConfigurationAction as Action,
)
from app.schemas.geo_surface_management import (
    GeoConfigurationDeletionBlocker as DeletionBlocker,
)
from app.schemas.geo_surface_management import (
    GeoConfigurationDeletionBlockerType as DeletionType,
)
from app.schemas.geo_surface_management import (
    GeoConfigurationPrimaryTask as Task,
)
from app.schemas.geo_surface_management import (
    GeoConfigurationWorkflowStage as Stage,
)
from app.schemas.geo_surfaces import GeoCollectionProfileOut, GeoEngineSurfaceOut
from app.services.geo_collection_profiles import ProfileFacts

_PROFILE_OUT: TypeAdapter[GeoCollectionProfileOut] = TypeAdapter(GeoCollectionProfileOut)


def surface_summary(surface: GeoEngineSurface) -> GeoEngineSurfaceSummary:
    return GeoEngineSurfaceSummary.model_validate(
        {
            "id": surface.id,
            "name": surface.name,
            "slug": surface.slug,
            "surface_kind": surface.surface_kind,
            "provider_brand": surface.provider_brand,
            "compliance_status": surface.compliance_status,
            "capabilities": surface.capabilities,
            "is_active": surface.is_active,
            "revision": surface.revision,
            "created_at": surface.created_at,
            "updated_at": surface.updated_at,
        }
    )


def surface_deletion(surface: GeoEngineSurface, profile_count: int) -> list[DeletionBlocker]:
    blockers = []
    if profile_count:
        blockers.append(DeletionBlocker(type=DeletionType.COLLECTION_PROFILE, count=profile_count))
    if surface.first_referenced_at is not None:
        # count=1 表示不可逆锁存标记存在，不声称已接入未来 Run 历史总数。
        blockers.append(DeletionBlocker(type=DeletionType.HISTORICAL_REFERENCE, count=1))
    return blockers


def surface_read(
    surface: GeoEngineSurface, *, actor_type: AccountType, profile_count: int
) -> GeoEngineSurfaceRead:
    stage = Stage.ACTIVE if surface.is_active else Stage.DISABLED
    if actor_type == AccountType.ENGINEER:
        return GeoEngineSurfaceRead(
            summary=surface_summary(surface),
            configuration=None,
            workflow_stage=stage,
            primary_task=Task.VIEW_SUMMARY,
            available_actions=[],
            deletion=None,
        )
    blockers = surface_deletion(surface, profile_count)
    actions = [Action.UPDATE, Action.DISABLE if surface.is_active else Action.ENABLE]
    if not blockers:
        actions.append(Action.DELETE)
    return GeoEngineSurfaceRead(
        summary=surface_summary(surface),
        configuration=GeoEngineSurfaceOut.model_validate(surface),
        workflow_stage=stage,
        primary_task=Task.MANAGE_SURFACE if surface.is_active else Task.ENABLE_SURFACE,
        available_actions=actions,
        deletion=GeoConfigurationDeletionProjection(blockers=blockers),
    )


def profile_read(
    profile: GeoCollectionProfile,
    surface: GeoEngineSurface,
    facts: ProfileFacts,
    *,
    actor_type: AccountType,
    plan_count: int = 0,
    run_count: int = 0,
    session_count: int = 0,
) -> GeoCollectionProfileRead:
    if profile.id != facts.profile.id or profile.engine_surface_id != surface.id:
        raise ValueError("采集配置投影必须使用同一当前归属与快照")
    eligibility = facts.eligibility(
        registry=collectors.collector_registry,
        configuration=settings,
        assume_active=True,
    )
    blockers = [
        GeoProfileActivationBlocker(code=item.code, field=item.field)
        for item in eligibility.blockers
    ]
    stage = Stage.BLOCKED if blockers else Stage.ACTIVE if profile.is_active else Stage.DISABLED
    summary = GeoCollectionProfileSummary.model_validate(
        {
            "id": profile.id,
            "name": profile.name,
            "engine_surface_id": profile.engine_surface_id,
            "engine_surface": surface_summary(surface),
            "collection_mode": profile.collection_mode,
            "language_code": profile.language_code,
            "region_code": profile.region_code,
            "login_state": profile.login_state,
            "web_search_policy": profile.web_search_policy,
            "is_active": profile.is_active,
            "last_test_status": profile.last_test_status,
            "last_tested_at": profile.last_tested_at,
            "revision": profile.revision,
            "created_at": profile.created_at,
            "updated_at": profile.updated_at,
        }
    )
    if actor_type == AccountType.ENGINEER:
        return GeoCollectionProfileRead(
            summary=summary,
            configuration=None,
            workflow_stage=stage,
            primary_task=Task.VIEW_SUMMARY,
            available_actions=[],
            deletion=None,
            activation_blockers=None,
            test_blockers=None,
            test_error=None,
        )
    test_eligibility = facts.eligibility(
        registry=collectors.collector_registry,
        configuration=settings,
        connection_test=True,
    )
    actions = [Action.UPDATE]
    if test_eligibility.eligible:
        actions.append(Action.TEST)
    if profile.is_active:
        actions.append(Action.DISABLE)
    elif not blockers:
        actions.append(Action.ENABLE)
    if not plan_count and not run_count and not session_count:
        actions.append(Action.DELETE)
    configuration = _PROFILE_OUT.validate_python(
        {
            **{
                key: getattr(profile, key)
                for key in (
                    "id",
                    "engine_surface_id",
                    "name",
                    "collection_mode",
                    "adapter_key",
                    "ai_channel_id",
                    "ai_model_id",
                    "language_code",
                    "region_code",
                    "login_state",
                    "web_search_policy",
                    "is_active",
                    "last_test_status",
                    "last_tested_at",
                    "revision",
                    "created_by",
                    "created_at",
                    "updated_at",
                )
            },
            "settings": profile.settings_json,
        }
    )
    return GeoCollectionProfileRead(
        summary=summary,
        configuration=configuration,
        workflow_stage=stage,
        primary_task=Task.RESOLVE_BLOCKERS
        if blockers
        else Task.MANAGE_PROFILE
        if profile.is_active
        else Task.ENABLE_PROFILE,
        available_actions=actions,
        deletion=GeoConfigurationDeletionProjection(
            blockers=(
                [DeletionBlocker(type=DeletionType.MONITORING_PLAN, count=plan_count)]
                if plan_count
                else []
            )
            + (
                [DeletionBlocker(
                    type=DeletionType.HISTORICAL_REFERENCE, count=run_count + session_count
                )]
                if run_count or session_count
                else []
            )
        ),
        activation_blockers=blockers,
        test_blockers=[
            GeoProfileActivationBlocker(code=item.code, field=item.field)
            for item in test_eligibility.blockers
        ],
        test_error=GeoProfileTestError.model_validate(
            {"code": profile.last_test_error_code, "summary": profile.last_test_error_summary}
        )
        if profile.last_test_error_code is not None
        else None,
    )
