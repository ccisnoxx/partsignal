"""GEO-203 的观测配置数据合同；Registry 与命令资格由后续任务拥有。"""

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from pydantic import AfterValidator, Field, HttpUrl, StrictBool, field_validator, model_validator

from app.schemas.base import ContractModel
from app.schemas.geo_prompt_variants import PromptLanguage, PromptRegion, Revision


class GeoSurfaceKind(StrEnum):
    CONSUMER_UI = "CONSUMER_UI"
    MODEL_API = "MODEL_API"
    SEARCH_API = "SEARCH_API"
    MANUAL_SITE = "MANUAL_SITE"


class GeoComplianceStatus(StrEnum):
    NOT_REVIEWED = "NOT_REVIEWED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    SUSPENDED = "SUSPENDED"


class GeoCollectionMode(StrEnum):
    MANUAL = "MANUAL"
    API = "API"
    BROWSER = "BROWSER"


class GeoProfileLoginState(StrEnum):
    ANONYMOUS = "ANONYMOUS"
    AUTHENTICATED = "AUTHENTICATED"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class GeoWebSearchPolicy(StrEnum):
    UNKNOWN = "UNKNOWN"
    REQUESTED = "REQUESTED"
    REQUIRED = "REQUIRED"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class GeoProfileTestStatus(StrEnum):
    UNTESTED = "UNTESTED"
    PASSED = "PASSED"
    FAILED = "FAILED"


class GeoSurfaceProviderBrand(StrEnum):
    OPENAI = "OPENAI"
    ANTHROPIC = "ANTHROPIC"
    GOOGLE = "GOOGLE"
    AZURE_OPENAI = "AZURE_OPENAI"
    ZHIPU = "ZHIPU"
    QWEN = "QWEN"
    CUSTOM = "CUSTOM"


def require_trimmed(value: str) -> str:
    if value != value.strip() or not value.strip() or "\x00" in value:
        raise ValueError("文本必须非空且不含首尾空白或 NUL")
    return value


def require_public_website(value: str) -> str:
    url = HttpUrl(value)
    if url.username or url.password or url.query is not None or url.fragment is not None:
        raise ValueError("网站地址不得含认证信息、query 或 fragment")
    return value


Name = Annotated[
    str,
    Field(
        strict=True,
        min_length=1,
        max_length=160,
        pattern=r"^[^\s\x00](?:[^\x00]*[^\s\x00])?$",
    ),
    AfterValidator(require_trimmed),
]
AdapterKey = Annotated[
    str,
    Field(strict=True, min_length=1, max_length=100, pattern=r"^[a-z][a-z0-9_-]*$"),
]
Website = Annotated[
    str,
    Field(
        strict=True, min_length=1, max_length=2083, pattern=r"^https?://[^\s/?#@]+(?:/[^\s?#]*)?$"
    ),
    AfterValidator(require_public_website),
]


class GeoSurfaceCapabilities(ContractModel):
    # 能力描述配置可观测性，不能充当某次回答的搜索/引用事实。
    answer_text: Literal[True]
    citations: StrictBool
    web_search_signal: StrictBool
    model_version: StrictBool
    usage: StrictBool
    cost: StrictBool

    @field_validator("answer_text", mode="before")
    @classmethod
    def require_answer_capability(cls, value: object) -> Literal[True]:
        if value is not True:
            raise ValueError("answer_text 必须为布尔 true")
        return True


class GeoEngineSurfaceCreate(ContractModel):
    name: Name
    slug: str = Field(
        strict=True, min_length=1, max_length=100, pattern=r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"
    )
    surface_kind: GeoSurfaceKind
    provider_brand: GeoSurfaceProviderBrand
    website_url: Website | None
    compliance_status: GeoComplianceStatus
    capabilities: GeoSurfaceCapabilities


class GeoEngineSurfaceUpdate(GeoEngineSurfaceCreate):
    expected_revision: Revision


class GeoEngineSurfaceOut(GeoEngineSurfaceCreate):
    id: UUID
    is_active: StrictBool
    revision: Revision
    first_referenced_at: datetime | None
    created_by: UUID
    created_at: datetime
    updated_at: datetime


class GeoManualSettings(ContractModel):
    require_screenshot: StrictBool = True


class GeoApiSettings(ContractModel):
    temperature: Annotated[float, Field(strict=True, ge=0, le=2, allow_inf_nan=False)] | None = None
    max_output_tokens: Annotated[int, Field(strict=True, ge=1, le=65536)] | None = None
    max_concurrency: int = Field(default=1, strict=True, ge=1, le=100)
    requests_per_minute: int = Field(default=60, strict=True, ge=1, le=60000)


class GeoBrowserSettings(ContractModel):
    require_screenshot: StrictBool = True
    answer_timeout_seconds: int = Field(strict=True, ge=10, le=600, default=120)


