"""批次创建事务 owner；锁内冻结输入，提交后只返回稳定回执，不派发。"""

import hashlib
import json
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from itertools import batched
from uuid import UUID, uuid4

from sqlalchemy import func, insert, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.config import settings
from app.errors import AppError, not_found
from app.models.geo_batch_creation import GeoBatchCreationRequest, GeoBatchSubject
from app.models.geo_monitoring_plans import GeoMonitoringPlan
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.geo_surfaces import GeoEngineSurface
from app.models.identity import User
from app.schemas.geo_batch_creation import (
    GeoAdHocBatchCreate,
    GeoBatchCreated,
    GeoObservationBatchCreate,
    GeoPlanBatchCreate,
)
from app.schemas.geo_monitoring_plans import GeoMonitoringPlanConfiguration, GeoMonitoringPlanStatus
from app.schemas.geo_runs import GeoBatchPlanSnapshot, GeoBatchRuleSnapshot
from app.services.geo_batch_snapshots import freeze_inputs
from app.services.geo_collector_eligibility import GeoRuntimeSwitches
from app.services.geo_plan_configuration import canonical_configuration
from app.services.geo_plan_locks import command, lock_plan, lock_resources
from app.services.geo_plan_policy import require_eligible, require_mutable, require_references
from app.services.geo_plans import PlanMatrixSelection, RunMatrixBuilder, load_matrix_facts


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def manual_identity(actor_id: UUID, key: str) -> str:
    # 同一用户跨两个创建入口共享命名空间；不保存或记录原始 key。
    if not 1 <= len(key) <= 160 or any(not 0x21 <= ord(c) <= 0x7E for c in key):
        raise AppError("VALIDATION_ERROR", "创建幂等键必须为1至160字符可见ASCII", 422)
    return _digest(f"geo-batch-manual:{actor_id}:{key}")


def schedule_identity(plan_id: UUID, scheduled_for: datetime) -> str:
    if scheduled_for.tzinfo is None or scheduled_for.utcoffset() is None:
        raise ValueError("调度窗口必须包含时区")
    window = scheduled_for.astimezone(UTC).isoformat(timespec="microseconds")
    return _digest(f"geo-batch-schedule:{plan_id}:{window}")


def _lock_identity(db: Session, identity: str) -> None:
    # 固定64位 advisory xact lock；哈希碰撞只造成等待，真实身份仍由表/索引裁决。
    key = int.from_bytes(bytes.fromhex(identity)[:8], "big", signed=True)
    db.execute(select(func.pg_advisory_xact_lock(key)))


def _receipt(batch: GeoObservationBatch) -> GeoBatchCreated:
    return GeoBatchCreated(
        batch_id=batch.id,
        requested_run_count=batch.requested_run_count,
        created_at=batch.created_at,
    )


def _request_hash(payload: GeoObservationBatchCreate) -> str:
    data = payload.model_dump(mode="json")
    if isinstance(payload, GeoAdHocBatchCreate):
        data["configuration"] = canonical_configuration(payload.configuration).model_dump(
            mode="json"
        )
    return _digest(json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False))


def _latch_references(
    db: Session, value: GeoMonitoringPlanConfiguration, surfaces: set[UUID]
) -> None:
    for model, ids in ((GeoPromptVariant, value.prompt_variant_ids), (GeoEngineSurface, surfaces)):
        db.execute(
            update(model)
            .where(model.id.in_(ids), model.first_referenced_at.is_(None))
            .values(
                first_referenced_at=func.clock_timestamp(),
                updated_at=func.clock_timestamp(),
                revision=model.revision + 1,
            )
            .execution_options(synchronize_session=False)
        )


def _create(
    db: Session,
    value: GeoMonitoringPlanConfiguration,
    *,
    plan: GeoMonitoringPlan | None,
    actor: User | None,
    scheduled_for: datetime | None,
    identity: str | None,
    request_id: str | None,
) -> GeoObservationBatch:
    selection = PlanMatrixSelection.from_configuration(value)
    subjects, prompts, profiles = load_matrix_facts(db, [selection])
    switches = GeoRuntimeSwitches(
        settings.environment,
        settings.geo_monitoring_enabled,
        settings.geo_api_collection_enabled,
        settings.geo_browser_collection_enabled,
    )
    matrix = RunMatrixBuilder().build(
        selection, subjects=subjects, prompts=prompts, profiles=profiles, switches=switches
    )
    require_references(matrix.preview())
    require_eligible(matrix.preview())
    _latch_references(db, value, {facts.surface.id for facts in profiles.values()})
    # 锁存也属于配置 revision，必须用锁存后的安全事实冻结。
    _, _, profiles = load_matrix_facts(db, [selection])
    inputs = freeze_inputs(db, value, profiles)
    batch = GeoObservationBatch(
        id=uuid4(),
        plan_id=plan.id if plan else None,
        trigger_type="SCHEDULED" if scheduled_for is not None else "MANUAL",
        scheduled_for=scheduled_for,
        schedule_identity=identity,
        plan_snapshot=GeoBatchPlanSnapshot.model_validate(
            value.model_dump()
            | {
                "schema_version": 1,
                "plan_id": plan.id if plan else None,
                "plan_revision": plan.revision if plan else None,
            }
        ).model_dump(mode="json"),
        rule_snapshot=GeoBatchRuleSnapshot(
            schema_version=1, rule_set_revision=value.rule_set_revision
        ).model_dump(mode="json"),
        requested_run_count=matrix.run_count,
        created_by=actor.id if actor else None,
    )
    db.add(batch)
    db.flush()
    db.execute(
        insert(GeoBatchSubject),
        [
            {"batch_id": batch.id, "subject_id": s.subject_id, "role": s.role}
            for s in value.subjects
        ],
    )
    # 每 prompt/profile 只组装一次；repeat 只复制持久化输入，不重新读取当前配置。
    snapshots = {
        (p, c): inputs.input_for(p, c)
        for p in selection.prompt_variant_ids
        for c in selection.collection_profile_ids
    }
    for cells in batched(matrix.cells(), 250):
        db.execute(
            insert(GeoObservationRun),
            [
                {
                    "id": uuid4(),
                    "batch_id": batch.id,
                    "prompt_variant_id": c.prompt_variant_id,
                    "collection_profile_id": c.collection_profile_id,
                    "repeat_index": c.repeat_index,
                    "input_snapshot": snapshots[c.prompt_variant_id, c.collection_profile_id],
                }
                for c in cells
            ],
        )
    batch.status, batch.revision = "QUEUED", 1
    db.flush()
    db.execute(
        text(
            "SET CONSTRAINTS geo_batch_complete, geo_run_batch_complete, "
            "geo_batch_subjects_complete IMMEDIATE"
        )
    )
    if actor is not None:
        if request_id is None:
            raise ValueError("手工创建必须有 request_id")
        append_audit(
            db,
            AuditEntry(
                actor_id=actor.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_observation_batch.created",
                target_type="GeoObservationBatch",
                target_id=batch.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="GEO 观测批次已创建",
                details={
                    "facts": {
                        "plan_id": str(plan.id) if plan else None,
                        "requested_run_count": matrix.run_count,
                        "trigger_type": "MANUAL",
                    }
                },
            ),
        )
    return batch


