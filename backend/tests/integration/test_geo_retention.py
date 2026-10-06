"""真实 PG 保留边界、不可变墓碑、引用与存储故障重试。"""

import hashlib
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from psycopg.types.json import Jsonb
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.db import Base
from app.models.geo_files import FileRecord
from app.schemas.geo_manual_collection import GeoManualObservationDraft
from app.services import file_records, geo_retention
from app.services.storage import StorageUnavailable
from tests.integration.geo_answers_support import (
    AnswerDatabase,
    collect,
    file_record,
    new_run,
    plan_database,
    run_database,
    snapshot,
)
from tests.integration.test_migrations import run_alembic

__all__ = ["plan_database", "run_database"]
pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def retention_database(run_database):
    db = run_database
    run_alembic(db.plan.env, db.plan.backend_dir, "0063_geo_browser_sessions")
    value = AnswerDatabase(db, uuid4())
    with psycopg.connect(db.url) as conn:
        retained = new_run(conn, value)
        answer = snapshot(conn, value, retained)
        collect(conn, retained)
        before = conn.execute(
            "SELECT * FROM geo_answer_snapshots WHERE id=%s", (answer,)
        ).fetchone()
    run_alembic(db.plan.env, db.plan.backend_dir, "head")
    with psycopg.connect(db.url) as conn:
        after = conn.execute("SELECT * FROM geo_answer_snapshots WHERE id=%s", (answer,)).fetchone()
        assert after == before
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0065_geo_observability",
        )
    yield value


@pytest.fixture
def factory(retention_database, monkeypatch):
    engine = create_engine(retention_database.url.replace("postgresql://", "postgresql+psycopg://"))
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(file_records, "SessionLocal", sessions)
    monkeypatch.setattr(geo_retention, "SessionLocal", sessions)
    yield sessions
    engine.dispose()


class LocalStorage:
    """真实本地字节；指定一次故障，删除缺失对象幂等。"""
    def __init__(self, root):
        self.root = root
        self.fail = False
        self.calls = []

    def put(self, key):
        (self.root / hashlib.sha256(key.encode()).hexdigest()).write_bytes(b"fixture")

    def exists(self, key):
        return (self.root / hashlib.sha256(key.encode()).hexdigest()).exists()

    def delete(self, key):
        self.calls.append(key)
        if self.fail:
            raise StorageUnavailable("虚构存储故障")
        (self.root / hashlib.sha256(key.encode()).hexdigest()).unlink(missing_ok=True)


def record(db, *, age=200, raw=False, **values):
    now = datetime.now(UTC)
    cleanup_after = values.pop("cleanup_after", None)
    with psycopg.connect(db.url) as conn:
        identity = file_record(
            conn, db, category="EVIDENCE" if raw else "OPERATION_SCREENSHOT",
            content_type="text/plain" if raw else "image/png", cleanup_after=cleanup_after,
            created_at=now - timedelta(days=age), verified_at=now - timedelta(days=age),
            **values,
        )
        key = conn.execute(
            "SELECT object_key FROM file_records WHERE id=%s", (identity,)
        ).fetchone()[0]
    return identity, key


def draft(db, *, age=30, terminal=True, screenshot=None):
    with psycopg.connect(db.url) as conn:
        run = new_run(conn, db)
        data = GeoManualObservationDraft(
            answer_text="未提交的临时虚构内容", screenshot_file_id=screenshot
        ).model_dump(mode="json")
        conn.execute(
            "INSERT INTO geo_manual_drafts(run_id,draft_revision,draft,updated_by,"
            "screenshot_file_id,updated_at) VALUES (%s,1,%s,%s,%s,%s)",
            (run, Jsonb(data), db.runs.plan.actor, screenshot,
             datetime.now(UTC) - timedelta(days=age)),
        )
        if terminal:
            conn.execute("UPDATE geo_observation_runs SET status='CANCELLED', "
                         "finished_at=clock_timestamp(), revision=revision+1 WHERE id=%s", (run,))
    return run


def row(db, table, column, identity):
    with psycopg.connect(db.url) as conn:
        # table/column只使用本文件常量。
        return conn.execute(f"SELECT * FROM {table} WHERE {column}=%s", (identity,)).fetchone()


