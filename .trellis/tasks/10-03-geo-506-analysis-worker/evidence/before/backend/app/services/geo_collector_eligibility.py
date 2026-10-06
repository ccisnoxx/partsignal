"""Plan preview 与 Worker 共用的无 I/O Profile 配置资格，不代表发送授权。"""

from dataclasses import dataclass
from uuid import UUID

from app.collectors.registry import (
    CollectionProfileSnapshot,
    CollectorCapability,
    CollectorRegistry,
    EngineSurfaceSnapshot,
    ModelQualification,
    ProfileBlocker,
    ProfileBlockerCode,
    UnknownCollectorAdapter,
    collector_registry,
)
from app.schemas.geo_surfaces import (
    GeoCollectionMode,
    GeoComplianceStatus,
    GeoProfileTestStatus,
    GeoWebSearchPolicy,
)


@dataclass(frozen=True)
class GeoRuntimeSwitches:
    environment: str
    monitoring_enabled: bool
    api_collection_enabled: bool
    browser_collection_enabled: bool


@dataclass(frozen=True)
class ProfileEligibility:
    profile_id: UUID
    profile_revision: int
    surface_revision: int
    adapter_version: str | None
    capabilities: frozenset[CollectorCapability]
    blockers: tuple[ProfileBlocker, ...]

    @property
    def eligible(self) -> bool:
        return not self.blockers

    def require_eligible(self) -> None:
        if not self.eligible:
            raise ProfileIneligible(self)


class ProfileIneligible(ValueError):
    def __init__(self, eligibility: ProfileEligibility) -> None:
        super().__init__("采集配置不具备当前运行资格")
        self.eligibility = eligibility


def evaluate_profile(
    profile: CollectionProfileSnapshot,
    surface: EngineSurfaceSnapshot,
    *,
    switches: GeoRuntimeSwitches,
    registry: CollectorRegistry = collector_registry,
    model: ModelQualification | None = None,
    required_capabilities: frozenset[CollectorCapability] = frozenset(),
    connection_test: bool = False,
) -> ProfileEligibility:
    """配置资格只有一个 owner；执行方必须在自己的事务/发送边界重读当前事实。"""
    blockers: list[ProfileBlocker] = []

    def block(condition: bool, code: ProfileBlockerCode, field: str) -> None:
        if condition:
            blockers.append(ProfileBlocker(code, field))

    try:
        adapter = registry.resolve(profile.adapter_key)
    except UnknownCollectorAdapter:
        return ProfileEligibility(
            profile.id,
            profile.revision,
            surface.revision,
            None,
            frozenset(),
            (ProfileBlocker(ProfileBlockerCode.ADAPTER_UNKNOWN, "adapter_key"),),
        )

    blockers.extend(adapter.validate_profile(profile))
    block(
        profile.engine_surface_id != surface.id,
        ProfileBlockerCode.CONFIGURATION_INVALID,
        "engine_surface_id",
    )
    block(
        not switches.monitoring_enabled,
        ProfileBlockerCode.MONITORING_DISABLED,
        "GEO_MONITORING_ENABLED",
    )
    block(
        connection_test and not adapter.connection_test_supported,
        ProfileBlockerCode.MODE_UNSUPPORTED,
        "collection_mode",
    )
    block(
        not connection_test and not profile.is_active,
        ProfileBlockerCode.PROFILE_DISABLED,
        "is_active",
    )
    block(not surface.is_active, ProfileBlockerCode.SURFACE_DISABLED, "engine_surface.is_active")
    block(
        switches.environment not in adapter.environments,
        ProfileBlockerCode.ENVIRONMENT_UNSUPPORTED,
        "environment",
    )
    block(
        surface.surface_kind not in adapter.surface_kinds,
        ProfileBlockerCode.SURFACE_UNSUPPORTED,
        "engine_surface.surface_kind",
    )
    capabilities = surface.capabilities & adapter.capabilities
    required = required_capabilities | {CollectorCapability.ANSWER_TEXT}
    if profile.web_search_policy == GeoWebSearchPolicy.REQUIRED:
        required |= {CollectorCapability.WEB_SEARCH_SIGNAL}
    for capability in sorted(required):
        # Enum 转换让内部调用方的未知能力也明确失败，不能忽略拼错的要求。
        capability = CollectorCapability(capability)
        block(
            capability not in capabilities,
            ProfileBlockerCode.CAPABILITY_UNSUPPORTED,
            f"capabilities.{capability.value}",
        )

    if profile.collection_mode != GeoCollectionMode.MANUAL:
        block(
            not connection_test and not adapter.approved,
            ProfileBlockerCode.ADAPTER_NOT_APPROVED,
            "adapter_key",
        )
        block(
            surface.compliance_status != GeoComplianceStatus.APPROVED,
            ProfileBlockerCode.COMPLIANCE_NOT_APPROVED,
            "engine_surface.compliance_status",
        )
        block(
            not connection_test
            and (
                profile.last_test_status != GeoProfileTestStatus.PASSED
                or profile.last_tested_at is None
            ),
            ProfileBlockerCode.PROFILE_NOT_TESTED,
            "last_test_status",
        )
    if profile.collection_mode == GeoCollectionMode.API:
        block(
            not switches.api_collection_enabled,
            ProfileBlockerCode.API_COLLECTION_DISABLED,
            "GEO_API_COLLECTION_ENABLED",
        )
        if adapter.model_protocol is None:
            block(
                profile.ai_channel_id is not None or profile.ai_model_id is not None,
                ProfileBlockerCode.MODEL_BINDING_UNSUPPORTED,
                "ai_model_id",
            )
        elif profile.ai_channel_id is None or profile.ai_model_id is None:
            block(True, ProfileBlockerCode.MODEL_BINDING_REQUIRED, "ai_model_id")
        elif (
            model is None
            or model.id != profile.ai_model_id
            or model.channel_id != profile.ai_channel_id
        ):
            block(True, ProfileBlockerCode.MODEL_BINDING_INVALID, "ai_model_id")
        else:
            block(not model.is_enabled, ProfileBlockerCode.MODEL_DISABLED, "ai_model_id")
            block(
                not model.channel_is_enabled, ProfileBlockerCode.CHANNEL_DISABLED, "ai_channel_id"
            )
            block(model.test_status != "PASSED", ProfileBlockerCode.MODEL_NOT_TESTED, "ai_model_id")
            block(
                not model.credential_configured,
                ProfileBlockerCode.CREDENTIAL_NOT_CONFIGURED,
                "ai_channel_id",
            )
            block(
                model.protocol_type != adapter.model_protocol,
                ProfileBlockerCode.PROTOCOL_UNSUPPORTED,
                "ai_channel_id",
            )
    if profile.collection_mode == GeoCollectionMode.BROWSER:
        block(
            not switches.browser_collection_enabled,
            ProfileBlockerCode.BROWSER_COLLECTION_DISABLED,
            "GEO_BROWSER_COLLECTION_ENABLED",
        )
    return ProfileEligibility(
        profile.id,
        profile.revision,
        surface.revision,
        adapter.version,
        capabilities,
        tuple(blockers),
    )
