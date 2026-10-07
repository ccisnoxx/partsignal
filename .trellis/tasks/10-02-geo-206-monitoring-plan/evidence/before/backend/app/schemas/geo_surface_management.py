"""GEO 管理读模型：摘要与管理员配置显式分离，不投影外部服务秘密。"""

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import Field, StrictBool

from app.collectors.registry import ProfileBlockerCode
from app.schemas.base import ContractModel
from app.schemas.geo_prompt_variants import PromptLanguage, PromptRegion, Revision
from app.schemas.geo_surfaces import (
    GeoCollectionMode,
    GeoCollectionProfileOut,
    GeoComplianceStatus,
    GeoEngineSurfaceOut,
    GeoProfileLoginState,
    GeoProfileTestStatus,
    GeoSurfaceCapabilities,
    GeoSurfaceKind,
    GeoSurfaceProviderBrand,
    GeoWebSearchPolicy,
    Name,
)


class GeoConfigurationRevisionRequest(ContractModel):
    expected_revision: Revision


class GeoConfigurationAction(StrEnum):
    UPDATE = "UPDATE"
    ENABLE = "ENABLE"
    DISABLE = "DISABLE"
    DELETE = "DELETE"


class GeoConfigurationWorkflowStage(StrEnum):
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"
    BLOCKED = "BLOCKED"


class GeoConfigurationPrimaryTask(StrEnum):
    VIEW_SUMMARY = "VIEW_SUMMARY"
    MANAGE_SURFACE = "MANAGE_SURFACE"
    ENABLE_SURFACE = "ENABLE_SURFACE"
    MANAGE_PROFILE = "MANAGE_PROFILE"
    ENABLE_PROFILE = "ENABLE_PROFILE"
    RESOLVE_BLOCKERS = "RESOLVE_BLOCKERS"


class GeoConfigurationDeletionBlockerType(StrEnum):
    COLLECTION_PROFILE = "COLLECTION_PROFILE"
    HISTORICAL_REFERENCE = "HISTORICAL_REFERENCE"


class GeoConfigurationDeletionBlocker(ContractModel):
    type: GeoConfigurationDeletionBlockerType
    count: int = Field(ge=1)


class GeoConfigurationDeletionProjection(ContractModel):
    blockers: list[GeoConfigurationDeletionBlocker]


class GeoProfileActivationBlocker(ContractModel):
    code: ProfileBlockerCode
    field: str


class GeoEngineSurfaceSummary(ContractModel):
    id: UUID
    name: Name
    slug: str
    surface_kind: GeoSurfaceKind
    provider_brand: GeoSurfaceProviderBrand
    compliance_status: GeoComplianceStatus
    capabilities: GeoSurfaceCapabilities
    is_active: StrictBool
    revision: Revision
    created_at: datetime
    updated_at: datetime


class GeoCollectionProfileSummary(ContractModel):
    id: UUID
    name: Name
    engine_surface_id: UUID
    engine_surface: GeoEngineSurfaceSummary
    collection_mode: GeoCollectionMode
    language_code: PromptLanguage
    region_code: PromptRegion
    login_state: GeoProfileLoginState
    web_search_policy: GeoWebSearchPolicy
    is_active: StrictBool
    last_test_status: GeoProfileTestStatus
    last_tested_at: datetime | None
    revision: Revision
    created_at: datetime
    updated_at: datetime


class GeoEngineSurfaceRead(ContractModel):
    summary: GeoEngineSurfaceSummary
    configuration: GeoEngineSurfaceOut | None
    workflow_stage: GeoConfigurationWorkflowStage
    primary_task: GeoConfigurationPrimaryTask
    available_actions: list[GeoConfigurationAction]
    deletion: GeoConfigurationDeletionProjection | None


class GeoCollectionProfileRead(ContractModel):
    summary: GeoCollectionProfileSummary
    configuration: GeoCollectionProfileOut | None
    workflow_stage: GeoConfigurationWorkflowStage
    primary_task: GeoConfigurationPrimaryTask
    available_actions: list[GeoConfigurationAction]
    deletion: GeoConfigurationDeletionProjection | None
    activation_blockers: list[GeoProfileActivationBlocker] | None


class GeoEngineSurfaceListPage(ContractModel):
    items: list[GeoEngineSurfaceRead]
    page: int = Field(ge=1)
    page_size: int
    total: int = Field(ge=0)


class GeoCollectionProfileListPage(ContractModel):
    items: list[GeoCollectionProfileRead]
    page: int = Field(ge=1)
    page_size: int
    total: int = Field(ge=0)
