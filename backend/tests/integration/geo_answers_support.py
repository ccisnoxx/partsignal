"""0050 证据测试的真实 PostgreSQL、前滚和最小数据。"""

import hashlib
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from app.schemas.geo_answers import GeoRawPayloadSummary
from tests.integration.geo_runs_support import RunDatabase, batch, plan_database, run, run_database
from tests.integration.test_geo_catalog import insert_row
from tests.integration.test_migrations import run_alembic

__all__ = ["run_database", "plan_database", "answer_database", "answer_connection"]


@dataclass
class AnswerDatabase:
    runs: RunDatabase
    legacy_run: UUID

    @property
    def url(self) -> str:
        return self.runs.url


@pytest.fixture(scope="module")
def answer_database(run_database: RunDatabase) -> Iterator[AnswerDatabase]:
    db = run_database
    with psycopg.connect(db.url) as conn:
        legacy = run(conn, db, batch(conn, db))
    run_alembic(db.plan.env, db.plan.backend_dir, "0049_geo_batch_creation")
    run_alembic(db.plan.env, db.plan.backend_dir, "head")
    yield AnswerDatabase(db, legacy)


@pytest.fixture
def answer_connection(answer_database: AnswerDatabase) -> Iterator[psycopg.Connection[Any]]:
    with psycopg.connect(answer_database.url) as conn:
        yield conn
        conn.rollback()


def new_run(conn: psycopg.Connection[Any], db: AnswerDatabase) -> UUID:
    root = batch(conn, db.runs)
    insert_row(
        conn,
        "geo_batch_subjects",
        {"batch_id": root, "subject_id": db.runs.plan.subjects[0], "role": "PRIMARY"},
    )
    return run(conn, db.runs, root)


def snapshot(conn: psycopg.Connection[Any], db: AnswerDatabase, run_id: UUID, **patch: Any) -> UUID:
    value = {
        "id": uuid4(),
        "run_id": run_id,
        "prompt_text": db.runs.input["prompt"]["prompt_text"],
        "answer_text": "  原始回答\r\nA-1\n",
        "answer_format": "TEXT",
        "citation_count": 0,
        "raw_payload_summary": Jsonb(GeoRawPayloadSummary().model_dump()),
        "collected_at": conn.execute("SELECT now()").fetchone()[0],
        **patch,
    }
    insert_row(conn, "geo_answer_snapshots", value)
    return value["id"]


def collect(conn: psycopg.Connection[Any], run_id: UUID) -> None:
    conn.execute(
        "UPDATE geo_observation_runs SET status='COLLECTED', started_at=now(), "
        "collected_at=now(), revision=revision+1 WHERE id=%s",
        (run_id,),
    )


def citation(conn: psycopg.Connection[Any], answer: UUID, **patch: Any) -> UUID:
    value = {
        "id": uuid4(),
        "answer_snapshot_id": answer,
        "position": 1,
        "occurrences": [1],
        "original_url": "HTTPS://Example.com:443/a#section",
        "normalized_url": "https://example.com/a",
        "hostname": "example.com",
        "extraction_source": "MANUAL",
        **patch,
    }
    insert_row(conn, "geo_answer_citations", value)
    return value["id"]


def file_record(conn: psycopg.Connection[Any], db: AnswerDatabase, **patch: Any) -> UUID:
    now = conn.execute("SELECT now()").fetchone()[0]
    identity = uuid4()
    insert_row(
        conn,
        "file_records",
        {
            "id": identity,
            "category": "OPERATION_SCREENSHOT",
            "original_filename": "fixture.png",
            "object_key": f"geo304/{identity}.png",
            "content_type": "image/png",
            "size": 7,
            "sha256": hashlib.sha256(b"fixture").hexdigest(),
            "access_level": "INTERNAL",
            "status": "VERIFIED",
            "uploader_id": db.runs.plan.actor,
            "upload_expires_at": now + timedelta(hours=1),
            "verified_at": now,
            "cleanup_after": now,
            **patch,
        },
    )
    return identity
