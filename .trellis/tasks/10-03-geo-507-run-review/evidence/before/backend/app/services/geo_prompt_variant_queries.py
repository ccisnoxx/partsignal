"""问题变体的一致读模型；当前主题摘要不代表历史运行快照。"""

from typing import Literal
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.deps import DbSession
from app.errors import not_found
from app.geo_prompt_variants import GeoPromptMentionMode, GeoPromptPriority, normalize_prompt_text
from app.models.configuration import QueryTopic
from app.models.geo_monitoring_plans import GeoMonitoringPlanPrompt
from app.models.geo_prompt_variants import GeoPromptVariant
from app.schemas.configuration import IntentType
from app.schemas.geo_prompt_variants import (
    GeoPromptRunEntry,
    GeoPromptTopicSummary,
    GeoPromptVariantAction,
    GeoPromptVariantDeletion,
    GeoPromptVariantListPage,
    GeoPromptVariantOut,
    GeoPromptVariantPrimaryTask,
    GeoPromptVariantWorkflowStage,
)


def read_snapshot(db: DbSession) -> None:
    """在认证前建立 RR，认证 last_seen_at 不得令读请求产生隐式写入。"""
    db.autoflush = False
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})


def variant_out(
    variant: GeoPromptVariant, topic: QueryTopic, *, plan_referenced: bool = False
) -> GeoPromptVariantOut:
    if variant.query_topic_id != topic.id:
        raise ValueError("变体与主题摘要必须属于同一资源")
    referenced = variant.first_referenced_at is not None
    actions = [GeoPromptVariantAction.COPY]
    if not referenced:
        actions.append(GeoPromptVariantAction.UPDATE)
        if not plan_referenced:
            actions.append(GeoPromptVariantAction.DELETE)
    if variant.is_active:
        actions.append(GeoPromptVariantAction.DISABLE)
    elif not referenced:
        actions.append(GeoPromptVariantAction.ENABLE)
    fields = {
        name: getattr(variant, name)
        for name in (
            "id",
            "query_topic_id",
            "prompt_text",
            "mention_mode",
            "language_code",
            "region_code",
            "priority",
            "is_active",
            "revision",
            "first_referenced_at",
            "created_by",
            "created_at",
            "updated_at",
        )
    }
    return GeoPromptVariantOut.model_validate(
        fields
        | {
            "query_topic": GeoPromptTopicSummary(
                id=topic.id,
                canonical_question=topic.canonical_question,
                intent_type=IntentType(topic.intent_type),
                revision=topic.revision,
            ),
            "workflow_stage": GeoPromptVariantWorkflowStage.REFERENCED
            if referenced
            else (
                GeoPromptVariantWorkflowStage.ACTIVE
                if variant.is_active
                else GeoPromptVariantWorkflowStage.DISABLED
            ),
            "primary_task": GeoPromptVariantPrimaryTask.VIEW_DETAILS
            if referenced
            else GeoPromptVariantPrimaryTask.EDIT,
            "available_actions": actions,
            "deletion": GeoPromptVariantDeletion(
                blockers=(["HISTORY_REFERENCE"] if referenced else [])
                + (["MONITORING_PLAN"] if plan_referenced else [])
            ),
            "run_entry": GeoPromptRunEntry(available=False, reason_code="NOT_IMPLEMENTED"),
        }
    )


def plan_prompt_referenced(db: Session, variant_id: UUID) -> bool:
    return (
        db.scalar(
            select(GeoMonitoringPlanPrompt.plan_id)
            .where(GeoMonitoringPlanPrompt.prompt_variant_id == variant_id)
            .limit(1)
        )
        is not None
    )


def get_variant(db: Session, variant_id: UUID) -> GeoPromptVariantOut:
    row = db.execute(
        select(GeoPromptVariant, QueryTopic)
        .join(QueryTopic, QueryTopic.id == GeoPromptVariant.query_topic_id)
        .where(GeoPromptVariant.id == variant_id)
        .execution_options(populate_existing=True)
    ).one_or_none()
    if row is None:
        raise not_found("问题变体")
    return variant_out(*row, plan_referenced=plan_prompt_referenced(db, variant_id))


def list_variants(
    db: Session,
    *,
    q: str | None,
    query_topic_id: UUID | None,
    intent_type: IntentType | None,
    mention_mode: GeoPromptMentionMode | None,
    language_code: str | None,
    region_code: str | None,
    priority: GeoPromptPriority | None,
    is_active: bool | None,
    sort: Literal["UPDATED_DESC", "TEXT_ASC"],
    page: int,
    page_size: Literal[10, 20, 50],
) -> GeoPromptVariantListPage:
    query = select(GeoPromptVariant, QueryTopic).join(
        QueryTopic, QueryTopic.id == GeoPromptVariant.query_topic_id
    )
    if q is not None and q.strip():
        text = normalize_prompt_text(q)
        query = query.where(
            or_(
                GeoPromptVariant.prompt_text.contains(text, autoescape=True),
                func.geo_normalize_prompt_text(QueryTopic.canonical_question).contains(
                    text,
                    autoescape=True,
                ),
            )
        )
    if intent_type is not None:
        query = query.where(QueryTopic.intent_type == intent_type)
    for field, value in {
        "query_topic_id": query_topic_id,
        "mention_mode": mention_mode,
        "language_code": language_code.lower() if language_code else None,
        "region_code": region_code.upper() if region_code else None,
        "priority": priority,
        "is_active": is_active,
    }.items():
        if value is not None:
            query = query.where(getattr(GeoPromptVariant, field) == value)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    order = (
        GeoPromptVariant.updated_at.desc()
        if sort == "UPDATED_DESC"
        else (GeoPromptVariant.prompt_text.asc())
    )
    rows = db.execute(
        query.order_by(order, GeoPromptVariant.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .execution_options(populate_existing=True)
    ).all()
    plan_ids = (
        set(
            db.scalars(
                select(GeoMonitoringPlanPrompt.prompt_variant_id).where(
                    GeoMonitoringPlanPrompt.prompt_variant_id.in_([row[0].id for row in rows])
                )
            )
        )
        if rows
        else set()
    )
    return GeoPromptVariantListPage(
        items=[variant_out(*row, plan_referenced=row[0].id in plan_ids) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )
