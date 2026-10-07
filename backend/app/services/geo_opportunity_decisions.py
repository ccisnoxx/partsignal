"""显式处理命令：User→有序Batch→有序Run→Opportunity，锁内裁决后原子保存。"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.geo_opportunities import GeoOpportunity
from app.models.geo_opportunity_decisions import GeoOpportunityDecision as Decision
from app.models.geo_runs import GeoObservationBatch as Batch
from app.models.geo_runs import GeoObservationRun as Run
from app.models.identity import User
from app.schemas.geo_opportunities import GeoOpportunityStatus as Status
from app.schemas.geo_retest_comparisons import (
    GeoOpportunityContinueRequest,
    GeoOpportunityDecision,
    GeoOpportunityDecisionResult,
    GeoOpportunityResolveRequest,
)
from app.schemas.geo_retest_comparisons import (
    GeoOpportunityDecisionKind as Kind,
)
from app.services.geo_opportunity_policy import assert_transition
from app.services.geo_opportunity_queries import command_item
from app.services.geo_plan_locks import command
from app.services.geo_retest_comparison_inputs import selected_baseline
from app.services.geo_retest_comparisons import comparison
from app.services.geo_run_lifecycle import database_now


def _lock_evidence(db: Session, opportunity_id: UUID, retest_batch_id: UUID) -> None:
    baseline, _ = selected_baseline(db, opportunity_id, retest_batch_id)
    batch_ids = {baseline.baseline_batch_id, retest_batch_id}
    # 非键更新锁足以阻断生命周期/新attempt，同时允许705回执的FK身份读取。
    # FOR UPDATE 会与先持 Opportunity 再引用旧 Batch 的Planner形成反向FK锁等待。
    db.execute(
        select(Batch.id)
        .where(Batch.id.in_(batch_ids))
        .order_by(Batch.id)
        .with_for_update(key_share=True)
    ).all()
    db.execute(
        select(Run.id)
        .where(Run.batch_id.in_(batch_ids))
        .order_by(Run.id)
        .with_for_update(key_share=True)
    ).all()


def _decide(
    db: Session,
    opportunity_id: UUID,
    payload: GeoOpportunityResolveRequest | GeoOpportunityContinueRequest,
    *,
    kind: Kind,
    actor: User,
    request_id: str,
) -> GeoOpportunityDecisionResult:
    with command(db, actor) as current:
        if payload.retest_batch_id is not None:
            _lock_evidence(db, opportunity_id, payload.retest_batch_id)
        opportunity = db.scalar(
            select(GeoOpportunity)
            .where(GeoOpportunity.id == opportunity_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if opportunity is None:
            raise not_found("GEO机会")
        if opportunity.revision != payload.expected_revision:
            raise AppError("REVISION_CONFLICT", "机会已被其他请求修改，请刷新后重新确认", 409)
        if opportunity.status != Status.IN_PROGRESS:
            raise AppError("INVALID_STATE_TRANSITION", "只有进行中的机会可以解决或继续跟进", 409)
        if not payload.resolution_code.strip() or not payload.resolution_comment.strip():
            raise AppError("VALIDATION_ERROR", "处理机会必须填写非空原因代码和说明", 422)
        evidence = (
            comparison(db, opportunity_id, payload.retest_batch_id)
            if payload.retest_batch_id
            else None
        )
        if evidence is not None and evidence.fingerprint != payload.comparison_fingerprint:
            raise AppError("GEO_COMPARISON_STALE", "复测比较证据已变更，请重新读取并确认", 409)
        if kind == Kind.RETEST_RESOLVE and (
            evidence is None or evidence.recovery.status != "RECOVERED"
        ):
            raise AppError(
                "GEO_RETEST_NOT_RECOVERED",
                "所选复测尚未满足冻结恢复条件",
                409,
                {"recovery_status": evidence.recovery.status if evidence else "UNAVAILABLE"},
            )
        before = opportunity.revision
        if kind != Kind.CONTINUE:
            assert_transition(
                Status(opportunity.status), Status.RESOLVED, reason=payload.resolution_comment
            )
            opportunity.status = Status.RESOLVED
            opportunity.resolved_at = max(
                database_now(db),
                opportunity.created_at,
                opportunity.acknowledged_at or opportunity.created_at,
            )
            opportunity.resolved_by = current.id
            opportunity.resolution_code = payload.resolution_code.strip()
            opportunity.resolution_comment = payload.resolution_comment.strip()
        opportunity.revision += 1
        db.flush()
        decision = Decision(
            opportunity_id=opportunity.id,
            decision=kind.value,
            reason_code=payload.resolution_code.strip(),
            reason_comment=payload.resolution_comment.strip(),
            revision_before=before,
            revision_after=opportunity.revision,
            created_by=current.id,
            baseline_id=evidence.baseline_id if evidence else None,
            retest_batch_id=evidence.retest_batch_id if evidence else None,
            comparison_fingerprint=evidence.fingerprint if evidence else None,
            comparison_snapshot=evidence.model_dump(mode="json") if evidence else None,
        )
        db.add(decision)
        db.flush()
        db.refresh(decision)
        append_audit(
            db,
            AuditEntry(
                actor_id=current.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_opportunity.continued"
                if kind == Kind.CONTINUE
                else "geo_opportunity.resolved",
                target_type="GeoOpportunity",
                target_id=opportunity.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已记录继续跟进依据"
                if kind == Kind.CONTINUE
                else "已显式解决机会，证据保留",
                details={
                    "facts": {
                        "decision_id": str(decision.id),
                        "decision": kind.value,
                        "revision": opportunity.revision,
                        "status": opportunity.status,
                    }
                },
            ),
        )
        result = GeoOpportunityDecisionResult(
            opportunity=command_item(db, opportunity.id, current),
            decision=GeoOpportunityDecision.model_validate(decision),
        )
        db.commit()
        return result


def resolve(
    db: Session,
    opportunity_id: UUID,
    payload: GeoOpportunityResolveRequest,
    *,
    actor: User,
    request_id: str,
) -> GeoOpportunityDecisionResult:
    kind = Kind.RETEST_RESOLVE if payload.resolution_method == "RETEST" else Kind.MANUAL_RESOLVE
    return _decide(db, opportunity_id, payload, kind=kind, actor=actor, request_id=request_id)


def continue_followup(
    db: Session,
    opportunity_id: UUID,
    payload: GeoOpportunityContinueRequest,
    *,
    actor: User,
    request_id: str,
) -> GeoOpportunityDecisionResult:
    return _decide(
        db, opportunity_id, payload, kind=Kind.CONTINUE, actor=actor, request_id=request_id
    )