class _ProfileConfiguration(ContractModel):
    name: Name
    adapter_key: AdapterKey
    language_code: PromptLanguage
    region_code: PromptRegion
    web_search_policy: GeoWebSearchPolicy


class GeoManualProfileConfiguration(_ProfileConfiguration):
    collection_mode: Literal["MANUAL"]
    adapter_key: Literal["manual"]
    ai_channel_id: None
    ai_model_id: None
    login_state: Literal["ANONYMOUS", "AUTHENTICATED"]
    settings: GeoManualSettings


_API_REFERENCE_CONSTRAINT: dict[str, Any] = {
    "oneOf": [
        {
            "properties": {
                "ai_channel_id": {"type": "null"},
                "ai_model_id": {"type": "null"},
            }
        },
        {
            "properties": {
                "ai_channel_id": {"type": "string"},
                "ai_model_id": {"type": "string"},
            }
        },
    ]
}


class GeoApiProfileConfiguration(_ProfileConfiguration):
    model_config = {"json_schema_extra": _API_REFERENCE_CONSTRAINT}
    collection_mode: Literal["API"]
    ai_channel_id: UUID | None
    ai_model_id: UUID | None
    login_state: Literal["NOT_APPLICABLE"]
    settings: GeoApiSettings

    @model_validator(mode="after")
    def require_paired_model(self) -> Self:
        if (self.ai_channel_id is None) != (self.ai_model_id is None):
            raise ValueError("API 的 channel/model 引用必须同时提供或同时为空")
        return self


class GeoBrowserProfileConfiguration(_ProfileConfiguration):
    collection_mode: Literal["BROWSER"]
    ai_channel_id: None
    ai_model_id: None
    login_state: Literal["ANONYMOUS", "AUTHENTICATED"]
    settings: GeoBrowserSettings


class GeoManualProfileCreate(GeoManualProfileConfiguration):
    engine_surface_id: UUID


class GeoApiProfileCreate(GeoApiProfileConfiguration):
    engine_surface_id: UUID


class GeoBrowserProfileCreate(GeoBrowserProfileConfiguration):
    engine_surface_id: UUID


GeoCollectionProfileCreate = Annotated[
    GeoManualProfileCreate | GeoApiProfileCreate | GeoBrowserProfileCreate,
    Field(discriminator="collection_mode"),
]


class GeoManualProfileUpdate(GeoManualProfileConfiguration):
    expected_revision: Revision


class GeoApiProfileUpdate(GeoApiProfileConfiguration):
    expected_revision: Revision


class GeoBrowserProfileUpdate(GeoBrowserProfileConfiguration):
    expected_revision: Revision


GeoCollectionProfileUpdate = Annotated[
    GeoManualProfileUpdate | GeoApiProfileUpdate | GeoBrowserProfileUpdate,
    Field(discriminator="collection_mode"),
]


def profile_response_schema(schema: dict[str, Any]) -> None:
    # 响应的测试事实与时间成对；API 的模型引用 oneOf 必须同时保留。
    schema["allOf"] = [
        {
            "oneOf": [
                {
                    "properties": {
                        "last_test_status": {"const": "UNTESTED"},
                        "last_tested_at": {"type": "null"},
                    }
                },
                {
                    "properties": {
                        "last_test_status": {"enum": ["PASSED", "FAILED"]},
                        "last_tested_at": {"type": "string", "format": "date-time"},
                    }
                },
            ]
        }
    ]
    if schema["properties"]["collection_mode"].get("const") == "API":
        schema["oneOf"] = _API_REFERENCE_CONSTRAINT["oneOf"]


class _ProfileMetadata(ContractModel):
    model_config = {"json_schema_extra": profile_response_schema}
    id: UUID
    engine_surface_id: UUID
    is_active: StrictBool
    last_test_status: GeoProfileTestStatus
    last_tested_at: datetime | None
    revision: Revision
    created_by: UUID
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def require_test_time(self) -> Self:
        if (self.last_test_status == GeoProfileTestStatus.UNTESTED) != (
            self.last_tested_at is None
        ):
            raise ValueError("UNTESTED 不得有测试时间，已测试状态必须有测试时间")
        return self


class GeoManualProfileOut(GeoManualProfileConfiguration, _ProfileMetadata):
    pass


class GeoApiProfileOut(GeoApiProfileConfiguration, _ProfileMetadata):
    pass


class GeoBrowserProfileOut(GeoBrowserProfileConfiguration, _ProfileMetadata):
    pass


GeoCollectionProfileOut = Annotated[
    GeoManualProfileOut | GeoApiProfileOut | GeoBrowserProfileOut,
    Field(discriminator="collection_mode"),
]
