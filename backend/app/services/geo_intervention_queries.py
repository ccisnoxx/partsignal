"""Slice 4A：GEO 干预归因读模型批量投影与列表查询服务。"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import asdict
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.models.campaign import ContentCampaign
from app.models.content import ContentTask
from app.models.geo_interventions import GeoIntervention
from app.models.geo_opportunities import GeoOpportunity, GeoOpportunityAction
from app.models.geo_opportunity_decisions import GeoOpportunityDecision
from app.models.geo_retests import GeoRetestBaseline
from app.models.geo_runs import GeoObservationRun
from app.models.identity import User
from app.models.publication import PublicationWork, PublishedArticle
from app.schemas.geo_interventions import (
    GeoInterventionAttributionOut,
    GeoInterventionLinkedActionOut,
    GeoInterventionListPage,
    GeoInterventionMetricDeltaOut,
    GeoInterventionOut,
    GeoInterventionTargetMetrics,
)
from app.schemas.geo_metric_values import GeoConfidenceInterval, GeoDeltaConfidenceInterval
from app.services.geo_statistics import newcombe_wilson_diff_ci, wilson_confidence_interval

TERMINAL_INTERVENTION_STATUSES = frozenset({"CONCLUDED", "CANCELLED"})
_COUNT_METRIC_CODES = frozenset(
    {"same_fact_error_count", "owned_citation_count", "consecutive_failed_count"}
)

# 仅映射同向（越高越好）的真实 ComparisonMetric，严禁把反向错误率误判为正向准确率达标。
_POSITIVE_TARGET_METRIC_MAP: dict[str, str] = {
    "natural_visibility": "target_mention_rate",
    "recommendation_rate": "target_recommendation_rate",
    "owned_source_coverage": "target_citation_rate",
}


def _available_actions(status: str) -> list[Literal["UPDATE", "CONCLUDE", "CANCEL"]]:
    if status in TERMINAL_INTERVENTION_STATUSES:
        return []
    return ["UPDATE", "CONCLUDE", "CANCEL"]


def _numeric_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    return None


def _batch_run_counts_map(
    db: Session, batch_ids: set[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, int]]:
    if not batch_ids:
        return {}
    totals: dict[uuid.UUID, int] = defaultdict(int)
    completed: dict[uuid.UUID, int] = defaultdict(int)
    rows = db.execute(
        select(GeoObservationRun.batch_id, GeoObservationRun.status, func.count())
        .where(GeoObservationRun.batch_id.in_(batch_ids))
        .group_by(GeoObservationRun.batch_id, GeoObservationRun.status)
    ).all()
    for batch_id, status, count in rows:
        cnt = int(count)
        totals[batch_id] += cnt
        if status == "COMPLETED":
            completed[batch_id] += cnt
    return {bid: (totals[bid], completed[bid]) for bid in batch_ids}


def _nonnegative_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    return None


def _window_metric_map(
    window: Any,
) -> tuple[list[str], dict[str, tuple[float | None, int | None, int | None]]]:
    order: list[str] = []
    values: dict[str, tuple[float | None, int | None, int | None]] = {}
    if not isinstance(window, dict):
        return order, values
    raw_metrics = window.get("metrics")
    if not isinstance(raw_metrics, list):
        return order, values
    for item in raw_metrics:
        if not isinstance(item, dict):
            continue
        code = str(item.get("metric_code") or "").strip()
        if not code:
            continue
        if code not in values:
            order.append(code)
        values[code] = (
            _numeric_float(item.get("value")),
            _nonnegative_int(item.get("numerator")),
            _nonnegative_int(item.get("denominator")),
        )
    return order, values


def _proportion_ci_for(
    code: str, numerator: int | None, denominator: int | None
) -> GeoConfidenceInterval | None:
    if (
        code in _COUNT_METRIC_CODES
        or numerator is None
        or denominator is None
        or denominator <= 0
        or numerator > denominator
    ):
        return None
    ci = wilson_confidence_interval(numerator, denominator)
    return GeoConfidenceInterval(**asdict(ci)) if ci is not None else None


def _extract_comparison_deltas(
    decision: GeoOpportunityDecision | None,
    target_metrics: GeoInterventionTargetMetrics,
) -> tuple[bool | None, list[str], list[GeoInterventionMetricDeltaOut]]:
    """按真实 R6 GeoRetestComparison 结构提取可比性原因、前后指标差值及 95% 统计置信区间。"""
    if decision is None or not isinstance(decision.comparison_snapshot, dict):
        return None, [], []
    snap: dict[str, Any] = decision.comparison_snapshot
    raw_comparable = snap.get("comparable")
    comparable = raw_comparable if isinstance(raw_comparable, bool) else None

    reasons: list[str] = []
    seen_reasons: set[str] = set()
    raw_diffs = snap.get("differences")
    if isinstance(raw_diffs, list):
        for diff in raw_diffs:
            if isinstance(diff, dict):
                code = diff.get("code")
                if isinstance(code, str) and code and code not in seen_reasons:
                    seen_reasons.add(code)
                    reasons.append(code)
    recovery = snap.get("recovery")
    if isinstance(recovery, dict):
        rec_reasons = recovery.get("reasons")
        if isinstance(rec_reasons, list):
            for reason in rec_reasons:
                if isinstance(reason, str) and reason and reason not in seen_reasons:
                    seen_reasons.add(reason)
                    reasons.append(reason)

    b_order, b_map = _window_metric_map(snap.get("baseline"))
    r_order, r_map = _window_metric_map(snap.get("retest"))
    ordered_codes = list(b_order)
    for code in r_order:
        if code not in b_map:
            ordered_codes.append(code)

    deltas: list[GeoInterventionMetricDeltaOut] = []
    for code in ordered_codes:
        bf, b_num, b_den = b_map.get(code, (None, None, None))
        rf, r_num, r_den = r_map.get(code, (None, None, None))
        df = round(rf - bf, 6) if (bf is not None and rf is not None) else None
        target_field = _POSITIVE_TARGET_METRIC_MAP.get(code)
        tf = getattr(target_metrics, target_field, None) if target_field else None
        target_met = (rf >= tf) if (rf is not None and tf is not None) else None
        baseline_ci = _proportion_ci_for(code, b_num, b_den)
        retest_ci = _proportion_ci_for(code, r_num, r_den)
        delta_ci: GeoDeltaConfidenceInterval | None = None
        if (
            baseline_ci is not None
            and retest_ci is not None
            and b_num is not None
            and b_den is not None
            and r_num is not None
            and r_den is not None
        ):
            diff_ci = newcombe_wilson_diff_ci(b_num, b_den, r_num, r_den)
            if diff_ci is not None:
                delta_ci = GeoDeltaConfidenceInterval(**asdict(diff_ci))
        deltas.append(
            GeoInterventionMetricDeltaOut(
                metric_code=code,
                baseline_value=bf,
                retest_value=rf,
                delta=df,
                target_value=tf,
                target_met=target_met,
                baseline_sample_size=b_den,
                retest_sample_size=r_den,
                baseline_ci=baseline_ci,
                retest_ci=retest_ci,
                delta_ci=delta_ci,
            )
        )
    return comparable, reasons, deltas


def _project_geo_interventions(
    db: Session, rows: list[GeoIntervention]
) -> list[GeoInterventionOut]:
    """批量组装 GEO 干预详情与显式非强因果归因证据，避免列表 N+1 查询。"""
    if not rows:
        return []

    opp_ids = {row.opportunity_id for row in rows}
    campaign_ids = {row.campaign_id for row in rows if row.campaign_id is not None}
    assignee_ids = {row.assignee_id for row in rows if row.assignee_id is not None}
    explicit_decision_ids = {row.decision_id for row in rows if row.decision_id is not None}
    explicit_baseline_ids = {row.baseline_id for row in rows if row.baseline_id is not None}

    opps_by_id = {
        opp.id: opp
        for opp in db.scalars(select(GeoOpportunity).where(GeoOpportunity.id.in_(opp_ids)))
    }
    campaigns_by_id = (
        {
            camp.id: camp
            for camp in db.scalars(
                select(ContentCampaign).where(ContentCampaign.id.in_(campaign_ids))
            )
        }
        if campaign_ids
        else {}
    )
    assignees_by_id = (
        {
            user.id: user
            for user in db.scalars(select(User).where(User.id.in_(assignee_ids)))
        }
        if assignee_ids
        else {}
    )

    actions_by_opp: dict[uuid.UUID, list[GeoOpportunityAction]] = defaultdict(list)
    for act in db.scalars(
        select(GeoOpportunityAction)
        .where(GeoOpportunityAction.opportunity_id.in_(opp_ids))
        .order_by(GeoOpportunityAction.created_at.desc(), GeoOpportunityAction.id.desc())
    ):
        actions_by_opp[act.opportunity_id].append(act)

    # 批量加载同 Campaign + 同 QueryTopic 的内容任务
    campaign_topic_pairs = {
        (row.campaign_id, opps_by_id[row.opportunity_id].query_topic_id)
        for row in rows
        if row.campaign_id is not None
        and row.opportunity_id in opps_by_id
        and opps_by_id[row.opportunity_id].query_topic_id is not None
    }
    tasks_by_camp_topic: dict[tuple[uuid.UUID, uuid.UUID], set[uuid.UUID]] = defaultdict(set)
    if campaign_topic_pairs:
        cids = {pair[0] for pair in campaign_topic_pairs}
        tids = {pair[1] for pair in campaign_topic_pairs}
        for task_id, cid, tid in db.execute(
            select(ContentTask.id, ContentTask.campaign_id, ContentTask.query_topic_id).where(
                ContentTask.campaign_id.in_(cids),
                ContentTask.query_topic_id.in_(tids),
            )
        ).tuples():
            if cid is not None and tid is not None and (cid, tid) in campaign_topic_pairs:
                tasks_by_camp_topic[(cid, tid)].add(task_id)

    task_ids_per_row: dict[uuid.UUID, list[uuid.UUID]] = {}
    all_task_ids: set[uuid.UUID] = set()
    for row in rows:
        opp = opps_by_id.get(row.opportunity_id)
        if opp is None:
            raise AppError("GEO_INTERVENTION_CONTEXT_INCOMPLETE", "关联 GEO 机会不存在", 409)
        tset: set[uuid.UUID] = {
            act.target_id
            for act in actions_by_opp[row.opportunity_id]
            if act.target_type == "ContentTask" and act.target_id is not None
        }
        if row.campaign_id is not None and opp.query_topic_id is not None:
            tset.update(tasks_by_camp_topic.get((row.campaign_id, opp.query_topic_id), set()))
        sorted_tids = sorted(tset)
        task_ids_per_row[row.id] = sorted_tids
        all_task_ids.update(sorted_tids)

    articles_by_task: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    if all_task_ids:
        for task_id, art_id in db.execute(
            select(PublicationWork.content_task_id, PublishedArticle.id)
            .join(PublishedArticle, PublishedArticle.id == PublicationWork.id)
            .where(PublicationWork.content_task_id.in_(all_task_ids))
            .order_by(PublishedArticle.id.asc())
        ).tuples():
            articles_by_task[task_id].append(art_id)

    # 批量加载显式决策与按 opportunity 最新决策
    decisions_by_id = (
        {
            dec_row.id: dec_row
            for dec_row in db.scalars(
                select(GeoOpportunityDecision).where(
                    GeoOpportunityDecision.id.in_(explicit_decision_ids)
                )
            )
        }
        if explicit_decision_ids
        else {}
    )
    fallback_decision_opps = {row.opportunity_id for row in rows if row.decision_id is None}
    latest_decision_by_opp: dict[uuid.UUID, GeoOpportunityDecision] = {}
    if fallback_decision_opps:
        for dec_row in db.scalars(
            select(GeoOpportunityDecision)
            .where(GeoOpportunityDecision.opportunity_id.in_(fallback_decision_opps))
            .order_by(GeoOpportunityDecision.created_at.desc(), GeoOpportunityDecision.id.desc())
        ):
            latest_decision_by_opp.setdefault(dec_row.opportunity_id, dec_row)

    resolved_decision_per_row: dict[uuid.UUID, GeoOpportunityDecision | None] = {}
    needed_baseline_ids = set(explicit_baseline_ids)
    fallback_baseline_opps: set[uuid.UUID] = set()
    for row in rows:
        resolved_dec: GeoOpportunityDecision | None = (
            decisions_by_id.get(row.decision_id)
            if row.decision_id is not None
            else latest_decision_by_opp.get(row.opportunity_id)
        )
        resolved_decision_per_row[row.id] = resolved_dec
        if row.baseline_id is None:
            if resolved_dec is not None and resolved_dec.baseline_id is not None:
                needed_baseline_ids.add(resolved_dec.baseline_id)
            else:
                fallback_baseline_opps.add(row.opportunity_id)

    baselines_by_id = (
        {
            base_row.id: base_row
            for base_row in db.scalars(
                select(GeoRetestBaseline).where(GeoRetestBaseline.id.in_(needed_baseline_ids))
            )
        }
        if needed_baseline_ids
        else {}
    )
    latest_baseline_by_opp: dict[uuid.UUID, GeoRetestBaseline] = {}
    if fallback_baseline_opps:
        for base_row in db.scalars(
            select(GeoRetestBaseline)
            .where(GeoRetestBaseline.opportunity_id.in_(fallback_baseline_opps))
            .order_by(GeoRetestBaseline.created_at.desc(), GeoRetestBaseline.id.desc())
        ):
            latest_baseline_by_opp.setdefault(base_row.opportunity_id, base_row)

    all_batch_ids: set[uuid.UUID] = set()
    resolved_batches_per_row: dict[uuid.UUID, tuple[uuid.UUID | None, uuid.UUID | None]] = {}
    for row in rows:
        row_dec = resolved_decision_per_row[row.id]
        resolved_base: GeoRetestBaseline | None
        if row.baseline_id is not None:
            resolved_base = baselines_by_id.get(row.baseline_id)
        elif row_dec is not None and row_dec.baseline_id is not None:
            resolved_base = baselines_by_id.get(row_dec.baseline_id)
        else:
            resolved_base = latest_baseline_by_opp.get(row.opportunity_id)
        b_bid: uuid.UUID | None = (
            resolved_base.baseline_batch_id if resolved_base is not None else None
        )
        r_bid: uuid.UUID | None = row_dec.retest_batch_id if row_dec is not None else None
        resolved_batches_per_row[row.id] = (b_bid, r_bid)
        if b_bid is not None:
            all_batch_ids.add(b_bid)
        if r_bid is not None:
            all_batch_ids.add(r_bid)

    batch_counts = _batch_run_counts_map(db, all_batch_ids)

    results: list[GeoInterventionOut] = []
    for row in rows:
        opp = opps_by_id[row.opportunity_id]
        campaign = campaigns_by_id.get(row.campaign_id) if row.campaign_id is not None else None
        assignee = assignees_by_id.get(row.assignee_id) if row.assignee_id is not None else None
        target_metrics = GeoInterventionTargetMetrics.model_validate(row.target_metrics or {})
        linked_actions = [
            GeoInterventionLinkedActionOut(
                action_id=act.id,
                action_type=act.action_type,
                target_type=act.target_type,
                target_id=act.target_id,
                status_snapshot=act.status_snapshot,
                created_at=act.created_at,
            )
            for act in actions_by_opp[row.opportunity_id]
        ]
        linked_task_ids = task_ids_per_row[row.id]
        linked_article_ids = sorted(
            {aid for tid in linked_task_ids for aid in articles_by_task.get(tid, ())}
        )
        item_dec = resolved_decision_per_row[row.id]
        item_b_bid, item_r_bid = resolved_batches_per_row[row.id]
        b_total, b_done = (
            batch_counts.get(item_b_bid, (0, 0)) if item_b_bid is not None else (0, 0)
        )
        r_total, r_done = (
            batch_counts.get(item_r_bid, (0, 0)) if item_r_bid is not None else (0, 0)
        )
        combined_total = b_total + r_total
        combined_done = b_done + r_done
        missing_data_rate = (
            round(1.0 - (combined_done / combined_total), 4) if combined_total > 0 else None
        )
        comparable, comp_reasons, metric_deltas = _extract_comparison_deltas(
            item_dec, target_metrics
        )

        results.append(
            GeoInterventionOut(
                id=row.id,
                opportunity_id=row.opportunity_id,
                opportunity_rule_code=opp.rule_code,
                opportunity_status=opp.status,
                campaign_id=row.campaign_id,
                campaign_name=campaign.name if campaign is not None else None,
                title=row.title,
                hypothesis=row.hypothesis,
                planned_action_type=row.planned_action_type,
                target_metrics=target_metrics,
                status=row.status,
                outcome_verdict=row.outcome_verdict,
                causal_claim="NOT_ESTABLISHED",
                baseline_id=row.baseline_id,
                decision_id=row.decision_id,
                assignee_id=row.assignee_id,
                assignee_display_name=assignee.display_name if assignee is not None else None,
                intervened_at=row.intervened_at,
                retest_window_start=row.retest_window_start,
                retest_window_end=row.retest_window_end,
                concluded_at=row.concluded_at,
                conclusion_note=row.conclusion_note,
                revision=row.revision,
                created_by=row.created_by,
                updated_by=row.updated_by,
                created_at=row.created_at,
                updated_at=row.updated_at,
                available_actions=_available_actions(row.status),
                attribution=GeoInterventionAttributionOut(
                    causal_claim="NOT_ESTABLISHED",
                    comparable=comparable,
                    comparability_reasons=comp_reasons,
                    baseline_batch_id=item_b_bid,
                    retest_batch_id=item_r_bid,
                    baseline_sample_count=b_total,
                    baseline_completed_run_count=b_done,
                    retest_sample_count=r_total,
                    retest_completed_run_count=r_done,
                    missing_data_rate=missing_data_rate,
                    metric_deltas=metric_deltas,
                    linked_actions=linked_actions,
                    linked_content_task_ids=linked_task_ids,
                    linked_published_article_ids=linked_article_ids,
                ),
            )
        )
    return results


def project_geo_intervention(db: Session, row: GeoIntervention) -> GeoInterventionOut:
    """投影单条 GEO 干预详情与显式非强因果归因证据。"""
    return _project_geo_interventions(db, [row])[0]


def list_geo_interventions(
    db: Session,
    *,
    campaign_id: uuid.UUID | None,
    opportunity_id: uuid.UUID | None,
    status: str | None,
    assignee_id: uuid.UUID | None,
    page: int,
    page_size: int,
) -> GeoInterventionListPage:
    stmt = select(GeoIntervention)
    count_stmt = select(func.count()).select_from(GeoIntervention)
    if campaign_id is not None:
        stmt = stmt.where(GeoIntervention.campaign_id == campaign_id)
        count_stmt = count_stmt.where(GeoIntervention.campaign_id == campaign_id)
    if opportunity_id is not None:
        stmt = stmt.where(GeoIntervention.opportunity_id == opportunity_id)
        count_stmt = count_stmt.where(GeoIntervention.opportunity_id == opportunity_id)
    if status is not None:
        stmt = stmt.where(GeoIntervention.status == status)
        count_stmt = count_stmt.where(GeoIntervention.status == status)
    if assignee_id is not None:
        stmt = stmt.where(GeoIntervention.assignee_id == assignee_id)
        count_stmt = count_stmt.where(GeoIntervention.assignee_id == assignee_id)

    total = int(db.scalar(count_stmt) or 0)
    rows = list(
        db.scalars(
            stmt.order_by(GeoIntervention.updated_at.desc(), GeoIntervention.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return GeoInterventionListPage(
        items=_project_geo_interventions(db, rows),
        total=total,
        page=page,
        page_size=page_size,
    )


def get_geo_intervention_detail(
    db: Session, intervention_id: uuid.UUID
) -> GeoInterventionOut:
    row = db.get(GeoIntervention, intervention_id)
    if row is None:
        raise not_found("GEO 干预")
    return project_geo_intervention(db, row)
