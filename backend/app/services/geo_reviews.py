"""人工复核应用服务：当前账号、Run串行化、追加历史与原子审计。"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.geo_analysis import GeoAnalysisRevision, GeoClaimAssessment, GeoRunReview
from app.models.geo_answers import GeoAnswerCitation
from app.models.identity import User
from app.schemas.geo_analysis import GeoReviewCorrectionPayload, GeoRunReviewOut
from app.schemas.geo_reviews import GeoRunReviewCreated, GeoRunReviewRequest
from app.schemas.geo_runs import GeoRunStatus
from app.services.geo_plan_locks import command
from app.services.geo_run_lifecycle import database_now, lock_run, refresh_batch, run_state
from app.services.geo_run_policy import run_transition


def invalid_correction() -> AppError:
    return AppError(
        "VALIDATION_ERROR",
        "复核修正必须属于当前分析并保留事实依据",
        422,
        {
            "errors": [
                {
                    "loc": ["body", "correction_payload"],
                    "msg": "修正目标或事实依据无效",
                    "type": "geo_review_correction_invalid",
                }
            ]
        },
    )


def stale_analysis() -> AppError:
    return AppError("GEO_REVIEW_STALE_ANALYSIS", "当前分析已变更，请重新读取后复核", 409)


def validate_correction_scope(
    db: Session, analysis: GeoAnalysisRevision, payload: GeoReviewCorrectionPayload | None
) -> None:
    if payload is None:
        return
    subjects = {UUID(row["id"]) for row in analysis.input_snapshot["subjects"]}
    if any(row.subject_id not in subjects for row in payload.mentions) or any(
        row.subject_id not in subjects for row in payload.recommendations
    ):
        raise invalid_correction()
    claims = {
        identity: fact
        for identity, fact in db.execute(
            select(GeoClaimAssessment.id, GeoClaimAssessment.fact_version_id).where(
                GeoClaimAssessment.analysis_revision_id == analysis.id
            )
        ).all()
    }
    if any(
        row.claim_assessment_id not in claims
        or (claims[row.claim_assessment_id] is None and row.verdict != "UNJUDGEABLE")
        for row in payload.claims
    ):
        raise invalid_correction()
    citations = set(
        db.scalars(
            select(GeoAnswerCitation.id).where(
                GeoAnswerCitation.answer_snapshot_id == analysis.answer_snapshot_id
            )
        )
    )
    if any(
        row.citation_id not in citations
        or (row.subject_id is not None and row.subject_id not in subjects)
        for row in payload.citations
    ):
        raise invalid_correction()


def review_run(
    db: Session, *, run_id: UUID, payload: GeoRunReviewRequest, actor: User, request_id: str
) -> GeoRunReviewCreated:
    try:
        with command(db, actor) as current:
            locked = lock_run(db, run_id)
            if locked is None:
                raise not_found("GEO 运行")
            batch, run = locked
            if run.current_analysis_revision_id is None:
                raise AppError("GEO_ANALYSIS_NOT_AVAILABLE", "尚无当前成功分析可复核", 409)
            if run.current_analysis_revision_id != payload.analysis_revision_id:
                raise stale_analysis()
            if run.revision != payload.expected_run_revision:
                raise AppError("REVISION_CONFLICT", "运行已变更，请重新读取", 409)
            analysis = db.scalar(
                select(GeoAnalysisRevision)
                .where(GeoAnalysisRevision.id == run.current_analysis_revision_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if analysis is None or analysis.status != "COMPLETED" or analysis.run_id != run.id:
                raise AppError("GEO_ANALYSIS_NOT_AVAILABLE", "尚无当前成功分析可复核", 409)
            if (
                run.status not in {"NEEDS_REVIEW", "COMPLETED", "FAILED"}
                or not run_state(db, run).has_answer
            ):
                raise AppError("INVALID_STATE_TRANSITION", "首次分析尚未结束，不能提交复核", 409)
            validate_correction_scope(db, analysis, payload.correction_payload)
            review = GeoRunReview(
                run_id=run.id,
                analysis_revision_id=analysis.id,
                decision=payload.decision.value,
                correction_payload=payload.correction_payload.model_dump(mode="json")
                if payload.correction_payload
                else None,
                comment=payload.comment,
                reviewer_id=current.id,
            )
            db.add(review)
            db.flush()
            # created_at由数据库强制产生；不能使用客户端排序时间。
            db.refresh(review)
            now = database_now(db)
            if run.status == "NEEDS_REVIEW":
                run.status = run_transition(run_state(db, run), GeoRunStatus.COMPLETED).value
                run.finished_at = now
            run.revision += 1
            refresh_batch(db, batch, now)
            append_audit(
                db,
                AuditEntry(
                    actor_id=current.id,
                    business_module=AuditModule.GEO_OBSERVATION,
                    action="geo_observation_run.reviewed",
                    target_type="GeoRunReview",
                    target_id=review.id,
                    request_id=request_id,
                    outcome=AuditOutcome.SUCCESS,
                    result_message="已追加人工复核，原始证据与机器结果保留",
                    details={
                        "facts": {
                            "run_id": str(run.id),
                            "analysis_revision_id": str(analysis.id),
                            "review_id": str(review.id),
                            "decision": review.decision,
                        }
                    },
                ),
            )
            receipt = GeoRunReviewCreated(
                review=GeoRunReviewOut.model_validate(review), run_revision=run.revision
            )
            db.commit()
            return receipt
    except IntegrityError as error:
        db.rollback()
        constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
        if getattr(error.orig, "sqlstate", None) == "23514":
            if constraint == "ck_geo_reviews_current_analysis":
                raise stale_analysis() from None
            if constraint in {
                "ck_geo_reviews_correction_scope",
                "ck_geo_reviews_decision",
                "ck_geo_reviews_comment",
            }:
                raise invalid_correction() from None
        raise
