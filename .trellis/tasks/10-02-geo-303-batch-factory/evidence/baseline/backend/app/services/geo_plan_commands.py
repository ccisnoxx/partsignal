"""计划配置与生命周期命令的事务 owner；不持久化执行或快照。"""

from datetime import UTC, datetime
from typing import NoReturn
from uuid import UUID, uuid4

from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError
from app.models.geo_monitoring_plans import (
    GeoMonitoringPlan,
    GeoMonitoringPlanProfile,
    GeoMonitoringPlanPrompt,
    GeoMonitoringPlanSubject,
)
from app.models.identity import User
from app.schemas.geo_monitoring_plans import (
    GeoMonitoringPlanConfiguration,
    GeoMonitoringPlanCreate,
    GeoMonitoringPlanUpdate,
)
from app.schemas.geo_monitoring_plans import GeoMonitoringPlanStatus as Status
from app.schemas.geo_plan_management import GeoMonitoringPlanCopy, GeoMonitoringPlanDetail
from app.schemas.geo_plan_preview import GeoMonitoringPlanPreview
from app.services.geo_plan_locks import command, lock_plan, lock_resources
from app.services.geo_plan_policy import PlanTransition, require_mutable, transition
from app.services.geo_plan_queries import CONFIGURATION_FIELDS, plan_detail, previews


def _configuration(value: GeoMonitoringPlanConfiguration) -> GeoMonitoringPlanConfiguration:
    fields = value.model_dump(exclude={"expected_revision"})
    fields["subjects"] = sorted(fields["subjects"], key=lambda s: s["subject_id"])
    for name in ("prompt_variant_ids", "collection_profile_ids"):
        fields[name] = sorted(fields[name])
    return GeoMonitoringPlanConfiguration.model_validate(fields)


def _require_references(preview: GeoMonitoringPlanPreview) -> None:
    missing = [
        b
        for b in preview.blockers
        if b.code in {"SUBJECT_NOT_FOUND", "PROMPT_NOT_FOUND", "PROFILE_NOT_FOUND"}
    ]
    if missing:
        raise AppError(
            "GEO_PLAN_REFERENCE_INVALID",
            "计划引用的资源不存在",
            422,
            {"blockers": [b.model_dump(mode="json") for b in missing]},
        )


def _require_eligible(preview: GeoMonitoringPlanPreview) -> None:
    if preview.blockers:
        code = (
            "GEO_PLAN_BUDGET_EXCEEDED"
            if any(b.code == "BUDGET_EXCEEDED" for b in preview.blockers)
            else "GEO_PLAN_PROFILE_INELIGIBLE"
        )
        raise AppError(
            code,
            "计划当前不具备运行资格，请修正阻断项",
            409,
            {"blockers": [b.model_dump(mode="json") for b in preview.blockers]},
        )


def _flush_business(db: Session) -> None:
    try:
        db.flush()
        # 只提前裁决本聚合的提交完整性；审计错误不得误分类为配置错误。
        db.execute(
            text(
                "SET CONSTRAINTS geo_monitoring_plan_complete, "
                "geo_monitoring_plan_subjects_complete, "
                "geo_monitoring_plan_prompts_complete, "
                "geo_monitoring_plan_profiles_complete IMMEDIATE"
            )
        )
    except IntegrityError as error:
        pair = (
            getattr(error.orig, "sqlstate", None),
            getattr(getattr(error.orig, "diag", None), "constraint_name", None),
        )
        if pair == ("23514", "ck_geo_monitoring_plans_archived"):
            mapped = AppError("GEO_PLAN_ARCHIVED", "归档计划只读，请复制为新计划", 409)
        elif pair in {
            ("23514", "ck_geo_monitoring_plans_" + name + "_required")
            for name in ("primary", "prompt", "profile")
        }:
            mapped = AppError("GEO_PLAN_EMPTY", "计划至少需要一个 PRIMARY、问题变体和采集配置", 422)
        elif pair in {
            ("23503", "fk_geo_monitoring_plan_" + name + "_" + label)
            for name, label in (
                ("subjects", "subject"),
                ("prompts", "prompt"),
                ("profiles", "profile"),
            )
        }:
            mapped = AppError("GEO_PLAN_REFERENCE_INVALID", "计划引用的资源不存在", 422)
        else:
            raise
        db.rollback()
        raise mapped from error


def _memberships(
    db: Session, plan: GeoMonitoringPlan, value: GeoMonitoringPlanConfiguration
) -> None:
    db.add_all(
        [
            GeoMonitoringPlanSubject(plan_id=plan.id, subject_id=s.subject_id, role=s.role)
            for s in value.subjects
        ]
    )
    db.add_all(
        [
            GeoMonitoringPlanPrompt(plan_id=plan.id, prompt_variant_id=p)
            for p in value.prompt_variant_ids
        ]
    )
    db.add_all(
        [
            GeoMonitoringPlanProfile(plan_id=plan.id, collection_profile_id=p)
            for p in value.collection_profile_ids
        ]
    )


def _audit(db: Session, plan: GeoMonitoringPlan, actor: User, request_id: str, action: str) -> None:
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="geo_monitoring_plan." + action,
            target_type="GeoMonitoringPlan",
            target_id=plan.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="GEO 监测计划配置已变更",
            details={"facts": {"revision": plan.revision, "status": plan.status}},
        ),
    )


