"""回答级运行数据组件；命令、动作与证据由后续任务接入。"""

import re
from enum import StrEnum
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, Field, model_validator

from app.geo_prompt_variants import GeoPromptMentionMode, GeoPromptPriority
from app.schemas.base import ContractModel, require_unique_items
from app.schemas.configuration import IntentType
from app.schemas.geo_catalog import (
    GeoSubjectAliasKind,
    GeoSubjectDomainRelationType,
    GeoSubjectHostname,
    GeoSubjectType,
)
from app.schemas.geo_monitoring_plans import (
    GeoMonitoringPlanConfiguration,
    GeoPlanSubjectRole,
    PlanBudget,
)
from app.schemas.geo_prompt_variants import (
    PromptLanguage,
    PromptRegion,
    Revision,
)
from app.schemas.geo_surfaces import (
    GeoApiProfileConfiguration,
    GeoBrowserProfileConfiguration,
    GeoComplianceStatus,
    GeoManualProfileConfiguration,
    GeoSurfaceCapabilities,
    GeoSurfaceKind,
    GeoSurfaceProviderBrand,
)

NonEmpty = Annotated[str, Field(strict=True, min_length=1, pattern=r"^[^\x00]*\S[^\x00]*$")]
Sha256 = Annotated[str, Field(strict=True, pattern=re.compile(r"^[0-9a-f]{64}$(?![\s\S])"))]
NonNegative = Annotated[int, Field(strict=True, ge=0)]
Positive = Annotated[int, Field(strict=True, ge=1)]


class GeoBatchTriggerType(StrEnum):
    SCHEDULED = "SCHEDULED"
    MANUAL = "MANUAL"
    RETEST = "RETEST"


class GeoBatchStatus(StrEnum):
    PLANNED = "PLANNED"
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    BUDGET_BLOCKED = "BUDGET_BLOCKED"


class GeoRunStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COLLECTED = "COLLECTED"
    ANALYZING = "ANALYZING"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    BUDGET_BLOCKED = "BUDGET_BLOCKED"


class GeoExternalCallState(StrEnum):
    NOT_STARTED = "NOT_STARTED"
    SENT = "SENT"
    UNKNOWN = "UNKNOWN"
    COMPLETED = "COMPLETED"


class GeoRunErrorStage(StrEnum):
    COLLECTION = "COLLECTION"
    ANALYSIS = "ANALYSIS"
    REVIEW = "REVIEW"


class GeoRunErrorCode(StrEnum):
    COLLECTOR_CONFIGURATION_INVALID = "COLLECTOR_CONFIGURATION_INVALID"
    COLLECTOR_DISABLED = "COLLECTOR_DISABLED"
    PROVIDER_AUTH_FAILED = "PROVIDER_AUTH_FAILED"
    PROVIDER_RATE_LIMITED = "PROVIDER_RATE_LIMITED"
    PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    PROVIDER_RESPONSE_INVALID = "PROVIDER_RESPONSE_INVALID"
    PROVIDER_RESPONSE_TOO_LARGE = "PROVIDER_RESPONSE_TOO_LARGE"
    COLLECTOR_UNKNOWN_OUTCOME = "COLLECTOR_UNKNOWN_OUTCOME"
    DATA_CLASSIFICATION_FORBIDDEN = "DATA_CLASSIFICATION_FORBIDDEN"
    PROFILE_NEEDS_REAUTH = "PROFILE_NEEDS_REAUTH"
    WORKER_LOST = "WORKER_LOST"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"
    ANALYSIS_FAILED = "ANALYSIS_FAILED"
    REVIEW_FAILED = "REVIEW_FAILED"


class GeoRunCommandErrorCode(StrEnum):
    GEO_RUN_NOT_MANUAL = "GEO_RUN_NOT_MANUAL"
    GEO_RUN_NOT_PENDING = "GEO_RUN_NOT_PENDING"
    GEO_RUN_ALREADY_STARTED = "GEO_RUN_ALREADY_STARTED"
    GEO_RUN_NOT_RETRYABLE = "GEO_RUN_NOT_RETRYABLE"
    GEO_RUN_HAS_SUCCESSOR = "GEO_RUN_HAS_SUCCESSOR"
    GEO_SCHEDULE_WINDOW_EXISTS = "GEO_SCHEDULE_WINDOW_EXISTS"


