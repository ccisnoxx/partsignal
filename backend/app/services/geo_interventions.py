"""Slice 4A：GEO 干预编排与归因命令服务（CAS 乐观锁 + 全局统一锁序 + 低敏审计）。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.campaign import ContentCampaign
from app.models.cost_accounting import OperatingCostEntry
from app.models.geo_interventions import GeoIntervention
from app.models.geo_opportunities import GeoOpportunity
from app.models.geo_opportunity_decisions import GeoOpportunityDecision
from app.models.geo_retests import GeoRetestBaseline
from app.models.identity import User
from app.schemas.common import AccountType
from app.schemas.geo_interventions import (
    GeoInterventionCancelRequest,
    GeoInterventionConcludeRequest,
    GeoInterventionCreate,
    GeoInterventionOut,
    GeoInterventionUpdate,
)
from app.services.current_actor import current_actor_command
from app.services.geo_intervention_queries import (
    TERMINAL_INTERVENTION_STATUSES,
    get_geo_intervention_detail,
    list_geo_interventions,
    project_geo_intervention,
)
from app.services.work_assignments import lock_actor_and_optional_assignee

__all__ = [
    "cancel_geo_intervention",
    "conclude_geo_intervention",
    "create_geo_intervention",
    "get_geo_intervention_detail",
    "list_geo_interventions",
    "update_geo_intervention",
]


def _assert_assignee_active(assignee_id: uuid.UUID | None, assignee: User | None) -> None:
    if assignee_id is None:
        return
    if assignee is None:
        raise not_found("负责人")
    if not assignee.is_active:
        raise AppError("ASSIGNEE_INACTIVE", "停用账号不能作为 GEO 干预负责人", 409)


def _lock_parent_aggregates(
    db: Session,
    *,
    campaign_ids: set[uuid.UUID],
    target_campaign_id: uuid.UUID | None,
    opportunity_id: uuid.UUID,
    require_active_target_campaign: bool,
) -> None:
    """严格按 ContentCampaign(UUID升序, KEY SHARE) -> GeoOpportunity(KEY SHARE) 锁父聚合。"""
    if campaign_ids:
        ordered_ids = sorted(campaign_ids)
        locked = {
            camp.id: camp
            for camp in db.scalars(
                select(ContentCampaign)
                .where(ContentCampaign.id.in_(ordered_ids))
                .order_by(ContentCampaign.id)
                .with_for_update(key_share=True)
                .execution_options(populate_existing=True)
            )
        }
        if target_campaign_id is not None:
            target = locked.get(target_campaign_id)
            if target is None:
                raise not_found("内容活动")
            if require_active_target_campaign and target.status == "ARCHIVED":
                raise AppError("INVALID_STATE_TRANSITION", "已归档内容活动不能关联新 GEO 干预", 409)

    opportunity = db.scalar(
        select(GeoOpportunity)
        .where(GeoOpportunity.id == opportunity_id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
    if opportunity is None:
        raise not_found("GEO 机会")


def _validate_evidence_links(
    db: Session,
    *,
    opportunity_id: uuid.UUID,
    baseline_id: uuid.UUID | None,
    decision_id: uuid.UUID | None,
) -> None:
    if baseline_id is not None:
        baseline = db.get(GeoRetestBaseline, baseline_id)
        if baseline is None or baseline.opportunity_id != opportunity_id:
            raise AppError("GEO_BASELINE_MISMATCH", "复测基线不存在或不属于该 GEO 机会", 409)
    if decision_id is not None:
        decision = db.get(GeoOpportunityDecision, decision_id)
        if decision is None or decision.opportunity_id != opportunity_id:
            raise AppError("GEO_DECISION_MISMATCH", "处理结论不存在或不属于该 GEO 机会", 409)


def create_geo_intervention(
    *,
    db: Session,
    payload: GeoInterventionCreate,
    actor: User,
    request_id: str,
) -> GeoInterventionOut:
    # 锁序：User(UUID升序, SHARE) -> Session -> ContentCampaign(KEY SHARE) -> GeoOpportunity
    with lock_actor_and_optional_assignee(
        db, actor, payload.assignee_id, require_active_assignee=False
    ) as (live_actor, target_assignee):
        _assert_assignee_active(payload.assignee_id, target_assignee)
        _lock_parent_aggregates(
            db,
            campaign_ids={payload.campaign_id} if payload.campaign_id is not None else set(),
            target_campaign_id=payload.campaign_id,
            opportunity_id=payload.opportunity_id,
            require_active_target_campaign=True,
        )
        _validate_evidence_links(
            db,
            opportunity_id=payload.opportunity_id,
            baseline_id=payload.baseline_id,
            decision_id=None,
        )
        row = GeoIntervention(
            opportunity_id=payload.opportunity_id,
            campaign_id=payload.campaign_id,
            title=payload.title,
            hypothesis=payload.hypothesis,
            planned_action_type=payload.planned_action_type,
            target_metrics=payload.target_metrics.model_dump(exclude_none=True),
            status="PLANNED",
            causal_claim="NOT_ESTABLISHED",
            baseline_id=payload.baseline_id,
            assignee_id=payload.assignee_id,
            intervened_at=payload.intervened_at,
            retest_window_start=payload.retest_window_start,
            retest_window_end=payload.retest_window_end,
            created_by=live_actor.id,
            updated_by=live_actor.id,
        )
        db.add(row)
        db.flush()
        append_audit(
            db,
            AuditEntry(
                actor_id=live_actor.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_intervention.created",
                target_type="GeoIntervention",
                target_id=row.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="GEO 干预归因记录已创建",
                details={
                    "facts": {
                        "opportunity_id": str(row.opportunity_id),
                        "campaign_id": str(row.campaign_id) if row.campaign_id else None,
                        "status": row.status,
                        "revision": row.revision,
                    }
                },
            ),
        )
        db.commit()
    return project_geo_intervention(db, row)


def update_geo_intervention(
    *,
    db: Session,
    intervention_id: uuid.UUID,
    payload: GeoInterventionUpdate,
    actor: User,
    request_id: str,
) -> GeoInterventionOut:
    # 锁序：User(UUID升序, SHARE) -> Session -> ContentCampaign(KEY SHARE)
    # -> GeoOpportunity(KEY SHARE) -> GeoIntervention(FOR UPDATE)
    with lock_actor_and_optional_assignee(
        db, actor, payload.assignee_id, require_active_assignee=False
    ) as (live_actor, target_assignee):
        _assert_assignee_active(payload.assignee_id, target_assignee)
        pre = db.execute(
            select(GeoIntervention.opportunity_id, GeoIntervention.campaign_id).where(
                GeoIntervention.id == intervention_id
            )
        ).one_or_none()
        if pre is None:
            raise not_found("GEO 干预")
        pre_opp_id, pre_campaign_id = pre

        campaign_ids_to_lock = {
            cid for cid in (pre_campaign_id, payload.campaign_id) if cid is not None
        }
        _lock_parent_aggregates(
            db,
            campaign_ids=campaign_ids_to_lock,
            target_campaign_id=payload.campaign_id,
            opportunity_id=pre_opp_id,
            require_active_target_campaign=(payload.campaign_id != pre_campaign_id),
        )

        row = db.scalar(
            select(GeoIntervention)
            .where(GeoIntervention.id == intervention_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if row is None:
            raise not_found("GEO 干预")
        if row.revision != payload.expected_revision or row.campaign_id != pre_campaign_id:
            raise AppError("REVISION_CONFLICT", "GEO 干预已被其他请求修改", 409)
        if row.status in TERMINAL_INTERVENTION_STATUSES:
            raise AppError("INVALID_STATE_TRANSITION", "终态 GEO 干预不可修改", 409)
        if row.status in {"ACTIVE", "EVALUATING"} and payload.status == "PLANNED":
            raise AppError(
                "INVALID_STATE_TRANSITION",
                "已启动或评估中的 GEO 干预不能回退为计划状态",
                409,
            )

        if payload.campaign_id != row.campaign_id:
            has_cost_entries = bool(
                db.scalar(
                    select(
                        exists().where(OperatingCostEntry.geo_intervention_id == row.id)
                    )
                )
            )
            if has_cost_entries:
                raise AppError(
                    "GEO_INTERVENTION_HAS_COST_ENTRIES",
                    "已登记运营费用台账的 GEO 干预不可变更所属内容活动",
                    409,
                )

        _validate_evidence_links(
            db,
            opportunity_id=row.opportunity_id,
            baseline_id=payload.baseline_id,
            decision_id=payload.decision_id,
        )

        row.campaign_id = payload.campaign_id
        row.title = payload.title
        row.hypothesis = payload.hypothesis
        row.planned_action_type = payload.planned_action_type
        row.status = payload.status
        row.target_metrics = payload.target_metrics.model_dump(exclude_none=True)
        row.baseline_id = payload.baseline_id
        row.decision_id = payload.decision_id
        row.assignee_id = payload.assignee_id
        row.intervened_at = payload.intervened_at
        row.retest_window_start = payload.retest_window_start
        row.retest_window_end = payload.retest_window_end
        row.updated_by = live_actor.id
        row.revision += 1

        append_audit(
            db,
            AuditEntry(
                actor_id=live_actor.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_intervention.updated",
                target_type="GeoIntervention",
                target_id=row.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="GEO 干预归因记录已更新",
                details={
                    "facts": {
                        "opportunity_id": str(row.opportunity_id),
                        "campaign_id": str(row.campaign_id) if row.campaign_id else None,
                        "status": row.status,
                        "revision": row.revision,
                    }
                },
            ),
        )
        db.commit()
    return project_geo_intervention(db, row)


def conclude_geo_intervention(
    *,
    db: Session,
    intervention_id: uuid.UUID,
    payload: GeoInterventionConcludeRequest,
    actor: User,
    request_id: str,
) -> GeoInterventionOut:
    with current_actor_command(
        db, actor, allowed=(AccountType.ADMIN, AccountType.ENGINEER)
    ) as live_actor:
        row = db.scalar(
            select(GeoIntervention)
            .where(GeoIntervention.id == intervention_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if row is None:
            raise not_found("GEO 干预")
        if row.revision != payload.expected_revision:
            raise AppError("REVISION_CONFLICT", "GEO 干预已被其他请求修改", 409)
        if row.status in TERMINAL_INTERVENTION_STATUSES:
            raise AppError("INVALID_STATE_TRANSITION", "终态 GEO 干预不能重复结案", 409)

        effective_decision_id = payload.decision_id or row.decision_id
        if effective_decision_id is not None:
            decision = db.get(GeoOpportunityDecision, effective_decision_id)
            if decision is None or decision.opportunity_id != row.opportunity_id:
                raise AppError("GEO_DECISION_MISMATCH", "处理结论不存在或不属于该 GEO 机会", 409)

        row.decision_id = effective_decision_id
        row.status = "CONCLUDED"
        row.outcome_verdict = payload.outcome_verdict
        row.conclusion_note = payload.conclusion_note
        row.concluded_at = datetime.now(UTC)
        row.updated_by = live_actor.id
        row.revision += 1

        append_audit(
            db,
            AuditEntry(
                actor_id=live_actor.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_intervention.concluded",
                target_type="GeoIntervention",
                target_id=row.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="GEO 干预归因已结案并冻结结论",
                details={
                    "facts": {
                        "opportunity_id": str(row.opportunity_id),
                        "campaign_id": str(row.campaign_id) if row.campaign_id else None,
                        "status": row.status,
                        "outcome_verdict": row.outcome_verdict,
                        "revision": row.revision,
                    }
                },
            ),
        )
        db.commit()
    return project_geo_intervention(db, row)


def cancel_geo_intervention(
    *,
    db: Session,
    intervention_id: uuid.UUID,
    payload: GeoInterventionCancelRequest,
    actor: User,
    request_id: str,
) -> GeoInterventionOut:
    with current_actor_command(
        db, actor, allowed=(AccountType.ADMIN, AccountType.ENGINEER)
    ) as live_actor:
        row = db.scalar(
            select(GeoIntervention)
            .where(GeoIntervention.id == intervention_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if row is None:
            raise not_found("GEO 干预")
        if row.revision != payload.expected_revision:
            raise AppError("REVISION_CONFLICT", "GEO 干预已被其他请求修改", 409)
        if row.status in TERMINAL_INTERVENTION_STATUSES:
            raise AppError("INVALID_STATE_TRANSITION", "终态 GEO 干预不可取消", 409)

        row.status = "CANCELLED"
        row.conclusion_note = payload.reason
        row.updated_by = live_actor.id
        row.revision += 1

        append_audit(
            db,
            AuditEntry(
                actor_id=live_actor.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_intervention.cancelled",
                target_type="GeoIntervention",
                target_id=row.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="GEO 干预已取消",
                details={
                    "facts": {
                        "opportunity_id": str(row.opportunity_id),
                        "campaign_id": str(row.campaign_id) if row.campaign_id else None,
                        "status": row.status,
                        "revision": row.revision,
                    }
                },
            ),
        )
        db.commit()
    return project_geo_intervention(db, row)
