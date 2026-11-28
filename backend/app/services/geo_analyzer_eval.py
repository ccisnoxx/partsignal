"""GEO 分析器离线黄金评估引擎：精确率/召回率/F1、Macro F1、Span F1 与 Cohen's κ。

纯内存统计与评估合同，零数据库/网络依赖；既可评估当前 DETERMINISTIC 分析器，
也可直接复用至未来 HYBRID / EXTERNAL_MODEL 分析器或人工复核一致性评估。
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any

RECOMMENDATION_CLASSES = ("RECOMMENDED", "CONSIDERED", "NOT_RECOMMENDED", "UNKNOWN")
VERDICT_CLASSES = ("ACCURATE", "PARTIAL", "INCORRECT", "UNJUDGEABLE")
CRITICAL_SEVERITIES = frozenset({"HIGH", "CRITICAL"})
_ROUND = 6


@dataclass(frozen=True, slots=True)
class EvalMentionItem:
    subject_id: str


@dataclass(frozen=True, slots=True)
class EvalAmbiguityItem:
    candidate_subject_ids: frozenset[str]
    excerpt: str


@dataclass(frozen=True, slots=True)
class EvalRecommendationItem:
    subject_id: str
    recommendation: str
    rank: int | None = None


@dataclass(frozen=True, slots=True)
class EvalCitationItem:
    normalized_url: str
    source_category: str


@dataclass(frozen=True, slots=True)
class EvalClaimItem:
    subject_id: str
    claim_kind: str
    start: int
    end: int
    verdict: str
    severity: str


@dataclass(frozen=True, slots=True)
class EvalCaseGold:
    case_id: str
    mentions: tuple[EvalMentionItem, ...] = ()
    ambiguities: tuple[EvalAmbiguityItem, ...] = ()
    recommendations: tuple[EvalRecommendationItem, ...] = ()
    citations: tuple[EvalCitationItem, ...] = ()
    claims: tuple[EvalClaimItem, ...] = ()
    review_required: bool = False


@dataclass(frozen=True, slots=True)
class EvalCasePrediction:
    case_id: str
    mentions: tuple[EvalMentionItem, ...] = ()
    ambiguities: tuple[EvalAmbiguityItem, ...] = ()
    recommendations: tuple[EvalRecommendationItem, ...] = ()
    citations: tuple[EvalCitationItem, ...] = ()
    claims: tuple[EvalClaimItem, ...] = ()
    review_required: bool = False


@dataclass(frozen=True, slots=True)
class BinaryPRF:
    tp: int
    fp: int
    fn: int
    precision: float | None
    recall: float | None
    f1: float | None


@dataclass(frozen=True, slots=True)
class MentionEvalMetrics:
    entity: BinaryPRF
    ambiguity: BinaryPRF


@dataclass(frozen=True, slots=True)
class RecommendationEvalMetrics:
    sample_count: int
    macro_f1: float | None
    cohen_kappa: float | None
    exact_accuracy: float | None
    rank_exact_accuracy: float | None
    per_class_f1: dict[str, float | None]


@dataclass(frozen=True, slots=True)
class CitationEvalMetrics:
    url_match: BinaryPRF
    matched_count: int
    category_accuracy: float | None


@dataclass(frozen=True, slots=True)
class ClaimEvalMetrics:
    span: BinaryPRF
    matched_count: int
    verdict_agreement_rate: float | None
    verdict_cohen_kappa: float | None
    severity_agreement_rate: float | None
    critical_error_false_negative_count: int


@dataclass(frozen=True, slots=True)
class AnalyzerEvalThresholds:
    min_mention_f1: float | None = None
    min_ambiguity_f1: float | None = None
    min_recommendation_macro_f1: float | None = None
    min_recommendation_kappa: float | None = None
    min_rank_exact_accuracy: float | None = None
    min_citation_f1: float | None = None
    min_citation_category_accuracy: float | None = None
    min_claim_span_f1: float | None = None
    min_claim_verdict_agreement: float | None = None
    min_claim_verdict_kappa: float | None = None
    max_critical_error_false_negatives: int | None = 0
    min_review_trigger_recall: float | None = None


@dataclass(frozen=True, slots=True)
class AnalyzerEvalReport:
    dataset_id: str
    analyzer_version: str
    rule_set_version: str
    case_count: int
    mentions: MentionEvalMetrics
    recommendations: RecommendationEvalMetrics
    citations: CitationEvalMetrics
    claims: ClaimEvalMetrics
    review_trigger: BinaryPRF

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def check_thresholds(self, thresholds: AnalyzerEvalThresholds) -> list[str]:
        violations: list[str] = []
        checks: tuple[tuple[str, float | None, float | None], ...] = (
            ("mention_f1", self.mentions.entity.f1, thresholds.min_mention_f1),
            ("ambiguity_f1", self.mentions.ambiguity.f1, thresholds.min_ambiguity_f1),
            (
                "recommendation_macro_f1",
                self.recommendations.macro_f1,
                thresholds.min_recommendation_macro_f1,
            ),
            (
                "recommendation_kappa",
                self.recommendations.cohen_kappa,
                thresholds.min_recommendation_kappa,
            ),
            (
                "rank_exact_accuracy",
                self.recommendations.rank_exact_accuracy,
                thresholds.min_rank_exact_accuracy,
            ),
            ("citation_f1", self.citations.url_match.f1, thresholds.min_citation_f1),
            (
                "citation_category_accuracy",
                self.citations.category_accuracy,
                thresholds.min_citation_category_accuracy,
            ),
            ("claim_span_f1", self.claims.span.f1, thresholds.min_claim_span_f1),
            (
                "claim_verdict_agreement",
                self.claims.verdict_agreement_rate,
                thresholds.min_claim_verdict_agreement,
            ),
            (
                "claim_verdict_kappa",
                self.claims.verdict_cohen_kappa,
                thresholds.min_claim_verdict_kappa,
            ),
            (
                "review_trigger_recall",
                self.review_trigger.recall,
                thresholds.min_review_trigger_recall,
            ),
        )
        for name, actual, minimum in checks:
            if minimum is None:
                continue
            if actual is None or actual < minimum:
                violations.append(f"{name}={actual} < min={minimum}")
        if (
            thresholds.max_critical_error_false_negatives is not None
            and self.claims.critical_error_false_negative_count
            > thresholds.max_critical_error_false_negatives
        ):
            violations.append(
                f"critical_error_false_negative_count="
                f"{self.claims.critical_error_false_negative_count} > "
                f"max={thresholds.max_critical_error_false_negatives}"
            )
        return violations


def compute_binary_prf(tp: int, fp: int, fn: int) -> BinaryPRF:
    precision = round(tp / (tp + fp), _ROUND) if (tp + fp) > 0 else None
    recall = round(tp / (tp + fn), _ROUND) if (tp + fn) > 0 else None
    if precision is not None and recall is not None and (precision + recall) > 0:
        f1: float | None = round(2.0 * precision * recall / (precision + recall), _ROUND)
    elif precision is not None or recall is not None:
        f1 = 0.0
    else:
        f1 = None
    return BinaryPRF(tp=tp, fp=fp, fn=fn, precision=precision, recall=recall, f1=f1)


def compute_cohen_kappa(
    gold_labels: Sequence[str],
    pred_labels: Sequence[str],
) -> float | None:
    """计算名义分类的 Cohen's κ；空集或期望一致率 p_e == 1 时返回 None，避免除零。"""
    if len(gold_labels) != len(pred_labels):
        raise ValueError("金标与预测序列长度必须一致")
    total = len(gold_labels)
    if total == 0:
        return None
    observed = sum(g == p for g, p in zip(gold_labels, pred_labels, strict=True)) / total
    gold_counts = Counter(gold_labels)
    pred_counts = Counter(pred_labels)
    labels = set(gold_counts) | set(pred_counts)
    expected = sum((gold_counts[lbl] / total) * (pred_counts[lbl] / total) for lbl in labels)
    denom = 1.0 - expected
    if abs(denom) < 1e-12:
        return None
    return round((observed - expected) / denom, _ROUND)


