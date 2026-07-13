"""产品、规范化事实和事实版本 Schema。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated

from pydantic import AfterValidator, Field, HttpUrl, model_validator

from app.schemas.base import ContractModel, require_unique_items


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
