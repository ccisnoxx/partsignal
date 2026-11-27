"""Slice 3C：实时派生增强发布包与发布前检查引擎（不保存可独立编辑的 HTML）。"""

from __future__ import annotations

import math
import re
import uuid
from typing import Literal

from pydantic import HttpUrl, TypeAdapter, ValidationError
from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.models.configuration import PlatformProfile, QueryTopic
from app.models.content import ContentBriefSnapshot, ContentTask, ContentVersion
from app.models.product_facts import FactVersion, Product
from app.models.publication import PublicationWork
from app.schemas.publication import (
    PublicationCharacterStats,
    PublicationChecklistItem,
    PublicationPackage,
    PublicationPackageImage,
    PublicationPackageLink,
    PublicationPreRegisterCheckOut,
    PublicationPreRegisterCheckRequest,
)
from app.services.content_quality import (
    _ABSOLUTE_REPLACEMENT_PATTERNS,
    _parse_restriction_phrases,
)
from app.services.publication_queries import render_markdown

_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
_LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+\S", re.MULTILINE)
_FENCED_CODE_RE = re.compile(r"(?ms)^[ \t]*(`{3,}|~{3,})[^\n]*\n.*?(?:^[ \t]*\1[ \t]*$|\Z)")
_HTTP_URL_ADAPTER: TypeAdapter[HttpUrl] = TypeAdapter(HttpUrl)


def _has_control_or_space(raw: str) -> bool:
    return any(ord(ch) <= 32 or ord(ch) == 127 for ch in raw)


def _parse_http_url(raw: str) -> str | None:
    """使用与 PublicationResultUpdate 一致的 Pydantic HttpUrl 解析器校验并规范化 URL。"""
    cleaned = raw.strip()
    if not cleaned or _has_control_or_space(cleaned):
        return None
    try:
        parsed = _HTTP_URL_ADAPTER.validate_python(cleaned)
    except ValidationError:
        return None
    return str(parsed)


def _is_valid_http_url(raw: str) -> bool:
    return _parse_http_url(raw) is not None


def _is_valid_image_src(raw: str) -> bool:
    """允许显式 http(s) 或单斜杠站内路径，拒绝 // 协议相对路径与控制字符。"""
    cleaned = raw.strip()
    if not cleaned or _has_control_or_space(cleaned):
        return False
    if cleaned.startswith("/"):
        return not cleaned.startswith("//")
    return _is_valid_http_url(cleaned)


def _strip_fenced_code(body_markdown: str) -> str:
    return _FENCED_CODE_RE.sub("", body_markdown)


def _extract_body_paragraphs(body_markdown: str) -> list[str]:
    """与发布包统计和发布前检查共享的段落提取逻辑（剥离代码块与标题行）。"""
    cleaned = _strip_fenced_code(body_markdown)
    paragraphs: list[str] = []
    for block in re.split(r"\n\s*\n+", cleaned):
        lines = [
            line.strip()
            for line in block.splitlines()
            if line.strip() and not re.match(r"^\s{0,3}#{1,6}\s+\S", line)
        ]
        if lines:
            paragraphs.append("\n".join(lines))
    return paragraphs


def extract_markdown_links(body_markdown: str) -> list[PublicationPackageLink]:
    """提取 Markdown 正文（不含围栏代码块）中的链接与锚文本并校验 http(s) 合法性。"""
    cleaned = _strip_fenced_code(body_markdown)
    links: list[PublicationPackageLink] = []
    for anchor, href in _LINK_RE.findall(cleaned):
        links.append(
            PublicationPackageLink(
                text=anchor.strip(),
                href=href.strip(),
                is_valid=_is_valid_http_url(href),
            )
        )
    return links


def extract_markdown_images(body_markdown: str) -> list[PublicationPackageImage]:
    """提取 Markdown 正文（不含围栏代码块）中的图片与 Alt 文本，标记缺失 Alt 或非法地址。"""
    cleaned = _strip_fenced_code(body_markdown)
    images: list[PublicationPackageImage] = []
    for alt, src in _IMAGE_RE.findall(cleaned):
        cleaned_alt = alt.strip()
        cleaned_src = src.strip()
        images.append(
            PublicationPackageImage(
                alt=cleaned_alt,
                src=cleaned_src,
                missing_alt=not bool(cleaned_alt),
                is_valid_src=_is_valid_image_src(cleaned_src),
            )
        )
    return images


