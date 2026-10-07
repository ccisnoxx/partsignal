"""GEO-505 本地声明阶段；不持久化、不调用 provider，也不推进 Run 状态。"""

import re
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from uuid import UUID

from app.schemas.geo_analysis import GeoClaimKind as Kind
from app.schemas.geo_analysis import GeoClaimSeverity as Severity
from app.schemas.geo_analysis import GeoClaimVerdict as Verdict
from app.schemas.geo_catalog import GeoSubjectType
from app.schemas.geo_runs import GeoRunSubjectSnapshot
from app.services.geo_analysis import (
    ALIAS_AMBIGUOUS,
    UNTRUSTED_INSTRUCTIONS,
    freeze_subject_aliases,
    identify_mentions,
)
from app.services.geo_claim_rules import (
    CLAIM_RULE_VERSION,
    SENTENCE_BREAK,
    Assertion,
    parse_assertions,
    text_key,
)
from app.services.geo_fact_versions import FactAssembly, FactCandidate
from app.services.geo_recommendation_rules import has_untrusted_instructions

CLAIM_UNJUDGEABLE = "CLAIM_UNJUDGEABLE"
CRITICAL_REPLACEMENT_REVIEW = "CRITICAL_REPLACEMENT_REVIEW"
SAFETY_CERTIFICATION_REVIEW = "SAFETY_CERTIFICATION_REVIEW"
HIGH_SEVERITY_INCORRECT = "HIGH_SEVERITY_INCORRECT"
CLAIM_SCOPE_AMBIGUOUS = "CLAIM_SCOPE_AMBIGUOUS"
CLAIM_TEXT_TOO_LONG = "CLAIM_TEXT_TOO_LONG"


@dataclass(frozen=True)
class ExtractedClaim:
    subject_id: UUID
    claim_kind: Kind
    start: int
    end: int
    claim_text: str = field(repr=False)
    assertion: Assertion = field(repr=False)


@dataclass(frozen=True)
class ClaimExtraction:
    rule_set_version: str
    claims: tuple[ExtractedClaim, ...] = field(repr=False)
    review_required_reasons: tuple[str, ...]


@dataclass(frozen=True)
class ClaimAssessment:
    subject_id: UUID
    claim_kind: Kind
    start: int
    end: int
    claim_text: str = field(repr=False)
    fact_version_id: UUID | None
    verdict: Verdict
    severity: Severity
    fact_excerpt: str | None = field(repr=False)
    explanation: str
    confidence: float | None = None


@dataclass(frozen=True)
class ClaimAnalysis:
    rule_set_version: str
    assessments: tuple[ClaimAssessment, ...] = field(repr=False)
    review_required_reasons: tuple[str, ...]


def _sentences(text: str) -> list[tuple[int, int]]:
    result = []
    start = 0
    for delimiter in SENTENCE_BREAK.finditer(text):
        end = delimiter.end()
        if text[start:end].strip():
            result.append((start, end))
        start = end
    if text[start:].strip():
        result.append((start, len(text)))
    return result


