"""0068 ORM元数据、窗口不可变历史与安全降级。"""

import importlib.util
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db import Base
from tests.integration.geo_opportunity_schedule_support import (
    analysis_engine as analysis_engine,
)
from tests.integration.geo_opportunity_schedule_support import (
    answer_database as answer_database,
)
from tests.integration.geo_opportunity_schedule_support import (
    api as api,
)
from tests.integration.geo_opportunity_schedule_support import (
    harness as harness,
)
from tests.integration.geo_opportunity_schedule_support import (
    overview_api as overview_api,
)
from tests.integration.geo_opportunity_schedule_support import (
    plan_database as plan_database,
)
from tests.integration.geo_opportunity_schedule_support import (
    review_api as review_api,
)
from tests.integration.geo_opportunity_schedule_support import (
    run_database as run_database,
)

pytestmark = pytest.mark.integration


def test_additive_tables_match_metadata_and_downgrade_preserves_history(api):
    tables = {"geo_opportunity_schedule", "geo_opportunity_schedule_windows"}
    path = Path(__file__).resolve().parents[2] / "alembic/versions/0068_geo_opportunity_schedule.py"
    spec = importlib.util.spec_from_file_location("auto02_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with api.harness.factory.kw["bind"].connect() as conn:
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
        conn.rollback()
        with pytest.raises(DBAPIError) as caught, conn.begin(), Operations.context(context):
            module.downgrade()
        assert caught.value.orig.sqlstate == "55000"
        assert (
            conn.scalar(text("SELECT version_num FROM alembic_version"))
            == "0070_geo_citation_observation"
        )
