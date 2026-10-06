"""GEO-503 文本规则：限定对象作用域和排序证据，不持有运行或数据库状态。"""

import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from uuid import UUID

from app.schemas.geo_analysis import GeoRecommendationKind as Kind

if TYPE_CHECKING:
    from app.services.geo_analysis import MentionAnalysis, MentionOccurrence

_NEGATIVE = re.compile(
    r"(?:不|并非)(?:推荐|建议|适合)|不要(?:使用|选择)|(?:建议)?避免(?:使用|选择)?|"
    r"\b(?:recommend|suggest)\s+(?:against|avoiding|not\s+using)\b|"
    r"\b(?:do\s+not|don't|never)\s+(?:recommend|choose|use)\b|"
    r"\b(?:not\s+(?:recommended|suitable)|avoid|unsuitable)\b",
    re.I,
)
_POSITIVE = re.compile(
    r"推荐|建议|首选|次选|第三选择|优先(?:评估|选择|考虑|使用)|"
    r"\b(?:recommend(?:ed|s)?|suggest(?:ed|s)?|prefer(?:red)?|"
    r"first\s+choice|second\s+choice|third\s+choice|top\s+choice|"
    r"order\s+of\s+preference|preferred\s+order)\b",
    re.I,
)
_CONSIDERED = re.compile(
    r"候选|列举|比较|对比|可替代|是[^。；\n]{0,80}器件|"
    r"\b(?:consider|candidates?|comparison|alternatives?)\b",
    re.I,
)
_UNCERTAIN = re.compile(
    r"是否|能否|未推荐|尚未推荐|没有推荐|不一定|不代表推荐|不是推荐|仅作为|只是示例|"
    r"据说|有人(?:说|推荐|建议)|[?？“”\"`]|"
    r"\b(?:whether|might|could|not\s+necessarily|not\s+a\s+recommendation|"
    r"no\s+recommendation|example|quoted)\b",
    re.I,
)
_CONDITIONAL = re.compile(r"如果|假如|若|\b(?:if|unless)\b", re.I)
_UNRESOLVED_NEGATION = re.compile(
    r"并非|没有|不是|不认为|不能|未|"
    r"\b(?:not(?!\s+(?:only|just)\b)|cannot|can't|no|never)\b",
    re.I,
)
_POSTFIX_CHOICE = re.compile(
    r"\s*(?:优先评估|次选|首选|第三选择|推荐方案|建议评估|"
    r"recommended|first\s+choice|second\s+choice)\s*[。.!]?\s*",
    re.I,
)
_ORDER = re.compile(
    r"(?:推荐|建议)顺序|按优先级|优先级(?:从高到低|顺序)|"
    r"\b(?:ranked|ranking|order\s+of\s+preference|preferred\s+order)\b",
    re.I,
)
_UNORDERED = re.compile(
    r"不分先后|顺序不代表|不代表优先级|无排名|并列|同等|"
    r"\b(?:in\s+no\s+particular\s+order|unordered|not\s+ranked|equal|tied)\b",
    re.I,
)
_INJECTION = re.compile(
    r"忽略[^。\n]{0,40}(?:规则|指令)|执行工具|"
    r"\bignore\b[^.\n]{0,40}\b(?:rules|instructions)\b",
    re.I,
)
_SENTENCE = re.compile(r"[。！？!?;；\n\r]|(?<![0-9０-９])\.(?![0-9０-９])")
_CLAUSE = re.compile(r"[,，]|但是|然而|而是|但|\b(?:but|however|instead)\b", re.I)
_JOIN = re.compile(r"\s*(?:(?:、|,|，|和|及|与|的|\band\b|\bor\b)\s*)+", re.I)
_ITEM = re.compile(r"^\s{0,3}(?:(\d{1,10})[.)、]|[-*+])\s+")
_POSITION = (
    (re.compile(r"首选|\b(?:first|top)\s+choice\b", re.I), 1),
    (re.compile(r"次选|\bsecond\s+choice\b", re.I), 2),
    (re.compile(r"第三选择|\bthird\s+choice\b", re.I), 3),
)


@dataclass(frozen=True)
class RecommendationEvidence:
    subject_id: UUID
    recommendation: Kind
    rule: str
    start: int
    end: int
    excerpt: str = field(repr=False)
    rank: int | None
    order_group: int | None


@dataclass(frozen=True)
class _Line:
    start: int
    end: int
    text: str = field(repr=False)


