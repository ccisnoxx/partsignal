"""GEO-902：加法前滚、原子累计与独立观测事务，不影响业务回滚。"""

from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.db import Base
from app.services.geo_ops_runtime import record_operation
from tests.integration.test_migrations import run_alembic, temporary_database

pytestmark = pytest.mark.integration


def test_additive_migration_and_concurrent_health_do_not_commit_business():
    with temporary_database("partsignal_geo902_health") as (url, env, backend_dir):
        run_alembic(env, backend_dir, "0064_geo_retention")
        with psycopg.connect(url) as connection:
            before = connection.execute("SELECT count(*) FROM geo_observation_runs").fetchone()
        run_alembic(env, backend_dir, "0065_geo_observability")
        engine = create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1))
        try:
            with engine.connect() as db:
                context = MigrationContext.configure(
                    db,
                    opts={
                        "compare_type": True,
                        "compare_server_default": True,
                        "include_object": lambda obj, name, kind, reflected, compared: (
                            obj.name == "geo_operation_health"
                            if kind == "table"
                            else obj.table.name == "geo_operation_health"
                        ),
                    },
                )
                assert compare_metadata(context, Base.metadata) == []
            with engine.begin() as db:
                assert db.scalar(text("SELECT count(*) FROM geo_observation_runs")) == before[0]
                assert db.scalar(text("SELECT count(*) FROM geo_operation_health")) == 0
                db.execute(text("CREATE TABLE geo902_transaction_probe (value integer)"))
            with Session(engine) as business:
                business.execute(text("INSERT INTO geo902_transaction_probe VALUES (1)"))
                assert record_operation("batch_build", succeeded=True, duration_ms=5, bind=engine)
                business.rollback()

            def record(index):
                return record_operation(
                    "collect_task", succeeded=index % 2 == 0, duration_ms=3, bind=engine
                )

            with ThreadPoolExecutor(max_workers=4) as pool:
                assert all(pool.map(record, range(12)))
            with engine.connect() as db:
                assert db.scalar(text("SELECT count(*) FROM geo902_transaction_probe")) == 0
                assert tuple(
                    db.execute(
                        text(
                            "SELECT success_count,failure_count,duration_ms,"
                            "duration_total_ms FROM geo_operation_health "
                            "WHERE operation='collect_task'"
                        )
                    ).one()
                ) == (6, 6, 3, 36)
                assert (
                    db.scalar(
                        text(
                            "SELECT success_count FROM geo_operation_health "
                            "WHERE operation='batch_build'"
                        )
                    )
                    == 1
                )
        finally:
            engine.dispose()
