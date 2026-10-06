"""有限低敏标签的 Prometheus text format；定位身份只留在受保护 JSON。"""

import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from app.models.geo_observability import OPERATIONS
from app.schemas.geo_runs import GeoBatchStatus, GeoRunErrorCode, GeoRunErrorStage, GeoRunStatus
from app.services.geo_ops_queries import MODES

_LABELS = {
    "mode": set(MODES),
    "stage": {"MANUAL_ENTRY", *(value.value for value in GeoRunErrorStage)},
    "status": {*(value.value for value in GeoRunStatus),
               *(value.value for value in GeoBatchStatus),
               "AVAILABLE", "EXPIRED", "REVOKED", "MISSING", "UNREADABLE"},
    "error_code": {value.value for value in GeoRunErrorCode},
    "operation": set(OPERATIONS),
}


def _number(value: Any) -> str:
    if value is None:
        return "NaN"
    if isinstance(value, bool):
        return str(int(value))
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise ValueError("GEO 运维指标必须为低敏数值") from error
    if not number.is_finite():
        raise ValueError("GEO 运维指标必须为有限数值或明确空值")
    return str(number)


def _timestamp(value: str | None) -> float | None:
    if value is None:
        return None
    return datetime.fromisoformat(value).timestamp()


def _labels(values: dict[str, Any]) -> str:
    for key, value in values.items():
        valid = (isinstance(value, str) and re.fullmatch(r"[A-Z]{3}", value) is not None
                 if key == "currency" else key in _LABELS and value in _LABELS[key])
        if not valid:
            raise ValueError("GEO 运维指标标签不在固定白名单中")
    return "{" + ",".join(f'{key}="{value}"' for key, value in values.items()) + "}" \
        if values else ""


def render_metrics(snapshot: dict[str, Any]) -> str:
    """成功快照输出 up=1；读取失败由 CLI 以固定 up=0 文本明确报告。"""
    if snapshot["schema_version"] != 1:
        raise ValueError("GEO 运维快照版本不受支持")
    lines: list[str] = []
    declared: set[str] = set()

    def emit(name: str, value: Any, *, kind: str = "gauge", **labels: Any) -> None:
        if name not in declared:
            lines.extend((f"# HELP {name} GEO operational observation.",
                          f"# TYPE {name} {kind}"))
            declared.add(name)
        lines.append(f"{name}{_labels(labels)} {_number(value)}")

    emit("geo_observability_up", 1)
    emit("geo_observability_snapshot_timestamp_seconds", _timestamp(snapshot["as_of"]))
    for name in ("geo_monitoring_enabled", "geo_api_collection_enabled",
                 "geo_browser_collection_enabled", "geo_opportunity_evaluation_enabled"):
        emit(name, snapshot["flags"][name])
    for row in snapshot["run_status"]:
        emit("geo_run_status_count", row["count"], mode=row["mode"], status=row["status"])
    for row in snapshot["batch_status"]:
        emit("geo_batch_status_count", row["count"], status=row["status"])
    for field, prefix in (("pending", "geo_pending"), ("dispatch_due", "geo_dispatch_due")):
        for row in snapshot[field]:
            labels = {"mode": row["mode"], "stage": row["stage"]}
            emit(f"{prefix}_count", row["count"], **labels)
            emit(f"{prefix}_oldest_seconds", row["oldest_age_seconds"], **labels)
    for row in snapshot["expired"]:
        emit("geo_running_expired_count", row["count"], stage=row["stage"])
        emit("geo_running_expired_oldest_seconds", row["oldest_age_seconds"], stage=row["stage"])
    for row in snapshot["run_failures_24h"]:
        emit("geo_run_failure_count_24h", row["count"], mode=row["mode"],
             stage=row["stage"], error_code=row["error_code"])
    for row in snapshot["analysis_failures_24h"]:
        emit("geo_analysis_failure_count_24h", row["count"], mode=row["mode"],
             error_code=row["error_code"])
    for row in snapshot["collection_24h"]:
        emit("geo_collection_success_count_24h", row["success_count"], mode=row["mode"])
        for aggregate in ("avg", "min", "max"):
            emit(f"geo_collection_duration_{aggregate}_ms_24h", row[f"duration_{aggregate}_ms"],
                 mode=row["mode"])
        emit("geo_collection_duration_known_count_24h", row["duration_known_count"],
             mode=row["mode"])
        for usage in ("prompt_tokens", "completion_tokens", "total_tokens"):
            emit(f"geo_collection_{usage}_24h", row[usage], mode=row["mode"])
            emit(f"geo_collection_{usage}_known_count_24h", row[f"{usage}_known_count"],
                 mode=row["mode"])
    emit("geo_review_backlog", snapshot["review_backlog"]["count"])
    daily = snapshot["api_daily"]
    emit("geo_api_calls_daily", daily["calls"])
    emit("geo_cost_reported_calls_daily", daily["reported_calls"])
    emit("geo_cost_coverage_rate", daily["coverage_rate"])
    emit("geo_cost_unknown_daily", daily["unknown_cost_count"])
    emit("geo_api_unknown_outcome_daily", daily["unknown_outcome_count"])
    emit("geo_cost_underestimated_daily", daily["underestimated_count"])
    for row in daily["currencies"]:
        emit("geo_reported_cost_daily", row["reported_amount"], currency=row["currency"])
    budget = snapshot["daily_budget"]
    emit("geo_daily_budget_utilization", budget["utilization"], currency=budget["currency"])
    emit("geo_daily_budget_exceeded", budget["exceeded"], currency=budget["currency"])
    emit("geo_daily_budget_unknown_count", budget["unknown_count"], currency=budget["currency"])
    emit("geo_daily_budget_currency_mismatch_count", budget["currency_mismatch_count"],
         currency=budget["currency"])
    emit("geo_batch_budget_anomaly_count", snapshot["batch_budget_anomalies"]["count"])
    for row in snapshot["browser_sessions"]["statuses"]:
        emit("geo_browser_session_count", row["count"], status=row["status"])
    emit("geo_browser_session_unhealthy", snapshot["browser_sessions"]["current_unhealthy_count"])
    for row in snapshot["operations"]:
        labels = {"operation": row["operation"]}
        emit("geo_operation_observed", row["observed"], **labels)
        for outcome in ("attempt", "success", "failure"):
            emit(f"geo_operation_last_{outcome}_timestamp_seconds",
                 _timestamp(row[f"last_{outcome}_at"]), **labels)
        emit("geo_operation_success_total", row["success_count"], kind="counter", **labels)
        emit("geo_operation_failure_total", row["failure_count"], kind="counter", **labels)
        emit("geo_operation_duration_ms", row["duration_ms"], **labels)
        emit("geo_operation_duration_total_ms", row["duration_total_ms"], kind="counter", **labels)
    return "\n".join(lines) + "\n"
