"""由冻结 OpenAPI 契约映射的 Pydantic 请求与响应类型。"""

from __future__ import annotations

import uuid
from collections.abc import Hashable
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, HttpUrl, model_validator


def require_unique_items[UniqueItem: Hashable](values: list[UniqueItem]) -> list[UniqueItem]:
    """在请求解析边界拒绝重复集合项，与 OpenAPI `uniqueItems` 保持一致。"""
    if len(values) != len(set(values)):
        raise ValueError("列表项不得重复")
    return values


class ContractModel(BaseModel):
    """禁止静默接受契约外字段。"""

    model_config = ConfigDict(extra="forbid", from_attributes=True)


class RoleName(StrEnum):
    SYSTEM_ADMIN = "SYSTEM_ADMIN"
    PRODUCT_EDITOR = "PRODUCT_EDITOR"
    PRODUCT_REVIEWER = "PRODUCT_REVIEWER"
    CONTENT_EDITOR = "CONTENT_EDITOR"
    CONTENT_REVIEWER = "CONTENT_REVIEWER"
    ANALYST = "ANALYST"


class UserOut(ContractModel):
    id: uuid.UUID
    username: str
    display_name: str
    roles: list[RoleName]
    is_active: bool
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
    roles: Annotated[list[RoleName], AfterValidator(require_unique_items)] = Field(
        min_length=1, json_schema_extra={"uniqueItems": True}
    )


class UserUpdate(ContractModel):
    expected_revision: int = Field(ge=0)
    display_name: str = Field(min_length=1)
    roles: Annotated[list[RoleName], AfterValidator(require_unique_items)] = Field(
        min_length=1, json_schema_extra={"uniqueItems": True}
    )
    is_active: bool


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
    rules: PlatformRules


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
    active_version: PlatformProfileVersionOut


class PlatformProfileList(ContractModel):
    items: list[PlatformProfileOut]


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
    status: Literal["OPEN", "COMPLETED", "CANCELLED"]
    revision: int
    created_by: uuid.UUID
    created_at: datetime


class ContentTaskList(ContractModel):
    items: list[ContentTaskOut]


class GenerationJobOut(ContractModel):
    id: uuid.UUID
    content_task_id: uuid.UUID
    status: Literal["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]
    attempt_count: int
    content_version_id: uuid.UUID | None = None
    retry_of_id: uuid.UUID | None = None
    error_code: str | None = None
    error_summary: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class GenerationJobList(ContractModel):
    items: list[GenerationJobOut]


class QualityIssue(ContractModel):
    code: str
    severity: Literal["WARNING", "BLOCKING"]
    message: str


class ContentVersionOut(ContractModel):
    id: uuid.UUID
    task_id: uuid.UUID
    fact_version_id: uuid.UUID
    version: int
    source_type: Literal["AI", "HUMAN"]
    title: str
    summary: str
    body_markdown: str
    tags: list[str]
    used_fact_ids: list[str] = Field(default_factory=list)
    used_evidence_ids: list[str] = Field(default_factory=list)
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


class PublicationRecordList(ContractModel):
    items: list[PublicationRecordOut]
    page: int
    page_size: int
    total: int


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
    """开发生成器也必须遵循真实适配器的结构化输出边界。"""

    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    body_markdown: str = Field(min_length=1)
    tags: list[str]
    used_fact_ids: list[str]
    used_evidence_ids: list[str]
    required_disclosure_ids: list[str]
    review_warnings: list[str]


JsonObject = dict[str, Any]
