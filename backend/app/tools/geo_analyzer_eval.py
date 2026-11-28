"""GEO 分析器离线黄金集基准评估工具（支持 JSON 输出与质量门禁退出码）。"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from app.schemas.geo_analysis import GeoSourceCategory
from app.schemas.geo_answers import GeoAnswerCitationInput, GeoAnswerCitationOut
from app.schemas.geo_catalog import GeoSubjectAliasKind, GeoSubjectType
from app.schemas.geo_monitoring_plans import GeoPlanSubjectRole
from app.schemas.geo_runs import GeoRunAliasSnapshot, GeoRunDomainSnapshot, GeoRunSubjectSnapshot
from app.schemas.product_facts import Confidentiality, FactVersionStatus
from app.services.geo_analysis import (
    classify_citations,
    classify_recommendations,
    freeze_subject_aliases,
    identify_mentions,
)
from app.services.geo_analysis_inputs import ANALYZER_VERSION, RULE_SET_VERSION
from app.services.geo_analyzer_eval import (
    AnalyzerEvalReport,
    AnalyzerEvalThresholds,
    EvalAmbiguityItem,
    EvalCaseGold,
    EvalCasePrediction,
    EvalCitationItem,
    EvalClaimItem,
    EvalMentionItem,
    EvalRecommendationItem,
    evaluate_analyzer_predictions,
)
from app.services.geo_answer_citations import prepare_answer_citations
from app.services.geo_catalog_normalization import catalog_text_key
from app.services.geo_citation_rules import freeze_source_categories, freeze_subject_domains
from app.services.geo_claims import assess_claims
from app.services.geo_fact_versions import FactCandidate, freeze_fact_versions

DEFAULT_GOLDEN_THRESHOLDS = AnalyzerEvalThresholds(
    min_mention_f1=0.95,
    min_ambiguity_f1=0.95,
    min_recommendation_macro_f1=0.95,
    min_recommendation_kappa=0.90,
    min_rank_exact_accuracy=0.95,
    min_citation_f1=0.95,
    min_citation_category_accuracy=1.0,
    min_claim_span_f1=0.95,
    min_claim_verdict_agreement=0.95,
    min_claim_verdict_kappa=0.90,
    max_critical_error_false_negatives=0,
    min_review_trigger_recall=1.0,
)

_FIXTURE_CREATED_AT = datetime(2026, 1, 1, tzinfo=UTC)


def _uid(label: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"geo-analyzer-eval:{label}")


def _subject_snapshots(
    corpus_subjects: list[dict[str, Any]],
    selected_ids: list[str],
) -> tuple[list[GeoRunSubjectSnapshot], dict[UUID, str]]:
    indexed = {row["id"]: row for row in corpus_subjects}
    id_to_label: dict[UUID, str] = {}
    snapshots: list[GeoRunSubjectSnapshot] = []
    for label in selected_ids:
        row = indexed[label]
        uid = _uid(label)
        id_to_label[uid] = label
        kind = GeoSubjectType(row["subject_type"])
        snapshots.append(
            GeoRunSubjectSnapshot(
                id=uid,
                revision=1,
                subject_type=kind,
                role=GeoPlanSubjectRole.PRIMARY,
                product_id=_uid(row["product_id"]) if row.get("product_id") else None,
                parent_subject_id=(
                    _uid(row["parent_subject_id"]) if row.get("parent_subject_id") else None
                ),
                canonical_name=row["name"],
                display_name=row["name"],
                aliases=[
                    GeoRunAliasSnapshot(
                        alias=alias,
                        normalized_alias=catalog_text_key(alias),
                        alias_kind=(
                            GeoSubjectAliasKind.PART_NUMBER
                            if kind
                            in {GeoSubjectType.OWN_PRODUCT, GeoSubjectType.COMPETITOR_PRODUCT}
                            else GeoSubjectAliasKind.NAME
                        ),
                        language_code="en" if alias.isascii() else "zh-CN",
                    )
                    for alias in row["aliases"]
                ],
                domains=[
                    GeoRunDomainSnapshot(hostname=host, relation_type="OFFICIAL")
                    for host in row["domains"]
                ],
            )
        )
    return snapshots, id_to_label


def _fact_candidates(
    corpus_facts: list[dict[str, Any]],
    overrides: dict[str, dict[str, str]],
) -> list[FactCandidate]:
    result: list[FactCandidate] = []
    for row in corpus_facts:
        override = overrides.get(row["product_id"])
        status = FactVersionStatus(override["status"] if override else row["status"])
        markdown = override["markdown"] if override else row["markdown"]
        result.append(
            FactCandidate(
                id=_uid(row["id"]),
                product_id=_uid(row["product_id"]),
                version=row["version"],
                status=status,
                classification=Confidentiality(row["classification"]),
                body_markdown=markdown,
            )
        )
    return result


def _prepare_citation_outs(
    case_id: str,
    raw_citations: list[dict[str, Any]],
) -> list[GeoAnswerCitationOut]:
    if not raw_citations:
        return []
    prepared = prepare_answer_citations(
        [
            GeoAnswerCitationInput(
                original_url=row["url"],
                title=row["title"],
                position=row["position"],
                extraction_source="MANUAL",
            )
            for row in raw_citations
        ]
    )
    answer_uid = _uid(f"answer:{case_id}")
    return [
        GeoAnswerCitationOut(
            id=_uid(f"citation:{case_id}:{idx}"),
            answer_snapshot_id=answer_uid,
            original_url=item.original_url,
            normalized_url=item.normalized_url,
            hostname=item.hostname,
            title=item.title,
            position=item.position,
            occurrences=list(item.occurrences),
            extraction_source="MANUAL",
            created_at=_FIXTURE_CREATED_AT,
        )
        for idx, item in enumerate(prepared, start=1)
    ]


def evaluate_eval_golden_bundle(
    shared_corpus: dict[str, Any],
    eval_bundle: dict[str, Any],
) -> AnalyzerEvalReport:
    """对端到端黄金评估集执行完整确定性分析管线并汇总五维评估报告。"""
    source_rules = freeze_source_categories(
        "geo-eval-golden-categories-v1",
        [
            (row["hostname"], GeoSourceCategory(row["source_category"]))
            for row in eval_bundle["source_category_rules"]
        ],
    )
    gold_cases: list[EvalCaseGold] = []
    predictions: list[EvalCasePrediction] = []

    for case in eval_bundle["cases"]:
        text: str = case["text"]
        snapshots, id_to_label = _subject_snapshots(shared_corpus["subjects"], case["subject_ids"])
        aliases = freeze_subject_aliases(snapshots)
        mentions = identify_mentions(text, aliases)
        recommendations = classify_recommendations(text, aliases)
        citation_outs = _prepare_citation_outs(case["id"], case["citations"])
        citations = classify_citations(
            citation_outs,
            freeze_subject_domains(snapshots, source_categories=source_rules),
        )
        facts = freeze_fact_versions(
            snapshots,
            _fact_candidates(shared_corpus["fact_versions"], case["fact_overrides"]),
        )
        claims = assess_claims(text, snapshots, facts)

        url_by_cit_id = {row.id: row.normalized_url for row in citation_outs}
        review_reasons = {
            *mentions.review_required_reasons,
            *recommendations.review_required_reasons,
            *citations.review_required_reasons,
            *claims.review_required_reasons,
        }
        predictions.append(
            EvalCasePrediction(
                case_id=case["id"],
                mentions=tuple(
                    EvalMentionItem(subject_id=id_to_label[row.subject_id])
                    for row in mentions.mentions
                ),
                ambiguities=tuple(
                    EvalAmbiguityItem(
                        candidate_subject_ids=frozenset(
                            id_to_label[sid] for sid in row.candidate_subject_ids
                        ),
                        excerpt=row.excerpt,
                    )
                    for row in mentions.ambiguities
                ),
                recommendations=tuple(
                    EvalRecommendationItem(
                        subject_id=id_to_label[row.subject_id],
                        recommendation=row.recommendation.value,
                        rank=row.rank,
                    )
                    for row in recommendations.recommendations
                ),
                citations=tuple(
                    EvalCitationItem(
                        normalized_url=url_by_cit_id[row.evidence.citation_id],
                        source_category=row.source_category.value,
                    )
                    for row in citations.citations
                ),
                claims=tuple(
                    EvalClaimItem(
                        subject_id=id_to_label[row.subject_id],
                        claim_kind=row.claim_kind.value,
                        start=row.start,
                        end=row.end,
                        verdict=row.verdict.value,
                        severity=row.severity.value,
                    )
                    for row in claims.assessments
                ),
                review_required=bool(review_reasons),
            )
        )

        exp = case["expected"]
        gold_claims: list[EvalClaimItem] = []
        for item in exp["claims"]:
            start = text.index(item["excerpt"])
            gold_claims.append(
                EvalClaimItem(
                    subject_id=item["subject_id"],
                    claim_kind=item["claim_kind"],
                    start=start,
                    end=start + len(item["excerpt"]),
                    verdict=item["verdict"],
                    severity=item["severity"],
                )
            )
        gold_cases.append(
            EvalCaseGold(
                case_id=case["id"],
                mentions=tuple(EvalMentionItem(subject_id=sid) for sid in exp["mentions"]),
                ambiguities=tuple(
                    EvalAmbiguityItem(
                        candidate_subject_ids=frozenset(row["subject_ids"]),
                        excerpt=row["excerpt"],
                    )
                    for row in exp["ambiguities"]
                ),
                recommendations=tuple(
                    EvalRecommendationItem(
                        subject_id=row["subject_id"],
                        recommendation=row["recommendation"],
                        rank=row["rank"],
                    )
                    for row in exp["recommendations"]
                ),
                citations=tuple(
                    EvalCitationItem(
                        normalized_url=row["normalized_url"],
                        source_category=row["source_category"],
                    )
                    for row in exp["citations"]
                ),
                claims=tuple(gold_claims),
                review_required=bool(exp["review_required"]),
            )
        )

    return evaluate_analyzer_predictions(
        dataset_id=eval_bundle["dataset_id"],
        analyzer_version=ANALYZER_VERSION,
        rule_set_version=RULE_SET_VERSION,
        gold_cases=gold_cases,
        predictions=predictions,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="离线运行 GEO 分析器黄金评估集基准测试")
    parser.add_argument("--json", action="store_true", help="以 JSON 格式输出完整评估报告")
    args = parser.parse_args(argv)

    fixtures_dir = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "geo_analysis"
    corpus = json.loads((fixtures_dir / "v1" / "corpus.json").read_text(encoding="utf-8"))
    eval_bundle = json.loads((fixtures_dir / "eval-golden-v1.json").read_text(encoding="utf-8"))
    report = evaluate_eval_golden_bundle(corpus, eval_bundle)
    violations = report.check_thresholds(DEFAULT_GOLDEN_THRESHOLDS)
    if args.json:
        payload = {"report": report.to_dict(), "violations": violations}
        print(json.dumps(payload, ensure_ascii=False))
    else:
        print(
            f"[GEO Analyzer Eval] dataset={report.dataset_id} cases={report.case_count} "
            f"analyzer={report.analyzer_version} rules={report.rule_set_version}"
        )
        print(
            f"  Mentions: F1={report.mentions.entity.f1} "
            f"(P={report.mentions.entity.precision}, R={report.mentions.entity.recall}), "
            f"Ambiguity F1={report.mentions.ambiguity.f1}"
        )
        print(
            f"  Recommendations: MacroF1={report.recommendations.macro_f1}, "
            f"Kappa={report.recommendations.cohen_kappa}, "
            f"RankExact={report.recommendations.rank_exact_accuracy}"
        )
        print(
            f"  Citations: URL F1={report.citations.url_match.f1}, "
            f"CategoryAcc={report.citations.category_accuracy}"
        )
        print(
            f"  Claims: SpanF1={report.claims.span.f1}, "
            f"VerdictAgree={report.claims.verdict_agreement_rate}, "
            f"VerdictKappa={report.claims.verdict_cohen_kappa}, "
            f"CriticalFN={report.claims.critical_error_false_negative_count}"
        )
        print(
            f"  ReviewTrigger: P={report.review_trigger.precision}, "
            f"R={report.review_trigger.recall}, F1={report.review_trigger.f1}"
        )
        if violations:
            print(f"  FAILED THRESHOLDS: {violations}", file=sys.stderr)
    return 1 if violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
