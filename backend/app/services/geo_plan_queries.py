"""计划完整配置和动作读模型；页内关系与资格事实固定批量读取。"""

from collections.abc import Sequence
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.deps import DbSession
from app.errors import not_found
from app.models.geo_monitoring_plans import (
    GeoMonitoringPlan,
    GeoMonitoringPlanProfile,
    GeoMonitoringPlanPrompt,
    GeoMonitoringPlanSubject,
)
from app.models.geo_runs import GeoObservationBatch
from app.schemas.geo_monitoring_plans import (
    GeoMonitoringPlanConfiguration,
    GeoPlanScheduleKind,
)
from app.schemas.geo_monitoring_plans import GeoMonitoringPlanStatus as Status
from app.schemas.geo_plan_management import (
    GeoMonitoringPlanDetail,
    GeoMonitoringPlanListPage,
    GeoPlanRunEntry,
)
from app.schemas.geo_plan_preview import GeoMonitoringPlanPreview
from app.services.geo_collector_eligibility import GeoRuntimeSwitches
from app.services.geo_plan_policy import projection
from app.services.geo_plans import PlanMatrixSelection, RunMatrixBuilder, load_matrix_facts

CONFIGURATION_FIELDS = (
    "name",
    "description",
    "repeat_count",
    "schedule_kind",
    "cron_expression",
    "timezone",
    "budget_limit",
    "rule_set_revision",
)
METADATA_FIELDS = (
    "id",
    "status",
    "revision",
    "created_by",
    "updated_by",
    "created_at",
    "updated_at",
)


def read_snapshot(db: DbSession) -> None:
    """认证前建立 RR，禁止读取中的身份 heartbeat 隐式写入。"""
    db.autoflush = False
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})


def configurations(
    db: Session, plans: Sequence[GeoMonitoringPlan]
) -> dict[UUID, GeoMonitoringPlanConfiguration]:
    ids = [plan.id for plan in plans]
    if not ids:
        return {}
    subjects: dict[UUID, list[dict[str, object]]] = {identity: [] for identity in ids}
    prompts: dict[UUID, list[UUID]] = {identity: [] for identity in ids}
    profiles: dict[UUID, list[UUID]] = {identity: [] for identity in ids}
    for plan_id, subject_id, role in db.execute(
        select(
            GeoMonitoringPlanSubject.plan_id,
            GeoMonitoringPlanSubject.subject_id,
            GeoMonitoringPlanSubject.role,
        )
        .where(GeoMonitoringPlanSubject.plan_id.in_(ids))
        .order_by(GeoMonitoringPlanSubject.subject_id)
        .execution_options(autoflush=False)
    ):
        subjects[plan_id].append({"subject_id": subject_id, "role": role})
    for plan_id, prompt_id in db.execute(
        select(GeoMonitoringPlanPrompt.plan_id, GeoMonitoringPlanPrompt.prompt_variant_id)
        .where(GeoMonitoringPlanPrompt.plan_id.in_(ids))
        .order_by(GeoMonitoringPlanPrompt.prompt_variant_id)
        .execution_options(autoflush=False)
    ):
        prompts[plan_id].append(prompt_id)
    for plan_id, profile_id in db.execute(
        select(GeoMonitoringPlanProfile.plan_id, GeoMonitoringPlanProfile.collection_profile_id)
        .where(GeoMonitoringPlanProfile.plan_id.in_(ids))
        .order_by(GeoMonitoringPlanProfile.collection_profile_id)
        .execution_options(autoflush=False)
    ):
        profiles[plan_id].append(profile_id)
    return {
        plan.id: GeoMonitoringPlanConfiguration.model_validate(
            {name: getattr(plan, name) for name in CONFIGURATION_FIELDS}
            | {
                "subjects": subjects[plan.id],
                "prompt_variant_ids": prompts[plan.id],
                "collection_profile_ids": profiles[plan.id],
            }
        )
        for plan in plans
    }


