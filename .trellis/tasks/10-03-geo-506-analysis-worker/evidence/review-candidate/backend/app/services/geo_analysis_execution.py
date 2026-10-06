"""将冻结持久化输入转换为规则输入；纯计算与 normalized 结果装配。"""

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.geo_analysis import (
    GeoAnalysisRevision,
    GeoClaimAssessment,
    GeoEntityMention,
    GeoRecommendation,
)
from app.models.geo_analysis_worker import GeoCitationClassification
from app.models.geo_answers import GeoAnswerCitation, GeoAnswerSnapshot
from app.models.product_facts import FactVersion
from app.schemas.geo_analysis import GeoAnalysisInputSnapshot
from app.schemas.geo_answers import GeoAnswerCitationOut
from app.schemas.product_facts import Confidentiality, FactVersionStatus
from app.services.geo_analysis import (
    MentionAnalysis,
    RecommendationAnalysis,
    classify_citations,
    classify_recommendations,
    freeze_subject_aliases,
    identify_mentions,
)
from app.services.geo_analysis_inputs import ANALYZER_VERSION, RULE_SET_VERSION
from app.services.geo_citation_rules import CitationAnalysis, freeze_subject_domains
from app.services.geo_claims import ClaimAnalysis, assess_claims
from app.services.geo_fact_versions import FactAssembly, FactCandidate, SubjectFact


@dataclass(frozen=True, repr=False)
class AnalysisInput:
    snapshot: GeoAnalysisInputSnapshot
    answer_text: str
    citations: tuple[GeoAnswerCitationOut, ...]
    facts: FactAssembly


@dataclass(frozen=True, repr=False)
class AnalysisResult:
    mentions: MentionAnalysis
    recommendations: RecommendationAnalysis
    citations: CitationAnalysis
    claims: ClaimAnalysis
    review_required_reasons: tuple[str, ...] = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "review_required_reasons",
            tuple(
                sorted(
                    {
                        reason
                        for stage in (
                            self.mentions,
                            self.recommendations,
                            self.citations,
                            self.claims,
                        )
                        for reason in stage.review_required_reasons
                    }
                )
            ),
        )


def load_analysis_input(db: Session, analysis: GeoAnalysisRevision) -> AnalysisInput:
    snapshot = GeoAnalysisInputSnapshot.model_validate(analysis.input_snapshot)
    if (
        analysis.analyzer_type != "DETERMINISTIC"
        or analysis.analyzer_version != ANALYZER_VERSION
        or snapshot.configuration.rule_set_version != RULE_SET_VERSION
    ):
        raise ValueError("当前 Worker 无法执行该冻结分析器版本")
    answer = db.get(GeoAnswerSnapshot, analysis.answer_snapshot_id)
    assert answer is not None and answer.answer_sha256 == snapshot.answer_sha256
    citations = tuple(
        GeoAnswerCitationOut.model_validate(row, from_attributes=True)
        for row in db.scalars(
            select(GeoAnswerCitation)
            .where(
                GeoAnswerCitation.answer_snapshot_id == answer.id,
            )
            .order_by(GeoAnswerCitation.position)
        )
    )
    bindings = {row.subject_id: row.fact_version_id for row in snapshot.fact_versions}
    rows = list(db.scalars(select(FactVersion).where(FactVersion.id.in_(bindings.values()))))
    facts = {
        row.id: FactCandidate(
            row.id,
            row.product_id,
            row.version,
            FactVersionStatus.APPROVED,
            Confidentiality(row.classification),
            row.body_markdown,
        )
        for row in rows
    }
    # 绑定创建时资格已由0054裁决；历史 APPROVED 正文不可修改，即使后来归档仍使用原绑定。
    assembly = FactAssembly(
        tuple(
            SubjectFact(
                row.id,
                row.product_id,
                row.revision,
                facts[bindings[row.id]] if row.id in bindings else None,
            )
            for row in snapshot.subjects
            if row.subject_type == "OWN_PRODUCT" and row.product_id is not None
        )
    )
    return AnalysisInput(snapshot, answer.answer_text, citations, assembly)


def analyze(value: AnalysisInput) -> AnalysisResult:
    aliases = freeze_subject_aliases(value.snapshot.subjects)
    return AnalysisResult(
        identify_mentions(value.answer_text, aliases),
        classify_recommendations(value.answer_text, aliases),
        classify_citations(value.citations, freeze_subject_domains(value.snapshot.subjects)),
        assess_claims(value.answer_text, value.snapshot.subjects, value.facts),
    )


def add_results(db: Session, analysis_id: UUID, result: AnalysisResult) -> None:
    """调用方在 PENDING lease 内一次装配；flush/终结/commit 由生命周期 owner 执行。"""
    db.add_all(
        [
            GeoEntityMention(
                analysis_revision_id=analysis_id,
                subject_id=row.subject_id,
                mention_count=row.mention_count,
                first_character_offset=row.first_character_offset,
                matched_aliases=list(row.matched_aliases),
                confidence=None,
            )
            for row in result.mentions.mentions
        ]
    )
    db.add_all(
        [
            GeoRecommendation(
                analysis_revision_id=analysis_id,
                subject_id=row.subject_id,
                recommendation=row.recommendation.value,
                rank=row.rank,
                rationale_excerpt=row.rationale_excerpt,
                confidence=row.confidence,
            )
            for row in result.recommendations.recommendations
        ]
    )
    db.add_all(
        [
            GeoCitationClassification(
                analysis_revision_id=analysis_id,
                citation_id=row.evidence.citation_id,
                source_category=row.source_category.value,
                subject_id=row.subject_id,
            )
            for row in result.citations.citations
        ]
    )
    db.add_all(
        [
            GeoClaimAssessment(
                analysis_revision_id=analysis_id,
                subject_id=row.subject_id,
                fact_version_id=row.fact_version_id,
                claim_kind=row.claim_kind.value,
                claim_text=row.claim_text,
                verdict=row.verdict.value,
                severity=row.severity.value,
                fact_excerpt=row.fact_excerpt,
                explanation=row.explanation,
                confidence=row.confidence,
            )
            for row in result.claims.assessments
        ]
    )
