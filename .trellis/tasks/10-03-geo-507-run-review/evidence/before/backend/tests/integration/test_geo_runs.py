"""新运行集合、输入、租约、错误与终态的数据库最终防线。"""

import hashlib
from copy import deepcopy
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from app.schemas.geo_runs import GeoObservationBatchOut, GeoObservationRunOut
from tests.integration.geo_runs_support import (
    BATCH,
    RUN,
    RunDatabase,
    batch,
    connection,
    plan_database,
    run,
    run_database,
    terminal,
    update,
)

pytestmark = pytest.mark.integration
__all__ = ["plan_database", "run_database", "connection"]


def rejected(conn: psycopg.Connection[Any], constraint: str, function: Any) -> None:
    with pytest.raises(psycopg.errors.CheckViolation) as caught, conn.transaction():
        function()
    assert caught.value.diag.constraint_name == constraint


def test_atomic_initial_count_and_no_empty_batches(
    connection: psycopg.Connection[Any], run_database: RunDatabase
) -> None:
    conn, db = connection, run_database
    identity = batch(conn, db)
    with pytest.raises(psycopg.errors.CheckViolation) as caught:
        conn.commit()
    assert caught.value.diag.constraint_name == "ck_geo_batches_run_count"
    assert conn.execute(f"SELECT count(*) FROM {BATCH} WHERE id=%s", (identity,)).fetchone()[0] == 0
    identity = batch(conn, db)
    run(conn, db, identity)
    conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
    rejected(conn, "ck_geo_batches_run_count", lambda: run(conn, db, identity, repeat_index=2))
    conn.execute(
        f"UPDATE {BATCH} SET status='QUEUED', revision=revision+1 WHERE id=%s", (identity,)
    )
    rejected(conn, "ck_geo_runs_initial_matrix", lambda: run(conn, db, identity, repeat_index=2))


def test_generated_cell_and_public_rows(
    connection: psycopg.Connection[Any], run_database: RunDatabase
) -> None:
    conn, db = connection, run_database
    identity = batch(conn, db)
    run_id = run(conn, db, identity)
    batch_row = conn.execute(
        f"SELECT to_jsonb(t) FROM {BATCH} t WHERE id=%s", (identity,)
    ).fetchone()[0]
    run_row = conn.execute(f"SELECT to_jsonb(t) FROM {RUN} t WHERE id=%s", (run_id,)).fetchone()[0]
    expected = hashlib.sha256(f"{db.plan.prompt}:{db.plan.profile}:1".encode()).hexdigest()
    assert run_row["run_cell_key"] == expected
    assert GeoObservationBatchOut.model_validate(batch_row).requested_run_count == 1
    run_row.pop("lease_token")
    # 0048 没有后续采集元数据列，历史事实按未知值投影到当前公共合同。
    run_row.update(provider_status=None, retry_after_seconds=None)
    assert GeoObservationRunOut.model_validate(run_row).cost_amount is None
    with pytest.raises(psycopg.errors.UniqueViolation) as caught, conn.transaction():
        run(conn, db, identity)
    assert caught.value.diag.constraint_name == "uq_geo_runs_cell_attempt"


@pytest.mark.parametrize("status", ["COMPLETED", "FAILED", "CANCELLED", "BUDGET_BLOCKED"])
def test_terminal_rows_are_frozen(
    connection: psycopg.Connection[Any], run_database: RunDatabase, status: str
) -> None:
    conn, db = connection, run_database
    identity = run(conn, db, batch(conn, db))
    terminal(conn, identity, status)
    conn.execute(f"UPDATE {RUN} SET revision=revision WHERE id=%s", (identity,))
    for fields in [
        {"status": "PENDING", "finished_at": None},
        {"dispatch_attempt_count": 1},
        {"error_summary": "替换"},
        {"cost_amount": 1, "cost_currency": "USD"},
    ]:
        rejected(
            conn, "ck_geo_runs_terminal", lambda fields=fields: update(conn, identity, **fields)
        )
    rejected(
        conn,
        "ck_geo_runs_immutable",
        lambda: conn.execute(f"DELETE FROM {RUN} WHERE id=%s", (identity,)),
    )


