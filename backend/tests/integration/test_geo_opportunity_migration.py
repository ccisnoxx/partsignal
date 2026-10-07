"""0059加法前滚保留非空历史；拒绝降级删除机会审计。"""

import subprocess
import sys
from uuid import uuid4

import psycopg
import pytest

from tests.integration.geo_answers_support import AnswerDatabase, new_run
from tests.integration.geo_runs_support import plan_database, run_database
from tests.integration.test_geo_insight_indexes import history
from tests.integration.test_migrations import run_alembic

pytestmark = pytest.mark.integration
__all__ = ["plan_database", "run_database"]


def test_nonempty_0058_forward_and_safe_downgrade_stop(run_database):
    db = run_database
    run_alembic(db.plan.env, db.plan.backend_dir, "0058_geo_rule_configuration")
    with psycopg.connect(db.url) as conn:
        new_run(conn, AnswerDatabase(db, uuid4()))
        before = history(conn)
        configuration = conn.execute("SELECT to_jsonb(t) FROM geo_rule_set_revisions t").fetchall()
    run_alembic(db.plan.env, db.plan.backend_dir, "0059_geo_opportunities")
    with psycopg.connect(db.url) as conn:
        assert history(conn) == before
        assert conn.execute("SELECT to_jsonb(t) FROM geo_rule_set_revisions t").fetchall() == (
            configuration
        )
        assert conn.execute("SELECT count(*) FROM geo_opportunities").fetchone()[0] == 0
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == (
            "0059_geo_opportunities"
        )
    stopped = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0058_geo_rule_configuration"],
        cwd=db.plan.backend_dir,
        env=db.plan.env,
        capture_output=True,
        text=True,
    )
    assert stopped.returncode != 0
    assert "0059" in stopped.stderr and "历史" in stopped.stderr
    with psycopg.connect(db.url) as conn:
        assert history(conn) == before
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == (
            "0059_geo_opportunities"
        )