def span_iou(left_start: int, left_end: int, right_start: int, right_end: int) -> float:
    """基于字符区间的交并比 IoU；空区间返回 0.0。"""
    if left_end <= left_start or right_end <= right_start:
        return 0.0
    inter = max(0, min(left_end, right_end) - max(left_start, right_start))
    if inter == 0:
        return 0.0
    union = (left_end - left_start) + (right_end - right_start) - inter
    return inter / union if union > 0 else 0.0


def _match_claims(
    gold_claims: Sequence[EvalClaimItem],
    pred_claims: Sequence[EvalClaimItem],
    *,
    iou_threshold: float,
) -> tuple[list[tuple[EvalClaimItem, EvalClaimItem]], int, int]:
    """按 (subject_id, claim_kind) + 最高 span IoU 执行一对一贪心匹配。"""
    candidates: list[tuple[float, int, int]] = []
    for gi, gold in enumerate(gold_claims):
        for pi, pred in enumerate(pred_claims):
            if gold.subject_id != pred.subject_id or gold.claim_kind != pred.claim_kind:
                continue
            score = span_iou(gold.start, gold.end, pred.start, pred.end)
            if score >= iou_threshold:
                candidates.append((score, gi, pi))
    candidates.sort(key=lambda item: (-item[0], item[1], item[2]))
    used_gold: set[int] = set()
    used_pred: set[int] = set()
    matched: list[tuple[EvalClaimItem, EvalClaimItem]] = []
    for _score, gi, pi in candidates:
        if gi in used_gold or pi in used_pred:
            continue
        used_gold.add(gi)
        used_pred.add(pi)
        matched.append((gold_claims[gi], pred_claims[pi]))
    fp = len(pred_claims) - len(used_pred)
    fn = len(gold_claims) - len(used_gold)
    return matched, fp, fn


