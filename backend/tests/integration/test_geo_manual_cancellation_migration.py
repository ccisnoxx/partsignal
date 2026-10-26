"""0069新表元数据和不可破坏性降级。"""

import importlib.util
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db import Base
from tests.integration.geo_plans_support import (
    plans_api as plans_api,
)
from tests.integration.geo_plans_support import (
    questions_api as questions_api,
)
from tests.integration.geo_plans_support import (
    questions_engine as questions_engine,
)

pytestmark = pytest.mark.integration


def test_metadata_and_unsafe_downgrade(plans_api):
    table = "geo_manual_run_cancellations"
    path = Path(__file__).resolve().parents[2] / "alembic/versions/0069_geo_manual_cancellation.py"
    spec = importlib.util.spec_from_file_location("man01_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with plans_api.api.engine.connect() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "compare_type": True,
                "compare_server_default": True,
                "include_object": lambda obj, name, kind, reflected, compared: (
                    obj.name == table if kind == "table" else obj.table.name == table
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