def test_attempt_is_append_only_same_cell_input_and_single_successor(
    connection: psycopg.Connection[Any], run_database: RunDatabase
) -> None:
    conn, db = connection, run_database
    parent_batch = batch(conn, db)
    parent = run(conn, db, parent_batch)
    terminal(conn, parent, "FAILED")
    changed = deepcopy(db.input)
    changed["prompt"]["prompt_text"] = "改变问题"
    for patch in [{"repeat_index": 2}, {"attempt_no": 3}, {"input_snapshot": Jsonb(changed)}]:
        rejected(
            conn,
            "ck_geo_runs_attempt_chain",
            lambda patch=patch: run(
                conn, db, parent_batch, **({"attempt_no": 2, "previous_attempt_id": parent} | patch)
            ),
        )
    other = batch(conn, db)
    rejected(
        conn,
        "ck_geo_runs_attempt_chain",
        lambda: run(conn, db, other, attempt_no=2, previous_attempt_id=parent),
    )
    run(conn, db, other)
    child = run(conn, db, parent_batch, attempt_no=2, previous_attempt_id=parent)
    with pytest.raises(psycopg.errors.UniqueViolation), conn.transaction():
        run(conn, db, parent_batch, attempt_no=2, previous_attempt_id=parent)
    terminal(conn, child, "FAILED", error_stage="ANALYSIS", error_code="ANALYSIS_FAILED")
    rejected(
        conn,
        "ck_geo_runs_attempt_chain",
        lambda: run(conn, db, parent_batch, attempt_no=3, previous_attempt_id=child),
    )
    conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
    assert (
        conn.execute(f"SELECT count(*) FROM {RUN} WHERE batch_id=%s", (parent_batch,)).fetchone()[0]
        == 2
    )
    assert (
        conn.execute(
            f"SELECT requested_run_count FROM {BATCH} WHERE id=%s", (parent_batch,)
        ).fetchone()[0]
        == 1
    )


def test_inputs_identity_revision_and_snapshot_closure(
    connection: psycopg.Connection[Any], run_database: RunDatabase
) -> None:
    conn, db = connection, run_database
    identity = batch(conn, db)
    run_id = run(conn, db, identity)
    rejected(
        conn,
        "ck_geo_runs_immutable",
        lambda: update(conn, run_id, input_snapshot=Jsonb(db.input | {"rule_set_revision": 2})),
    )
    rejected(
        conn,
        "ck_geo_batches_immutable",
        lambda: conn.execute(
            f"UPDATE {BATCH} SET requested_run_count=2,revision=revision+1 WHERE id=%s", (identity,)
        ),
    )
    rejected(
        conn,
        "ck_geo_runs_revision",
        lambda: conn.execute(f"UPDATE {RUN} SET dispatch_attempt_count=1 WHERE id=%s", (run_id,)),
    )
    for value in [
        db.input | {"schema_version": 2},
        db.input | {"api_key": "虚构值"},
        db.input | {"subjects": []},
        db.input | {"profile": db.input["profile"] | {"settings": {"headers": "虚构值"}}},
    ]:
        rejected(
            conn,
            "ck_geo_runs_input",
            lambda value=value: run(
                conn, db, identity, repeat_index=2, input_snapshot=Jsonb(value)
            ),
        )


@pytest.mark.parametrize(
    "patch,constraint",
    [
        ({"repeat_index": 0}, "ck_geo_runs_repeat"),
        ({"attempt_no": 0}, "ck_geo_runs_attempt"),
        ({"status": "INVALID"}, "ck_geo_runs_status"),
        ({"dispatch_attempt_count": -1}, "ck_geo_runs_dispatch"),
        ({"cost_amount": -1, "cost_currency": "USD"}, "ck_geo_runs_cost"),
        ({"cost_amount": "NaN", "cost_currency": "USD"}, "ck_geo_runs_cost"),
        ({"cost_amount": 1}, "ck_geo_runs_cost"),
        ({"duration_ms": -1}, "ck_geo_runs_duration"),
        ({"prompt_tokens": -1}, "ck_geo_runs_usage"),
        ({"lease_token": uuid4()}, "ck_geo_runs_lease"),
    ],
)
def test_check_constraints_reject_invalid_values(
    connection: psycopg.Connection[Any],
    run_database: RunDatabase,
    patch: dict[str, Any],
    constraint: str,
) -> None:
    conn, db = connection, run_database
    identity = run(conn, db, batch(conn, db))
    if {"repeat_index", "attempt_no"} & patch.keys():
        rejected(conn, constraint, lambda: run(conn, db, batch(conn, db), **patch))
    else:
        rejected(conn, constraint, lambda: update(conn, identity, **patch))


@pytest.mark.parametrize("missing", ["error_stage", "error_code", "error_summary"])
def test_failed_errors_cannot_use_sql_null_to_bypass_check(
    connection: psycopg.Connection[Any], run_database: RunDatabase, missing: str
) -> None:
    identity = run(connection, run_database, batch(connection, run_database))
    rejected(
        connection,
        "ck_geo_runs_error",
        lambda: terminal(connection, identity, "FAILED", **{missing: None}),
    )


