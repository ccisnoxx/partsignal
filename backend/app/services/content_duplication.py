"""Slice 3B：同活动（Campaign）与同产品历史内容重复度分析及差异化建议引擎。"""

from __future__ import annotations

import math
import re
import uuid
from collections import Counter
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import not_found
from app.models.configuration import PlatformProfile
from app.models.content import ContentBriefSnapshot, ContentTask, ContentVersion
from app.models.product_facts import FactVersion
from app.schemas.content_quality import (
    ContentDuplicationAnalysisOut,
    DuplicateParagraphItem,
    DuplicateTitleItem,
    SimilarContentItem,
)

NEAR_DUPLICATE_WARNING_THRESHOLD = 0.55
TITLE_DUPLICATE_THRESHOLD = 0.65
PARAGRAPH_DUPLICATE_THRESHOLD = 0.55
MIN_PARAGRAPH_CHARS = 24

_TOKEN_RE = re.compile(r"[a-z0-9]{2,}|[\u4e00-\u9fff]{2,}")


def _normalize_similarity_text(value: str) -> str:
    return re.sub(r"\s+", "", value.casefold())


def _trigrams(value: str) -> set[str]:
    norm = _normalize_similarity_text(value)
    if not norm:
        return set()
    if len(norm) < 3:
        return {norm}
    return {norm[idx : idx + 3] for idx in range(len(norm) - 2)}


def semantic_tokens(value: str) -> Counter[str]:
    """提取英文词干与中文二字词用于语义重叠估算。"""
    lowered = value.casefold()
    counts: Counter[str] = Counter()
    for token in _TOKEN_RE.findall(lowered):
        if re.fullmatch(r"[a-z0-9]+", token) or len(token) == 2:
            counts[token] += 1
        else:
            for idx in range(len(token) - 1):
                counts[token[idx : idx + 2]] += 1
    return counts


def compute_content_similarity(left: str, right: str) -> float:
    """结合字符 3-gram Jaccard 与词袋余弦相似度，兼顾字面与改写重复。"""
    left_tri = _trigrams(left)
    right_tri = _trigrams(right)
    if not left_tri and not right_tri:
        return 1.0
    if not left_tri or not right_tri:
        return 0.0
    jaccard = len(left_tri & right_tri) / len(left_tri | right_tri)

    left_vec = semantic_tokens(left)
    right_vec = semantic_tokens(right)
    if left_vec and right_vec:
        shared_keys = left_vec.keys() & right_vec.keys()
        dot = sum(left_vec[k] * right_vec[k] for k in shared_keys)
        norm_left = math.sqrt(sum(v * v for v in left_vec.values()))
        norm_right = math.sqrt(sum(v * v for v in right_vec.values()))
        cosine = dot / (norm_left * norm_right) if norm_left > 0 and norm_right > 0 else 0.0
    else:
        cosine = jaccard
    return round(min(1.0, max(jaccard, 0.45 * jaccard + 0.55 * cosine)), 4)


def split_markdown_paragraphs(body_markdown: str) -> list[str]:
    """将 Markdown 正文拆分为非标题有效段落用于段落级重复检测。"""
    paragraphs: list[str] = []
    for block in re.split(r"\n\s*\n+", body_markdown):
        cleaned = re.sub(r"\s+", " ", block).strip()
        if not cleaned or cleaned.startswith("#") or cleaned.startswith("```"):
            continue
        if len(cleaned) >= MIN_PARAGRAPH_CHARS:
            paragraphs.append(cleaned)
    return paragraphs


@dataclass(frozen=True)
class SiblingContentRow:
    content_version_id: uuid.UUID
    content_task_id: uuid.UUID
    task_identifier: str
    platform_name: str
    campaign_id: uuid.UUID | None
    same_campaign: bool
    same_product: bool
    title: str
    summary: str
    body_markdown: str
    status: str


