"""由冻结 OpenAPI 契约映射的 Pydantic 请求与响应类型。"""

from __future__ import annotations

import json
import uuid
from collections.abc import Hashable
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    field_validator,
    model_validator,
)


def require_unique_items[UniqueItem: Hashable](values: list[UniqueItem]) -> list[UniqueItem]:
    """在请求解析边界拒绝重复集合项，与 OpenAPI `uniqueItems` 保持一致。"""
    if len(values) != len(set(values)):
        raise ValueError("列表项不得重复")
    return values


class ContractModel(BaseModel):
    """禁止静默接受契约外字段。"""

    model_config = ConfigDict(extra="forbid", from_attributes=True)


class AccountType(StrEnum):
    ADMIN = "ADMIN"
    ENGINEER = "ENGINEER"


class UserOut(ContractModel):
    id: uuid.UUID
    username: str
    display_name: str
    account_type: AccountType
    is_active: bool
    must_change_password: bool
    revision: int
    created_at: datetime


class UserList(ContractModel):
    items: list[UserOut]
    page: int
    page_size: int
    total: int


class LoginRequest(ContractModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=8)


class AuthSession(ContractModel):
    user: UserOut
    csrf_token: str


class CsrfToken(ContractModel):
    csrf_token: str


class UserCreate(ContractModel):
    username: str = Field(min_length=3)
    display_name: str = Field(min_length=1)
    password: str = Field(min_length=12)
    account_type: AccountType


class UserUpdate(ContractModel):
    expected_revision: int = Field(ge=0)
    display_name: str = Field(min_length=1)
    account_type: AccountType
    is_active: bool


class ResetPasswordRequest(ContractModel):
    temporary_password: str = Field(min_length=12)


class ChangePasswordRequest(ContractModel):
    old_password: str = Field(min_length=8)
    new_password: str = Field(min_length=12)


class AuditLogOut(ContractModel):
    id: uuid.UUID
    actor_id: uuid.UUID
    action: str
    target_type: str
    target_id: uuid.UUID
    change_summary: dict[str, Any]
    request_id: str
    created_at: datetime


class AuditLogList(ContractModel):
    items: list[AuditLogOut]
    page: int
    page_size: int
    total: int


class HealthResponse(ContractModel):
    status: Literal["ok"]
    checks: dict[str, str] | None = None


class CommandRequest(ContractModel):
    expected_revision: int = Field(ge=0)
    comment: str


