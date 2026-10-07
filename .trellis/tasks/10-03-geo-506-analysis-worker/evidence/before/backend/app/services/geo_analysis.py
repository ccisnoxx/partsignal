"""GEO-502～504：冻结输入上的提及、推荐和引用阶段；持久化由 GEO-506 拥有。"""

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass, field
from uuid import UUID

from app.schemas.geo_analysis import GeoRecommendationKind, GeoSourceCategory
from app.schemas.geo_answers import GeoAnswerCitationOut
from app.schemas.geo_catalog import GeoSubjectAliasKind, GeoSubjectType
from app.schemas.geo_runs import GeoRunSubjectSnapshot
from app.services.geo_catalog_normalization import catalog_text_key
from app.services.geo_citation_rules import (
    CITATION_OWNERSHIP_AMBIGUOUS,
    CITATION_RULE_VERSION,
    CITATION_SOURCE_AMBIGUOUS,
    CitationAnalysis,
    CitationClassification,
    CitationRuleSnapshot,
    freeze_citations,
    match_citation_hostname,
)
from app.services.geo_recommendation_rules import (
    RecommendationEvidence,
    has_untrusted_instructions,
    recommendation_evidence,
)

MENTION_RULE_VERSION = "geo-mentions-v1"
ALIAS_AMBIGUOUS = "ALIAS_AMBIGUOUS"
RECOMMENDATION_RULE_VERSION = "geo-recommendations-v1"
RECOMMENDATION_UNCERTAIN = "RECOMMENDATION_UNCERTAIN"
RECOMMENDATION_CONFLICT = "RECOMMENDATION_CONFLICT"
UNRELIABLE_RANK = "UNRELIABLE_RANK"
UNTRUSTED_INSTRUCTIONS = "UNTRUSTED_INSTRUCTIONS"
_HYPHENS = str.maketrans(dict.fromkeys("‐‑‒–−﹣－", "-"))
_PART_TYPES = {
    GeoSubjectType.OWN_PRODUCT,
    GeoSubjectType.COMPETITOR_PRODUCT,
    GeoSubjectType.REFERENCE_PART,
}
_CLAUSE_BREAK = re.compile(r"[。！？!?;；,，\n\r]|\.(?![0-9])")
_TURN = re.compile(r"\b(?:but|however|instead)\b|但是|但|然而|而是", re.IGNORECASE)
_NEGATION = re.compile(
    r"\bnot\b(?!\s+(?:only|just)\b)|\b(?:no|never|cannot|avoid|unsuitable)\b"
    r"|不推荐|不建议|不适合|不支持|不能|不可|避免|未提及|未推荐|不是|并非|没有",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class FrozenAlias:
    alias: str = field(repr=False)
    normalized_alias: str = field(repr=False)
    alias_kind: GeoSubjectAliasKind
    language_code: str | None


@dataclass(frozen=True)
class SubjectAliases:
    subject_id: UUID
    revision: int
    subject_type: GeoSubjectType
    aliases: tuple[FrozenAlias, ...] = field(repr=False)


@dataclass(frozen=True)
class AliasSnapshot:
    subjects: tuple[SubjectAliases, ...] = field(repr=False)


@dataclass(frozen=True)
class MentionOccurrence:
    start: int
    end: int
    excerpt: str = field(repr=False)
    matched_aliases: tuple[str, ...] = field(repr=False)
    candidate_subject_ids: tuple[UUID, ...]
    negation_cues: tuple[str, ...] = field(repr=False)
    ambiguity_reason: str | None


@dataclass(frozen=True)
class EntityMention:
    subject_id: UUID
    mention_count: int
    first_character_offset: int
    matched_aliases: tuple[str, ...] = field(repr=False)
    occurrences: tuple[MentionOccurrence, ...] = field(repr=False)


@dataclass(frozen=True)
class MentionAnalysis:
    rule_set_version: str
    mentions: tuple[EntityMention, ...]
    ambiguities: tuple[MentionOccurrence, ...] = field(repr=False)
    review_required_reasons: tuple[str, ...]


def freeze_subject_aliases(subjects: Sequence[GeoRunSubjectSnapshot]) -> AliasSnapshot:
    """复制已校验分析输入；不重读当前 Catalog，也不把展示名猜成额外别名。"""
    if not subjects or len({subject.id for subject in subjects}) != len(subjects):
        raise ValueError("提及快照必须包含唯一监测对象")
    frozen = []
    for subject in sorted(subjects, key=lambda item: item.id):
        aliases = {
            FrozenAlias(
                subject.canonical_name,
                catalog_text_key(subject.canonical_name),
                GeoSubjectAliasKind.NAME,
                None,
            )
        }
        for alias in subject.aliases:
            if catalog_text_key(alias.alias) != alias.normalized_alias:
                raise ValueError("提及快照别名规范键不一致")
            aliases.add(
                FrozenAlias(
                    alias.alias, alias.normalized_alias, alias.alias_kind, alias.language_code
                )
            )
        frozen.append(
            SubjectAliases(
                subject.id,
                subject.revision,
                subject.subject_type,
                tuple(
                    sorted(
                        aliases,
                        key=lambda item: (
                            item.normalized_alias,
                            item.alias,
                            item.alias_kind,
                            item.language_code or "",
                        ),
                    )
                ),
            )
        )
    return AliasSnapshot(tuple(frozen))


@dataclass(frozen=True)
class _NormalizedText:
    value: str
    spans: tuple[tuple[int, int], ...]


def _normalize(value: str) -> _NormalizedText:
    # 按基字符与组合符映射，保留 NFKC/casefold 展开的源 span，不能命中半个源字符。
    clusters: list[tuple[int, int]] = []
    for index, char in enumerate(value):
        if clusters and unicodedata.category(char) in {"Mn", "Mc", "Me"}:
            clusters[-1] = (clusters[-1][0], index + 1)
        else:
            clusters.append((index, index + 1))
    chars: list[str] = []
    spans: list[tuple[int, int]] = []
    for start, end in clusters:
        normalized = unicodedata.normalize("NFKC", value[start:end]).casefold().translate(_HYPHENS)
        for char in normalized:
            if char.isspace():
                char = "\n" if char in "\n\r\v\f" else " "
                if chars and char == chars[-1] == " ":
                    spans[-1] = (spans[-1][0], end)
                    continue
            chars.append(char)
            spans.append((start, end))
    return _NormalizedText("".join(chars), tuple(spans))


def _identifier_char(char: str) -> bool:
    # 汉字可紧邻英文型号；Unicode \b 会把“型号GEOFX-731Q适用”整体误当作一个词。
    is_han = "\u3400" <= char <= "\u9fff" or "\U00020000" <= char <= "\U000323af"
    return not is_han and (char.isalnum() or char == "_" or unicodedata.category(char)[0] == "M")


def _valid_span(text: _NormalizedText, start: int, end: int, *, part_number: bool) -> bool:
    if start and text.spans[start - 1] == text.spans[start]:
        return False
    if end < len(text.value) and text.spans[end - 1] == text.spans[end]:
        return False
    connectors = "-/." if part_number else "-"
    for edge, outside, beyond in ((start, start - 1, start - 2), (end - 1, end, end + 1)):
        if not _identifier_char(text.value[edge]) or not 0 <= outside < len(text.value):
            continue
        if _identifier_char(text.value[outside]):
            return False
        if (
            text.value[outside] in connectors
            and 0 <= beyond < len(text.value)
            and _identifier_char(text.value[beyond])
        ):
            return False
    return True


@dataclass(frozen=True)
class _Hit:
    start: int
    end: int
    subject_id: UUID
    alias: FrozenAlias = field(repr=False)
    match_key: str = field(repr=False)


def _hits(text: _NormalizedText, snapshot: AliasSnapshot) -> list[_Hit]:
    hits = []
    terms: dict[str, list[tuple[SubjectAliases, FrozenAlias]]] = {}
    for subject in snapshot.subjects:
        for alias in subject.aliases:
            key = _normalize(alias.normalized_alias).value
            terms.setdefault(key, []).append((subject, alias))
    for key, candidates in terms.items():
        # 边界是整个匹配键的合同；不能利用类型/别名种类过滤部分候选而隐式消歧。
        part_number = any(
            subject.subject_type in _PART_TYPES
            or alias.alias_kind == GeoSubjectAliasKind.PART_NUMBER
            for subject, alias in candidates
        )
        start = text.value.find(key)
        while start >= 0:
            end = start + len(key)
            if _valid_span(text, start, end, part_number=part_number):
                for subject, alias in candidates:
                    hits.append(
                        _Hit(
                            text.spans[start][0],
                            text.spans[end - 1][1],
                            subject.subject_id,
                            alias,
                            key,
                        )
                    )
            start = text.value.find(key, start + 1)
    return sorted(hits, key=lambda hit: (hit.start, hit.end, hit.subject_id, hit.alias.alias))


def _negation_cues(answer: str, start: int, end: int, left: int, right: int) -> tuple[str, ...]:
    # 有界、同分句且不穿过其他命中/转折；只保存词面线索，不判定推荐或事实真假。
    prefix = _CLAUSE_BREAK.split(answer[max(left, start - 80) : start])[-1]
    prefix = _TURN.split(prefix)[-1]
    suffix = _CLAUSE_BREAK.split(answer[end : min(right, end + 80)])[0]
    suffix = _TURN.split(suffix)[0]
    return tuple(
        sorted(
            {match.group() for match in _NEGATION.finditer(_normalize(prefix + " " + suffix).value)}
        )
    )


def identify_mentions(answer_text: str, snapshot: AliasSnapshot) -> MentionAnalysis:
    """原文字符位置、计数与歧义证据；否定提及仍是提及，不输出推荐/排名。"""
    if not answer_text.strip() or "\x00" in answer_text:
        raise ValueError("提及分析需要有效回答正文")
    groups: list[list[_Hit]] = []
    group_end = 0
    for hit in _hits(_normalize(answer_text), snapshot):
        if groups and hit.start < group_end:
            groups[-1].append(hit)
            group_end = max(group_end, hit.end)
        else:
            groups.append([hit])
            group_end = hit.end
    confirmed: dict[UUID, list[MentionOccurrence]] = {}
    ambiguities = []
    for index, group in enumerate(groups):
        start, end = min(hit.start for hit in group), max(hit.end for hit in group)
        candidates = tuple(sorted({hit.subject_id for hit in group}))
        reason = None
        if len(candidates) > 1:
            if len({hit.match_key for hit in group}) > 1:
                reason = "OVERLAPPING_ALIASES"
            elif len({hit.alias.normalized_alias for hit in group}) > 1:
                reason = "NORMALIZED_ALIAS_COLLISION"
            else:
                reason = "SHARED_ALIAS"
        occurrence = MentionOccurrence(
            start,
            end,
            answer_text[start:end],
            tuple(sorted({hit.alias.alias for hit in group})),
            candidates,
            _negation_cues(
                answer_text,
                start,
                end,
                max(hit.end for hit in groups[index - 1]) if index else 0,
                min(hit.start for hit in groups[index + 1])
                if index + 1 < len(groups)
                else len(answer_text),
            ),
            reason,
        )
        if reason:
            ambiguities.append(occurrence)
        else:
            confirmed.setdefault(candidates[0], []).append(occurrence)
    mentions = tuple(
        EntityMention(
            subject_id,
            len(occurrences),
            occurrences[0].start,
            tuple(sorted({alias for item in occurrences for alias in item.matched_aliases})),
            tuple(occurrences),
        )
        for subject_id, occurrences in sorted(confirmed.items())
    )
    return MentionAnalysis(
        MENTION_RULE_VERSION,
        mentions,
        tuple(ambiguities),
        (ALIAS_AMBIGUOUS,) if ambiguities else (),
    )


@dataclass(frozen=True)
class EntityRecommendation:
    subject_id: UUID
    recommendation: GeoRecommendationKind
    rank: int | None
    rationale_excerpt: str = field(repr=False)
    evidence: tuple[RecommendationEvidence, ...] = field(repr=False)
    confidence: None = None


@dataclass(frozen=True)
class RecommendationAnalysis:
    rule_set_version: str
    recommendations: tuple[EntityRecommendation, ...]
    review_required_reasons: tuple[str, ...]


def classify_recommendations(answer_text: str, snapshot: AliasSnapshot) -> RecommendationAnalysis:
    """四态与可靠排序；名称、字符位置、编号本身均不能证明推荐或优先级。"""
    mentions = identify_mentions(answer_text, snapshot)
    evidence = recommendation_evidence(answer_text, mentions)
    reasons = set(mentions.review_required_reasons)
    untrusted = has_untrusted_instructions(answer_text, mentions)
    if untrusted:
        reasons.add(UNTRUSTED_INSTRUCTIONS)
    ambiguous_ids = {s for o in mentions.ambiguities for s in o.candidate_subject_ids}
    recommendations = []
    kind = GeoRecommendationKind
    for mention in mentions.mentions:
        rows = tuple(row for row in evidence if row.subject_id == mention.subject_id)
        labels = {row.recommendation for row in rows}
        conflict = (
            kind.RECOMMENDED in labels and kind.NOT_RECOMMENDED in labels
        ) or any(row.rule == "CONFLICTING_CONTEXT" for row in rows)
        uncertain = any(row.rule == "UNCERTAIN_CONTEXT" for row in rows)
        if conflict:
            label = kind.UNKNOWN
            reasons.add(RECOMMENDATION_CONFLICT)
        elif untrusted or mention.subject_id in ambiguous_ids or uncertain:
            label = kind.UNKNOWN
        elif kind.RECOMMENDED in labels:
            label = kind.RECOMMENDED
        elif kind.NOT_RECOMMENDED in labels:
            label = kind.NOT_RECOMMENDED
        elif kind.CONSIDERED in labels:
            label = kind.CONSIDERED
        else:
            label = kind.UNKNOWN
        if label == kind.UNKNOWN:
            reasons.add(RECOMMENDATION_UNCERTAIN)
        selected = next((row for row in rows if row.recommendation == label), rows[0])
        ranked = {row.rank for row in rows if row.recommendation == kind.RECOMMENDED
                  and row.rank is not None}
        rank = next(iter(ranked)) if label == kind.RECOMMENDED and len(ranked) == 1 else None
        recommendations.append(EntityRecommendation(
            mention.subject_id, label, rank, selected.excerpt, rows
        ))
    # 一个回答不能把多个独立序列、重复位置或否认顺序的结果拼成虚构总排名。
    groups = {row.order_group for row in evidence if row.rank is not None}
    ranks = [row.rank for row in recommendations if row.rank is not None]
    invalid_order = len(groups) > 1 or len(ranks) != len(set(ranks))
    if invalid_order:
        recommendations = [EntityRecommendation(
            row.subject_id, row.recommendation, None, row.rationale_excerpt, row.evidence
        ) for row in recommendations]
    if any(row.recommendation == kind.RECOMMENDED and row.rank is None
           for row in recommendations):
        reasons.add(UNRELIABLE_RANK)
    return RecommendationAnalysis(
        RECOMMENDATION_RULE_VERSION, tuple(recommendations), tuple(sorted(reasons))
    )


def classify_citations(
    citations: Sequence[GeoAnswerCitationOut], snapshot: CitationRuleSnapshot
) -> CitationAnalysis:
    """引用仍是权威证据；分类只依赖规范 hostname 与版本化字典，不使用正文线索。"""
    results = []
    review_reasons: set[str] = set()
    for citation in freeze_citations(citations):
        matches = match_citation_hostname(citation.hostname, snapshot)
        candidates = tuple(sorted({
            row.subject_id for row in matches if row.subject_id is not None
        }))
        categories = {row.source_category for row in matches}
        reasons = []
        if len(candidates) > 1:
            reasons.append(CITATION_OWNERSHIP_AMBIGUOUS)
        if len(categories) > 1:
            reasons.append(CITATION_SOURCE_AMBIGUOUS)
        review_reasons.update(reasons)
        results.append(CitationClassification(
            citation,
            next(iter(categories)) if len(categories) == 1 else GeoSourceCategory.UNKNOWN,
            candidates[0] if len(candidates) == 1 else None,
            candidates,
            matches,
            tuple(reasons),
        ))
    return CitationAnalysis(
        CITATION_RULE_VERSION,
        snapshot.source_categories.version if snapshot.source_categories is not None else None,
        snapshot.subject_ids,
        tuple(results),
        tuple(sorted(review_reasons)),
    )
