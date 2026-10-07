"""隔离 PostgreSQL 运维快照；合法历史、低敏字段和一致只读事务。"""

import json
from collections.abc import Iterator
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb
from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.config import settings
from app.services.geo_ops_metrics import render_metrics
from app.services.geo_ops_queries import SNAPSHOT_SELECT_COUNT, read_snapshot
from tests.integration.geo_analysis_support import collected_case, finish, pending, publish, review
from tests.integration.geo_answers_support import (
    AnswerDatabase,
    answer_database,
    collect,
    plan_database,
    run_database,
    snapshot,
)
from tests.integration.geo_runs_support import batch, run, update
from tests.integration.test_geo_catalog import insert_row
from tests.integration.test_migrations import run_alembic, temporary_database
from tests.unit.test_geo_run_contract import input_snapshot, plan_snapshot

__all__ = ["answer_database", "plan_database", "run_database"]
pytestmark = pytest.mark.integration
CANARY = "geo902-secret-canary-do-not-export"


@pytest.fixture(scope="module")
def ops_engine(answer_database: AnswerDatabase) -> Iterator[Engine]:
    engine = create_engine(answer_database.url.replace("postgresql://", "postgresql+psycopg://"))
    yield engine
    engine.dispose()


def read(engine: Engine) -> dict[str, Any]:
    with Session(engine) as db:
        result = read_snapshot(db)
        assert not db.in_transaction()
        assert not db.identity_map
        return result


def count(rows: list[dict[str, Any]], **labels: str) -> int:
    return sum(row["count"] for row in rows if all(row.get(k) == v for k, v in labels.items()))


def root(
    conn: psycopg.Connection[Any], db: AnswerDatabase, mode: str = "MANUAL", *,
    created: datetime | None = None, budget: str | None = None,
) -> tuple[UUID, UUID]:
    value = input_snapshot(mode)
    value["prompt"] = deepcopy(db.runs.input["prompt"])
    value["prompt"]["prompt_text"] = CANARY
    value["subjects"] = deepcopy(db.runs.input["subjects"])
    value["profile"]["id"] = db.runs.input["profile"]["id"]
    value["profile"]["surface"]["id"] = db.runs.input["profile"]["surface"]["id"]
    value["profile"]["name"] = CANARY
    created = created or datetime.now(UTC)-timedelta(minutes=2)
    batch_id = batch(conn, db.runs, created_at=created,
                     plan_snapshot=Jsonb(plan_snapshot(value, budget_limit=budget)))
    insert_row(conn, "geo_batch_subjects", {
        "batch_id": batch_id, "subject_id": db.runs.plan.subjects[0], "role": "PRIMARY",
    })
    identity = run(conn, db.runs, batch_id, input_snapshot=Jsonb(value), created_at=created)
    return identity, batch_id


def sent(
    conn: psycopg.Connection[Any], identity: UUID, *, estimated: str | None = "1",
    currency: str = "USD", at: datetime | None = None,
) -> datetime:
    at = at or datetime.now(UTC)-timedelta(seconds=30)
    update(conn, identity, status="RUNNING", started_at=at, lease_token=uuid4(),
           lease_expires_at=at+timedelta(minutes=5))
    insert_row(conn, "geo_collection_reservations", {
        "run_id": identity, "state": "RESERVED", "budget_day": at.date(), "reserved_at": at,
        "estimated_amount": Decimal(estimated) if estimated is not None else None,
        "estimated_currency": currency if estimated is not None else None,
    })
    update(conn, identity, external_call_state="SENT")
    conn.execute("UPDATE geo_collection_reservations SET state='SENT',sent_at=%s WHERE run_id=%s",
                 (at, identity))
    return at


def settle(
    conn: psycopg.Connection[Any], identity: UUID, at: datetime, *,
    amount: str | None = None, currency: str = "USD", unknown: bool = False,
) -> None:
    update(conn, identity, status="FAILED", finished_at=at+timedelta(seconds=1),
           lease_token=None, lease_expires_at=None, error_stage="COLLECTION",
           error_code="COLLECTOR_UNKNOWN_OUTCOME" if unknown else "PROVIDER_TIMEOUT",
           error_summary=CANARY, provider_request_id=CANARY, duration_ms=120,
           external_call_state="UNKNOWN" if unknown else "COMPLETED",
           cost_amount=Decimal(amount) if amount is not None else None,
           cost_currency=currency if amount is not None else None)
    conn.execute("UPDATE geo_collection_reservations SET state=%s,settled_at=%s WHERE run_id=%s",
                 ("SETTLED" if amount is not None else "UNKNOWN",
                  at+timedelta(seconds=1), identity))


