"""管理员周期配置事务owner；User/Session先于配置锁，运行不会改变配置revision。"""

import hashlib
import json
from datetime import timedelta
from typing import Literal

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError
from app.models.geo_opportunity_schedule import GeoOpportunitySchedule, GeoOpportunityScheduleWindow
from app.models.geo_rules import GeoRuleSetRevision
from app.models.identity import User
from app.schemas.common import AccountType
from app.schemas.geo_opportunity_schedule import (
    GeoOpportunityScheduleCommand,
    GeoOpportunityScheduleDetail,
    GeoOpportunityScheduleSave,
)
from app.services.current_actor import current_actor_command
from app.services.geo_opportunities import ensure_evaluation_enabled
from app.services.geo_opportunity_schedule_state import clock, configuration, detail, latest

type ScheduleOperation = Literal["configure", "activate", "pause", "resume"]


def conflict() -> AppError:
    return AppError("REVISION_CONFLICT", "自动评估配置已变化，请重新读取并确认", 409)


def change(
    db: Session,
    *,
    actor: User,
    request_id: str,
    payload: GeoOpportunityScheduleSave | GeoOpportunityScheduleCommand,
    operation: ScheduleOperation,
) -> GeoOpportunityScheduleDetail:
    db.autoflush = False
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current:
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended('geo-opportunity-schedule',0))")
        )
        row = db.scalar(
            select(GeoOpportunitySchedule)
            .where(GeoOpportunitySchedule.id == 1)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if (row.revision if row else 0) != payload.expected_revision:
            raise conflict()
        now = clock(db)
        value = (
            payload.configuration
            if isinstance(payload, GeoOpportunityScheduleSave)
            else configuration(row)
            if row
            else None
        )
        if value is None:
            raise AppError("INVALID_STATE_TRANSITION", "请先保存自动评估配置", 409)
        if db.get(GeoRuleSetRevision, value.rule_set_revision) is None:
            raise AppError("RESOURCE_NOT_FOUND", "所选GEO规则revision不存在", 404)
        target = row.status if row else "DISABLED"
        if operation != "configure":
            targets = {
                "activate": ("DISABLED", "ACTIVE"),
                "pause": ("ACTIVE", "PAUSED"),
                "resume": ("PAUSED", "ACTIVE"),
            }
            source, target = targets[operation]
            if row is None or row.status != source:
                raise AppError("INVALID_STATE_TRANSITION", "当前状态不允许此操作", 409)
        if target == "ACTIVE":
            ensure_evaluation_enabled()
        data = value.model_dump(mode="json", exclude={"rule_set_revision"})
        if row is not None and (
            row.configuration,
            row.rule_set_revision,
            row.status,
            row.authorizer_id,
        ) == (data, value.rule_set_revision, target, current.id):
            return detail(db)
        last = latest(db)
        floor = max(
            [now]
            + ([last.scheduled_for] if last else [])
            + ([last.covered_until] if last and last.covered_until else [])
        )
        if row is not None and row.next_run_at is not None and row.next_run_at <= now:
            db.add(
                GeoOpportunityScheduleWindow(
                    schedule_id=1,
                    scheduled_for=row.next_run_at,
                    configuration_revision=row.revision,
                    configuration_snapshot=row.configuration,
                    rule_set_revision=row.rule_set_revision,
                    status="MISSED",
                    error_code="SUPERSEDED",
                    covered_until=now + timedelta(microseconds=1),
                )
            )
        if row is None:
            row = GeoOpportunitySchedule(
                id=1,
                configuration=data,
                rule_set_revision=value.rule_set_revision,
                authorizer_id=current.id,
                status="DISABLED",
                revision=1,
                next_run_at=None,
            )
            db.add(row)
        else:
            row.configuration = data
            row.rule_set_revision = value.rule_set_revision
            row.authorizer_id = current.id
            row.status = target
            row.revision += 1
            row.updated_at = max(now, row.updated_at)
        row.next_run_at = (
            floor + timedelta(hours=value.interval_hours) if target == "ACTIVE" else None
        )
        db.flush()
        action = {
            "configure": "configured",
            "activate": "activated",
            "pause": "paused",
            "resume": "resumed",
        }[operation]
        append_audit(
            db,
            AuditEntry(
                actor_id=current.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_opportunity_schedule." + action,
                target_type="GeoOpportunitySchedule",
                target_id="1",
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="机会自动评估配置已变更",
                details={
                    "facts": {
                        "revision": row.revision,
                        "scope": value.scope,
                        "filter_sha256": hashlib.sha256(
                            json.dumps(value.model_dump(mode="json"), sort_keys=True).encode()
                        ).hexdigest(),
                    }
                },
            ),
        )
        result = detail(db)
        db.commit()
        return result