class GeoRunDataClassification(StrEnum):
    PUBLIC = "PUBLIC"
    INTERNAL = "INTERNAL"
    RESTRICTED = "RESTRICTED"


class GeoRunPromptSnapshot(ContractModel):
    id: UUID
    revision: Revision
    query_topic_id: UUID
    query_topic_revision: Revision
    canonical_question: NonEmpty
    intent_type: IntentType
    prompt_text: Annotated[NonEmpty, Field(max_length=8000)]
    mention_mode: GeoPromptMentionMode
    priority: GeoPromptPriority
    language_code: PromptLanguage
    region_code: PromptRegion


class GeoRunSurfaceSnapshot(ContractModel):
    id: UUID
    revision: Revision
    name: Annotated[NonEmpty, Field(max_length=160)]
    surface_kind: GeoSurfaceKind
    provider_brand: GeoSurfaceProviderBrand
    compliance_status: GeoComplianceStatus
    capabilities: GeoSurfaceCapabilities


class _ProfileSnapshot(ContractModel):
    id: UUID
    revision: Revision
    adapter_version: Annotated[NonEmpty, Field(max_length=100)]
    surface: GeoRunSurfaceSnapshot


class GeoRunManualProfileSnapshot(GeoManualProfileConfiguration, _ProfileSnapshot):
    pass


class GeoRunApiProfileSnapshot(GeoApiProfileConfiguration, _ProfileSnapshot):
    pass


class GeoRunBrowserProfileSnapshot(GeoBrowserProfileConfiguration, _ProfileSnapshot):
    pass


GeoRunProfileSnapshot = Annotated[
    GeoRunManualProfileSnapshot | GeoRunApiProfileSnapshot | GeoRunBrowserProfileSnapshot,
    Field(discriminator="collection_mode"),
]


class GeoRunAliasSnapshot(ContractModel):
    alias: Annotated[NonEmpty, Field(max_length=240)]
    normalized_alias: Annotated[NonEmpty, Field(max_length=240)]
    alias_kind: GeoSubjectAliasKind
    language_code: str | None


class GeoRunDomainSnapshot(ContractModel):
    hostname: GeoSubjectHostname
    relation_type: GeoSubjectDomainRelationType


class GeoRunSubjectSnapshot(ContractModel):
    model_config = {
        "json_schema_extra": {
            "if": {"properties": {"subject_type": {"const": "OWN_PRODUCT"}}},
            "then": {"properties": {"product_id": {"type": "string", "format": "uuid"}}},
            "else": {"properties": {"product_id": {"type": "null"}}},
        }
    }
    id: UUID
    revision: Revision
    subject_type: GeoSubjectType
    role: GeoPlanSubjectRole
    product_id: UUID | None
    parent_subject_id: UUID | None
    canonical_name: Annotated[NonEmpty, Field(max_length=240)]
    # OWN_PRODUCT 展示名称由 160 字符品牌 + 空格 + 160 字符型号组成。
    display_name: Annotated[NonEmpty, Field(max_length=321)]
    aliases: list[GeoRunAliasSnapshot]
    domains: list[GeoRunDomainSnapshot]

    @model_validator(mode="after")
    def product_identity(self) -> Self:
        if (self.subject_type == GeoSubjectType.OWN_PRODUCT) != (self.product_id is not None):
            raise ValueError("自有产品必须有 Product 身份，其他监测类型不得绑定 Product")
        return self


