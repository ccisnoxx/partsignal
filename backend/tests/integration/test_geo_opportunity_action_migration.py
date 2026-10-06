"""0060非空0059加法前滚；旧行动不补造来源，拒绝毁坏历史的降级。"""

import subprocess
import sys
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from app.schemas.geo_opportunities import GeoOpportunityTriggerSnapshot
from tests.integration.geo_answers_support import AnswerDatabase, new_run
from tests.integration.geo_runs_support import plan_database, run_database
from tests.integration.test_geo_catalog import insert_row
from tests.integration.test_geo_insight_indexes import history
from tests.integration.test_migrations import run_alembic
from tests.unit.test_geo_opportunity_policy import snapshot

pytestmark = pytest.mark.integration
__all__ = ["plan_database", "run_database"]


def test_nonempty_0059_forward_preserves_legacy_action_and_safe_stop(run_database):
    db = run_database
    run_alembic(db.plan.env, db.plan.backend_dir, "0059_geo_opportunities")
    identity, action_id = uuid4(), uuid4()
    with psycopg.connect(db.url) as conn:
        run_id = new_run(conn, AnswerDatabase(db, uuid4()))
        value = snapshot()
        value["scope"].update({k: None for k in value["scope"] if k != "environment_key"})
        value["sources"][0]["run_id"] = run_id
        trigger = GeoOpportunityTriggerSnapshot.model_validate(value).model_dump(mode="json")
        insert_row(
            conn,
            "geo_opportunities",
            {
                "id": identity,
                "identity_key": "a" * 64,
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
                "opportunity_id": identity,
                "run_id": run_id,
                "source_role": "TRIGGER",
            },
        )
        insert_row(
            conn,
            "geo_opportunity_actions",
            {
                "id": action_id,
                "opportunity_id": identity,
                "action_type": "OTHER",
                "target_type": "PublishedContentIssue",
                "target_id": uuid4(),
                "status_snapshot": "OPEN",
                "created_by": db.plan.actor,
            },
        )
        legacy = conn.execute(
            "SELECT to_jsonb(t) FROM geo_opportunity_actions t WHERE id=%s", (action_id,)
        ).fetchone()[0]
        before = history(conn)
    run_alembic(db.plan.env, db.plan.backend_dir, "0060_geo_opportunity_actions")
    with psycopg.connect(db.url) as conn:
        current = conn.execute(
            "SELECT to_jsonb(t) FROM geo_opportunity_actions t WHERE id=%s", (action_id,)
        ).fetchone()[0]
        extra = {
            "source_snapshot",
            "request_key_sha256",
            "request_sha256",
            "opportunity_revision_after",
        }
        assert {k: v for k, v in current.items() if k not in extra} == legacy
        assert all(current[k] is None for k in extra)
        assert history(conn) == before
        assert (
            conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0060_geo_opportunity_actions"
        )
        with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState), conn.transaction():
            conn.execute(
                "UPDATE geo_opportunity_actions SET status_snapshot='CHANGED' WHERE id=%s",
                (action_id,),
            )
    stopped = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0059_geo_opportunities"],
        cwd=db.plan.backend_dir,
        env=db.plan.env,
        capture_output=True,
        text=True,
    )
    assert stopped.returncode != 0 and "0060行动历史" in stopped.stderr
    with psycopg.connect(db.url) as conn:
        assert (
            conn.execute(
                "SELECT to_jsonb(t) FROM geo_opportunity_actions t WHERE id=%s", (action_id,)
            ).fetchone()[0]
            == current
        )