def create_manual_batch(
    *,
    db: Session,
    payload: GeoObservationBatchCreate,
    idempotency_key: str,
    actor: User,
    request_id: str,
) -> GeoBatchCreated:
    with command(db, actor) as current, _creation_errors(db):
        identity = manual_identity(current.id, idempotency_key)
        request_hash = _request_hash(payload)
        _lock_identity(db, identity)
        previous = db.get(GeoBatchCreationRequest, identity, populate_existing=True)
        if previous is not None:
            if previous.request_hash != request_hash:
                raise AppError("IDEMPOTENCY_CONFLICT", "此幂等键已用于不同创建请求", 409)
            batch = db.get(GeoObservationBatch, previous.batch_id, populate_existing=True)
            assert batch is not None  # RESTRICT FK 保证回执目标存在。
            result = _receipt(batch)
            db.commit()
            return result
        if isinstance(payload, GeoPlanBatchCreate):
            plan, value = lock_plan(db, payload.plan_id, payload.expected_revision)
            require_mutable(GeoMonitoringPlanStatus(plan.status))
        else:
            plan = None
            value = canonical_configuration(payload.configuration)
            lock_resources(db, [value])
        batch = _create(
            db,
            value,
            plan=plan,
            actor=current,
            scheduled_for=None,
            identity=None,
            request_id=request_id,
        )
        db.add(
            GeoBatchCreationRequest(
                identity_hash=identity, request_hash=request_hash, batch_id=batch.id
            )
        )
        result = _receipt(batch)
        db.commit()
        return result


def create_scheduled_batch(
    *,
    db: Session,
    plan_id: UUID,
    scheduled_for: datetime,
) -> GeoBatchCreated:
    """内部调度调用边界；不计算窗口，不对 HTTP 开放系统权限。"""
    try:
        with _creation_errors(db):
            db.autoflush = False
            if db.connection().get_isolation_level() != "READ COMMITTED":
                raise ValueError("批次创建要求 READ COMMITTED")
            identity = schedule_identity(plan_id, scheduled_for)
            _lock_identity(db, identity)
            previous = db.scalar(
                select(GeoObservationBatch)
                .where(
                    GeoObservationBatch.plan_id == plan_id,
                    GeoObservationBatch.scheduled_for == scheduled_for,
                )
                .execution_options(populate_existing=True)
            )
            if previous is not None:
                result = _receipt(previous)
                db.commit()
                return result
            initial = db.get(GeoMonitoringPlan, plan_id, populate_existing=True)
            if initial is None:
                raise not_found("监测计划")
            plan, value = lock_plan(db, plan_id, initial.revision)
            if plan.status != "ACTIVE" or value.schedule_kind != "CRON":
                raise AppError("INVALID_STATE_TRANSITION", "调度只允许活动 CRON 计划", 409)
            batch = _create(
                db,
                value,
                plan=plan,
                actor=None,
                scheduled_for=scheduled_for.astimezone(UTC),
                identity=identity,
                request_id=None,
            )
            result = _receipt(batch)
            db.commit()
            return result
    except Exception:
        db.rollback()
        raise


@contextmanager
def _creation_errors(db: Session) -> Iterator[None]:
    try:
        yield
    except IntegrityError as error:
        pair = (
            getattr(error.orig, "sqlstate", None),
            getattr(getattr(error.orig, "diag", None), "constraint_name", None),
        )
        db.rollback()
        if pair in {
            ("23505", "uq_geo_batches_schedule_window"),
            ("23505", "uq_geo_batches_schedule_identity"),
        }:
            raise AppError("GEO_SCHEDULE_WINDOW_EXISTS", "该计划时间窗口已有批次", 409) from error
        if pair == ("23505", "pk_geo_batch_creation_requests"):
            raise AppError("IDEMPOTENCY_CONFLICT", "创建身份已被其他请求使用", 409) from error
        raise