def test_empty_snapshot_keeps_unknown_and_never_observed() -> None:
    with temporary_database("geo902_empty_ops") as (url, env, backend):
        run_alembic(env, backend, "head")
        engine = create_engine(url.replace("postgresql://", "postgresql+psycopg://"))
        try:
            value = read(engine)
            assert value["api_daily"]["calls"] == 0
            assert value["api_daily"]["coverage_rate"] is None
            assert value["api_daily"]["currencies"] == []
            assert value["daily_budget"]["accounted_amount"] is None
            assert all(row["count"] == 0 and row["oldest_at"] is None for row in value["pending"])
            assert all(row["observed"] is False for row in value["operations"])
            assert "geo_cost_coverage_rate NaN" in render_metrics(value)
        finally:
            engine.dispose()


def test_repeatable_read_readonly_timeouts_and_fixed_query_count(
    ops_engine: Engine, answer_database: AnswerDatabase,
) -> None:
    statements: list[str] = []
    checked = False

    def observe(conn: Any, _cursor: Any, statement: str, _parameters: Any,
                _context: Any, _many: bool) -> None:
        nonlocal checked
        statements.append(statement)
        if checked or statement != "SELECT CURRENT_TIMESTAMP":
            return
        checked = True
        assert conn.exec_driver_sql("SHOW transaction_isolation").scalar() == "repeatable read"
        assert conn.exec_driver_sql("SHOW transaction_read_only").scalar() == "on"
        assert conn.exec_driver_sql("SHOW statement_timeout").scalar() == "5s"
        assert conn.exec_driver_sql("SHOW lock_timeout").scalar() == "1s"

    event.listen(ops_engine, "before_cursor_execute", observe)
    try:
        read(ops_engine)
    finally:
        event.remove(ops_engine, "before_cursor_execute", observe)
    assert checked
    assert sum(value.lstrip().startswith(("SELECT", "WITH")) for value in statements) \
        == SNAPSHOT_SELECT_COUNT
    assert not any("FOR UPDATE" in value or "FOR SHARE" in value for value in statements)
    with Session(ops_engine) as db:
        db.execute(text("SELECT 1"))
        with pytest.raises(ValueError, match="全新 Session"):
            read_snapshot(db)
    # PG 本身拒绝写入，证明只读是数据库合同，不只是 Python 约定。
    with Session(ops_engine) as db, pytest.raises(DBAPIError) as error:
        db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
        db.execute(text("UPDATE geo_operation_health SET success_count=success_count"))
    assert getattr(error.value.orig, "sqlstate", None) == "25006"


def test_concurrent_commit_cannot_mix_operation_facts_into_snapshot(
    ops_engine: Engine, answer_database: AnswerDatabase,
) -> None:
    inserted = False

    def concurrent(_conn: Any, _cursor: Any, statement: str, _parameters: Any,
                   _context: Any, _many: bool) -> None:
        nonlocal inserted
        if inserted or statement != "SELECT CURRENT_TIMESTAMP":
            return
        inserted = True
        with psycopg.connect(answer_database.url) as writer:
            writer.execute("INSERT INTO geo_operation_health("
                           "operation,last_attempt_at,last_success_at,"
                           "success_count,duration_ms,duration_total_ms) VALUES "
                           "('scheduler_tick',now(),now(),1,7,7)")

    event.listen(ops_engine, "after_cursor_execute", concurrent)
    try:
        before = read(ops_engine)
    finally:
        event.remove(ops_engine, "after_cursor_execute", concurrent)
    assert inserted
    assert next(row for row in before["operations"] if row["operation"] == "scheduler_tick") \
        ["observed"] is False
    current = next(row for row in read(ops_engine)["operations"]
                   if row["operation"] == "scheduler_tick")
    assert current["success_count"] == 1 and current["duration_ms"] == 7


