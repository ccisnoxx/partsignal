"""人工取消事务owner；Batch/Run锁与提交共用，不删除草稿或已提交证据。"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.geo_manual_cancellation import GeoManualRunCancellation
from app.models.geo_manual_collection import GeoManualDraft
from app.models.identity import User
from app.schemas.common import AccountType
from app.schemas.geo_manual_cancellation import (
    GeoManualRunCancellationOut,
    GeoManualRunCancelRequest,
)
from app.schemas.geo_runs import GeoRunStatus
from app.services.current_actor import current_actor_command
from app.services.geo_run_lifecycle import database_now, lock_run, refresh_batch, run_state
from app.services.geo_run_policy import require_cancellable, run_transition


def cancel_manual_run(
    db: Session, *, run_id: UUID, payload: GeoManualRunCancelRequest, actor: User, request_id: str
) -> GeoManualRunCancellationOut:
    db.autoflush = False
    if db.connection().get_isolation_level() != "READ COMMITTED":
        raise ValueError("人工取消要求READ COMMITTED")
    with current_actor_command(
        db, actor, allowed=(AccountType.ADMIN, AccountType.ENGINEER)
    ) as current:
        locked = lock_run(db, run_id)
        if locked is None:
            raise not_found("GEO 运行")
        batch, run = locked
        state = run_state(db, run)
        if state.collection_mode != "MANUAL":
            raise AppError("GEO_MANUAL_MODE_REQUIRED", "仅支持取消人工运行", 409)
        if run.revision != payload.expected_revision:
            raise AppError("REVISION_CONFLICT", "运行已变化，请重读后重新确认取消", 409)
        require_cancellable(state)
        draft = db.scalar(
            select(GeoManualDraft)
            .where(GeoManualDraft.run_id == run_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        draft_revision = draft.draft_revision if draft else 0
        if draft_revision != payload.expected_draft_revision:
            raise AppError("REVISION_CONFLICT", "已保存草稿已变化，请重读后重新确认取消", 409)
        now = database_now(db)
        run.status = run_transition(state, GeoRunStatus.CANCELLED).value
        run.finished_at = now
        run.revision += 1
        # 先让数据库看到CANCELLED，再由记录守卫核对；提交前延迟守卫要求二者俱全。
        db.flush()
        record = GeoManualRunCancellation(
            run_id=run.id,
            cancelled_by=current.id,
            cancelled_at=now,
            reason=payload.reason,
            run_revision=run.revision,
            draft_revision=draft_revision,
        )
        db.add(record)
        refresh_batch(db, batch, now)
        append_audit(
            db,
            AuditEntry(
                actor_id=current.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_manual_observation.cancelled",
                target_type="GeoObservationRun",
                target_id=run.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已取消未提交人工运行",
                details={
                    "facts": {
                        "revision": run.revision,
                        "draft_revision": draft_revision,
                        "status": "CANCELLED",
                    }
                },
            ),
        )
        result = GeoManualRunCancellationOut.model_validate(record)
        db.commit()
        return result
