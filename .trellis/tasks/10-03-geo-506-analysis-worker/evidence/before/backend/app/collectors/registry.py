"""不可变 adapter 元数据与无 I/O 配置校验，不持有 ORM 或 provider。"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from types import MappingProxyType
from uuid import UUID

from pydantic import TypeAdapter, ValidationError

from app.schemas.geo_surfaces import (
    AdapterKey,
    GeoCollectionMode,
    GeoCollectionProfileCreate,
    GeoComplianceStatus,
    GeoProfileLoginState,
    GeoProfileTestStatus,
    GeoSurfaceCapabilities,
    GeoSurfaceKind,
    GeoWebSearchPolicy,
)


class CollectorCapability(StrEnum):
    ANSWER_TEXT = "answer_text"
    CITATIONS = "citations"
    WEB_SEARCH_SIGNAL = "web_search_signal"
    MODEL_VERSION = "model_version"
    USAGE = "usage"
    COST = "cost"


def surface_capabilities(value: object) -> frozenset[CollectorCapability]:
    """在持久化 JSON 边界校验六键闭合合同，再转换为内部能力集合。"""
    validated = GeoSurfaceCapabilities.model_validate(value)
    return frozenset(
        CollectorCapability(key) for key, supported in validated.model_dump().items() if supported
    )


class ProfileBlockerCode(StrEnum):
    ADAPTER_UNKNOWN = "ADAPTER_UNKNOWN"
    CONFIGURATION_INVALID = "CONFIGURATION_INVALID"
    MODE_UNSUPPORTED = "MODE_UNSUPPORTED"
    SURFACE_UNSUPPORTED = "SURFACE_UNSUPPORTED"
    LANGUAGE_UNSUPPORTED = "LANGUAGE_UNSUPPORTED"
    REGION_UNSUPPORTED = "REGION_UNSUPPORTED"
    LOGIN_UNSUPPORTED = "LOGIN_UNSUPPORTED"
    SEARCH_POLICY_UNSUPPORTED = "SEARCH_POLICY_UNSUPPORTED"
    CAPABILITY_UNSUPPORTED = "CAPABILITY_UNSUPPORTED"
    MONITORING_DISABLED = "MONITORING_DISABLED"
    API_COLLECTION_DISABLED = "API_COLLECTION_DISABLED"
    BROWSER_COLLECTION_DISABLED = "BROWSER_COLLECTION_DISABLED"
    PROFILE_DISABLED = "PROFILE_DISABLED"
    SURFACE_DISABLED = "SURFACE_DISABLED"
    ADAPTER_NOT_APPROVED = "ADAPTER_NOT_APPROVED"
    ENVIRONMENT_UNSUPPORTED = "ENVIRONMENT_UNSUPPORTED"
    COMPLIANCE_NOT_APPROVED = "COMPLIANCE_NOT_APPROVED"
    PROFILE_NOT_TESTED = "PROFILE_NOT_TESTED"
    MODEL_BINDING_REQUIRED = "MODEL_BINDING_REQUIRED"
    MODEL_BINDING_UNSUPPORTED = "MODEL_BINDING_UNSUPPORTED"
    MODEL_BINDING_INVALID = "MODEL_BINDING_INVALID"
    MODEL_DISABLED = "MODEL_DISABLED"
    CHANNEL_DISABLED = "CHANNEL_DISABLED"
    MODEL_NOT_TESTED = "MODEL_NOT_TESTED"
    CREDENTIAL_NOT_CONFIGURED = "CREDENTIAL_NOT_CONFIGURED"
    PROTOCOL_UNSUPPORTED = "PROTOCOL_UNSUPPORTED"


@dataclass(frozen=True)
class ProfileBlocker:
    code: ProfileBlockerCode
    field: str


@dataclass(frozen=True)
class CollectionProfileSnapshot:
    id: UUID
    engine_surface_id: UUID
    revision: int
    name: str
    collection_mode: GeoCollectionMode
    adapter_key: str
    ai_channel_id: UUID | None
    ai_model_id: UUID | None
    language_code: str
    region_code: str
    login_state: GeoProfileLoginState
    web_search_policy: GeoWebSearchPolicy
    settings: tuple[tuple[str, bool | int | float | None], ...]
    is_active: bool
    last_test_status: GeoProfileTestStatus
    last_tested_at: datetime | None


@dataclass(frozen=True)
class EngineSurfaceSnapshot:
    id: UUID
    revision: int
    surface_kind: GeoSurfaceKind
    compliance_status: GeoComplianceStatus
    capabilities: frozenset[CollectorCapability]
    is_active: bool


@dataclass(frozen=True)
class ModelQualification:
    """仅当前绑定的资格事实；不包含地址、参数、Header、密钥或密文。"""

    id: UUID
    channel_id: UUID
    is_enabled: bool
    channel_is_enabled: bool
    test_status: str
    credential_configured: bool
    protocol_type: str


_PROFILE_CONFIG: TypeAdapter[object] = TypeAdapter(GeoCollectionProfileCreate)


@dataclass(frozen=True)
class CollectorRegistration:
    key: str
    version: str
    collection_mode: GeoCollectionMode
    capabilities: frozenset[CollectorCapability]
    surface_kinds: frozenset[GeoSurfaceKind]
    login_states: frozenset[GeoProfileLoginState]
    web_search_policies: frozenset[GeoWebSearchPolicy]
    environments: frozenset[str]
    approved: bool = False
    connection_test_supported: bool = False
    model_protocol: str | None = None
    languages: frozenset[str] | None = None
    regions: frozenset[str] | None = None

    def __post_init__(self) -> None:
        # 登记方传入的集合也复制冻结，不能在构造 Registry 后改变批准边界。
        for name in (
            "capabilities",
            "surface_kinds",
            "login_states",
            "web_search_policies",
            "environments",
            "languages",
            "regions",
        ):
            value = getattr(self, name)
            if value is not None:
                object.__setattr__(self, name, frozenset(value))
        TypeAdapter(AdapterKey).validate_python(self.key)
        if not self.version.strip() or self.version != self.version.strip():
            raise ValueError("adapter 版本必须显式提供且不含首尾空白")
        if CollectorCapability.ANSWER_TEXT not in self.capabilities:
            raise ValueError("adapter 必须支持回答正文")
        if any(not isinstance(item, CollectorCapability) for item in self.capabilities):
            raise ValueError("adapter 能力必须来自闭合能力目录")
        if self.model_protocol is not None and self.collection_mode != GeoCollectionMode.API:
            raise ValueError("只有 API adapter 可以绑定模型协议")

    def validate_profile(self, profile: CollectionProfileSnapshot) -> tuple[ProfileBlocker, ...]:
        """只验证配置；启停、当前模型、合规和开关由共享资格策略裁决。"""
        try:
            _PROFILE_CONFIG.validate_python(
                {
                    "name": profile.name,
                    "engine_surface_id": profile.engine_surface_id,
                    "collection_mode": profile.collection_mode,
                    "adapter_key": profile.adapter_key,
                    "ai_channel_id": profile.ai_channel_id,
                    "ai_model_id": profile.ai_model_id,
                    "language_code": profile.language_code,
                    "region_code": profile.region_code,
                    "login_state": profile.login_state,
                    "web_search_policy": profile.web_search_policy,
                    "settings": dict(profile.settings),
                }
            )
        except ValidationError:
            # 不把 Pydantic input/context 或配置值送入 blocker/日志。
            return (ProfileBlocker(ProfileBlockerCode.CONFIGURATION_INVALID, "profile"),)
        comparisons = (
            (
                profile.adapter_key != self.key,
                ProfileBlockerCode.CONFIGURATION_INVALID,
                "adapter_key",
            ),
            (
                profile.collection_mode != self.collection_mode,
                ProfileBlockerCode.MODE_UNSUPPORTED,
                "collection_mode",
            ),
            (
                profile.login_state not in self.login_states,
                ProfileBlockerCode.LOGIN_UNSUPPORTED,
                "login_state",
            ),
            (
                profile.web_search_policy not in self.web_search_policies,
                ProfileBlockerCode.SEARCH_POLICY_UNSUPPORTED,
                "web_search_policy",
            ),
            (
                self.languages is not None and profile.language_code not in self.languages,
                ProfileBlockerCode.LANGUAGE_UNSUPPORTED,
                "language_code",
            ),
            (
                self.regions is not None and profile.region_code not in self.regions,
                ProfileBlockerCode.REGION_UNSUPPORTED,
                "region_code",
            ),
        )
        return tuple(ProfileBlocker(code, field) for failed, code, field in comparisons if failed)


class UnknownCollectorAdapter(LookupError):
    def __init__(self) -> None:
        super().__init__("未注册的 Collector adapter，禁止回退")


class CollectorRegistry:
    def __init__(self, registrations: Iterable[CollectorRegistration]) -> None:
        entries: dict[str, CollectorRegistration] = {}
        for entry in registrations:
            if entry.key in entries:
                raise ValueError("Collector adapter key 重复注册")
            entries[entry.key] = entry
        self._entries = MappingProxyType(entries)

    def resolve(self, adapter_key: str) -> CollectorRegistration:
        try:
            return self._entries[adapter_key]
        except KeyError:
            raise UnknownCollectorAdapter() from None

    def capabilities(self, adapter_key: str) -> frozenset[CollectorCapability]:
        return self.resolve(adapter_key).capabilities

    def validate_profile(self, profile: CollectionProfileSnapshot) -> tuple[ProfileBlocker, ...]:
        return self.resolve(profile.adapter_key).validate_profile(profile)


# API 仅有已实现的固定连接诊断；采集仍未批准，GEO-404 实现后再开放。
collector_registry = CollectorRegistry(
    (
        CollectorRegistration(
            key="openai-compatible-chat",
            version="1",
            collection_mode=GeoCollectionMode.API,
            capabilities=frozenset({CollectorCapability.ANSWER_TEXT}),
            surface_kinds=frozenset({GeoSurfaceKind.MODEL_API}),
            login_states=frozenset({GeoProfileLoginState.NOT_APPLICABLE}),
            web_search_policies=frozenset(
                {GeoWebSearchPolicy.UNKNOWN, GeoWebSearchPolicy.NOT_APPLICABLE}
            ),
            environments=frozenset({"development", "test", "staging", "production"}),
            model_protocol="openai-compatible-chat-completions",
            connection_test_supported=True,
        ),
        CollectorRegistration(
            key="manual",
            version="1",
            collection_mode=GeoCollectionMode.MANUAL,
            capabilities=frozenset(
                {
                    CollectorCapability.ANSWER_TEXT,
                    CollectorCapability.CITATIONS,
                    CollectorCapability.WEB_SEARCH_SIGNAL,
                    CollectorCapability.MODEL_VERSION,
                }
            ),
            surface_kinds=frozenset(GeoSurfaceKind),
            login_states=frozenset(
                {GeoProfileLoginState.ANONYMOUS, GeoProfileLoginState.AUTHENTICATED}
            ),
            web_search_policies=frozenset(GeoWebSearchPolicy),
            environments=frozenset({"development", "test", "staging", "production"}),
        ),
    )
)