def test_pending_age_dispatch_due_and_manual_entry_are_separate(
    ops_engine: Engine, answer_database: AnswerDatabase,
) -> None:
    before = read(ops_engine)
    now = datetime.now(UTC)
    with psycopg.connect(answer_database.url) as conn:
        api, _ = root(conn, answer_database, "API", created=now-timedelta(hours=2))
        update(conn, api, dispatch_attempt_count=1, last_dispatch_attempt_at=now)
        root(conn, answer_database, "MANUAL", created=now-timedelta(hours=3))
        browser, _ = root(conn, answer_database, "BROWSER", created=now-timedelta(hours=1))
        unassembled = collected_case(conn, answer_database)
        waiting = collected_case(conn, answer_database)
        analysis = pending(conn, waiting)
        insert_row(conn, "geo_analysis_jobs", {"analysis_revision_id": analysis})
    after = read(ops_engine)
    api_pending = next(row for row in after["pending"]
                       if row["mode"] == "API" and row["stage"] == "COLLECTION")
    assert api_pending["oldest_id"] == str(api)
    elapsed = (datetime.fromisoformat(after["as_of"])
               - datetime.fromisoformat(api_pending["oldest_at"]))
    assert abs(Decimal(api_pending["oldest_age_seconds"])-Decimal(str(elapsed.total_seconds()))) \
        < Decimal("0.000001")
    assert 7199 < Decimal(api_pending["oldest_age_seconds"]) < 7201
    assert count(after["dispatch_due"], mode="API", stage="COLLECTION") \
        == count(before["dispatch_due"], mode="API", stage="COLLECTION")
    assert next(row for row in after["dispatch_due"] if row["mode"] == "BROWSER"
                and row["stage"] == "COLLECTION")["oldest_id"] == str(browser)
    assert count(after["pending"], mode="MANUAL", stage="MANUAL_ENTRY") \
        == count(before["pending"], mode="MANUAL", stage="MANUAL_ENTRY")+1
    assert not any(row["stage"] == "MANUAL_ENTRY" for row in after["dispatch_due"])
    assert count(after["pending"], mode="MANUAL", stage="ANALYSIS") \
        == count(before["pending"], mode="MANUAL", stage="ANALYSIS")+2
    assert unassembled.run_id != waiting.run_id
    assert CANARY not in json.dumps(after)
    assert CANARY not in render_metrics(after)


def test_new_manual_answer_does_not_inherit_days_waiting_for_manual_entry(
    ops_engine: Engine, answer_database: AnswerDatabase,
) -> None:
    before = read(ops_engine)
    with psycopg.connect(answer_database.url) as conn:
        now = conn.execute("SELECT now()").fetchone()[0]
        identity, _ = root(conn, answer_database, "MANUAL", created=now-timedelta(days=3))
        snapshot(conn, answer_database, identity, prompt_text=CANARY, collected_at=now)
        collect(conn, identity)
    after = read(ops_engine)
    analysis = next(row for row in after["pending"]
                    if row["mode"] == "MANUAL" and row["stage"] == "ANALYSIS")
    assert Decimal(analysis["oldest_age_seconds"]) < 600
    assert count(after["dispatch_due"], mode="MANUAL", stage="ANALYSIS") \
        == count(before["dispatch_due"], mode="MANUAL", stage="ANALYSIS")