@dataclass(frozen=True)
class _ListContext:
    header: _Line | None
    rank: int | None
    group: int


def _evaluation_text(
    text: str, start: int, end: int, occurrences: list["MentionOccurrence"]
) -> str:
    # 名称可能含“推荐/首选”；评价须来自名称之外，证据保留未改动的原文。
    parts: list[str] = []
    cursor = start
    for occurrence in occurrences:
        left, right = max(start, occurrence.start), min(end, occurrence.end)
        if left < right:
            parts.extend((text[cursor:left], " " * (right - left)))
            cursor = right
    parts.append(text[cursor:end])
    return "".join(parts)


def _list_contexts(text: str, occurrences: list["MentionOccurrence"]) -> dict[int, _ListContext]:
    lines = []
    offset = 0
    for row in text.splitlines(keepends=True):
        lines.append(_Line(offset, offset + len(row.rstrip("\r\n")), row.rstrip("\r\n")))
        offset += len(row)
    contexts = {}
    index = 0
    while index < len(lines):
        if not _ITEM.match(lines[index].text):
            index += 1
            continue
        begin = index
        while index < len(lines) and _ITEM.match(lines[index].text):
            index += 1
        group = lines[begin:index]
        header = (
            lines[begin - 1]
            if begin and lines[begin - 1].text.rstrip().endswith((":", "："))
            else None
        )
        markers = [_ITEM.match(line.text) for line in group]
        numbers = [int(m.group(1)) if m and m.group(1) else None for m in markers]
        members = [[o for o in occurrences if line.start <= o.start < line.end] for line in group]
        ids = [
            o.candidate_subject_ids[0]
            for rows in members
            for o in rows
            if len(o.candidate_subject_ids) == 1
        ]
        evaluations = [_evaluation_text(text, line.start, line.end, occurrences) for line in group]
        header_text = (
            _evaluation_text(text, header.start, header.end, occurrences) if header else ""
        )
        reliable = (
            header is not None
            and len(header.text) <= 2000
            and _ORDER.search(header_text) is not None
            and not _UNORDERED.search(header_text)
            and numbers == list(range(1, len(group) + 1))
            and all(
                len(rows) <= 1 and all(not o.ambiguity_reason for o in rows) for rows in members
            )
            and len(ids) == len(set(ids))
            and not _UNORDERED.search(_evaluation_text(text, 0, len(text), occurrences))
            and all(
                _kind(evaluation)[1] in {"NO_RECOMMENDATION_EVIDENCE", "EXPLICIT_RECOMMENDATION"}
                for evaluation in evaluations
            )
            and all(
                all(
                    not pattern.search(evaluation) or position == number
                    for pattern, position in _POSITION
                )
                for number, evaluation in zip(numbers, evaluations, strict=True)
            )
        )
        for number, rows in zip(numbers, members, strict=True):
            for occurrence in rows:
                contexts[occurrence.start] = _ListContext(
                    header, number if reliable else None, group[0].start
                )
    return contexts


def _scope(
    text: str, occurrence: "MentionOccurrence", occurrences: list["MentionOccurrence"]
) -> tuple[int, int]:
    left, right = 0, len(text)
    for boundary in _SENTENCE.finditer(text):
        if boundary.end() <= occurrence.start:
            left = boundary.end()
        elif boundary.start() >= occurrence.end:
            right = boundary.end()
            break
    # 只让并列名词共享谓词；混合评价、转折和不同分句不能串到邻近对象。
    previous = [o for o in occurrences if left <= o.start < occurrence.start]
    following = [o for o in occurrences if occurrence.end <= o.start < right]
    if previous:
        prior = previous[-1]
        if not _JOIN.fullmatch(text[prior.end : occurrence.start]):
            left = prior.end
    if following:
        after = following[0]
        if not _JOIN.fullmatch(text[occurrence.end : after.start]):
            right = after.start
    head = occurrence.start
    for prior in reversed(previous):
        if not _JOIN.fullmatch(text[prior.end : head]):
            break
        head = prior.start
    for boundary in _CLAUSE.finditer(text, left, right):
        if boundary.group() in {",", "，"}:
            if boundary.end() <= occurrence.start and (
                head < boundary.start() or _CONDITIONAL.search(text[left : boundary.start()])
            ):
                continue
            if boundary.start() >= occurrence.end and (
                (following and _JOIN.fullmatch(text[occurrence.end : following[0].start]))
                or (not following and _POSTFIX_CHOICE.fullmatch(text[boundary.end() : right]))
            ):
                continue
        if boundary.end() <= occurrence.start:
            # 名词并列里的逗号不是新的评价；沿用同一个推荐/候选谓词。
            left = boundary.end()
        elif boundary.start() >= occurrence.end:
            right = boundary.start()
            break
    return max(left, occurrence.start - 800), min(right, occurrence.end + 800)