def previews(
    db: Session, values: Sequence[GeoMonitoringPlanConfiguration]
) -> list[GeoMonitoringPlanPreview]:
    if not values:
        return []
    selections = [PlanMatrixSelection.from_configuration(value) for value in values]
    subjects, prompts, profiles = load_matrix_facts(db, selections)
    switches = GeoRuntimeSwitches(
        settings.environment,
        settings.geo_monitoring_enabled,
        settings.geo_api_collection_enabled,
        settings.geo_browser_collection_enabled,
    )
    builder = RunMatrixBuilder()
    return [
        builder.build(
            selection, subjects=subjects, prompts=prompts, profiles=profiles, switches=switches
        ).preview()
        for selection in selections
    ]


def plan_detail(
    plan: GeoMonitoringPlan,
    value: GeoMonitoringPlanConfiguration,
    preview: GeoMonitoringPlanPreview,
    batch_count: int = 0,
) -> GeoMonitoringPlanDetail:
    stage, task, actions, deletion = projection(
        Status(plan.status), eligible=not preview.blockers, schedule_kind=value.schedule_kind
    )
    if batch_count:
        actions = [action for action in actions if action != "DELETE"]
        deletion.blockers.append("HAS_BATCH_HISTORY")
    return GeoMonitoringPlanDetail.model_validate(
        value.model_dump()
        | {name: getattr(plan, name) for name in METADATA_FIELDS}
        | {
            "preview": preview,
            "workflow_stage": stage,
            "primary_task": task,
            "available_actions": actions,
            "deletion": deletion,
            "run_entry": GeoPlanRunEntry(
                available=False,
                reason_code="GEO_PLAN_CRON_UNSUPPORTED"
                if value.schedule_kind == GeoPlanScheduleKind.CRON
                else "UI_NOT_IMPLEMENTED",
            ),
        }
    )


def plan_batch_counts(db: Session, ids: Sequence[UUID]) -> dict[UUID, int]:
    if not ids:
        return {}
    return {
        identity: count
        for identity, count in db.execute(
            select(GeoObservationBatch.plan_id, func.count())
            .where(GeoObservationBatch.plan_id.in_(ids))
            .group_by(GeoObservationBatch.plan_id)
        ).tuples()
        if identity is not None
    }


def details(db: Session, plans: Sequence[GeoMonitoringPlan]) -> list[GeoMonitoringPlanDetail]:
    values = configurations(db, plans)
    results = previews(db, list(values.values()))
    counts = plan_batch_counts(db, [plan.id for plan in plans])
    return [
        plan_detail(plan, values[plan.id], preview, counts.get(plan.id, 0))
        for plan, preview in zip(plans, results, strict=True)
    ]


def get_plan(db: Session, plan_id: UUID) -> GeoMonitoringPlanDetail:
    plan = db.scalar(
        select(GeoMonitoringPlan)
        .where(GeoMonitoringPlan.id == plan_id)
        .execution_options(populate_existing=True, autoflush=False)
    )
    if plan is None:
        raise not_found("监测计划")
    return details(db, [plan])[0]


def list_plans(
    db: Session,
    *,
    q: str | None,
    status: Status | None,
    schedule_kind: GeoPlanScheduleKind | None,
    sort: Literal["UPDATED_DESC", "NAME_ASC"],
    page: int,
    page_size: Literal[10, 20, 50],
) -> GeoMonitoringPlanListPage:
    query = select(GeoMonitoringPlan)
    if q is not None and q.strip():
        query = query.where(GeoMonitoringPlan.name.icontains(q.strip(), autoescape=True))
    if status is not None:
        query = query.where(GeoMonitoringPlan.status == status)
    if schedule_kind is not None:
        query = query.where(GeoMonitoringPlan.schedule_kind == schedule_kind)
    total = db.scalar(
        select(func.count()).select_from(query.subquery()).execution_options(autoflush=False)
    )
    order = (
        GeoMonitoringPlan.updated_at.desc()
        if sort == "UPDATED_DESC"
        else GeoMonitoringPlan.name.asc()
    )
    plans = db.scalars(
        query.order_by(order, GeoMonitoringPlan.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .execution_options(populate_existing=True, autoflush=False)
    ).all()
    return GeoMonitoringPlanListPage(
        items=details(db, plans), total=total, page=page, page_size=page_size
    )
