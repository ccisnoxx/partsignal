"""显式追加采集尝试；原终态、输入和证据不修改，提交后才投递稳定 ID。"""

from copy import deepcopy
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.collectors.contracts import CollectionRequest
from app.collectors.errors import CollectorError
from app.collectors.registry import collector_registry
from app.config import settings
from app.errors import AppError, not_found
from app.models.geo_runs import GeoObservationRun
from app.models.identity import User
from app.schemas.geo_run_retry import GeoRunRetryCreated, GeoRunRetryRequest
from app.schemas.geo_runs import GeoRunInputSnapshot
from app.services.geo_collection_execution import lock_configuration
from app.services.geo_collection_profiles import load_profile_facts
from app.services.geo_dispatch import dispatch_created_batch
from app.services.geo_plan_locks import command
from app.services.geo_run_lifecycle import database_now, lock_run, refresh_batch, run_state
from app.services.geo_run_policy import require_retryable


def retry_collection_run(
    db: Session,
    *,
    run_id: UUID,
    payload: GeoRunRetryRequest,
    actor: User,
    request_id: str,
) -> GeoRunRetryCreated:
    with command(db, actor) as current:
        initial = db.get(GeoObservationRun, run_id)
        if initial is None:
            raise not_found("GEO 运行")
        snapshot = GeoRunInputSnapshot.model_validate(initial.input_snapshot)
        request = CollectionRequest.from_snapshot(
            run_id,
            snapshot,
            timeout_seconds=120,
            max_response_bytes=2 * 1024 * 1024,
            budget_remaining=None,
        )
        try:
            lock_configuration(db, request)
        except CollectorError:
            raise AppError("GEO_PLAN_PROFILE_INELIGIBLE", "当前配置不具备采集资格", 422) from None
        locked = lock_run(db, run_id)
        assert locked is not None
        batch, previous = locked
        if previous.revision != payload.expected_revision:
            raise AppError("REVISION_CONFLICT", "运行已变更，请重新读取", 409)
        require_retryable(run_state(db, previous))
        facts = load_profile_facts(db, [previous.collection_profile_id]).get(
            previous.collection_profile_id
        )
        if facts is None:
            raise not_found("GEO 采集配置")
        frozen = request.profile
        if not facts.matches_frozen_profile(
            revision=frozen.revision,
            engine_surface_id=frozen.engine_surface_id,
            collection_mode=frozen.collection_mode,
            adapter_key=frozen.adapter_key,
            adapter_version=frozen.adapter_version,
            ai_channel_id=frozen.ai_channel_id,
            ai_model_id=frozen.ai_model_id,
            registry=collector_registry,
        ):
            raise AppError("GEO_PROFILE_CHANGED", "当前采集配置与冻结输入不一致，请创建新批次", 409)
        eligibility = facts.eligibility(registry=collector_registry, configuration=settings)
        if not eligibility.eligible:
            raise AppError(
                "GEO_PLAN_PROFILE_INELIGIBLE",
                "当前配置不具备采集资格",
                422,
                details={
                    "blockers": [
                        {"code": b.code.value, "field": b.field} for b in eligibility.blockers
                    ]
                },
            )
        successor = GeoObservationRun(
            batch_id=previous.batch_id,
            prompt_variant_id=previous.prompt_variant_id,
            collection_profile_id=previous.collection_profile_id,
            repeat_index=previous.repeat_index,
            attempt_no=previous.attempt_no + 1,
            previous_attempt_id=previous.id,
            input_snapshot=deepcopy(previous.input_snapshot),
        )
        db.add(successor)
        try:
            db.flush()
        except IntegrityError as error:
            if (
                getattr(error.orig, "sqlstate", None) == "23505"
                and getattr(getattr(error.orig, "diag", None), "constraint_name", None)
                == "uq_geo_runs_successor"
            ):
                raise AppError(
                    "GEO_RUN_HAS_SUCCESSOR", "该尝试已有后继，请查看最新尝试", 409
                ) from error
            raise
        refresh_batch(db, batch, database_now(db))
        append_audit(
            db,
            AuditEntry(
                actor_id=current.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_observation_run.retried",
                target_type="GeoObservationRun",
                target_id=successor.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已显式创建新的采集尝试",
                details={
                    "facts": {
                        "run_id": str(successor.id),
                        "previous_attempt_id": str(previous.id),
                        "attempt_no": successor.attempt_no,
                    }
                },
            ),
        )
        receipt = GeoRunRetryCreated(
            run_id=successor.id,
            batch_id=successor.batch_id,
            previous_attempt_id=previous.id,
            attempt_no=successor.attempt_no,
            created_at=successor.created_at,
        )
        db.commit()
    dispatch_created_batch(db, receipt.batch_id)
    return receipt
