"""运维文本边界：未知值、固定标签、时间与低敏投影。"""

from copy import deepcopy
from typing import Any

import pytest

from app.models.geo_observability import OPERATIONS
from app.services.geo_ops_metrics import render_metrics


@pytest.fixture
def snapshot() -> dict[str, Any]:
    return {
        "schema_version": 1, "as_of": "2026-10-05T00:00:00+00:00",
        "flags": {name: False for name in (
            "geo_monitoring_enabled", "geo_api_collection_enabled",
            "geo_browser_collection_enabled", "geo_opportunity_evaluation_enabled",
        )},
        "run_status": [], "batch_status": [], "pending": [], "dispatch_due": [],
        "expired": [], "run_failures_24h": [], "analysis_failures_24h": [],
        "collection_24h": [], "review_backlog": {"count": 0},
        "api_daily": {"calls": 0, "reported_calls": 0, "coverage_rate": None,
                      "unknown_cost_count": 0, "unknown_outcome_count": 0,
                      "underestimated_count": 0, "currencies": []},
        "daily_budget": {"currency": "USD", "utilization": None, "exceeded": None,
                         "unknown_count": 0, "currency_mismatch_count": 0},
        "batch_budget_anomalies": {"count": 0, "items": []},
        "browser_sessions": {"statuses": [], "current_unhealthy_count": 0,
                             "cleanup_pending_count": 0, "login_probe": "NOT_IMPLEMENTED"},
        "operations": [{"operation": operation, "observed": False, "last_attempt_at": None,
                        "last_success_at": None, "last_failure_at": None,
                        "success_count": None, "failure_count": None, "duration_ms": None,
                        "duration_total_ms": None} for operation in OPERATIONS],
    }


def test_unknown_cost_and_never_observed_are_not_zero(snapshot: dict[str, Any]) -> None:
    value = render_metrics(snapshot)
    assert "geo_cost_coverage_rate NaN\n" in value
    assert 'geo_daily_budget_utilization{currency="USD"} NaN\n' in value
    assert 'geo_operation_observed{operation="scheduler_publish"} 0\n' in value
    assert 'geo_operation_last_success_timestamp_seconds' \
        '{operation="scheduler_publish"} NaN' in value
    assert 'geo_operation_failure_total{operation="scheduler_publish"} NaN' in value
    assert "geo_reported_cost_daily" not in value
    assert "geo_observability_snapshot_timestamp_seconds 1791158400.0\n" in value


def test_costs_remain_per_currency_and_identifiers_never_become_labels(
    snapshot: dict[str, Any],
) -> None:
    snapshot["api_daily"]["currencies"] = [
        {"currency": "USD", "reported_amount": "0.000001"},
        {"currency": "EUR", "reported_amount": "2.500000"},
    ]
    snapshot["pending"] = [{
        "mode": "API", "stage": "COLLECTION", "count": 1, "oldest_age_seconds": "300",
        "oldest_id": "secret-canary-UUID", "oldest_run_id": "secret-canary-provider-id",
        "prompt": "secret-canary-prompt", "error_summary": "secret-canary-error",
    }]
    value = render_metrics(snapshot)
    assert 'geo_reported_cost_daily{currency="USD"} 0.000001\n' in value
    assert 'geo_reported_cost_daily{currency="EUR"} 2.500000\n' in value
    assert value.count("# TYPE geo_reported_cost_daily gauge") == 1
    assert "secret-canary" not in value
    assert 'geo_pending_oldest_seconds{mode="API",stage="COLLECTION"} 300\n' in value


@pytest.mark.parametrize("field,row", [
    ("pending", {"mode": 'secret-canary"}\ninjected', "stage": "COLLECTION",
                 "count": 1, "oldest_age_seconds": 1}),
    ("run_status", {"mode": "API", "status": "secret-canary-model", "count": 1}),
    ("run_failures_24h", {"mode": "API", "stage": "COLLECTION",
                         "error_code": "secret-canary-error", "count": 1}),
    ("operations", {"operation": "secret-canary-operation", "observed": True}),
])
def test_untrusted_label_values_are_rejected_before_text_is_returned(
    snapshot: dict[str, Any], field: str, row: dict[str, Any],
) -> None:
    snapshot[field] = [row]
    with pytest.raises(ValueError, match="固定白名单") as error:
        render_metrics(snapshot)
    assert "secret-canary" not in str(error.value)


def test_currency_and_nonfinite_number_are_explicit_failures(snapshot: dict[str, Any]) -> None:
    invalid = deepcopy(snapshot)
    invalid["api_daily"]["currencies"] = [{"currency": "USD\n", "reported_amount": 1}]
    with pytest.raises(ValueError, match="固定白名单"):
        render_metrics(invalid)
    snapshot["api_daily"]["coverage_rate"] = "Infinity"
    with pytest.raises(ValueError, match="有限数值"):
        render_metrics(snapshot)
