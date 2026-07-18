"""追加式 GEO 观测、可复算指标和工作台摘要接口。"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Request, status
from sqlalchemy import exists, func, select
from sqlalchemy.orm import aliased

from app.deps import CsrfProtected, CurrentUser, DbSession, EngineerUser
from app.errors import not_found
from app.models.configuration import PlatformProfile
from app.models.content import ContentTask, ContentVersion
from app.models.geo_files import (
    GeoObservation,
    GeoObservationAttachment,
    GeoObservationCitation,
    GeoObservationPublication,
)
from app.models.product_facts import FactVersion, Product
from app.models.publication import PlatformAccount, PublicationRecord
from app.schemas.geo_files import (
    DashboardSummary,
    GeoArticleResultOut,
    GeoCitation,
    GeoMetrics,
    GeoObservationCreate,
    GeoObservationList,
    GeoObservationOut,
    GeoPublicationCandidateList,
    LegacyGeoObservationOut,
    ManualGeoObservationOut,
)
from app.services.geo_observation import (
    create_geo_observation as create_geo_observation_command,
)
from app.services.geo_observation import (
    geo_publication_candidates,
)
from app.services.publication_queries import open_attention_count

router = APIRouter(prefix="/api/v1", tags=["observation"])
Analyst = EngineerUser


def observation_out(db: DbSession, observation: GeoObservation) -> GeoObservationOut:
    attachment_ids = list(
        db.scalars(
            select(GeoObservationAttachment.file_id).where(
                GeoObservationAttachment.observation_id == observation.id
            )
        )
    )
    if observation.observation_kind == "MANUAL_ARTICLE_SEARCH":
        rows = db.execute(
            select(
                GeoObservationPublication,
                PublicationRecord,
                ContentVersion.title,
                PlatformProfile.name,
            )
            .join(
                PublicationRecord,
                PublicationRecord.id == GeoObservationPublication.publication_record_id,
            )
            .join(ContentVersion, ContentVersion.id == PublicationRecord.content_version_id)
            .join(ContentTask, ContentTask.id == ContentVersion.task_id)
            .join(PlatformAccount, PlatformAccount.id == PublicationRecord.platform_account_id)
            .join(PlatformProfile, PlatformProfile.id == PlatformAccount.platform_profile_id)
            .where(GeoObservationPublication.observation_id == observation.id)
            .order_by(PublicationRecord.id)
        ).all()
        article_results = [
            GeoArticleResultOut.model_validate(
                {
                    "publication_record_id": publication.id,
                    "recommendation_status": relation.recommendation_status,
                    "title": publication.actual_title or content_title,
                    "platform_name": platform_name,
                    "final_url": publication.final_url,
                }
            )
            for relation, publication, content_title, platform_name in rows
        ]
        return ManualGeoObservationOut.model_validate(
            {
                "observation_kind": observation.observation_kind,
                "id": observation.id,
                "product_id": observation.product_id,
                "search_platform": observation.search_platform,
                "search_query": observation.search_query,
                "tested_at": observation.tested_at,
                "article_results": article_results,
                "attachment_file_ids": attachment_ids,
                "notes": observation.notes,
                "supersedes_id": observation.supersedes_id,
                "tested_by": observation.tested_by,
                "created_at": observation.created_at,
            }
        )

    citations = list(
        db.scalars(
            select(GeoObservationCitation).where(
                GeoObservationCitation.observation_id == observation.id
            )
        )
    )
    publication_ids = list(
        db.scalars(
            select(GeoObservationPublication.publication_record_id).where(
                GeoObservationPublication.observation_id == observation.id
            )
        )
    )
    return LegacyGeoObservationOut.model_validate(
        {
            "observation_kind": observation.observation_kind,
            "id": observation.id,
            "query_topic_id": observation.query_topic_id,
            "product_id": observation.product_id,
            "actual_prompt": observation.actual_prompt,
            "model_name": observation.model_name,
            "model_version": observation.model_version,
            "tested_at": observation.tested_at,
            "web_search_enabled": observation.web_search_enabled,
            "answer_summary": observation.answer_summary,
            "mentioned": observation.mentioned,
            "recommendation": observation.recommendation,
            "accuracy": observation.accuracy,
            "citations": [
                GeoCitation(
                    url=citation.url,
                    source_type=citation.source_type,
                    publication_record_id=citation.publication_record_id,
                )
                for citation in citations
            ],
            "publication_record_ids": publication_ids,
            "attachment_file_ids": attachment_ids,
            "notes": observation.notes,
            "supersedes_id": observation.supersedes_id,
            "tested_by": observation.tested_by,
            "created_at": observation.created_at,
        }
    )


@router.get(
    "/geo-observations", response_model=GeoObservationList, operation_id="listGeoObservations"
)
def list_geo_observations(db: DbSession, _user: CurrentUser) -> GeoObservationList:
    observations = list(
        db.scalars(select(GeoObservation).order_by(GeoObservation.tested_at.desc()))
    )
    return GeoObservationList(items=[observation_out(db, item) for item in observations])


@router.get(
    "/geo-observation-publications",
    response_model=GeoPublicationCandidateList,
    operation_id="listGeoObservationPublications",
)
def list_geo_observation_publications(
    product_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> GeoPublicationCandidateList:
    """返回产品当前全部可由人工搜索核对的公开文章。"""
    if db.get(Product, product_id) is None:
        raise not_found("产品")
    return GeoPublicationCandidateList(items=geo_publication_candidates(db, product_id))


@router.post(
    "/geo-observations",
    response_model=GeoObservationOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createGeoObservation",
)
def create_geo_observation(
    payload: GeoObservationCreate,
    request: Request,
    db: DbSession,
    analyst: Analyst,
    _csrf: CsrfProtected,
) -> GeoObservationOut:
    observation = create_geo_observation_command(
        db=db, payload=payload, actor=analyst, request_id=request.state.request_id
    )
    return observation_out(db, observation)


@router.get("/geo-metrics", response_model=GeoMetrics, operation_id="getGeoMetrics")
def get_geo_metrics(
    db: DbSession,
    _user: CurrentUser,
    product_id: uuid.UUID | None = None,
    query_topic_id: uuid.UUID | None = None,
    model_name: str | None = None,
    search_platform: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> GeoMetrics:
    """直接从未被纠正的源观测计算指标，不持久化汇总。"""
    superseding = aliased(GeoObservation)
    current_query = select(GeoObservation).where(
        ~exists(select(superseding.id).where(superseding.supersedes_id == GeoObservation.id))
    )
    if product_id:
        current_query = current_query.where(GeoObservation.product_id == product_id)
    if date_from:
        current_query = current_query.where(
            GeoObservation.tested_at >= datetime.combine(date_from, datetime.min.time(), tzinfo=UTC)
        )
    if date_to:
        current_query = current_query.where(
            GeoObservation.tested_at
            < datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
        )
    legacy_query = current_query.where(GeoObservation.observation_kind == "LEGACY_MODEL_RESULT")
    if query_topic_id:
        legacy_query = legacy_query.where(GeoObservation.query_topic_id == query_topic_id)
    if model_name:
        legacy_query = legacy_query.where(GeoObservation.model_name == model_name)
    manual_query = current_query.where(GeoObservation.observation_kind == "MANUAL_ARTICLE_SEARCH")
    if search_platform:
        manual_query = manual_query.where(GeoObservation.search_platform == search_platform)

    observations = list(db.scalars(legacy_query))
    manual_observations = list(db.scalars(manual_query))
    count = len(observations)
    observation_ids = [item.id for item in observations]
    cited_ids = (
        set(
            db.scalars(
                select(GeoObservationCitation.observation_id)
                .where(GeoObservationCitation.observation_id.in_(observation_ids))
                .distinct()
            )
        )
        if observation_ids
        else set()
    )
    judgeable = [item for item in observations if item.accuracy not in (None, "UNJUDGEABLE")]
    manual_ids = [item.id for item in manual_observations]
    article_statuses = (
        list(
            db.scalars(
                select(GeoObservationPublication.recommendation_status).where(
                    GeoObservationPublication.observation_id.in_(manual_ids)
                )
            )
        )
        if manual_ids
        else []
    )
    recommended_count = sum(status == "RECOMMENDED" for status in article_statuses)
    not_recommended_count = sum(status == "NOT_RECOMMENDED" for status in article_statuses)
    article_count = recommended_count + not_recommended_count
    return GeoMetrics(
        sample_count=count,
        mention_rate=(sum(item.mentioned is True for item in observations) / count if count else 0),
        recommendation_rate=(
            sum(item.recommendation == "RECOMMENDED" for item in observations) / count
            if count
            else 0
        ),
        citation_rate=(len(cited_ids) / count if count else 0),
        accuracy_rate=(
            sum(item.accuracy == "ACCURATE" for item in judgeable) / len(judgeable)
            if judgeable
            else None
        ),
        manual_observation_count=len(manual_observations),
        article_result_count=article_count,
        recommended_article_count=recommended_count,
        not_recommended_article_count=not_recommended_count,
        article_recommendation_rate=(recommended_count / article_count if article_count else None),
    )


@router.get(
    "/dashboard/summary", response_model=DashboardSummary, operation_id="getDashboardSummary"
)
def get_dashboard_summary(db: DbSession, _user: CurrentUser) -> DashboardSummary:
    since = datetime.now(UTC) - timedelta(days=30)
    return DashboardSummary(
        pending_fact_reviews=int(
            db.scalar(
                select(func.count())
                .select_from(FactVersion)
                .where(FactVersion.status == "PENDING_REVIEW")
            )
            or 0
        ),
        pending_content_reviews=int(
            db.scalar(
                select(func.count())
                .select_from(ContentVersion)
                .where(ContentVersion.status == "PENDING_REVIEW")
            )
            or 0
        ),
        pending_publications=int(
            db.scalar(
                select(func.count())
                .select_from(PublicationRecord)
                .where(PublicationRecord.status == "PENDING_MANUAL_PUBLISH")
            )
            or 0
        ),
        publication_attention=open_attention_count(db),
        recent_accuracy_errors=int(
            db.scalar(
                select(func.count())
                .select_from(GeoObservation)
                .where(
                    GeoObservation.observation_kind == "LEGACY_MODEL_RESULT",
                    GeoObservation.tested_at >= since,
                    GeoObservation.accuracy.in_(["PARTIAL", "INCORRECT"]),
                )
            )
            or 0
        ),
    )