def _finish(
    db: Session,
    plan: GeoMonitoringPlan,
    value: GeoMonitoringPlanConfiguration,
    preview: GeoMonitoringPlanPreview,
    actor: User,
    request_id: str,
    action: str | None,
) -> GeoMonitoringPlanDetail:
    if action is not None:
        _flush_business(db)
        _audit(db, plan, actor, request_id, action)
    db.flush()
    result = plan_detail(plan, value, preview)
    db.commit()
    return result


def _changed(plan: GeoMonitoringPlan, actor: User) -> None:
    plan.revision += 1
    plan.updated_at = max(datetime.now(UTC), plan.updated_at)
    plan.updated_by = actor.id


def _create(
    db: Session, value: GeoMonitoringPlanConfiguration, actor: User, request_id: str, action: str
) -> GeoMonitoringPlanDetail:
    preview = previews(db, [value])[0]
    _require_references(preview)
    plan = GeoMonitoringPlan(
        id=uuid4(),
        **{name: getattr(value, name) for name in CONFIGURATION_FIELDS},
        status="DISABLED",
        revision=0,
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(plan)
    db.flush()
    _memberships(db, plan, value)
    return _finish(db, plan, value, preview, actor, request_id, action)


def create_plan(
    *, db: Session, payload: GeoMonitoringPlanCreate, actor: User, request_id: str
) -> GeoMonitoringPlanDetail:
    with command(db, actor) as current:
        value = _configuration(payload)
        lock_resources(db, [value])
        return _create(db, value, current, request_id, "created")


def update_plan(
    *, db: Session, plan_id: UUID, payload: GeoMonitoringPlanUpdate, actor: User, request_id: str
) -> GeoMonitoringPlanDetail:
    with command(db, actor) as current:
        value = _configuration(payload)
        plan, before = lock_plan(db, plan_id, payload.expected_revision, value)
        require_mutable(Status(plan.status))
        preview = previews(db, [value])[0]
        _require_references(preview)
        changed = value != before
        if changed:
            if plan.status == Status.ACTIVE:
                _require_eligible(preview)
            for name in CONFIGURATION_FIELDS:
                setattr(plan, name, getattr(value, name))
            if any(
                getattr(value, name) != getattr(before, name)
                for name in ("subjects", "prompt_variant_ids", "collection_profile_ids")
            ):
                for model in (
                    GeoMonitoringPlanSubject,
                    GeoMonitoringPlanPrompt,
                    GeoMonitoringPlanProfile,
                ):
                    db.execute(delete(model).where(model.plan_id == plan.id))
                _memberships(db, plan, value)
            _changed(plan, current)
        return _finish(
            db, plan, value, preview, current, request_id, "updated" if changed else None
        )


def change_status(
    *,
    db: Session,
    plan_id: UUID,
    expected_revision: int,
    operation: PlanTransition,
    actor: User,
    request_id: str,
) -> GeoMonitoringPlanDetail:
    with command(db, actor) as current:
        plan, value = lock_plan(db, plan_id, expected_revision)
        target = transition(Status(plan.status), operation)
        preview = previews(db, [value])[0]
        if target == Status.ACTIVE:
            _require_eligible(preview)
        if target == Status.ARCHIVED and plan.status == Status.ACTIVE:
            # ACTIVE归档在同一事务内先暂停，不产生可见中间态或第二条成功审计。
            plan.status = Status.PAUSED
            db.flush()
        plan.status = target
        _changed(plan, current)
        actions = {
            "activate": "activated",
            "pause": "paused",
            "resume": "resumed",
            "archive": "archived",
        }
        return _finish(db, plan, value, preview, current, request_id, actions[operation])


def copy_plan(
    *, db: Session, plan_id: UUID, payload: GeoMonitoringPlanCopy, actor: User, request_id: str
) -> GeoMonitoringPlanDetail:
    with command(db, actor) as current:
        _, source = lock_plan(db, plan_id, payload.expected_revision)
        value = GeoMonitoringPlanConfiguration.model_validate(
            source.model_dump() | {"name": payload.name}
        )
        return _create(db, value, current, request_id, "copied")


def delete_plan(
    *, db: Session, plan_id: UUID, expected_revision: int, actor: User, request_id: str
) -> None:
    with command(db, actor) as current:
        plan, _ = lock_plan(db, plan_id, expected_revision)
        require_mutable(Status(plan.status))
        if plan.status != Status.DISABLED:
            raise AppError(
                "GEO_PLAN_IN_USE", "只能删除尚未启用的 DISABLED 计划；其他计划请归档", 409
            )
        db.delete(plan)
        _flush_business(db)
        _audit(db, plan, current, request_id, "deleted")
        db.commit()


def run_now(
    *, db: Session, plan_id: UUID, expected_revision: int, idempotency_key: str, actor: User
) -> NoReturn:
    with command(db, actor):
        plan, _ = lock_plan(db, plan_id, expected_revision)
        require_mutable(Status(plan.status))
        # GEO-303尚未实施，不保存命令或幂等结果，不写成功审计、不返回伪造资源。
        raise AppError("NOT_IMPLEMENTED", "立即运行将在批次创建能力交付后开放", 501)
