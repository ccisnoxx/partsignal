"""Slice 1C：人工提交后的同步确定性分析、引用归因落库与同屏人工确认。"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import not_found
from app.models.articles import ArticlePublication
from app.models.geo_analysis import (
    GeoAnalysisRevision,
    GeoEntityMention,
    GeoRecommendation,
    GeoRunReview,
)
from app.models.geo_analysis_worker import GeoAnalysisJob
from app.models.geo_answers import GeoAnswerCitation, GeoAnswerSnapshot
from app.models.geo_citation_links import GeoCitationPublicationLink
from app.models.identity import User
from app.schemas.geo_analysis import (
    GeoMentionCorrection,
    GeoRecommendationCorrection,
    GeoRecommendationKind,
    GeoReviewCorrectionPayload,
    GeoReviewDecision,
)
from app.schemas.geo_daily_checklist import (
    GeoCitationLinkStatus,
    GeoCitationMatchMethod,
    GeoCitationPublicationLinkOut,
    GeoManualInlineReview,
)
from app.schemas.geo_runs import GeoRunStatus
from app.services import geo_analysis_execution as execution
from app.services.geo_analysis_inputs import prepare_revision
from app.services.geo_analysis_runs import ANALYSIS_LEASE_SECONDS
from app.services.geo_citation_matching import (
    _demote_other_effective_links,
    list_run_citation_links,
    materialize_citation_links,
)
from app.services.geo_run_lifecycle import database_now, lock_run, refresh_batch, run_state
from app.services.geo_run_policy import run_transition


def _apply_inline_citation_decisions(
    db: Session,
    *,
    answer_snapshot_id: UUID,
    inline_review: GeoManualInlineReview,
    actor_id: UUID,
    now: datetime,
) -> None:
    if not inline_review.citation_decisions:
        return
    cits_by_norm = {
        c.normalized_url: c
        for c in db.scalars(
            select(GeoAnswerCitation).where(
                GeoAnswerCitation.answer_snapshot_id == answer_snapshot_id
            )
        )
    }
    for dec in inline_review.citation_decisions:
        cit = cits_by_norm.get(dec.normalized_url)
        if cit is None:
            continue
        pub = db.get(ArticlePublication, dec.article_publication_id)
        if pub is None:
            continue
        existing = db.scalar(
            select(GeoCitationPublicationLink)
            .where(
                GeoCitationPublicationLink.citation_id == cit.id,
                GeoCitationPublicationLink.article_publication_id == pub.id,
            )
            .with_for_update()
        )
        if dec.action == "CONFIRM":
            _demote_other_effective_links(
                db,
                citation_id=cit.id,
                keep_link_id=existing.id if existing else None,
                actor_id=actor_id,
                now=now,
            )
            if existing is not None:
                existing.link_status = GeoCitationLinkStatus.CONFIRMED.value
                existing.confirmed_by = actor_id
                existing.confirmed_at = now
                existing.updated_at = now
                existing.revision += 1
            else:
                db.add(
                    GeoCitationPublicationLink(
                        citation_id=cit.id,
                        article_publication_id=pub.id,
                        match_method=GeoCitationMatchMethod.MANUAL_SELECTED.value,
                        link_status=GeoCitationLinkStatus.CONFIRMED.value,
                        match_reason="人工提交同屏确认引用归属",
                        confirmed_by=actor_id,
                        confirmed_at=now,
                        revision=0,
                        created_at=now,
                        updated_at=now,
                    )
                )
        elif existing is not None:
            existing.link_status = GeoCitationLinkStatus.REJECTED.value
            existing.confirmed_by = actor_id
            existing.confirmed_at = now
            existing.updated_at = now
            existing.revision += 1
    db.flush()


def _build_inline_correction_payload(
    db: Session,
    *,
    analysis: GeoAnalysisRevision,
    inline_review: GeoManualInlineReview,
) -> tuple[GeoReviewCorrectionPayload | None, bool]:
    has_unknown = False
    mention_rows = {
        m.subject_id: m
        for m in db.scalars(
            select(GeoEntityMention).where(GeoEntityMention.analysis_revision_id == analysis.id)
        )
    }
    rec_rows = {
        r.subject_id: r
        for r in db.scalars(
            select(GeoRecommendation).where(GeoRecommendation.analysis_revision_id == analysis.id)
        )
    }
    subjects_by_id = {UUID(s["id"]): s for s in analysis.input_snapshot["subjects"]}
    mention_corrections: list[GeoMentionCorrection] = []
    rec_corrections: list[GeoRecommendationCorrection] = []

    for dec in inline_review.subject_decisions:
        sub = subjects_by_id.get(dec.subject_id)
        if sub is None:
            continue
        if dec.mentioned is None or dec.recommendation == GeoRecommendationKind.UNKNOWN:
            has_unknown = True
        machine_mentioned = dec.subject_id in mention_rows
        if dec.mentioned is not None and dec.mentioned != machine_mentioned:
            if dec.mentioned:
                alias_label = (
                    sub["aliases"][0]["alias"] if sub.get("aliases") else sub["display_name"]
                )
                mention_corrections.append(
                    GeoMentionCorrection(
                        subject_id=dec.subject_id,
                        mention_count=1,
                        first_character_offset=0,
                        matched_aliases=[alias_label],
                    )
                )
            else:
                mention_corrections.append(
                    GeoMentionCorrection(
                        subject_id=dec.subject_id,
                        mention_count=0,
                        first_character_offset=None,
                        matched_aliases=[],
                    )
                )
        if dec.recommendation is not None:
            machine_rec = rec_rows.get(dec.subject_id)
            machine_kind = (
                GeoRecommendationKind(machine_rec.recommendation)
                if machine_rec is not None
                else GeoRecommendationKind.NOT_RECOMMENDED
            )
            machine_rank = machine_rec.rank if machine_rec is not None else None
            if dec.recommendation != machine_kind or dec.rank != machine_rank:
                rec_corrections.append(
                    GeoRecommendationCorrection(
                        subject_id=dec.subject_id,
                        recommendation=dec.recommendation,
                        rank=(
                            dec.rank
                            if dec.recommendation == GeoRecommendationKind.RECOMMENDED
                            else None
                        ),
                        rationale_excerpt=None,
                    )
                )

    if not mention_corrections and not rec_corrections:
        return None, has_unknown
    return (
        GeoReviewCorrectionPayload(
            schema_version=1,
            mentions=mention_corrections,
            recommendations=rec_corrections,
            claims=[],
            citations=[],
        ),
        has_unknown,
    )


def run_sync_analysis_after_manual_submit(
    db: Session,
    *,
    run_id: UUID,
    actor: User,
    inline_review: GeoManualInlineReview | None,
    request_id: str,
) -> tuple[
    GeoRunStatus,
    UUID | None,
    UUID | None,
    list[GeoCitationPublicationLinkOut],
    Literal["SYNC_COMPLETED", "SYNC_NEEDS_REVIEW"],
]:
    """人工回答冻结提交后同步完成确定性分析、引用分级归因与可选同屏人工确认。"""
    db.rollback()
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
    locked = lock_run(db, run_id)
    if locked is None:
        raise not_found("GEO 运行")
    _batch, run = locked
    analysis_id = prepare_revision(db, run, current_dictionary=False)
    db.commit()

    db.connection(execution_options={"isolation_level": "READ COMMITTED"})
    locked2 = lock_run(db, run_id)
    assert locked2 is not None
    batch, run = locked2
    analysis = db.scalar(
        select(GeoAnalysisRevision)
        .where(GeoAnalysisRevision.id == analysis_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    job = db.scalar(
        select(GeoAnalysisJob)
        .where(GeoAnalysisJob.analysis_revision_id == analysis_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert analysis is not None and job is not None
    now = database_now(db)
    token = uuid4()
    job.claimed_at = now
    job.lease_token = token
    job.lease_expires_at = now + timedelta(seconds=ANALYSIS_LEASE_SECONDS)
    run.status = run_transition(run_state(db, run), GeoRunStatus.ANALYZING).value
    run.lease_token, run.lease_expires_at = token, job.lease_expires_at
    run.revision += 1
    db.flush()

    analysis_input = execution.load_analysis_input(db, analysis)
    result = execution.analyze(analysis_input)
    execution.add_results(db, analysis.id, result)
    db.flush()
    job.lease_token = job.lease_expires_at = None
    db.flush()
    analysis.status, analysis.finished_at = "COMPLETED", now
    analysis.confidence_summary = {"mentions": None, "recommendations": None, "claims": None}
    analysis.review_required_reasons = list(result.review_required_reasons)
    db.flush()

    answer = db.scalar(select(GeoAnswerSnapshot).where(GeoAnswerSnapshot.run_id == run.id))
    assert answer is not None
    materialize_citation_links(db, answer_snapshot_id=answer.id)
    if inline_review is not None:
        _apply_inline_citation_decisions(
            db,
            answer_snapshot_id=answer.id,
            inline_review=inline_review,
            actor_id=actor.id,
            now=now,
        )

    has_pending_candidates = (
        db.scalar(
            select(GeoCitationPublicationLink.id)
            .join(GeoAnswerCitation, GeoAnswerCitation.id == GeoCitationPublicationLink.citation_id)
            .where(
                GeoAnswerCitation.answer_snapshot_id == answer.id,
                GeoCitationPublicationLink.link_status == "CANDIDATE",
            )
            .limit(1)
        )
        is not None
    )
    correction_payload = None
    has_unknown = False
    if inline_review is not None:
        correction_payload, has_unknown = _build_inline_correction_payload(
            db, analysis=analysis, inline_review=inline_review
        )

    force_needs_review = (
        bool(result.review_required_reasons)
        or has_pending_candidates
        or (inline_review is not None and (not inline_review.confirm_all or has_unknown))
    )
    run.status = run_transition(
        run_state(db, run),
        GeoRunStatus.NEEDS_REVIEW if force_needs_review else GeoRunStatus.COMPLETED,
    ).value
    run.finished_at = now if run.status == "COMPLETED" else None
    run.lease_token = run.lease_expires_at = None
    run.revision += 1
    db.flush()

    run.current_analysis_revision_id = analysis.id
    run.revision += 1
    db.flush()

    review_id: UUID | None = None
    if inline_review is not None:
        decision = (
            GeoReviewDecision.CORRECTED
            if correction_payload is not None
            else GeoReviewDecision.CONFIRMED
        )
        review = GeoRunReview(
            run_id=run.id,
            analysis_revision_id=analysis.id,
            decision=decision.value,
            correction_payload=(
                correction_payload.model_dump(mode="json")
                if correction_payload is not None
                else None
            ),
            comment=inline_review.comment.strip()
            or (
                "同屏人工修正并确认"
                if decision == GeoReviewDecision.CORRECTED
                else "同屏人工确认"
            ),
            reviewer_id=actor.id,
        )
        db.add(review)
        db.flush()
        db.refresh(review)
        review_id = review.id
        if (
            run.status == "NEEDS_REVIEW"
            and inline_review.confirm_all
            and not has_unknown
            and not has_pending_candidates
        ):
            run.status = run_transition(run_state(db, run), GeoRunStatus.COMPLETED).value
            run.finished_at = now
            run.revision += 1
            db.flush()
        append_audit(
            db,
            AuditEntry(
                actor_id=actor.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_observation_run.reviewed",
                target_type="GeoRunReview",
                target_id=review.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="人工录入同屏确认已记录",
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

    refresh_batch(db, batch, now)
    links = list_run_citation_links(db, run.id)
    final_status = GeoRunStatus(run.status)
    db.commit()
    dispatch_label: Literal["SYNC_COMPLETED", "SYNC_NEEDS_REVIEW"] = (
        "SYNC_COMPLETED" if final_status == GeoRunStatus.COMPLETED else "SYNC_NEEDS_REVIEW"
    )
    return final_status, analysis.id, review_id, links, dispatch_label
