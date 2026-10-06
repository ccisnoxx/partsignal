"""0061真实PG：无损前滚、严格来源、提交时逐单元矩阵与不可变历史。"""

import subprocess
import sys
from copy import deepcopy
from uuid import UUID, uuid4

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from sqlalchemy import create_engine

from app.db import Base
from app.models.geo_retests import GeoRetestBaseline, GeoRetestRequest
from app.schemas.geo_opportunities import GeoOpportunityTriggerSnapshot
from app.schemas.geo_retests import GeoRetestBaselineSnapshot
from tests.integration.geo_answers_support import AnswerDatabase, collect, snapshot
from tests.integration.geo_runs_support import batch, plan_database, run, run_database, terminal
from tests.integration.test_geo_catalog import insert_row
from tests.integration.test_geo_insight_indexes import history
from tests.integration.test_migrations import run_alembic, temporary_database
from tests.unit.test_geo_opportunity_policy import snapshot as trigger_snapshot
from tests.unit.test_geo_run_contract import plan_snapshot

pytestmark = pytest.mark.integration
__all__ = ["plan_database", "run_database"]


def source(conn, db, role="TRIGGER"):
    """两根单元且第一根有真实重试，版本必须取各cell的最新attempt。"""
    plan = plan_snapshot(db.input)
    plan["repeat_count"] = 2
    batch_id = batch(conn, db, requested_run_count=2, plan_snapshot=Jsonb(plan))
    insert_row(
        conn,
        "geo_batch_subjects",
        {
            "batch_id": batch_id,
            "subject_id": db.plan.subjects[0],
            "role": "PRIMARY",
        },
    )
    roots = [run(conn, db, batch_id, repeat_index=i) for i in (1, 2)]
    terminal(conn, roots[0], "FAILED")
    retry = run(conn, db, batch_id, attempt_no=2, previous_attempt_id=roots[0])
    for index, identity in enumerate((retry, roots[1]), start=1):
        snapshot(
            conn,
            AnswerDatabase(db, uuid4()),
            identity,
            source_product="虚构产品",
            source_model="虚构模型",
            source_version=f"v{index}",
        )
        collect(conn, identity)
    conn.execute(
        "UPDATE geo_observation_batches SET status='PARTIAL',finished_at=now(),"
        "revision=revision+1 WHERE id=%s",
        (batch_id,),
    )
    value = trigger_snapshot()
    value["scope"].update({k: None for k in value["scope"] if k != "environment_key"})
    value["sources"][0]["run_id"] = retry
    value["sources"][0]["source_role"] = role
    trigger = GeoOpportunityTriggerSnapshot.model_validate(value).model_dump(mode="json")
    opportunity = uuid4()
    insert_row(
        conn,
        "geo_opportunities",
        {
            "id": opportunity,
            "identity_key": uuid4().hex * 2,
            "rule_code": trigger["rule_code"],
            "priority": trigger["priority"],
            "trigger_snapshot": Jsonb(trigger),
            "source_date_from": trigger["source_date_from"],
            "source_date_to": trigger["source_date_to"],
        },
    )
    insert_row(
        conn,
        "geo_opportunity_sources",
        {
            "id": uuid4(),
            "opportunity_id": opportunity,
            "run_id": retry,
            "source_role": role,
        },
    )
    conn.execute(
        "UPDATE geo_opportunities SET status='ACKNOWLEDGED',revision=revision+1,"
        "acknowledged_at=now(),acknowledged_by=%s WHERE id=%s",
        (db.plan.actor, opportunity),
    )
    conn.execute(
        "UPDATE geo_opportunities SET status='IN_PROGRESS',revision=revision+1 WHERE id=%s",
        (opportunity,),
    )
    cells = []
    for root, latest in zip(roots, (retry, roots[1]), strict=True):
        answer = conn.execute(
            "SELECT id,source_product,source_model,source_version "
            "FROM geo_answer_snapshots WHERE run_id=%s",
            (latest,),
        ).fetchone()
        cells.append(
            dict(
                root_run_id=root,
                repeat_index=len(cells) + 1,
                input_snapshot=db.input,
                answer_snapshot_id=answer[0],
                source_product=answer[1],
                source_model=answer[2],
                source_version=answer[3],
            )
        )
    saved = GeoRetestBaselineSnapshot.model_validate(
        dict(
            schema_version=1,
            opportunity_id=opportunity,
            baseline_batch_id=batch_id,
            trigger_snapshot=trigger,
            plan_snapshot=plan,
            rule_snapshot={"schema_version": 1, "rule_set_revision": 1},
            cells=cells,
        )
    ).model_dump(mode="json")
    return saved


