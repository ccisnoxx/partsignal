"""Slice 1C：回答引用 URL 抽取与文章发布台账分级归因服务（绝不篡改 geo_answer_citations）。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.geo_citation_urls import normalize_citation_url
from app.models.articles import Article, ArticlePublication
from app.models.geo_answers import GeoAnswerCitation, GeoAnswerSnapshot
from app.models.geo_citation_links import GeoCitationPublicationLink
from app.models.identity import User
from app.schemas.common import AccountType
from app.schemas.geo_daily_checklist import (
    GeoCitationLinkDecisionRequest,
    GeoCitationLinkStatus,
    GeoCitationManualLinkRequest,
    GeoCitationMatchMethod,
    GeoCitationPublicationLinkOut,
)
from app.services.current_actor import current_actor_command

_URL_RE = re.compile(r"https?://[^\s<>\"'\]\)）}，。；！？、]+", re.IGNORECASE)
_TRAILING_PUNCT = ".,;:!?)]}）】，。；！？、\"'`"

_TRACKING_PARAM_PREFIXES = ("utm_",)
_TRACKING_PARAMS = frozenset(
    {
        "spm",
        "vd_source",
        "share_source",
        "from",
        "isappinstalled",
        "chksm",
        "scene",
        "mpshare",
        "src",
        "ref",
        "fbclid",
        "gclid",
        "si",
        "igshid",
        "source",
        "share_from",
        "share_medium",
        "share_plat",
        "share_session_id",
    }
)

# 公共 UGC/内容分发平台域名严禁使用“同域名候选”或标记为自有域名；仅精确 URL 或去跟踪参数匹配可关联。
_THIRD_PARTY_UGC_HOSTS = frozenset(
    {
        "zhihu.com",
        "zhuanlan.zhihu.com",
        "mp.weixin.qq.com",
        "weixin.qq.com",
        "csdn.net",
        "blog.csdn.net",
        "juejin.cn",
        "toutiao.com",
        "baijiahao.baidu.com",
        "baidu.com",
        "bilibili.com",
        "cnblogs.com",
        "jianshu.com",
        "sohu.com",
        "163.com",
        "qq.com",
        "douban.com",
        "xiaohongshu.com",
        "medium.com",
        "substack.com",
        "github.com",
        "gitee.com",
        "youtube.com",
        "youtu.be",
        "eeworld.com.cn",
        "elecfans.com",
        "21ic.com",
    }
)


def is_third_party_ugc_host(hostname: str) -> bool:
    host = hostname.lower().rstrip(".")
    return any(host == ugc or host.endswith(f".{ugc}") for ugc in _THIRD_PARTY_UGC_HOSTS)


def extract_urls_from_text(text: str) -> list[str]:
    """从粘贴的回答文本中安全提取去重后的合规 http(s) URL。"""
    results: list[str] = []
    seen: set[str] = set()
    for match in _URL_RE.finditer(text or ""):
        raw = match.group(0).rstrip(_TRAILING_PUNCT)
        if not raw:
            continue
        try:
            info = normalize_citation_url(raw)
        except ValueError:
            continue
        if info.normalized_url not in seen:
            seen.add(info.normalized_url)
            results.append(info.original_url)
    return results


def strip_tracking_params(normalized_url: str) -> str:
    """移除常见追踪查询参数用于候选匹配；不修改已存储的原始规范 URL。"""
    parts = urlsplit(normalized_url)
    if not parts.query:
        return normalized_url
    kept = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if k.lower() not in _TRACKING_PARAMS
        and not any(k.lower().startswith(prefix) for prefix in _TRACKING_PARAM_PREFIXES)
    ]
    new_query = urlencode(kept, doseq=True)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, ""))


@dataclass(frozen=True)
class CitationMatchCandidate:
    article_publication_id: UUID
    article_title: str
    publication_title: str
    platform_name: str
    match_method: GeoCitationMatchMethod
    link_status: GeoCitationLinkStatus
    match_reason: str


def _active_publications(db: Session) -> list[tuple[ArticlePublication, str]]:
    rows = db.execute(
        select(ArticlePublication, Article.title)
        .join(Article, Article.id == ArticlePublication.article_id)
        .where(ArticlePublication.registration_status == "REGISTERED")
        .order_by(ArticlePublication.published_at.desc(), ArticlePublication.id.desc())
    ).all()
    return [(pub, str(title)) for pub, title in rows]


def match_url_against_publications(
    normalized_url: str,
    hostname: str,
    publications: list[tuple[ArticlePublication, str]],
) -> CitationMatchCandidate | None:
    """分级归因纯匹配：精确 URL 自动生效，去参数或自有同域名仅生成 CANDIDATE。"""
    for pub, art_title in publications:
        if pub.normalized_url == normalized_url:
            return CitationMatchCandidate(
                article_publication_id=pub.id,
                article_title=art_title,
                publication_title=pub.actual_title,
                platform_name=pub.platform_name_snapshot,
                match_method=GeoCitationMatchMethod.EXACT_NORMALIZED_URL,
                link_status=GeoCitationLinkStatus.AUTO_EXACT,
                match_reason="规范化 URL 精确一致",
            )
    stripped_target = strip_tracking_params(normalized_url)
    for pub, art_title in publications:
        if strip_tracking_params(pub.normalized_url) == stripped_target:
            return CitationMatchCandidate(
                article_publication_id=pub.id,
                article_title=art_title,
                publication_title=pub.actual_title,
                platform_name=pub.platform_name_snapshot,
                match_method=GeoCitationMatchMethod.STRIPPED_TRACKING_CANDIDATE,
                link_status=GeoCitationLinkStatus.CANDIDATE,
                match_reason="去除追踪参数后 URL 一致，待人工确认",
            )
    if not is_third_party_ugc_host(hostname):
        host_lower = hostname.lower()
        for pub, art_title in publications:
            if pub.hostname.lower() == host_lower:
                return CitationMatchCandidate(
                    article_publication_id=pub.id,
                    article_title=art_title,
                    publication_title=pub.actual_title,
                    platform_name=pub.platform_name_snapshot,
                    match_method=GeoCitationMatchMethod.SAME_DOMAIN_CANDIDATE,
                    link_status=GeoCitationLinkStatus.CANDIDATE,
                    match_reason="非第三方 UGC 的同域名文章候选，待人工确认",
                )
    return None


def materialize_citation_links(
    db: Session, *, answer_snapshot_id: UUID
) -> list[GeoCitationPublicationLink]:
    """在回答引用落库后幂等生成分级归因记录（调用方控制事务）。"""
    citations = list(
        db.scalars(
            select(GeoAnswerCitation)
            .where(GeoAnswerCitation.answer_snapshot_id == answer_snapshot_id)
            .order_by(GeoAnswerCitation.position.asc())
        )
    )
    if not citations:
        return []
    existing_pairs = set(
        db.execute(
            select(
                GeoCitationPublicationLink.citation_id,
                GeoCitationPublicationLink.article_publication_id,
            ).where(GeoCitationPublicationLink.citation_id.in_([c.id for c in citations]))
        ).all()
    )
    publications = _active_publications(db)
    now = datetime.now(UTC)
    created: list[GeoCitationPublicationLink] = []
    for cit in citations:
        candidate = match_url_against_publications(cit.normalized_url, cit.hostname, publications)
        if candidate is None:
            continue
        if (cit.id, candidate.article_publication_id) in existing_pairs:
            continue
        row = GeoCitationPublicationLink(
            citation_id=cit.id,
            article_publication_id=candidate.article_publication_id,
            match_method=candidate.match_method.value,
            link_status=candidate.link_status.value,
            match_reason=candidate.match_reason,
            confirmed_by=None,
            confirmed_at=None,
            revision=0,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        created.append(row)
    db.flush()
    return created


def _link_out(
    link: GeoCitationPublicationLink,
    citation: GeoAnswerCitation,
    pub: ArticlePublication,
    article_title: str,
) -> GeoCitationPublicationLinkOut:
    return GeoCitationPublicationLinkOut(
        id=link.id,
        citation_id=link.citation_id,
        citation_url=citation.original_url,
        article_publication_id=link.article_publication_id,
        article_id=pub.article_id,
        article_title=article_title,
        publication_title=pub.actual_title,
        publication_url=pub.final_url,
        platform_name=pub.platform_name_snapshot,
        match_method=GeoCitationMatchMethod(link.match_method),
        link_status=GeoCitationLinkStatus(link.link_status),
        match_reason=link.match_reason,
        confirmed_by=link.confirmed_by,
        confirmed_at=link.confirmed_at,
        revision=link.revision,
        created_at=link.created_at,
        updated_at=link.updated_at,
    )


def list_run_citation_links(db: Session, run_id: UUID) -> list[GeoCitationPublicationLinkOut]:
    rows = db.execute(
        select(GeoCitationPublicationLink, GeoAnswerCitation, ArticlePublication, Article.title)
        .join(GeoAnswerCitation, GeoAnswerCitation.id == GeoCitationPublicationLink.citation_id)
        .join(GeoAnswerSnapshot, GeoAnswerSnapshot.id == GeoAnswerCitation.answer_snapshot_id)
        .join(
            ArticlePublication,
            ArticlePublication.id == GeoCitationPublicationLink.article_publication_id,
        )
        .join(Article, Article.id == ArticlePublication.article_id)
        .where(GeoAnswerSnapshot.run_id == run_id)
        .order_by(GeoAnswerCitation.position.asc(), GeoCitationPublicationLink.created_at.asc())
    ).all()
    return [_link_out(link, cit, pub, str(art_title)) for link, cit, pub, art_title in rows]


def _demote_other_effective_links(
    db: Session, *, citation_id: UUID, keep_link_id: UUID | None, actor_id: UUID, now: datetime
) -> None:
    others = list(
        db.scalars(
            select(GeoCitationPublicationLink)
            .where(
                GeoCitationPublicationLink.citation_id == citation_id,
                GeoCitationPublicationLink.link_status.in_(["AUTO_EXACT", "CONFIRMED"]),
            )
            .with_for_update()
        )
    )
    for other in others:
        if keep_link_id is not None and other.id == keep_link_id:
            continue
        other.link_status = "REJECTED"
        other.confirmed_by = actor_id
        other.confirmed_at = now
        other.updated_at = now
        other.revision += 1
    db.flush()


def decide_citation_link(
    db: Session,
    *,
    link_id: UUID,
    payload: GeoCitationLinkDecisionRequest,
    actor: User,
    request_id: str,
) -> GeoCitationPublicationLinkOut:
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN, AccountType.ENGINEER)) as cur:
        link = db.scalar(
            select(GeoCitationPublicationLink)
            .where(GeoCitationPublicationLink.id == link_id)
            .with_for_update()
        )
        if link is None:
            raise not_found("引用归因记录")
        if link.revision != payload.expected_revision:
            raise AppError("REVISION_CONFLICT", "引用归因记录已被其他请求修改，请刷新", 409)
        now = datetime.now(UTC)
        if payload.link_status == "CONFIRMED":
            _demote_other_effective_links(
                db, citation_id=link.citation_id, keep_link_id=link.id, actor_id=cur.id, now=now
            )
        link.link_status = payload.link_status
        link.confirmed_by = cur.id
        link.confirmed_at = now
        link.updated_at = now
        link.revision += 1
        db.flush()
        append_audit(
            db,
            AuditEntry(
                actor_id=cur.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action=(
                    "geo_citation_link.confirmed"
                    if payload.link_status == "CONFIRMED"
                    else "geo_citation_link.rejected"
                ),
                target_type="GeoCitationPublicationLink",
                target_id=link.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已更新引用到发布文章的归因状态",
                details={
                    "facts": {
                        "link_id": str(link.id),
                        "article_publication_id": str(link.article_publication_id),
                        "link_status": link.link_status,
                        "revision": link.revision,
                    }
                },
            ),
        )
        cit = db.get(GeoAnswerCitation, link.citation_id)
        pub = db.get(ArticlePublication, link.article_publication_id)
        assert cit is not None and pub is not None
        art = db.get(Article, pub.article_id)
        assert art is not None
        out = _link_out(link, cit, pub, art.title)
        db.commit()
        return out


def create_manual_citation_link(
    db: Session,
    *,
    citation_id: UUID,
    payload: GeoCitationManualLinkRequest,
    actor: User,
    request_id: str,
) -> GeoCitationPublicationLinkOut:
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN, AccountType.ENGINEER)) as cur:
        cit = db.get(GeoAnswerCitation, citation_id)
        if cit is None:
            raise not_found("回答引用")
        pub = db.get(ArticlePublication, payload.article_publication_id)
        if pub is None:
            raise not_found("文章发布记录")
        art = db.get(Article, pub.article_id)
        assert art is not None
        now = datetime.now(UTC)
        existing = db.scalar(
            select(GeoCitationPublicationLink)
            .where(
                GeoCitationPublicationLink.citation_id == cit.id,
                GeoCitationPublicationLink.article_publication_id == pub.id,
            )
            .with_for_update()
        )
        _demote_other_effective_links(
            db,
            citation_id=cit.id,
            keep_link_id=existing.id if existing else None,
            actor_id=cur.id,
            now=now,
        )
        if existing is not None:
            existing.link_status = "CONFIRMED"
            existing.match_reason = payload.match_reason or existing.match_reason
            existing.confirmed_by = cur.id
            existing.confirmed_at = now
            existing.updated_at = now
            existing.revision += 1
            link = existing
        else:
            link = GeoCitationPublicationLink(
                citation_id=cit.id,
                article_publication_id=pub.id,
                match_method=GeoCitationMatchMethod.MANUAL_SELECTED.value,
                link_status=GeoCitationLinkStatus.CONFIRMED.value,
                match_reason=payload.match_reason or "人工确认引用归属",
                confirmed_by=cur.id,
                confirmed_at=now,
                revision=0,
                created_at=now,
                updated_at=now,
            )
            db.add(link)
        db.flush()
        append_audit(
            db,
            AuditEntry(
                actor_id=cur.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_citation_link.manual_linked",
                target_type="GeoCitationPublicationLink",
                target_id=link.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已人工关联回答引用与发布文章",
                details={
                    "facts": {
                        "link_id": str(link.id),
                        "article_publication_id": str(pub.id),
                        "link_status": link.link_status,
                        "revision": link.revision,
                    }
                },
            ),
        )
        out = _link_out(link, cit, pub, art.title)
        db.commit()
        return out
