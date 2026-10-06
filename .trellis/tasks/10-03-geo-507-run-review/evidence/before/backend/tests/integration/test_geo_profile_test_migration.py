"""0052 失效旧 API 资格，保持旧配置与业务历史，ORM 和新增列一致。"""

from datetime import UTC, datetime

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from app.db import Base
from tests.integration.test_geo_surfaces_profiles import (
    insert_profile,
    insert_surface,
    prepared_surface_database,
    snapshot,
)
from tests.integration.test_migrations import run_alembic

pytestmark = pytest.mark.integration


def test_0052_forward_invalidates_only_current_api_qualification():
    with prepared_surface_database("0051_geo_manual_collection") as db:
        with psycopg.connect(db.url) as conn:
            surface = insert_surface(conn, db)
            tested = insert_profile(
                conn,
                db,
                surface,
                "API",
                name="旧测试配置",
                ai_channel_id=db.channel,
                ai_model_id=db.model,
                is_active=True,
                last_test_status="PASSED",
                last_tested_at=datetime.now(UTC),
            )
            manual = insert_profile(conn, db, surface, "MANUAL", name="旧人工配置")
            before = snapshot(conn)
            manual_before = conn.execute(
                "SELECT to_jsonb(p) FROM geo_collection_profiles p WHERE id=%s", (manual,)
            ).fetchone()[0]
        run_alembic(db.env, db.backend_dir, "head")
        with psycopg.connect(db.url) as conn:
            assert snapshot(conn) == before
            current = conn.execute(
                "SELECT last_test_status,last_tested_at,is_active,revision,"
                "last_test_error_code,last_test_error_summary,test_attempt_id "
                "FROM geo_collection_profiles WHERE id=%s",
                (tested,),
            ).fetchone()
            assert current == ("UNTESTED", None, False, 1, None, None, None)
            manual_after = conn.execute(
                "SELECT to_jsonb(p)-ARRAY['last_test_error_code',"
                "'last_test_error_summary','test_attempt_id'] FROM geo_collection_profiles p "
                "WHERE id=%s",
                (manual,),
            ).fetchone()[0]
            assert manual_after == manual_before
        engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://"))
        try:
            with engine.connect() as conn:
                context = MigrationContext.configure(
                    conn,
                    opts={
                        "compare_type": True,
                        "compare_server_default": True,
                        "include_object": lambda obj, name, kind, reflected, compared: (
                            obj.name == "geo_collection_profiles"
                            if kind == "table"
                            else obj.table.name == "geo_collection_profiles"
                        ),
                    },
                )
                assert compare_metadata(context, Base.metadata) == []
        finally:
            engine.dispose()
