"""704跨域行动协调：目标领域锁→Opportunity CAS→不可变回执/审计，一次提交。"""

import json
import re
from dataclasses import dataclass
from hashlib import sha256
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.geo_opportunities import GeoOpportunity, GeoOpportunityAction, GeoOpportunitySource
from app.models.geo_runs import GeoObservationRun
from app.models.identity import User
from app.schemas.content import ContentTaskCreate
from app.schemas.geo_opportunities import (
    GeoOpportunityActionType as ActionType,
)
from app.schemas.geo_opportunities import (
    GeoOpportunitySourceSnapshot,
    GeoOpportunityTriggerSnapshot,
)
from app.schemas.geo_opportunities import (
    GeoOpportunityStatus as Status,
)
from app.schemas.geo_opportunity_actions import (
    GeoOpportunityActionSourceSnapshot,
    GeoOpportunityContentTaskRequest,
    GeoOpportunityCreateRepairRequest,
    GeoOpportunityFactRevisionRequest,
    GeoOpportunityLinkIssueRequest,
    GeoOpportunityOpenIssueRequest,
)
from app.schemas.geo_opportunity_workbench import GeoOpportunityActionResult
from app.schemas.geo_rules import GeoRuleCode
from app.schemas.geo_runs import GeoRunInputSnapshot
from app.schemas.publication import PublishedContentIssueCreate, PublishedContentRepairTaskCreate
from app.services import content_planning, product_facts, publication
from app.services.geo_opportunity_action_views import action_records
from app.services.geo_opportunity_policy import action_types, assert_transition
from app.services.geo_plan_locks import command

type ActionRequest = (
    GeoOpportunityFactRevisionRequest
    | GeoOpportunityContentTaskRequest
    | GeoOpportunityOpenIssueRequest
    | GeoOpportunityLinkIssueRequest
    | GeoOpportunityCreateRepairRequest
)


@dataclass(frozen=True)
class Target:
    kind: str
    id: UUID
    status: str
    product_id: UUID
    topic_id: UUID | None
    fact_id: UUID | None = None
    platform_id: UUID | None = None
    article_id: UUID | None = None
    issue_id: UUID | None = None


def _check(
    opportunity: GeoOpportunity, payload: ActionRequest, kind: ActionType, actor: User
) -> None:
    if opportunity.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "机会已被其他请求修改，请刷新后重试", 409)
    if kind not in action_types(
        Status(opportunity.status), GeoRuleCode(opportunity.rule_code), actor
    ):
        raise AppError("INVALID_STATE_TRANSITION", "机会当前状态或类型不允许此行动", 409)


def _product_scope(db: Session, opportunity: GeoOpportunity, product_id: UUID) -> None:
    """只能选择保存来源的自有产品；不按当前名称或客户端归属声明匹配。"""
    frozen = [
        GeoRunInputSnapshot.model_validate(s)
        for s in db.scalars(
            select(GeoObservationRun.input_snapshot)
            .join(GeoOpportunitySource, GeoOpportunitySource.run_id == GeoObservationRun.id)
            .where(GeoOpportunitySource.opportunity_id == opportunity.id)
        )
    ]
    subjects = [s for run in frozen for s in run.subjects]
    scoped = [
        s for s in subjects if s.id == opportunity.subject_id and s.subject_type == "OWN_PRODUCT"
    ]
    eligible = (
        any(s.product_id == product_id for s in scoped)
        if scoped
        else any(s.subject_type == "OWN_PRODUCT" and s.product_id == product_id for s in subjects)
    )
    if not eligible:
        raise AppError("VALIDATION_ERROR", "所选产品不属于机会保存的自有产品来源", 422)


def _target(
    db: Session,
    opportunity: GeoOpportunity,
    kind: ActionType,
    payload: ActionRequest,
    actor: User,
    request_id: str,
    key_hash: str,
) -> Target:
    # 先取原领域锁，最后才锁机会；评估器采用Product→Opportunity，反向会死锁。
    if kind == ActionType.CONTENT_TASK and isinstance(payload, GeoOpportunityContentTaskRequest):
        _product_scope(db, opportunity, payload.product_id)
        task = content_planning.create_content_task(
            db=db,
            payload=ContentTaskCreate(
                product_id=payload.product_id,
                fact_version_id=payload.fact_version_id,
                platform_profile_id=payload.platform_profile_id,
            ),
            actor=actor,
            request_id=request_id,
            idempotency_key="geo704:" + sha256(f"{actor.id}:{key_hash}".encode()).hexdigest(),
            query_topic_id=opportunity.query_topic_id,
            commit=False,
        )
        return Target(
            "ContentTask",
            task.id,
            task.status,
            task.product_id,
            task.query_topic_id,
            task.fact_version_id,
            task.platform_profile_id,
        )
    if kind == ActionType.FACT_REVISION and isinstance(payload, GeoOpportunityFactRevisionRequest):
        _product_scope(db, opportunity, payload.product_id)
        context = product_facts.start_fact_revision_context(db=db, product_id=payload.product_id)
        return Target(
            "Product",
            payload.product_id,
            context.product.workflow_stage,
            payload.product_id,
            opportunity.query_topic_id,
        )
    if kind != ActionType.PUBLICATION_REPAIR:
        raise ValueError("行动协议与类型不匹配")
    if isinstance(payload, GeoOpportunityOpenIssueRequest):
        identity = publication.publication_action_identity(
            db=db, article_id=payload.published_article_id
        )
    elif isinstance(payload, (GeoOpportunityLinkIssueRequest, GeoOpportunityCreateRepairRequest)):
        identity = publication.publication_action_identity(
            db=db,
            issue_id=payload.published_content_issue_id,
            expected_issue_revision=payload.expected_issue_revision,
        )
    else:
        raise ValueError("发布修复协议不匹配")
    _product_scope(db, opportunity, identity.product_id)
    if isinstance(payload, GeoOpportunityCreateRepairRequest):
        task = publication.create_repair_task(
            db=db,
            issue_id=payload.published_content_issue_id,
            payload=PublishedContentRepairTaskCreate(
                fact_version_id=payload.fact_version_id,
                expected_issue_revision=payload.expected_issue_revision,
            ),
            actor=actor,
            request_id=request_id,
            commit=False,
        )
        return Target(
            "ContentTask",
            task.id,
            task.status,
            task.product_id,
            task.query_topic_id,
            task.fact_version_id,
            task.platform_profile_id,
            identity.published_article_id,
            identity.published_content_issue_id,
        )
    issue_id = identity.published_content_issue_id
    if isinstance(payload, GeoOpportunityOpenIssueRequest):
        issue = publication.open_published_content_issue(
            db=db,
            article_id=payload.published_article_id,
            payload=PublishedContentIssueCreate(kind=payload.kind, description=payload.description),
            actor=actor,
            request_id=request_id,
            commit=False,
        )
        issue_id = issue.id
    assert issue_id is not None
    return Target(
        "PublishedContentIssue",
        issue_id,
        "OPEN",
        identity.product_id,
        identity.query_topic_id,
        identity.fact_version_id,
        identity.platform_profile_id,
        identity.published_article_id,
        issue_id,
    )