def compute_character_stats(body_markdown: str, body_text: str) -> PublicationCharacterStats:
    """实时统计总字符数、非空白字符、纯文本长度、段落数与预计阅读分钟数。"""
    total_chars = len(body_markdown)
    non_ws = len(re.sub(r"\s+", "", body_markdown))
    plain_chars = len(body_text)
    cleaned = _strip_fenced_code(body_markdown)
    paragraphs = _extract_body_paragraphs(body_markdown)
    headings = len(_HEADING_RE.findall(cleaned))
    read_minutes = max(1, math.ceil(max(plain_chars, 1) / 400))
    return PublicationCharacterStats(
        total_chars=total_chars,
        non_whitespace_chars=non_ws,
        plain_text_chars=plain_chars,
        paragraph_count=len(paragraphs),
        heading_count=headings,
        estimated_read_minutes=read_minutes,
    )


def _find_forbidden_hits(
    text: str,
    *,
    fact: FactVersion | None,
    brief: ContentBriefSnapshot | None,
) -> list[str]:
    hits: list[str] = []
    lowered = text.casefold()
    if brief is not None:
        for phrase in brief.forbidden_expressions:
            cleaned = phrase.strip()
            if len(cleaned) >= 2 and cleaned.casefold() in lowered and cleaned not in hits:
                hits.append(cleaned)
    if fact is not None:
        for phrase in _parse_restriction_phrases(fact.content_restrictions):
            if phrase.casefold() in lowered and phrase not in hits:
                hits.append(phrase)
    for pattern in _ABSOLUTE_REPLACEMENT_PATTERNS:
        match = pattern.search(text)
        if match is not None and match.group(0) not in hits:
            hits.append(match.group(0))
    return hits


def _build_recommended_topics(
    *,
    content: ContentVersion,
    product: Product | None,
    brief: ContentBriefSnapshot | None,
    topic: QueryTopic | None,
) -> list[str]:
    candidates: list[str] = []
    if brief is not None:
        candidates.extend(brief.target_keywords)
        if brief.content_angle.strip():
            candidates.append(brief.content_angle.strip())
    if product is not None:
        if product.part_number.strip():
            candidates.append(product.part_number.strip())
        if product.category.strip():
            candidates.append(product.category.strip())
    if topic is not None and topic.canonical_question.strip():
        candidates.append(topic.canonical_question.strip()[:28])
    candidates.extend(content.tags)

    result: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        cleaned = item.strip()
        if not cleaned:
            continue
        key = cleaned.casefold()
        if key not in seen:
            seen.add(key)
            result.append(cleaned)
        if len(result) >= 8:
            break
    return result