class RequestChangesCommand(ContractModel):
    """退回命令必须携带可读意见，不能只提交空白字符。"""

    expected_revision: int = Field(ge=0)
    comment: str = Field(min_length=1)

    @field_validator("comment")
    @classmethod
    def validate_comment(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("退回意见不能为空")
        return trimmed


class RevisionRequest(ContractModel):
    expected_revision: int = Field(ge=0)


class ProductStatus(StrEnum):
    ACTIVE = "ACTIVE"
    RETIRED = "RETIRED"


class ProductCreate(ContractModel):
    part_number: str = Field(min_length=1)
    brand: str = Field(min_length=1)
    category: str = Field(min_length=1)


class ProductUpdate(ContractModel):
    expected_revision: int = Field(ge=0)
    part_number: str
    brand: str
    category: str
    status: ProductStatus


class ProductOut(ContractModel):
    id: uuid.UUID
    part_number: str
    brand: str
    category: str
    status: ProductStatus
    revision: int
    created_at: datetime
    updated_at: datetime


class ProductList(ContractModel):
    items: list[ProductOut]
    page: int
    page_size: int
    total: int


class ReferencePartData(ContractModel):
    client_key: str
    part_number: str
    manufacturer: str
    category: str


class ParameterValueType(StrEnum):
    NUMERIC = "NUMERIC"
    RANGE = "RANGE"
    TEXT = "TEXT"


class PartParameterData(ContractModel):
    client_key: str
    owner_key: str
    key: str
    name: str
    value_type: ParameterValueType
    min_value: float | None = None
    typical_value: float | None = None
    max_value: float | None = None
    text_value: str | None = None
    unit: str
    test_conditions: str
    is_critical: bool
    evidence_keys: Annotated[list[str], AfterValidator(require_unique_items)] = Field(
        json_schema_extra={"uniqueItems": True}
    )

    @model_validator(mode="after")
    def validate_value_shape(self) -> PartParameterData:
        """参数值形态必须与声明类型一致，禁止猜测缺失值。"""
        numeric = [self.min_value, self.typical_value, self.max_value]
        if self.value_type == ParameterValueType.TEXT:
            if not self.text_value or any(value is not None for value in numeric):
                raise ValueError("TEXT 参数只能提供非空 text_value")
        elif self.value_type == ParameterValueType.NUMERIC:
            if self.typical_value is None or self.text_value is not None:
                raise ValueError("NUMERIC 参数必须提供 typical_value")
        elif all(value is None for value in numeric) or self.text_value is not None:
            raise ValueError("RANGE 参数必须至少提供一个数值边界")
        return self


class ReplacementLevel(StrEnum):
    FUNCTIONALLY_SIMILAR = "FUNCTIONALLY_SIMILAR"
    PARAMETER_COMPATIBLE = "PARAMETER_COMPATIBLE"
    PIN_COMPATIBLE = "PIN_COMPATIBLE"
    PIN_TO_PIN = "PIN_TO_PIN"
    PROTOTYPE_VALIDATED = "PROTOTYPE_VALIDATED"
    TEMPERATURE_VALIDATED = "TEMPERATURE_VALIDATED"
    MASS_PRODUCTION_VALIDATED = "MASS_PRODUCTION_VALIDATED"


class ReplacementRelationData(ContractModel):
    client_key: str
    reference_part_key: str
    replacement_level: ReplacementLevel
    conditions: str = Field(min_length=1)
    exclusions: str = Field(min_length=1)
    evidence_keys: Annotated[list[str], AfterValidator(require_unique_items)] = Field(
        min_length=1, json_schema_extra={"uniqueItems": True}
    )


class EvidenceType(StrEnum):
    DATASHEET = "DATASHEET"
    TEST_REPORT = "TEST_REPORT"
    APPLICATION_NOTE = "APPLICATION_NOTE"
    CUSTOMER_AUTHORIZATION = "CUSTOMER_AUTHORIZATION"
    OTHER = "OTHER"


class Confidentiality(StrEnum):
    PUBLIC = "PUBLIC"
    INTERNAL = "INTERNAL"
    RESTRICTED = "RESTRICTED"


class EvidenceData(ContractModel):
    client_key: str
    type: EvidenceType
    title: str
    version: str
    source_url: HttpUrl | None = None
    file_id: uuid.UUID | None = None
    confidentiality: Confidentiality


class ClaimType(StrEnum):
    APPROVED = "APPROVED"
    PROHIBITED = "PROHIBITED"
    REQUIRED_DISCLOSURE = "REQUIRED_DISCLOSURE"


class FactClaimData(ContractModel):
    client_key: str
    type: ClaimType
    text: str = Field(min_length=1)
    evidence_keys: Annotated[list[str], AfterValidator(require_unique_items)] = Field(
        json_schema_extra={"uniqueItems": True}
    )


class ProductFactsBody(ContractModel):
    reference_parts: list[ReferencePartData]
    parameters: list[PartParameterData]
    replacement_relations: list[ReplacementRelationData]
    evidences: list[EvidenceData]
    claims: list[FactClaimData]


class ProductFactsDraftUpdate(ProductFactsBody):
    expected_revision: int = Field(ge=0)


class ProductFactsDraft(ProductFactsBody):
    product_id: uuid.UUID
    revision: int


class CreateVersionRequest(ContractModel):
    change_summary: str = Field(min_length=1)


class FactVersionStatus(StrEnum):
    DRAFT = "DRAFT"
    PENDING_REVIEW = "PENDING_REVIEW"
    CHANGES_REQUESTED = "CHANGES_REQUESTED"
    APPROVED = "APPROVED"
    RETIRED = "RETIRED"


class FactVersionOut(ContractModel):
    id: uuid.UUID
    product_id: uuid.UUID
    version: int
    status: FactVersionStatus
    snapshot: ProductFactsBody
    change_summary: str
    revision: int
    created_by: uuid.UUID
    approved_by: uuid.UUID | None = None
    created_at: datetime
    approved_at: datetime | None = None


class FactVersionList(ContractModel):
    items: list[FactVersionOut]


class IntentType(StrEnum):
    BRAND = "BRAND"
    PRODUCT = "PRODUCT"
    REPLACEMENT = "REPLACEMENT"
    COMPARISON = "COMPARISON"
    APPLICATION = "APPLICATION"
    TROUBLESHOOTING = "TROUBLESHOOTING"


class QueryTopicCreate(ContractModel):
    canonical_question: str = Field(min_length=1)
    intent_type: IntentType
    variants: Annotated[list[str], AfterValidator(require_unique_items)] = Field(
        min_length=1, json_schema_extra={"uniqueItems": True}
    )


class QueryTopicUpdate(QueryTopicCreate):
    expected_revision: int = Field(ge=0)


class QueryTopicOut(QueryTopicCreate):
    id: uuid.UUID
    revision: int
    created_at: datetime


class QueryTopicList(ContractModel):
    items: list[QueryTopicOut]


class PlatformSection(ContractModel):
    name: str
    url: HttpUrl


class PlatformRules(ContractModel):
    target_audience: str
    title_min: int = Field(ge=1)
    title_max: int = Field(ge=1)
    body_min: int = Field(ge=1)
    body_max: int = Field(ge=1)
    tone: str
    allow_external_links: bool
    allow_tables: bool
    allow_contact: bool
    prohibited_phrases: list[str]
    sections: list[PlatformSection]

    @model_validator(mode="after")
    def validate_ranges(self) -> PlatformRules:
        """平台规则的最小值不能大于最大值。"""
        if self.title_min > self.title_max or self.body_min > self.body_max:
            raise ValueError("平台标题或正文长度范围无效")
        return self


class PlatformProfileCreate(ContractModel):
    name: str
    slug: str = Field(pattern=r"^[a-z0-9-]+$")
    allowed_domains: Annotated[list[str], AfterValidator(require_unique_items)] = Field(
        min_length=1, json_schema_extra={"uniqueItems": True}
    )
    platform_type_id: uuid.UUID
    rules: PlatformRules


class PlatformProfileUpdate(ContractModel):
    expected_revision: int = Field(ge=0)
    name: str = Field(min_length=1)
    allowed_domains: Annotated[list[str], AfterValidator(require_unique_items)] = Field(
        min_length=1, json_schema_extra={"uniqueItems": True}
    )
    platform_type_id: uuid.UUID


class PlatformProfileVersionCreate(ContractModel):
    rules: PlatformRules


class PlatformProfileVersionOut(ContractModel):
    id: uuid.UUID
    version: int
    status: Literal["DRAFT", "ACTIVE", "RETIRED"]
    rules: PlatformRules
    revision: int
    created_at: datetime


class PlatformProfileVersionList(ContractModel):
    items: list[PlatformProfileVersionOut]


class PlatformProfileOut(ContractModel):
    id: uuid.UUID
    name: str
    slug: str
    allowed_domains: list[str]
    platform_type_id: uuid.UUID | None
    revision: int
    active_version: PlatformProfileVersionOut


class PlatformProfileList(ContractModel):
    items: list[PlatformProfileOut]


class PlatformTypeCreate(ContractModel):
    name: str = Field(min_length=1)
    slug: str = Field(pattern=r"^[a-z0-9-]+$")


class PlatformTypeUpdate(PlatformTypeCreate):
    expected_revision: int = Field(ge=0)


class PlatformTypeOut(PlatformTypeCreate):
    id: uuid.UUID
    revision: int
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class PlatformTypeList(ContractModel):
    items: list[PlatformTypeOut]


class PlatformPromptPut(ContractModel):
    template_markdown: str = Field(min_length=1)
    expected_revision: int | None = Field(ge=0)


class PlatformPromptOut(ContractModel):
    platform_type_id: uuid.UUID
    template_markdown: str
    revision: int
    updated_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class AIChannelHeaderOut(ContractModel):
    id: uuid.UUID
    name: str
    is_sensitive: bool
    is_configured: bool
    value: str | None = None


class AIChannelHeaderCreate(ContractModel):
    expected_channel_revision: int = Field(ge=0)
    name: str = Field(min_length=1)
    value: str = Field(min_length=1)
    is_sensitive: bool


class AIChannelHeaderUpdate(AIChannelHeaderCreate):
    pass


class AIChannelCreate(ContractModel):
    name: str = Field(min_length=1)
    base_url: HttpUrl
    api_key: str = Field(min_length=1)
    timeout_seconds: int = Field(ge=10, le=600)


class AIChannelUpdate(ContractModel):
    expected_revision: int = Field(ge=0)
    name: str = Field(min_length=1)
    base_url: HttpUrl
    timeout_seconds: int = Field(ge=10, le=600)


class AIChannelApiKeyReplace(ContractModel):
    expected_revision: int = Field(ge=0)
    api_key: str = Field(min_length=1)


class AIChannelOut(ContractModel):
    id: uuid.UUID
    name: str
    base_url: HttpUrl
    timeout_seconds: int
    is_enabled: bool
    api_key_configured: bool
    api_key_updated_at: datetime
    headers: list[AIChannelHeaderOut]
    revision: int
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class AIChannelList(ContractModel):
    items: list[AIChannelOut]


RESERVED_MODEL_PARAMETERS = {"model", "messages", "stream"}


class AIModelCreate(ContractModel):
    display_name: str = Field(min_length=1)
    model_id: str = Field(min_length=1)
    request_parameters: dict[str, Any]

    @model_validator(mode="after")
    def reject_reserved_parameters(self) -> AIModelCreate:
        """系统字段只能由正式请求构造器写入。"""
        reserved = RESERVED_MODEL_PARAMETERS.intersection(self.request_parameters)
        if reserved:
            raise ValueError(f"模型参数包含系统保留字段：{', '.join(sorted(reserved))}")
        if self.model_id != self.model_id.strip() or any(
            ord(character) < 32 or ord(character) == 127 for character in self.model_id
        ):
            raise ValueError("model_id 不能包含首尾空白或控制字符")
        try:
            json.dumps(self.request_parameters, allow_nan=False)
        except (TypeError, ValueError) as error:
            raise ValueError("模型参数必须是标准 JSON 值") from error
        return self


class AIModelUpdate(AIModelCreate):
    expected_revision: int = Field(ge=0)


class AIModelTestStatus(StrEnum):
    UNTESTED = "UNTESTED"
    PASSED = "PASSED"
    FAILED = "FAILED"


class AIModelOut(AIModelCreate):
    id: uuid.UUID
    channel_id: uuid.UUID
    is_enabled: bool
    test_status: AIModelTestStatus
    last_tested_at: datetime | None = None
    last_test_error_summary: str | None = None
    revision: int
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class AIModelList(ContractModel):
    items: list[AIModelOut]


class DiscoveredModel(ContractModel):
    model_id: str


class DiscoveredModelList(ContractModel):
    items: list[DiscoveredModel]


class ContentTaskCreate(ContractModel):
    query_topic_id: uuid.UUID
    product_id: uuid.UUID
    fact_version_id: uuid.UUID
    platform_profile_version_id: uuid.UUID
    target_audience: str
    content_angle: str
    conversion_goal: str
    desired_format: str
    desired_length_min: int = Field(ge=1)
    desired_length_max: int = Field(ge=1)
    canonical_url: HttpUrl

    @model_validator(mode="after")
    def validate_length(self) -> ContentTaskCreate:
        if self.desired_length_min > self.desired_length_max:
            raise ValueError("期望正文最小长度不能大于最大长度")
        return self


class ContentTaskOut(ContentTaskCreate):
    id: uuid.UUID
    platform_type_id: uuid.UUID | None
    platform_type_snapshot: dict[str, Any] | None
    user_prompt_markdown: str
    generation_data_classification: Confidentiality | None
    generation_data_classified_by: uuid.UUID | None
    generation_data_classified_at: datetime | None
    source_publication_attention_id: uuid.UUID | None
    available_actions: list[Literal["CANCEL"]]
    status: Literal["OPEN", "COMPLETED", "CANCELLED"]
    revision: int
    created_by: uuid.UUID
    created_at: datetime


class ContentTaskList(ContractModel):
    items: list[ContentTaskOut]


class ContentTaskUserPromptUpdate(ContractModel):
    expected_revision: int = Field(ge=0)
    user_prompt_markdown: str
    generation_data_classification: Confidentiality


class GenerationOptionModel(ContractModel):
    id: uuid.UUID
    channel_id: uuid.UUID
    channel_name: str
    display_name: str
    model_id: str


class GenerationOptions(ContractModel):
    platform_profile_version_id: uuid.UUID
    platform_profile_name: str
    platform_type_id: uuid.UUID
    platform_type_name: str
    platform_type_slug: str
    system_prompt_markdown: str
    models: list[GenerationOptionModel]


class GenerationJobCreate(ContractModel):
    ai_model_id: uuid.UUID


class GenerationJobOut(ContractModel):
    id: uuid.UUID
    content_task_id: uuid.UUID
    status: Literal["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]
    attempt_count: int
    content_version_id: uuid.UUID | None = None
    retry_of_id: uuid.UUID | None = None
    error_code: str | None = None
    error_summary: str | None = None
    provider_request_id: str | None = None
    response_duration_ms: int | None = Field(default=None, ge=0)
    prompt_tokens: int | None = Field(default=None, ge=0)
    completion_tokens: int | None = Field(default=None, ge=0)
    total_tokens: int | None = Field(default=None, ge=0)
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class GenerationJobList(ContractModel):
    items: list[GenerationJobOut]


class GenerationSnapshot(ContractModel):
    adapter_name: str
    contract_version: str
    channel: dict[str, Any]
    model: dict[str, Any]
    platform_type: dict[str, Any]
    system_message: str
    user_prompt_markdown: str
    # 0012 之前的不可变历史快照没有分级字段；新建或重试第三方作业必须显式校验。
    generation_data_classification: Confidentiality | None = None
    generation_data_classified_by: uuid.UUID | None = None
    generation_data_classified_at: datetime | None = None
    approved_facts: dict[str, Any]
    task_requirements: dict[str, Any]
    user_message: str


class GenerationJobDetail(GenerationJobOut):
    input_snapshot: GenerationSnapshot


class QualityIssue(ContractModel):
    code: str
    severity: Literal["WARNING", "BLOCKING"]
    message: str


class ContentVersionOut(ContractModel):
    id: uuid.UUID
    task_id: uuid.UUID
    fact_version_id: uuid.UUID
    source_job_id: uuid.UUID | None
    based_on_id: uuid.UUID | None
    version: int
    source_type: Literal["AI", "HUMAN"]
    title: str
    summary: str
    body_markdown: str
    tags: list[str]
    content_hash: str
    status: Literal["DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SUPERSEDED"]
    revision: int
    quality_issues: list[QualityIssue]
    created_by: uuid.UUID
    created_at: datetime


class ContentRevisionCreate(ContractModel):
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    body_markdown: str = Field(min_length=1)
    tags: list[str]
    change_summary: str = Field(min_length=1)


class ContentVersionList(ContractModel):
    items: list[ContentVersionOut]


class DiffLine(ContractModel):
    kind: Literal["EQUAL", "ADD", "DELETE"]
    old_line: int | None = None
    new_line: int | None = None
    text: str


class ContentDiff(ContractModel):
    left_id: uuid.UUID
    right_id: uuid.UUID
    lines: list[DiffLine]


class ActorSummary(ContractModel):
    id: uuid.UUID
    username: str
    display_name: str


class ReviewRecord(ContractModel):
    id: uuid.UUID
    target_id: uuid.UUID
    target_version: int
    action: str
    comment: str
    actor: ActorSummary
    created_at: datetime


class ReviewEvidenceStatus(ContractModel):
    client_key: str
    file_id: uuid.UUID | None
    file_status: Literal["PENDING", "VERIFIED", "FAILED", "ABORTED"] | None


class FactReviewContext(ContractModel):
    fact_version: FactVersionOut
    evidence_statuses: list[ReviewEvidenceStatus]
    available_actions: list[Literal["SUBMIT", "APPROVE", "REQUEST_CHANGES", "RETIRE"]]
    review_history: list[ReviewRecord]


class GenerationTrace(ContractModel):
    job_id: uuid.UUID
    input_snapshot: GenerationSnapshot


class ContentReviewContext(ContractModel):
    content: ContentVersionOut
    task: ContentTaskOut
    fact_version: FactVersionOut
    evidence_statuses: list[ReviewEvidenceStatus]
    diff: ContentDiff | None
    generation_trace: GenerationTrace | None
    available_actions: list[Literal["SUBMIT_REVIEW", "APPROVE", "REQUEST_CHANGES"]]
    review_history: list[ReviewRecord]


class PublicationPackage(ContractModel):
    content_version_id: uuid.UUID
    fact_version_id: uuid.UUID
    title: str
    body_markdown: str
    body_html: str
    body_text: str
    tags: list[str]
    canonical_url: HttpUrl
    content_hash: str


class PlatformAccountCreate(ContractModel):
    platform_profile_id: uuid.UUID
    label: str
    account_identifier: str


class PlatformAccountOut(PlatformAccountCreate):
    id: uuid.UUID
    is_active: bool


class PlatformAccountList(ContractModel):
    items: list[PlatformAccountOut]


class ManualPublicationCreate(ContractModel):
    content_version_id: uuid.UUID
    platform_account_id: uuid.UUID
    section_url: HttpUrl
    attachment_file_ids: Annotated[
        list[uuid.UUID], AfterValidator(require_unique_items)
    ] = Field(default_factory=list, json_schema_extra={"uniqueItems": True})


class PublicationCommand(ContractModel):
    actual_title: str | None = None
    final_url: HttpUrl | None = None
    published_at: datetime | None = None
    content_matches: bool | None = None
    comment: str


class PublicationStatus(StrEnum):
    PENDING_MANUAL_PUBLISH = "PENDING_MANUAL_PUBLISH"
    PLATFORM_REVIEW = "PLATFORM_REVIEW"
    PUBLISHED = "PUBLISHED"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
    REMOVED = "REMOVED"
    VERIFICATION_FAILED = "VERIFICATION_FAILED"


class PublicationEvent(ContractModel):
    status: PublicationStatus
    comment: str
    actor_id: uuid.UUID
    created_at: datetime


class FileRecordOut(ContractModel):
    id: uuid.UUID
    category: Literal["EVIDENCE", "OPERATION_SCREENSHOT", "PUBLICATION_ASSET"]
    original_filename: str
    object_key: str
    content_type: str
    size: int
    sha256: str
    access_level: Confidentiality
    status: Literal["PENDING", "VERIFIED", "FAILED", "ABORTED"]
    created_at: datetime
    verified_at: datetime | None = None


class PublicationRecordOut(ContractModel):
    id: uuid.UUID
    content_version_id: uuid.UUID
    task_id: uuid.UUID
    platform_account_id: uuid.UUID
    section_url: HttpUrl
    actual_title: str | None = None
    final_url: HttpUrl | None = None
    published_at: datetime | None = None
    status: PublicationStatus
    content_hash: str
    created_by: uuid.UUID
    created_at: datetime
    status_events: list[PublicationEvent]
    attachments: list[FileRecordOut]
    available_actions: list[
        Literal[
            "mark-platform-review",
            "mark-published",
            "verify",
            "reject",
            "remove",
            "mark-verification-failed",
        ]
    ]


class PublicationRecordList(ContractModel):
    items: list[PublicationRecordOut]
    page: int
    page_size: int
    total: int


class PublicationCandidate(ContractModel):
    content_version: ContentVersionOut
    task_id: uuid.UUID
    platform_profile_id: uuid.UUID
    platform_profile_name: str
    platform_profile_version_id: uuid.UUID
    platform_profile_version: int
    matching_accounts: list[PlatformAccountOut]


class PublicationCandidateList(ContractModel):
    items: list[PublicationCandidate]


class PublicationAttentionStatus(StrEnum):
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"


class PublicationAttentionOut(ContractModel):
    id: uuid.UUID
    publication_record_id: uuid.UUID
    original_task_id: uuid.UUID
    trigger_status: Literal["REMOVED", "VERIFICATION_FAILED"]
    status: PublicationAttentionStatus
    revision: int
    opened_at: datetime
    resolved_at: datetime | None
    resolved_by: uuid.UUID | None
    resolution_comment: str | None
    repair_task_id: uuid.UUID | None
    available_actions: list[Literal["CREATE_REPAIR_TASK", "RESOLVE"]]


class PublicationAttentionList(ContractModel):
    items: list[PublicationAttentionOut]


class VersionChange(ContractModel):
    field: str
    before: Any
    after: Any


class VersionDifference(ContractModel):
    from_id: uuid.UUID
    to_id: uuid.UUID
    changes: list[VersionChange]


class FactVersionCandidate(ContractModel):
    version: FactVersionOut
    difference: VersionDifference


class PlatformVersionCandidate(ContractModel):
    version: PlatformProfileVersionOut
    difference: VersionDifference


class PublicationRepairDefaults(ContractModel):
    target_audience: str
    content_angle: str
    conversion_goal: str
    desired_format: str
    desired_length_min: int
    desired_length_max: int
    canonical_url: HttpUrl


class PublicationRepairContext(ContractModel):
    attention: PublicationAttentionOut
    publication: PublicationRecordOut
    original_task: ContentTaskOut
    product: ProductOut
    query_topic: QueryTopicOut
    platform_profile_id: uuid.UUID
    platform_profile_name: str
    original_fact_version: FactVersionOut
    fact_candidates: list[FactVersionCandidate]
    original_platform_version: PlatformProfileVersionOut
    platform_candidates: list[PlatformVersionCandidate]
    defaults: PublicationRepairDefaults


class PublicationRepairTaskCreate(ContractModel):
    expected_attention_revision: int = Field(ge=0)
    fact_version_id: uuid.UUID
    platform_profile_version_id: uuid.UUID
    target_audience: str = Field(min_length=1)
    content_angle: str = Field(min_length=1)
    conversion_goal: str = Field(min_length=1)
    desired_format: str = Field(min_length=1)
    desired_length_min: int = Field(ge=1)
    desired_length_max: int = Field(ge=1)
    canonical_url: HttpUrl

    @model_validator(mode="after")
    def validate_length(self) -> PublicationRepairTaskCreate:
        if self.desired_length_min > self.desired_length_max:
            raise ValueError("期望正文最小长度不能大于最大长度")
        return self


class ResolvePublicationAttentionRequest(ContractModel):
    expected_revision: int = Field(ge=0)
    resolution_comment: str = Field(min_length=1)

    @field_validator("resolution_comment")
    @classmethod
    def validate_resolution_comment(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("处置说明不能为空")
        return trimmed


class GeoCitation(ContractModel):
    url: HttpUrl
    source_type: Literal["OFFICIAL", "EXTERNAL_COMPANY", "OTHER"]
    publication_record_id: uuid.UUID | None = None


class GeoObservationCreate(ContractModel):
    query_topic_id: uuid.UUID
    product_id: uuid.UUID
    actual_prompt: str
    model_name: str
    model_version: str | None = None
    tested_at: datetime
    web_search_enabled: bool
    answer_summary: str
    mentioned: bool
    recommendation: Literal["NONE", "CANDIDATE", "RECOMMENDED"]
    accuracy: Literal["ACCURATE", "PARTIAL", "INCORRECT", "UNJUDGEABLE"]
    citations: list[GeoCitation]
    publication_record_ids: Annotated[
        list[uuid.UUID], AfterValidator(require_unique_items)
    ] = Field(json_schema_extra={"uniqueItems": True})
    attachment_file_ids: Annotated[
        list[uuid.UUID], AfterValidator(require_unique_items)
    ] = Field(default_factory=list, json_schema_extra={"uniqueItems": True})
    notes: str
    supersedes_id: uuid.UUID | None = None


class GeoObservationOut(GeoObservationCreate):
    id: uuid.UUID
    tested_by: uuid.UUID
    created_at: datetime


class GeoObservationList(ContractModel):
    items: list[GeoObservationOut]


class GeoMetrics(ContractModel):
    sample_count: int
    mention_rate: float = Field(ge=0, le=1)
    recommendation_rate: float = Field(ge=0, le=1)
    citation_rate: float = Field(ge=0, le=1)
    accuracy_rate: float | None = Field(ge=0, le=1)


class DashboardSummary(ContractModel):
    pending_fact_reviews: int = Field(ge=0)
    pending_content_reviews: int = Field(ge=0)
    pending_publications: int = Field(ge=0)
    publication_attention: int = Field(ge=0)
    recent_accuracy_errors: int = Field(ge=0)


class UploadIntentCreate(ContractModel):
    category: Literal["EVIDENCE", "OPERATION_SCREENSHOT", "PUBLICATION_ASSET"]
    original_filename: str
    content_type: str
    size: int = Field(ge=1)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    access_level: Confidentiality


class UploadInstruction(ContractModel):
    method: Literal["PUT", "POST"]
    url: HttpUrl
    headers: dict[str, str]
    fields: dict[str, str]
    expires_at: datetime


class UploadIntent(ContractModel):
    file: FileRecordOut
    upload: UploadInstruction


class SignedUrl(ContractModel):
    url: HttpUrl
    expires_at: datetime


class GeneratedDraft(ContractModel):
    """开发与真实模型共同遵循的严格四字段输出边界。"""

    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    body_markdown: str = Field(min_length=1)
    tags: list[Annotated[str, Field(min_length=1)]] = Field(min_length=1)

    @model_validator(mode="after")
    def reject_blank_output(self) -> GeneratedDraft:
        """拒绝仅由空白组成的正文或标签，不替模型修复内容。"""
        if not self.title.strip() or not self.summary.strip() or not self.body_markdown.strip():
            raise ValueError("模型输出字段不能为空白")
        if any(not item.strip() for item in self.tags):
            raise ValueError("模型输出标签不能为空白")
        return self


JsonObject = dict[str, Any]
