"""来源页批量读取明确的历史analysis/review；禁止回退到当前pointer。"""

from collections import defaultdict
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.geo_analysis import GeoAnalysisRevision, GeoRunReview
from app.models.geo_answers import GeoAnswerCitation, GeoAnswerSnapshot
from app.models.geo_opportunities import GeoOpportunitySource as Source
from app.models.geo_runs import GeoObservationRun
from app.schemas.geo_analysis import GeoRunReviewOut
from app.schemas.geo_answers import GeoAnswerCitationOut, GeoAnswerSnapshotOut
from app.schemas.geo_opportunity_workbench import (
    GeoOpportunitySourceEvidence,
    GeoOpportunitySourceFilters,
    GeoOpportunitySourcePage,
)
from app.schemas.geo_runs import GeoObservationRunOut
from app.services.geo_analysis_queries import analysis_results
from app.services.geo_answer_evidence import answer_evidence_files
from app.services.geo_read_projections import incomplete
from app.services.geo_review_projection import reviewed_results


def source_page(
    db: Session, opportunity_id: UUID, filters: GeoOpportunitySourceFilters, as_of: datetime
) -> GeoOpportunitySourcePage:
    query = select(Source).where(Source.opportunity_id == opportunity_id)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    sources = list(
        db.scalars(
            query.order_by(Source.created_at, Source.id)
            .offset((filters.source_page - 1) * filters.source_page_size)
            .limit(filters.source_page_size)
        )
    )
    run_ids = {row.run_id for row in sources}
    # 公共投影显式选列，读请求不读取内部lease_token授权信息。
    runs = {
        row["id"]: GeoObservationRunOut.model_validate(dict(row))
        for row in db.execute(
            select(
                *(getattr(GeoObservationRun, field) for field in GeoObservationRunOut.model_fields)
            ).where(GeoObservationRun.id.in_(run_ids))
        ).mappings()
    }
    if set(runs) != run_ids:
        raise incomplete()
    answers = {
        row.run_id: row
        for row in db.scalars(
            select(GeoAnswerSnapshot).where(GeoAnswerSnapshot.run_id.in_(run_ids))
        )
    }
    citations: dict[UUID, list[GeoAnswerCitationOut]] = defaultdict(list)
    for row in db.scalars(
        select(GeoAnswerCitation)
        .where(GeoAnswerCitation.answer_snapshot_id.in_([answer.id for answer in answers.values()]))
        .order_by(GeoAnswerCitation.position, GeoAnswerCitation.id)
    ):
        citations[row.answer_snapshot_id].append(GeoAnswerCitationOut.model_validate(row))
    for run_id, run in runs.items():
        answer = answers.get(run_id)
        if (answer is None and run.collected_at is not None) or (
            answer is not None and len(citations[answer.id]) != answer.citation_count
        ):
            raise incomplete()
    analysis_ids = {
        row.analysis_revision_id for row in sources if row.analysis_revision_id is not None
    }
    revisions = list(
        db.scalars(select(GeoAnalysisRevision).where(GeoAnalysisRevision.id.in_(analysis_ids)))
    )
    if {row.id for row in revisions} != analysis_ids:
        raise incomplete()
    for revision in revisions:
        answer = answers.get(revision.run_id)
        if (
            revision.run_id not in runs
            or answer is None
            or revision.answer_snapshot_id != answer.id
            or revision.status != "COMPLETED"
        ):
            raise incomplete()
    results = analysis_results(
        db, revisions, {run_id: answer.citation_count for run_id, answer in answers.items()}
    )
    review_ids = {row.review_id for row in sources if row.review_id is not None}
    reviews = {
        row.id: GeoRunReviewOut.model_validate(row)
        for row in db.scalars(select(GeoRunReview).where(GeoRunReview.id.in_(review_ids)))
    }
    if set(reviews) != review_ids:
        raise incomplete()
    files = answer_evidence_files(db, list(answers.values()), as_of)
    items = []
    for source in sources:
        run = runs[source.run_id]
        answer = answers.get(source.run_id)
        result = results.get(source.analysis_revision_id) if source.analysis_revision_id else None
        review = reviews.get(source.review_id) if source.review_id else None
        if (result is not None and result.analysis.run_id != source.run_id) or (
            review is not None
            and (
                result is None
                or review.run_id != source.run_id
                or review.analysis_revision_id != result.analysis.id
            )
        ):
            raise incomplete()
        items.append(
            GeoOpportunitySourceEvidence(
                id=source.id,
                run_id=source.run_id,
                analysis_revision_id=source.analysis_revision_id,
                review_id=source.review_id,
                source_role=source.source_role,
                created_at=source.created_at,
                run=run,
                answer=GeoAnswerSnapshotOut.model_validate(answer) if answer else None,
                citations=citations[answer.id] if answer else [],
                evidence_files=files[answer.id] if answer else [],
                analysis=result,
                review=review,
                effective_results=reviewed_results(
                    result, review, citation_count=answer.citation_count
                )
                if result and answer
                else None,
            )
        )
    return GeoOpportunitySourcePage(
        items=items, total=total, page=filters.source_page, page_size=filters.source_page_size
    )