def build_publication_package(
    db: Session,
    content_version_id: uuid.UUID,
) -> PublicationPackage:
    """实时派生增强版发布包（分区内容、统计、链接/图片与平台检查清单）。"""
    from app.services.publication import get_publishable_content_readonly

    content = get_publishable_content_readonly(db, content_version_id)
    task = db.get(ContentTask, content.task_id)
    fact = db.get(FactVersion, content.fact_version_id)
    product = db.get(Product, task.product_id) if task is not None else None
    brief = db.get(ContentBriefSnapshot, task.id) if task is not None else None
    topic = (
        db.get(QueryTopic, task.query_topic_id)
        if task is not None and task.query_topic_id is not None
        else None
    )

    body_html, body_text = render_markdown(content.body_markdown)
    links = extract_markdown_links(content.body_markdown)
    images = extract_markdown_images(content.body_markdown)
    stats = compute_character_stats(content.body_markdown, body_text)
    recommended_topics = _build_recommended_topics(
        content=content, product=product, brief=brief, topic=topic
    )

    full_text = "\n".join((content.title, content.summary, content.body_markdown))
    forbidden_hits = _find_forbidden_hits(full_text, fact=fact, brief=brief)
    invalid_links = [item for item in links if not item.is_valid]
    bad_images = [item for item in images if item.missing_alt or not item.is_valid_src]

    checklist = [
        PublicationChecklistItem(
            code="TITLE_PRESENT",
            label="标题与摘要完整",
            status="PASS" if content.title.strip() and content.summary.strip() else "WARNING",
            detail=f"标题 {len(content.title)} 字，摘要 {len(content.summary)} 字",
        ),
        PublicationChecklistItem(
            code="BODY_PARAGRAPHS",
            label="正文结构完整",
            status=(
                "PASS"
                if stats.paragraph_count >= 1 and stats.plain_text_chars >= 50
                else "WARNING"
            ),
            detail=f"共 {stats.paragraph_count} 个正文段落，纯文本 {stats.plain_text_chars} 字",
        ),
        PublicationChecklistItem(
            code="FORBIDDEN_EXPRESSIONS_CLEAN",
            label="禁止表达与边界合规",
            status="BLOCKING" if forbidden_hits else "PASS",
            detail=(
                f"命中禁止表达：{'、'.join(forbidden_hits[:3])}"
                if forbidden_hits
                else "未检测到禁止公开表达或绝对化替代措辞"
            ),
        ),
        PublicationChecklistItem(
            code="LINKS_VALID",
            label="链接格式校验",
            status="WARNING" if invalid_links else "PASS",
            detail=(
                f"发现 {len(invalid_links)} 个无效链接地址"
                if invalid_links
                else f"已检出 {len(links)} 个链接，全部符合 http(s) 协议"
            ),
        ),
        PublicationChecklistItem(
            code="IMAGES_ALT_COMPLETE",
            label="图片与 Alt 文本校验",
            status="WARNING" if bad_images else "PASS",
            detail=(
                f"发现 {len(bad_images)} 张图片缺少 Alt 文本或地址无效"
                if bad_images
                else f"已检出 {len(images)} 张图片，Alt 与地址完整"
            ),
        ),
        PublicationChecklistItem(
            code="TAGS_COUNT_CHECK",
            label="标签数量检查",
            status="PASS" if 1 <= len(content.tags) <= 10 else "WARNING",
            detail=f"当前配置 {len(content.tags)} 个标签（建议 1-10 个）",
        ),
        PublicationChecklistItem(
            code="CONTENT_HASH_FROZEN",
            label="不可变版本与哈希已锁定",
            status="PASS",
            detail=f"版本 v{content.version} · SHA-256 {content.content_hash[:12]}…",
        ),
    ]

    return PublicationPackage(
        content_version_id=content.id,
        fact_version_id=content.fact_version_id,
        version=content.version,
        title=content.title,
        summary=content.summary,
        body_markdown=content.body_markdown,
        body_html=body_html,
        body_text=body_text,
        tags=list(content.tags),
        recommended_topics=recommended_topics,
        links=links,
        images=images,
        character_stats=stats,
        platform_checklist=checklist,
        content_hash=content.content_hash,
    )


def assert_actual_title_compliant(
    db: Session,
    *,
    work: PublicationWork,
    actual_title: str,
) -> None:
    """服务端强门禁：阻止实际发布标题夹带禁用表达或绝对化替代承诺。"""
    content = db.get(ContentVersion, work.content_version_id)
    fact = db.get(FactVersion, content.fact_version_id) if content is not None else None
    brief = db.get(ContentBriefSnapshot, work.content_task_id)
    hits = _find_forbidden_hits(actual_title, fact=fact, brief=brief)
    if hits:
        raise AppError(
            "FORBIDDEN_EXPRESSION_HIT",
            f"实际发布标题命中禁止公开表达或绝对化措辞：{'、'.join(hits[:3])}",
            422,
        )


