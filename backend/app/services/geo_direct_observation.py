"""Slice 1C：单条直录/历史补录/探索新问题/文章定位核查服务。"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.articles import ArticlePublication
from app.models.geo_catalog import GeoSubject
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.geo_runs import GeoObservationRun
from app.models.geo_surfaces import GeoCollectionProfile
from app.models.identity import User
from app.schemas.geo_answers import GeoCitationObservation, GeoCitationObservationStatus
from app.schemas.geo_daily_checklist import (
    GeoDirectManualObservationCreate,
    GeoDirectManualObservationOut,
)
from app.schemas.geo_manual_collection import (
    GeoManualCitationInput,
    GeoManualObservationSubmit,
)
from app.schemas.geo_monitoring_plans import (
    GeoMonitoringPlanConfiguration,
    GeoPlanScheduleKind,
    GeoPlanSubject,
    GeoPlanSubjectRole,
)
from app.schemas.geo_runs import GeoRunEntryKind, GeoRunStatus
from app.services.geo_batches import freeze_batch
from app.services.geo_manual_collection import submit_manual_observation
from app.services.geo_plan_configuration import canonical_configuration
from app.services.geo_plan_locks import command, lock_resources


def create_direct_manual_observation(
    db: Session,
    *,
    payload: GeoDirectManualObservationCreate,
    actor: User,
    request_id: str,
) -> GeoDirectManualObservationOut:
    """单条直录入口（历史补录/探索新问题/文章定位核查）；隐藏单 Run 批次，支持一步直录答案。"""
    is_backfill = payload.entry_kind == "BACKFILL"
    backfill_source = (payload.backfill_source or "").strip() if is_backfill else None
    if is_backfill and not backfill_source:
        raise AppError("VALIDATION_ERROR", "历史补录必须填写补录来源说明", 422)
    if payload.entry_kind != "ARTICLE_LOOKUP" and payload.target_article_publication_id is not None:
        raise AppError("VALIDATION_ERROR", "仅文章定位核查可绑定目标发布文章", 422)

    with command(db, actor) as current:
        prompt = db.get(GeoPromptVariant, payload.prompt_variant_id)
        if prompt is None:
            raise not_found("问题变体")
        profile = db.get(GeoCollectionProfile, payload.collection_profile_id)
        if profile is None or profile.collection_mode != "MANUAL":
            raise AppError("GEO_MANUAL_MODE_REQUIRED", "单条直录仅支持 MANUAL 采集配置", 422)
        if (
            payload.target_article_publication_id is not None
            and db.get(ArticlePublication, payload.target_article_publication_id) is None
        ):
            raise not_found("目标文章发布记录")

        subject_ids = list(payload.subject_ids)
        if not subject_ids:
            subject_ids = list(
                db.scalars(
                    select(GeoSubject.id)
                    .where(
                        GeoSubject.is_active.is_(True),
                        GeoSubject.subject_type.in_(["OWN_BRAND", "OWN_PRODUCT"]),
                    )
                    .order_by(GeoSubject.subject_type.asc(), GeoSubject.id.asc())
                    .limit(20)
                )
            )
        if not subject_ids:
            subject_ids = list(
                db.scalars(
                    select(GeoSubject.id)
                    .where(GeoSubject.is_active.is_(True))
                    .order_by(GeoSubject.id.asc())
                    .limit(10)
                )
            )
        if not subject_ids:
            raise AppError(
                "VALIDATION_ERROR", "请先在监测对象目录配置至少一个启用的品牌或产品主体", 422
            )

        subjects_cfg = [
            GeoPlanSubject(
                subject_id=sid,
                role=GeoPlanSubjectRole.PRIMARY if idx == 0 else GeoPlanSubjectRole.REFERENCE,
            )
            for idx, sid in enumerate(dict.fromkeys(subject_ids))
        ]
        config = canonical_configuration(
            GeoMonitoringPlanConfiguration(
                name=f"直录-{payload.entry_kind}-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}",
                description="单条人工直录隐藏批次",
                subjects=subjects_cfg,
                prompt_variant_ids=[prompt.id],
                collection_profile_ids=[profile.id],
                repeat_count=1,
                schedule_kind=GeoPlanScheduleKind.MANUAL_ONLY,
                cron_expression=None,
                timezone="Asia/Shanghai",
                budget_limit=None,
                rule_set_revision=1,
            )
        )
        lock_resources(db, [config])
        run_overrides: dict[str, object] = {
            "entry_kind": payload.entry_kind,
            "is_backfill": is_backfill,
            "backfill_source": backfill_source,
            "assignee_id": payload.assignee_id or current.id,
            "target_article_publication_id": payload.target_article_publication_id,
        }
        batch = freeze_batch(
            db,
            config,
            plan=None,
            actor=current,
            scheduled_for=None,
            identity=None,
            request_id=request_id,
            run_overrides=run_overrides,
        )
        run = db.scalar(select(GeoObservationRun).where(GeoObservationRun.batch_id == batch.id))
        assert run is not None
        batch_id = batch.id
        run_id = run.id
        append_audit(
            db,
            AuditEntry(
                actor_id=current.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_direct_observation.created",
                target_type="GeoObservationRun",
                target_id=run_id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已创建单条人工直录运行",
                details={
                    "facts": {
                        "run_id": str(run_id),
                        "batch_id": str(batch_id),
                        "entry_kind": payload.entry_kind,
                    }
                },
            ),
        )
        db.commit()

    if payload.answer_text is not None and payload.answer_text.strip():
        citations = [
            GeoManualCitationInput(
                original_url=c.original_url,
                position=idx,
                title=c.title,
                extraction_source="MANUAL",
            )
            for idx, c in enumerate(payload.citations, start=1)
        ]
        cit_obs = payload.citation_observation or GeoCitationObservation(
            status=(
                GeoCitationObservationStatus.COMPLETE
                if citations
                else GeoCitationObservationStatus.NONE
            ),
            missing_reason=None,
        )
        submit_payload = GeoManualObservationSubmit(
            expected_draft_revision=0,
            answer_text=payload.answer_text,
            answer_format="TEXT",
            source_product=payload.source_product,
            source_model=payload.source_model,
            source_version=payload.source_version,
            web_search_observed=payload.web_search_observed,
            screenshot_file_id=payload.screenshot_file_id,
            citations=citations,
            citation_observation=cit_obs,
            collected_at=payload.collected_at or datetime.now(UTC),
            actual_prompt_text=payload.actual_prompt_text,
            inline_review=payload.inline_review,
        )
        receipt = submit_manual_observation(
            db,
            run_id=run_id,
            payload=submit_payload,
            actor=actor,
            idempotency_key=f"direct-{uuid4().hex}",
            request_id=request_id,
        )
        return GeoDirectManualObservationOut(
            batch_id=batch_id,
            run_id=run_id,
            entry_kind=GeoRunEntryKind(payload.entry_kind),
            is_backfill=is_backfill,
            run_status=receipt.run_status or GeoRunStatus.COLLECTED,
            answer_snapshot_id=receipt.answer_snapshot_id,
            analysis_revision_id=receipt.analysis_revision_id,
            review_id=receipt.review_id,
            citation_links=receipt.citation_links or [],
        )

    return GeoDirectManualObservationOut(
        batch_id=batch_id,
        run_id=run_id,
        entry_kind=GeoRunEntryKind(payload.entry_kind),
        is_backfill=is_backfill,
        run_status=GeoRunStatus.PENDING,
    )
