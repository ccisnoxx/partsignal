"""目标问题、平台与 AI 配置 Schema。"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, Field, HttpUrl, model_validator

from app.schemas.base import ContractModel, require_unique_items


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


class PlatformLogoUploadInput(ContractModel):
    source: Literal["UPLOAD"]
    file_id: uuid.UUID


class PlatformLogoExternalInput(ContractModel):
    source: Literal["EXTERNAL"]
    url: HttpUrl


PlatformLogoInput = Annotated[
    PlatformLogoUploadInput | PlatformLogoExternalInput,
    Field(discriminator="source"),
]


class PlatformLogoUploadOut(PlatformLogoUploadInput):
    url: HttpUrl


class PlatformLogoExternalOut(PlatformLogoExternalInput):
    pass


PlatformLogoOut = Annotated[
    PlatformLogoUploadOut | PlatformLogoExternalOut,
    Field(discriminator="source"),
]


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
    website_url: HttpUrl | None = None
    logo: PlatformLogoInput | None = None


class PlatformProfileUpdate(ContractModel):
    expected_revision: int = Field(ge=0)
    name: str = Field(min_length=1)
    allowed_domains: Annotated[list[str], AfterValidator(require_unique_items)] = Field(
        min_length=1, json_schema_extra={"uniqueItems": True}
    )
    platform_type_id: uuid.UUID
    website_url: HttpUrl | None
    logo: PlatformLogoInput | None


class PlatformProfileVersionCreate(ContractModel):
    rules: PlatformRules


class PlatformProfileVersionUpdate(ContractModel):
    expected_revision: int = Field(ge=0)
    rules: PlatformRules


class PlatformProfileVersionOut(ContractModel):
    id: uuid.UUID
    platform_profile_id: uuid.UUID
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
    website_url: HttpUrl | None
    logo: PlatformLogoOut | None
    revision: int
    active_version: PlatformProfileVersionOut | None
    prompt_configured: bool


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
    platform_profile_id: uuid.UUID
    template_markdown: str
    revision: int
    updated_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class ContentHumanizationPromptPut(ContractModel):
    """首次创建或按修订号更新全局自然化 Prompt。"""

    template_markdown: str = Field(min_length=1)
    expected_revision: int | None = Field(ge=0)


class ContentHumanizationPromptOut(ContractModel):
    """全局自然化 Prompt 当前配置。"""

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


class AIChannelModelSummary(ContractModel):
    display_name: str
    model_id: str


class AIChannelOut(ContractModel):
    id: uuid.UUID
    name: str
    base_url: HttpUrl
    timeout_seconds: int
    is_enabled: bool
    api_key_configured: bool
    api_key_updated_at: datetime
    headers: list[AIChannelHeaderOut]
    enabled_models: list[AIChannelModelSummary]
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
