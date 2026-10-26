"""页内计划调度状态固定两条集合查询，不从批次推测游标。"""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.geo_plan_schedules import GeoPlanSchedule, GeoPlanScheduleWindow
from app.schemas.geo_plan_schedules import GeoPlanScheduleRuntime, GeoPlanScheduleWindowOut


def runtimes(db: Session, ids: Sequence[UUID]) -> dict[UUID, GeoPlanScheduleRuntime]:
    if not ids:
        return {}
    cursors = list(db.scalars(select(GeoPlanSchedule).where(GeoPlanSchedule.plan_id.in_(ids))))
    latest = {
        row.plan_id: GeoPlanScheduleWindowOut.model_validate(row)
        for row in db.scalars(
            select(GeoPlanScheduleWindow)
            .where(GeoPlanScheduleWindow.plan_id.in_(ids))
            .distinct(GeoPlanScheduleWindow.plan_id)
            .order_by(GeoPlanScheduleWindow.plan_id, GeoPlanScheduleWindow.scheduled_for.desc())
        )
    }
    return {
        row.plan_id: GeoPlanScheduleRuntime(
            next_run_at=row.next_run_at, latest_window=latest.get(row.plan_id)
        )
        for row in cursors
    }
