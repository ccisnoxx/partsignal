"""GEO 临时材料保留；业务历史和仍被引用的文件不进入删除范围。"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import exists, func, select

from app.config import settings
from app.db import SessionLocal
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_files import FileRecord
from app.models.geo_manual_collection import GeoManualDraft
from app.models.geo_retention import GeoManualDraftTombstone
from app.models.geo_runs import GeoObservationRun
from app.services.file_records import (
    DETACHED_RETENTION,
    FileCleanupResult,
    cleanup_file_records,
    schedule_unreferenced_file,
)
from app.services.geo_ops_logging import geo_event
from app.services.storage import EvidenceStorage


@dataclass(frozen=True)
class DraftCleanupResult:
    selected: int = 0
    purged: int = 0
    skipped: int = 0


@dataclass(frozen=True)
class GeoRetentionResult:
    dry_run: bool
    drafts: DraftCleanupResult
    files: FileCleanupResult


def _validate_batch(batch_size: int) -> None:
    if type(batch_size) is not int or not 1 <= batch_size <= 1000:
        raise ValueError("GEO 清理批量必须为1至1000")


def cleanup_terminal_drafts(
    *, retention_days: int | None, batch_size: int, dry_run: bool
) -> DraftCleanupResult:
    """只清理不可再录入的终态草稿；每个 Run 独立提交，避免跨 Run 反向持文件锁。"""
    _validate_batch(batch_size)
    if retention_days is None:
        return DraftCleanupResult()
    if type(retention_days) is not int or not 1 <= retention_days <= 3650:
        raise ValueError("终态草稿保留期必须为1至3650天")
    terminal = GeoObservationRun.status.in_(("FAILED", "CANCELLED", "BUDGET_BLOCKED"))
    no_answer = ~exists().where(GeoAnswerSnapshot.run_id == GeoObservationRun.id)
    with SessionLocal() as db:
        if dry_run:
            db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        now = db.scalar(select(func.clock_timestamp()))
        assert isinstance(now, datetime)
        candidates = list(db.scalars(
            select(GeoManualDraft.run_id)
            .join(GeoObservationRun, GeoObservationRun.id == GeoManualDraft.run_id)
            .where(
                terminal, no_answer, GeoObservationRun.external_call_state == "NOT_STARTED",
                GeoObservationRun.input_snapshot["profile"]["collection_mode"].astext == "MANUAL",
                GeoManualDraft.updated_at <= now - timedelta(days=retention_days),
            )
            .order_by(GeoManualDraft.updated_at, GeoManualDraft.run_id)
            .limit(batch_size)
        ))
    if dry_run:
        return DraftCleanupResult(selected=len(candidates))

    purged = 0
    for run_id in candidates:
        with SessionLocal.begin() as db:
            run = db.scalar(
                select(GeoObservationRun)
                .where(GeoObservationRun.id == run_id, terminal, no_answer)
                .with_for_update(skip_locked=True)
            )
            if run is None or run.external_call_state != "NOT_STARTED" or (
                run.input_snapshot["profile"]["collection_mode"] != "MANUAL"
            ):
                continue
            draft = db.scalar(select(GeoManualDraft).where(
                GeoManualDraft.run_id == run_id
            ).with_for_update())
            now = db.scalar(select(func.clock_timestamp()))
            assert isinstance(now, datetime)
            if draft is None or draft.updated_at > now - timedelta(days=retention_days):
                continue
            ids = sorted(v for v in (draft.raw_payload_file_id, draft.screenshot_file_id)
                         if v is not None)
            db.execute(select(FileRecord.id).where(FileRecord.id.in_(ids))
                       .order_by(FileRecord.id).with_for_update()).all()
            db.add(GeoManualDraftTombstone(
                run_id=run_id, draft_revision=draft.draft_revision,
                draft_updated_at=draft.updated_at, retention_days=retention_days,
            ))
            db.flush()
            db.delete(draft)
            db.flush()
            for file_id in ids:
                schedule_unreferenced_file(db, file_id, cleanup_after=now + DETACHED_RETENTION)
        purged += 1
    return DraftCleanupResult(len(candidates), purged, len(candidates) - purged)


def cleanup_geo_artifacts(*, storage: EvidenceStorage | None = None) -> GeoRetentionResult:
    """无消息载荷的定时入口；配置省略的策略不猜默认期限，不受采集开关豁免。"""
    batch_size = settings.geo_retention_batch_size
    dry_run = settings.geo_retention_dry_run
    drafts = cleanup_terminal_drafts(
        retention_days=settings.geo_terminal_draft_retention_days,
        batch_size=batch_size, dry_run=dry_run,
    )
    with SessionLocal() as db:
        now = db.scalar(select(func.clock_timestamp()))
        assert isinstance(now, datetime)
    raw_days = settings.geo_raw_payload_retention_days
    orphan_days = settings.geo_unreferenced_file_retention_days
    files = cleanup_file_records(
        now=now, batch_size=batch_size, dry_run=dry_run, storage=storage,
        raw_before=now - timedelta(days=raw_days) if raw_days is not None else None,
        unreferenced_before=now - timedelta(days=orphan_days) if orphan_days is not None else None,
    )
    result = GeoRetentionResult(dry_run, drafts, files)
    geo_event(event="retention_finished", stage="RETENTION", status="SUCCEEDED",
              selected_count=drafts.selected + files.selected, purged_count=drafts.purged,
              retry_count=files.retry)
    return result
