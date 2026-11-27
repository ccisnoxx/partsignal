"""Slice 3B：Layer 1 确定性内容质量检查引擎（BLOCKING / WARNING / INFORMATION）。"""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.models.content import ContentBriefSnapshot, ContentTask, ContentVersion
from app.models.product_facts import FactVersion, Product
from app.schemas.content import QualityIssue
from app.schemas.geo_files import GeneratedDraft
from app.services.content_duplication import (
    NEAR_DUPLICATE_WARNING_THRESHOLD,
    compute_content_similarity,
    load_sibling_contents,
    semantic_tokens,
)

MAX_RECOMMENDED_TITLE_CHARS = 60
MIN_RECOMMENDED_TITLE_CHARS = 8
MAX_RECOMMENDED_BODY_CHARS = 20000

_SEVERITY_ORDER = {"BLOCKING": 0, "WARNING": 1, "INFORMATION": 2}

_ABSOLUTE_REPLACEMENT_PATTERNS = (
    re.compile(r"100%\s*(?:直接|无条件|完全)?(?:替代|兼容|互换)", re.IGNORECASE),
    re.compile(r"(?:完全)?无条件(?:直接)?(?:替代|替换|兼容)"),
    re.compile(r"免测试(?:直接)?(?:替代|替换)"),
    re.compile(r"零风险(?:直接)?(?:替代|替换)"),
    re.compile(r"绝对(?:兼容|替代|可直接替换)"),
    re.compile(r"可直接替换所有"),
    re.compile(r"guaranteed\s+drop[- ]?in", re.IGNORECASE),
    re.compile(r"100%\s+pin[- ]?to[- ]?pin\s+compatible", re.IGNORECASE),
)

_UNIT_PATTERN = (
    r"mV|kV|V|mA|uA|μA|µA|A|mW|kW|W|kΩ|MΩ|Ω|GHz|MHz|kHz|Hz|°C|℃|"
    r"pF|nF|uF|μF|µF|nH|uH|μH|µH|mH|mm|mil|ns|us|μs|µs|ms|dB|ppm"
)
_TECH_SPEC_RE = re.compile(
    rf"(?<![A-Za-z0-9.])(\d+(?:\.\d+)?)\s*({_UNIT_PATTERN})(?![A-Za-z0-9_])"
)
_TECH_RANGE_RE = re.compile(
    rf"(?<![A-Za-z0-9.])(\d+(?:\.\d+)?)\s*(?:[-~～至到])\s*"
    rf"(\d+(?:\.\d+)?)\s*({_UNIT_PATTERN})(?![A-Za-z0-9_])"
)
_PERCENT_RE = re.compile(r"(?<![A-Za-z0-9.])(\d+(?:\.\d+)?)\s*%")
_CERT_RE = re.compile(
    r"\b(?:AEC-Q\d+|ISO\s*\d{4,5}|IATF\s*16949|UL\s*\d{3,4}|RoHS|REACH|CE认证)\b",
    re.IGNORECASE,
)
_PART_TOKEN_RE = re.compile(
    r"(?<![A-Za-z0-9_-])([A-Za-z]{2,}[A-Za-z0-9_-]*[0-9][A-Za-z0-9_-]*)(?![A-Za-z0-9_-])"
)
_HEADING_RE = re.compile(r"^\s{0,3}#{1,3}\s+\S", re.MULTILINE)
_RESTRICTION_PREFIX_RE = re.compile(
    r"^(?:严禁|禁止)(?:公开)?(?:表达|承诺|宣称|使用|提及|宣传|声称)?[:：]?\s*"
)
_ZH_QUESTION_STOPWORDS = frozenset(
    {"哪些", "什么", "如何", "怎么", "是否", "可以", "能否", "问题", "说明", "介绍", "分析"}
)


def _normalize_unit(unit: str) -> str:
    return unit.replace("μ", "u").replace("µ", "u").replace("℃", "°C")


def _normalize_number(raw: str) -> str:
    try:
        value = float(raw)
    except ValueError:
        return raw
    return f"{value:g}"