def test_daily_costs_use_all_sent_attempts_utc_day_and_separate_currencies(
    ops_engine: Engine, answer_database: AnswerDatabase, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "geo_daily_budget_limit", Decimal("3"))
    monkeypatch.setattr(settings, "geo_daily_budget_currency", "USD")
    before = read(ops_engine)
    with psycopg.connect(answer_database.url) as conn:
        first, batch_id = root(conn, answer_database, "API", budget="1")
        at = sent(conn, first)
        settle(conn, first, at, amount="2")
    monkeypatch.setattr(settings, "geo_daily_budget_limit", Decimal("1"))
    known = read(ops_engine)
    assert known["daily_budget"]["utilization"] == "2.000000"
    assert known["daily_budget"]["exceeded"] is True
    assert str(first) in known["daily_budget"]["anomalous_run_ids"]
    single = next(row for row in known["batch_budget_anomalies"]["items"]
                  if row["batch_id"] == str(batch_id))
    assert single["amount"] == "2.000000" and single["exceeded"] is True
    monkeypatch.setattr(settings, "geo_daily_budget_limit", Decimal("3"))
    with psycopg.connect(answer_database.url) as conn:
        stored = conn.execute("SELECT input_snapshot FROM geo_observation_runs WHERE id=%s",
                              (first,)).fetchone()
        assert stored is not None
        value = stored[0]
        second = run(conn, answer_database.runs, batch_id, input_snapshot=Jsonb(value),
                     attempt_no=2, previous_attempt_id=first, created_at=at+timedelta(seconds=1))
        second_at = sent(conn, second, estimated="2", currency="EUR", at=at+timedelta(seconds=2))
        settle(conn, second, second_at, amount="1", currency="EUR")
        unknown, _ = root(conn, answer_database, "API")
        settle(conn, unknown, sent(conn, unknown), unknown=True)
        yesterday, _ = root(conn, answer_database, "API",
                            created=datetime.now(UTC)-timedelta(days=2))
        older_at = datetime.now(UTC)-timedelta(days=1, hours=1)
        settle(conn, yesterday, sent(conn, yesterday, at=older_at), amount="99")
    after = read(ops_engine)
    daily = after["api_daily"]
    assert daily["calls"] == before["api_daily"]["calls"]+3
    assert daily["reported_calls"] == before["api_daily"]["reported_calls"]+2
    assert daily["coverage_rate"] == str(Decimal(2)/3)
    assert daily["unknown_cost_count"] == 1
    assert daily["unknown_outcome_count"] == 1
    assert daily["underestimated_count"] == 1
    amounts = {row["currency"]: Decimal(row["reported_amount"]) for row in daily["currencies"]}
    assert amounts == {"USD": Decimal(2), "EUR": Decimal(1)}
    assert after["daily_budget"]["utilization"] is None
    assert after["daily_budget"]["currency_mismatch_count"] == 1
    assert str(unknown) in after["daily_budget"]["anomalous_run_ids"]
    anomaly = next(row for row in after["batch_budget_anomalies"]["items"]
                   if row["batch_id"] == str(batch_id))
    assert anomaly["currency_count"] == 2 and anomaly["amount"] is None
    assert count(after["run_status"], mode="API", status="FAILED") \
        == count(before["run_status"], mode="API", status="FAILED")+4
    assert count(after["run_failures_24h"], mode="API", stage="COLLECTION") \
        == count(before["run_failures_24h"], mode="API", stage="COLLECTION")+3
    assert CANARY not in json.dumps(after) and CANARY not in render_metrics(after)
    non_utc = create_engine(
        answer_database.url.replace("postgresql://", "postgresql+psycopg://"),
        connect_args={"options": "-c timezone=Pacific/Honolulu"},
    )
    try:
        local_clock = read(non_utc)
        assert local_clock["budget_day"] == datetime.now(UTC).date().isoformat()
        assert local_clock["api_daily"] == after["api_daily"]
    finally:
        non_utc.dispose()


def test_current_review_and_expired_terminal_reanalysis_keep_collection_success(
    ops_engine: Engine, answer_database: AnswerDatabase,
) -> None:
    before = read(ops_engine)
    with psycopg.connect(answer_database.url) as conn:
        case = collected_case(conn, answer_database, answer_text=CANARY)
        first = pending(conn, case)
        finish(conn, first, failed=True)
        update(conn, case.run_id, status="FAILED", finished_at=datetime.now(UTC),
               error_stage="ANALYSIS", error_code="ANALYSIS_FAILED", error_summary=CANARY)
        successful = pending(conn, case, analyzer_version="geo902-new-success")
        conn.execute("UPDATE geo_analysis_revisions SET status='COMPLETED',finished_at=now(),"
                     "review_required_reasons='[\"LOW_CONFIDENCE\"]' WHERE id=%s", (successful,))
        publish(conn, case, successful)
        review(conn, case, successful, answer_database.runs.plan.actor)
    covered = read(ops_engine)
    assert covered["review_backlog"]["count"] == before["review_backlog"]["count"]
    with psycopg.connect(answer_database.url) as conn:
        current = pending(conn, case, analyzer_version="geo902-current-success")
        conn.execute("UPDATE geo_analysis_revisions SET status='COMPLETED',finished_at=now(),"
                     "review_required_reasons='[\"LOW_CONFIDENCE\"]' WHERE id=%s", (current,))
        publish(conn, case, current)
        at = datetime.now(UTC)-timedelta(minutes=15)
        unfinished = pending(conn, case, analyzer_version="geo902-expired", created_at=at)
        insert_row(conn, "geo_analysis_jobs", {"analysis_revision_id": unfinished})
        conn.execute("UPDATE geo_analysis_jobs SET claimed_at=%s,lease_token=%s,lease_expires_at=%s"
                     " WHERE analysis_revision_id=%s",
                     (at, uuid4(), at+timedelta(minutes=5), unfinished))
    after = read(ops_engine)
    assert after["review_backlog"]["count"] == before["review_backlog"]["count"]+1
    assert after["review_backlog"]["oldest_run_id"] == str(case.run_id)
    assert count(after["expired"], stage="ANALYSIS") == count(before["expired"], stage="ANALYSIS")+1
    expired = next(row for row in after["expired"] if row["stage"] == "ANALYSIS")
    assert expired["oldest_id"] == str(unfinished)
    assert expired["oldest_run_id"] == str(case.run_id)
    assert count(after["analysis_failures_24h"], mode="MANUAL") \
        == count(before["analysis_failures_24h"], mode="MANUAL")+1
    successes_before = sum(row["success_count"] for row in before["collection_24h"])
    assert sum(row["success_count"] for row in after["collection_24h"]) == successes_before+1
    assert not after["flags"]["geo_monitoring_enabled"]
    assert CANARY not in json.dumps(after) and CANARY not in render_metrics(after)


