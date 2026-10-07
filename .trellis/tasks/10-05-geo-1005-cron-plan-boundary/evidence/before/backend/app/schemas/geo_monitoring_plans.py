"""MonitoringPlan 配置数据组件；矩阵、资格与命令由 GEO-207/208 接入。"""

import re
from collections.abc import Iterable
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Any, Self
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from celery.schedules import ParseException, crontab
from celery.utils.time import WEEKDAYS, YEARMONTHS
from pydantic import (
    AfterValidator,
    BeforeValidator,
    Field,
    PlainSerializer,
    WithJsonSchema,
    model_validator,
)

from app.schemas.base import ContractModel, require_unique_items
from app.schemas.geo_prompt_variants import Revision


class GeoMonitoringPlanStatus(StrEnum):
    DISABLED = "DISABLED"
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    ARCHIVED = "ARCHIVED"


class GeoPlanScheduleKind(StrEnum):
    MANUAL_ONLY = "MANUAL_ONLY"
    CRON = "CRON"


class GeoPlanSubjectRole(StrEnum):
    PRIMARY = "PRIMARY"
    COMPETITOR = "COMPETITOR"
    REFERENCE = "REFERENCE"


def _cron_field_pattern(names: Iterable[str] = ()) -> str:
    literals = ["".join(f"[{char.lower()}{char.upper()}]" for char in name) for name in names]
    atom = "(?:" + "|".join(["[0-9]+", *literals]) + ")"
    # Celery 只实际执行星号/显式范围的步长；裸字面量后的 /step 会被截断。
    part = rf"(?:\*(?:/[0-9]+)?|{atom}-{atom}(?:/[0-9]+)?|{atom})"
    return rf"{part}(?:,{part})*"


# 完整词法匹配，数值、范围和步长仍由安装版 Celery 判定。
_CRON_FIELDS = [_cron_field_pattern()] * 3 + [
    _cron_field_pattern(YEARMONTHS),
    _cron_field_pattern(WEEKDAYS),
]
CRON_PATTERN = "^" + " ".join(_CRON_FIELDS) + r"$(?![\s\S])"
BUDGET_PATTERN = r"^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,6})?$(?![\s\S])"


def _budget_input(value: object) -> object:
    # ORM/内部模型可传 Decimal，JSON wire 仅接受明确精度的十进制字符串。
    if isinstance(value, Decimal):
        return value
    if not isinstance(value, str) or re.fullmatch(BUDGET_PATTERN, value) is None:
        raise ValueError("预算必须为非负十进制字符串，最多8位整数和6位小数")
    return value


def _budget_output(value: Decimal) -> str:
    result = format(value.copy_abs() if value.is_zero() else value, "f")
    return result.rstrip("0").rstrip(".") if "." in result else result


def _timezone(value: str) -> str:
    if value.startswith(("posix/", "right/")):
        raise ValueError("必须使用有效 IANA 时区")
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ValueError("必须使用有效 IANA 时区") from error
    return value


def _cron(value: str) -> str:
    if re.fullmatch(CRON_PATTERN, value) is None:
        raise ValueError("必须使用有效五字段 Cron 表达式")
    try:
        crontab.from_string(value)
    except (ValueError, KeyError, ZeroDivisionError, ParseException) as error:
        raise ValueError("必须使用有效五字段 Cron 表达式") from error
    return value


PlanName = Annotated[
    str,
    Field(strict=True, min_length=1, max_length=200, pattern=r"^[^\s\x00](?:[^\x00]*[^\s\x00])?$"),
]
PlanTimezone = Annotated[
    str, Field(strict=True, min_length=1, max_length=64), AfterValidator(_timezone)
]
PlanCron = Annotated[
    str,
    Field(strict=True, min_length=9, max_length=120, json_schema_extra={"pattern": CRON_PATTERN}),
    AfterValidator(_cron),
]
PlanBudget = Annotated[
    Decimal,
    Field(ge=0, max_digits=14, decimal_places=6, allow_inf_nan=False),
    BeforeValidator(_budget_input),
    PlainSerializer(_budget_output, return_type=str, when_used="json"),
    WithJsonSchema({"type": "string", "pattern": BUDGET_PATTERN}),
]
PlanIds = Annotated[
    list[UUID],
    Field(min_length=1, json_schema_extra={"uniqueItems": True}),
    AfterValidator(require_unique_items),
]


class GeoPlanSubject(ContractModel):
    subject_id: UUID
    role: GeoPlanSubjectRole


def _configuration_schema(schema: dict[str, Any]) -> None:
    schema["allOf"] = [
        {
            "if": {
                "properties": {"schedule_kind": {"const": "CRON"}},
                "required": ["schedule_kind"],
            },
            "then": {
                "properties": {"cron_expression": {"type": "string"}},
                "required": ["cron_expression"],
            },
            "else": {"properties": {"cron_expression": {"type": "null"}}},
        }
    ]


class GeoMonitoringPlanConfiguration(ContractModel):
    model_config = {"json_schema_extra": _configuration_schema}

    name: PlanName
    description: str = Field(default="", strict=True, pattern=r"^[^\x00]*$")
    subjects: list[GeoPlanSubject] = Field(
        min_length=1,
        json_schema_extra={
            "uniqueItems": True,
            "contains": {"properties": {"role": {"const": "PRIMARY"}}, "required": ["role"]},
            "minContains": 1,
            "description": "subject_id 在集合内唯一；至少一个 PRIMARY，不由对象类型推断角色。",
        },
    )
    prompt_variant_ids: PlanIds
    collection_profile_ids: PlanIds
    repeat_count: int = Field(default=3, strict=True, ge=1, le=10)
    schedule_kind: GeoPlanScheduleKind = GeoPlanScheduleKind.MANUAL_ONLY
    cron_expression: PlanCron | None = None
    timezone: PlanTimezone = "Asia/Shanghai"
    budget_limit: PlanBudget | None = None
    rule_set_revision: int = Field(default=1, strict=True, ge=1)

    @model_validator(mode="after")
    def configuration_invariants(self) -> Self:
        require_unique_items([item.subject_id for item in self.subjects])
        if not any(item.role == GeoPlanSubjectRole.PRIMARY for item in self.subjects):
            raise ValueError("计划至少需要一个 PRIMARY 监测对象")
        if (self.schedule_kind == GeoPlanScheduleKind.CRON) != (self.cron_expression is not None):
            raise ValueError("CRON 必须提供表达式，MANUAL_ONLY 必须为空")
        return self


class GeoMonitoringPlanCreate(GeoMonitoringPlanConfiguration):
    pass


class GeoMonitoringPlanRevisionRequest(ContractModel):
    expected_revision: Revision


class GeoMonitoringPlanUpdate(GeoMonitoringPlanConfiguration):
    """完整替换配置，避免 PATCH 集合片段绕过聚合完整性；不允许写状态或追溯。"""

    expected_revision: Revision


class GeoMonitoringPlanOut(GeoMonitoringPlanConfiguration):
    """数据组件，不是尚未实施的 Plan 详情/动作/运行健康读模型。"""

    id: UUID
    status: GeoMonitoringPlanStatus
    revision: Revision
    created_by: UUID
    updated_by: UUID
    created_at: datetime
    updated_at: datetime