def extract_technical_specs(text: str) -> set[tuple[str, str]]:
    """提取文本中带工程单位的数值规格（兼容范围表达式如 4.5-36V）。"""
    specs: set[tuple[str, str]] = set()
    for low, high, unit in _TECH_RANGE_RE.findall(text):
        norm_unit = _normalize_unit(unit)
        specs.add((_normalize_number(low), norm_unit))
        specs.add((_normalize_number(high), norm_unit))
    for raw_num, unit in _TECH_SPEC_RE.findall(text):
        specs.add((_normalize_number(raw_num), _normalize_unit(unit)))
    return specs


def _extract_humanization_claims(text: str) -> set[str]:
    """提取自然化阶段严禁无中生有的工程数值、百分比与认证声明。"""
    claims = {f"{num}{unit}" for num, unit in extract_technical_specs(text)}
    for pct in _PERCENT_RE.findall(text):
        claims.add(f"{_normalize_number(pct)}%")
    for cert in _CERT_RE.findall(text):
        claims.add(re.sub(r"\s+", "", cert.upper()))
    return claims


def _levenshtein_is_one(left: str, right: str) -> bool:
    """精确判定两字符串编辑距离是否恰为 1（用于型号拼写错漏检测）。"""
    if left == right or abs(len(left) - len(right)) > 1:
        return False
    if len(left) == len(right):
        return sum(1 for a, b in zip(left, right, strict=True) if a != b) == 1
    shorter, longer = (left, right) if len(left) < len(right) else (right, left)
    i = j = diffs = 0
    while i < len(shorter) and j < len(longer):
        if shorter[i] == longer[j]:
            i += 1
            j += 1
        else:
            diffs += 1
            if diffs > 1:
                return False
            j += 1
    return True


def _parse_restriction_phrases(raw_restrictions: str | None) -> list[str]:
    """从 FactVersion.content_restrictions 拆解出待匹配的禁用表达短语。"""
    if not raw_restrictions or not raw_restrictions.strip():
        return []
    phrases: list[str] = []
    seen: set[str] = set()
    for segment in re.split(r"[\n;；。]+", raw_restrictions):
        cleaned = segment.strip().strip("-*• ")
        if len(cleaned) < 2:
            continue
        candidates = [cleaned]
        stripped = _RESTRICTION_PREFIX_RE.sub("", cleaned).strip()
        if len(stripped) >= 3 and stripped != cleaned:
            candidates.append(stripped)
        for item in candidates:
            key = item.casefold()
            if key not in seen:
                seen.add(key)
                phrases.append(item)
    return phrases


