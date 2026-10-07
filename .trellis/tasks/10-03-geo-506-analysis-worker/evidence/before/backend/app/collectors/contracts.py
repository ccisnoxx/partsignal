"""Collector 内部值对象；公开快照显式转换，不携带 ORM、凭据或分析上下文。"""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import ConfigDict, Field, TypeAdapter, ValidationError, field_validator
from pydantic.dataclasses import dataclass

from app.collectors.registry import CollectorCapability, surface_capabilities
from app.geo_citation_urls import normalize_citation_url
from app.schemas.geo_answers import GeoRawPayloadSummary, OriginalText, Position
from app.schemas.geo_monitoring_plans import PlanBudget
from app.schemas.geo_prompt_variants import PromptLanguage, PromptRegion, Revision
from app.schemas.geo_runs import GeoRunDataClassification, GeoRunInputSnapshot, NonEmpty
from app.schemas.geo_surfaces import (
    AdapterKey,
    GeoCollectionMode,
    GeoCollectionProfileCreate,
    GeoComplianceStatus,
    GeoProfileLoginState,
    GeoSurfaceKind,
    GeoSurfaceProviderBrand,
    GeoWebSearchPolicy,
    Name,
)

_VALUE_CONFIG = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
_PROFILE_CONFIG: TypeAdapter[object] = TypeAdapter(GeoCollectionProfileCreate)
NonNegative = Annotated[int, Field(ge=0)]
TokenCount = Annotated[int, Field(ge=0, le=2147483647)]
Duration = Annotated[int, Field(ge=0, le=9223372036854775807)]


@dataclass(frozen=True, config=_VALUE_CONFIG)
class CollectionSurface:
    id: UUID
    revision: Revision
    name: Name
    surface_kind: GeoSurfaceKind
    provider_brand: GeoSurfaceProviderBrand
    compliance_status: GeoComplianceStatus
    capabilities: frozenset[CollectorCapability]

    def __post_init__(self) -> None:
        if CollectorCapability.ANSWER_TEXT not in self.capabilities:
            raise ValueError("观测面必须支持回答正文")


@dataclass(frozen=True, config=_VALUE_CONFIG, repr=False)
class CollectionProfile:
    id: UUID
    revision: Revision
    engine_surface_id: UUID
    name: Name
    collection_mode: GeoCollectionMode
    adapter_key: AdapterKey
    adapter_version: Annotated[NonEmpty, Field(max_length=100)]
    ai_channel_id: UUID | None
    ai_model_id: UUID | None
    language_code: PromptLanguage
    region_code: PromptRegion
    login_state: GeoProfileLoginState
    web_search_policy: GeoWebSearchPolicy
    settings: tuple[tuple[str, bool | int | float | None], ...]

    def __post_init__(self) -> None:
        if len(dict(self.settings)) != len(self.settings):
            raise ValueError("配置项不得重复")
        try:
            # 三模式 settings/引用仍由 GEO-203 的唯一配置合同校验。
            _PROFILE_CONFIG.validate_python(
                {
                    "name": self.name,
                    "engine_surface_id": self.engine_surface_id,
                    "collection_mode": self.collection_mode,
                    "adapter_key": self.adapter_key,
                    "ai_channel_id": self.ai_channel_id,
                    "ai_model_id": self.ai_model_id,
                    "language_code": self.language_code,
                    "region_code": self.region_code,
                    "login_state": self.login_state,
                    "web_search_policy": self.web_search_policy,
                    "settings": dict(self.settings),
                }
            )
        except ValidationError:
            raise ValueError("采集配置不符合闭合合同") from None


@dataclass(frozen=True, config=_VALUE_CONFIG, repr=False)
class CollectionRequest:
    run_id: UUID
    prompt_text: Annotated[NonEmpty, Field(max_length=8000)]
    data_classification: GeoRunDataClassification
    engine_surface: CollectionSurface
    profile: CollectionProfile
    timeout_seconds: Annotated[int, Field(gt=0)]
    max_response_bytes: Annotated[int, Field(gt=0)]
    budget_remaining: PlanBudget | None

    def __post_init__(self) -> None:
        if self.profile.engine_surface_id != self.engine_surface.id:
            raise ValueError("采集配置与观测面身份不一致")

    @classmethod
    def from_snapshot(
        cls,
        run_id: UUID,
        snapshot: GeoRunInputSnapshot,
        *,
        timeout_seconds: int,
        max_response_bytes: int,
        budget_remaining: Decimal | None,
    ) -> Self:
        """消费已校验的冻结 DTO；复制配置，不传递可变 DTO 或 subject/事实字典。"""
        profile = snapshot.profile
        surface = profile.surface
        return cls(
            run_id=run_id,
            prompt_text=snapshot.prompt.prompt_text,
            data_classification=snapshot.data_classification,
            engine_surface=CollectionSurface(
                id=surface.id,
                revision=surface.revision,
                name=surface.name,
                surface_kind=surface.surface_kind,
                provider_brand=surface.provider_brand,
                compliance_status=surface.compliance_status,
                capabilities=surface_capabilities(surface.capabilities.model_dump()),
            ),
            profile=CollectionProfile(
                id=profile.id,
                revision=profile.revision,
                engine_surface_id=surface.id,
                name=profile.name,
                collection_mode=GeoCollectionMode(profile.collection_mode),
                adapter_key=profile.adapter_key,
                adapter_version=profile.adapter_version,
                ai_channel_id=profile.ai_channel_id,
                ai_model_id=profile.ai_model_id,
                language_code=profile.language_code,
                region_code=profile.region_code,
                login_state=GeoProfileLoginState(profile.login_state),
                web_search_policy=profile.web_search_policy,
                settings=tuple(profile.settings.model_dump().items()),
            ),
            timeout_seconds=timeout_seconds,
            max_response_bytes=max_response_bytes,
            budget_remaining=budget_remaining,
        )