def test_lease_external_dispatch_and_cost_lifecycle(
    connection: psycopg.Connection[Any], run_database: RunDatabase
) -> None:
    conn, db = connection, run_database
    identity = run(conn, db, batch(conn, db))
    now = conn.execute("SELECT now()").fetchone()[0]
    update(conn, identity, dispatch_attempt_count=1, last_dispatch_attempt_at=now)
    conn.execute(
        f"UPDATE {RUN} SET status='RUNNING',revision=revision+1,started_at=now(),"
        "lease_token=%s,lease_expires_at=now()+interval '1 minute',"
        "external_call_state='SENT' WHERE id=%s",
        (uuid4(), identity),
    )
    rejected(
        conn,
        "ck_geo_runs_external_progress",
        lambda: update(conn, identity, external_call_state="NOT_STARTED"),
    )
    update(
        conn,
        identity,
        status="COLLECTED",
        collected_at=now,
        lease_token=None,
        lease_expires_at=None,
        external_call_state="COMPLETED",
        cost_amount="0.100001",
        cost_currency="USD",
    )
    rejected(
        conn,
        "ck_geo_runs_external_progress",
        lambda: update(conn, identity, external_call_state="UNKNOWN"),
    )
    terminal(conn, identity, "COMPLETED", cost_amount="0.100001", cost_currency="USD")


def test_child_first_bulk_insert_cannot_bypass_attempt_predecessor(
    connection: psycopg.Connection[Any], run_database: RunDatabase
) -> None:
    conn, db = connection, run_database
    identity = batch(conn, db)
    child, parent = uuid4(), uuid4()
    rejected(
        conn,
        "ck_geo_runs_attempt_chain",
        lambda: conn.execute(
            f"INSERT INTO {RUN} (id,batch_id,prompt_variant_id,collection_profile_id,"
            "repeat_index,input_snapshot,attempt_no,previous_attempt_id) VALUES "
            "(%s,%s,%s,%s,1,%s,2,%s),(%s,%s,%s,%s,1,%s,1,NULL)",
            (
                child,
                identity,
                db.plan.prompt,
                db.plan.profile,
                Jsonb(db.input),
                parent,
                parent,
                identity,
                db.plan.prompt,
                db.plan.profile,
                Jsonb(db.input),
            ),
        ),
    )


@pytest.mark.parametrize("mode", ["MANUAL", "API", "BROWSER"])
def test_sql_snapshot_leaf_types_reject_hidden_secret_objects(
    connection: psycopg.Connection[Any], run_database: RunDatabase, mode: str
) -> None:
    from tests.unit.test_geo_run_contract import input_snapshot

    conn, db = connection, run_database
    value = input_snapshot(mode)
    if mode == "API":
        # 保留 0048 当时的封闭 settings 合同；0053 迁移单独验证新限速字段。
        value["profile"]["settings"].pop("max_concurrency")
        value["profile"]["settings"].pop("requests_per_minute")
    value["prompt"]["id"] = str(db.plan.prompt)
    value["profile"]["id"] = str(db.plan.profile)
    value["subjects"][0]["id"] = str(db.plan.subjects[0])
    identity = batch(conn, db)
    run(conn, db, identity, input_snapshot=Jsonb(value))
    secret = {"api_key": "虚构密钥", "Cookie": "虚构Cookie"}
    invalid = []
    for section, field in [
        ("prompt", "canonical_question"),
        ("profile", "login_state"),
        ("profile", "adapter_version"),
    ]:
        item = deepcopy(value)
        item[section][field] = secret
        invalid.append(item)
    item = deepcopy(value)
    item["profile"]["surface"]["id"] = secret
    invalid.append(item)
    item = deepcopy(value)
    item["subjects"][0]["aliases"] = [
        {"alias": secret, "normalized_alias": "虚构", "alias_kind": "NAME", "language_code": None}
    ]
    invalid.append(item)
    item = deepcopy(value)
    item["profile"].update(ai_channel_id=secret, ai_model_id=secret)
    invalid.append(item)
    item = deepcopy(value)
    item["profile"]["login_state"] = None
    invalid.append(item)
    for item in invalid:
        rejected(
            conn,
            "ck_geo_runs_input",
            lambda item=item: run(conn, db, identity, repeat_index=2, input_snapshot=Jsonb(item)),
        )


def test_sql_plan_snapshot_items_are_closed(
    connection: psycopg.Connection[Any], run_database: RunDatabase
) -> None:
    from tests.unit.test_geo_run_contract import plan_snapshot

    conn, db = connection, run_database
    value = plan_snapshot(db.input)
    for patch in [
        value | {"subjects": [value["subjects"][0] | {"cookie": "虚构值"}]},
        value | {"prompt_variant_ids": [{"api_key": "虚构值"}]},
        value | {"budget_limit": {"api_key": "虚构值"}},
    ]:
        rejected(
            conn,
            "ck_geo_batches_snapshots",
            lambda patch=patch: batch(conn, db, plan_snapshot=Jsonb(patch)),
        )
