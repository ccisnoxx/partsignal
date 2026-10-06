"""Run 详情同一快照内批量读取机器历史、复核历史和当前有效结果。"""

from typing import cast
from uuid import UUID

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import Session

from app.models.geo_analysis import (
    GeoAnalysisRevision,
    GeoClaimAssessment,
    GeoEntityMention,
    GeoRecommendation,
    GeoRunReview,
)
from app.models.geo_analysis_worker import GeoCitationClassification
from app.models.geo_runs import GeoObservationRun
from app.models.identity import User
from app.schemas.base import ContractModel
from app.schemas.geo_analysis import (
    GeoAnalysisRevisionOut,
    GeoAnalysisSelection,
    GeoClaimAssessmentOut,
    GeoEntityMentionOut,
    GeoRecommendationOut,
    GeoRunReviewOut,
)
from app.schemas.geo_reviews import (
    GeoAnalysisResult,
    GeoCitationClassificationOut,
    GeoReviewHistoryItem,
    GeoRunAnalysisDetail,
)
from app.services.geo_read_projections import incomplete
from app.services.geo_review_projection import reviewed_results


def analysis_detail(
    db: Session,
    *,
    run_id: UUID,
    run_status: str,
    current_analysis_id: UUID | None,
    answer_id: UUID | None,
    citation_count: int,
    actor: User,
) -> GeoRunAnalysisDetail:
    if (
        db.connection().get_isolation_level() not in {"REPEATABLE READ", "SERIALIZABLE"}
        or db.autoflush
    ):
        raise ValueError("分析详情必须在禁止autoflush的一致快照内读取")
    revisions = list(
        db.scalars(
            select(GeoAnalysisRevision)
            .where(GeoAnalysisRevision.run_id == run_id)
            .order_by(GeoAnalysisRevision.revision.desc())
            .execution_options(populate_existing=True)
        )
    )
    results = analysis_results(db, revisions, {run_id: citation_count})
    reviews = [
        GeoRunReviewOut.model_validate(row)
        for row in db.scalars(
            select(GeoRunReview)
            .where(GeoRunReview.run_id == run_id)
            .order_by(GeoRunReview.created_at.desc(), GeoRunReview.id.desc())
            .execution_options(populate_existing=True)
        )
    ]
    current = results.get(current_analysis_id) if current_analysis_id is not None else None
    if current_analysis_id is not None and (
        current is None
        or current.analysis.status != "COMPLETED"
        or current.analysis.answer_snapshot_id != answer_id
    ):
        raise incomplete()
    selected = next(
        (row for row in reviews if row.analysis_revision_id == current_analysis_id), None
    )
    required = (
        current is not None and bool(current.analysis.review_required_reasons) and selected is None
    )
    can_review = (
        current is not None
        and run_status in {"NEEDS_REVIEW", "COMPLETED", "FAILED"}
        and actor.is_active
        and not actor.must_change_password
        and actor.account_type in {"ADMIN", "ENGINEER"}
    )
    return GeoRunAnalysisDetail(
        selection=GeoAnalysisSelection(
            run_id=run_id,
            current_analysis_revision_id=current_analysis_id,
            current_review_id=selected.id if selected else None,
        ),
        revisions=list(results.values()),
        reviews=[
            GeoReviewHistoryItem(
                review=row, is_current=selected is not None and row.id == selected.id
            )
            for row in reviews
        ],
        effective_results=reviewed_results(current, selected, citation_count=citation_count)
        if current
        else None,
        review_required=required,
        review_gate_passed=current is not None and not required,
        available_actions=["REVIEW"] if can_review else [],
    )


def analysis_results(
    db: Session, revisions: list[GeoAnalysisRevision], citation_counts: dict[UUID, int]
) -> dict[UUID, GeoAnalysisResult]:
    """按明确历史revision集合加载；调用者拥有一致快照及答案引用数。"""
    results = {
        row.id: GeoAnalysisResult(
            analysis=GeoAnalysisRevisionOut.model_validate(row),
            mentions=[],
            recommendations=[],
            claims=[],
            citations=[],
            citation_classification_complete=False,
        )
        for row in revisions
    }
    # 四种子结果按完整revision集合各一次加载，没有逐版本查询。
    models: tuple[
        tuple[
            type[GeoEntityMention]
            | type[GeoRecommendation]
            | type[GeoClaimAssessment]
            | type[GeoCitationClassification],
            type[ContractModel],
            str,
        ],
        ...,
    ] = (
        (GeoEntityMention, GeoEntityMentionOut, "mentions"),
        (GeoRecommendation, GeoRecommendationOut, "recommendations"),
        (GeoClaimAssessment, GeoClaimAssessmentOut, "claims"),
        (GeoCitationClassification, GeoCitationClassificationOut, "citations"),
    )
    for model, schema, field in models:
        rows = db.scalars(select(model).where(model.analysis_revision_id.in_(results)))
        for raw in rows:
            row = cast(
                GeoEntityMention
                | GeoRecommendation
                | GeoClaimAssessment
                | GeoCitationClassification,
                raw,
            )
            getattr(results[row.analysis_revision_id], field).append(schema.model_validate(row))
    for result in results.values():
        result.mentions.sort(key=lambda row: str(row.subject_id))
        result.recommendations.sort(key=lambda row: str(row.subject_id))
        result.claims.sort(key=lambda row: str(row.id))
        result.citations.sort(key=lambda row: str(row.citation_id))
        result.citation_classification_complete = (
            result.analysis.status == "COMPLETED"
            and len(result.citations) == citation_counts[result.analysis.run_id]
        )
    return results


def review_required_expression() -> ColumnElement[bool]:
    """列表与筛选共用当前pointer内的人工门禁，不从采集终态反推。"""
    return (
        select(GeoAnalysisRevision.id)
        .where(
            GeoAnalysisRevision.id == GeoObservationRun.current_analysis_revision_id,
            GeoAnalysisRevision.status == "COMPLETED",
            func.jsonb_array_length(GeoAnalysisRevision.review_required_reasons) > 0,
            ~select(GeoRunReview.id)
            .where(
                GeoRunReview.run_id == GeoAnalysisRevision.run_id,
                GeoRunReview.analysis_revision_id == GeoAnalysisRevision.id,
            )
            .exists(),
        )
        .exists()
    )