def baseline(conn, db, saved):
    identity = uuid4()
    insert_row(
        conn,
        "geo_retest_baselines",
        {
            "id": identity,
            "opportunity_id": UUID(saved["opportunity_id"]),
            "baseline_batch_id": UUID(saved["baseline_batch_id"]),
            "created_by": db.plan.actor,
            "snapshot": Jsonb(saved),
        },
    )
    return identity


def retest(conn, db, saved, baseline_id, *, change=None, receipt=True, receipt_first=False):
    plan, rule = deepcopy(saved["plan_snapshot"]), deepcopy(saved["rule_snapshot"])
    cells = deepcopy(saved["cells"])
    if change == "plan":
        plan["name"] = "替换计划快照"
    elif change == "rule":
        plan["rule_set_revision"] = rule["rule_set_revision"] = 2
    elif change == "input":
        cells[1]["input_snapshot"]["prompt"]["prompt_text"] = "替换问题但保留采样数"
    elif change == "repeat":
        cells[1]["repeat_index"] = 3
    elif change == "count":
        cells = cells[:1]
    identity = batch(
        conn,
        db,
        trigger_type="RETEST",
        plan_snapshot=Jsonb(plan),
        rule_snapshot=Jsonb(rule),
        requested_run_count=len(cells),
        source_opportunity_id=UUID(saved["opportunity_id"]),
        baseline_batch_id=UUID(saved["baseline_batch_id"]),
    )
    insert_row(
        conn,
        "geo_batch_subjects",
        {
            "batch_id": identity,
            "subject_id": db.plan.subjects[0],
            "role": "PRIMARY",
        },
    )

    def insert_receipt():
        revision = conn.execute(
            "UPDATE geo_opportunities SET revision=revision+1 WHERE id=%s RETURNING revision",
            (saved["opportunity_id"],),
        ).fetchone()[0]
        insert_row(
            conn,
            "geo_retest_requests",
            {
                "id": uuid4(),
                "baseline_id": baseline_id,
                "batch_id": identity,
                "created_by": db.plan.actor,
                "request_key_sha256": uuid4().hex * 2,
                "request_sha256": uuid4().hex * 2,
                "opportunity_revision_after": revision,
            },
        )

    if receipt and receipt_first:
        insert_receipt()
    for cell in cells:
        run(
            conn,
            db,
            identity,
            repeat_index=cell["repeat_index"],
            input_snapshot=Jsonb(cell["input_snapshot"]),
        )
    if receipt and not receipt_first:
        insert_receipt()
    return identity


def test_nonempty_0060_forward_matches_metadata_preserves_history_and_safe_downgrade(run_database):
    db = run_database
    run_alembic(db.plan.env, db.plan.backend_dir, "0060_geo_opportunity_actions")
    with psycopg.connect(db.url) as conn:
        saved = source(conn, db)
        insert_row(
            conn,
            "geo_opportunity_actions",
            {
                "id": uuid4(),
                "opportunity_id": UUID(saved["opportunity_id"]),
                "action_type": "OTHER",
                "target_type": "Product",
                "target_id": uuid4(),
                "status_snapshot": "ACTIVE",
                "created_by": db.plan.actor,
            },
        )
        before = history(conn)
        opportunity_before = conn.execute("SELECT to_jsonb(t) FROM geo_opportunities t").fetchall()
        action_before = conn.execute("SELECT to_jsonb(t) FROM geo_opportunity_actions t").fetchall()
    run_alembic(db.plan.env, db.plan.backend_dir, "0061_geo_retests")
    with psycopg.connect(db.url) as conn:
        assert history(conn) == before
        assert conn.execute("SELECT to_jsonb(t) FROM geo_opportunities t").fetchall() == (
            opportunity_before
        )
        assert conn.execute("SELECT to_jsonb(t) FROM geo_opportunity_actions t").fetchall() == (
            action_before
        )
        assert conn.execute("SELECT count(*) FROM geo_retest_baselines").fetchone() == (0,)
        assert conn.execute("SELECT count(*) FROM geo_retest_requests").fetchone() == (0,)
        baseline_id = baseline(conn, db, saved)
        batch_id = retest(conn, db, saved, baseline_id, receipt_first=True)
    tables = {GeoRetestBaseline.__tablename__, GeoRetestRequest.__tablename__}
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://", 1))
    try:
        with engine.connect() as conn:
            context = MigrationContext.configure(
                conn,
                opts={
                    "compare_type": True,
                    "compare_server_default": True,
                    "include_object": lambda obj, name, kind, reflected, compared: (
                        obj.name in tables if kind == "table" else obj.table.name in tables
                    ),
                },
            )
            assert compare_metadata(context, Base.metadata) == []
    finally:
        engine.dispose()
    stopped = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0060_geo_opportunity_actions"],
        cwd=db.plan.backend_dir,
        env=db.plan.env,
        capture_output=True,
        text=True,
    )
    assert stopped.returncode != 0 and "0061复测历史" in stopped.stderr
    with psycopg.connect(db.url) as conn:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0061_geo_retests",
        )
        assert conn.execute(
            "SELECT id FROM geo_retest_baselines WHERE id=%s", (baseline_id,)
        ).fetchone() == (baseline_id,)
        assert conn.execute(
            "SELECT batch_id FROM geo_retest_requests WHERE batch_id=%s", (batch_id,)
        ).fetchone() == (batch_id,)


