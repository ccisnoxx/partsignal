"""最新有效 Review 对机器结果的纯投影；历史修正不会累计。"""

from app.schemas.geo_analysis import (
    GeoMentionCorrection,
    GeoRecommendationCorrection,
    GeoReviewDecision,
    GeoRunReviewOut,
)
from app.schemas.geo_reviews import (
    GeoAnalysisResult,
    GeoCitationClassificationOut,
    GeoReviewedResults,
)


def reviewed_results(
    machine: GeoAnalysisResult, review: GeoRunReviewOut | None, *, citation_count: int
) -> GeoReviewedResults:
    mentions = {
        row.subject_id: GeoMentionCorrection(
            subject_id=row.subject_id,
            mention_count=row.mention_count,
            first_character_offset=row.first_character_offset,
            matched_aliases=row.matched_aliases,
        )
        for row in machine.mentions
    }
    recommendations = {
        row.subject_id: GeoRecommendationCorrection(
            subject_id=row.subject_id,
            recommendation=row.recommendation,
            rank=row.rank,
            rationale_excerpt=row.rationale_excerpt,
        )
        for row in machine.recommendations
    }
    claims = {row.id: row for row in machine.claims}
    citations = {row.citation_id: row for row in machine.citations}
    if review is not None:
        if (
            review.analysis_revision_id != machine.analysis.id
            or review.run_id != machine.analysis.run_id
        ):
            raise ValueError("有效复核必须属于当前机器分析")
        if review.decision == GeoReviewDecision.CORRECTED:
            payload = review.correction_payload
            assert payload is not None
            mentions.update((row.subject_id, row) for row in payload.mentions)
            recommendations.update((row.subject_id, row) for row in payload.recommendations)
            for row in payload.claims:
                original = claims[row.claim_assessment_id]
                claims[original.id] = original.model_copy(
                    update={
                        "verdict": row.verdict,
                        "severity": row.severity,
                        "explanation": row.explanation,
                        # 人工结论不沿用机器对原判断的置信度。
                        "confidence": None,
                    }
                )
            citations.update(
                (
                    row.citation_id,
                    GeoCitationClassificationOut(
                        analysis_revision_id=machine.analysis.id,
                        citation_id=row.citation_id,
                        source_category=row.source_category,
                        subject_id=row.subject_id,
                    ),
                )
                for row in payload.citations
            )
    return GeoReviewedResults(
        mentions=sorted(mentions.values(), key=lambda row: str(row.subject_id)),
        recommendations=sorted(recommendations.values(), key=lambda row: str(row.subject_id)),
        claims=sorted(claims.values(), key=lambda row: str(row.id)),
        citations=sorted(citations.values(), key=lambda row: str(row.citation_id)),
        citation_classification_complete=len(citations) == citation_count,
    )
