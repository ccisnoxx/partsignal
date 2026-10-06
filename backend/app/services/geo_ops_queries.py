"""受保护运维快照：固定聚合查询、单一只读事务，不加载正文或业务快照。"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any, cast
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.models.geo_observability import OPERATIONS
from app.schemas.geo_runs import GeoBatchStatus, GeoRunStatus

MODES = ("MANUAL", "API", "BROWSER")
SNAPSHOT_SELECT_COUNT = 15
_MODE = "r.input_snapshot->'profile'->>'collection_mode'"
_PENDING = f"""
    SELECT r.id, r.id AS run_id, {_MODE} AS mode,
        CASE WHEN {_MODE}='MANUAL' THEN 'MANUAL_ENTRY' ELSE 'COLLECTION' END AS stage,
        r.created_at, COALESCE(r.last_dispatch_attempt_at,r.created_at) AS dispatch_at
    FROM geo_observation_runs r WHERE r.status='PENDING'
    UNION ALL
    SELECT r.id, r.id, {_MODE}, 'ANALYSIS', r.collected_at, r.collected_at
    FROM geo_observation_runs r WHERE r.status='COLLECTED'
        AND NOT EXISTS (SELECT 1 FROM geo_analysis_revisions a WHERE a.run_id=r.id)
    UNION ALL
    SELECT a.id, r.id, {_MODE}, 'ANALYSIS', a.created_at,
        COALESCE(j.last_dispatch_attempt_at,a.created_at)
    FROM geo_analysis_revisions a JOIN geo_observation_runs r ON r.id=a.run_id
        LEFT JOIN geo_analysis_jobs j ON j.analysis_revision_id=a.id
    WHERE a.status='PENDING' AND j.claimed_at IS NULL
"""
_ACCOUNTED = """
    SELECT r.id AS run_id, r.batch_id, s.budget_day, s.state,
        CASE WHEN s.state='SETTLED' THEN r.cost_amount ELSE s.estimated_amount END AS amount,
        CASE WHEN s.state='SETTLED' THEN r.cost_currency ELSE s.estimated_currency END AS currency
    FROM geo_collection_reservations s JOIN geo_observation_runs r ON r.id=s.run_id
    WHERE s.state<>'RELEASED' AND r.input_snapshot->'profile'->>'collection_mode'='API'
