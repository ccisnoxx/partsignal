"""追加式 GEO 观测、可复算指标和工作台摘要接口。"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import exists, func, select
from sqlalchemy.orm import aliased

from app.audit import append_audit
from app.deps import CsrfProtected, CurrentUser, DbSession, require_roles
from app.errors import AppError, not_found
from app.models import (
    ContentVersion,
    FactVersion,
    GeoObservation,
    GeoObservationAttachment,
    GeoObservationCitation,
    GeoObservationPublication,
    Product,
    PublicationRecord,
    QueryTopic,
    User,
)
from app.routers.publication import verified_files
from app.schemas import (
    DashboardSummary,
    GeoCitation,
    GeoMetrics,
    GeoObservationCreate,
    GeoObservationList,
    GeoObservationOut,
    RoleName,
)

router = APIRouter(prefix="/api/v1", tags=["observation"])
Analyst = Annotated[User, Depends(require_roles(RoleName.ANALYST))]


def observation_out(db: DbSession, observation: GeoObservation) -> GeoObservationOut:
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
    attachment_ids = list(
        db.scalars(
            select(GeoObservationAttachment.file_id).where(
                GeoObservationAttachment.observation_id == observation.id
            )
        )
    )
    return GeoObservationOut(
        id=observation.id,
        query_topic_id=observation.query_topic_id,
        product_id=observation.product_id,
        actual_prompt=observation.actual_prompt,
        model_name=observation.model_name,
        model_version=observation.model_version,
        tested_at=observation.tested_at,
        web_search_enabled=observation.web_search_enabled,
        answer_summary=observation.answer_summary,
        mentioned=observation.mentioned,
        recommendation=observation.recommendation,
        accuracy=observation.accuracy,
        citations=[
            GeoCitation(
                url=citation.url,
                source_type=citation.source_type,
                publication_record_id=citation.publication_record_id,
            )
            for citation in citations
        ],
        publication_record_ids=publication_ids,
        attachment_file_ids=attachment_ids,
        notes=observation.notes,
        supersedes_id=observation.supersedes_id,
        tested_by=observation.tested_by,
        created_at=observation.created_at,
    )


@router.get(
    "/geo-observations", response_model=GeoObservationList, operation_id="listGeoObservations"
)
def list_geo_observations(db: DbSession, _user: CurrentUser) -> GeoObservationList:
    observations = list(
        db.scalars(select(GeoObservation).order_by(GeoObservation.tested_at.desc()))
    )
    return GeoObservationList(items=[observation_out(db, item) for item in observations])


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
    if db.get(QueryTopic, payload.query_topic_id) is None:
        raise not_found("目标问题")
    if db.get(Product, payload.product_id) is None:
        raise not_found("产品")
    if len(payload.publication_record_ids) != len(set(payload.publication_record_ids)):
        raise AppError("VALIDATION_ERROR", "关联发布记录 ID 重复", 422)
    publications = (
        list(
            db.scalars(
                select(PublicationRecord).where(
                    PublicationRecord.id.in_(payload.publication_record_ids)
                )
            )
        )
        if payload.publication_record_ids
        else []
    )
    if len(publications) != len(payload.publication_record_ids):
        raise AppError("VALIDATION_ERROR", "包含不存在的发布记录", 422)
    for citation in payload.citations:
        if (
            citation.publication_record_id
            and db.get(PublicationRecord, citation.publication_record_id) is None
        ):
            raise AppError("VALIDATION_ERROR", "引用关联了不存在的发布记录", 422)
    files = verified_files(db, payload.attachment_file_ids)
    if payload.supersedes_id:
        previous = db.get(GeoObservation, payload.supersedes_id)
        if previous is None:
            raise not_found("被纠正的 GEO 观测")
        if (
            previous.product_id != payload.product_id
            or previous.query_topic_id != payload.query_topic_id
        ):
            raise AppError("VALIDATION_ERROR", "纠正记录必须属于相同产品和目标问题", 422)
        if (
            db.scalar(select(GeoObservation.id).where(GeoObservation.supersedes_id == previous.id))
            is not None
        ):
            raise AppError("REVISION_CONFLICT", "该 GEO 观测已被纠正", 409)
    observation = GeoObservation(
        query_topic_id=payload.query_topic_id,
        product_id=payload.product_id,
        actual_prompt=payload.actual_prompt,
        model_name=payload.model_name,
        model_version=payload.model_version,
        tested_at=payload.tested_at,
        web_search_enabled=payload.web_search_enabled,
        answer_summary=payload.answer_summary,
        mentioned=payload.mentioned,
        recommendation=payload.recommendation,
        accuracy=payload.accuracy,
        notes=payload.notes,
        supersedes_id=payload.supersedes_id,
        tested_by=analyst.id,
    )
    db.add(observation)
    db.flush()
    db.add_all(
        GeoObservationCitation(
            observation_id=observation.id,
            url=str(citation.url),
            source_type=citation.source_type,
            publication_record_id=citation.publication_record_id,
        )
        for citation in payload.citations
    )
    db.add_all(
        GeoObservationPublication(
            observation_id=observation.id, publication_record_id=publication.id
        )
        for publication in publications
    )
    db.add_all(
        GeoObservationAttachment(observation_id=observation.id, file_id=file.id) for file in files
    )
    append_audit(
        db,
        actor_id=analyst.id,
        action="geo_observation.created",
        target_type="GeoObservation",
        target_id=observation.id,
        request_id=request.state.request_id,
        details={"supersedes_id": str(payload.supersedes_id) if payload.supersedes_id else None},
    )
    db.commit()
    return observation_out(db, observation)


@router.get("/geo-metrics", response_model=GeoMetrics, operation_id="getGeoMetrics")
def get_geo_metrics(
    db: DbSession,
    _user: CurrentUser,
    product_id: uuid.UUID | None = None,
    query_topic_id: uuid.UUID | None = None,
    model_name: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> GeoMetrics:
    """直接从未被纠正的源观测计算指标，不持久化汇总。"""
    superseding = aliased(GeoObservation)
    query = select(GeoObservation).where(
        ~exists(select(superseding.id).where(superseding.supersedes_id == GeoObservation.id))
    )
    if product_id:
        query = query.where(GeoObservation.product_id == product_id)
    if query_topic_id:
        query = query.where(GeoObservation.query_topic_id == query_topic_id)
    if model_name:
        query = query.where(GeoObservation.model_name == model_name)
    if date_from:
        query = query.where(
            GeoObservation.tested_at >= datetime.combine(date_from, datetime.min.time(), tzinfo=UTC)
        )
    if date_to:
        query = query.where(
            GeoObservation.tested_at
            < datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
        )
    observations = list(db.scalars(query))
    count = len(observations)
    if count == 0:
        return GeoMetrics(
            sample_count=0,
            mention_rate=0,
            recommendation_rate=0,
            citation_rate=0,
            accuracy_rate=None,
        )
    observation_ids = [item.id for item in observations]
    cited_ids = set(
        db.scalars(
            select(GeoObservationCitation.observation_id)
            .where(GeoObservationCitation.observation_id.in_(observation_ids))
            .distinct()
        )
    )
    judgeable = [item for item in observations if item.accuracy != "UNJUDGEABLE"]
    return GeoMetrics(
        sample_count=count,
        mention_rate=sum(item.mentioned for item in observations) / count,
        recommendation_rate=sum(item.recommendation == "RECOMMENDED" for item in observations)
        / count,
        citation_rate=len(cited_ids) / count,
        accuracy_rate=(
            sum(item.accuracy == "ACCURATE" for item in judgeable) / len(judgeable)
            if judgeable
            else None
        ),
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
        publication_attention=int(
            db.scalar(
                select(func.count())
                .select_from(PublicationRecord)
                .where(PublicationRecord.status.in_(["REJECTED", "REMOVED", "VERIFICATION_FAILED"]))
            )
            or 0
        ),
        recent_accuracy_errors=int(
            db.scalar(
                select(func.count())
                .select_from(GeoObservation)
                .where(
                    GeoObservation.tested_at >= since,
                    GeoObservation.accuracy.in_(["PARTIAL", "INCORRECT"]),
                )
            )
            or 0
        ),
    )
