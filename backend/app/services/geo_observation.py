"""追加式 GEO 观测及纠正关系的应用服务。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.errors import AppError, not_found
from app.models.configuration import QueryTopic
from app.models.geo_files import (
    GeoObservation,
    GeoObservationAttachment,
    GeoObservationCitation,
    GeoObservationPublication,
)
from app.models.identity import User
from app.models.product_facts import Product
from app.models.publication import PublicationRecord
from app.schemas.geo_files import GeoObservationCreate
from app.services.file_records import verified_files


def create_geo_observation(
    *, db: Session, payload: GeoObservationCreate, actor: User, request_id: str
) -> GeoObservation:
    """校验全部引用和纠正链后追加 GEO 观测。"""
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
        tested_by=actor.id,
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
        actor_id=actor.id,
        action="geo_observation.created",
        target_type="GeoObservation",
        target_id=observation.id,
        request_id=request_id,
        details={"supersedes_id": str(payload.supersedes_id) if payload.supersedes_id else None},
    )
    db.commit()
    return observation