def load_sibling_contents(
    db: Session,
    task: ContentTask,
    *,
    public_only: bool = False,
) -> list[SiblingContentRow]:
    """加载同 Campaign 或同产品其他任务的当前非废弃内容版本；外发场景可强制限定 PUBLIC。"""
    stmt = (
        select(
            ContentVersion.id,
            ContentTask.id,
            ContentTask.product_id,
            ContentTask.campaign_id,
            PlatformProfile.name,
            ContentVersion.title,
            ContentVersion.summary,
            ContentVersion.body_markdown,
            ContentVersion.status,
        )
        .join(ContentTask, ContentTask.current_content_version_id == ContentVersion.id)
        .outerjoin(PlatformProfile, PlatformProfile.id == ContentTask.platform_profile_id)
    )
    if public_only:
        stmt = stmt.join(FactVersion, FactVersion.id == ContentVersion.fact_version_id).where(
            FactVersion.classification == "PUBLIC"
        )
    rows = db.execute(
        stmt.where(
            ContentTask.id != task.id,
            ContentVersion.status != "ABANDONED",
            (
                (ContentTask.product_id == task.product_id)
                | (
                    (ContentTask.campaign_id == task.campaign_id)
                    if task.campaign_id is not None
                    else False
                )
            ),
        )
        .order_by(ContentVersion.created_at.desc(), ContentVersion.id.desc())
        .limit(80)
    ).all()
    siblings: list[SiblingContentRow] = []
    for (
        ver_id,
        sibling_task_id,
        sibling_product_id,
        campaign_id,
        platform_name,
        title,
        summary,
        body_markdown,
        status,
    ) in rows:
        siblings.append(
            SiblingContentRow(
                content_version_id=ver_id,
                content_task_id=sibling_task_id,
                task_identifier=f"CT-{sibling_task_id.hex[:8].upper()}",
                platform_name=platform_name or "未命名平台",
                campaign_id=campaign_id,
                same_campaign=(task.campaign_id is not None and campaign_id == task.campaign_id),
                same_product=(sibling_product_id == task.product_id),
                title=title,
                summary=summary,
                body_markdown=body_markdown,
                status=status,
            )
        )
    return siblings


def _build_differentiation_suggestions(
    *,
    same_campaign_max: float,
    same_product_max: float,
    duplicate_titles: list[DuplicateTitleItem],
    duplicate_paragraphs: list[DuplicateParagraphItem],
    brief: ContentBriefSnapshot | None,
    platform_name: str,
) -> list[str]:
    suggestions: list[str] = []
    if duplicate_titles:
        suggestions.append(
            f"当前标题与《{duplicate_titles[0].title}》（{duplicate_titles[0].platform_name}）"
            f"高度雷同，建议按“{platform_name}”读者搜索习惯重写切入点与场景词。"
        )
    if duplicate_paragraphs:
        suggestions.append(
            f"检测到 {len(duplicate_paragraphs)} 组高重叠段落，建议将重复段落改写为目标平台专属"
            "结构（如问答拆解、选型核对清单或场景对比表）。"
        )
    if same_campaign_max >= NEAR_DUPLICATE_WARNING_THRESHOLD:
        angle = brief.content_angle if brief is not None else "目标角度"
        suggestions.append(
            f"同 Campaign 跨平台相似度较高（{same_campaign_max:.0%}），"
            f"请围绕当前 Brief 角度“{angle}”突出差异化案例与结构层次。"
        )
    elif same_product_max >= NEAR_DUPLICATE_WARNING_THRESHOLD:
        suggestions.append(
            f"与同产品历史内容相似度达 {same_product_max:.0%}，"
            "建议换用不同的目标问题切入、调整段落节奏并避免复用原稿开头与结论。"
        )
    if not suggestions:
        suggestions.append("当前内容与同活动及同产品历史内容差异度良好，建议保持平台专属表达风格。")
    return suggestions