def _kind(text: str) -> tuple[Kind, str]:
    if _UNCERTAIN.search(text):
        return Kind.UNKNOWN, "UNCERTAIN_CONTEXT"
    negative = _NEGATIVE.search(text)
    affirmative = _NEGATIVE.sub("", text)
    positive = _POSITIVE.search(affirmative)
    if positive and _UNRESOLVED_NEGATION.search(affirmative):
        return Kind.UNKNOWN, "UNCERTAIN_CONTEXT"
    if negative and positive:
        return Kind.UNKNOWN, "CONFLICTING_CONTEXT"
    if negative:
        return Kind.NOT_RECOMMENDED, "EXPLICIT_NEGATIVE"
    if positive:
        if _CONDITIONAL.search(text):
            return Kind.CONSIDERED, "CONDITIONAL_CHOICE"
        return Kind.RECOMMENDED, "EXPLICIT_RECOMMENDATION"
    if _CONSIDERED.search(text):
        return Kind.CONSIDERED, "CANDIDATE_OR_DESCRIPTION"
    return Kind.UNKNOWN, "NO_RECOMMENDATION_EVIDENCE"


def recommendation_evidence(
    text: str, mentions: "MentionAnalysis"
) -> tuple[RecommendationEvidence, ...]:
    """只消费确认提及；歧义仍参与作用域和列表可靠性检查，绝不任选对象。"""
    occurrences = sorted(
        [*mentions.ambiguities, *(o for m in mentions.mentions for o in m.occurrences)],
        key=lambda o: o.start,
    )
    contexts = _list_contexts(text, occurrences)
    results = []
    for mention in mentions.mentions:
        for occurrence in mention.occurrences:
            start, end = _scope(text, occurrence, occurrences)
            excerpt = text[start:end].strip()
            start += len(text[start:end]) - len(text[start:end].lstrip())
            end = start + len(excerpt)
            evaluation = _evaluation_text(text, start, end, occurrences)
            kind, rule = _kind(evaluation)
            following = next((o for o in occurrences if o.start >= occurrence.end), None)
            if following and text[occurrence.end : following.start].strip() == "的":
                # “首选品牌的产品”中品牌是身份修饰语，不能推导独立品牌推荐。
                kind, rule = Kind.CONSIDERED, "NAME_QUALIFIER"
            context = contexts.get(occurrence.start)
            rank, group = None, None
            if (
                context
                and context.header
                and len(context.header.text) <= 2000
                and rule == "NO_RECOMMENDATION_EVIDENCE"
            ):
                inherited, inherited_rule = _kind(
                    _evaluation_text(text, context.header.start, context.header.end, occurrences)
                )
                if inherited != Kind.UNKNOWN:
                    kind, rule = inherited, "LIST_" + inherited_rule
                    start, end = context.header.start, end
                    excerpt = text[start:end]
                    if len(excerpt) > 2000:
                        # 长列表依据只保留标题，位置证据仍是该项原文，不拼造摘录。
                        start, end = context.header.start, context.header.end
                        excerpt = text[start:end]
            if kind == Kind.RECOMMENDED:
                ranks = {value for pattern, value in _POSITION if pattern.search(evaluation)}
                rank = next(iter(ranks)) if len(ranks) == 1 else None
                if context:
                    rank, group = context.rank, context.group
                elif rank:
                    group = -1
                if _UNORDERED.search(_evaluation_text(text, 0, len(text), occurrences)):
                    rank = None
            results.append(
                RecommendationEvidence(
                    mention.subject_id, kind, rule, start, end, excerpt, rank, group
                )
            )
    return tuple(results)


def has_untrusted_instructions(text: str, mentions: "MentionAnalysis") -> bool:
    occurrences = sorted(
        [*mentions.ambiguities, *(o for m in mentions.mentions for o in m.occurrences)],
        key=lambda o: o.start,
    )
    return _INJECTION.search(_evaluation_text(text, 0, len(text), occurrences)) is not None
