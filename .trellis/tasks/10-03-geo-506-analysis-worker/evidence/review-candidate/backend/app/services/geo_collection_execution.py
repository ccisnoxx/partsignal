"""采集执行的当前配置/凭据边界；不发送请求，不维护 Run 状态。"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.collectors.base import GeoCollector
from app.collectors.contracts import CollectionRequest
from app.collectors.errors import CollectorError, CollectorStage
from app.collectors.openai_compatible import OpenAICompatibleGeoCollector
from app.collectors.registry import collector_registry
from app.config import settings
from app.errors import AppError
from app.models.ai_generation import AIChannel, AIChannelHeader, AIModel
from app.models.geo_surfaces import GeoCollectionProfile
from app.schemas.geo_runs import GeoExternalCallState as External
from app.schemas.geo_runs import GeoRunErrorCode as Code
from app.services.ai_configuration import request_credentials
from app.services.geo_collection_profiles import load_profile_facts
from app.services.geo_surface_locks import lock_bindings, lock_surface


@dataclass(frozen=True)
class ExecutionVersions:
    channel: int
    model: int
    surface: int
    profile: int


def configuration_error(code: Code = Code.COLLECTOR_CONFIGURATION_INVALID) -> CollectorError:
    return CollectorError(
        code, stage=CollectorStage.CONFIGURATION, external_call_state=External.NOT_STARTED
    )


def lock_configuration(db: Session, request: CollectionRequest) -> None:
    frozen = request.profile
    initial = db.execute(
        select(
            GeoCollectionProfile.ai_channel_id,
            GeoCollectionProfile.ai_model_id,
            GeoCollectionProfile.engine_surface_id,
        ).where(GeoCollectionProfile.id == frozen.id)
    ).one_or_none()
    if initial is None:
        raise configuration_error()
    lock_bindings(db, ((initial[0], initial[1]), (frozen.ai_channel_id, frozen.ai_model_id)))
    lock_surface(db, initial[2])
    # 同事务两次 Run UPDATE 会触发 Profile FK KEY SHARE 重验；NO KEY UPDATE
    # 仍阻止配置修改/删除，但避免结果提交与重复 claim 的 Profile→Batch 锁环。
    db.execute(
        select(GeoCollectionProfile.id)
        .where(GeoCollectionProfile.id == frozen.id)
        .with_for_update(key_share=True)
    ).all()


def qualify(db: Session, request: CollectionRequest) -> ExecutionVersions:
    """每次短事务重载当前资格；冻结配置不跟随新 Profile/模型绑定变更。"""
    if not settings.geo_monitoring_enabled or not settings.geo_api_collection_enabled:
        raise configuration_error(Code.COLLECTOR_DISABLED)
    facts = load_profile_facts(db, [request.profile.id]).get(request.profile.id)
    if (
        facts is None
        or not facts.eligibility(registry=collector_registry, configuration=settings).eligible
    ):
        raise configuration_error()
    p, frozen = facts.profile, request.profile
    registration = collector_registry.resolve(frozen.adapter_key)
    if (
        not facts.matches_frozen_profile(
            revision=frozen.revision,
            engine_surface_id=frozen.engine_surface_id,
            collection_mode=frozen.collection_mode,
            adapter_key=frozen.adapter_key,
            adapter_version=frozen.adapter_version,
            ai_channel_id=frozen.ai_channel_id,
            ai_model_id=frozen.ai_model_id,
            registry=collector_registry,
        )
        or registration.validate_profile(p)
    ):
        raise configuration_error()
    channel = db.get(AIChannel, frozen.ai_channel_id, populate_existing=True)
    model = db.get(AIModel, frozen.ai_model_id, populate_existing=True)
    if channel is None or model is None or model.channel_id != channel.id:
        raise configuration_error()
    return ExecutionVersions(channel.revision, model.revision, facts.surface.revision, p.revision)


def build_collector(db: Session, request: CollectionRequest) -> GeoCollector:
    """仅已实现的 API adapter；秘密不进入冻结快照、队列或错误正文。"""
    if request.profile.adapter_key != "openai-compatible-chat":
        raise configuration_error()
    channel = db.get(AIChannel, request.profile.ai_channel_id, populate_existing=True)
    model = db.get(AIModel, request.profile.ai_model_id, populate_existing=True)
    assert channel is not None and model is not None
    try:
        api_key, headers = request_credentials(db, channel)
    except AppError:
        raise configuration_error() from None
    sensitive = set(
        db.scalars(
            select(AIChannelHeader.normalized_name).where(
                AIChannelHeader.channel_id == channel.id, AIChannelHeader.is_sensitive
            )
        )
    )
    return OpenAICompatibleGeoCollector(
        channel_id=channel.id,
        model_id=model.id,
        protocol_type=channel.protocol_type,
        base_url=channel.base_url,
        provider_model=model.model_id,
        api_key=api_key,
        headers={k: v for k, v in headers.items() if k.lower() not in sensitive},
        sensitive_headers={k: v for k, v in headers.items() if k.lower() in sensitive},
        request_parameters=model.request_parameters,
        allow_local_http=settings.ai_allow_local_http,
        environment=settings.environment,
    )
