"""人工采集事务 owner；原文、引用、文件与状态一次冻结，分析尚未接线。"""

import hashlib
import json
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.geo_answers import GeoAnswerCitation, GeoAnswerSnapshot
from app.models.geo_files import FileRecord
from app.models.geo_manual_collection import GeoManualDraft, GeoManualSubmission
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.models.identity import User
from app.schemas.common import AccountType
from app.schemas.geo_answers import GeoAnswerCitationInput
from app.schemas.geo_manual_collection import (
    GeoManualDraftOut,
    GeoManualDraftSave,
    GeoManualEntryContext,
    GeoManualObservationDraft,
    GeoManualObservationSubmit,
    GeoManualObservationSubmitted,
)
from app.schemas.geo_runs import (
    GeoExternalCallState,
    GeoRunErrorStage,
    GeoRunInputSnapshot,
    GeoRunStatus,
)
from app.schemas.geo_surface_management import GeoProfileActivationBlocker
from app.schemas.geo_surfaces import GeoCollectionMode
from app.services.file_records import DETACHED_RETENTION, schedule_unreferenced_file
from app.services.geo_answer_citations import prepare_answer_citations
from app.services.geo_answer_files import lock_answer_evidence_files
from app.services.geo_batch_policy import BatchRunState, batch_status
from app.services.geo_collection_profiles import profile_eligibility
from app.services.geo_plan_locks import command
from app.services.geo_run_policy import (
    RunCommandAvailability,
    RunState,
    run_transition,
    run_workflow,
)


def submission_identity(actor_id: UUID, key: str) -> str:
    if not 1 <= len(key) <= 160 or any(not 0x21 <= ord(c) <= 0x7E for c in key):
        raise AppError("VALIDATION_ERROR", "提交幂等键必须为1至160字符可见ASCII", 422)
    return hashlib.sha256(f"geo-manual-submit:{actor_id}:{key}".encode()).hexdigest()


def canonical_draft(value: GeoManualObservationDraft) -> dict[str, Any]:
    data = value.model_dump(mode="json", exclude={"expected_draft_revision"})
    data["citations"] = sorted(data["citations"], key=lambda v: v["position"])
    if value.collected_at is not None:
        data["collected_at"] = value.collected_at.astimezone(UTC).isoformat(timespec="microseconds")
    return data