"""


def _json(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (Decimal, UUID)):
        return str(value)
    if isinstance(value, dict):
        return {key: _json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json(item) for item in value]
    return value


def _rows(db: Session, statement: str, values: dict[str, Any]) -> list[dict[str, Any]]:
    return [dict(row) for row in db.execute(text(statement), values).mappings()]


def _backlog(db: Session, values: dict[str, Any], *, dispatch: bool) -> list[dict[str, Any]]:
    clock = "dispatch_at" if dispatch else "created_at"
    where = "WHERE dispatch_at <= :dispatch_cutoff AND stage<>'MANUAL_ENTRY'" if dispatch else ""
    result = _rows(db, f"""
        WITH candidates AS ({_PENDING}), ranked AS (
            SELECT *, count(*) OVER (PARTITION BY mode,stage) AS count,
                row_number() OVER (PARTITION BY mode,stage ORDER BY {clock},id) AS ordinal
            FROM candidates {where}
        ) SELECT mode,stage,count,id AS oldest_id,run_id AS oldest_run_id,
            {clock} AS oldest_at,EXTRACT(EPOCH FROM (:as_of-{clock})) AS oldest_age_seconds
        FROM ranked WHERE ordinal=1 ORDER BY mode,stage
    """, values)
    by_key = {(row["mode"], row["stage"]): row for row in result}
    return [
        by_key.get((mode, stage), {
            "mode": mode, "stage": stage, "count": 0, "oldest_id": None,
            "oldest_run_id": None, "oldest_at": None, "oldest_age_seconds": None,
        })
        for mode in MODES
        for stage in (("MANUAL_ENTRY", "ANALYSIS") if mode == "MANUAL"
                      else ("COLLECTION", "ANALYSIS"))
        if not dispatch or stage != "MANUAL_ENTRY"
    ]


def _daily_budget(db: Session, values: dict[str, Any]) -> dict[str, Any]:
    row = _rows(db, f"""
        WITH accounted AS ({_ACCOUNTED}) SELECT count(*) AS count,
            count(*) FILTER (WHERE state='UNKNOWN' OR amount IS NULL) AS unknown_count,
            count(*) FILTER (WHERE currency IS NOT NULL AND currency<>:budget_currency)
                AS currency_mismatch_count,
            sum(amount) FILTER (WHERE currency=:budget_currency AND state<>'UNKNOWN')
                AS reported_or_reserved_amount,
            ARRAY(SELECT run_id FROM accounted WHERE budget_day=:day
                AND (state='UNKNOWN' OR amount IS NULL OR currency<>:budget_currency OR
                    (SELECT sum(amount) FROM accounted WHERE budget_day=:day
                        AND currency=:budget_currency AND state<>'UNKNOWN')>:budget_limit)
                ORDER BY run_id LIMIT 20) AS anomalous_run_ids
        FROM accounted WHERE budget_day=:day
    """, values)[0]
    limit = settings.geo_daily_budget_limit
    known = row["unknown_count"] == 0 and row["currency_mismatch_count"] == 0
    amount = row["reported_or_reserved_amount"] if known else None
    return {
        **row, "currency": settings.geo_daily_budget_currency, "limit": limit,
        "accounted_amount": amount,
        "utilization": amount / limit if amount is not None and limit is not None
        and limit > 0 else None,
        "exceeded": amount > limit if amount is not None and limit is not None else None,
        "blocked_by_unknown": bool(limit is not None and not known),
    }


def _batch_budgets(db: Session, values: dict[str, Any]) -> dict[str, Any]:
    # Batch 限额跨全部历史 attempt；结果只携带前 20 个异常身份，数量仍是完整聚合。
    return _rows(db, f"""
        WITH accounted AS ({_ACCOUNTED}), budgets AS (
            SELECT a.batch_id,(b.plan_snapshot->>'budget_limit')::numeric AS budget_limit,
                count(*) FILTER (WHERE a.state='UNKNOWN' OR a.amount IS NULL) AS unknown_count,
                count(DISTINCT a.currency) AS currency_count,min(a.currency) AS currency,
                sum(a.amount) FILTER (WHERE a.state<>'UNKNOWN') AS amount
            FROM accounted a JOIN geo_observation_batches b ON b.id=a.batch_id
            WHERE b.plan_snapshot->>'budget_limit' IS NOT NULL
            GROUP BY a.batch_id,b.plan_snapshot->>'budget_limit'
        ), anomalies AS (
            SELECT batch_id,budget_limit::text AS budget_limit,unknown_count,currency_count,
                CASE WHEN currency_count=1 THEN currency END AS currency,
                CASE WHEN currency_count=1 AND unknown_count=0 THEN amount::text END AS amount,
                CASE WHEN currency_count=1 AND unknown_count=0 THEN amount>budget_limit
                    END AS exceeded
            FROM budgets WHERE unknown_count>0 OR currency_count<>1 OR amount>budget_limit
        ) SELECT (SELECT count(*) FROM anomalies) AS count,
            COALESCE((SELECT jsonb_agg(to_jsonb(limited)) FROM
                (SELECT * FROM anomalies ORDER BY batch_id LIMIT 20) limited),'[]'::jsonb) AS items
    """, values)[0]


def read_snapshot(db: Session) -> dict[str, Any]:
    """调用者必须提供全新 Session；本函数拥有短只读 RR 事务与超时。"""
    if db.in_transaction() or db.new or db.dirty or db.deleted:
        raise ValueError("GEO 运维快照需要没有事务或待写入对象的全新 Session")
    with db.begin(), db.no_autoflush:
        db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
        db.execute(text("SET LOCAL statement_timeout='5s'"))
        db.execute(text("SET LOCAL lock_timeout='1s'"))
        as_of = db.scalar(text("SELECT CURRENT_TIMESTAMP"))
        assert isinstance(as_of, datetime)
        values = {
            "as_of": as_of, "since": as_of-timedelta(hours=24),
            "day": as_of.astimezone(UTC).date(),
            "dispatch_cutoff": as_of-timedelta(seconds=settings.geo_pending_redispatch_seconds),
            "budget_currency": settings.geo_daily_budget_currency,
            "budget_limit": settings.geo_daily_budget_limit,
        }
        run_rows = _rows(db, f"""
            SELECT {_MODE} AS mode,r.status,count(*) AS count
            FROM geo_observation_runs r GROUP BY mode,r.status ORDER BY mode,r.status
        """, values)
        run_counts = {(row["mode"], row["status"]): row["count"] for row in run_rows}
        batch_rows = _rows(db, """
            SELECT status,count(*) AS count FROM geo_observation_batches GROUP BY status
        """, values)
        batch_counts = {row["status"]: row["count"] for row in batch_rows}
        pending = _backlog(db, values, dispatch=False)
        dispatch = _backlog(db, values, dispatch=True)
        expired = _rows(db, """
            WITH candidates AS (
                SELECT 'COLLECTION' AS stage,r.id,r.id AS run_id,r.lease_expires_at AS expired_at
                FROM geo_observation_runs r WHERE r.status='RUNNING'
                    AND r.lease_expires_at<=:as_of
                UNION ALL
                SELECT 'ANALYSIS',a.id,a.run_id,j.lease_expires_at
                FROM geo_analysis_revisions a JOIN geo_analysis_jobs j
                    ON j.analysis_revision_id=a.id
                WHERE a.status='PENDING' AND j.lease_expires_at<=:as_of
            ), ranked AS (
                SELECT *,count(*) OVER (PARTITION BY stage) AS count,
                    row_number() OVER (PARTITION BY stage ORDER BY expired_at,id) AS ordinal
                FROM candidates
            ) SELECT stage,count,id AS oldest_id,run_id AS oldest_run_id,
                expired_at AS oldest_at,EXTRACT(EPOCH FROM (:as_of-expired_at))
                    AS oldest_age_seconds FROM ranked WHERE ordinal=1 ORDER BY stage
        """, values)
        expired_counts = {row["stage"]: row for row in expired}
        run_failures = _rows(db, f"""
            SELECT {_MODE} AS mode,r.error_stage AS stage,r.error_code,count(*) AS count
            FROM geo_observation_runs r WHERE r.status IN ('FAILED','BUDGET_BLOCKED')
                AND r.finished_at>=:since AND r.finished_at<=:as_of
            GROUP BY mode,stage,r.error_code ORDER BY mode,stage,r.error_code
        """, values)
        analysis_failures = _rows(db, f"""
            SELECT {_MODE} AS mode,a.error_code,count(*) AS count
            FROM geo_analysis_revisions a JOIN geo_observation_runs r ON r.id=a.run_id
            WHERE a.status='FAILED' AND a.finished_at>=:since AND a.finished_at<=:as_of
            GROUP BY mode,a.error_code ORDER BY mode,a.error_code
        """, values)
        collection = _rows(db, f"""
            SELECT {_MODE} AS mode,
                count(a.id) FILTER (WHERE a.collected_at>=:since AND a.collected_at<=:as_of)
                    AS success_count,
                count(r.duration_ms) AS duration_known_count,avg(r.duration_ms) AS duration_avg_ms,
                min(r.duration_ms) AS duration_min_ms,max(r.duration_ms) AS duration_max_ms,
                count(r.prompt_tokens) AS prompt_tokens_known_count,
                sum(r.prompt_tokens) AS prompt_tokens,
                count(r.completion_tokens) AS completion_tokens_known_count,
                sum(r.completion_tokens) AS completion_tokens,
                count(r.total_tokens) AS total_tokens_known_count,
                sum(r.total_tokens) AS total_tokens
            FROM geo_observation_runs r LEFT JOIN geo_answer_snapshots a ON a.run_id=r.id
            WHERE COALESCE(a.collected_at,r.finished_at,r.started_at)>=:since
                AND COALESCE(a.collected_at,r.finished_at,r.started_at)<=:as_of
            GROUP BY mode ORDER BY mode
        """, values)
        review = _rows(db, """
            WITH candidates AS (
                SELECT r.id,a.created_at FROM geo_observation_runs r
                JOIN geo_analysis_revisions a ON a.id=r.current_analysis_revision_id
                WHERE a.status='COMPLETED' AND jsonb_array_length(a.review_required_reasons)>0
                    AND NOT EXISTS (SELECT 1 FROM geo_run_reviews v
                        WHERE v.run_id=r.id AND v.analysis_revision_id=a.id)
            ) SELECT count(*) AS count,min(created_at) AS oldest_at,
                (SELECT id FROM candidates ORDER BY created_at,id LIMIT 1) AS oldest_run_id
                FROM candidates
        """, values)[0]
        cost_rows = _rows(db, """
            SELECT r.cost_currency AS currency,count(*) AS calls,
                count(r.cost_amount) AS reported_calls,sum(r.cost_amount) AS reported_amount,
                count(*) FILTER (WHERE r.external_call_state='UNKNOWN') AS unknown_outcome_count,
                count(*) FILTER (WHERE r.cost_amount>s.estimated_amount
                    AND r.cost_currency=s.estimated_currency) AS underestimated_count
            FROM geo_collection_reservations s JOIN geo_observation_runs r ON r.id=s.run_id
            WHERE s.budget_day=:day AND s.sent_at IS NOT NULL
                AND r.input_snapshot->'profile'->>'collection_mode'='API'
            GROUP BY r.cost_currency ORDER BY r.cost_currency NULLS LAST
        """, values)
        calls = sum(row["calls"] for row in cost_rows)
        reported = sum(row["reported_calls"] for row in cost_rows)
        operation_rows = _rows(db, """
            SELECT operation,last_attempt_at,last_success_at,last_failure_at,success_count,
                failure_count,duration_ms,duration_total_ms FROM geo_operation_health
                ORDER BY operation
        """, values)
        operations = {row["operation"]: row for row in operation_rows}
        browser_rows = _rows(db, """
            WITH sessions AS (
                SELECT CASE WHEN revoked_at IS NULL AND expires_at<=:as_of THEN 'EXPIRED'
                    ELSE health END AS status,revoked_at,purged_at
                FROM geo_browser_sessions
            ) SELECT status,count(*) AS count,
                count(*) FILTER (WHERE revoked_at IS NULL) AS current_count,
                count(*) FILTER (WHERE revoked_at IS NOT NULL AND purged_at IS NULL)
                    AS cleanup_pending_count
            FROM sessions GROUP BY status ORDER BY status
        """, values)
        return cast(dict[str, Any], _json({
            "schema_version": 1, "as_of": as_of, "budget_day": values["day"],
            "flags": {name: bool(getattr(settings, name)) for name in (
                "geo_monitoring_enabled", "geo_api_collection_enabled",
                "geo_browser_collection_enabled", "geo_opportunity_evaluation_enabled",
            )},
            "run_status": [{"mode": mode, "status": status.value,
                            "count": run_counts.get((mode, status.value), 0)}
                           for mode in MODES for status in GeoRunStatus],
            "batch_status": [{"status": status.value, "count": batch_counts.get(status.value, 0)}
                             for status in GeoBatchStatus],
            "pending": pending, "dispatch_due": dispatch,
            "expired": [expired_counts.get(stage, {"stage": stage, "count": 0,
                        "oldest_id": None, "oldest_run_id": None, "oldest_at": None,
                        "oldest_age_seconds": None}) for stage in ("COLLECTION", "ANALYSIS")],
            "run_failures_24h": run_failures, "analysis_failures_24h": analysis_failures,
            "collection_24h": collection, "review_backlog": review,
            "api_daily": {"calls": calls, "reported_calls": reported,
                "coverage_rate": Decimal(reported)/calls if calls else None,
                "unknown_cost_count": calls-reported,
                "unknown_outcome_count": sum(row["unknown_outcome_count"] for row in cost_rows),
                "underestimated_count": sum(row["underestimated_count"] for row in cost_rows),
                "currencies": [row for row in cost_rows if row["currency"] is not None]},
            "daily_budget": _daily_budget(db, values),
            "batch_budget_anomalies": _batch_budgets(db, values),
            "browser_sessions": {"statuses": browser_rows,
                "current_unhealthy_count": sum(row["current_count"] for row in browser_rows
                                               if row["status"] != "AVAILABLE"),
                "cleanup_pending_count": sum(row["cleanup_pending_count"] for row in browser_rows),
                "login_probe": "NOT_IMPLEMENTED"},
            "operations": [{**operations[operation], "observed": True} if operation in operations
                else {"operation": operation, "observed": False, "last_attempt_at": None,
                    "last_success_at": None, "last_failure_at": None, "success_count": None,
                    "failure_count": None, "duration_ms": None, "duration_total_ms": None}
                for operation in OPERATIONS],
        }))
