"""追加式 GEO 观测的查询、投影、创建与纠正服务。"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import Select, delete, exists, func, literal, or_, select
from sqlalchemy.orm import Session, aliased

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.configuration import PlatformProfile, QueryTopic
from app.models.content import ContentTask, ContentVersion
from app.models.geo_files import (
    GeoObservation,
    GeoObservationAttachment,
    GeoObservationCitation,
    GeoObservationPublication,
)
from app.models.identity import User
from app.models.product_facts import Product
from app.models.publication import PublicationWork, PublishedArticle, PublishedContentIssue
from app.schemas import geo_files as geo_schema
from app.schemas.content import ActorSummary
from app.schemas.geo_files import (
    GeoAccuracy,
    GeoArticleResultOut,
    GeoCitation,
    GeoMetrics,
    GeoObservationAction,
    GeoObservationCreate,
    GeoObservationKind,
    GeoObservationList,
    GeoObservationOut,
    GeoObservationSortOrder,
    GeoPublicationCandidate,
    LegacyGeoObservationOut,
    LegacyRecommendation,
    ManualGeoObservationOut,
)
from app.services.file_records import schedule_unreferenced_file, verified_files


@dataclass(frozen=True, slots=True)
class GeoObservationFilters:
    """列表与指标共享的受约束筛选条件。"""

    date_from: date | None = None
    date_to: date | None = None
    observation_kind: GeoObservationKind | None = None
    product_id: uuid.UUID | None = None
    search: str | None = None
    query_topic_id: uuid.UUID | None = None
    model_name: str | None = None
    search_platform: str | None = None
    publication_search: str | None = None
    discovered: bool | None = None
    mentioned: bool | None = None
    recommendation: LegacyRecommendation | None = None
    has_citation: bool | None = None
    accuracy: GeoAccuracy | None = None
    recorder_search: str | None = None
    only_mine: bool = False
    include_history: bool = False


@dataclass(frozen=True, slots=True)
class GeoInsightFilters:
    """分析页面全部区块共用的精确筛选。"""

    date_from: date | None = None
    date_to: date | None = None
    content_platform_id: uuid.UUID | None = None
    geo_platform: str | None = None
    published_article_id: uuid.UUID | None = None
    query_topic_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class _GeoInsightRow:
    observation_id: uuid.UUID
    tested_at: datetime
    query_topic_id: uuid.UUID | None
    geo_platform: str
    published_article_id: uuid.UUID
    title: str
    published_at: datetime | None
    content_platform_id: uuid.UUID
    content_platform: str
    discovered: bool | None
    mentioned: bool | None
    accuracy: str | None


def _contains_pattern(value: str) -> str:
    """把用户搜索文本转换为字面量 LIKE 模式，不开放通配符语义。"""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def geo_observation_query(
    filters: GeoObservationFilters, *, actor_id: uuid.UUID
) -> Select[tuple[GeoObservation]]:
    """构造列表与指标唯一共用的观测筛选查询。"""
    query = select(GeoObservation)
    if not filters.include_history:
        superseding = aliased(GeoObservation)
        query = query.where(
            ~exists(select(superseding.id).where(superseding.supersedes_id == GeoObservation.id))
        )
    if filters.date_from is not None:
        query = query.where(
            GeoObservation.tested_at
            >= datetime.combine(filters.date_from, datetime.min.time(), tzinfo=UTC)
        )
    if filters.date_to is not None:
        query = query.where(
            GeoObservation.tested_at
            < datetime.combine(filters.date_to + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
        )
    if filters.observation_kind is not None:
        query = query.where(GeoObservation.observation_kind == filters.observation_kind)
    if filters.product_id is not None:
        query = query.where(GeoObservation.product_id == filters.product_id)
    if filters.search is not None:
        pattern = _contains_pattern(filters.search)
        query = query.where(
            or_(
                GeoObservation.actual_prompt.ilike(pattern, escape="\\"),
                GeoObservation.search_query.ilike(pattern, escape="\\"),
            )
        )
    if filters.query_topic_id is not None:
        query = query.where(GeoObservation.query_topic_id == filters.query_topic_id)
    if filters.model_name is not None:
        query = query.where(
            GeoObservation.observation_kind == "LEGACY_MODEL_RESULT",
            GeoObservation.model_name == filters.model_name,
        )
    if filters.search_platform is not None:
        query = query.where(
            GeoObservation.observation_kind == "MANUAL_ARTICLE_SEARCH",
            GeoObservation.search_platform == filters.search_platform,
        )
    if filters.publication_search is not None:
        pattern = _contains_pattern(filters.publication_search)
        query = query.where(
            exists(
                select(GeoObservationPublication.observation_id)
                .join(
                    PublicationWork,
                    PublicationWork.id == GeoObservationPublication.published_article_id,
                )
                .join(
                    ContentVersion,
                    ContentVersion.id == PublicationWork.content_version_id,
                )
                .where(
                    GeoObservationPublication.observation_id == GeoObservation.id,
                    or_(
                        ContentVersion.title.ilike(pattern, escape="\\"),
                        PublicationWork.actual_title.ilike(pattern, escape="\\"),
                        PublicationWork.final_url.ilike(pattern, escape="\\"),
                    ),
                )
            )
        )
    if filters.discovered is not None:
        query = query.where(
            GeoObservation.observation_kind == "MANUAL_ARTICLE_SEARCH",
            exists(
                select(GeoObservationPublication.observation_id).where(
                    GeoObservationPublication.observation_id == GeoObservation.id,
                    GeoObservationPublication.discovered.is_(filters.discovered),
                )
            ),
        )
    if filters.mentioned is not None:
        manual_mentioned = exists(
            select(GeoObservationPublication.observation_id).where(
                GeoObservationPublication.observation_id == GeoObservation.id,
                GeoObservationPublication.mentioned.is_(filters.mentioned),
            )
        )
        query = query.where(
            or_(
                (
                    (GeoObservation.observation_kind == "LEGACY_MODEL_RESULT")
                    & GeoObservation.mentioned.is_(filters.mentioned)
                ),
                (
                    (GeoObservation.observation_kind == "MANUAL_ARTICLE_SEARCH")
                    & manual_mentioned
                ),
            )
        )
    if filters.recommendation is not None:
        query = query.where(
            GeoObservation.observation_kind == "LEGACY_MODEL_RESULT",
            GeoObservation.recommendation == filters.recommendation,
        )
    if filters.has_citation is not None:
        citation_exists = exists(
            select(GeoObservationCitation.id).where(
                GeoObservationCitation.observation_id == GeoObservation.id
            )
        )
        query = query.where(
            GeoObservation.observation_kind == "LEGACY_MODEL_RESULT",
            citation_exists if filters.has_citation else ~citation_exists,
        )
    if filters.accuracy is not None:
        manual_accuracy = exists(
            select(GeoObservationPublication.observation_id).where(
                GeoObservationPublication.observation_id == GeoObservation.id,
                GeoObservationPublication.accuracy == filters.accuracy,
            )
        )
        query = query.where(
            or_(
                (
                    (GeoObservation.observation_kind == "LEGACY_MODEL_RESULT")
                    & (GeoObservation.accuracy == filters.accuracy)
                ),
                (
                    (GeoObservation.observation_kind == "MANUAL_ARTICLE_SEARCH")
                    & manual_accuracy
                ),
            )
        )
    if filters.recorder_search is not None:
        pattern = _contains_pattern(filters.recorder_search)
        query = query.where(
            exists(
                select(User.id).where(
                    User.id == GeoObservation.tested_by,
                    or_(
                        User.username.ilike(pattern, escape="\\"),
                        User.display_name.ilike(pattern, escape="\\"),
                    ),
                )
            )
        )
    if filters.only_mine:
        query = query.where(GeoObservation.tested_by == actor_id)
    return query


def geo_observations_out(
    db: Session, observations: list[GeoObservation], *, actor: User
) -> list[GeoObservationOut]:
    """批量投影视图上下文，列表循环不再调用详情查询。"""
    if not observations:
        return []
    observation_ids = [item.id for item in observations]
    product_ids = {item.product_id for item in observations}
    recorder_ids = {item.tested_by for item in observations}

    products = {
        product.id: product
        for product in db.scalars(select(Product).where(Product.id.in_(product_ids)))
    }
    recorders = {
        user.id: user for user in db.scalars(select(User).where(User.id.in_(recorder_ids)))
    }
    superseded_ids = set(
        db.scalars(
            select(GeoObservation.supersedes_id).where(
                GeoObservation.supersedes_id.in_(observation_ids)
            )
        )
    )

    attachments: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    manual_ids = [
        item.id for item in observations if item.observation_kind == "MANUAL_ARTICLE_SEARCH"
    ]
    if manual_ids:
        ancestor_chain = (
            select(
                GeoObservation.id.label("requested_id"),
                GeoObservation.id.label("node_id"),
                literal(0).label("depth"),
            )
            .where(GeoObservation.id.in_(manual_ids))
            .cte("geo_observation_ancestor_chain", recursive=True)
        )
        chain_node = aliased(GeoObservation)
        ancestor_chain = ancestor_chain.union_all(
            select(
                ancestor_chain.c.requested_id,
                chain_node.supersedes_id,
                ancestor_chain.c.depth + 1,
            )
            .join(chain_node, chain_node.id == ancestor_chain.c.node_id)
            .where(chain_node.supersedes_id.is_not(None))
        )
        for requested_id, file_id in db.execute(
            select(ancestor_chain.c.requested_id, GeoObservationAttachment.file_id)
            .join(
                GeoObservationAttachment,
                GeoObservationAttachment.observation_id == ancestor_chain.c.node_id,
            )
            .order_by(
                ancestor_chain.c.requested_id,
                ancestor_chain.c.depth.desc(),
                GeoObservationAttachment.file_id,
            )
        ).all():
            if file_id not in attachments[requested_id]:
                attachments[requested_id].append(file_id)
    legacy_ids = [
        item.id for item in observations if item.observation_kind == "LEGACY_MODEL_RESULT"
    ]
    if legacy_ids:
        for observation_id, file_id in db.execute(
            select(GeoObservationAttachment.observation_id, GeoObservationAttachment.file_id)
            .where(GeoObservationAttachment.observation_id.in_(legacy_ids))
            .order_by(GeoObservationAttachment.observation_id, GeoObservationAttachment.file_id)
        ).all():
            attachments[observation_id].append(file_id)

    relations: dict[
        uuid.UUID,
        list[tuple[GeoObservationPublication, PublicationWork, str, str]],
    ] = defaultdict(list)
    for relation, publication, content_title, platform_name in db.execute(
        select(
            GeoObservationPublication,
            PublicationWork,
            ContentVersion.title,
            PlatformProfile.name,
        )
        .join(
            PublicationWork,
            PublicationWork.id == GeoObservationPublication.published_article_id,
        )
        .join(ContentVersion, ContentVersion.id == PublicationWork.content_version_id)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .join(PlatformProfile, PlatformProfile.id == ContentTask.platform_profile_id)
        .where(GeoObservationPublication.observation_id.in_(observation_ids))
        .order_by(GeoObservationPublication.observation_id, PublicationWork.id)
    ).all():
        relations[relation.observation_id].append(
            (relation, publication, content_title, platform_name)
        )

    citations: dict[uuid.UUID, list[GeoObservationCitation]] = defaultdict(list)
    for citation in db.scalars(
        select(GeoObservationCitation)
        .where(GeoObservationCitation.observation_id.in_(observation_ids))
        .order_by(GeoObservationCitation.observation_id, GeoObservationCitation.id)
    ):
        citations[citation.observation_id].append(citation)

    outputs: list[GeoObservationOut] = []
    can_correct = actor.account_type in {"ADMIN", "ENGINEER"}
    can_delete = actor.account_type == "ADMIN"
    for observation in observations:
        product = products.get(observation.product_id)
        recorder = recorders.get(observation.tested_by)
        if product is None or recorder is None:
            raise AppError(
                "GEO_OBSERVATION_CONTEXT_INCOMPLETE",
                "GEO 观测关联的产品或记录人不存在",
                409,
            )
        is_current = observation.id not in superseded_ids
        available_actions: list[GeoObservationAction] = []
        if is_current and observation.observation_kind == "MANUAL_ARTICLE_SEARCH":
            if can_correct:
                available_actions.append("CORRECT")
            if can_delete:
                available_actions.append("DELETE")
        common = {
            "observation_kind": observation.observation_kind,
            "id": observation.id,
            "product_id": observation.product_id,
            "product_label": f"{product.brand} {product.part_number}",
            "tested_at": observation.tested_at,
            "attachment_file_ids": attachments[observation.id],
            "notes": observation.notes,
            "supersedes_id": observation.supersedes_id,
            "tested_by": observation.tested_by,
            "recorder": ActorSummary(
                id=recorder.id,
                username=recorder.username,
                display_name=recorder.display_name,
            ),
            "is_current": is_current,
            "available_actions": available_actions,
            "created_at": observation.created_at,
        }
        if observation.observation_kind == "MANUAL_ARTICLE_SEARCH":
            article_results: list[GeoArticleResultOut] = []
            for relation, publication, content_title, platform_name in relations[observation.id]:
                if publication.final_url is None:
                    raise AppError(
                        "GEO_OBSERVATION_CONTEXT_INCOMPLETE",
                        "人工 GEO 观测关联的发布地址不存在",
                        409,
                    )
                article_results.append(
                    GeoArticleResultOut.model_validate(
                        {
                            "published_article_id": publication.id,
                            "discovered": relation.discovered,
                            "mentioned": relation.mentioned,
                            "accuracy": relation.accuracy,
                            "title": publication.actual_title or content_title,
                            "platform_name": platform_name,
                            "final_url": publication.final_url,
                        }
                    )
                )
            outputs.append(
                ManualGeoObservationOut.model_validate(
                    {
                        **common,
                        "query_topic_id": observation.query_topic_id,
                        "search_platform": observation.search_platform,
                        "search_query": observation.search_query,
                        "article_results": article_results,
                    }
                )
            )
            continue

        outputs.append(
            LegacyGeoObservationOut.model_validate(
                {
                    **common,
                    "query_topic_id": observation.query_topic_id,
                    "actual_prompt": observation.actual_prompt,
                    "model_name": observation.model_name,
                    "model_version": observation.model_version,
                    "web_search_enabled": observation.web_search_enabled,
                    "answer_summary": observation.answer_summary,
                    "mentioned": observation.mentioned,
                    "recommendation": observation.recommendation,
                    "accuracy": observation.accuracy,
                    "citations": [
                        GeoCitation(
                            url=citation.url,
                            source_type=citation.source_type,
                            published_article_id=citation.published_article_id,
                        )
                        for citation in citations[observation.id]
                    ],
                    "published_article_ids": [
                        publication.id for _, publication, _, _ in relations[observation.id]
                    ],
                }
            )
        )
    return outputs


def list_geo_observations(
    db: Session,
    *,
    filters: GeoObservationFilters,
    actor: User,
    page: int,
    page_size: int,
    sort_order: GeoObservationSortOrder,
) -> GeoObservationList:
    """按共享筛选分页返回 GEO 观测。"""
    query = geo_observation_query(filters, actor_id=actor.id)
    total = int(db.scalar(select(func.count()).select_from(query.subquery())) or 0)
    tested_at_order = (
        GeoObservation.tested_at.asc() if sort_order == "ASC" else GeoObservation.tested_at.desc()
    )
    observations = list(
        db.scalars(
            query.order_by(tested_at_order, GeoObservation.id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return GeoObservationList(
        items=geo_observations_out(db, observations, actor=actor),
        page=page,
        page_size=page_size,
        total=total,
    )


def get_geo_observation(
    db: Session, observation_id: uuid.UUID, *, actor: User
) -> GeoObservationOut:
    """返回一条可深链读取的 GEO 观测详情。"""
    observation = db.get(GeoObservation, observation_id)
    if observation is None:
        raise not_found("GEO 观测")
    return geo_observations_out(db, [observation], actor=actor)[0]


def get_geo_metrics(db: Session, *, filters: GeoObservationFilters, actor: User) -> GeoMetrics:
    """使用数据库条件聚合计算旧模型与人工逐篇两类明确指标。"""
    filtered = geo_observation_query(filters, actor_id=actor.id).subquery()
    cited = exists(
        select(GeoObservationCitation.id).where(
            GeoObservationCitation.observation_id == filtered.c.id
        )
    )
    (
        legacy_count,
        mentioned_count,
        recommended_legacy_count,
        cited_count,
        accurate_count,
        judgeable_count,
        manual_count,
    ) = db.execute(
        select(
            func.count().filter(filtered.c.observation_kind == "LEGACY_MODEL_RESULT"),
            func.count().filter(
                filtered.c.observation_kind == "LEGACY_MODEL_RESULT",
                filtered.c.mentioned.is_(True),
            ),
            func.count().filter(
                filtered.c.observation_kind == "LEGACY_MODEL_RESULT",
                filtered.c.recommendation == "RECOMMENDED",
            ),
            func.count().filter(filtered.c.observation_kind == "LEGACY_MODEL_RESULT", cited),
            func.count().filter(
                filtered.c.observation_kind == "LEGACY_MODEL_RESULT",
                filtered.c.accuracy == "ACCURATE",
            ),
            func.count().filter(
                filtered.c.observation_kind == "LEGACY_MODEL_RESULT",
                filtered.c.accuracy.is_not(None),
                filtered.c.accuracy != "UNJUDGEABLE",
            ),
            func.count().filter(filtered.c.observation_kind == "MANUAL_ARTICLE_SEARCH"),
        ).select_from(filtered)
    ).one()
    (
        article_count,
        discovered_count,
        mentioned_article_count,
        accurate_article_count,
        judgeable_article_count,
    ) = db.execute(
        select(
            func.count(),
            func.count().filter(GeoObservationPublication.discovered.is_(True)),
            func.count().filter(GeoObservationPublication.mentioned.is_(True)),
            func.count().filter(GeoObservationPublication.accuracy == "ACCURATE"),
            func.count().filter(
                GeoObservationPublication.accuracy.is_not(None),
                GeoObservationPublication.accuracy != "UNJUDGEABLE",
            ),
        )
        .select_from(GeoObservationPublication)
        .join(filtered, filtered.c.id == GeoObservationPublication.observation_id)
        .where(filtered.c.observation_kind == "MANUAL_ARTICLE_SEARCH")
    ).one()
    return GeoMetrics(
        legacy_sample_count=legacy_count,
        legacy_mention_rate=mentioned_count / legacy_count if legacy_count else None,
        legacy_recommendation_rate=(
            recommended_legacy_count / legacy_count if legacy_count else None
        ),
        legacy_citation_rate=cited_count / legacy_count if legacy_count else None,
        legacy_accuracy_rate=accurate_count / judgeable_count if judgeable_count else None,
        manual_observation_count=manual_count,
        article_result_count=article_count,
        discovered_article_count=discovered_count,
        mentioned_article_count=mentioned_article_count,
        article_discovery_rate=(discovered_count / article_count if article_count else None),
        article_mention_rate=(
            mentioned_article_count / article_count if article_count else None
        ),
        article_accuracy_rate=(
            accurate_article_count / judgeable_article_count
            if judgeable_article_count
            else None
        ),
    )


def _geo_insight_period(
    filters: GeoInsightFilters,
) -> tuple[date, date, date, date]:
    """归一化当前周期，并计算紧邻的等长比较周期。"""
    current_to = filters.date_to or datetime.now(UTC).date()
    current_from = filters.date_from or current_to - timedelta(days=29)
    if current_from > current_to:
        raise AppError("VALIDATION_ERROR", "开始日期不能晚于结束日期", 422)
    period_days = (current_to - current_from).days + 1
    previous_to = current_from - timedelta(days=1)
    previous_from = previous_to - timedelta(days=period_days - 1)
    return current_from, current_to, previous_from, previous_to


def _geo_insight_filter_options(db: Session) -> geo_schema.GeoInsightFilterOptions:
    """从配置和真实发布成果投影稳定筛选选项。"""
    publication_scope = (
        select(
            PublicationWork.id,
            PublicationWork.actual_title,
            ContentVersion.title,
            PlatformProfile.id,
            PlatformProfile.name,
        )
        .join(PublishedArticle, PublishedArticle.id == PublicationWork.id)
        .join(ContentVersion, ContentVersion.id == PublicationWork.content_version_id)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .join(PlatformProfile, PlatformProfile.id == ContentTask.platform_profile_id)
        .where(
            PublicationWork.published_at.is_not(None),
            PublicationWork.final_url.is_not(None),
        )
        .order_by(PlatformProfile.name, PublicationWork.id)
    )
    publication_rows = db.execute(publication_scope).all()
    platforms = {
        platform_id: platform_name for _, _, _, platform_id, platform_name in publication_rows
    }
    superseding = aliased(GeoObservation)
    geo_platforms = [
        platform
        for platform in db.scalars(
            select(GeoObservation.search_platform)
            .where(
                GeoObservation.observation_kind == "MANUAL_ARTICLE_SEARCH",
                GeoObservation.search_platform.is_not(None),
                ~exists(
                    select(superseding.id).where(superseding.supersedes_id == GeoObservation.id)
                ),
            )
            .distinct()
            .order_by(GeoObservation.search_platform)
        )
        if platform is not None
    ]
    topics = list(
        db.scalars(select(QueryTopic).order_by(QueryTopic.canonical_question, QueryTopic.id))
    )
    return geo_schema.GeoInsightFilterOptions(
        content_platforms=[
            geo_schema.GeoInsightOption(id=platform_id, label=platforms[platform_id])
            for platform_id in sorted(platforms, key=lambda item: (platforms[item], str(item)))
        ],
        geo_platforms=geo_platforms,
        publications=[
            geo_schema.GeoInsightPublicationOption(
                id=publication_id,
                label=actual_title or content_title,
                platform_name=platform_name,
            )
            for publication_id, actual_title, content_title, _, platform_name in publication_rows
        ],
        query_topics=[
            geo_schema.GeoInsightOption(id=topic.id, label=topic.canonical_question)
            for topic in topics
        ],
    )


def _validate_geo_insight_filters(
    filters: GeoInsightFilters, options: geo_schema.GeoInsightFilterOptions
) -> None:
    """拒绝不属于权威选项集合的 ID 或精确字符串。"""
    checks = (
        (
            filters.content_platform_id,
            {item.id for item in options.content_platforms},
            "内容平台",
        ),
        (
            filters.published_article_id,
            {item.id for item in options.publications},
            "发布内容",
        ),
        (filters.query_topic_id, {item.id for item in options.query_topics}, "问题主题"),
        (filters.geo_platform, set(options.geo_platforms), "GEO 平台"),
    )
    for value, allowed, label in checks:
        if value is not None and value not in allowed:
            raise not_found(label)


def _geo_insight_rows(
    db: Session,
    filters: GeoInsightFilters,
    *,
    date_from: date | None,
    date_to: date,
) -> list[_GeoInsightRow]:
    """一次联接读取筛选范围内的链尾人工观测关系。"""
    superseding = aliased(GeoObservation)
    query = (
        select(
            GeoObservation.id,
            GeoObservation.tested_at,
            GeoObservation.query_topic_id,
            GeoObservation.search_platform,
            GeoObservationPublication.published_article_id,
            PublicationWork.actual_title,
            ContentVersion.title,
            PublicationWork.published_at,
            PlatformProfile.id,
            PlatformProfile.name,
            GeoObservationPublication.discovered,
            GeoObservationPublication.mentioned,
            GeoObservationPublication.accuracy,
        )
        .join(
            GeoObservationPublication,
            GeoObservationPublication.observation_id == GeoObservation.id,
        )
        .join(
            PublicationWork,
            PublicationWork.id == GeoObservationPublication.published_article_id,
        )
        .join(ContentVersion, ContentVersion.id == PublicationWork.content_version_id)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .join(PlatformProfile, PlatformProfile.id == ContentTask.platform_profile_id)
        .where(
            GeoObservation.observation_kind == "MANUAL_ARTICLE_SEARCH",
            GeoObservation.tested_at
            < datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=UTC),
            ~exists(select(superseding.id).where(superseding.supersedes_id == GeoObservation.id)),
        )
        .order_by(GeoObservation.tested_at, GeoObservation.id, PublicationWork.id)
    )
    if date_from is not None:
        query = query.where(
            GeoObservation.tested_at >= datetime.combine(date_from, datetime.min.time(), tzinfo=UTC)
        )
    if filters.geo_platform is not None:
        query = query.where(GeoObservation.search_platform == filters.geo_platform)
    if filters.query_topic_id is not None:
        query = query.where(GeoObservation.query_topic_id == filters.query_topic_id)
    return [
        _GeoInsightRow(
            observation_id=observation_id,
            tested_at=tested_at,
            query_topic_id=query_topic_id,
            geo_platform=geo_platform,
            published_article_id=published_article_id,
            title=actual_title or content_title,
            published_at=published_at,
            content_platform_id=content_platform_id,
            content_platform=content_platform,
            discovered=discovered,
            mentioned=mentioned,
            accuracy=accuracy,
        )
        for (
            observation_id,
            tested_at,
            query_topic_id,
            geo_platform,
            published_article_id,
            actual_title,
            content_title,
            published_at,
            content_platform_id,
            content_platform,
            discovered,
            mentioned,
            accuracy,
        ) in db.execute(query).all()
    ]


def _complete_geo_insight_rows(
    rows: Iterable[_GeoInsightRow],
) -> tuple[list[_GeoInsightRow], int, int]:
    """按观测整体排除历史缺失，避免部分候选进入同一次分析。"""
    grouped: dict[uuid.UUID, list[_GeoInsightRow]] = defaultdict(list)
    for row in rows:
        grouped[row.observation_id].append(row)

    eligible: list[_GeoInsightRow] = []
    excluded_observations = 0
    excluded_relations = 0
    for observation_rows in grouped.values():
        complete = all(
            row.query_topic_id is not None
            and row.discovered is not None
            and row.mentioned is not None
            for row in observation_rows
        )
        if complete:
            eligible.extend(observation_rows)
        else:
            excluded_observations += 1
            excluded_relations += len(observation_rows)
    return eligible, excluded_observations, excluded_relations


def _complete_geo_insight_scope(
    rows: list[_GeoInsightRow],
    filters: GeoInsightFilters,
) -> tuple[list[_GeoInsightRow], int, int]:
    """先校验整次观测，再应用内容维度筛选，避免隐藏同观测中的缺失关系。"""

    def matches(row: _GeoInsightRow) -> bool:
        return (
            (
                filters.content_platform_id is None
                or row.content_platform_id == filters.content_platform_id
            )
            and (
                filters.published_article_id is None
                or row.published_article_id == filters.published_article_id
            )
        )

    relevant_observation_ids = {row.observation_id for row in rows if matches(row)}
    complete, excluded_observations, excluded_relations = _complete_geo_insight_rows(
        row for row in rows if row.observation_id in relevant_observation_ids
    )
    return (
        [row for row in complete if matches(row)],
        excluded_observations,
        excluded_relations,
    )


def _rate_value(
    rows: Iterable[_GeoInsightRow],
    predicate: Callable[[_GeoInsightRow], bool],
    *,
    eligible: Callable[[_GeoInsightRow], bool] = lambda _row: True,
) -> geo_schema.GeoInsightRateValue:
    items = [row for row in rows if eligible(row)]
    numerator = sum(predicate(item) for item in items)
    denominator = len(items)
    return geo_schema.GeoInsightRateValue(
        numerator=numerator,
        denominator=denominator,
        value=numerator / denominator if denominator else None,
    )


def _relative_change(current: float | int | None, previous: float | int | None) -> float | None:
    if current is None or previous is None or previous == 0:
        return None
    return (current - previous) / previous


def _utc_date(value: datetime) -> date:
    """按 UTC 自然日归档带时区时间，避免数据库会话时区改变指标。"""
    return value.astimezone(UTC).date()


_RATE_PREDICATES: dict[str, Callable[[_GeoInsightRow], bool]] = {
    "discovery_rate": lambda row: row.discovered is True,
    "mention_rate": lambda row: row.mentioned is True,
    "accuracy_rate": lambda row: row.accuracy == "ACCURATE",
}
_RATE_ELIGIBILITY: dict[str, Callable[[_GeoInsightRow], bool]] = {
    "discovery_rate": lambda _row: True,
    "mention_rate": lambda _row: True,
    "accuracy_rate": lambda row: row.accuracy is not None and row.accuracy != "UNJUDGEABLE",
}


def _rate_trend(
    current_rows: list[_GeoInsightRow],
    previous_rows: list[_GeoInsightRow],
    *,
    current_from: date,
    current_to: date,
    predicate: Callable[[_GeoInsightRow], bool],
    eligible: Callable[[_GeoInsightRow], bool],
) -> geo_schema.GeoInsightRateTrend:
    current = _rate_value(current_rows, predicate, eligible=eligible)
    previous = _rate_value(previous_rows, predicate, eligible=eligible)
    points: list[geo_schema.GeoInsightRatePoint] = []
    point_date = current_from
    while point_date <= current_to:
        point = _rate_value(
            (row for row in current_rows if _utc_date(row.tested_at) == point_date),
            predicate,
            eligible=eligible,
        )
        points.append(geo_schema.GeoInsightRatePoint(date=point_date, **point.model_dump()))
        point_date += timedelta(days=1)
    return geo_schema.GeoInsightRateTrend(
        current=current,
        previous=previous,
        change=_relative_change(current.value, previous.value),
        points=points,
    )


def _content_performance(
    rows: list[_GeoInsightRow],
) -> geo_schema.GeoInsightContentPerformance:
    first = rows[0]
    return geo_schema.GeoInsightContentPerformance(
        published_article_id=first.published_article_id,
        title=first.title,
        content_platform=first.content_platform,
        observation_count=len({row.observation_id for row in rows}),
        discovery_rate=_rate_value(rows, _RATE_PREDICATES["discovery_rate"]),
        mention_rate=_rate_value(rows, _RATE_PREDICATES["mention_rate"]),
        accuracy_rate=_rate_value(
            rows,
            _RATE_PREDICATES["accuracy_rate"],
            eligible=_RATE_ELIGIBILITY["accuracy_rate"],
        ),
    )


def _content_rankings(
    current_rows: list[_GeoInsightRow],
    previous_rows: list[_GeoInsightRow],
    history_rows: list[_GeoInsightRow],
    *,
    current_from: date,
    current_to: date,
    unavailable: list[geo_schema.GeoInsightUnavailableSection],
) -> geo_schema.GeoInsightContentRankings:
    current_groups: dict[uuid.UUID, list[_GeoInsightRow]] = defaultdict(list)
    previous_groups: dict[uuid.UUID, list[_GeoInsightRow]] = defaultdict(list)
    for row in current_rows:
        current_groups[row.published_article_id].append(row)
    for row in previous_rows:
        previous_groups[row.published_article_id].append(row)

    best = [
        _content_performance(rows)
        for rows in current_groups.values()
        if len({row.observation_id for row in rows}) >= 3
    ]
    best.sort(
        key=lambda item: (
            item.accuracy_rate.value is None,
            -(item.accuracy_rate.value or 0),
            -(item.mention_rate.value or 0),
            -(item.discovery_rate.value or 0),
            -item.observation_count,
            str(item.published_article_id),
        )
    )

    declining: list[geo_schema.GeoInsightDecliningContent] = []
    decline_sort: dict[uuid.UUID, tuple[float, float, float, float]] = {}
    for publication_id, rows in current_groups.items():
        prior = previous_groups.get(publication_id, [])
        if (
            len({row.observation_id for row in rows}) < 3
            or len({row.observation_id for row in prior}) < 3
        ):
            continue
        current_performance = _content_performance(rows)
        previous_performance = _content_performance(prior)
        bases: list[geo_schema.GeoInsightDeclineBasis] = []
        declines: dict[str, float] = {}
        for metric in ("accuracy_rate", "mention_rate", "discovery_rate"):
            current_value = getattr(current_performance, metric).value
            previous_value = getattr(previous_performance, metric).value
            if current_value is None or previous_value is None:
                continue
            decline = previous_value - current_value
            declines[metric] = decline
            if decline >= 0.1:
                bases.append(
                    geo_schema.GeoInsightDeclineBasis(
                        metric=metric,
                        current_value=current_value,
                        previous_value=previous_value,
                        decline=decline,
                    )
                )
        if not bases:
            continue
        declining.append(
            geo_schema.GeoInsightDecliningContent(**current_performance.model_dump(), basis=bases)
        )
        decline_sort[publication_id] = (
            max(declines.values()),
            declines.get("accuracy_rate", -1),
            declines.get("mention_rate", -1),
            declines.get("discovery_rate", -1),
        )
    declining.sort(
        key=lambda item: (
            *(-value for value in decline_sort[item.published_article_id]),
            -item.observation_count,
            str(item.published_article_id),
        )
    )

    long_unmentioned: list[geo_schema.GeoInsightLongUnmentionedContent] = []
    if (current_to - current_from).days + 1 < 30:
        unavailable.append(
            geo_schema.GeoInsightUnavailableSection(
                code="LONG_UNMENTIONED_PERIOD_TOO_SHORT",
                message="筛选周期至少需要覆盖 30 个自然日才能计算长期未提及内容。",
            )
        )
    else:
        history_mentions: dict[uuid.UUID, datetime] = {}
        for row in history_rows:
            if _RATE_PREDICATES["mention_rate"](row):
                history_mentions[row.published_article_id] = max(
                    history_mentions.get(row.published_article_id, row.tested_at),
                    row.tested_at,
                )
        for publication_id, rows in current_groups.items():
            first = rows[0]
            if (
                len({row.observation_id for row in rows}) < 3
                or any(_RATE_PREDICATES["mention_rate"](row) for row in rows)
                or first.published_at is None
                or (current_to - _utc_date(first.published_at)).days < 30
            ):
                continue
            last_mentioned = history_mentions.get(publication_id)
            since = last_mentioned or first.published_at
            long_unmentioned.append(
                geo_schema.GeoInsightLongUnmentionedContent(
                    **_content_performance(rows).model_dump(),
                    unmentioned_days=(current_to - _utc_date(since)).days,
                    last_mentioned_at=last_mentioned,
                )
            )
        long_unmentioned.sort(
            key=lambda item: (
                -item.unmentioned_days,
                -item.observation_count,
                str(item.published_article_id),
            )
        )
    return geo_schema.GeoInsightContentRankings(
        best=best[:5], declining=declining[:5], long_unmentioned=long_unmentioned[:5]
    )


def _question_coverage(
    current_rows: list[_GeoInsightRow],
    *,
    options: geo_schema.GeoInsightFilterOptions,
    filters: GeoInsightFilters,
) -> geo_schema.GeoInsightQuestionCoverage:
    topics = [
        item
        for item in options.query_topics
        if filters.query_topic_id is None or item.id == filters.query_topic_id
    ]
    platforms = (
        [filters.geo_platform] if filters.geo_platform is not None else options.geo_platforms
    )
    observation_hits: dict[tuple[uuid.UUID, str, uuid.UUID], bool] = {}
    for row in current_rows:
        if row.query_topic_id is None:
            continue
        key = (row.query_topic_id, row.geo_platform, row.observation_id)
        observation_hits[key] = observation_hits.get(key, False) or _RATE_PREDICATES[
            "mention_rate"
        ](row)
    matrix: list[geo_schema.GeoInsightCoverageItem] = []
    counts = {status: 0 for status in ("STABLE", "OCCASIONAL", "UNCOVERED", "INSUFFICIENT_DATA")}
    for topic in topics:
        for platform in platforms:
            samples = [
                hit
                for (topic_id, geo_platform, _), hit in observation_hits.items()
                if topic_id == topic.id and geo_platform == platform
            ]
            mentioned_count = sum(samples)
            rate = geo_schema.GeoInsightRateValue(
                numerator=mentioned_count,
                denominator=len(samples),
                value=mentioned_count / len(samples) if samples else None,
            )
            if len(samples) < 3:
                status = "INSUFFICIENT_DATA"
            elif rate.value is not None and rate.value >= 0.6:
                status = "STABLE"
            elif rate.value is not None and rate.value >= 0.3:
                status = "OCCASIONAL"
            else:
                status = "UNCOVERED"
            counts[status] += 1
            matrix.append(
                geo_schema.GeoInsightCoverageItem(
                    query_topic_id=topic.id,
                    canonical_question=topic.label,
                    geo_platform=platform,
                    status=status,
                    observation_count=len(samples),
                    mentioned_observation_count=mentioned_count,
                    coverage_rate=rate,
                )
            )
    return geo_schema.GeoInsightQuestionCoverage(
        by_status=geo_schema.GeoInsightCoverageCounts(
            stable=counts["STABLE"],
            occasional=counts["OCCASIONAL"],
            uncovered=counts["UNCOVERED"],
            insufficient_data=counts["INSUFFICIENT_DATA"],
        ),
        matrix=matrix,
    )


def _platform_performance(
    rows: list[_GeoInsightRow],
) -> list[geo_schema.GeoInsightPlatformPerformance]:
    grouped: dict[str, list[_GeoInsightRow]] = defaultdict(list)
    for row in rows:
        grouped[row.geo_platform].append(row)
    return [
        geo_schema.GeoInsightPlatformPerformance(
            geo_platform=platform,
            observation_count=len({row.observation_id for row in platform_rows}),
            discovery_rate=_rate_value(
                platform_rows, _RATE_PREDICATES["discovery_rate"]
            ),
            mention_rate=_rate_value(platform_rows, _RATE_PREDICATES["mention_rate"]),
            accuracy_rate=_rate_value(
                platform_rows,
                _RATE_PREDICATES["accuracy_rate"],
                eligible=_RATE_ELIGIBILITY["accuracy_rate"],
            ),
        )
        for platform, platform_rows in sorted(grouped.items())
    ]


def _recommendations(
    current_rows: list[_GeoInsightRow],
    previous_rows: list[_GeoInsightRow],
    rankings: geo_schema.GeoInsightContentRankings,
    coverage: geo_schema.GeoInsightQuestionCoverage,
) -> list[geo_schema.GeoInsightRecommendation]:
    recommendations: list[geo_schema.GeoInsightRecommendation] = []
    for long_item in rankings.long_unmentioned:
        recommendations.append(
            geo_schema.GeoInsightRecommendation(
                rule_code="CONTENT_LONG_UNMENTIONED",
                priority="HIGH",
                title=f"优先更新长期未获提及的内容：{long_item.title}",
                basis_text=f"已连续 {long_item.unmentioned_days} 天未获得提及。",
                basis_values=[
                    geo_schema.GeoInsightRecommendationBasis(
                        metric="unmentioned_days",
                        value=long_item.unmentioned_days,
                        threshold=30,
                        unit="DAY",
                    )
                ],
                impact_relationship_count=long_item.observation_count,
                published_article_ids=[long_item.published_article_id],
                geo_platforms=[],
                query_topic_ids=[],
                detail_path=f"/publications/{long_item.published_article_id}",
            )
        )
    for declining_item in rankings.declining:
        maximum = max(basis.decline for basis in declining_item.basis)
        recommendations.append(
            geo_schema.GeoInsightRecommendation(
                rule_code="CONTENT_PERFORMANCE_DECLINE",
                priority="HIGH" if maximum >= 0.2 else "MEDIUM",
                title=f"检查表现下降的内容：{declining_item.title}",
                basis_text=f"最大单项下降 {maximum:.1%}。",
                basis_values=[
                    geo_schema.GeoInsightRecommendationBasis(
                        metric=basis.metric,
                        value=basis.decline,
                        threshold=0.2 if maximum >= 0.2 else 0.1,
                        unit="PERCENTAGE_POINT",
                    )
                    for basis in declining_item.basis
                ],
                impact_relationship_count=declining_item.observation_count,
                published_article_ids=[declining_item.published_article_id],
                geo_platforms=[],
                query_topic_ids=[],
                detail_path=f"/publications/{declining_item.published_article_id}",
            )
        )

    current_by_platform = {
        platform_item.geo_platform: platform_item
        for platform_item in _platform_performance(current_rows)
    }
    previous_by_platform = {
        platform_item.geo_platform: platform_item
        for platform_item in _platform_performance(previous_rows)
    }
    for platform, current in current_by_platform.items():
        previous = previous_by_platform.get(platform)
        if previous is None:
            continue
        declines: list[tuple[str, float]] = []
        for metric in ("accuracy_rate", "mention_rate", "discovery_rate"):
            previous_value = getattr(previous, metric).value
            current_value = getattr(current, metric).value
            if previous_value is None or current_value is None:
                continue
            declines.append((metric, previous_value - current_value))
        if not declines:
            continue
        maximum = max(value for _, value in declines)
        if maximum < 0.1:
            continue
        recommendations.append(
            geo_schema.GeoInsightRecommendation(
                rule_code="GEO_PLATFORM_PERFORMANCE_DECLINE",
                priority="HIGH" if maximum >= 0.2 else "MEDIUM",
                title=f"检查 GEO 平台表现下降：{platform}",
                basis_text=f"最大单项下降 {maximum:.1%}。",
                basis_values=[
                    geo_schema.GeoInsightRecommendationBasis(
                        metric=metric,
                        value=value,
                        threshold=0.2 if maximum >= 0.2 else 0.1,
                        unit="PERCENTAGE_POINT",
                    )
                    for metric, value in declines
                    if value >= 0.1
                ],
                impact_relationship_count=current.mention_rate.denominator,
                published_article_ids=[],
                geo_platforms=[platform],
                query_topic_ids=[],
                detail_path=None,
            )
        )

    by_publication: dict[uuid.UUID, list[_GeoInsightRow]] = defaultdict(list)
    for row in current_rows:
        by_publication[row.published_article_id].append(row)
    for publication_id, rows in by_publication.items():
        if len({row.observation_id for row in rows}) < 3 or any(
            _RATE_PREDICATES["discovery_rate"](row) for row in rows
        ):
            continue
        first = rows[0]
        recommendations.append(
            geo_schema.GeoInsightRecommendation(
                rule_code="CONTENT_NEVER_DISCOVERED",
                priority="MEDIUM",
                title=f"优化从未被发现的内容：{first.title}",
                basis_text=f"{len(rows)} 次完整观测均未被发现。",
                basis_values=[
                    geo_schema.GeoInsightRecommendationBasis(
                        metric="observation_count",
                        value=len(rows),
                        threshold=3,
                        unit="COUNT",
                    )
                ],
                impact_relationship_count=len(rows),
                published_article_ids=[publication_id],
                geo_platforms=[],
                query_topic_ids=[],
                detail_path=f"/publications/{publication_id}",
            )
        )
    for coverage_item in coverage.matrix:
        priority = "MEDIUM" if coverage_item.status == "UNCOVERED" else "LOW"
        if coverage_item.status == "STABLE":
            continue
        rule_code = {
            "UNCOVERED": "QUESTION_UNCOVERED",
            "OCCASIONAL": "QUESTION_OCCASIONAL",
            "INSUFFICIENT_DATA": "QUESTION_INSUFFICIENT_DATA",
        }[coverage_item.status]
        recommendations.append(
            geo_schema.GeoInsightRecommendation(
                rule_code=rule_code,
                priority=priority,
                title=(
                    f"补强问题覆盖：{coverage_item.canonical_question}"
                    if coverage_item.status != "INSUFFICIENT_DATA"
                    else f"补充问题观测：{coverage_item.canonical_question}"
                ),
                basis_text=(
                    f"{coverage_item.geo_platform} 覆盖率为 "
                    f"{coverage_item.coverage_rate.value:.1%}。"
                    if coverage_item.coverage_rate.value is not None
                    else f"{coverage_item.geo_platform} 尚无完整观测。"
                ),
                basis_values=[
                    geo_schema.GeoInsightRecommendationBasis(
                        metric=(
                            "observation_count"
                            if coverage_item.status == "INSUFFICIENT_DATA"
                            else "coverage_rate"
                        ),
                        value=(
                            coverage_item.observation_count
                            if coverage_item.status == "INSUFFICIENT_DATA"
                            else coverage_item.coverage_rate.value
                        ),
                        threshold=(
                            3
                            if coverage_item.status == "INSUFFICIENT_DATA"
                            else 0.3
                            if coverage_item.status == "UNCOVERED"
                            else 0.6
                        ),
                        unit=("COUNT" if coverage_item.status == "INSUFFICIENT_DATA" else "RATIO"),
                    )
                ],
                impact_relationship_count=coverage_item.observation_count,
                published_article_ids=[],
                geo_platforms=[coverage_item.geo_platform],
                query_topic_ids=[coverage_item.query_topic_id],
                detail_path=None,
            )
        )
    priority_order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    recommendations.sort(
        key=lambda item: (
            priority_order[item.priority],
            -item.impact_relationship_count,
            item.rule_code,
            str(item.published_article_ids[0]) if item.published_article_ids else "",
            item.geo_platforms[0] if item.geo_platforms else "",
            str(item.query_topic_ids[0]) if item.query_topic_ids else "",
        )
    )
    return recommendations


def get_geo_insights(db: Session, *, filters: GeoInsightFilters) -> geo_schema.GeoInsights:
    """返回一个筛选范围内全部 GEO 洞察的权威服务端读模型。"""
    current_from, current_to, previous_from, previous_to = _geo_insight_period(filters)
    options = _geo_insight_filter_options(db)
    _validate_geo_insight_filters(filters, options)
    scoped_rows = _geo_insight_rows(db, filters, date_from=previous_from, date_to=current_to)
    current_raw = [row for row in scoped_rows if _utc_date(row.tested_at) >= current_from]
    previous_raw = [row for row in scoped_rows if _utc_date(row.tested_at) <= previous_to]
    current_rows, excluded_observations, excluded_relations = _complete_geo_insight_scope(
        current_raw,
        filters,
    )
    previous_rows, _, _ = _complete_geo_insight_scope(previous_raw, filters)
    history_rows, _, _ = _complete_geo_insight_scope(
        _geo_insight_rows(db, filters, date_from=None, date_to=current_to),
        filters,
    )

    unavailable: list[geo_schema.GeoInsightUnavailableSection] = []
    if not current_rows:
        unavailable.append(
            geo_schema.GeoInsightUnavailableSection(
                code="NO_COMPLETE_OBSERVATIONS",
                message="当前筛选周期没有字段完整的链尾人工观测。",
            )
        )
    if not previous_rows:
        unavailable.append(
            geo_schema.GeoInsightUnavailableSection(
                code="NO_COMPLETE_PREVIOUS_OBSERVATIONS",
                message="相邻比较周期没有字段完整的链尾人工观测，环比和下降分析不可用。",
            )
        )
    if not options.geo_platforms:
        unavailable.append(
            geo_schema.GeoInsightUnavailableSection(
                code="NO_GEO_PLATFORMS",
                message="尚无可用于问题覆盖分析的人工 GEO 平台。",
            )
        )
    rankings = _content_rankings(
        current_rows,
        previous_rows,
        history_rows,
        current_from=current_from,
        current_to=current_to,
        unavailable=unavailable,
    )
    coverage = _question_coverage(current_rows, options=options, filters=filters)
    return geo_schema.GeoInsights(
        generated_at=datetime.now(UTC),
        analysis_unit="MANUAL_OBSERVATION_PUBLICATION_RELATION",
        period=geo_schema.GeoInsightPeriod(
            current=geo_schema.GeoInsightPeriodWindow(date_from=current_from, date_to=current_to),
            previous=geo_schema.GeoInsightPeriodWindow(
                date_from=previous_from, date_to=previous_to
            ),
        ),
        filter_options=options,
        trends=geo_schema.GeoInsightTrends(
            discovery_rate=_rate_trend(
                current_rows,
                previous_rows,
                current_from=current_from,
                current_to=current_to,
                predicate=_RATE_PREDICATES["discovery_rate"],
                eligible=_RATE_ELIGIBILITY["discovery_rate"],
            ),
            mention_rate=_rate_trend(
                current_rows,
                previous_rows,
                current_from=current_from,
                current_to=current_to,
                predicate=_RATE_PREDICATES["mention_rate"],
                eligible=_RATE_ELIGIBILITY["mention_rate"],
            ),
            accuracy_rate=_rate_trend(
                current_rows,
                previous_rows,
                current_from=current_from,
                current_to=current_to,
                predicate=_RATE_PREDICATES["accuracy_rate"],
                eligible=_RATE_ELIGIBILITY["accuracy_rate"],
            ),
        ),
        platform_performance=_platform_performance(current_rows),
        content_rankings=rankings,
        question_coverage=coverage,
        recommendations=_recommendations(current_rows, previous_rows, rankings, coverage),
        data_quality=geo_schema.GeoInsightDataQuality(
            eligible_observation_count=len({row.observation_id for row in current_rows}),
            excluded_incomplete_observation_count=excluded_observations,
            excluded_incomplete_relation_count=excluded_relations,
            unavailable_sections=unavailable,
        ),
    )


def geo_publication_candidates(
    db: Session, product_id: uuid.UUID, *, lock: bool = False
) -> list[GeoPublicationCandidate]:
    """投影产品当前全部合格发布成果；写入时锁定完整文章集合。"""
    query = (
        select(PublishedArticle, PublicationWork, ContentVersion.title, PlatformProfile.name)
        .join(PublicationWork, PublicationWork.id == PublishedArticle.id)
        .join(ContentVersion, ContentVersion.id == PublicationWork.content_version_id)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .join(PlatformProfile, PlatformProfile.id == ContentTask.platform_profile_id)
        .where(
            ContentTask.product_id == product_id,
            PublicationWork.status == "COMPLETED",
            ~exists(
                select(PublishedContentIssue.id).where(
                    PublishedContentIssue.published_article_id == PublishedArticle.id,
                    or_(
                        PublishedContentIssue.status == "OPEN",
                        PublishedContentIssue.resolution_outcome == "RETIRED",
                    ),
                )
            ),
        )
        .order_by(PublicationWork.published_at, PublicationWork.id)
    )
    if lock:
        query = query.with_for_update(of=PublishedArticle)
    return [
        GeoPublicationCandidate.model_validate(
            {
                "published_article_id": article.id,
                "title": work.actual_title or content_title,
                "platform_name": platform_name,
                "final_url": work.final_url,
                "status": "COMPLETED",
            }
        )
        for article, work, content_title, platform_name in db.execute(query).all()
    ]


def create_geo_observation(
    *, db: Session, payload: GeoObservationCreate, actor: User, request_id: str
) -> GeoObservation:
    """锁定完整文章集合，并以可选证据追加人工 GEO 观测。"""
    product = db.scalar(select(Product).where(Product.id == payload.product_id).with_for_update())
    if product is None:
        raise not_found("产品")
    if db.get(QueryTopic, payload.query_topic_id) is None:
        raise not_found("问题主题")
    candidates = geo_publication_candidates(db, payload.product_id, lock=True)
    if not candidates:
        raise AppError("VALIDATION_ERROR", "该产品暂无可观测的已发布文章", 422)
    submitted_ids = {item.published_article_id for item in payload.article_results}
    candidate_ids = {item.published_article_id for item in candidates}
    if submitted_ids != candidate_ids:
        raise AppError(
            "GEO_PUBLICATIONS_CHANGED",
            "产品的已发布文章集合已变化，请刷新后重新登记",
            409,
        )
    files = verified_files(db, payload.attachment_file_ids)
    if any(file.category != "OPERATION_SCREENSHOT" for file in files):
        raise AppError("VALIDATION_ERROR", "GEO 观测附件必须是搜索结果截图", 422)
    if payload.supersedes_id:
        previous = db.scalar(
            select(GeoObservation)
            .where(GeoObservation.id == payload.supersedes_id)
            .with_for_update()
        )
        if previous is None:
            raise not_found("被纠正的 GEO 观测")
        if (
            previous.product_id != payload.product_id
            or previous.observation_kind != "MANUAL_ARTICLE_SEARCH"
        ):
            raise AppError("VALIDATION_ERROR", "只能更正同一产品的人工 GEO 观测", 422)
        if (
            previous.search_platform != payload.search_platform
            or previous.search_query != payload.search_query
            # 补采前历史没有问题主题；首次追加更正必须补全真实关联。
            or (
                previous.query_topic_id is not None
                and previous.query_topic_id != payload.query_topic_id
            )
        ):
            raise AppError("VALIDATION_ERROR", "更正时不能改变问题主题、搜索平台或搜索词", 422)
        if (
            db.scalar(select(GeoObservation.id).where(GeoObservation.supersedes_id == previous.id))
            is not None
        ):
            raise AppError("REVISION_CONFLICT", "该 GEO 观测已被纠正", 409)
        if files:
            ancestor_ids = [previous.id]
            ancestor = previous
            while ancestor.supersedes_id is not None:
                parent = db.get(GeoObservation, ancestor.supersedes_id)
                if parent is None:
                    raise AppError("REVISION_CONFLICT", "GEO 观测更正链不完整", 409)
                ancestor = parent
                ancestor_ids.append(ancestor.id)
            reused_file_id = db.scalar(
                select(GeoObservationAttachment.file_id)
                .where(
                    GeoObservationAttachment.observation_id.in_(ancestor_ids),
                    GeoObservationAttachment.file_id.in_([file.id for file in files]),
                )
                .limit(1)
            )
            if reused_file_id is not None:
                raise AppError("VALIDATION_ERROR", "新增证据不能重复关联更正链已有文件", 422)
    observation = GeoObservation(
        observation_kind="MANUAL_ARTICLE_SEARCH",
        query_topic_id=payload.query_topic_id,
        product_id=payload.product_id,
        search_platform=payload.search_platform,
        search_query=payload.search_query,
        tested_at=payload.tested_at,
        notes=payload.notes,
        supersedes_id=payload.supersedes_id,
        tested_by=actor.id,
    )
    db.add(observation)
    db.flush()
    db.add_all(
        GeoObservationPublication(
            observation_id=observation.id,
            published_article_id=result.published_article_id,
            discovered=result.discovered,
            mentioned=result.mentioned,
            accuracy=result.accuracy,
        )
        for result in payload.article_results
    )
    db.add_all(
        GeoObservationAttachment(observation_id=observation.id, file_id=file.id) for file in files
    )
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.GEO_OBSERVATION,
            action="geo_observation.created",
            target_type="GeoObservation",
            target_id=observation.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="GEO 观测已创建",
            details={
                "facts": {
                    "product_id": str(payload.product_id),
                    "supersedes_id": (
                        str(payload.supersedes_id) if payload.supersedes_id else None
                    ),
                    "article_count": len(payload.article_results),
                    "attachment_count": len(files),
                }
            },
        ),
    )
    db.commit()
    return observation


def _lock_manual_observation_chain(
    db: Session,
    observation_id: uuid.UUID,
) -> tuple[Product, list[GeoObservation]]:
    """按产品、根节点、其余节点的稳定顺序锁定完整人工更正链。"""
    target = db.get(GeoObservation, observation_id)
    if target is None:
        raise not_found("GEO 观测")
    product = db.scalar(select(Product).where(Product.id == target.product_id).with_for_update())
    if product is None:
        raise AppError(
            "GEO_OBSERVATION_CONTEXT_INCOMPLETE",
            "GEO 观测关联的产品不存在",
            409,
        )
    target = db.get(GeoObservation, observation_id, populate_existing=True)
    if target is None:
        raise not_found("GEO 观测")
    if target.observation_kind != "MANUAL_ARTICLE_SEARCH":
        raise AppError("INVALID_STATE_TRANSITION", "旧模型 GEO 观测不能删除", 409)

    root = target
    ancestor_ids = {root.id}
    while root.supersedes_id is not None:
        parent = db.get(GeoObservation, root.supersedes_id)
        if (
            parent is None
            or parent.id in ancestor_ids
            or parent.product_id != product.id
            or parent.observation_kind != "MANUAL_ARTICLE_SEARCH"
        ):
            raise AppError("REVISION_CONFLICT", "GEO 观测更正链不完整", 409)
        ancestor_ids.add(parent.id)
        root = parent

    locked_root = db.scalar(
        select(GeoObservation).where(GeoObservation.id == root.id).with_for_update()
    )
    if locked_root is None:
        raise not_found("GEO 观测")
    chain_ids = [locked_root.id]
    current_id = locked_root.id
    while True:
        successors = list(
            db.scalars(
                select(GeoObservation)
                .where(GeoObservation.supersedes_id == current_id)
                .order_by(GeoObservation.id)
                .limit(2)
            )
        )
        if not successors:
            break
        if len(successors) != 1:
            raise AppError("REVISION_CONFLICT", "GEO 观测更正链存在分支", 409)
        successor = successors[0]
        if (
            successor.id in chain_ids
            or successor.product_id != product.id
            or successor.observation_kind != "MANUAL_ARTICLE_SEARCH"
        ):
            raise AppError("REVISION_CONFLICT", "GEO 观测更正链不完整", 409)
        chain_ids.append(successor.id)
        current_id = successor.id

    remaining = list(
        db.scalars(
            select(GeoObservation)
            .where(GeoObservation.id.in_(chain_ids[1:]))
            .order_by(GeoObservation.id)
            .with_for_update()
        )
    )
    nodes_by_id = {locked_root.id: locked_root, **{node.id: node for node in remaining}}
    if len(nodes_by_id) != len(chain_ids) or observation_id not in nodes_by_id:
        raise AppError("REVISION_CONFLICT", "GEO 观测更正链已变化", 409)
    return product, [nodes_by_id[node_id] for node_id in chain_ids]


def delete_geo_observation(
    *,
    db: Session,
    observation_id: uuid.UUID,
    actor: User,
    request_id: str,
) -> None:
    """原子删除任一人工观测所属的完整更正链，并安排无引用证据清理。"""
    _, chain = _lock_manual_observation_chain(db, observation_id)
    chain_ids = [node.id for node in chain]
    attachment_ids = list(
        db.scalars(
            select(GeoObservationAttachment.file_id)
            .where(GeoObservationAttachment.observation_id.in_(chain_ids))
            .distinct()
            .order_by(GeoObservationAttachment.file_id)
        )
    )
    article_result_count = int(
        db.scalar(
            select(func.count())
            .select_from(GeoObservationPublication)
            .where(GeoObservationPublication.observation_id.in_(chain_ids))
        )
        or 0
    )
    attachment_relation_count = int(
        db.scalar(
            select(func.count())
            .select_from(GeoObservationAttachment)
            .where(GeoObservationAttachment.observation_id.in_(chain_ids))
        )
        or 0
    )

    for node in reversed(chain):
        db.scalar(
            select(
                func.set_config(
                    "partsignal.geo_observation_delete_id",
                    str(node.id),
                    True,
                )
            )
        )
        for model in (
            GeoObservationAttachment,
            GeoObservationPublication,
            GeoObservationCitation,
        ):
            db.execute(delete(model).where(model.observation_id == node.id))
        db.delete(node)
        db.flush()

    cleanup_time = datetime.now(UTC)
    for file_id in attachment_ids:
        schedule_unreferenced_file(db, file_id, cleanup_after=cleanup_time)
    root_id = chain[0].id
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.GEO_OBSERVATION,
            action="geo_observation.deleted",
            target_type="GeoObservation",
            target_id=root_id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="GEO 观测更正链已删除",
            details={
                "facts": {
                    "root_observation_id": str(root_id),
                    "observation_count": len(chain),
                    "article_result_count": article_result_count,
                    "attachment_count": attachment_relation_count,
                }
            },
        ),
    )
    db.commit()