def evaluate_content_quality(
    db: Session,
    task: ContentTask,
    draft: GeneratedDraft,
    *,
    source_content: ContentVersion | None = None,
    is_humanization: bool = False,
) -> list[dict[str, str]]:
    """执行 Slice 3B Layer 1 确定性内容质量检查（BLOCKING / WARNING / INFORMATION）。"""
    fact = db.get(FactVersion, task.fact_version_id)
    product = db.get(Product, task.product_id)
    brief = db.get(ContentBriefSnapshot, task.id)
    issues: list[QualityIssue] = []

    full_text = "\n".join((draft.title, draft.summary, draft.body_markdown))
    lowered_full = full_text.casefold()
    fact_text = "\n".join(
        part
        for part in (
            fact.body_markdown if fact is not None else "",
            fact.approved_claims_summary or "" if fact is not None else "",
        )
        if part
    )

    # 1. BLOCKING: 禁用表达命中（Brief.forbidden_expressions + FactVersion.content_restrictions）
    forbidden_hits: list[str] = []
    if brief is not None:
        for phrase in brief.forbidden_expressions:
            cleaned = phrase.strip()
            if len(cleaned) >= 2 and cleaned.casefold() in lowered_full:
                forbidden_hits.append(cleaned)
    if fact is not None:
        for phrase in _parse_restriction_phrases(fact.content_restrictions):
            if phrase.casefold() in lowered_full and phrase not in forbidden_hits:
                forbidden_hits.append(phrase)
    if forbidden_hits:
        issues.append(
            QualityIssue(
                code="FORBIDDEN_EXPRESSION_HIT",
                severity="BLOCKING",
                message=f"正文命中禁止公开表达：{'、'.join(forbidden_hits[:3])}",
            )
        )

    # 2. BLOCKING: 绝对化替代结论（违背纯 GEO 事实边界）
    abs_hits = [
        match.group(0)
        for pattern in _ABSOLUTE_REPLACEMENT_PATTERNS
        if (match := pattern.search(full_text)) is not None
    ]
    if abs_hits:
        issues.append(
            QualityIssue(
                code="ABSOLUTE_REPLACEMENT_CLAIM",
                severity="BLOCKING",
                message=f"出现绝对化替代或免测试保证表述：{'、'.join(dict.fromkeys(abs_hits[:3]))}",
            )
        )

    # 3. BLOCKING: 型号疑似拼写错误（编辑距离=1 且未出现在已批准事实中）
    if product is not None and len(product.part_number.strip()) >= 5:
        canonical_part = product.part_number.strip()
        canonical_cf = canonical_part.casefold()
        fact_cf = fact_text.casefold()
        typos: list[str] = []
        for token in _PART_TOKEN_RE.findall(full_text):
            token_cf = token.casefold()
            if (
                token_cf != canonical_cf
                and token_cf[:2] == canonical_cf[:2]
                and _levenshtein_is_one(token_cf, canonical_cf)
                and token_cf not in fact_cf
                and token not in typos
            ):
                typos.append(token)
        if typos:
            issues.append(
                QualityIssue(
                    code="PART_NUMBER_TYPO",
                    severity="BLOCKING",
                    message=(
                        f"疑似型号拼写错误：{'、'.join(typos[:3])}"
                        f"（目标产品型号为 {canonical_part}）"
                    ),
                )
            )

    # 4. BLOCKING: 正文出现已批准事实中不存在的新工程数值+单位
    if fact is not None:
        fact_specs = extract_technical_specs(fact_text)
        draft_specs = extract_technical_specs(full_text)
        unsupported = sorted({f"{num}{unit}" for num, unit in (draft_specs - fact_specs)})
        if unsupported:
            issues.append(
                QualityIssue(
                    code="UNSUPPORTED_TECHNICAL_NUMBER",
                    severity="BLOCKING",
                    message=f"正文包含已批准事实中未记载的工程参数：{'、'.join(unsupported[:4])}",
                )
            )

    # 5. BLOCKING: 自然化后引入原稿与已批准事实均未包含的新数值/百分比/认证声明
    if is_humanization and source_content is not None:
        source_full = "\n".join(
            (source_content.title, source_content.summary, source_content.body_markdown)
        )
        allowed_claims = _extract_humanization_claims(source_full) | _extract_humanization_claims(
            fact_text
        )
        new_claims = sorted(_extract_humanization_claims(full_text) - allowed_claims)
        if new_claims:
            issues.append(
                QualityIssue(
                    code="HUMANIZATION_NEW_CLAIM",
                    severity="BLOCKING",
                    message=(
                        "自然化改写引入了原稿与事实均未记载的新声明："
                        f"{'、'.join(new_claims[:4])}"
                    ),
                )
            )

    # 6. WARNING: 与同 Campaign 或同产品既有内容高度重复
    siblings = load_sibling_contents(db, task)
    highest_sim = 0.0
    highest_scope = "同产品"
    for sibling in siblings:
        sim = compute_content_similarity(
            full_text, "\n".join((sibling.title, sibling.summary, sibling.body_markdown))
        )
        if sim > highest_sim:
            highest_sim = sim
            highest_scope = "同活动（Campaign）" if sibling.same_campaign else "同产品"
    if highest_sim >= NEAR_DUPLICATE_WARNING_THRESHOLD:
        issues.append(
            QualityIssue(
                code="NEAR_DUPLICATE_CONTENT",
                severity="WARNING",
                message=(
                    f"与{highest_scope}既有内容语义相似度达 {highest_sim:.0%}，"
                    "建议查看重复度分析并做差异化改写"
                ),
            )
        )

    # 7. WARNING: 目标型号缺失（Brief 任务或长正文）
    if (
        product is not None
        and product.part_number.strip()
        and product.part_number.strip().casefold() not in lowered_full
        and (brief is not None or len(draft.body_markdown.strip()) >= 80)
    ):
        issues.append(
            QualityIssue(
                code="PART_NUMBER_MISSING",
                severity="WARNING",
                message=f"正文中未提及目标产品型号 {product.part_number.strip()}",
            )
        )

    # 8. WARNING / INFORMATION: 标题长度检查
    title_len = len(draft.title.strip())
    if title_len > MAX_RECOMMENDED_TITLE_CHARS:
        issues.append(
            QualityIssue(
                code="TITLE_LENGTH_OUT_OF_RANGE",
                severity="WARNING",
                message=(
                    f"标题长度为 {title_len} 字符，"
                    f"超出建议上限（{MAX_RECOMMENDED_TITLE_CHARS} 字符）"
                ),
            )
        )
    elif title_len < MIN_RECOMMENDED_TITLE_CHARS:
        if brief is not None:
            issues.append(
                QualityIssue(
                    code="TITLE_LENGTH_OUT_OF_RANGE",
                    severity="WARNING",
                    message=(
                        f"标题长度仅 {title_len} 字符，低于 GEO 建议下限"
                        f"（{MIN_RECOMMENDED_TITLE_CHARS} 字符）"
                    ),
                )
            )
        else:
            issues.append(
                QualityIssue(
                    code="TITLE_LENGTH_HINT",
                    severity="INFORMATION",
                    message=f"标题长度仅 {title_len} 字符，建议补充核心搜索词提升检索相关性",
                )
            )

    # 9. WARNING / INFORMATION: Brief 核心问题、关键词与 CTA 覆盖检查
    if brief is not None:
        question_sources = [brief.target_question, *brief.must_answer_questions]
        q_tokens = {
            tok
            for text_piece in question_sources
            for tok in semantic_tokens(text_piece)
            if tok not in _ZH_QUESTION_STOPWORDS
        }
        if q_tokens:
            body_tokens = set(semantic_tokens(full_text))
            if len(q_tokens & body_tokens) / len(q_tokens) < 0.25:
                issues.append(
                    QualityIssue(
                        code="BRIEF_CORE_QUESTION_UNADDRESSED",
                        severity="WARNING",
                        message=(
                            "正文对 Brief 目标问题及必答要点的覆盖率偏低，"
                            "建议明确逐条回应核心问题"
                        ),
                    )
                )
        keywords = [kw.strip() for kw in brief.target_keywords if kw.strip()]
        if keywords:
            missing_kw = [kw for kw in keywords if kw.casefold() not in lowered_full]
            coverage = (len(keywords) - len(missing_kw)) / len(keywords)
            if coverage < 0.5:
                issues.append(
                    QualityIssue(
                        code="BRIEF_KEYWORDS_MISSING",
                        severity="WARNING",
                        message=f"缺少超过半数目标关键词：{'、'.join(missing_kw[:4])}",
                    )
                )
            elif missing_kw:
                issues.append(
                    QualityIssue(
                        code="KEYWORD_COVERAGE_HINT",
                        severity="INFORMATION",
                        message=(
                            "可进一步自然融入以下 Brief 目标关键词："
                            f"{'、'.join(missing_kw[:4])}"
                        ),
                    )
                )
        cta = brief.cta.strip()
        if cta and cta.casefold() not in lowered_full:
            cta_tokens = set(semantic_tokens(cta))
            body_tokens = set(semantic_tokens(draft.body_markdown))
            if not cta_tokens or len(cta_tokens & body_tokens) / len(cta_tokens) < 0.5:
                issues.append(
                    QualityIssue(
                        code="CTA_MISSING",
                        severity="INFORMATION",
                        message=f"正文尚未包含 Brief 约定的行动号召（CTA）：{cta[:60]}",
                    )
                )

    # 10. WARNING: 平台结构/长度格式提示
    body_len = len(draft.body_markdown.strip())
    if body_len > MAX_RECOMMENDED_BODY_CHARS:
        issues.append(
            QualityIssue(
                code="PLATFORM_FORMAT_HINT",
                severity="WARNING",
                message=f"正文长度达 {body_len} 字符，建议拆分章节或精简以适配目标平台阅读习惯",
            )
        )
    elif body_len >= 120 and _HEADING_RE.search(draft.body_markdown) is None:
        issues.append(
            QualityIssue(
                code="PLATFORM_FORMAT_HINT",
                severity="WARNING",
                message="较长正文缺少 Markdown 标题层级（# / ##），不利于平台排版与 AI 检索切分",
            )
        )

    issues.sort(key=lambda item: (_SEVERITY_ORDER[item.severity], item.code))
    return [item.model_dump() for item in issues]
