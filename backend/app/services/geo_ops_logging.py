"""GEO低敏结构日志的唯一字段边界；不接收任意上下文或异常正文。"""

import json
import logging
import sys
from contextlib import suppress
from decimal import Decimal
from enum import StrEnum
from typing import Literal, get_args
from uuid import UUID

from app.schemas.geo_runs import GeoRunErrorCode


class OpsError(StrEnum):
    OPERATION_FAILED = "OPERATION_FAILED"
    OPERATION_REJECTED = "OPERATION_REJECTED"
    BROKER_UNAVAILABLE = "BROKER_UNAVAILABLE"
    DATABASE_UNAVAILABLE = "DATABASE_UNAVAILABLE"
    OBSERVABILITY_WRITE_FAILED = "OBSERVABILITY_WRITE_FAILED"
    STORAGE_UNAVAILABLE = "STORAGE_UNAVAILABLE"
    LEASE_LOST = "LEASE_LOST"
    LOGGING_UNAVAILABLE = "LOGGING_UNAVAILABLE"


type Stage = Literal[
    "COLLECTION",
    "ANALYSIS",
    "SCHEDULER",
    "WORKER",
    "BATCH",
    "OPPORTUNITY",
    "STORAGE",
    "RETENTION",
    "OBSERVABILITY",
]
type Status = Literal["SUCCEEDED", "FAILED", "SKIPPED", "REJECTED", "HEARTBEAT"]
type Event = Literal[
    "operation_finished",
    "dispatch_failed",
    "collection_finished",
    "analysis_finished",
    "lease_lost",
    "observation_write_failed",
    "scheduler_publish",
    "heartbeat",
    "retention_finished", "logging_sink_failed",
]


def geo_event(
    *,
    event: Event,
    stage: Stage,
    status: Status,
    error_code: OpsError | GeoRunErrorCode | None = None,
    run_id: UUID | None = None,
    batch_id: UUID | None = None,
    profile_id: UUID | None = None,
    analysis_id: UUID | None = None,
    file_id: UUID | None = None,
    duration_ms: int | None = None,
    byte_count: int | None = None,
    citation_count: int | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
    cost_amount: Decimal | None = None,
    cost_currency: str | None = None,
    selected_count: int | None = None,
    purged_count: int | None = None,
    retry_count: int | None = None,
) -> None:
    """固定字段和值类型；自由文本、request/provider ID及异常对象不属于日志合同。"""
    if error_code is not None and not isinstance(error_code, OpsError | GeoRunErrorCode):
        raise ValueError("GEO日志错误码必须来自固定目录")
    if (
        event not in get_args(Event.__value__)
        or stage not in get_args(Stage.__value__)
        or status not in get_args(Status.__value__)
    ):
        raise ValueError("GEO日志事件、阶段与状态必须来自固定目录")
    payload: dict[str, object] = {
        "schema_version": 1,
        "component": f"partsignal.geo.{stage.lower()}",
        "event": event,
        "stage": stage,
        "status": status,
        "error_code": error_code,
    }
    for name, identity in (
        ("run_id", run_id),
        ("batch_id", batch_id),
        ("profile_id", profile_id),
        ("analysis_id", analysis_id),
        ("file_id", file_id),
    ):
        if identity is not None:
            if not isinstance(identity, UUID):
                raise ValueError("GEO日志资源标识必须是UUID")
            payload[name] = str(identity)
    for name, value in (
        ("duration_ms", duration_ms),
        ("byte_count", byte_count),
        ("citation_count", citation_count),
        ("prompt_tokens", prompt_tokens),
        ("completion_tokens", completion_tokens),
        ("total_tokens", total_tokens),
        ("selected_count", selected_count),
        ("purged_count", purged_count),
        ("retry_count", retry_count),
    ):
        if value is not None:
            if type(value) is not int or value < 0:
                raise ValueError("GEO日志数量必须是非负整数")
            payload[name] = value
    if cost_amount is not None or cost_currency is not None:
        if (
            not isinstance(cost_amount, Decimal)
            or not cost_amount.is_finite()
            or cost_amount < 0
            or cost_currency is None
            or len(cost_currency) != 3
            or not cost_currency.isascii()
            or not cost_currency.isalpha()
            or not cost_currency.isupper()
        ):
            raise ValueError("GEO日志费用必须是明确的有限金额与三位币种")
        payload.update(cost_amount=str(cost_amount), cost_currency=cost_currency)
    logger = logging.getLogger(str(payload["component"]))
    try:
        logger.log(
            logging.WARNING if status == "FAILED" else logging.INFO,
            json.dumps(payload, ensure_ascii=False, sort_keys=True),
        )
    except Exception:
        # 参数校验仍是开发合同；sink故障不得撤销已接受回执，也不递归调用logger。
        # 两个诊断通道均失效时保留业务结果；由进程日志基础设施排障。
        with suppress(Exception):
            sys.stderr.write(
                '{"schema_version":1,"component":"partsignal.geo.observability",'
                '"event":"logging_sink_failed","stage":"OBSERVABILITY",'
                '"status":"FAILED","error_code":"LOGGING_UNAVAILABLE"}\n'
            )
