"""管理员单 Run 重分析应用命令；公共 HTTP 和复核操作由 GEO-507 接入。"""

from enum import StrEnum
from uuid import UUID

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.config import settings
from app.db import SessionLocal
from app.errors import AppError, not_found
from app.models.identity import User
from app.services.geo_analysis_dispatch import AnalysisSender, dispatch_revision
from app.services.geo_analysis_inputs import prepare_revision
from app.services.geo_run_lifecycle import lock_run
from app.services.geo_surface_locks import command


class ReanalysisReason(StrEnum):
    RULES_UPDATED = "RULES_UPDATED"
    DICTIONARY_UPDATED = "DICTIONARY_UPDATED"
    FACTS_UPDATED = "FACTS_UPDATED"
    RETRY_FAILED = "RETRY_FAILED"


def reanalyze_run(
    *,
    run_id: UUID,
    expected_revision: int,
    actor: User,
    reason: ReanalysisReason,
    request_id: str,
    sender: AnalysisSender | None = None,
) -> UUID:
    """只接受服务端 actor；冻结创建与审计同事务，外部派发在 commit 后。"""
    reason = ReanalysisReason(reason)
    if type(expected_revision) is not int or expected_revision < 0:
        raise ValueError("expected_revision 必须是非负整数")
    with SessionLocal() as db:
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        with command(db, actor) as current:
            if not settings.geo_monitoring_enabled:
                raise AppError("GEO_PLAN_PROFILE_INELIGIBLE", "GEO 监测开关已关闭", 422)
            locked = lock_run(db, run_id)
            if locked is None:
                raise not_found("GEO 运行")
            _, run = locked
            if run.revision != expected_revision:
                raise AppError("REVISION_CONFLICT", "运行已变更，请重新读取", 409)
            if run.collected_at is None or run.status not in {
                "COMPLETED",
                "NEEDS_REVIEW",
                "FAILED",
            }:
                raise AppError(
                    "INVALID_STATE_TRANSITION",
                    "只有已结束首次分析且保有原始回答的运行可重新分析",
                    409,
                )
            analysis_id = prepare_revision(db, run, current_dictionary=True)
            append_audit(
                db,
                AuditEntry(
                    actor_id=current.id,
                    business_module=AuditModule.GEO_OBSERVATION,
                    action="geo_observation_run.reanalyzed",
                    target_type="GeoAnalysisRevision",
                    target_id=analysis_id,
                    request_id=request_id,
                    outcome=AuditOutcome.SUCCESS,
                    result_message="已接受显式重新分析，原始回答与历史版本保留",
                    details={
                        "facts": {
                            "run_id": str(run.id),
                            "analysis_revision_id": str(analysis_id),
                            "reason_code": reason.value,
                        }
                    },
                ),
            )
            db.commit()
    if sender is None:
        from app.worker import analyze_geo_revision

        sender = analyze_geo_revision.delay
    dispatch_revision(analysis_id, sender)
    return analysis_id