@pytest.mark.parametrize(
    "change,constraint",
    [
        ("trigger", "ck_geo_retest_baseline_source"),
        ("duplicate", "ck_geo_retest_baseline_source"),
        ("missing", "ck_geo_retest_baseline_source"),
        ("input", "ck_geo_retest_baseline_cell"),
        ("version", "ck_geo_retest_baseline_answer"),
        ("answer", "ck_geo_retest_baseline_answer"),
        ("unknown_key", "ck_geo_retest_baseline_source"),
        ("BASELINE", "ck_geo_retest_baseline_source"),
        ("RETEST", "ck_geo_retest_baseline_source"),
        ("later_source", "ck_geo_retest_baseline_source"),
    ],
)
def test_baseline_rejects_changed_source_matrix_and_forged_latest_answer(
    run_database, change, constraint
):
    db = run_database
    with psycopg.connect(db.url) as conn:
        saved = source(conn, db, role=change if change in ("BASELINE", "RETEST") else "TRIGGER")
        if change == "trigger":
            saved["trigger_snapshot"]["value"] = 0.7
        elif change == "duplicate":
            saved["cells"][1] = deepcopy(saved["cells"][0])
        elif change == "missing":
            saved["cells"] = saved["cells"][:1]
        elif change == "input":
            saved["cells"][0]["input_snapshot"]["prompt"]["prompt_text"] = "替换根问题"
        elif change == "version":
            saved["cells"][0]["source_version"] = "伪造版本"
        elif change == "answer":
            saved["cells"][0]["answer_snapshot_id"] = saved["cells"][1]["answer_snapshot_id"]
        elif change == "unknown_key":
            saved["cells"][0]["credentials"] = {"secret": "禁止隐藏输入"}
        elif change == "later_source":
            later = source(conn, db)
            insert_row(
                conn,
                "geo_opportunity_sources",
                {
                    "id": uuid4(),
                    "opportunity_id": UUID(saved["opportunity_id"]),
                    "run_id": UUID(later["trigger_snapshot"]["sources"][0]["run_id"]),
                    "source_role": "SUPPORTING",
                },
            )
            later.update(
                opportunity_id=saved["opportunity_id"], trigger_snapshot=saved["trigger_snapshot"]
            )
            saved = later
        with pytest.raises(psycopg.errors.CheckViolation) as error, conn.transaction():
            baseline(conn, db, saved)
        assert error.value.diag.constraint_name == constraint


@pytest.mark.parametrize("change", ["plan", "rule", "input", "repeat", "count", None])
def test_deferred_guard_rejects_equal_count_substitution_and_missing_receipt(run_database, change):
    db = run_database
    with psycopg.connect(db.url) as conn:
        saved = source(conn, db)
        baseline_id = baseline(conn, db, saved)
        with pytest.raises(psycopg.errors.CheckViolation) as error, conn.transaction():
            retest(
                conn,
                db,
                saved,
                baseline_id,
                change=change,
                receipt=change is not None,
                receipt_first=True,
            )
            conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
        assert error.value.diag.constraint_name == "ck_geo_retest_matrix"
        assert conn.execute(
            "SELECT count(*) FROM geo_observation_batches WHERE source_opportunity_id=%s",
            (saved["opportunity_id"],),
        ).fetchone() == (0,)


