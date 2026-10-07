"""机会确认/驳回的原子命令；User→Opportunity，锁后CAS，无自动重放。"""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.geo_opportunities import GeoOpportunity
from app.models.identity import User
from app.schemas.geo_opportunities import GeoOpportunityStatus as Status
from app.schemas.geo_opportunity_workbench import (
    GeoOpportunityDismissRequest,
    GeoOpportunityListItem,
    GeoOpportunityRevisionRequest,
)
from app.services.geo_opportunity_policy import assert_transition
from app.services.geo_opportunity_queries import command_item
from app.services.geo_plan_locks import command


def _transition(
    db: Session,
    opportunity_id: UUID,
    payload: GeoOpportunityRevisionRequest,
    after: Status,
    *,
    actor: User,
    request_id: str,
) -> GeoOpportunityListItem:
    with command(db, actor) as current_actor:
        opportunity = db.scalar(
            select(GeoOpportunity)
            .where(GeoOpportunity.id == opportunity_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if opportunity is None:
            raise not_found("GEO机会")
        if opportunity.revision != payload.expected_revision:
            raise AppError("REVISION_CONFLICT", "机会已被其他请求修改，请刷新后重试", 409)
        reason = None
        if isinstance(payload, GeoOpportunityDismissRequest):
            reason = payload.resolution_comment
            if not payload.resolution_code.strip() or not reason.strip():
                raise AppError("VALIDATION_ERROR", "驳回必须填写非空原因代码和说明", 422)
        assert_transition(Status(opportunity.status), after, reason=reason)
        now = db.scalar(select(func.clock_timestamp()))
        assert now is not None
        # 处理时间在锁后确定；last_seen_at仍只代表规则评估，首次证据不改。
        now = max(
            now, opportunity.created_at, opportunity.acknowledged_at or opportunity.created_at
        )
        if after == Status.ACKNOWLEDGED:
            opportunity.acknowledged_at = now
            opportunity.acknowledged_by = current_actor.id
        elif isinstance(payload, GeoOpportunityDismissRequest):
            opportunity.resolved_at = now
            opportunity.resolved_by = current_actor.id
            opportunity.resolution_code = payload.resolution_code.strip()
            opportunity.resolution_comment = payload.resolution_comment.strip()
        opportunity.status = after
        opportunity.revision += 1
        append_audit(
            db,
            AuditEntry(
                actor_id=current_actor.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_opportunity.acknowledged"
                if after == Status.ACKNOWLEDGED
                else "geo_opportunity.dismissed",
                target_type="GeoOpportunity",
                target_id=opportunity.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="机会已确认"
                if after == Status.ACKNOWLEDGED
                else "机会已驳回，证据保留",
                details={"facts": {"revision": opportunity.revision, "status": after.value}},
            ),
        )
        db.flush()
        result = command_item(db, opportunity.id, current_actor)
        db.commit()
        return result


def acknowledge(
    db: Session,
    opportunity_id: UUID,
    payload: GeoOpportunityRevisionRequest,
    *,
    actor: User,
    request_id: str,
) -> GeoOpportunityListItem:
    return _transition(
        db, opportunity_id, payload, Status.ACKNOWLEDGED, actor=actor, request_id=request_id
    )


def dismiss(
    db: Session,
    opportunity_id: UUID,
    payload: GeoOpportunityDismissRequest,
    *,
    actor: User,
    request_id: str,
) -> GeoOpportunityListItem:
    return _transition(
        db, opportunity_id, payload, Status.DISMISSED, actor=actor, request_id=request_id
    )
