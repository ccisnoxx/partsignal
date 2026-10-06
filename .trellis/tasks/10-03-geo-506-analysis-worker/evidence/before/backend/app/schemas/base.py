"""由冻结 OpenAPI 契约映射的 Pydantic 请求与响应类型。"""

from __future__ import annotations

from collections.abc import Hashable

from pydantic import (
    BaseModel,
    ConfigDict,
)


def require_unique_items[UniqueItem: Hashable](values: list[UniqueItem]) -> list[UniqueItem]:
    """在请求解析边界拒绝重复集合项，与 OpenAPI `uniqueItems` 保持一致。"""
    if len(values) != len(set(values)):
        raise ValueError("列表项不得重复")
    return values


class ContractModel(BaseModel):
    """禁止静默接受契约外字段。"""

    model_config = ConfigDict(extra="forbid", from_attributes=True)