def link_action(
    db: Session,
    opportunity_id: UUID,
    payload: ActionRequest,
    *,
    kind: ActionType,
    actor: User,
    request_id: str,
    idempotency_key: str,
) -> GeoOpportunityActionResult:
    """同键同载荷重放原回执；后续目标完成或关闭机会不会修改历史行动。"""
    if re.fullmatch(r"[\x21-\x7e]{8,128}", idempotency_key) is None:
        raise AppError("VALIDATION_ERROR", "幂等键必须为8至128个可打印ASCII非空白字符", 422)
    key_hash = sha256(idempotency_key.encode()).hexdigest()
    request_hash = sha256(
        json.dumps(
            [kind.value, str(opportunity_id), payload.model_dump(mode="json")],
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode()
    ).hexdigest()
    with command(db, actor) as current:
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": f"geo-action:{current.id}:{key_hash}"},
        )
        existing = db.scalar(
            select(GeoOpportunityAction).where(
                GeoOpportunityAction.created_by == current.id,
                GeoOpportunityAction.request_key_sha256 == key_hash,
            )
        )
        if existing is not None:
            if existing.request_sha256 != request_hash:
                raise AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一机会行动请求", 409)
            assert existing.opportunity_revision_after is not None
            result = GeoOpportunityActionResult(
                action=action_records(db, [existing])[0],
                opportunity_revision=existing.opportunity_revision_after,
                replayed=True,
            )
            db.commit()
            return result
        initial = db.scalar(
            select(GeoOpportunity)
            .where(GeoOpportunity.id == opportunity_id)
            .execution_options(populate_existing=True)
        )
        if initial is None:
            raise not_found("GEO机会")
        _check(initial, payload, kind, current)
        target = _target(db, initial, kind, payload, current, request_id, key_hash)
        opportunity = db.scalar(
            select(GeoOpportunity)
            .where(GeoOpportunity.id == opportunity_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if opportunity is None:
            raise not_found("GEO机会")
        _check(opportunity, payload, kind, current)
        sources = [
            GeoOpportunitySourceSnapshot.model_validate(s)
            for s in db.scalars(
                select(GeoOpportunitySource)
                .where(GeoOpportunitySource.opportunity_id == opportunity_id)
                .order_by(GeoOpportunitySource.id)
            )
        ]
        snapshot = GeoOpportunityActionSourceSnapshot(
            schema_version=1,
            opportunity_id=opportunity_id,
            opportunity_revision=opportunity.revision,
            trigger_snapshot=GeoOpportunityTriggerSnapshot.model_validate(
                opportunity.trigger_snapshot
            ),
            sources=sources,
            product_id=target.product_id,
            query_topic_id=target.topic_id,
            fact_version_id=target.fact_id,
            platform_profile_id=target.platform_id,
            published_article_id=target.article_id,
            published_content_issue_id=target.issue_id,
            request_id=request_id,
        )
        if opportunity.status == Status.ACKNOWLEDGED:
            assert_transition(Status.ACKNOWLEDGED, Status.IN_PROGRESS)
            opportunity.status = Status.IN_PROGRESS
        opportunity.revision += 1
        # 先flush机会的CAS结果，INSERT guard验证同事务中的确切来源/版本/目标。
        db.flush()
        action = GeoOpportunityAction(
            opportunity_id=opportunity.id,
            action_type=kind.value,
            target_type=target.kind,
            target_id=target.id,
            status_snapshot=target.status,
            created_by=current.id,
            source_snapshot=snapshot.model_dump(mode="json"),
            request_key_sha256=key_hash,
            request_sha256=request_hash,
            opportunity_revision_after=opportunity.revision,
        )
        db.add(action)
        db.flush()
        append_audit(
            db,
            AuditEntry(
                actor_id=current.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_opportunity.action_linked",
                target_type="GeoOpportunity",
                target_id=opportunity.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="机会行动已关联，来源证据保留",
                details={
                    "facts": {
                        "action_id": str(action.id),
                        "action_type": kind.value,
                        "target_type": target.kind,
                        "target_id": str(target.id),
                        "revision": opportunity.revision,
                        "status": opportunity.status,
                    }
                },
            ),
        )
        db.flush()
        result = GeoOpportunityActionResult(
            action=action_records(db, [action])[0],
            opportunity_revision=opportunity.revision,
            replayed=False,
        )
        db.commit()
        return result