def submission_hash(run_id: UUID, value: GeoManualObservationSubmit) -> str:
    data = {
        "run_id": str(run_id),
        "expected_draft_revision": value.expected_draft_revision,
        "observation": canonical_draft(value),
    }
    return hashlib.sha256(
        json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def _run(db: Session, run_id: UUID, *, lock: bool = False) -> GeoObservationRun:
    query = select(GeoObservationRun).where(GeoObservationRun.id == run_id)
    if lock:
        query = query.with_for_update()
    run = db.scalar(query.execution_options(populate_existing=True))
    if run is None:
        raise not_found("GEO 运行")
    return run


def _state(db: Session, run: GeoObservationRun) -> RunState:
    return RunState(
        status=GeoRunStatus(run.status),
        collection_mode=GeoCollectionMode(run.input_snapshot["profile"]["collection_mode"]),
        external_call_state=GeoExternalCallState(run.external_call_state),
        error_stage=GeoRunErrorStage(run.error_stage) if run.error_stage else None,
        has_answer=bool(
            db.scalar(select(GeoAnswerSnapshot.id).where(GeoAnswerSnapshot.run_id == run.id))
        ),
        has_successor=bool(
            db.scalar(
                select(GeoObservationRun.id).where(GeoObservationRun.previous_attempt_id == run.id)
            )
        ),
    )


def _require_pending(state: RunState) -> None:
    if state.collection_mode != GeoCollectionMode.MANUAL:
        raise AppError("GEO_MANUAL_MODE_REQUIRED", "只有 MANUAL 运行可人工录入", 409)
    if (
        state.status != GeoRunStatus.PENDING
        or state.external_call_state != GeoExternalCallState.NOT_STARTED
        or state.has_answer
        or state.has_successor
    ):
        raise AppError("INVALID_STATE_TRANSITION", "当前运行不可编辑或再次正式提交", 409)


def _draft(db: Session, run_id: UUID, *, lock: bool = False) -> GeoManualDraft | None:
    query = select(GeoManualDraft).where(GeoManualDraft.run_id == run_id)
    if lock:
        query = query.with_for_update()
    return db.scalar(query.execution_options(populate_existing=True))


def _draft_out(value: GeoManualDraft) -> GeoManualDraftOut:
    return GeoManualDraftOut(
        run_id=value.run_id,
        draft_revision=value.draft_revision,
        draft=GeoManualObservationDraft.model_validate(value.draft),
        updated_by=value.updated_by,
        updated_at=value.updated_at,
    )


def manual_entry_context(db: Session, *, run_id: UUID, actor: User) -> GeoManualEntryContext:
    run = _run(db, run_id)
    state = _state(db, run)
    _require_pending(state)
    eligibility = profile_eligibility(db, run.collection_profile_id)
    draft = _draft(db, run_id)
    workflow = run_workflow(
        state,
        actor_type=AccountType(actor.account_type),
        actor_active=actor.is_active,
        collection_eligible=eligibility.eligible,
        commands=RunCommandAvailability(manual_entry=True, cancel=False, retry=False),
    )
    snapshot = GeoRunInputSnapshot.model_validate(run.input_snapshot)
    return GeoManualEntryContext(
        **workflow.model_dump(),
        run_id=run.id,
        batch_id=run.batch_id,
        run_revision=run.revision,
        input_snapshot=snapshot,
        require_screenshot=run.input_snapshot["profile"]["settings"].get(
            "require_screenshot", True
        ),
        draft_revision=draft.draft_revision if draft else 0,
        draft=_draft_out(draft) if draft else None,
        collection_blockers=[
            GeoProfileActivationBlocker(code=b.code, field=b.field) for b in eligibility.blockers
        ],
    )


def _lock_entry(db: Session, run_id: UUID) -> tuple[GeoObservationRun, GeoObservationBatch]:
    initial = _run(db, run_id)
    # Run 的身份和绑定不可变；初读仅确定锁集合，当前资格在锁后重验。
    if initial.input_snapshot["profile"]["collection_mode"] != "MANUAL":
        raise AppError("GEO_MANUAL_MODE_REQUIRED", "只有 MANUAL 运行可人工录入", 409)
    surface_id = UUID(initial.input_snapshot["profile"]["surface"]["id"])
    db.execute(
        select(GeoEngineSurface.id).where(GeoEngineSurface.id == surface_id).with_for_update()
    ).all()
    profile = db.scalar(
        select(GeoCollectionProfile)
        .where(GeoCollectionProfile.id == initial.collection_profile_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if profile is None:
        raise not_found("GEO 采集配置")
    if profile.engine_surface_id != surface_id or profile.collection_mode != "MANUAL":
        raise AppError("GEO_PROFILE_CHANGED", "当前采集配置与冻结的人工运行绑定不一致", 409)
    batch = db.scalar(
        select(GeoObservationBatch)
        .where(GeoObservationBatch.id == initial.batch_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if batch is None:
        raise not_found("GEO 批次")
    run = _run(db, run_id, lock=True)
    _require_pending(_state(db, run))
    eligibility = profile_eligibility(db, run.collection_profile_id)
    if not eligibility.eligible:
        raise AppError(
            "GEO_PLAN_PROFILE_INELIGIBLE",
            "当前配置不具备采集资格",
            422,
            details={
                "blockers": [{"code": b.code.value, "field": b.field} for b in eligibility.blockers]
            },
        )
    return run, batch


def _check_revision(draft: GeoManualDraft | None, expected: int) -> None:
    actual = draft.draft_revision if draft else 0
    if actual != expected:
        raise AppError(
            "REVISION_CONFLICT",
            "人工草稿已被其他请求修改，请重新读取",
            409,
            details={"current_revision": actual},
        )


def _file_ids(value: GeoManualDraft | GeoManualObservationDraft | None) -> set[UUID]:
    return (
        {v for v in (value.screenshot_file_id, value.raw_payload_file_id) if v is not None}
        if value
        else set()
    )


def _lock_files(
    db: Session, draft: GeoManualDraft | None, value: GeoManualObservationDraft, actor: User
) -> set[UUID]:
    old = _file_ids(draft)
    # 先一次锁定旧、新引用全集，避免解绑清理在新文件锁之后逆序获取旧锁。
    ids = old | _file_ids(value)
    db.execute(
        select(FileRecord.id)
        .where(FileRecord.id.in_(ids))
        .order_by(FileRecord.id)
        .with_for_update()
    ).all()
    lock_answer_evidence_files(
        db,
        uploader_id=actor.id,
        screenshot_file_id=value.screenshot_file_id,
        raw_payload_file_id=value.raw_payload_file_id,
    )
    return old - _file_ids(value)


def _cleanup_detached(db: Session, ids: set[UUID], now: datetime) -> None:
    for identity in sorted(ids):
        schedule_unreferenced_file(db, identity, cleanup_after=now + DETACHED_RETENTION)


def _audit(
    db: Session,
    *,
    actor: User,
    run_id: UUID,
    revision: int,
    request_id: str,
    submitted: UUID | None = None,
) -> None:
    facts: dict[str, Any] = {"run_id": str(run_id), "draft_revision": revision}
    if submitted is not None:
        facts["answer_snapshot_id"] = str(submitted)
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.GEO_OBSERVATION,
            action="geo_manual_observation.submitted" if submitted else "geo_manual_draft.saved",
            target_type="GeoObservationRun",
            target_id=run_id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="人工回答已冻结，等待分析" if submitted else "人工草稿已保存",
            details={"facts": facts},
        ),
    )


def save_manual_draft(
    db: Session, *, run_id: UUID, payload: GeoManualDraftSave, actor: User, request_id: str
) -> GeoManualDraftOut:
    with command(db, actor) as current:
        _lock_entry(db, run_id)
        draft = _draft(db, run_id, lock=True)
        _check_revision(draft, payload.expected_draft_revision)
        data = canonical_draft(payload.draft)
        if draft is not None and draft.draft == data:
            result = _draft_out(draft)
            db.rollback()
            return result
        detached = _lock_files(db, draft, payload.draft, current)
        now = db.scalar(select(func.clock_timestamp()))
        assert isinstance(now, datetime)
        if draft is None:
            draft = GeoManualDraft(
                run_id=run_id,
                draft_revision=1,
                draft=data,
                updated_by=current.id,
                updated_at=now,
                created_at=now,
                screenshot_file_id=payload.draft.screenshot_file_id,
                raw_payload_file_id=payload.draft.raw_payload_file_id,
            )
            db.add(draft)
        else:
            draft.draft = data
            draft.draft_revision += 1
            draft.updated_by = current.id
            draft.updated_at = now
            draft.screenshot_file_id = payload.draft.screenshot_file_id
            draft.raw_payload_file_id = payload.draft.raw_payload_file_id
        db.flush()
        _cleanup_detached(db, detached, now)
        _audit(
            db, actor=current, run_id=run_id, revision=draft.draft_revision, request_id=request_id
        )
        result = _draft_out(draft)
        db.commit()
        return result


def _receipt(db: Session, submission: GeoManualSubmission) -> GeoManualObservationSubmitted:
    answer = db.get(GeoAnswerSnapshot, submission.answer_snapshot_id)
    if answer is None:
        raise ValueError("提交身份缺少不可变回答")
    return GeoManualObservationSubmitted(
        run_id=submission.run_id,
        answer_snapshot_id=answer.id,
        answer_sha256=answer.answer_sha256,
        run_revision=submission.run_revision,
        draft_revision=submission.draft_revision,
        collected_at=answer.collected_at,
        submitted_at=submission.created_at,
        collection_status="COLLECTED",
        analysis_dispatch="NOT_IMPLEMENTED",
    )


def _refresh_batch(db: Session, batch: GeoObservationBatch, now: datetime) -> None:
    runs = list(db.scalars(select(GeoObservationRun).where(GeoObservationRun.batch_id == batch.id)))
    states = [BatchRunState(r.run_cell_key, r.attempt_no, _state(db, r)) for r in runs]
    status = batch_status(
        states, requested_run_count=batch.requested_run_count, matrix_committed=True
    )
    if batch.status != status:
        batch.status = status.value
        batch.revision += 1
        if batch.started_at is None:
            batch.started_at = now


def submit_manual_observation(
    db: Session,
    *,
    run_id: UUID,
    payload: GeoManualObservationSubmit,
    actor: User,
    idempotency_key: str,
    request_id: str,
) -> GeoManualObservationSubmitted:
    identity = submission_identity(actor.id, idempotency_key)
    digest = submission_hash(run_id, payload)
    with command(db, actor) as current:
        key = int.from_bytes(bytes.fromhex(identity)[:8], "big", signed=True)
        db.execute(select(func.pg_advisory_xact_lock(key)))
        previous = db.get(GeoManualSubmission, identity)
        if previous is not None:
            if previous.request_hash != digest:
                raise AppError("IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同提交内容或运行", 409)
            result = _receipt(db, previous)
            db.rollback()
            return result
        run, batch = _lock_entry(db, run_id)
        draft = _draft(db, run_id, lock=True)
        _check_revision(draft, payload.expected_draft_revision)
        if not payload.answer_text.strip():
            raise AppError("GEO_ANSWER_EMPTY", "正式提交必须包含非空回答", 422)
        if payload.screenshot_file_id is None and payload.raw_payload_file_id is None:
            raise AppError("GEO_EVIDENCE_REQUIRED", "正式提交必须包含截图或原始证据", 422)
        if (
            run.input_snapshot["profile"]["settings"].get("require_screenshot", True)
            and payload.screenshot_file_id is None
        ):
            raise AppError("GEO_SCREENSHOT_REQUIRED", "冻结的采集配置要求截图证据", 422)
        detached = _lock_files(db, draft, payload, current)
        now = db.scalar(select(func.clock_timestamp()))
        assert isinstance(now, datetime)
        collected = payload.collected_at.astimezone(UTC)
        if not run.created_at <= collected <= now:
            raise AppError("VALIDATION_ERROR", "采集时间必须在运行创建与当前提交时间之间", 422)
        citations = prepare_answer_citations(
            [GeoAnswerCitationInput.model_validate(v.model_dump()) for v in payload.citations]
        )
        # 先解除临时引用，再创建答案；所有步骤仍受 Run 锁和同一事务保护。
        if draft is not None:
            db.delete(draft)
            db.flush()
        answer = GeoAnswerSnapshot(
            run_id=run.id,
            prompt_text=run.input_snapshot["prompt"]["prompt_text"],
            answer_text=payload.answer_text,
            answer_format=payload.answer_format,
            source_product=payload.source_product,
            source_model=payload.source_model,
            source_version=payload.source_version,
            web_search_observed=payload.web_search_observed,
            raw_payload_summary=payload.raw_payload_summary.model_dump(mode="json"),
            raw_payload_file_id=payload.raw_payload_file_id,
            screenshot_file_id=payload.screenshot_file_id,
            citation_count=len(citations),
            collected_at=collected,
        )
        db.add(answer)
        db.flush()
        db.add_all(
            [
                GeoAnswerCitation(
                    answer_snapshot_id=answer.id,
                    original_url=c.original_url,
                    normalized_url=c.normalized_url,
                    hostname=c.hostname,
                    position=c.position,
                    occurrences=list(c.occurrences),
                    title=c.title,
                    extraction_source=c.extraction_source,
                )
                for c in citations
            ]
        )
        db.flush()
        run_transition(replace(_state(db, run), has_answer=True), GeoRunStatus.COLLECTED)
        run.status = "COLLECTED"
        run.revision += 1
        run.started_at = collected
        run.collected_at = collected
        db.flush()
        _refresh_batch(db, batch, now)
        submission = GeoManualSubmission(
            identity_hash=identity,
            request_hash=digest,
            run_id=run.id,
            answer_snapshot_id=answer.id,
            submitted_by=current.id,
            run_revision=run.revision,
            draft_revision=payload.expected_draft_revision,
            created_at=now,
        )
        db.add(submission)
        _cleanup_detached(db, detached, now)
        _audit(
            db,
            actor=current,
            run_id=run_id,
            revision=payload.expected_draft_revision,
            submitted=answer.id,
            request_id=request_id,
        )
        db.flush()
        result = _receipt(db, submission)
        db.commit()
        return result
