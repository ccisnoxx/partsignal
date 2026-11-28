"""Slice 1D：不可变冻结周/月报快照创建、更正新版链与只读查询服务。"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.geo_monitoring_plans import GeoMonitoringPlan, GeoMonitoringPlanPrompt
from app.models.geo_report_snapshots import GeoReportSnapshot
from app.models.identity import User
from app.schemas.common import AccountType
from app.schemas.geo_leadership_dashboard import (
    GeoReportSnapshotCreateRequest,
    GeoReportSnapshotDetail,
    GeoReportSnapshotKind,
    GeoReportSnapshotList,
    GeoReportSnapshotOut,
)
from app.services.current_actor import current_actor_command
from app.services.geo_leadership_dashboard import get_leadership_dashboard


def _user_names(db: Session, ids: set[UUID]) -> dict[UUID, str]:
    if not ids:
        return {}
    return {
        uid: name
        for uid, name in db.execute(
            select(User.id, User.display_name).where(User.id.in_(ids))
        ).all()
    }


def _snapshot_out(
    snap: GeoReportSnapshot, user_names: dict[UUID, str]
) -> GeoReportSnapshotOut:
    return GeoReportSnapshotOut(
        id=snap.id,
        report_kind=GeoReportSnapshotKind(snap.report_kind),
        title=snap.title,
        period_from=snap.period_from,
        period_to=snap.period_to,
        data_cutoff_at=snap.data_cutoff_at,
        revision_no=snap.revision_no,
        supersedes_snapshot_id=snap.supersedes_snapshot_id,
        correction_reason=snap.correction_reason,
        summary_notes=snap.summary_notes,
        evidence_run_count=len(snap.evidence_run_ids or []),
        created_by=snap.created_by,
        created_by_name=user_names.get(snap.created_by),
        created_at=snap.created_at,
    )


def list_report_snapshots(db: Session, *, limit: int = 50) -> GeoReportSnapshotList:
    rows = list(
        db.scalars(
            select(GeoReportSnapshot)
            .order_by(GeoReportSnapshot.period_from.desc(), GeoReportSnapshot.created_at.desc())
            .limit(limit)
        )
    )
    names = _user_names(db, {r.created_by for r in rows})
    return GeoReportSnapshotList(
        items=[_snapshot_out(r, names) for r in rows],
        total=len(rows),
    )


def get_report_snapshot(db: Session, snapshot_id: UUID) -> GeoReportSnapshotDetail:
    snap = db.get(GeoReportSnapshot, snapshot_id)
    if snap is None:
        raise not_found("冻结周报快照")
    names = _user_names(db, {snap.created_by})
    base = _snapshot_out(snap, names)
    return GeoReportSnapshotDetail(
        **base.model_dump(),
        filter_scope=dict(snap.filter_scope),
        core_cohort_snapshot=dict(snap.core_cohort_snapshot),
        dashboard_payload=dict(snap.dashboard_payload),
        evidence_run_ids=list(snap.evidence_run_ids or []),
    )


def create_report_snapshot(
    db: Session,
    *,
    payload: GeoReportSnapshotCreateRequest,
    actor: User,
    request_id: str,
) -> GeoReportSnapshotDetail:
    """在一致读视角下冻结周/月报快照；支持以 supersedes_snapshot_id 追加更正新版。"""
    if payload.period_to <= payload.period_from:
        raise AppError("VALIDATION_ERROR", "快照结束时间必须晚于开始时间", 422)
    reason = (payload.correction_reason or "").strip() if payload.correction_reason else None
    if payload.supersedes_snapshot_id is not None and not reason:
        raise AppError("VALIDATION_ERROR", "创建更正新版快照必须填写更正说明", 422)
    if payload.supersedes_snapshot_id is None and reason is not None:
        raise AppError("VALIDATION_ERROR", "初版快照不能填写更正说明", 422)

    with current_actor_command(db, actor, allowed=(AccountType.ADMIN, AccountType.ENGINEER)) as cur:
        revision_no = 1
        if payload.supersedes_snapshot_id is not None:
            parent = db.scalar(
                select(GeoReportSnapshot)
                .where(GeoReportSnapshot.id == payload.supersedes_snapshot_id)
                .with_for_update()
            )
            if parent is None:
                raise not_found("被更正的原周报快照")
            revision_no = parent.revision_no + 1

        dashboard = get_leadership_dashboard(
            db,
            period_from=payload.period_from.astimezone(UTC),
            period_to=payload.period_to.astimezone(UTC),
            bucket_granularity=payload.bucket_granularity,
            product_id=payload.product_id,
            surface_id=payload.surface_id,
            collection_mode=payload.collection_mode,
        )
        core_plans = list(
            db.execute(
                select(GeoMonitoringPlan.id, GeoMonitoringPlan.name, GeoMonitoringPlan.revision)
                .where(
                    GeoMonitoringPlan.plan_role == "CORE_BASELINE",
                    GeoMonitoringPlan.status == "ACTIVE",
                )
                .order_by(GeoMonitoringPlan.id.asc())
            ).all()
        )
        core_prompts = [
            str(pid)
            for pid in db.scalars(
                select(GeoMonitoringPlanPrompt.prompt_variant_id)
                .join(GeoMonitoringPlan, GeoMonitoringPlan.id == GeoMonitoringPlanPrompt.plan_id)
                .where(
                    GeoMonitoringPlan.plan_role == "CORE_BASELINE",
                    GeoMonitoringPlan.status == "ACTIVE",
                )
            )
        ]
        now = datetime.now(UTC)
        snap = GeoReportSnapshot(
            report_kind=payload.report_kind.value,
            title=payload.title,
            period_from=payload.period_from.astimezone(UTC),
            period_to=payload.period_to.astimezone(UTC),
            data_cutoff_at=dashboard.as_of,
            filter_scope={
                "bucket_granularity": payload.bucket_granularity,
                "product_id": str(payload.product_id) if payload.product_id else None,
                "surface_id": str(payload.surface_id) if payload.surface_id else None,
                "collection_mode": payload.collection_mode,
            },
            core_cohort_snapshot={
                "plans": [
                    {"id": str(pid), "name": name, "revision": rev}
                    for pid, name, rev in core_plans
                ],
                "prompt_variant_ids": sorted(set(core_prompts)),
            },
            dashboard_payload=dashboard.model_dump(mode="json"),
            evidence_run_ids=list(dashboard.evidence_run_ids),
            summary_notes=payload.summary_notes,
            revision_no=revision_no,
            supersedes_snapshot_id=payload.supersedes_snapshot_id,
            correction_reason=reason,
            created_by=cur.id,
            created_at=now,
        )
        db.add(snap)
        try:
            db.flush()
        except IntegrityError as error:
            orig = error.orig
            if (
                getattr(orig, "sqlstate", None) == "23505"
                and getattr(getattr(orig, "diag", None), "constraint_name", None)
                == "uq_geo_report_snapshots_supersedes_once"
            ):
                db.rollback()
                raise AppError(
                    "REPORT_SNAPSHOT_ALREADY_SUPERSEDED",
                    "该历史快照已有更正新版，请基于最新修订版继续更正",
                    409,
                ) from error
            raise
        append_audit(
            db,
            AuditEntry(
                actor_id=cur.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action=(
                    "geo_report_snapshot.revised"
                    if payload.supersedes_snapshot_id is not None
                    else "geo_report_snapshot.created"
                ),
                target_type="GeoReportSnapshot",
                target_id=snap.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已冻结领导看板周/月报快照",
                details={
                    "facts": {
                        "snapshot_id": str(snap.id),
                        "report_kind": snap.report_kind,
                        "revision": snap.revision_no,
                    }
                },
            ),
        )
        snap_id = snap.id
        db.commit()
    return get_report_snapshot(db, snap_id)
