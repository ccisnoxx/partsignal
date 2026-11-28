"""Slice 1D：领导看板筛选选项、窗口事实加载与统一证据下钻服务。"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.geo_analysis import GeoEntityMention, GeoRecommendation, GeoRunReview
from app.models.geo_answers import GeoAnswerCitation, GeoAnswerSnapshot
from app.models.geo_citation_links import GeoCitationPublicationLink
from app.models.geo_manual_collection import GeoManualSubmission
from app.models.geo_monitoring_plans import GeoMonitoringPlan
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.geo_runs import GeoObservationRun
from app.models.geo_surfaces import GeoEngineSurface
from app.models.identity import User
from app.models.product_facts import Product
from app.schemas.geo_leadership_dashboard import (
    GeoDashboardFilterOption,
    GeoLeadershipEvidenceItem,
    GeoLeadershipEvidenceList,
    GeoLeadershipFilterOptionsOut,
)
from app.schemas.geo_prompt_variants import GeoPromptCategory
from app.schemas.geo_runs import GeoRunEntryKind, GeoRunStatus
from app.services.geo_citation_matching import list_run_citation_links
from app.services.geo_leadership_calc import EffectiveRunFacts, apply_review_overrides


def get_leadership_filter_options(db: Session) -> GeoLeadershipFilterOptionsOut:
    products = [
        GeoDashboardFilterOption(id=pid, label=f"{brand} {part}", meta=cat)
        for pid, brand, part, cat in db.execute(
            select(Product.id, Product.brand, Product.part_number, Product.category)
            .where(Product.status == "ACTIVE")
            .order_by(Product.brand.asc(), Product.part_number.asc())
        ).all()
    ]
    platforms = [
        GeoDashboardFilterOption(id=sid, label=name, meta=kind)
        for sid, name, kind in db.execute(
            select(
                GeoEngineSurface.id,
                GeoEngineSurface.name,
                GeoEngineSurface.surface_kind,
            )
            .where(GeoEngineSurface.is_active.is_(True))
            .order_by(GeoEngineSurface.name.asc())
        ).all()
    ]
    core_plans = [
        GeoDashboardFilterOption(id=pid, label=name, meta=role)
        for pid, name, role in db.execute(
            select(
                GeoMonitoringPlan.id,
                GeoMonitoringPlan.name,
                GeoMonitoringPlan.plan_role,
            )
            .where(GeoMonitoringPlan.status == "ACTIVE")
            .order_by(GeoMonitoringPlan.plan_role.asc(), GeoMonitoringPlan.name.asc())
        ).all()
    ]
    return GeoLeadershipFilterOptionsOut(
        products=products, platforms=platforms, core_plans=core_plans
    )


def load_window_facts(
    db: Session,
    *,
    period_from: datetime,
    period_to: datetime,
    surface_id: UUID | None,
    collection_mode: str | None,
) -> list[EffectiveRunFacts]:
    effective_col = func.coalesce(GeoObservationRun.collected_at, GeoObservationRun.created_at)
    query = (
        select(
            GeoObservationRun,
            GeoPromptVariant.prompt_category,
            GeoPromptVariant.priority,
            GeoAnswerSnapshot.id,
            GeoAnswerSnapshot.query_modified,
            GeoAnswerSnapshot.citation_observation,
        )
        .join(GeoPromptVariant, GeoPromptVariant.id == GeoObservationRun.prompt_variant_id)
        .outerjoin(GeoAnswerSnapshot, GeoAnswerSnapshot.run_id == GeoObservationRun.id)
        .where(effective_col >= period_from, effective_col < period_to)
        .order_by(effective_col.desc(), GeoObservationRun.id.desc())
    )
    if surface_id is not None:
        query = query.where(
            GeoObservationRun.input_snapshot["profile"]["surface"]["id"].astext == str(surface_id)
        )
    if collection_mode is not None:
        query = query.where(
            GeoObservationRun.input_snapshot["profile"]["collection_mode"].astext
            == collection_mode
        )
    rows = db.execute(query).all()
    if not rows:
        return []

    run_ids = [r[0].id for r in rows]
    analysis_ids = [
        r[0].current_analysis_revision_id
        for r in rows
        if r[0].current_analysis_revision_id is not None
    ]
    answer_ids = [r[3] for r in rows if r[3] is not None]

    mentions_by_analysis: dict[UUID, set[UUID]] = defaultdict(set)
    recs_by_analysis: dict[UUID, dict[UUID, str]] = defaultdict(dict)
    if analysis_ids:
        for aid, sid in db.execute(
            select(GeoEntityMention.analysis_revision_id, GeoEntityMention.subject_id).where(
                GeoEntityMention.analysis_revision_id.in_(analysis_ids)
            )
        ).all():
            mentions_by_analysis[aid].add(sid)
        for aid, sid, rkind in db.execute(
            select(
                GeoRecommendation.analysis_revision_id,
                GeoRecommendation.subject_id,
                GeoRecommendation.recommendation,
            ).where(GeoRecommendation.analysis_revision_id.in_(analysis_ids))
        ).all():
            recs_by_analysis[aid][sid] = str(rkind)

    latest_reviews: dict[UUID, dict[str, object] | None] = {}
    for rid, _aid, corr in db.execute(
        select(
            GeoRunReview.run_id,
            GeoRunReview.analysis_revision_id,
            GeoRunReview.correction_payload,
        )
        .where(GeoRunReview.run_id.in_(run_ids))
        .order_by(GeoRunReview.created_at.desc(), GeoRunReview.id.desc())
    ).all():
        if rid not in latest_reviews:
            latest_reviews[rid] = corr

    eff_links_by_answer: dict[UUID, set[UUID]] = defaultdict(set)
    cand_answers: set[UUID] = set()
    if answer_ids:
        for aid, pub_id, lstatus in db.execute(
            select(
                GeoAnswerCitation.answer_snapshot_id,
                GeoCitationPublicationLink.article_publication_id,
                GeoCitationPublicationLink.link_status,
            )
            .join(
                GeoCitationPublicationLink,
                GeoCitationPublicationLink.citation_id == GeoAnswerCitation.id,
            )
            .where(GeoAnswerCitation.answer_snapshot_id.in_(answer_ids))
        ).all():
            if lstatus in {"AUTO_EXACT", "CONFIRMED"}:
                eff_links_by_answer[aid].add(pub_id)
            elif lstatus == "CANDIDATE":
                cand_answers.add(aid)

    facts: list[EffectiveRunFacts] = []
    for run, pcat, pprio, ans_id, qmod, cit_obs in rows:
        snap = run.input_snapshot
        profile_snap = snap["profile"]
        surface_snap = profile_snap["surface"]
        aid = run.current_analysis_revision_id
        m_brand, m_any_prod, m_prod_ids, rec_own, rec_unk = apply_review_overrides(
            subjects_snapshot=list(snap.get("subjects", [])),
            machine_mentioned_subject_ids=(
                mentions_by_analysis.get(aid, set()) if aid is not None else set()
            ),
            machine_recommendations=(
                recs_by_analysis.get(aid, {}) if aid is not None else {}
            ),
            correction_payload=latest_reviews.get(run.id),
        )
        cit_status = (
            str(cit_obs.get("status"))
            if isinstance(cit_obs, dict) and cit_obs.get("status")
            else None
        )
        facts.append(
            EffectiveRunFacts(
                run_id=run.id,
                effective_at=run.collected_at or run.created_at,
                status=run.status,
                entry_kind=run.entry_kind,
                is_backfill=run.is_backfill,
                prompt_variant_id=run.prompt_variant_id,
                prompt_text=str(snap["prompt"]["prompt_text"]),
                prompt_category=str(pcat),
                prompt_priority=str(pprio),
                surface_id=UUID(str(surface_snap["id"])),
                platform_name=str(surface_snap["name"]),
                collection_mode=str(profile_snap["collection_mode"]),
                query_modified=bool(qmod),
                citation_observation_status=cit_status,
                mentioned_brand=m_brand,
                mentioned_any_product=m_any_prod,
                mentioned_product_ids=m_prod_ids,
                recommended_any_own=rec_own,
                recommendation_unknown=rec_unk,
                effective_linked_pub_ids=(
                    frozenset(eff_links_by_answer.get(ans_id, set())) if ans_id else frozenset()
                ),
                has_pending_candidate_links=ans_id in cand_answers if ans_id else False,
            )
        )
    return facts


def list_leadership_evidence(
    db: Session,
    *,
    run_ids: list[UUID] | None = None,
    prompt_variant_id: UUID | None = None,
    surface_id: UUID | None = None,
    article_publication_id: UUID | None = None,
    period_from: datetime | None = None,
    period_to: datetime | None = None,
    limit: int = 50,
) -> GeoLeadershipEvidenceList:
    """统一下钻证据明细：原问题、改问标记、完整回答、截图、引用归因、采集与登记时间及记录人。"""
    effective_col = func.coalesce(GeoObservationRun.collected_at, GeoObservationRun.created_at)
    query = (
        select(
            GeoObservationRun,
            GeoPromptVariant.prompt_category,
            GeoAnswerSnapshot,
            User.display_name,
        )
        .join(GeoPromptVariant, GeoPromptVariant.id == GeoObservationRun.prompt_variant_id)
        .outerjoin(GeoAnswerSnapshot, GeoAnswerSnapshot.run_id == GeoObservationRun.id)
        .outerjoin(GeoManualSubmission, GeoManualSubmission.run_id == GeoObservationRun.id)
        .outerjoin(User, User.id == GeoManualSubmission.submitted_by)
        .order_by(effective_col.desc(), GeoObservationRun.id.desc())
    )
    if run_ids:
        query = query.where(GeoObservationRun.id.in_(run_ids[:100]))
    if prompt_variant_id is not None:
        query = query.where(GeoObservationRun.prompt_variant_id == prompt_variant_id)
    if surface_id is not None:
        query = query.where(
            GeoObservationRun.input_snapshot["profile"]["surface"]["id"].astext == str(surface_id)
        )
    if article_publication_id is not None:
        linked_run_ids = (
            select(GeoAnswerSnapshot.run_id)
            .join(GeoAnswerCitation, GeoAnswerCitation.answer_snapshot_id == GeoAnswerSnapshot.id)
            .join(
                GeoCitationPublicationLink,
                GeoCitationPublicationLink.citation_id == GeoAnswerCitation.id,
            )
            .where(
                GeoCitationPublicationLink.article_publication_id == article_publication_id,
                GeoCitationPublicationLink.link_status.in_(["AUTO_EXACT", "CONFIRMED"]),
            )
        )
        query = query.where(GeoObservationRun.id.in_(linked_run_ids))
    if period_from is not None:
        query = query.where(effective_col >= period_from)
    if period_to is not None:
        query = query.where(effective_col < period_to)

    rows = db.execute(query.limit(limit)).all()
    items: list[GeoLeadershipEvidenceItem] = []
    for run, pcat, ans, recorder_name in rows:
        snap = run.input_snapshot
        links = list_run_citation_links(db, run.id) if ans is not None else []
        aid = run.current_analysis_revision_id
        machine_mentions = (
            set(
                db.scalars(
                    select(GeoEntityMention.subject_id).where(
                        GeoEntityMention.analysis_revision_id == aid
                    )
                )
            )
            if aid is not None
            else set()
        )
        machine_recs = (
            {
                sid: str(rk)
                for sid, rk in db.execute(
                    select(GeoRecommendation.subject_id, GeoRecommendation.recommendation).where(
                        GeoRecommendation.analysis_revision_id == aid
                    )
                ).all()
            }
            if aid is not None
            else {}
        )
        latest_corr = db.scalar(
            select(GeoRunReview.correction_payload)
            .where(GeoRunReview.run_id == run.id)
            .order_by(GeoRunReview.created_at.desc(), GeoRunReview.id.desc())
            .limit(1)
        )
        m_brand, m_any_prod, _pids, rec_own, rec_unk = apply_review_overrides(
            subjects_snapshot=list(snap.get("subjects", [])),
            machine_mentioned_subject_ids=machine_mentions,
            machine_recommendations=machine_recs,
            correction_payload=latest_corr,
        )
        cit_status = (
            str(ans.citation_observation.get("status"))
            if ans is not None and isinstance(ans.citation_observation, dict)
            else None
        )
        items.append(
            GeoLeadershipEvidenceItem(
                run_id=run.id,
                effective_at=run.collected_at or run.created_at,
                collected_at=run.collected_at,
                registered_at=run.created_at,
                status=GeoRunStatus(run.status),
                entry_kind=GeoRunEntryKind(run.entry_kind),
                is_backfill=run.is_backfill,
                backfill_source=run.backfill_source,
                platform_name=str(snap["profile"]["surface"]["name"]),
                collection_mode=str(snap["profile"]["collection_mode"]),
                prompt_category=GeoPromptCategory(pcat),
                prompt_text=str(snap["prompt"]["prompt_text"]),
                actual_prompt_text=ans.actual_prompt_text if ans else None,
                query_modified=bool(ans.query_modified) if ans else False,
                answer_text=ans.answer_text if ans else None,
                screenshot_file_id=ans.screenshot_file_id if ans else None,
                web_search_observed=ans.web_search_observed if ans else None,
                citation_observation_status=cit_status,
                recorder_name=recorder_name,
                mentioned_brand=m_brand,
                mentioned_product=m_any_prod,
                recommended=None if rec_unk else rec_own,
                citation_links=links,
                error_code=run.error_code,
                error_summary=run.error_summary,
            )
        )
    return GeoLeadershipEvidenceList(items=items, total=len(items))