def evaluate_analyzer_predictions(
    *,
    dataset_id: str,
    analyzer_version: str,
    rule_set_version: str,
    gold_cases: Sequence[EvalCaseGold],
    predictions: Sequence[EvalCasePrediction],
    span_iou_threshold: float = 0.5,
) -> AnalyzerEvalReport:
    """汇总全部 5 维分析质量指标，返回结构化离线评估报告。"""
    pred_by_id = {item.case_id: item for item in predictions}
    if len(pred_by_id) != len(predictions):
        raise ValueError("预测集合存在重复 case_id")
    if {item.case_id for item in gold_cases} != set(pred_by_id):
        raise ValueError("金标与预测的 case_id 集合必须完全一致")

    m_tp = m_fp = m_fn = 0
    amb_tp = amb_fp = amb_fn = 0
    rec_gold_labels: list[str] = []
    rec_pred_labels: list[str] = []
    rank_total = 0
    rank_exact = 0
    cit_tp = cit_fp = cit_fn = 0
    cit_cat_correct = 0
    claim_tp = claim_fp = claim_fn = 0
    claim_gold_verdicts: list[str] = []
    claim_pred_verdicts: list[str] = []
    claim_sev_correct = 0
    critical_fn = 0
    rev_tp = rev_fp = rev_fn = 0

    for gold in gold_cases:
        pred = pred_by_id[gold.case_id]

        # 1. Entity Mention & Ambiguity
        g_mentions = {item.subject_id for item in gold.mentions}
        p_mentions = {item.subject_id for item in pred.mentions}
        m_tp += len(g_mentions & p_mentions)
        m_fp += len(p_mentions - g_mentions)
        m_fn += len(g_mentions - p_mentions)

        g_amb = {(item.candidate_subject_ids, item.excerpt) for item in gold.ambiguities}
        p_amb = {(item.candidate_subject_ids, item.excerpt) for item in pred.ambiguities}
        amb_tp += len(g_amb & p_amb)
        amb_fp += len(p_amb - g_amb)
        amb_fn += len(g_amb - p_amb)

        # 2. Recommendation & Rank
        g_recs = {item.subject_id: item for item in gold.recommendations}
        p_recs = {item.subject_id: item for item in pred.recommendations}
        for sid in sorted(g_recs.keys() | p_recs.keys()):
            g_item = g_recs.get(sid)
            p_item = p_recs.get(sid)
            rec_gold_labels.append(g_item.recommendation if g_item else "ABSENT")
            rec_pred_labels.append(p_item.recommendation if p_item else "ABSENT")
            g_rank = g_item.rank if g_item else None
            p_rank = p_item.rank if p_item else None
            if g_rank is not None or p_rank is not None:
                rank_total += 1
                if g_rank == p_rank:
                    rank_exact += 1

        # 3. Citations
        g_cits = {item.normalized_url: item.source_category for item in gold.citations}
        p_cits = {item.normalized_url: item.source_category for item in pred.citations}
        shared_urls = g_cits.keys() & p_cits.keys()
        cit_tp += len(shared_urls)
        cit_fp += len(p_cits.keys() - g_cits.keys())
        cit_fn += len(g_cits.keys() - p_cits.keys())
        cit_cat_correct += sum(g_cits[url] == p_cits[url] for url in shared_urls)

        # 4. Claims (Span + Verdict + Severity + Critical FN Safety Gate)
        matched_claims, c_fp, c_fn = _match_claims(
            gold.claims, pred.claims, iou_threshold=span_iou_threshold
        )
        claim_tp += len(matched_claims)
        claim_fp += c_fp
        claim_fn += c_fn
        matched_gold_ids = {id(g_claim) for g_claim, _ in matched_claims}
        for g_claim, p_claim in matched_claims:
            claim_gold_verdicts.append(g_claim.verdict)
            claim_pred_verdicts.append(p_claim.verdict)
            if g_claim.severity == p_claim.severity:
                claim_sev_correct += 1
            if (
                g_claim.verdict == "INCORRECT"
                and g_claim.severity in CRITICAL_SEVERITIES
                and p_claim.verdict == "ACCURATE"
            ):
                critical_fn += 1
        for g_claim in gold.claims:
            if (
                id(g_claim) not in matched_gold_ids
                and g_claim.verdict == "INCORRECT"
                and g_claim.severity in CRITICAL_SEVERITIES
            ):
                critical_fn += 1

        # 5. Review trigger
        if gold.review_required and pred.review_required:
            rev_tp += 1
        elif not gold.review_required and pred.review_required:
            rev_fp += 1
        elif gold.review_required and not pred.review_required:
            rev_fn += 1

    per_class_f1: dict[str, float | None] = {}
    present_f1s: list[float] = []
    for cls in RECOMMENDATION_CLASSES:
        c_tp = sum(
            g == cls and p == cls
            for g, p in zip(rec_gold_labels, rec_pred_labels, strict=True)
        )
        c_fp = sum(
            g != cls and p == cls
            for g, p in zip(rec_gold_labels, rec_pred_labels, strict=True)
        )
        c_fn = sum(
            g == cls and p != cls
            for g, p in zip(rec_gold_labels, rec_pred_labels, strict=True)
        )
        prf = compute_binary_prf(c_tp, c_fp, c_fn)
        per_class_f1[cls] = prf.f1
        if prf.f1 is not None:
            present_f1s.append(prf.f1)

    rec_sample_count = len(rec_gold_labels)
    rec_exact = (
        round(
            sum(g == p for g, p in zip(rec_gold_labels, rec_pred_labels, strict=True))
            / rec_sample_count,
            _ROUND,
        )
        if rec_sample_count > 0
        else None
    )
    matched_claim_count = len(claim_gold_verdicts)
    verdict_agreement = (
        round(
            sum(g == p for g, p in zip(claim_gold_verdicts, claim_pred_verdicts, strict=True))
            / matched_claim_count,
            _ROUND,
        )
        if matched_claim_count > 0
        else None
    )

    return AnalyzerEvalReport(
        dataset_id=dataset_id,
        analyzer_version=analyzer_version,
        rule_set_version=rule_set_version,
        case_count=len(gold_cases),
        mentions=MentionEvalMetrics(
            entity=compute_binary_prf(m_tp, m_fp, m_fn),
            ambiguity=compute_binary_prf(amb_tp, amb_fp, amb_fn),
        ),
        recommendations=RecommendationEvalMetrics(
            sample_count=rec_sample_count,
            macro_f1=round(sum(present_f1s) / len(present_f1s), _ROUND) if present_f1s else None,
            cohen_kappa=compute_cohen_kappa(rec_gold_labels, rec_pred_labels),
            exact_accuracy=rec_exact,
            rank_exact_accuracy=round(rank_exact / rank_total, _ROUND) if rank_total > 0 else None,
            per_class_f1=per_class_f1,
        ),
        citations=CitationEvalMetrics(
            url_match=compute_binary_prf(cit_tp, cit_fp, cit_fn),
            matched_count=cit_tp,
            category_accuracy=round(cit_cat_correct / cit_tp, _ROUND) if cit_tp > 0 else None,
        ),
        claims=ClaimEvalMetrics(
            span=compute_binary_prf(claim_tp, claim_fp, claim_fn),
            matched_count=matched_claim_count,
            verdict_agreement_rate=verdict_agreement,
            verdict_cohen_kappa=compute_cohen_kappa(claim_gold_verdicts, claim_pred_verdicts),
            severity_agreement_rate=(
                round(claim_sev_correct / matched_claim_count, _ROUND)
                if matched_claim_count > 0
                else None
            ),
            critical_error_false_negative_count=critical_fn,
        ),
        review_trigger=compute_binary_prf(rev_tp, rev_fp, rev_fn),
    )