def extract_claims(answer_text: str, subjects: Sequence[GeoRunSubjectSnapshot]) -> ClaimExtraction:
    """精确提及限定属性归属；不补全代词，不将目标产品当替代关系的源。"""
    mentions = identify_mentions(answer_text, freeze_subject_aliases(subjects))
    occurrences = sorted(
        [row for mention in mentions.mentions for row in mention.occurrences]
        + list(mentions.ambiguities),
        key=lambda row: row.start,
    )
    reasons = set(mentions.review_required_reasons)
    if has_untrusted_instructions(answer_text, mentions):
        reasons.add(UNTRUSTED_INSTRUCTIONS)
    claims: list[ExtractedClaim] = []
    for start, end in _sentences(answer_text):
        text = answer_text[start:end]
        hits = [row for row in occurrences if start <= row.start < end]
        for index, hit in enumerate(hits):
            if len(hit.candidate_subject_ids) != 1:
                reasons.add(ALIAS_AMBIGUOUS)
                continue
            subject_id = hit.candidate_subject_ids[0]
            next_start = hits[index + 1].start if index + 1 < len(hits) else end
            body = answer_text[hit.end : next_start]
            # 替代目标属于谓词的宾语；允许显式条件出现在源型号之前。
            relation_end_match = re.search(r"[,，]", answer_text[hit.end : end])
            relation_end = hit.end + relation_end_match.start() if relation_end_match else end
            prefix_start = hits[index - 1].end if index else start
            prefix = answer_text[prefix_start : hit.start]
            relation = parse_assertions(prefix + answer_text[hit.end : relation_end])
            relationships = [row for row in relation if row.kind == Kind.REPLACEMENT_RELATION]
            if relationships and re.search(r"替代|replace", body, re.I):
                assertions = tuple(relationships)
                claim_start = prefix_start
                while claim_start < hit.start and answer_text[claim_start] in " ,，":
                    claim_start += 1
                claim_end = relation_end
            else:
                assertions = parse_assertions(body)
                claim_start, claim_end = start, end
            joined = index > 0 and bool(
                re.fullmatch(
                    r"\s*(?:和|与|及|、|and|,)\s*",
                    answer_text[hits[index - 1].end : hit.start],
                    re.I,
                )
            )
            if joined and assertions:
                reasons.add(CLAIM_SCOPE_AMBIGUOUS)
                assertions = tuple(replace(row, uncertain=True) for row in assertions)
            if len(text) > 2000 and assertions:
                # 不截断原文来改变声明含义；后续复核可读取完整 AnswerSnapshot。
                reasons.add(CLAIM_TEXT_TOO_LONG)
                continue
            for assertion in assertions:
                if not any(
                    row.subject_id == subject_id
                    and row.start == claim_start
                    and row.end == claim_end
                    and row.assertion == assertion
                    for row in claims
                ):
                    claims.append(
                        ExtractedClaim(
                            subject_id,
                            assertion.kind,
                            claim_start,
                            claim_end,
                            answer_text[claim_start:claim_end],
                            assertion,
                        )
                    )
    return ClaimExtraction(CLAIM_RULE_VERSION, tuple(claims), tuple(sorted(reasons)))


def _fact_assertions(
    fact: FactCandidate, subject: GeoRunSubjectSnapshot, subjects: Sequence[GeoRunSubjectSnapshot]
) -> list[tuple[Assertion, str]]:
    """事实的产品归属来自 FactVersion；显式提及其他产品的属性不能借用。"""
    result = []
    aliases = freeze_subject_aliases(subjects)
    for start, end in _sentences(fact.body_markdown):
        text = fact.body_markdown[start:end]
        if text.lstrip().startswith("#") or len(text) > 2000:
            continue
        mentions = identify_mentions(text, aliases)
        product_subjects = {
            row.id
            for row in subjects
            if row.subject_type
            in {
                GeoSubjectType.OWN_PRODUCT,
                GeoSubjectType.COMPETITOR_PRODUCT,
                GeoSubjectType.REFERENCE_PART,
            }
        }
        others = [
            row
            for row in mentions.mentions
            if row.subject_id != subject.id and row.subject_id in product_subjects
        ]
        if mentions.ambiguities:
            continue
        # 条件替代允许出现目标；其他带多产品归属的段落保守不作为属性证据。
        masked = text
        own_occurrences = sorted(
            (
                occurrence
                for mention in mentions.mentions
                if mention.subject_id == subject.id
                for occurrence in mention.occurrences
            ),
            key=lambda row: row.start,
            reverse=True,
        )
        for occurrence in own_occurrences:
            masked = (
                masked[: occurrence.start]
                + " " * (occurrence.end - occurrence.start)
                + masked[occurrence.end :]
            )
        assertions = parse_assertions(masked)
        relation = re.search(r"替代|replace|可作为", text, re.I)
        if relation:
            source_clause = re.split(r"[,，]", text[: relation.start()])[-1]
            source_names = re.findall(r"[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+", source_clause)
            own_names = {
                text_key(subject.canonical_name),
                *(text_key(alias.alias) for alias in subject.aliases),
            }
            if any(text_key(name) not in own_names for name in source_names):
                continue
        if others:
            other_sources = (
                any(
                    occurrence.start < relation.start()
                    for mention in others
                    for occurrence in mention.occurrences
                )
                if relation
                else True
            )
            if other_sources:
                continue
            assertions = tuple(row for row in assertions if row.kind == Kind.REPLACEMENT_RELATION)
        for assertion in assertions:
            if not assertion.uncertain:
                result.append((assertion, text))
    return result


