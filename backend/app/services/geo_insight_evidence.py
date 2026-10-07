"""把一致快照中的协议值转换为冻结洞察证据；不查询、不重判声明、不访问URL。"""

from dataclasses import dataclass, field
from uuid import UUID

from app.schemas.geo_analysis import (
    GeoClaimKind,
    GeoClaimSeverity,
    GeoClaimVerdict,
    GeoRunReviewOut,
    GeoSourceCategory,
)
from app.schemas.geo_answers import GeoAnswerCitationOut, GeoAnswerSnapshotOut
from app.schemas.geo_reviews import GeoAnalysisResult
from app.schemas.geo_runs import GeoRunInputSnapshot
from app.services.geo_citation_rules import freeze_subject_domains, match_citation_hostname
from app.services.geo_review_projection import reviewed_results


@dataclass(frozen=True)
class InsightCitation:
    citation_id: UUID
    normalized_url: str = field(repr=False)
    hostname: str = field(repr=False)
    title: str | None = field(repr=False)
    occurrences: tuple[int, ...]
    source_category: GeoSourceCategory | None
    attributed_subject_id: UUID | None
    candidate_subject_ids: tuple[UUID, ...]

    @property
    def shared_domain(self) -> bool:
        return len(self.candidate_subject_ids) > 1


@dataclass(frozen=True)
class InsightClaim:
    claim_assessment_id: UUID
    subject_id: UUID
    fact_version_id: UUID | None
    claim_kind: GeoClaimKind
    claim_text: str = field(repr=False)
    verdict: GeoClaimVerdict
    severity: GeoClaimSeverity
    fact_excerpt: str | None = field(repr=False)
    explanation: str = field(repr=False)


@dataclass(frozen=True)
class InsightEvidence:
    citations: tuple[InsightCitation, ...] = ()
    claims: tuple[InsightClaim, ...] = ()
    source_model: str | None = None
    source_product: str | None = None
    source_version: str | None = None
    analyzer_version: str | None = None
    rule_set_version: str | None = None
    review_required_reasons: tuple[str, ...] = ()


def freeze_insight_evidence(
    snapshot: GeoRunInputSnapshot,
    answer: GeoAnswerSnapshotOut | None,
    citations: list[GeoAnswerCitationOut],
    current: GeoAnalysisResult | None,
    review: GeoRunReviewOut | None,
    *,
    available: bool,
) -> InsightEvidence:
    effective = (
        reviewed_results(current, review, citation_count=len(citations))
        if current and available
        else None
    )
    categories = {c.citation_id: c for c in effective.citations} if effective else {}
    domains = freeze_subject_domains(
        current.analysis.input_snapshot.subjects if current and available else snapshot.subjects
    )
    return InsightEvidence(
        citations=tuple(
            InsightCitation(
                row.id,
                row.normalized_url,
                row.hostname,
                row.title,
                tuple(row.occurrences),
                categories[row.id].source_category if row.id in categories else None,
                categories[row.id].subject_id if row.id in categories else None,
                tuple(
                    sorted(
                        {
                            m.subject_id
                            for m in match_citation_hostname(row.hostname, domains)
                            if m.subject_id is not None
                        }
                    )
                ),
            )
            for row in sorted(citations, key=lambda c: c.id)
        ),
        claims=tuple(
            InsightClaim(
                row.id,
                row.subject_id,
                row.fact_version_id,
                row.claim_kind,
                row.claim_text,
                row.verdict,
                row.severity,
                row.fact_excerpt,
                row.explanation,
            )
            for row in effective.claims
        )
        if effective
        else (),
        source_model=answer.source_model if answer else None,
        source_product=answer.source_product if answer else None,
        source_version=answer.source_version if answer else None,
        analyzer_version=current.analysis.analyzer_version if current and available else None,
        rule_set_version=current.analysis.input_snapshot.configuration.rule_set_version
        if current and available
        else None,
        review_required_reasons=tuple(current.analysis.review_required_reasons)
        if current and available
        else (),
    )
