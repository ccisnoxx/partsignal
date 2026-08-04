"""目标问题、平台与 AI 配置 Schema。"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, Field, HttpUrl, model_validator

from app.schemas.base import ContractModel, require_unique_items
from app.schemas.common import DeletionProjection, SignedUrl


def normalize_platform_name(value: str) -> str:
    """平台名称只保存去除首尾空白后的非空值。"""
    normalized = value.strip()
    if not normalized:
        raise ValueError("平台名称不能为空")
    return normalized


def normalize_platform_domain(value: str) -> str:
    """把单个允许域名转换为小写 IDNA ASCII 主机名。"""
    candidate = value.strip().removesuffix(".")
    if not candidate or any(character in candidate for character in "/?#@:*"):
        raise ValueError("允许域名必须是不含协议、路径、端口或通配符的主机名")
    try:
        normalized = candidate.encode("idna").decode("ascii").casefold()
    except UnicodeError as error:
        raise ValueError("允许域名不是有效的 IDNA 主机名") from error
    labels = normalized.split(".")
    if len(normalized) > 253 or any(
        not label
        or len(label) > 63
        or label.startswith("-")
        or label.endswith("-")
        or re.fullmatch(r"[a-z0-9-]+", label) is None
        for label in labels
    ):
        raise ValueError("允许域名不是有效的 DNS 主机名")
    return normalized


PlatformName = Annotated[
    str,
    Field(min_length=1, max_length=160),
    AfterValidator(normalize_platform_name),
]
PlatformPromptName = Annotated[
    str,
    Field(min_length=1, max_length=300),
    AfterValidator(normalize_platform_name),
]
PlatformDomain = Annotated[
    str,
    Field(min_length=1, max_length=253),
    AfterValidator(normalize_platform_domain),
]


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
    available_actions: list[Literal["UPDATE"]]
    primary_task: Literal["USE_FOR_OBSERVATION"]
    revision: int
    created_at: datetime


class QueryTopicList(ContractModel):
    items: list[QueryTopicOut]


class PlatformLogoUploadInput(ContractModel):
    source: Literal["UPLOAD"]
    file_id: uuid.UUID


PlatformLogoInput = PlatformLogoUploadInput


class PlatformLogoUploadOut(PlatformLogoUploadInput):
    url: HttpUrl


class PlatformLogoExternalOut(ContractModel):
    """部署前外链 Logo 的只读投影。"""

    source: Literal["EXTERNAL"]
    url: HttpUrl


PlatformLogoOut = Annotated[
    PlatformLogoUploadOut | PlatformLogoExternalOut,
    Field(discriminator="source"),
]


class PlatformProfileCreate(ContractModel):
    name: PlatformName
    slug: str = Field(pattern=r"^[a-z0-9-]+$")
    allowed_domains: Annotated[list[PlatformDomain], AfterValidator(require_unique_items)] = Field(
        min_length=1, json_schema_extra={"uniqueItems": True}
    )
    platform_type_id: uuid.UUID
    platform_prompt_id: uuid.UUID | None
    website_url: HttpUrl | None = None
    logo: PlatformLogoInput | None = None


class PlatformProfileUpdate(ContractModel):
    expected_revision: int = Field(ge=0)
    name: PlatformName
    allowed_domains: Annotated[list[PlatformDomain], AfterValidator(require_unique_items)] = Field(
        min_length=1, json_schema_extra={"uniqueItems": True}
    )
    platform_type_id: uuid.UUID
    platform_prompt_id: uuid.UUID | None
    website_url: HttpUrl | None
    logo: PlatformLogoInput | None = None


class PlatformLogoCandidateCreate(ContractModel):
    """从平台官网发现单个待管理员确认的 Logo。"""

    website_url: HttpUrl


class PlatformLogoCandidate(ContractModel):
    """已经暂存到自有对象存储的单个 Logo 候选。"""

    file_id: uuid.UUID
    preview: SignedUrl


class PlatformProfileStatus(StrEnum):
    ENABLED = "ENABLED"
    DISABLED = "DISABLED"


class PlatformConfigurationStatus(StrEnum):
    COMPLETE = "COMPLETE"
    INCOMPLETE = "INCOMPLETE"


class PlatformTypeSummary(ContractModel):
    id: uuid.UUID
    name: str
    slug: str


class PlatformPromptReference(ContractModel):
    """平台和生成选项复用的当前 Prompt 摘要。"""

    id: uuid.UUID
    name: PlatformPromptName
    revision: int = Field(ge=0)
    updated_at: datetime


class PlatformProfileOut(ContractModel):
    id: uuid.UUID
    name: PlatformName
    slug: str
    allowed_domains: list[str]
    platform_type_id: uuid.UUID | None
    platform_type: PlatformTypeSummary | None
    website_url: HttpUrl | None
    logo: PlatformLogoOut | None
    revision: int
    is_active: bool
    platform_prompt: PlatformPromptReference | None
    configuration_complete: bool
    platform_account_count: int = Field(ge=0)
    workflow_stage: Literal["DISABLED", "GENERATION_UNCONFIGURED", "OPERATIONAL"]
    primary_task: Literal["ENABLE_PLATFORM", "CONFIGURE_GENERATION", "VIEW_PLATFORM_OPERATION"]
    available_actions: list[Literal["UPDATE", "ENABLE", "DISABLE", "DELETE"]]
    deletion: DeletionProjection | None
    updated_at: datetime | None


class PlatformProfileSummary(ContractModel):
    platform_total: int = Field(ge=0)
    enabled_total: int = Field(ge=0)
    missing_prompt_total: int = Field(ge=0)
    configuration_complete_total: int = Field(ge=0)


class PlatformProfileList(ContractModel):
    items: list[PlatformProfileOut]
    page: int = Field(ge=1)
    page_size: int = Field(ge=0)
    total: int = Field(ge=0)
    summary: PlatformProfileSummary


class PlatformAccountSummary(ContractModel):
    total: int = Field(ge=0)
    enabled: int = Field(ge=0)
    disabled: int = Field(ge=0)


class PlatformReferenceSummary(ContractModel):
    as_of: datetime
    recent_30_days: int = Field(ge=0)
    all_time: int = Field(ge=0)


class PlatformProfileDetail(ContractModel):
    profile: PlatformProfileOut
    account_summary: PlatformAccountSummary
    reference_summary: PlatformReferenceSummary


class PlatformTypeCreate(ContractModel):
    name: str = Field(min_length=1)
    slug: str = Field(pattern=r"^[a-z0-9-]+$")


class PlatformTypeUpdate(PlatformTypeCreate):
    expected_revision: int = Field(ge=0)


class PlatformTypeOut(PlatformTypeCreate):
    id: uuid.UUID
    available_actions: list[Literal["UPDATE", "DELETE"]]
    deletion: DeletionProjection | None
    primary_task: Literal["EDIT_CATEGORY"]
    revision: int
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class PlatformTypeList(ContractModel):
    items: list[PlatformTypeOut]


class PlatformPromptCreate(ContractModel):
    name: PlatformPromptName
    template_markdown: str = Field(min_length=1)


class PlatformPromptUpdate(PlatformPromptCreate):
    expected_revision: int = Field(ge=0)


class PlatformPromptListItem(PlatformPromptReference):
    updated_by: uuid.UUID
    bound_platform_count: int = Field(ge=0)
    available_actions: list[Literal["UPDATE", "DELETE"]]


class PlatformPromptBoundPlatform(ContractModel):
    id: uuid.UUID
    name: PlatformName
    slug: str


class PlatformPromptDetail(PlatformPromptListItem):
    template_markdown: str
    created_at: datetime
    bound_platforms: list[PlatformPromptBoundPlatform]


class PlatformPromptList(ContractModel):
    items: list[PlatformPromptListItem]


class ContentHumanizationPromptPut(ContractModel):
    """首次创建或按修订号更新全局自然化 Prompt。"""

    template_markdown: str = Field(min_length=1)
    expected_revision: int | None = Field(ge=0)


class ContentHumanizationPromptOut(ContractModel):
    """全局自然化 Prompt 当前配置。"""

    template_markdown: str
    available_actions: list[Literal["UPDATE"]]
    revision: int
    updated_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class AIChannelHeaderOut(ContractModel):
    id: uuid.UUID
    name: str
    is_sensitive: bool
    is_configured: bool
    available_actions: list[Literal["UPDATE", "DELETE"]]
    primary_task: Literal["EDIT_HEADER", "RECONFIGURE_HEADER"]
    value: str | None = None


class AIChannelHeaderCreate(ContractModel):
    expected_channel_revision: int = Field(ge=0)
    name: str = Field(min_length=1)
    value: str = Field(min_length=1)
    is_sensitive: bool


class AIChannelHeaderUpdate(AIChannelHeaderCreate):
    pass


class AIProtocolType(StrEnum):
    """决定真实请求构造方式的受控协议。"""

    OPENAI_COMPATIBLE_CHAT_COMPLETIONS = "openai-compatible-chat-completions"


class AIProviderBrand(StrEnum):
    """仅用于管理端展示和筛选的供应商品牌。"""

    OPENAI = "OPENAI"
    ANTHROPIC = "ANTHROPIC"
    GOOGLE = "GOOGLE"
    AZURE_OPENAI = "AZURE_OPENAI"
    ZHIPU = "ZHIPU"
    QWEN = "QWEN"
    CUSTOM = "CUSTOM"


class AIChannelStatus(StrEnum):
    ENABLED = "ENABLED"
    DISABLED = "DISABLED"


class AIChannelSort(StrEnum):
    CREATED_DESC = "CREATED_DESC"
    NAME_ASC = "NAME_ASC"
    NAME_DESC = "NAME_DESC"
    UPDATED_DESC = "UPDATED_DESC"
    LAST_TESTED_DESC = "LAST_TESTED_DESC"


class AIModelTestStatus(StrEnum):
    UNTESTED = "UNTESTED"
    PASSED = "PASSED"
    FAILED = "FAILED"


class AIChannelCreate(ContractModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(max_length=500)
    protocol_type: AIProtocolType
    provider_brand: AIProviderBrand
    base_url: HttpUrl
    api_key: str = Field(min_length=1)
    timeout_seconds: int = Field(ge=10, le=600)


class AIChannelUpdate(ContractModel):
    expected_revision: int = Field(ge=0)
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(max_length=500)
    protocol_type: AIProtocolType
    provider_brand: AIProviderBrand
    base_url: HttpUrl
    timeout_seconds: int = Field(ge=10, le=600)


class AIChannelApiKeyReplace(ContractModel):
    expected_revision: int = Field(ge=0)
    api_key: str = Field(min_length=1)


class AIChannelModelSummary(ContractModel):
    display_name: str
    model_id: str


class AIChannelOut(ContractModel):
    id: uuid.UUID
    name: str
    description: str
    protocol_type: AIProtocolType
    provider_brand: AIProviderBrand
    base_url: HttpUrl
    timeout_seconds: int
    is_enabled: bool
    api_key_configured: bool
    api_key_updated_at: datetime
    headers: list[AIChannelHeaderOut]
    enabled_models: list[AIChannelModelSummary]
    latest_test_status: AIModelTestStatus
    last_tested_at: datetime | None
    workflow_stage: Literal["INCOMPLETE", "UNVERIFIED", "READY_TO_ENABLE", "RUNNING"]
    primary_task: Literal[
        "COMPLETE_CONFIGURATION", "TEST_MODEL", "ENABLE_CHANNEL", "VIEW_RUNTIME"
    ]
    available_actions: list[
        Literal[
            "UPDATE",
            "REPLACE_API_KEY",
            "ENABLE",
            "DISABLE",
            "DELETE",
            "DISCOVER_MODELS",
            "CREATE_HEADER",
            "CREATE_MODEL",
        ]
    ]
    revision: int
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class AIChannelSummary(ContractModel):
    """渠道表格专用投影，不携带 Header 值或模型数组。"""

    id: uuid.UUID
    name: str
    description: str
    protocol_type: AIProtocolType
    provider_brand: AIProviderBrand
    base_url: HttpUrl
    is_enabled: bool
    api_key_configured: bool
    header_count: int = Field(ge=0)
    enabled_model_count: int = Field(ge=0)
    latest_test_status: AIModelTestStatus
    last_tested_at: datetime | None
    workflow_stage: Literal["INCOMPLETE", "UNVERIFIED", "READY_TO_ENABLE", "RUNNING"]
    primary_task: Literal[
        "COMPLETE_CONFIGURATION", "TEST_MODEL", "ENABLE_CHANNEL", "VIEW_RUNTIME"
    ]
    available_actions: list[
        Literal[
            "UPDATE",
            "REPLACE_API_KEY",
            "ENABLE",
            "DISABLE",
            "DELETE",
            "DISCOVER_MODELS",
            "CREATE_HEADER",
            "CREATE_MODEL",
        ]
    ]
    revision: int = Field(ge=0)


class AIChannelCounts(ContractModel):
    all: int = Field(ge=0)
    enabled: int = Field(ge=0)
    disabled: int = Field(ge=0)


class AIChannelList(ContractModel):
    items: list[AIChannelSummary]
    page: int = Field(ge=1)
    page_size: Literal[10, 20, 50]
    total: int = Field(ge=0)
    counts: AIChannelCounts


class AIUsagePeriod(StrEnum):
    SEVEN_DAYS = "7d"
    THIRTY_DAYS = "30d"
    NINETY_DAYS = "90d"
    ALL = "all"


class AIChannelUsageSummary(ContractModel):
    """从正式业务作业实时聚合的渠道使用统计。"""

    channel_id: uuid.UUID
    period: AIUsagePeriod
    period_started_at: datetime | None
    period_ended_at: datetime
    total_jobs: int = Field(ge=0)
    succeeded_jobs: int = Field(ge=0)
    failed_jobs: int = Field(ge=0)
    success_rate: float | None = Field(ge=0, le=1)
    average_response_duration_ms: float | None = Field(ge=0)
    prompt_tokens: int | None = Field(ge=0)
    completion_tokens: int | None = Field(ge=0)
    total_tokens: int | None = Field(ge=0)
    last_used_at: datetime | None


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


class AIModelOut(AIModelCreate):
    id: uuid.UUID
    channel_id: uuid.UUID
    is_enabled: bool
    test_status: AIModelTestStatus
    last_tested_at: datetime | None = None
    last_test_error_summary: str | None = None
    workflow_stage: Literal[
        "UNTESTED", "TEST_FAILED", "READY_TO_ENABLE", "CHANNEL_DISABLED", "RUNNING"
    ]
    primary_task: Literal[
        "TEST_CONNECTION",
        "VIEW_FAILURE_AND_RETRY",
        "ENABLE_MODEL",
        "ENABLE_CHANNEL",
        "VIEW_MODEL_RUNTIME",
    ]
    available_actions: list[Literal["UPDATE", "TEST", "ENABLE", "DISABLE", "DELETE"]]
    revision: int
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class AIModelList(ContractModel):
    items: list[AIModelOut]


class DiscoveredModel(ContractModel):
    model_id: str
    configured: bool
    primary_task: Literal["ADD_MODEL", "VIEW_CONFIGURED_MODEL"]


class DiscoveredModelList(ContractModel):
    items: list[DiscoveredModel]
