"""0069 -> 0070 无回填迁移、旧草稿保持原样、元数据及不可丢失降级。"""

import importlib.util
import json
from contextlib import contextmanager
from uuid import uuid4

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from app.db import Base
from app.schemas.geo_answers import GeoRawPayloadSummary
from tests.integration.geo_plans_support import plans_api, questions_api
from tests.integration.test_geo_manual_collection import batch_run, evidence, save
from tests.integration.test_migrations import run_alembic, temporary_database

pytestmark = pytest.mark.integration


def test_upgrade_preserves_existing_answer_and_draft_without_inference(monkeypatch):
    with temporary_database("partsignal_man02_upgrade") as (url, env, directory):
        run_alembic(env, directory, "0069_geo_manual_cancellation")
        engine = create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1))
        try:
            with contextmanager(questions_api.__wrapped__)(engine) as sessions:
                api = plans_api.__wrapped__(sessions, monkeypatch)
                run, draft_run = batch_run(api, repeats=2)
                f, _ = evidence(api)
                saved = save(api, draft_run, {"answer_text": "旧草稿，不推断引用"})
                assert saved.status_code == 200, saved.text
                with engine.begin() as db:
                    db.execute(
                        text("""INSERT INTO geo_answer_snapshots
                        (id,run_id,prompt_text,answer_text,answer_format,
                        raw_payload_summary,screenshot_file_id,citation_count,collected_at)
                        VALUES (:id,:run,:prompt,'原始回答','TEXT',
                        CAST(:summary AS jsonb),:file,0,clock_timestamp())"""),
                        {
                            "id": uuid4(),
                            "summary": json.dumps(GeoRawPayloadSummary().model_dump()),
                            "run": run.id,
                            "prompt": run.input_snapshot["prompt"]["prompt_text"],
                            "file": f,
                        },
                    )
                    db.execute(
                        text("""UPDATE geo_observation_runs
                        SET status='COLLECTED',revision=revision+1,
                        started_at=a.collected_at,collected_at=a.collected_at
                        FROM geo_answer_snapshots a
                        WHERE geo_observation_runs.id=a.run_id AND a.run_id=:id"""),
                        {"id": run.id},
                    )
                    before = db.scalar(
                        text("SELECT to_jsonb(a) FROM geo_answer_snapshots a WHERE run_id=:id"),
                        {"id": run.id},
                    )
                    draft_before = db.scalar(
                        text("SELECT to_jsonb(d) FROM geo_manual_drafts d WHERE run_id=:id"),
                        {"id": draft_run.id},
                    )
                run_alembic(env, directory, "head")
                with engine.connect() as db:
                    after = db.scalar(
                        text("SELECT to_jsonb(a) FROM geo_answer_snapshots a WHERE run_id=:id"),
                        {"id": run.id},
                    )
                    assert after.pop("citation_observation") is None
                    assert after == before
                    assert (
                        db.scalar(
                            text("SELECT to_jsonb(d) FROM geo_manual_drafts d WHERE run_id=:id"),
                            {"id": draft_run.id},
                        )
                        == draft_before
                    )
                    assert "citation_observation" not in draft_before["draft"]
                    context = MigrationContext.configure(
                        db,
                        opts={
                            "compare_type": True,
                            "compare_server_default": True,
                            "include_object": lambda obj, name, kind, reflected, compared: (
                                obj.name == "geo_answer_snapshots"
                                if kind == "table"
                                else obj.table.name == "geo_answer_snapshots"
                            ),
                        },
                    )
                    assert compare_metadata(context, Base.metadata) == []
                    db.rollback()
                    path = directory / "alembic/versions/0070_geo_citation_observation.py"
                    spec = importlib.util.spec_from_file_location("man02_migration", path)
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)
                    with (
                        pytest.raises(DBAPIError) as caught,
                        db.begin(),
                        Operations.context(context),
                    ):
                        module.downgrade()
                    assert caught.value.orig.sqlstate == "55000"
                    assert (
                        db.scalar(text("SELECT version_num FROM alembic_version"))
                        == "0070_geo_citation_observation"
                    )
        finally:
            engine.dispose()
