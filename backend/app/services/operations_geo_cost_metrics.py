"""Slice 4C：GEO 归因摘要（去重重试 + 复核投影 + 引用可观测性）计算服务。"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import column, exists, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session, aliased

from app.models.geo_analysis import (
    GeoAnalysisRevision,
    GeoClaimAssessment,
    GeoEntityMention,
    GeoRecommendation,
    GeoRunReview,
)
from app.models.geo_analysis_worker import GeoCitationClassification
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_catalog import GeoSubject
from app.models.geo_interventions import GeoIntervention
from app.models.geo_opportunities import GeoOpportunity
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.schemas.operations_dashboard import GeoAttributionSummaryOut
from app.services.operations_content_metrics import any_uuid, ratio

OPEN_OPPORTUNITY_STATUSES = ("OPEN", "ACKNOWLEDGED", "IN_PROGRESS")
COLLECTED_RUN_STATUSES = ("COLLECTED", "ANALYZING", "NEEDS_REVIEW", "COMPLETED")


def _resolve_own_subject_ids(
    db: Session,
    *,
    product_ids: list[uuid.UUID] | None,
) -> set[uuid.UUID]:
    """区分全局(None)与活动作用域(list)；活动未绑定产品([])时返回空集，绝不越界回退全局。"""
    if product_ids is None:
        return set(
            db.scalars(
                select(GeoSubject.id).where(
                    GeoSubject.subject_type.in_(("OWN_BRAND", "OWN_PRODUCT"))
                )
            )
        )
    if not product_ids:
        return set()
    rows = db.execute(
        select(GeoSubject.id, GeoSubject.parent_subject_id).where(
            GeoSubject.subject_type == "OWN_PRODUCT",
            any_uuid(GeoSubject.product_id, product_ids),
        )
    ).all()
    subject_ids: set[uuid.UUID] = set()
    for sid, parent_id in rows:
        subject_ids.add(sid)
        if parent_id is not None:
            subject_ids.add(parent_id)
    return subject_ids


def _apply_review_overlay(
    *,
    rev_id: uuid.UUID,
    own_subject_ids: set[uuid.UUID],
    machine_mentions: set[uuid.UUID],
    machine_recs: dict[uuid.UUID, str],
    machine_claims: dict[uuid.UUID, tuple[uuid.UUID, str]],
    machine_citations: dict[uuid.UUID, tuple[str, uuid.UUID | None]],
    review: tuple[str, dict[str, Any] | None] | None,
) -> tuple[bool, bool, bool, int, int]:
    """将最新 CORRECTED 人工复核覆盖到机器分析结果上，返回单次 Run 的有效归因贡献。"""
    mentions = set(machine_mentions)
    recs = dict(machine_recs)
    claims = dict(machine_claims)
    citations = dict(machine_citations)

    if review is not None and review[0] == "CORRECTED" and isinstance(review[1], dict):
        payload = review[1]
        for item in payload.get("mentions") or ():
            if isinstance(item, dict) and item.get("subject_id"):
                sid = uuid.UUID(str(item["subject_id"]))
                count = int(item.get("mention_count") or 0)
                if count > 0:
                    mentions.add(sid)
                else:
                    mentions.discard(sid)
        for item in payload.get("recommendations") or ():
            if isinstance(item, dict) and item.get("subject_id") and item.get("recommendation"):
                sid = uuid.UUID(str(item["subject_id"]))
                recs[sid] = str(item["recommendation"])
        for item in payload.get("claims") or ():
            if isinstance(item, dict) and item.get("claim_assessment_id") and item.get("verdict"):
                cid = uuid.UUID(str(item["claim_assessment_id"]))
                if cid in claims:
                    claims[cid] = (claims[cid][0], str(item["verdict"]))
        for item in payload.get("citations") or ():
            if isinstance(item, dict) and item.get("citation_id") and item.get("source_category"):
                cit_id = uuid.UUID(str(item["citation_id"]))
                raw_sid = item.get("subject_id")
                cit_sid = uuid.UUID(str(raw_sid)) if raw_sid else None
                citations[cit_id] = (str(item["source_category"]), cit_sid)

    has_mention = bool(mentions & own_subject_ids)
    has_rec = any(
        sid in own_subject_ids and rec == "RECOMMENDED" for sid, rec in recs.items()
    )
    has_own_citation = any(
        cat == "OWNED" and (cit_sid is None or cit_sid in own_subject_ids)
        for cat, cit_sid in citations.values()
    )
    accurate = 0
    judgeable = 0
    for subj_id, verdict in claims.values():
        if subj_id in own_subject_ids and verdict in {"ACCURATE", "PARTIAL", "INCORRECT"}:
            judgeable += 1
            if verdict == "ACCURATE":
                accurate += 1
    _ = rev_id
    return has_mention, has_rec, has_own_citation, accurate, judgeable


def compute_geo_attribution(
    db: Session,
    *,
    plan_ids: list[uuid.UUID] | None,
    campaign_id: uuid.UUID | None,
    product_ids: list[uuid.UUID] | None,
    since: datetime,
    now: datetime,
) -> tuple[GeoAttributionSummaryOut, list[tuple[Decimal | None, str | None]]]:
    """按统一窗口 [since, now] 计算去重最新 Attempt + 叠加人工复核投影的 GEO 归因摘要。"""
    # 1. 干预计数与机会计数（含 IN_PROGRESS，已解决按 resolved_at 落在 [since, now] 统计）
    interv_stmt = select(GeoIntervention.status, GeoIntervention.opportunity_id)
    if campaign_id is not None:
        interv_stmt = interv_stmt.where(GeoIntervention.campaign_id == campaign_id)
    else:
        interv_stmt = interv_stmt.where(
            GeoIntervention.created_at >= since,
            GeoIntervention.created_at <= now,
        )
    interv_rows = db.execute(interv_stmt).all()
    linked_interventions = len(interv_rows)
    concluded_interventions = sum(1 for st, _oid in interv_rows if st == "CONCLUDED")

    if campaign_id is not None:
        interv_opp_ids = {oid for _st, oid in interv_rows}
        if interv_opp_ids:
            open_opps = int(
                db.scalar(
                    select(func.count())
                    .select_from(GeoOpportunity)
                    .where(
                        any_uuid(GeoOpportunity.id, interv_opp_ids),
                        GeoOpportunity.status.in_(OPEN_OPPORTUNITY_STATUSES),
                    )
                )
                or 0
            )
            resolved_opps = int(
                db.scalar(
                    select(func.count())
                    .select_from(GeoOpportunity)
                    .where(
                        any_uuid(GeoOpportunity.id, interv_opp_ids),
                        GeoOpportunity.status == "RESOLVED",
                        GeoOpportunity.resolved_at.is_not(None),
                        GeoOpportunity.resolved_at >= since,
                        GeoOpportunity.resolved_at <= now,
                    )
                )
                or 0
            )
        else:
            open_opps = 0
            resolved_opps = 0
    else:
        open_opps = int(
            db.scalar(
                select(func.count())
                .select_from(GeoOpportunity)
                .where(GeoOpportunity.status.in_(OPEN_OPPORTUNITY_STATUSES))
            )
            or 0
        )
        resolved_opps = int(
            db.scalar(
                select(func.count())
                .select_from(GeoOpportunity)
                .where(
                    GeoOpportunity.status == "RESOLVED",
                    GeoOpportunity.resolved_at.is_not(None),
                    GeoOpportunity.resolved_at >= since,
                    GeoOpportunity.resolved_at <= now,
                )
            )
            or 0
        )

    own_subject_ids = _resolve_own_subject_ids(db, product_ids=product_ids)
    if plan_ids is not None and (not plan_ids or not own_subject_ids):
        return (
            GeoAttributionSummaryOut(
                sample_count=0,
                completed_run_count=0,
                open_opportunity_count=open_opps,
                resolved_opportunity_count=resolved_opps,
                linked_intervention_count=linked_interventions,
                concluded_intervention_count=concluded_interventions,
            ),
            [],
        )

    # 2. 仅统计最新 attempt（排除被 previous_attempt_id 替代的旧重试尝试）
    successor = aliased(GeoObservationRun)
    latest_only = ~exists(
        select(successor.id).where(successor.previous_attempt_id == GeoObservationRun.id)
    )
    run_stmt = select(
        GeoObservationRun.id,
        GeoObservationRun.status,
        GeoObservationRun.external_call_state,
        GeoObservationRun.current_analysis_revision_id,
        GeoObservationRun.cost_amount,
        GeoObservationRun.cost_currency,
    ).where(
        latest_only,
        GeoObservationRun.created_at >= since,
        GeoObservationRun.created_at <= now,
    )
    if plan_ids is not None:
        run_stmt = run_stmt.join(
            GeoObservationBatch, GeoObservationBatch.id == GeoObservationRun.batch_id
        ).where(any_uuid(GeoObservationBatch.plan_id, plan_ids))
        # 共用监测计划时，仅纳入冻结 input_snapshot.subjects 命中本活动对象的 Run
        subject_strs = [str(sid) for sid in own_subject_ids]
        bindings = func.jsonb_array_elements(
            GeoObservationRun.input_snapshot["subjects"]
        ).table_valued(column("value", JSONB))
        run_stmt = run_stmt.where(
            exists(
                select(1)
                .select_from(bindings)
                .where(bindings.c.value["id"].astext.in_(subject_strs))
            )
        )

    run_rows = db.execute(run_stmt).all()
    # 仅已执行外部采集的 Run 进入 GEO 计价覆盖率与单位样本成本，未执行/取消 Run 不虚增未定价率
    collected_geo_costs = [
        (amt, curr)
        for _rid, st, ext_state, _aid, amt, curr in run_rows
        if st in COLLECTED_RUN_STATUSES or ext_state == "COMPLETED"
    ]

    sample_count = len(run_rows)
    completed_runs = [
        (rid, aid) for rid, st, _ext, aid, _amt, _curr in run_rows if st == "COMPLETED"
    ]
    completed_count = len(completed_runs)
    missing_data_rate = (
        round(1.0 - (completed_count / sample_count), 4) if sample_count > 0 else None
    )

    analyzed_pairs = [(rid, aid) for rid, aid in completed_runs if aid is not None]
    if not analyzed_pairs or not own_subject_ids:
        return (
            GeoAttributionSummaryOut(
                sample_count=sample_count,
                completed_run_count=completed_count,
                missing_data_rate=missing_data_rate,
                open_opportunity_count=open_opps,
                resolved_opportunity_count=resolved_opps,
                linked_intervention_count=linked_interventions,
                concluded_intervention_count=concluded_interventions,
            ),
            collected_geo_costs,
        )

    valid_rev_ids = set(
        db.scalars(
            select(GeoAnalysisRevision.id).where(
                any_uuid(GeoAnalysisRevision.id, [aid for _r, aid in analyzed_pairs]),
                GeoAnalysisRevision.status == "COMPLETED",
            )
        )
    )
    valid_pairs = [(rid, aid) for rid, aid in analyzed_pairs if aid in valid_rev_ids]
    denom = len(valid_pairs)
    if denom == 0:
        return (
            GeoAttributionSummaryOut(
                sample_count=sample_count,
                completed_run_count=completed_count,
                missing_data_rate=missing_data_rate,
                open_opportunity_count=open_opps,
                resolved_opportunity_count=resolved_opps,
                linked_intervention_count=linked_interventions,
                concluded_intervention_count=concluded_interventions,
            ),
            collected_geo_costs,
        )

    valid_run_ids = [rid for rid, _aid in valid_pairs]
    # 批量加载机器结果、最新有效复核与引用可观测状态
    mentions_by_rev: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for rev_id, sid in db.execute(
        select(GeoEntityMention.analysis_revision_id, GeoEntityMention.subject_id).where(
            any_uuid(GeoEntityMention.analysis_revision_id, valid_rev_ids)
        )
    ).tuples():
        mentions_by_rev[rev_id].add(sid)

    recs_by_rev: dict[uuid.UUID, dict[uuid.UUID, str]] = defaultdict(dict)
    for rev_id, sid, rec in db.execute(
        select(
            GeoRecommendation.analysis_revision_id,
            GeoRecommendation.subject_id,
            GeoRecommendation.recommendation,
        ).where(any_uuid(GeoRecommendation.analysis_revision_id, valid_rev_ids))
    ).tuples():
        recs_by_rev[rev_id][sid] = rec

    claims_by_rev: dict[uuid.UUID, dict[uuid.UUID, tuple[uuid.UUID, str]]] = defaultdict(dict)
    for rev_id, cid, sid, verdict in db.execute(
        select(
            GeoClaimAssessment.analysis_revision_id,
            GeoClaimAssessment.id,
            GeoClaimAssessment.subject_id,
            GeoClaimAssessment.verdict,
        ).where(any_uuid(GeoClaimAssessment.analysis_revision_id, valid_rev_ids))
    ).tuples():
        claims_by_rev[rev_id][cid] = (sid, verdict)

    cits_by_rev: dict[uuid.UUID, dict[uuid.UUID, tuple[str, uuid.UUID | None]]] = defaultdict(dict)
    for rev_id, cit_id, cat, cit_sid in db.execute(
        select(
            GeoCitationClassification.analysis_revision_id,
            GeoCitationClassification.citation_id,
            GeoCitationClassification.source_category,
            GeoCitationClassification.subject_id,
        ).where(any_uuid(GeoCitationClassification.analysis_revision_id, valid_rev_ids))
    ).tuples():
        cits_by_rev[rev_id][cit_id] = (cat, cit_sid)

    latest_reviews: dict[tuple[uuid.UUID, uuid.UUID], tuple[str, dict[str, Any] | None]] = {}
    for run_id, rev_id, decision, payload in db.execute(
        select(
            GeoRunReview.run_id,
            GeoRunReview.analysis_revision_id,
            GeoRunReview.decision,
            GeoRunReview.correction_payload,
        )
        .where(any_uuid(GeoRunReview.analysis_revision_id, valid_rev_ids))
        .distinct(GeoRunReview.run_id, GeoRunReview.analysis_revision_id)
        .order_by(
            GeoRunReview.run_id,
            GeoRunReview.analysis_revision_id,
            GeoRunReview.created_at.desc(),
            GeoRunReview.id.desc(),
        )
    ).tuples():
        latest_reviews[(run_id, rev_id)] = (decision, payload)

    obs_by_run: dict[uuid.UUID, dict[str, Any] | None] = {
        rid: obs
        for rid, obs in db.execute(
            select(GeoAnswerSnapshot.run_id, GeoAnswerSnapshot.citation_observation).where(
                any_uuid(GeoAnswerSnapshot.run_id, valid_run_ids)
            )
        ).tuples()
    }

    mention_hits = 0
    rec_hits = 0
    citation_hits = 0
    citation_denom = 0
    total_accurate = 0
    total_judgeable = 0

    for run_id, rev_id in valid_pairs:
        has_m, has_r, has_c, acc, judg = _apply_review_overlay(
            rev_id=rev_id,
            own_subject_ids=own_subject_ids,
            machine_mentions=mentions_by_rev.get(rev_id, set()),
            machine_recs=recs_by_rev.get(rev_id, {}),
            machine_claims=claims_by_rev.get(rev_id, {}),
            machine_citations=cits_by_rev.get(rev_id, {}),
            review=latest_reviews.get((run_id, rev_id)),
        )
        if has_m:
            mention_hits += 1
        if has_r:
            rec_hits += 1
        total_accurate += acc
        total_judgeable += judg

        obs = obs_by_run.get(run_id)
        citation_observable = not (
            isinstance(obs, dict) and obs.get("status") in {"PARTIAL", "UNKNOWN"}
        )
        if citation_observable:
            citation_denom += 1
            if has_c:
                citation_hits += 1

    return (
        GeoAttributionSummaryOut(
            sample_count=sample_count,
            completed_run_count=completed_count,
            missing_data_rate=missing_data_rate,
            mention_rate=ratio(mention_hits, denom),
            recommendation_rate=ratio(rec_hits, denom),
            citation_rate=ratio(citation_hits, citation_denom),
            accuracy_rate=ratio(total_accurate, total_judgeable),
            open_opportunity_count=open_opps,
            resolved_opportunity_count=resolved_opps,
            linked_intervention_count=linked_interventions,
            concluded_intervention_count=concluded_interventions,
        ),
        collected_geo_costs,
    )