def _judge(
    claim: Assertion, evidence: list[tuple[Assertion, str]]
) -> tuple[Verdict, Severity, str | None, str]:
    unknown = (
        Verdict.UNJUDGEABLE,
        Severity.MEDIUM,
        None,
        "批准事实不足或声明语义不明确，无法判断。",
    )
    if claim.uncertain or not claim.value:
        return unknown
    related = [
        (row, text) for row, text in evidence if row.kind == claim.kind and row.key == claim.key
    ]
    if claim.kind == Kind.REPLACEMENT_RELATION:
        related = [(row, text) for row, text in related if row.value[0] == claim.value[0]]
    if not related:
        return unknown
    if len({row for row, _ in related}) != 1:
        return (
            Verdict.UNJUDGEABLE,
            Severity.MEDIUM,
            None,
            "批准事实中存在相互冲突的声明，无法判断。",
        )
    fact, excerpt = related[0]
    if claim.value != fact.value:
        severity = Severity.CRITICAL if claim.kind == Kind.CERTIFICATION else Severity.HIGH
        return Verdict.INCORRECT, severity, excerpt, "声明与同产品批准事实的明确值冲突。"
    if claim.kind == Kind.REPLACEMENT_RELATION:
        required, supplied = set(fact.conditions), set(claim.conditions)
        if required != supplied:
            if required and not supplied:
                return (
                    Verdict.INCORRECT,
                    Severity.CRITICAL,
                    excerpt,
                    "无条件替代结论遗漏批准事实中的关键条件。",
                )
            if supplied < required:
                return (
                    Verdict.PARTIAL,
                    Severity.HIGH,
                    excerpt,
                    "替代方向和目标一致，但缺少部分关键条件。",
                )
            return (
                Verdict.UNJUDGEABLE,
                Severity.HIGH,
                excerpt,
                "替代条件与批准条件不一致，无法确认关系成立。",
            )
    return Verdict.ACCURATE, Severity.LOW, excerpt, "声明的明确值及关键条件与同产品批准事实一致。"


def assess_claims(
    answer_text: str, subjects: Sequence[GeoRunSubjectSnapshot], facts: FactAssembly
) -> ClaimAnalysis:
    """只消费合格冻结事实；INTERNAL/RESTRICTED 也只在本地计算，无外发路径。"""
    expected = {
        (row.id, row.product_id, row.revision)
        for row in subjects
        if row.subject_type == GeoSubjectType.OWN_PRODUCT
    }
    if expected != {
        (row.subject_id, row.product_id, row.subject_revision) for row in facts.subjects
    }:
        raise ValueError("事实装配必须匹配本次冻结监测对象")
    extraction = extract_claims(answer_text, subjects)
    fact_by_subject = {row.subject_id: row.fact for row in facts.subjects}
    evidence = {
        row.id: _fact_assertions(fact, row, subjects)
        for row in subjects
        if (fact := fact_by_subject.get(row.id)) is not None
    }
    reasons = set(extraction.review_required_reasons)
    assessments = []
    for claim in extraction.claims:
        fact = fact_by_subject.get(claim.subject_id)
        verdict, severity, excerpt, explanation = _judge(
            claim.assertion,
            evidence.get(claim.subject_id, []),
        )
        if verdict == Verdict.UNJUDGEABLE:
            reasons.add(CLAIM_UNJUDGEABLE)
        if claim.claim_kind == Kind.REPLACEMENT_RELATION:
            reasons.add(CRITICAL_REPLACEMENT_REVIEW)
        if claim.claim_kind == Kind.CERTIFICATION:
            reasons.add(SAFETY_CERTIFICATION_REVIEW)
        if verdict == Verdict.INCORRECT and severity in {Severity.HIGH, Severity.CRITICAL}:
            reasons.add(HIGH_SEVERITY_INCORRECT)
        assessments.append(
            ClaimAssessment(
                claim.subject_id,
                claim.claim_kind,
                claim.start,
                claim.end,
                claim.claim_text,
                fact.id if fact else None,
                verdict,
                severity,
                excerpt,
                explanation,
            )
        )
    return ClaimAnalysis(CLAIM_RULE_VERSION, tuple(assessments), tuple(sorted(reasons)))