class GeoRunInputSnapshot(ContractModel):
    schema_version: Literal[1]
    data_classification: GeoRunDataClassification
    prompt: GeoRunPromptSnapshot
    profile: GeoRunProfileSnapshot
    subjects: list[GeoRunSubjectSnapshot] = Field(
        min_length=1,
        json_schema_extra={
            "contains": {"properties": {"role": {"const": "PRIMARY"}}, "required": ["role"]},
            "minContains": 1,
        },
    )
    rule_set_revision: Positive

    @model_validator(mode="after")
    def subjects_unique_and_primary(self) -> Self:
        require_unique_items([item.id for item in self.subjects])
        if not any(item.role == GeoPlanSubjectRole.PRIMARY for item in self.subjects):
            raise ValueError("运行快照至少需要一个 PRIMARY")
        return self


def _batch_plan_schema(schema: dict[str, Any]) -> None:
    # 复用计划权威配置中的 CRON 条件，快照只补身份配对约束。
    schema["allOf"] = GeoMonitoringPlanConfiguration.model_json_schema()["allOf"]
    schema["oneOf"] = [
        {"properties": {"plan_id": {"type": "null"}, "plan_revision": {"type": "null"}}},
        {"properties": {"plan_id": {"type": "string"}, "plan_revision": {"type": "integer"}}},
    ]


class GeoBatchPlanSnapshot(GeoMonitoringPlanConfiguration):
    model_config = {"json_schema_extra": _batch_plan_schema}
    schema_version: Literal[1]
    plan_id: UUID | None
    plan_revision: Revision | None

    @model_validator(mode="after")
    def source_pair(self) -> Self:
        if (self.plan_id is None) != (self.plan_revision is None):
            raise ValueError("计划身份与修订必须成对，临时批次两者为空")
        return self


class GeoBatchRuleSnapshot(ContractModel):
    schema_version: Literal[1]
    rule_set_revision: Positive


class GeoObservationBatchOut(ContractModel):
    """基础数据组件；不是 GEO-306 的详情、汇总或动作投影。"""

    id: UUID
    plan_id: UUID | None
    trigger_type: GeoBatchTriggerType
    status: GeoBatchStatus
    revision: Revision
    scheduled_for: AwareDatetime | None
    schedule_identity: Sha256 | None
    plan_snapshot: GeoBatchPlanSnapshot
    rule_snapshot: GeoBatchRuleSnapshot
    requested_run_count: Positive
    source_opportunity_id: UUID | None
    baseline_batch_id: UUID | None
    created_by: UUID | None
    started_at: AwareDatetime | None
    finished_at: AwareDatetime | None
    created_at: AwareDatetime


class GeoObservationRunOut(ContractModel):
    """lease_token 是执行授权信息，只有数据库内部使用，公共组件不暴露。"""

    id: UUID
    batch_id: UUID
    prompt_variant_id: UUID
    collection_profile_id: UUID
    run_cell_key: Sha256
    repeat_index: Annotated[int, Field(strict=True, ge=1, le=10)]
    attempt_no: Positive
    previous_attempt_id: UUID | None
    status: GeoRunStatus
    revision: Revision
    input_snapshot: GeoRunInputSnapshot
    external_call_state: GeoExternalCallState
    lease_expires_at: AwareDatetime | None
    dispatch_attempt_count: NonNegative
    last_dispatch_attempt_at: AwareDatetime | None
    error_stage: GeoRunErrorStage | None
    error_code: GeoRunErrorCode | None
    error_summary: Annotated[NonEmpty, Field(max_length=500)] | None
    provider_request_id: Annotated[NonEmpty, Field(max_length=200)] | None
    provider_status: int | None = Field(strict=True, ge=100, le=599)
    retry_after_seconds: int | None = Field(strict=True, ge=0)
    duration_ms: NonNegative | None
    cost_amount: PlanBudget | None
    cost_currency: (
        Annotated[str, Field(strict=True, pattern=re.compile(r"^[A-Z]{3}$(?![\s\S])"))] | None
    )
    prompt_tokens: NonNegative | None
    completion_tokens: NonNegative | None
    total_tokens: NonNegative | None
    started_at: AwareDatetime | None
    collected_at: AwareDatetime | None
    finished_at: AwareDatetime | None
    created_at: AwareDatetime
