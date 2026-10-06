"""当前资格事实的非敏感列投影；调用方拥有事务，不写配置或加载凭据。"""

from collections.abc import Sequence
from dataclasses import dataclass, replace
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.collectors.registry import (
    CollectionProfileSnapshot,
    CollectorCapability,
    CollectorRegistry,
    EngineSurfaceSnapshot,
    ModelQualification,
    UnknownCollectorAdapter,
    collector_registry,
    surface_capabilities,
)
from app.config import Settings, settings
from app.errors import not_found
from app.models.ai_generation import AIChannel, AIModel
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.schemas.geo_surfaces import (
    GeoCollectionMode,
    GeoComplianceStatus,
    GeoProfileLoginState,
    GeoProfileTestStatus,
    GeoSurfaceKind,
    GeoWebSearchPolicy,
)
from app.services.geo_collector_eligibility import (
    GeoRuntimeSwitches,
    ProfileEligibility,
    evaluate_profile,
)


@dataclass(frozen=True)
class ProfileFacts:
    """同一次非敏感列查询形成的当前配置与依赖事实。"""

    profile: CollectionProfileSnapshot
    surface: EngineSurfaceSnapshot
    model: ModelQualification | None

    def matches_frozen_profile(
        self,
        *,
        revision: int,
        engine_surface_id: UUID,
        collection_mode: GeoCollectionMode,
        adapter_key: str,
        adapter_version: str,
        ai_channel_id: UUID | None,
        ai_model_id: UUID | None,
        registry: CollectorRegistry,
    ) -> bool:
        """当前资格不能替代冻结身份；读动作与锁内执行共用同一匹配合同。"""
        p = self.profile
        try:
            version = registry.resolve(p.adapter_key).version
        except UnknownCollectorAdapter:
            return False
        return (
            p.revision == revision
            and p.engine_surface_id == engine_surface_id
            and p.collection_mode == collection_mode
            and p.adapter_key == adapter_key
            and p.ai_channel_id == ai_channel_id
            and p.ai_model_id == ai_model_id
            and version == adapter_version
        )

    def eligibility(
        self,
        *,
        registry: CollectorRegistry,
        configuration: Settings,
        assume_active: bool = False,
        required_capabilities: frozenset[CollectorCapability] = frozenset(),
        connection_test: bool = False,
    ) -> ProfileEligibility:
        return evaluate_profile(
            replace(self.profile, is_active=True) if assume_active else self.profile,
            self.surface,
            registry=registry,
            model=self.model,
            required_capabilities=required_capabilities,
            connection_test=connection_test,
            switches=GeoRuntimeSwitches(
                configuration.environment,
                configuration.geo_monitoring_enabled,
                configuration.geo_api_collection_enabled,
                configuration.geo_browser_collection_enabled,
            ),
        )


def load_profile_facts(db: Session, profile_ids: Sequence[UUID]) -> dict[UUID, ProfileFacts]:
    """单项和管理列表共用批量快照；不使用 ORM 缓存、autoflush 或凭据正文。"""
    if not profile_ids:
        return {}
    p, s, m, c = GeoCollectionProfile, GeoEngineSurface, AIModel, AIChannel
    rows = (
        db.execute(
            select(
                p.id,
                p.engine_surface_id,
                p.revision,
                p.name,
                p.collection_mode,
                p.adapter_key,
                p.ai_channel_id,
                p.ai_model_id,
                p.language_code,
                p.region_code,
                p.login_state,
                p.web_search_policy,
                p.settings_json,
                p.is_active,
                p.last_test_status,
                p.last_tested_at,
                s.revision.label("surface_revision"),
                s.surface_kind,
                s.compliance_status,
                s.capabilities,
                s.is_active.label("surface_is_active"),
                m.id.label("model_id"),
                m.channel_id.label("model_channel_id"),
                m.is_enabled.label("model_is_enabled"),
                m.test_status,
                c.is_enabled.label("channel_is_enabled"),
                c.protocol_type,
                (c.api_key_ciphertext != "").label("credential_configured"),
            )
            .join(s, s.id == p.engine_surface_id)
            .outerjoin(m, and_(m.id == p.ai_model_id, m.channel_id == p.ai_channel_id))
            .outerjoin(c, c.id == m.channel_id)
            .where(p.id.in_(profile_ids))
            .execution_options(autoflush=False)
        )
        .mappings()
        .all()
    )
    results: dict[UUID, ProfileFacts] = {}
    for row in rows:
        profile = CollectionProfileSnapshot(
            id=row["id"],
            engine_surface_id=row["engine_surface_id"],
            revision=row["revision"],
            name=row["name"],
            collection_mode=GeoCollectionMode(row["collection_mode"]),
            adapter_key=row["adapter_key"],
            ai_channel_id=row["ai_channel_id"],
            ai_model_id=row["ai_model_id"],
            language_code=row["language_code"],
            region_code=row["region_code"],
            login_state=GeoProfileLoginState(row["login_state"]),
            web_search_policy=GeoWebSearchPolicy(row["web_search_policy"]),
            settings=tuple(sorted(row["settings_json"].items())),
            is_active=row["is_active"],
            last_test_status=GeoProfileTestStatus(row["last_test_status"]),
            last_tested_at=row["last_tested_at"],
        )
        surface = EngineSurfaceSnapshot(
            id=row["engine_surface_id"],
            revision=row["surface_revision"],
            surface_kind=GeoSurfaceKind(row["surface_kind"]),
            compliance_status=GeoComplianceStatus(row["compliance_status"]),
            capabilities=surface_capabilities(row["capabilities"]),
            is_active=row["surface_is_active"],
        )
        model = (
            None
            if row["model_id"] is None
            else ModelQualification(
                id=row["model_id"],
                channel_id=row["model_channel_id"],
                is_enabled=row["model_is_enabled"],
                channel_is_enabled=row["channel_is_enabled"],
                test_status=row["test_status"],
                credential_configured=row["credential_configured"],
                protocol_type=row["protocol_type"],
            )
        )
        results[profile.id] = ProfileFacts(profile, surface, model)
    return results


def profile_eligibility(
    db: Session,
    profile_id: UUID,
    *,
    registry: CollectorRegistry = collector_registry,
    configuration: Settings = settings,
    required_capabilities: frozenset[CollectorCapability] = frozenset(),
) -> ProfileEligibility:
    """一次 SQL 读取当前状态；结果不代表发送前锁定。"""
    facts = load_profile_facts(db, [profile_id]).get(profile_id)
    if facts is None:
        raise not_found("GEO 采集配置")
    return facts.eligibility(
        registry=registry,
        configuration=configuration,
        required_capabilities=required_capabilities,
    )