def test_raw_retention_boundary_and_dry_run_never_touch_objects(
    retention_database, factory, tmp_path
):
    db = retention_database
    identity, key = record(db, raw=True)
    storage = LocalStorage(tmp_path)
    storage.put(key)
    with factory() as session:
        verified = session.get(FileRecord, identity).verified_at
    before = row(db, "file_records", "id", identity)
    for cutoff, selected in ((verified - timedelta(microseconds=1), False), (verified, True)):
        with factory() as session:
            candidates = file_records._claim_file_cleanup(
                session, now=datetime.now(UTC), batch_size=1000, dry_run=True, raw_before=cutoff,
            )
            assert ((identity, key) in candidates) == selected
        assert row(db, "file_records", "id", identity) == before
    result = file_records.cleanup_file_records(
        dry_run=True, storage=storage, raw_before=verified, batch_size=1000,
    )
    assert result.dry_run and result.deleted == result.retry == 0
    assert storage.calls == [] and storage.exists(key)
    assert row(db, "file_records", "id", identity) == before
    file_records.cleanup_file_records(storage=storage, raw_before=verified, batch_size=1000)
    with factory() as session:
        tombstone = session.get(FileRecord, identity)
        assert tombstone.status == "DELETED" and tombstone.sha256 == before[6]
    assert not storage.exists(key)


def test_unreferenced_policy_and_storage_failure_keep_retryable_tombstone(
    retention_database, factory, tmp_path
):
    db = retention_database
    identity, key = record(db)
    storage = LocalStorage(tmp_path)
    storage.put(key)
    storage.fail = True
    deadline = datetime.now(UTC) - timedelta(days=7)
    result = file_records.cleanup_file_records(
        storage=storage, unreferenced_before=deadline, batch_size=1000,
    )
    assert result.retry >= 1 and storage.exists(key)
    with factory() as session:
        assert session.get(FileRecord, identity).status == "DELETING"
    storage.fail = False
    result = file_records.cleanup_file_records(storage=storage, batch_size=1000)
    assert result.deleted >= 1
    with factory() as session:
        assert session.get(FileRecord, identity).status == "DELETED"
    assert not storage.exists(key)


def test_answer_raw_screenshot_and_active_draft_files_survive_expiry(
    retention_database, factory, tmp_path
):
    db = retention_database
    raw, raw_key = record(db, raw=True)
    screen, screen_key = record(db)
    active_file, active_key = record(db)
    active = draft(db, terminal=False, screenshot=active_file, age=200)
    with psycopg.connect(db.url) as conn:
        run = new_run(conn, db)
        answer = snapshot(conn, db, run, raw_payload_file_id=raw, screenshot_file_id=screen)
        collect(conn, run)
    before = {name: row(db, table, column, identity) for name, table, column, identity in (
        ("run", "geo_observation_runs", "id", run),
        ("answer", "geo_answer_snapshots", "id", answer),
        ("draft", "geo_manual_drafts", "run_id", active),
    )}
    storage = LocalStorage(tmp_path)
    for key in (raw_key, screen_key, active_key):
        storage.put(key)
    file_records.cleanup_file_records(
        storage=storage, raw_before=datetime.now(UTC), unreferenced_before=datetime.now(UTC),
        batch_size=1000,
    )
    geo_retention.cleanup_terminal_drafts(retention_days=1, batch_size=1000, dry_run=False)
    assert all(storage.exists(key) for key in (raw_key, screen_key, active_key))
    assert row(db, "geo_observation_runs", "id", run) == before["run"]
    assert row(db, "geo_answer_snapshots", "id", answer) == before["answer"]
    assert row(db, "geo_manual_drafts", "run_id", active) == before["draft"]


