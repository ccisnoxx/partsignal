"""追加式 GEO 观测及纠正关系的应用服务。"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.errors import AppError, not_found
from app.models.configuration import PlatformProfile
from app.models.content import ContentTask, ContentVersion
from app.models.geo_files import (
    GeoObservation,
    GeoObservationAttachment,
    GeoObservationPublication,
)
from app.models.identity import User
from app.models.product_facts import Product
from app.models.publication import PlatformAccount, PublicationRecord
from app.schemas.geo_files import GeoObservationCreate, GeoPublicationCandidate
from app.services.file_records import verified_files


def geo_publication_candidates(
    db: Session, product_id: uuid.UUID, *, lock: bool = False
) -> list[GeoPublicationCandidate]:
    """投影产品当前全部可观测文章；写入时锁定发布记录稳定候选集合。"""
    query = (
        select(PublicationRecord, ContentVersion.title, PlatformProfile.name)
        .join(ContentVersion, ContentVersion.id == PublicationRecord.content_version_id)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .join(PlatformAccount, PlatformAccount.id == PublicationRecord.platform_account_id)
        .join(PlatformProfile, PlatformProfile.id == PlatformAccount.platform_profile_id)
        .where(
            ContentTask.product_id == product_id,
            PublicationRecord.status.in_(["PUBLISHED", "VERIFIED"]),
            PublicationRecord.final_url.is_not(None),
        )
        .order_by(PublicationRecord.published_at, PublicationRecord.id)
    )
    if lock:
        query = query.with_for_update(of=PublicationRecord)
    return [
        GeoPublicationCandidate.model_validate(
            {
                "publication_record_id": publication.id,
                "title": publication.actual_title or content_title,
                "platform_name": platform_name,
                "final_url": publication.final_url,
                "status": publication.status,
            }
        )
        for publication, content_title, platform_name in db.execute(query).all()
    ]


def create_geo_observation(
    *, db: Session, payload: GeoObservationCreate, actor: User, request_id: str
) -> GeoObservation:
    """锁定完整文章集合并校验截图后追加人工 GEO 观测。"""
    product = db.scalar(select(Product).where(Product.id == payload.product_id).with_for_update())
    if product is None:
        raise not_found("产品")
    candidates = geo_publication_candidates(db, payload.product_id, lock=True)
    if not candidates:
        raise AppError("VALIDATION_ERROR", "该产品暂无可观测的已发布文章", 422)
    submitted_ids = {item.publication_record_id for item in payload.article_results}
    candidate_ids = {item.publication_record_id for item in candidates}
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
            db.scalar(select(GeoObservation.id).where(GeoObservation.supersedes_id == previous.id))
            is not None
        ):
            raise AppError("REVISION_CONFLICT", "该 GEO 观测已被纠正", 409)
    observation = GeoObservation(
        observation_kind="MANUAL_ARTICLE_SEARCH",
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
            publication_record_id=result.publication_record_id,
            recommendation_status=result.recommendation_status,
        )
        for result in payload.article_results
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
