"""GEO-1006 PostgreSQL 回执 schema、数据库仲裁和不可变历史守卫。"""

import subprocess
import sys
from uuid import UUID, uuid4

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import insert, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.db import Base
from app.models.geo_opportunity_evaluation import GeoOpportunityEvaluationRun
from tests.integration.test_geo_manual_opportunity_evaluation import (
    analysis_engine,
    answer_database,
    api,
    harness,
    overview_api,
    payload,
    plan_database,
    post,
    review_api,
    run_database,
)

pytestmark = pytest.mark.integration
__all__ = [
    "analysis_engine",
    "answer_database",
    "api",
    "harness",
    "overview_api",
    "plan_database",
    "review_api",
    "run_database",
]


def test_receipt_migration_metadata_database_uniqueness_and_immutable_history(api):
    receipt = post(api, payload(api)).json()
    with api.harness.factory() as db:
        record = db.get(GeoOpportunityEvaluationRun, UUID(receipt["evaluation_run_id"]))
        values = {c.name: getattr(record, c.name) for c in record.__table__.columns}
        values["id"] = uuid4()
        with pytest.raises(IntegrityError) as failure:
            db.execute(insert(GeoOpportunityEvaluationRun).values(**values))
        assert failure.value.orig.sqlstate == "23505"
        assert failure.value.orig.diag.constraint_name == "uq_geo_evaluation_run_key"
        db.rollback()
        for sql in (
            "UPDATE geo_opportunity_evaluation_runs SET receipt='{}'",
            "DELETE FROM geo_opportunity_evaluation_runs",
            "TRUNCATE geo_opportunity_evaluation_runs",
        ):
            with pytest.raises(DBAPIError) as immutable:
                db.execute(text(sql))
            assert immutable.value.orig.sqlstate == "55000"
            db.rollback()
    with api.harness.factory.kw["bind"].connect() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "compare_type": True,
                "compare_server_default": True,
                "include_object": lambda obj, name, kind, reflected, compared: (
                    obj.name == "geo_opportunity_evaluation_runs"
                    if kind == "table"
                    else obj.table.name == "geo_opportunity_evaluation_runs"
                ),
            },
        )
        assert compare_metadata(context, Base.metadata) == []
    database = api.harness.database.runs.plan
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0065_geo_observability"],
        cwd=database.backend_dir,
        env=database.env,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0 and "0066 管理员评估回执须保留" in result.stderr
    assert post(api, payload(api)).status_code == 200