@pytest.mark.parametrize("change", ["revision", "actor", "state"])
def test_request_insert_requires_current_locked_revision_state_and_batch_actor(
    run_database, change
):
    db = run_database
    with psycopg.connect(db.url) as conn:
        saved = source(conn, db)
        baseline_id = baseline(conn, db, saved)
        with pytest.raises(psycopg.errors.CheckViolation) as error, conn.transaction():
            identity = retest(conn, db, saved, baseline_id, receipt=False)
            if change == "state":
                conn.execute(
                    "UPDATE geo_opportunities SET status='DISMISSED',revision=revision+1,"
                    "resolved_at=now(),resolved_by=%s,resolution_code='OTHER',"
                    "resolution_comment='测试状态门禁' WHERE id=%s",
                    (db.plan.actor, saved["opportunity_id"]),
                )
            insert_row(
                conn,
                "geo_retest_requests",
                {
                    "id": uuid4(),
                    "baseline_id": baseline_id,
                    "batch_id": identity,
                    "created_by": uuid4() if change == "actor" else db.plan.actor,
                    "request_key_sha256": uuid4().hex * 2,
                    "request_sha256": uuid4().hex * 2,
                    "opportunity_revision_after": 3 if change == "actor" else 4,
                },
            )
        assert error.value.diag.constraint_name == "ck_geo_retest_request_identity"


def test_receipt_immutability_and_late_root_append_are_guarded(run_database):
    db = run_database
    with psycopg.connect(db.url) as conn:
        saved = source(conn, db)
        baseline_id = baseline(conn, db, saved)
        identity = retest(conn, db, saved, baseline_id)
    with psycopg.connect(db.url) as conn:
        for table in ("geo_retest_baselines", "geo_retest_requests"):
            for command in (
                sql.SQL("UPDATE {} SET created_at=created_at").format(sql.Identifier(table)),
                sql.SQL("DELETE FROM {}").format(sql.Identifier(table)),
                sql.SQL("TRUNCATE {} CASCADE").format(sql.Identifier(table)),
            ):
                with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState), conn.transaction():
                    conn.execute(command)
        with pytest.raises(psycopg.errors.CheckViolation) as error, conn.transaction():
            run(conn, db, identity, repeat_index=3)
            # 只设置0061触发器立即检查，以证明root守卫本身覆盖receipt后追加。
            conn.execute("SET CONSTRAINTS geo_retest_root_complete IMMEDIATE")
        assert error.value.diag.constraint_name == "ck_geo_retest_matrix"
        assert conn.execute(
            "SELECT count(*) FROM geo_observation_runs WHERE batch_id=%s AND attempt_no=1",
            (identity,),
        ).fetchone() == (2,)


def test_0061_precheck_stops_legacy_retest_without_fabricating_receipt(run_database):
    db = run_database
    resources = {}
    with psycopg.connect(db.url, row_factory=dict_row) as conn:
        for table in (
            "users",
            "products",
            "query_topics",
            "geo_subjects",
            "geo_prompt_variants",
            "geo_engine_surfaces",
            "geo_collection_profiles",
        ):
            resources[table] = conn.execute(
                sql.SQL("SELECT * FROM {}").format(sql.Identifier(table))
            ).fetchall()
    with temporary_database("partsignal_geo705_stop") as (url, env, backend_dir):
        run_alembic(env, backend_dir, "0060_geo_opportunity_actions")
        with psycopg.connect(url) as conn:
            for table, rows in resources.items():
                for row in rows:
                    insert_row(
                        conn,
                        table,
                        {
                            key: Jsonb(value) if isinstance(value, dict) else value
                            for key, value in row.items()
                            if key != "normalized_hash"
                        },
                    )
            saved = source(conn, db)
            legacy = retest(conn, db, saved, None, receipt=False)
            before = history(conn)
        stopped = run_alembic(env, backend_dir, "0061_geo_retests", check=False)
        assert stopped.returncode != 0 and "历史RETEST" in stopped.stdout + stopped.stderr
        with psycopg.connect(url) as conn:
            assert history(conn) == before
            assert conn.execute("SELECT version_num FROM alembic_version").fetchone() == (
                "0060_geo_opportunity_actions",
            )
            assert conn.execute("SELECT to_regclass('geo_retest_requests')").fetchone() == (None,)
            assert conn.execute(
                "SELECT id FROM geo_observation_batches WHERE id=%s", (legacy,)
            ).fetchone() == (legacy,)
