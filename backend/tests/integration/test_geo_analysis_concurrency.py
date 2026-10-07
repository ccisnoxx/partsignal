"""两个真实PG连接证明旧快照不能分配revision或发布/复核过期分析。"""

import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import psycopg
import pytest

from tests.integration.geo_analysis_support import collected_case, finish, pending, publish, review
from tests.integration.geo_answers_support import answer_database, plan_database, run_database

pytestmark = pytest.mark.integration
__all__ = ["answer_database", "plan_database", "run_database"]


def test_two_allocations_serialize_same_run(answer_database):
    db = answer_database
    with psycopg.connect(db.url) as conn:
        case = collected_case(conn, db)
    ready = Event()
    with psycopg.connect(db.url) as first, psycopg.connect(db.url) as second:
        second.execute("SET lock_timeout='3s'")
        second.commit()
        pid = second.info.backend_pid
        pending(first, case, revision=1)

        def allocate():
            ready.set()
            try:
                pending(second, case, revision=1)
                second.commit()
                return "unexpected-success"
            except psycopg.errors.CheckViolation as error:
                second.rollback()
                return error.diag.constraint_name

        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(allocate)
            assert ready.wait(2)
            deadline = time.monotonic() + 2
            with psycopg.connect(db.url, autocommit=True) as observer:
                while time.monotonic() < deadline:
                    state = observer.execute(
                        "SELECT wait_event_type FROM pg_stat_activity WHERE pid=%s", (pid,)
                    ).fetchone()
                    if state and state[0] == "Lock":
                        break
                    time.sleep(0.01)
                else:
                    pytest.fail("第二个revision装配未进入预期行锁等待")
            first.commit()
            assert future.result(timeout=4) == "ck_geo_analysis_revision_sequence"
        assert (
            second.execute(
                "SELECT count(*) FROM geo_analysis_revisions WHERE run_id=%s", (case.run_id,)
            ).fetchone()[0]
            == 1
        )


@pytest.mark.parametrize("action", ["review", "publish", "allocate"])
def test_repeatable_read_old_snapshot_fails_explicitly(answer_database, action):
    db = answer_database
    with psycopg.connect(db.url) as conn:
        case = collected_case(conn, db)
        old = pending(conn, case)
        finish(conn, old)
        publish(conn, case, old)
        new = pending(conn, case, analyzer_version="fixture-v2")
        finish(conn, new)
    with psycopg.connect(db.url) as stale, psycopg.connect(db.url) as current:
        stale.execute("BEGIN ISOLATION LEVEL REPEATABLE READ")
        assert (
            stale.execute(
                "SELECT current_analysis_revision_id FROM geo_observation_runs WHERE id=%s",
                (case.run_id,),
            ).fetchone()[0]
            == old
        )
        publish(current, case, new)
        current.commit()
        with pytest.raises(psycopg.errors.SerializationFailure):
            if action == "review":
                review(stale, case, old, db.runs.plan.actor)
            elif action == "publish":
                publish(stale, case, old)
            else:
                pending(stale, case, analyzer_version="fixture-v3")
        stale.rollback()
        assert (
            current.execute(
                "SELECT current_analysis_revision_id FROM geo_observation_runs WHERE id=%s",
                (case.run_id,),
            ).fetchone()[0]
            == new
        )


def test_fact_qualification_uses_frozen_transaction_snapshot(answer_database):
    from copy import deepcopy
    from uuid import UUID, uuid4

    from tests.integration.test_geo_catalog import insert_row

    db = answer_database
    with psycopg.connect(db.url) as conn:
        case = collected_case(conn, db, products=1)
        conn.execute(
            "UPDATE fact_versions SET status='RETIRED',revision=revision+1 WHERE id=%s",
            (case.facts[0],),
        )
        product = UUID(case.input["subjects"][1]["product_id"])
        fact = uuid4()
        insert_row(
            conn,
            "fact_versions",
            {
                "id": fact,
                "product_id": product,
                "version": 2,
                "status": "PENDING_REVIEW",
                "classification": "PUBLIC",
                "body_markdown": "虚构新事实",
                "change_summary": "等待批准",
                "revision": 0,
                "created_by": db.runs.plan.actor,
            },
        )
    frozen = deepcopy(case.input)
    frozen["fact_versions"] = []
    with psycopg.connect(db.url) as historical, psycopg.connect(db.url) as current:
        historical.execute("BEGIN ISOLATION LEVEL REPEATABLE READ")
        assert (
            historical.execute("SELECT status FROM fact_versions WHERE id=%s", (fact,)).fetchone()[
                0
            ]
            == "PENDING_REVIEW"
        )
        current.execute(
            "UPDATE fact_versions SET "
            "status='APPROVED',revision=revision+1,approved_by=%s,approved_at=clock_timestamp()"
            " WHERE id=%s",
            (db.runs.plan.actor, fact),
        )
        current.commit()
        analysis = pending(historical, case, input_snapshot=psycopg.types.json.Jsonb(frozen))
        finish(historical, analysis)
        historical.commit()
        assert (
            current.execute(
                "SELECT input_snapshot->'fact_versions' FROM geo_analysis_revisions WHERE id=%s",
                (analysis,),
            ).fetchone()[0]
            == []
        )
        with pytest.raises(psycopg.errors.CheckViolation) as error, current.transaction():
            pending(
                current,
                case,
                input_snapshot=psycopg.types.json.Jsonb(frozen),
                analyzer_version="fixture-v2",
            )
        assert error.value.diag.constraint_name == "ck_geo_analysis_fact_required"