def test_terminal_draft_cleanup_is_atomic_keeps_tombstone_and_shared_file(
    retention_database, factory
):
    db = retention_database
    file_id, _ = record(db)
    active = draft(db, terminal=False, screenshot=file_id)
    terminal = draft(db, screenshot=file_id)
    fresh = draft(db, age=0)
    before = row(db, "geo_manual_drafts", "run_id", terminal)
    geo_retention.cleanup_terminal_drafts(retention_days=7, batch_size=1000, dry_run=True)
    assert row(db, "geo_manual_drafts", "run_id", terminal) == before
    assert row(db, "geo_manual_draft_tombstones", "run_id", terminal) is None
    geo_retention.cleanup_terminal_drafts(retention_days=7, batch_size=1000, dry_run=False)
    assert row(db, "geo_manual_drafts", "run_id", terminal) is None
    tombstone = row(db, "geo_manual_draft_tombstones", "run_id", terminal)
    assert tombstone[:2] == (terminal, 1)
    assert row(db, "geo_manual_drafts", "run_id", active)
    assert row(db, "geo_manual_drafts", "run_id", fresh)
    with factory() as session:
        assert session.get(FileRecord, file_id).cleanup_after is None
    assert geo_retention.cleanup_terminal_drafts(
        retention_days=7, batch_size=1000, dry_run=False
    ).purged == 0
    with psycopg.connect(db.url) as conn, pytest.raises(psycopg.errors.CheckViolation) as error:
        conn.execute("DELETE FROM geo_manual_draft_tombstones WHERE run_id=%s", (terminal,))
    assert error.value.diag.constraint_name == "ck_geo_draft_tombstones_immutable"
    with psycopg.connect(db.url) as conn, pytest.raises(psycopg.errors.CheckViolation) as error:
        conn.execute("TRUNCATE geo_manual_draft_tombstones")
    assert error.value.diag.constraint_name == "ck_geo_draft_tombstones_immutable"
    assert row(db, "geo_manual_draft_tombstones", "run_id", terminal) == tombstone


def test_tombstone_cannot_bypass_pending_or_fresh_retention_and_delete_guard(
    retention_database, factory
):
    db = retention_database
    for run in (draft(db, terminal=False), draft(db, age=0)):
        with psycopg.connect(db.url) as conn, pytest.raises(psycopg.errors.CheckViolation) as error:
            conn.execute("INSERT INTO geo_manual_draft_tombstones "
                         "SELECT run_id,draft_revision,updated_at,7,clock_timestamp() "
                         "FROM geo_manual_drafts WHERE run_id=%s", (run,))
        assert error.value.diag.constraint_name == "ck_geo_draft_tombstones_eligible"
        assert row(db, "geo_manual_drafts", "run_id", run)
    terminal = draft(db)
    with psycopg.connect(db.url) as conn, pytest.raises(psycopg.errors.CheckViolation) as error:
        conn.execute("DELETE FROM geo_manual_drafts WHERE run_id=%s", (terminal,))
    assert error.value.diag.constraint_name == "ck_geo_manual_drafts_editable"
    with psycopg.connect(db.url) as conn, pytest.raises(psycopg.errors.CheckViolation) as error:
        conn.execute("INSERT INTO geo_manual_draft_tombstones "
                     "SELECT run_id,draft_revision,updated_at,7,clock_timestamp() "
                     "FROM geo_manual_drafts WHERE run_id=%s", (terminal,))
        conn.commit()
    assert error.value.diag.constraint_name == "ck_geo_draft_tombstones_complete"
    assert row(db, "geo_manual_draft_tombstones", "run_id", terminal) is None


def test_locked_run_is_skipped_and_last_reference_gets_seven_days(
    retention_database, factory
):
    db = retention_database
    file_id, _ = record(db)
    terminal = draft(db, screenshot=file_id)
    with factory() as holding:
        holding.execute(select(text("id")).select_from(text("geo_observation_runs"))
                        .where(text("id=:id")).with_for_update(), {"id": terminal})
        result = geo_retention.cleanup_terminal_drafts(
            retention_days=7, batch_size=1000, dry_run=False,
        )
        assert result.skipped >= 1
        assert row(db, "geo_manual_drafts", "run_id", terminal)
    geo_retention.cleanup_terminal_drafts(retention_days=7, batch_size=1000, dry_run=False)
    assert row(db, "geo_manual_drafts", "run_id", terminal) is None
    with factory() as session:
        deadline = session.get(FileRecord, file_id).cleanup_after
        assert deadline > datetime.now(UTC) + timedelta(days=6)


def test_file_scan_is_bounded_and_skips_locked_candidate(retention_database, factory):
    db = retention_database
    identity, _ = record(db, raw=True)
    with factory() as holding:
        holding.execute(select(FileRecord).where(FileRecord.id == identity).with_for_update())
        with factory() as scanning:
            claimed = file_records._claim_file_cleanup(
                scanning, now=datetime.now(UTC), raw_before=datetime.now(UTC), batch_size=1,
            )
            assert len(claimed) <= 1
            assert identity not in {value[0] for value in claimed}
            scanning.rollback()
    with factory() as scanning:
        claimed = file_records._claim_file_cleanup(
            scanning, now=datetime.now(UTC), raw_before=datetime.now(UTC), batch_size=1000,
        )
        assert identity in {value[0] for value in claimed}
        scanning.rollback()