def test_expired_collection_remains_visible_when_collection_is_disabled(
    ops_engine: Engine, answer_database: AnswerDatabase,
) -> None:
    before = read(ops_engine)
    with psycopg.connect(answer_database.url) as conn:
        identity, _ = root(conn, answer_database, "API",
                           created=datetime.now(UTC)-timedelta(hours=1))
        sent(conn, identity, at=datetime.now(UTC)-timedelta(minutes=15))
    after = read(ops_engine)
    assert not after["flags"]["geo_api_collection_enabled"]
    assert count(after["expired"], stage="COLLECTION") \
        == count(before["expired"], stage="COLLECTION")+1
    row = next(row for row in after["expired"] if row["stage"] == "COLLECTION")
    assert row["oldest_run_id"] == str(identity)


def test_successful_collection_with_unknown_cost_keeps_outcome_separate(
    ops_engine: Engine, answer_database: AnswerDatabase,
) -> None:
    before = read(ops_engine)
    with psycopg.connect(answer_database.url) as conn:
        identity, _ = root(conn, answer_database, "API")
        at = sent(conn, identity)
        collected_at = at+timedelta(seconds=1)
        update(conn, identity, external_call_state="COMPLETED")
        snapshot(conn, answer_database, identity, prompt_text=CANARY,
                 answer_text=CANARY, collected_at=collected_at)
        update(conn, identity, status="COLLECTED", collected_at=collected_at,
               lease_token=None, lease_expires_at=None, external_call_state="COMPLETED",
               prompt_tokens=13, completion_tokens=None, total_tokens=None)
        conn.execute("UPDATE geo_collection_reservations SET state='UNKNOWN',settled_at=%s "
                     "WHERE run_id=%s", (collected_at, identity))
    after = read(ops_engine)
    assert after["api_daily"]["unknown_cost_count"] == before["api_daily"]["unknown_cost_count"]+1
    assert after["api_daily"]["unknown_outcome_count"] \
        == before["api_daily"]["unknown_outcome_count"]
    collection = next(row for row in after["collection_24h"] if row["mode"] == "API")
    assert collection["prompt_tokens"] == 13
    assert collection["completion_tokens"] is None and collection["total_tokens"] is None
    assert 'geo_collection_total_tokens_24h{mode="API"} NaN' in render_metrics(after)


def test_browser_health_is_existing_metadata_and_expiry_never_login_probe(
    ops_engine: Engine, answer_database: AnswerDatabase,
) -> None:
    before = read(ops_engine)
    now = datetime.now(UTC)
    with psycopg.connect(answer_database.url) as conn:
        for expired in (False, True):
            profile, reference = uuid4(), uuid4()
            insert_row(conn, "geo_collection_profiles", {
                "id": profile,
                "engine_surface_id": UUID(answer_database.runs.input["profile"]["surface"]["id"]),
                "name": CANARY+str(profile), "collection_mode": "BROWSER",
                "adapter_key": "browser-session", "language_code": "zh-hans", "region_code": "CN",
                "login_state": "AUTHENTICATED", "web_search_policy": "UNKNOWN",
                "created_by": answer_database.runs.plan.actor,
            })
            insert_row(conn, "geo_browser_sessions", {
                "id": reference, "profile_id": profile, "cipher_sha256": "f"*64,
                "expires_at": now+timedelta(hours=-1 if expired else 1), "health": "AVAILABLE",
                "last_checked_at": now-timedelta(hours=2), "created_at": now-timedelta(hours=2),
                "created_by": answer_database.runs.plan.actor,
            })
    after = read(ops_engine)
    metadata = after["browser_sessions"]
    assert metadata["login_probe"] == "NOT_IMPLEMENTED"
    assert metadata["current_unhealthy_count"] \
        == before["browser_sessions"]["current_unhealthy_count"]+1
    assert count(metadata["statuses"], status="EXPIRED") == 1
    assert count(metadata["statuses"], status="AVAILABLE") == 1
    assert CANARY not in json.dumps(after)
    assert "f"*64 not in json.dumps(after)
    assert "geo_browser_session_unhealthy 1" in render_metrics(after)
