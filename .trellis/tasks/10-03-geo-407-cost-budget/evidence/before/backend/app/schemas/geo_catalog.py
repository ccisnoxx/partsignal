"""GEO Catalog 的闭合公共模型；请求校验不执行数据库命令。"""

import re
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AfterValidator, ConfigDict, Field, model_validator
from pydantic.config import JsonDict

from app.schemas.base import ContractModel
from app.services.geo_catalog_normalization import (
    HOSTNAME_PATTERN,
    IP_LITERAL_PATTERN,
    LANGUAGE_PATTERN,
    normalize_catalog_hostname,
    normalize_catalog_identity,
    normalize_catalog_text,
    normalize_language_code,
    require_catalog_hostname,
)


class GeoSubjectType(StrEnum):
    OWN_BRAND = "OWN_BRAND"
    OWN_PRODUCT = "OWN_PRODUCT"
    COMPETITOR_BRAND = "COMPETITOR_BRAND"
    COMPETITOR_PRODUCT = "COMPETITOR_PRODUCT"
    REFERENCE_PART = "REFERENCE_PART"


class GeoSubjectAliasKind(StrEnum):
    NAME = "NAME"
    PART_NUMBER = "PART_NUMBER"
    ABBREVIATION = "ABBREVIATION"
    LEGACY = "LEGACY"


class GeoSubjectDomainRelationType(StrEnum):
    OWNED = "OWNED"
    OFFICIAL = "OFFICIAL"
    DISTRIBUTOR = "DISTRIBUTOR"
    OTHER = "OTHER"


class GeoSubjectWorkflowStage(StrEnum):
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"


class GeoSubjectPrimaryTask(StrEnum):
    MANAGE_SUBJECT = "MANAGE_SUBJECT"
    ENABLE_SUBJECT = "ENABLE_SUBJECT"


class GeoSubjectAction(StrEnum):
    UPDATE = "UPDATE"
    ENABLE = "ENABLE"
    DISABLE = "DISABLE"
    DELETE = "DELETE"
    CREATE_ALIAS = "CREATE_ALIAS"
    CREATE_DOMAIN = "CREATE_DOMAIN"


class GeoSubjectAliasAction(StrEnum):
    UPDATE = "UPDATE"
    DELETE = "DELETE"


class GeoSubjectDomainAction(StrEnum):
    DELETE = "DELETE"


class GeoSubjectDeletionBlockerType(StrEnum):
    CHILD_SUBJECT = "CHILD_SUBJECT"
    MONITORING_PLAN = "MONITORING_PLAN"
    OBSERVATION_RUN = "OBSERVATION_RUN"
    ANALYSIS = "ANALYSIS"
    OPPORTUNITY = "OPPORTUNITY"


class GeoCatalogErrorCode(StrEnum):
    GEO_SUBJECT_IN_USE = "GEO_SUBJECT_IN_USE"
    GEO_SUBJECT_PRODUCT_EXISTS = "GEO_SUBJECT_PRODUCT_EXISTS"
    GEO_SUBJECT_ALIAS_EXISTS = "GEO_SUBJECT_ALIAS_EXISTS"
    GEO_SUBJECT_DOMAIN_EXISTS = "GEO_SUBJECT_DOMAIN_EXISTS"
    GEO_SUBJECT_PARENT_INVALID = "GEO_SUBJECT_PARENT_INVALID"


CatalogText = Annotated[
    str,
    Field(strict=True, min_length=1, max_length=240, pattern=r"\S"),
    AfterValidator(normalize_catalog_text),
]
CatalogIdentity = Annotated[CatalogText, AfterValidator(normalize_catalog_identity)]
Description = Annotated[str, Field(strict=True, max_length=4000)]
Revision = Annotated[int, Field(strict=True, ge=0)]
LanguageCode = Annotated[
    str,
    Field(min_length=2, max_length=16, pattern=LANGUAGE_PATTERN),
    AfterValidator(normalize_language_code),
]
NamedSubjectType = Literal["OWN_BRAND", "COMPETITOR_BRAND", "COMPETITOR_PRODUCT", "REFERENCE_PART"]

# 声明式条件对应根 OpenAPI；真实关联与角色规则仍由领域策略及投影负责。
_ROOT_PARENT_CONDITION: JsonDict = {
    "if": {
        "properties": {
            "subject_type": {"enum": ["OWN_BRAND", "COMPETITOR_BRAND", "REFERENCE_PART"]}
        }
    },
    "then": {"properties": {"parent_subject_id": {"type": "null"}}},
}
_PARENT_PRESENCE_CONDITION: JsonDict = {
    "if": {"properties": {"parent_subject_id": {"type": "null"}}},
    "then": {"properties": {"parent": {"type": "null"}}},
    "else": {"properties": {"parent": {"type": "object"}}},
}
_STAGE_CONDITION: JsonDict = {
    "if": {"properties": {"is_active": {"const": True}}},
    "then": {"properties": {"workflow_stage": {"const": "ACTIVE"}}},
    "else": {"properties": {"workflow_stage": {"const": "DISABLED"}}},
}