def evaluate_pre_register_check(
    db: Session,
    *,
    work_id: uuid.UUID,
    payload: PublicationPreRegisterCheckRequest,
) -> PublicationPreRegisterCheckOut:
    """在登记发布结果前执行 8 项发布前检查并返回逐项明细与可提交判定。"""
    from app.services.publication import domain_allowed
    from app.services.publication_queries import NONTERMINAL_WORK_STATUSES

    work = db.get(PublicationWork, work_id)
    if work is None:
        raise not_found("发布工作")
    if work.status not in NONTERMINAL_WORK_STATUSES:
        raise AppError("INVALID_STATE_TRANSITION", "终态发布工作不能执行发布前检查", 409)
    profile = db.get(PlatformProfile, work.platform_profile_id)
    content = db.get(ContentVersion, work.content_version_id)
    if profile is None or content is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布工作上下文不完整", 409)
    fact = db.get(FactVersion, content.fact_version_id)
    brief = db.get(ContentBriefSnapshot, work.content_task_id)

    normalized_url = _parse_http_url(payload.final_url)
    url_valid = normalized_url is not None and domain_allowed(
        normalized_url, list(profile.allowed_domains)
    )
    title_clean = payload.actual_title.strip()
    title_matches = bool(title_clean) and title_clean.casefold() == content.title.strip().casefold()

    _, body_text = render_markdown(content.body_markdown)
    paragraphs = _extract_body_paragraphs(content.body_markdown)
    links = extract_markdown_links(content.body_markdown)
    images = extract_markdown_images(content.body_markdown)
    invalid_links = [item for item in links if not item.is_valid]
    bad_images = [item for item in images if item.missing_alt or not item.is_valid_src]

    title_forbidden_hits = _find_forbidden_hits(title_clean, fact=fact, brief=brief)
    body_forbidden_hits = _find_forbidden_hits(
        "\n".join((content.summary, content.body_markdown)),
        fact=fact,
        brief=brief,
    )
    if title_forbidden_hits:
        forbidden_status: Literal["PASS", "WARNING", "BLOCKING"] = "BLOCKING"
        forbidden_detail = (
            f"实际发布标题命中禁止公开表达或绝对化措辞：{'、'.join(title_forbidden_hits[:3])}"
        )
    elif body_forbidden_hits:
        forbidden_status = "WARNING"
        forbidden_detail = (
            "已批准正文或摘要命中敏感/禁用措辞（不可原地修改，请核对后再发布）："
            f"{'、'.join(body_forbidden_hits[:3])}"
        )
    else:
        forbidden_status = "PASS"
        forbidden_detail = "实际标题与批准正文均未命中禁用表达"

    comment_clean = payload.comment.strip()
    meta_missing: list[str] = []
    if payload.published_at is None:
        meta_missing.append("实际发布时间")
    if not comment_clean:
        meta_missing.append("发布操作说明")

    checks: list[PublicationChecklistItem] = [
        PublicationChecklistItem(
            code="URL_DOMAIN_ALLOWED",
            label="URL 域名归属目标平台",
            status="PASS" if url_valid else "BLOCKING",
            detail=(
                f"URL 属于平台「{profile.name}」允许域名范围"
                if url_valid
                else (
                    "最终 URL 缺失、格式非法或不属于平台允许域名"
                    f"（{', '.join(profile.allowed_domains) or '未配置'}）"
                )
            ),
        ),
        PublicationChecklistItem(
            code="TITLE_MATCHES_APPROVED",
            label="标题与批准版本一致性",
            status="BLOCKING" if not title_clean else ("PASS" if title_matches else "WARNING"),
            detail=(
                "实际发布标题不能为空"
                if not title_clean
                else (
                    "实际发布标题与已批准内容标题一致"
                    if title_matches
                    else f"实际标题与批准标题《{content.title}》存在差异，请确认平台改写未偏离事实"
                )
            ),
        ),
        PublicationChecklistItem(
            code="BODY_PARAGRAPH_INTEGRITY",
            label="正文段落完整性",
            status="PASS" if len(paragraphs) >= 1 and len(body_text) >= 50 else "WARNING",
            detail=f"批准正文含 {len(paragraphs)} 个完整段落、{len(body_text)} 字纯文本",
        ),
        PublicationChecklistItem(
            code="FORBIDDEN_EXPRESSIONS_CLEAN",
            label="禁用表达与合规边界",
            status=forbidden_status,
            detail=forbidden_detail,
        ),
        PublicationChecklistItem(
            code="LINKS_VALID",
            label="正文链接有效性",
            status="WARNING" if invalid_links else "PASS",
            detail=(
                f"存在 {len(invalid_links)} 个无效链接"
                if invalid_links
                else f"全部 {len(links)} 个链接格式有效"
            ),
        ),
        PublicationChecklistItem(
            code="IMAGES_ALT_COMPLETE",
            label="正文图片与 Alt 完整性",
            status="WARNING" if bad_images else "PASS",
            detail=(
                f"存在 {len(bad_images)} 张图片缺失 Alt 文本或地址无效"
                if bad_images
                else f"全部 {len(images)} 张图片完整"
            ),
        ),
        PublicationChecklistItem(
            code="TAGS_COUNT_CHECK",
            label="标签数量符合平台要求",
            status="PASS" if 1 <= len(content.tags) <= 10 else "WARNING",
            detail=f"当前共 {len(content.tags)} 个标签（建议 1-10 个）",
        ),
        PublicationChecklistItem(
            code="PUBLISH_META_COMPLETE",
            label="发布时间与操作说明完整",
            status="BLOCKING" if meta_missing else "PASS",
            detail=(
                f"缺少必填项：{'、'.join(meta_missing)}"
                if meta_missing
                else "已填写发布时间与操作说明"
            ),
        ),
    ]

    blocking_count = sum(1 for item in checks if item.status == "BLOCKING")
    warning_count = sum(1 for item in checks if item.status == "WARNING")
    return PublicationPreRegisterCheckOut(
        publication_work_id=work.id,
        content_version_id=content.id,
        can_register=(blocking_count == 0),
        blocking_count=blocking_count,
        warning_count=warning_count,
        checks=checks,
    )
