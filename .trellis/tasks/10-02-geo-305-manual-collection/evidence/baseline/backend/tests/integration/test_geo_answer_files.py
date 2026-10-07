"""真实对象 HEAD、文件资格和清理/提交交错。"""

import hashlib
import os
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import AppError
from app.services.file_records import _claim_file_cleanup, file_is_referenced
from app.services.geo_answer_files import lock_answer_evidence_files
from app.services.storage import DevelopmentEvidenceStorage
from tests.integration.geo_answers_support import (
    AnswerDatabase,
    answer_connection,
    answer_database,
    collect,
    file_record,
    new_run,
    plan_database,
    run_database,
    snapshot,
)

pytestmark = pytest.mark.integration
__all__ = ["answer_connection", "answer_database", "plan_database", "run_database"]


@pytest.fixture
def engine(answer_database: AnswerDatabase):
    value = create_engine(answer_database.url.replace("postgresql://", "postgresql+psycopg://"))
    yield value
    value.dispose()


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch):
    # Compose 内使用既有 fake-oss；宿主定向测试通过显式测试端口。
    monkeypatch.setattr(
        settings,
        "development_storage_internal_url",
        os.environ.get("GEO304_TEST_STORAGE_URL", "http://fake-oss:9000"),
    )
    return DevelopmentEvidenceStorage()


def evidence(
    conn: psycopg.Connection[Any], db: AnswerDatabase, storage: DevelopmentEvidenceStorage
):
    raw = b'{"answer":"fixture"}'
    key = f"geo304/{uuid4()}.txt"
    digest = hashlib.sha256(raw).hexdigest()
    storage.put(key, raw, content_type="text/plain", sha256=digest)
    identity = file_record(
        conn,
        db,
        category="EVIDENCE",
        original_filename="fixture.txt",
        object_key=key,
        content_type="text/plain",
        size=len(raw),
        sha256=digest,
    )
    return identity, key


def test_head_verified_association_and_gc_retains_both_refs(answer_database, engine, storage):
    db = answer_database
    with psycopg.connect(db.url) as conn:
        raw, key = evidence(conn, db, storage)
        screen = file_record(conn, db)
        r = new_run(conn, db)
    try:
        with Session(engine) as session:
            lock_answer_evidence_files(
                session,
                uploader_id=db.runs.plan.actor,
                screenshot_file_id=None,
                raw_payload_file_id=raw,
                storage=storage,
            )
            assert file_is_referenced(session, raw) is False
            session.rollback()
        with psycopg.connect(db.url) as conn:
            snapshot(conn, db, r, raw_payload_file_id=raw, screenshot_file_id=screen)
            collect(conn, r)
        with Session(engine) as session:
            assert file_is_referenced(session, raw) and file_is_referenced(session, screen)
            # 旧调度时间也不能让新引用进入 DELETING。
            session.connection().exec_driver_sql(
                "UPDATE file_records SET cleanup_after=now() WHERE id IN (%s,%s)", (raw, screen)
            )
            claimed = _claim_file_cleanup(session, now=datetime.now(UTC), batch_size=1000)
            assert {raw, screen}.isdisjoint(identity for identity, _ in claimed)
            session.rollback()
    finally:
        storage.delete(key)


@pytest.mark.parametrize(
    "case,code,status",
    [
        ("owner", "PERMISSION_DENIED", 403),
        ("missing", "FILE_INTEGRITY_FAILED", 422),
        ("changed", "FILE_INTEGRITY_FAILED", 422),
        ("duplicate", "FILE_INTEGRITY_FAILED", 422),
        ("unavailable", "DEPENDENCY_UNAVAILABLE", 503),
    ],
)
def test_recheck_does_not_accept_changed_or_missing_object(
    answer_database, engine, storage, monkeypatch, case, code, status
):
    db = answer_database
    with psycopg.connect(db.url) as conn:
        identity, key = evidence(conn, db, storage)
    try:
        if case == "missing":
            storage.delete(key)
        elif case == "changed":
            data = b"changed object"
            storage.put(
                key, data, content_type="text/plain", sha256=hashlib.sha256(data).hexdigest()
            )
        elif case == "unavailable":
            monkeypatch.setattr(settings, "development_storage_internal_url", "http://127.0.0.1:1")
        with Session(engine) as session, pytest.raises(AppError) as caught:
            lock_answer_evidence_files(
                session,
                uploader_id=uuid4() if case == "owner" else db.runs.plan.actor,
                screenshot_file_id=identity if case == "duplicate" else None,
                raw_payload_file_id=identity,
                storage=storage,
            )
        assert caught.value.code == code and caught.value.status_code == status
    finally:
        if case == "unavailable":
            monkeypatch.setattr(settings, "development_storage_internal_url",
                                os.environ.get("GEO304_TEST_STORAGE_URL", "http://fake-oss:9000"))
        storage.delete(key)


def test_association_lock_makes_gc_skip_and_gc_claim_blocks_association(answer_database, engine):
    db = answer_database
    with psycopg.connect(db.url) as conn:
        f = file_record(conn, db)
        r = new_run(conn, db)
    with psycopg.connect(db.url) as owner:
        snapshot(owner, db, r, screenshot_file_id=f)
        with Session(engine) as gc:
            assert f not in {
                identity
                for identity, _ in _claim_file_cleanup(gc, now=datetime.now(UTC), batch_size=1000)
            }
            gc.rollback()
        collect(owner, r)
    with psycopg.connect(db.url) as conn:
        deleting = file_record(conn, db)
        second = new_run(conn, db)
    with Session(engine) as gc:
        assert deleting in {
            identity
            for identity, _ in _claim_file_cleanup(gc, now=datetime.now(UTC), batch_size=1000)
        }
        gc.commit()
    with psycopg.connect(db.url) as conn, pytest.raises(psycopg.errors.CheckViolation) as caught:
        snapshot(conn, db, second, screenshot_file_id=deleting)
    assert caught.value.diag.constraint_name == "ck_geo_answers_file_eligible"


def test_repeatable_read_stale_file_cannot_revive_gc_claim(answer_database, engine):
    db = answer_database
    with psycopg.connect(db.url) as conn:
        f = file_record(conn, db)
        r = new_run(conn, db)
    with psycopg.connect(db.url) as stale:
        stale.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        stale.execute("SELECT status FROM file_records WHERE id=%s", (f,)).fetchone()
        with Session(engine) as gc:
            assert f in {
                identity
                for identity, _ in _claim_file_cleanup(gc, now=datetime.now(UTC), batch_size=1000)
            }
            gc.commit()
        with pytest.raises(psycopg.errors.SerializationFailure):
            snapshot(stale, db, r, screenshot_file_id=f)
        stale.rollback()