class GeoOwnProductSubjectCreate(ContractModel):
    subject_type: Literal["OWN_PRODUCT"]
    product_id: UUID
    parent_subject_id: UUID | None = Field(default_factory=lambda: None)
    description: Description = ""


class GeoNamedSubjectCreate(ContractModel):
    model_config = ConfigDict(json_schema_extra={"allOf": [_ROOT_PARENT_CONDITION]})

    subject_type: NamedSubjectType
    canonical_name: CatalogIdentity
    display_name: CatalogText
    parent_subject_id: UUID | None = Field(default_factory=lambda: None)
    description: Description = ""

    @model_validator(mode="after")
    def validate_parent_shape(self) -> Self:
        if self.subject_type != "COMPETITOR_PRODUCT" and self.parent_subject_id is not None:
            raise ValueError("品牌与参考型号不能拥有父级")
        return self


GeoSubjectCreate = Annotated[
    GeoOwnProductSubjectCreate | GeoNamedSubjectCreate, Field(discriminator="subject_type")
]


class GeoOwnProductSubjectUpdate(ContractModel):
    model_config = ConfigDict(json_schema_extra={"minProperties": 3})

    subject_type: Literal["OWN_PRODUCT"]
    expected_revision: Revision
    parent_subject_id: UUID | None = Field(default_factory=lambda: None)
    # PATCH 占位值不表示写入意图；调用方必须使用 exclude_unset / model_fields_set。
    description: Description = Field(default_factory=str)

    @model_validator(mode="after")
    def validate_patch(self) -> Self:
        if not self.model_fields_set - {"subject_type", "expected_revision"}:
            raise ValueError("至少提交一个可编辑字段")
        return self


class GeoNamedSubjectUpdate(ContractModel):
    model_config = ConfigDict(
        json_schema_extra={"minProperties": 3, "allOf": [_ROOT_PARENT_CONDITION]}
    )

    subject_type: NamedSubjectType
    expected_revision: Revision
    parent_subject_id: UUID | None = Field(default_factory=lambda: None)
    description: Description = Field(default_factory=str)
    canonical_name: CatalogIdentity = Field(default_factory=str)
    display_name: CatalogText = Field(default_factory=str)

    @model_validator(mode="after")
    def validate_patch(self) -> Self:
        if not self.model_fields_set - {"subject_type", "expected_revision"}:
            raise ValueError("至少提交一个可编辑字段")
        if self.subject_type != "COMPETITOR_PRODUCT" and self.parent_subject_id is not None:
            raise ValueError("品牌与参考型号不能拥有父级")
        return self


GeoSubjectUpdate = Annotated[
    GeoOwnProductSubjectUpdate | GeoNamedSubjectUpdate, Field(discriminator="subject_type")
]


class GeoSubjectRevisionRequest(ContractModel):
    expected_revision: Revision


class GeoSubjectAliasCreate(GeoSubjectRevisionRequest):
    alias: CatalogIdentity
    alias_kind: GeoSubjectAliasKind
    language_code: LanguageCode | None = Field(default_factory=lambda: None)
    is_active: bool = Field(default=True, strict=True)


class GeoSubjectAliasUpdate(GeoSubjectRevisionRequest):
    model_config = ConfigDict(json_schema_extra={"minProperties": 2})

    alias: CatalogIdentity = Field(default_factory=str)
    alias_kind: GeoSubjectAliasKind = Field(default_factory=lambda: GeoSubjectAliasKind.NAME)
    language_code: LanguageCode | None = Field(default_factory=lambda: None)
    is_active: bool = Field(default_factory=lambda: True, strict=True)

    @model_validator(mode="after")
    def validate_patch(self) -> Self:
        if not self.model_fields_set - {"expected_revision"}:
            raise ValueError("至少提交一个可编辑字段")
        return self


GeoSubjectHostname = Annotated[
    str,
    Field(
        min_length=3,
        max_length=253,
        pattern=re.compile(HOSTNAME_PATTERN),
        json_schema_extra={"not": {"pattern": IP_LITERAL_PATTERN}},
    ),
    AfterValidator(require_catalog_hostname),
]


class GeoSubjectDomainCreate(GeoSubjectRevisionRequest):
    hostname: Annotated[
        str,
        Field(strict=True, min_length=3, max_length=253, pattern=r"^[^\s/:@?#*\\]+$"),
        AfterValidator(normalize_catalog_hostname),
    ]
    relation_type: GeoSubjectDomainRelationType