@dataclass(frozen=True, config=_VALUE_CONFIG, repr=False)
class CollectedCitation:
    url: Annotated[str, Field(min_length=1, max_length=2083)]
    title: Annotated[str, Field(max_length=2000)] | None
    position: Position
    extraction_source: Literal["STRUCTURED", "DOM", "TEXT", "MANUAL"]

    def __post_init__(self) -> None:
        # 只校验原始证据；规范 URL 去重/occurrences 由提交边界拥有，不抓取页面。
        normalize_citation_url(self.url)
        if self.title is not None and "\x00" in self.title:
            raise ValueError("引用标题不能包含 NUL")


@dataclass(frozen=True, config=_VALUE_CONFIG)
class Usage:
    prompt_tokens: TokenCount | None
    completion_tokens: TokenCount | None
    total_tokens: TokenCount | None


@dataclass(frozen=True, config=_VALUE_CONFIG)
class Money:
    amount: PlanBudget
    currency: Annotated[str, Field(pattern=re.compile(r"^[A-Z]{3}$(?![\s\S])"))]


@dataclass(frozen=True, config=_VALUE_CONFIG)
class CollectionEstimate:
    """cost=None 表示未知，Money(0, currency) 才是明确的零费用。"""

    cost: Money | None


@dataclass(frozen=True, config=_VALUE_CONFIG)
class RawPayloadSummary:
    schema_version: Literal[1] = 1
    payload_format: Literal["JSON", "TEXT", "DOM"] | None = None
    payload_bytes: NonNegative | None = None
    finish_reason: Literal["STOP", "LENGTH", "CONTENT_FILTER", "OTHER"] | None = None

    @field_validator("schema_version", mode="before")
    @classmethod
    def integer_version(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("摘要版本必须为整数")
        return value

    def __post_init__(self) -> None:
        # 复制为内部不可变值；公开/持久化摘要的闭合规则仍以 GEO-304 为准。
        try:
            self.to_contract()
        except ValidationError:
            raise ValueError("原始摘要不符合闭合合同") from None

    def to_contract(self) -> GeoRawPayloadSummary:
        return GeoRawPayloadSummary(
            schema_version=self.schema_version,
            payload_format=self.payload_format,
            payload_bytes=self.payload_bytes,
            finish_reason=self.finish_reason,
        )


@dataclass(frozen=True, config=_VALUE_CONFIG, repr=False)
class CollectedAnswer:
    answer_text: OriginalText
    answer_format: Literal["TEXT", "MARKDOWN", "HTML_TEXT"]
    source_product: Annotated[NonEmpty, Field(max_length=160)] | None
    source_model: Annotated[NonEmpty, Field(max_length=200)] | None
    source_version: Annotated[NonEmpty, Field(max_length=200)] | None
    web_search_observed: bool | None
    citations: Annotated[tuple[CollectedCitation, ...], Field(max_length=1000)]
    provider_request_id: Annotated[NonEmpty, Field(max_length=200)] | None
    usage: Usage | None
    cost: Money | None
    duration_ms: Duration
    raw_payload_summary: RawPayloadSummary
    screenshot_bytes: Annotated[bytes, Field(min_length=1, max_length=10485760)] | None
    raw_payload_bytes: Annotated[bytes, Field(min_length=1, max_length=52428800)] | None

    @field_validator("source_product", "source_model", "source_version")
    @classmethod
    def valid_source_metadata(cls, value: str | None) -> str | None:
        if value is not None and (not value.strip() or "\x00" in value):
            raise ValueError("来源元数据必须非空且不能包含 NUL；未知使用 None")
        return value

    def __post_init__(self) -> None:
        positions = tuple(c.position for c in self.citations)
        if positions != tuple(sorted(set(positions))):
            raise ValueError("采集引用必须按实际位置升序且不能重复位置")
        if self.provider_request_id is not None and (
            self.provider_request_id != self.provider_request_id.strip()
            or any(ord(c) < 32 or ord(c) == 127 for c in self.provider_request_id)
        ):
            raise ValueError("供应商请求标识无效")