def test_storage_success_database_finish_failure_is_retryable(
    retention_database, factory, tmp_path
):
    from sqlalchemy import event

    db = retention_database
    identity, key = record(db, cleanup_after=datetime.now(UTC) - timedelta(days=1))
    storage = LocalStorage(tmp_path)
    storage.put(key)

    def reject_finish(session):
        if any(isinstance(value, FileRecord) and value.status == "DELETED"
               for value in session.dirty):
            raise RuntimeError("虚构数据库完成故障")

    event.listen(factory.class_, "before_commit", reject_finish)
    try:
        with pytest.raises(RuntimeError, match="虚构数据库完成故障"):
            file_records.cleanup_file_records(storage=storage, batch_size=1000)
    finally:
        event.remove(factory.class_, "before_commit", reject_finish)
    assert not storage.exists(key)
    with factory() as session:
        assert session.get(FileRecord, identity).status == "DELETING"
    file_records.cleanup_file_records(storage=storage, batch_size=1000)
    with factory() as session:
        assert session.get(FileRecord, identity).status == "DELETED"


def test_older_referenced_raw_cannot_starve_an_expired_orphan(
    retention_database, factory, tmp_path
):
    db = retention_database
    protected, protected_key = record(db, raw=True, age=500)
    orphan, orphan_key = record(db, raw=True, age=400)
    with psycopg.connect(db.url) as conn:
        run = new_run(conn, db)
        snapshot(conn, db, run, raw_payload_file_id=protected)
        collect(conn, run)
    storage = LocalStorage(tmp_path)
    for key in (protected_key, orphan_key):
        storage.put(key)
    result = file_records.cleanup_file_records(
        storage=storage, batch_size=1,
        raw_before=datetime.now(UTC) - timedelta(days=90),
    )
    assert result.selected == result.deleted == 1
    with factory() as session:
        assert session.get(FileRecord, orphan).status == "DELETED"
        assert session.get(FileRecord, protected).status == "VERIFIED"
    assert not storage.exists(orphan_key) and storage.exists(protected_key)


def test_retention_schema_matches_models(factory):
    tables = {"geo_manual_draft_tombstones", "geo_manual_drafts", "file_records"}
    with factory() as session:
        context = MigrationContext.configure(session.connection(), opts={
            "compare_type": True, "compare_server_default": True,
            # FileRecord旧清理索引/default未完整映射；只比较0064实际新增索引。
            "include_object": lambda obj, name, kind, reflected, compared: (
                obj.name in tables if kind == "table" else (
                    name == "ix_file_records_unscheduled_retention"
                    if obj.table.name == "file_records"
                    else obj.table.name in tables
                )
            ),
        })
        assert compare_metadata(context, Base.metadata) == []


def test_configured_worker_entry_previews_then_cleans_with_collection_disabled(
    retention_database, factory, tmp_path, monkeypatch
):
    db = retention_database
    identity, key = record(db, raw=True, age=900)
    storage = LocalStorage(tmp_path)
    storage.put(key)
    configured = Settings(_env_file=None, APP_ENV="test", GEO_RAW_PAYLOAD_RETENTION_DAYS=90,
                          GEO_RETENTION_BATCH_SIZE=1)
    assert not configured.geo_monitoring_enabled and not configured.geo_browser_collection_enabled
    monkeypatch.setattr(geo_retention, "settings", configured)
    result = geo_retention.cleanup_geo_artifacts(storage=storage)
    assert result.dry_run and result.files.selected == 1 and result.files.deleted == 0
    assert storage.calls == [] and storage.exists(key)
    with factory() as session:
        assert session.get(FileRecord, identity).status == "VERIFIED"
    configured.geo_retention_dry_run = False
    result = geo_retention.cleanup_geo_artifacts(storage=storage)
    assert not result.dry_run and result.files.deleted == 1
    assert not storage.exists(key)
    with factory() as session:
        assert session.get(FileRecord, identity).status == "DELETED"