class GeoSubjectDeletionBlocker(ContractModel):
    type: GeoSubjectDeletionBlockerType
    count: Annotated[int, Field(strict=True, ge=1)]


class GeoSubjectDeletionProjection(ContractModel):
    blockers: list[GeoSubjectDeletionBlocker]


class GeoSubjectReferences(ContractModel):
    child_subject_count: Revision
    monitoring_plan_count: Revision
    observation_run_count: Revision
    analysis_count: Revision
    opportunity_count: Revision


class GeoSubjectInUseDetails(ContractModel):
    references: list[GeoSubjectDeletionBlocker] = Field(min_length=1)


class GeoSubjectProductSummary(ContractModel):
    id: UUID
    part_number: str = Field(min_length=1, max_length=160)
    brand: str = Field(min_length=1, max_length=160)
    category: str = Field(min_length=1, max_length=160)
    revision: Revision


class GeoSubjectParentSummary(ContractModel):
    id: UUID
    subject_type: Literal["OWN_BRAND", "COMPETITOR_BRAND"]
    display_name: str = Field(min_length=1, max_length=240, pattern=r"\S")
    is_active: bool


class GeoSubjectAliasOut(ContractModel):
    id: UUID
    subject_id: UUID
    alias: str = Field(min_length=1, max_length=240, pattern=r"\S")
    normalized_alias: str = Field(min_length=1, max_length=240, pattern=r"\S")
    alias_kind: GeoSubjectAliasKind
    language_code: (
        Annotated[str, Field(min_length=2, max_length=16, pattern=r"^[a-z]{2,8}(-[a-z0-9]{1,8})*$")]
        | None
    )
    is_active: bool
    available_actions: list[GeoSubjectAliasAction]
    created_at: datetime


class GeoSubjectDomainOut(ContractModel):
    id: UUID
    subject_id: UUID
    hostname: GeoSubjectHostname
    relation_type: GeoSubjectDomainRelationType
    is_active: Literal[True]
    available_actions: list[GeoSubjectDomainAction]
    created_at: datetime


class _SubjectOut(ContractModel):
    id: UUID
    parent_subject_id: UUID | None
    parent: GeoSubjectParentSummary | None
    description: Description
    is_active: bool
    aliases: list[GeoSubjectAliasOut]
    domains: list[GeoSubjectDomainOut]
    references: GeoSubjectReferences
    workflow_stage: GeoSubjectWorkflowStage
    primary_task: GeoSubjectPrimaryTask
    available_actions: list[GeoSubjectAction]
    deletion: GeoSubjectDeletionProjection | None
    revision: Revision
    created_by: UUID
    created_at: datetime
    updated_at: datetime


class GeoOwnProductSubjectOut(_SubjectOut):
    model_config = ConfigDict(
        json_schema_extra={
            "allOf": [
                _PARENT_PRESENCE_CONDITION,
                _STAGE_CONDITION,
                {
                    "if": {"properties": {"parent": {"type": "object"}}},
                    "then": {
                        "properties": {
                            "parent": {"properties": {"subject_type": {"const": "OWN_BRAND"}}}
                        }
                    },
                },
            ]
        }
    )

    subject_type: Literal["OWN_PRODUCT"]
    product_id: UUID
    product: GeoSubjectProductSummary
    canonical_name: str = Field(min_length=1, max_length=160)
    display_name: str = Field(min_length=3, max_length=321)


class GeoNamedSubjectOut(_SubjectOut):
    model_config = ConfigDict(
        json_schema_extra={
            "allOf": [
                _PARENT_PRESENCE_CONDITION,
                _STAGE_CONDITION,
                {
                    "if": {"properties": {"parent": {"type": "object"}}},
                    "then": {
                        "properties": {
                            "parent": {
                                "properties": {"subject_type": {"const": "COMPETITOR_BRAND"}}
                            }
                        }
                    },
                },
                _ROOT_PARENT_CONDITION,
            ]
        }
    )

    subject_type: NamedSubjectType
    product_id: None
    product: None
    canonical_name: str = Field(min_length=1, max_length=240, pattern=r"\S")
    display_name: str = Field(min_length=1, max_length=240, pattern=r"\S")


GeoSubjectOut = Annotated[
    GeoOwnProductSubjectOut | GeoNamedSubjectOut, Field(discriminator="subject_type")
]


class GeoSubjectListPage(ContractModel):
    items: list[GeoSubjectOut]
    page: Annotated[int, Field(strict=True, ge=1)]
    page_size: Literal[10, 20, 50]
    total: Revision
