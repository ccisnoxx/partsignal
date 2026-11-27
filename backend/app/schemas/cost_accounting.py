"""Slice 4B：AI 模型定价与运营费用台账请求/响应 Schema。"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import (
    BeforeValidator,
    Field,
    PlainSerializer,
    StringConstraints,
    WithJsonSchema,
    model_validator,
)

from app.schemas.base import ContractModel

PRICE_PER_1M_PATTERN = r"^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,6})?$"
OPERATING_COST_AMOUNT_PATTERN = r"^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$"


def _validate_decimal_string(value: object, *, pattern: str, error_message: str) -> object:
    if isinstance(value, Decimal):
        return value
    if (
        not isinstance(value, str)
        or "\n" in value
        or "\r" in value
        or re.fullmatch(pattern, value) is None
    ):
        raise ValueError(error_message)
    return value


def _price_per_1m_input(value: object) -> object:
    return _validate_decimal_string(
        value,
        pattern=PRICE_PER_1M_PATTERN,
        error_message="每百万 Token 单价必须为非负十进制字符串，最多 8 位整数和 6 位小数",
    )


def _operating_cost_amount_input(value: object) -> object:
    return _validate_decimal_string(
        value,
        pattern=OPERATING_COST_AMOUNT_PATTERN,
        error_message="费用金额必须为非负十进制字符串，最多 12 位整数和 2 位小数",
    )


def _decimal_output(value: Decimal) -> str:
    result = format(value.copy_abs() if value.is_zero() else value, "f")
    return result.rstrip("0").rstrip(".") if "." in result else result


PricePer1MTokens = Annotated[
    Decimal,
    Field(ge=0, max_digits=14, decimal_places=6, allow_inf_nan=False),
    BeforeValidator(_price_per_1m_input),
    PlainSerializer(_decimal_output, return_type=str, when_used="json"),
    WithJsonSchema({"type": "string", "pattern": PRICE_PER_1M_PATTERN}),
]

OperatingCostAmount = Annotated[
    Decimal,
    Field(ge=0, max_digits=14, decimal_places=2, allow_inf_nan=False),
    BeforeValidator(_operating_cost_amount_input),
    PlainSerializer(_decimal_output, return_type=str, when_used="json"),
    WithJsonSchema({"type": "string", "pattern": OPERATING_COST_AMOUNT_PATTERN}),
]

CurrencyCode = Annotated[
    str,
    StringConstraints(strip_whitespace=True, pattern=r"^[A-Z]{3}$"),
]

OperatingCostCategory = Literal["LABOR", "EXTERNAL_PLACEMENT", "OTHER"]


class AIModelPricingOut(ContractModel):
    """AI 模型每百万 Token 价格配置视图。"""

    model_id: uuid.UUID
    channel_id: uuid.UUID
    display_name: str
    provider_model_id: str
    input_price_per_1m_tokens: PricePer1MTokens | None = None
    output_price_per_1m_tokens: PricePer1MTokens | None = None
    price_currency: CurrencyCode | None = None
    pricing_configured: bool
    revision: int
    updated_at: datetime


class AIModelPricingUpdate(ContractModel):
    """更新或清空 AI 模型定价配置（三字段同时为空或同时非空）。"""

    input_price_per_1m_tokens: PricePer1MTokens | None = None
    output_price_per_1m_tokens: PricePer1MTokens | None = None
    price_currency: CurrencyCode | None = None
    expected_revision: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_pricing_triplet(self) -> AIModelPricingUpdate:
        values = (
            self.input_price_per_1m_tokens,
            self.output_price_per_1m_tokens,
            self.price_currency,
        )
        all_none = all(item is None for item in values)
        all_present = all(item is not None for item in values)
        if not (all_none or all_present):
            raise ValueError("输入单价、输出单价与币种必须同时提供或同时清空")
        return self


class OperatingCostEntryCreate(ContractModel):
    """新增一条运营费用台账记录。"""

    campaign_id: uuid.UUID | None = None
    geo_intervention_id: uuid.UUID | None = None
    category: OperatingCostCategory
    amount: OperatingCostAmount
    currency: CurrencyCode
    incurred_on: date
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""

    @model_validator(mode="after")
    def validate_owner(self) -> OperatingCostEntryCreate:
        if self.campaign_id is None and self.geo_intervention_id is None:
            raise ValueError("运营费用记录必须至少关联一个内容活动或 GEO 干预")
        return self


class OperatingCostEntryVoidRequest(ContractModel):
    """一次性作废运营费用台账记录。"""

    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]


class OperatingCostEntryOut(ContractModel):
    """运营费用台账明细响应。"""

    id: uuid.UUID
    campaign_id: uuid.UUID | None = None
    campaign_name: str | None = None
    geo_intervention_id: uuid.UUID | None = None
    geo_intervention_title: str | None = None
    category: OperatingCostCategory
    amount: OperatingCostAmount
    currency: CurrencyCode
    incurred_on: date
    note: str
    is_voided: bool
    voided_at: datetime | None = None
    voided_by: uuid.UUID | None = None
    voided_by_name: str | None = None
    void_reason: str | None = None
    created_by: uuid.UUID
    created_by_name: str | None = None
    created_at: datetime


class OperatingCostEntryListPage(ContractModel):
    """运营费用台账分页列表。"""

    items: list[OperatingCostEntryOut]
    total: int
    page: int
    page_size: int