def analyze_content_duplication(
    db: Session,
    *,
    content_version_id: uuid.UUID,
    public_only: bool = False,
) -> ContentDuplicationAnalysisOut:
    """计算目标内容版本与同 Campaign/同产品历史内容的相似度、重复段落与差异化建议。"""
    content = db.get(ContentVersion, content_version_id)
    if content is None:
        raise not_found("内容版本")
    task = db.get(ContentTask, content.task_id)
    if task is None:
        raise not_found("内容任务")
    platform = (
        db.get(PlatformProfile, task.platform_profile_id)
        if task.platform_profile_id is not None
        else None
    )
    brief = db.get(ContentBriefSnapshot, task.id)
    siblings = load_sibling_contents(db, task, public_only=public_only)

    source_full = "\n".join((content.title, content.summary, content.body_markdown))
    source_paragraphs = split_markdown_paragraphs(content.body_markdown)

    similar_items: list[SimilarContentItem] = []
    duplicate_titles: list[DuplicateTitleItem] = []
    duplicate_paragraphs: list[DuplicateParagraphItem] = []
    same_campaign_max = 0.0
    same_product_max = 0.0
    compared_campaign_count = 0
    compared_product_count = 0

    for sibling in siblings:
        if sibling.same_campaign:
            compared_campaign_count += 1
        if sibling.same_product:
            compared_product_count += 1
        target_full = "\n".join((sibling.title, sibling.summary, sibling.body_markdown))
        sim = compute_content_similarity(source_full, target_full)
        title_sim = compute_content_similarity(content.title, sibling.title)
        if sibling.same_campaign:
            same_campaign_max = max(same_campaign_max, sim)
        if sibling.same_product:
            same_product_max = max(same_product_max, sim)

        if title_sim >= TITLE_DUPLICATE_THRESHOLD:
            duplicate_titles.append(
                DuplicateTitleItem(
                    content_version_id=sibling.content_version_id,
                    content_task_id=sibling.content_task_id,
                    task_identifier=sibling.task_identifier,
                    platform_name=sibling.platform_name,
                    same_campaign=sibling.same_campaign,
                    title=sibling.title,
                    similarity=title_sim,
                )
            )

        target_paragraphs = split_markdown_paragraphs(sibling.body_markdown)
        shared_para_count = 0
        for src_p in source_paragraphs:
            best_sim = 0.0
            best_match = ""
            for tgt_p in target_paragraphs:
                p_sim = compute_content_similarity(src_p, tgt_p)
                if p_sim > best_sim:
                    best_sim = p_sim
                    best_match = tgt_p
            if best_sim >= PARAGRAPH_DUPLICATE_THRESHOLD:
                shared_para_count += 1
                duplicate_paragraphs.append(
                    DuplicateParagraphItem(
                        target_version_id=sibling.content_version_id,
                        target_task_identifier=sibling.task_identifier,
                        target_platform_name=sibling.platform_name,
                        target_title=sibling.title,
                        same_campaign=sibling.same_campaign,
                        source_excerpt=src_p[:240],
                        matched_excerpt=best_match[:240],
                        similarity=best_sim,
                    )
                )

        if sim >= 0.25 or title_sim >= TITLE_DUPLICATE_THRESHOLD or shared_para_count > 0:
            similar_items.append(
                SimilarContentItem(
                    content_version_id=sibling.content_version_id,
                    content_task_id=sibling.content_task_id,
                    task_identifier=sibling.task_identifier,
                    platform_name=sibling.platform_name,
                    campaign_id=sibling.campaign_id,
                    same_campaign=sibling.same_campaign,
                    title=sibling.title,
                    status=sibling.status,
                    similarity=sim,
                    title_similarity=title_sim,
                    shared_paragraph_count=shared_para_count,
                )
            )

    similar_items.sort(
        key=lambda item: (-item.similarity, -item.title_similarity, str(item.content_version_id))
    )
    duplicate_titles.sort(key=lambda item: (-item.similarity, str(item.content_version_id)))
    duplicate_paragraphs.sort(key=lambda item: (-item.similarity, str(item.target_version_id)))

    suggestions = _build_differentiation_suggestions(
        same_campaign_max=same_campaign_max,
        same_product_max=same_product_max,
        duplicate_titles=duplicate_titles,
        duplicate_paragraphs=duplicate_paragraphs,
        brief=brief,
        platform_name=platform.name if platform is not None else "目标平台",
    )
    return ContentDuplicationAnalysisOut(
        content_version_id=content.id,
        content_task_id=task.id,
        campaign_id=task.campaign_id,
        product_id=task.product_id,
        compared_campaign_count=compared_campaign_count,
        compared_product_count=compared_product_count,
        same_campaign_max_similarity=same_campaign_max,
        same_product_max_similarity=same_product_max,
        similar_contents=similar_items[:5],
        duplicate_titles=duplicate_titles[:5],
        duplicate_paragraphs=duplicate_paragraphs[:10],
        differentiation_suggestions=suggestions,
    )
