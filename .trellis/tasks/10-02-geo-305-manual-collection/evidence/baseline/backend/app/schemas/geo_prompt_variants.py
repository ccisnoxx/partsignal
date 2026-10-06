"""GEO-201 公共组件；端点与命令投影由 GEO-202 接入。"""

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AfterValidator, ConfigDict, Field, model_validator

from app.geo_prompt_variants import (
    LANGUAGE_PATTERN,
    PROMPT_MAX_LENGTH,
    REGION_PATTERN,
    GeoPromptMentionMode,
    GeoPromptPriority,
    normalize_prompt_language,
    normalize_prompt_region,
    normalize_prompt_text,
)
from app.schemas.base import ContractModel
from app.schemas.configuration import IntentType

PromptText = Annotated[
    str,
    Field(
        strict=True,
        min_length=1,
        max_length=PROMPT_MAX_LENGTH,
        pattern=r"^[^\x00]*[^\s\x00][^\x00]*$",
    ),
    AfterValidator(normalize_prompt_text),
]
PromptLanguage = Annotated[
    str,
    Field(strict=True, min_length=2, max_length=16, pattern=LANGUAGE_PATTERN),
    AfterValidator(normalize_prompt_language),
]
PromptRegion = Annotated[
    str,
    Field(strict=True, min_length=2, max_length=2, pattern=REGION_PATTERN),
    AfterValidator(normalize_prompt_region),
]
Revision = Annotated[int, Field(strict=True, ge=0)]


class GeoPromptVariantErrorCode(StrEnum):
    GEO_PROMPT_VARIANT_EXISTS = "GEO_PROMPT_VARIANT_EXISTS"
    GEO_PROMPT_VARIANT_IN_USE = "GEO_PROMPT_VARIANT_IN_USE"
    GEO_PROMPT_VARIANT_IMMUTABLE = "GEO_PROMPT_VARIANT_IMMUTABLE"


class GeoPromptVariantCreate(ContractModel):
    query_topic_id: UUID
    prompt_text: PromptText
    mention_mode: GeoPromptMentionMode
    language_code: PromptLanguage
    region_code: PromptRegion
    priority: GeoPromptPriority


class GeoPromptVariantRevisionRequest(ContractModel):
    expected_revision: Revision


class GeoPromptVariantUpdate(GeoPromptVariantRevisionRequest):
    model_config = ConfigDict(json_schema_extra={"minProperties": 2})

    # PATCH 占位值不是写入意图，消费者必须使用 exclude_unset。
    prompt_text: PromptText = Field(default_factory=str)
    mention_mode: GeoPromptMentionMode = Field(default_factory=lambda: GeoPromptMentionMode.BRANDED)
    language_code: PromptLanguage = Field(default_factory=str)
    region_code: PromptRegion = Field(default_factory=str)
    priority: GeoPromptPriority = Field(default_factory=lambda: GeoPromptPriority.STANDARD)

    @model_validator(mode="after")
    def require_change(self) -> Self:
        if not self.model_fields_set - {"expected_revision"}:
            raise ValueError("至少提交一个可编辑字段")
        return self


class GeoPromptVariantAction(StrEnum):
    UPDATE = "UPDATE"
    ENABLE = "ENABLE"
    DISABLE = "DISABLE"
    DELETE = "DELETE"
    COPY = "COPY"


class GeoPromptVariantWorkflowStage(StrEnum):
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"
    REFERENCED = "REFERENCED"


class GeoPromptVariantPrimaryTask(StrEnum):
    EDIT = "EDIT"
    VIEW_DETAILS = "VIEW_DETAILS"


class GeoPromptTopicSummary(ContractModel):
    id: UUID
    canonical_question: str
    intent_type: IntentType
    revision: Revision


class GeoPromptVariantDeletion(ContractModel):
    blockers: list[Literal["HISTORY_REFERENCE", "MONITORING_PLAN"]]


class GeoPromptRunEntry(ContractModel):
    available: Literal[False]
    reason_code: Literal["NOT_IMPLEMENTED"]


class GeoPromptVariantOut(ContractModel):
    id: UUID
    query_topic_id: UUID
    prompt_text: str = Field(
        min_length=1, max_length=PROMPT_MAX_LENGTH, pattern=r"^[^\x00]*[^\s\x00][^\x00]*$"
    )
    mention_mode: GeoPromptMentionMode
    language_code: str = Field(
        min_length=2, max_length=16, pattern=r"^[a-z]{2,8}(-[a-z0-9]{1,8})*$"
    )
    region_code: str = Field(min_length=2, max_length=2, pattern=r"^[A-Z]{2}$")
    priority: GeoPromptPriority
    is_active: bool
    revision: Revision
    first_referenced_at: datetime | None
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    query_topic: GeoPromptTopicSummary
    workflow_stage: GeoPromptVariantWorkflowStage
    primary_task: GeoPromptVariantPrimaryTask
    available_actions: list[GeoPromptVariantAction]
    deletion: GeoPromptVariantDeletion
    run_entry: GeoPromptRunEntry


class GeoPromptVariantListPage(ContractModel):
    items: list[GeoPromptVariantOut]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: Literal[10, 20, 50]
