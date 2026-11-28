"""Slice 1D：领导效果看板主聚合服务（单次 REPEATABLE READ 快照）。"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.articles import Article, ArticlePublication
from app.models.geo_answers import GeoAnswerCitation, GeoAnswerSnapshot
from app.models.geo_citation_links import GeoCitationPublicationLink
from app.models.geo_monitoring_plans import GeoMonitoringPlan, GeoMonitoringPlanPrompt
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.geo_runs import GeoObservationRun
from app.models.product_facts import Product
from app.schemas.geo_leadership_dashboard import (
    GeoArticlePerformanceOut,
    GeoCategorySeparateSummaryOut,
    GeoCoreCoverageCard,
    GeoDataQualityOut,
    GeoFirstCitedCard,
    GeoLeadershipDashboardOut,
    GeoLeadershipSummaryCards,
    GeoMatrixCellOut,
    GeoPlatformComparisonOut,
    GeoQuestionMatrixRowOut,
    GeoRateCiOut,
)
from app.schemas.geo_prompt_variants import GeoPromptCategory
from app.services.geo_leadership_calc import (
    EffectiveRunFacts,
    build_rate_metric,
    build_trend_series,
    run_citation_judgeable,
    run_mentions_target,
)
from app.services.geo_leadership_evidence import load_window_facts
from app.services.geo_statistics import wilson_confidence_interval


def _is_core_natural_eligible(run: EffectiveRunFacts) -> bool:
    return (
        run.status == "COMPLETED"
        and run.prompt_category == "NATURAL_DEMAND"
        and run.entry_kind != "EXPLORATORY"
        and not run.query_modified
    )


def _category_section(
    category: GeoPromptCategory, runs: list[EffectiveRunFacts], product_id: UUID | None
) -> GeoCategorySeparateSummaryOut:
    scoped = [r for r in runs if r.prompt_category == category.value]
    valid = [r for r in scoped if r.status == "COMPLETED"]
    return GeoCategorySeparateSummaryOut(
        category=category,
        total_runs=len(scoped),
        valid_completed_runs=len(valid),
        mention_hit_runs=sum(1 for r in valid if run_mentions_target(r, product_id=product_id)),
        citation_hit_runs=sum(1 for r in valid if r.effective_linked_pub_ids),
        needs_review_runs=sum(1 for r in scoped if r.status == "NEEDS_REVIEW"),
        failed_runs=sum(1 for r in scoped if r.status == "FAILED"),
    )


def get_leadership_dashboard(
    db: Session,
    *,
    period_from: datetime,
    period_to: datetime,
    bucket_granularity: Literal["DAY", "WEEK"] = "DAY",
    product_id: UUID | None = None,
    surface_id: UUID | None = None,
    collection_mode: str | None = None,
    tz_name: str = "Asia/Shanghai",
) -> GeoLeadershipDashboardOut:
    """在单次一致快照中计算领导效果看板全部核心指标、趋势、平台对比、矩阵与文章首引。"""
    if period_to <= period_from:
        raise AppError("VALIDATION_ERROR", "结束时间必须晚于开始时间", 422)
    as_of = db.scalar(select(func.now())) or datetime.now(UTC)
    span = period_to - period_from
    prev_from = period_from - span

    cur_runs = load_window_facts(
        db,
        period_from=period_from,
        period_to=period_to,
        surface_id=surface_id,
        collection_mode=collection_mode,
    )
    prev_runs = load_window_facts(
        db,
        period_from=prev_from,
        period_to=period_from,
        surface_id=surface_id,
        collection_mode=collection_mode,
    )

    cur_core = [r for r in cur_runs if _is_core_natural_eligible(r)]
    prev_core = [r for r in prev_runs if _is_core_natural_eligible(r)]

    # 1. 双视角自然提及率与品牌/产品分项
    nat_num = sum(1 for r in cur_core if run_mentions_target(r, product_id=product_id))
    prev_nat_num = sum(1 for r in prev_core if run_mentions_target(r, product_id=product_id))
    brand_num = sum(1 for r in cur_core if r.mentioned_brand)
    prev_brand_num = sum(1 for r in prev_core if r.mentioned_brand)
    prod_num = sum(
        1
        for r in cur_core
        if (product_id in r.mentioned_product_ids if product_id else r.mentioned_any_product)
    )
    prev_prod_num = sum(
        1
        for r in prev_core
        if (product_id in r.mentioned_product_ids if product_id else r.mentioned_any_product)
    )

    # 2. 文章引用命中率（仅 AUTO_EXACT / CONFIRMED；PARTIAL / UNKNOWN 单独隔离）
    cur_cit_judgeable = [r for r in cur_core if run_citation_judgeable(r)]
    prev_cit_judgeable = [r for r in prev_core if run_citation_judgeable(r)]
    cit_num = sum(1 for r in cur_cit_judgeable if r.effective_linked_pub_ids)
    prev_cit_num = sum(1 for r in prev_cit_judgeable if r.effective_linked_pub_ids)
    cit_unobserved = len(cur_core) - len(cur_cit_judgeable)

    # 3. 推荐率（次级）
    cur_rec_judgeable = [r for r in cur_core if not r.recommendation_unknown]
    prev_rec_judgeable = [r for r in prev_core if not r.recommendation_unknown]
    rec_num = sum(1 for r in cur_rec_judgeable if r.recommended_any_own)
    prev_rec_num = sum(1 for r in prev_rec_judgeable if r.recommended_any_own)
    rec_unknown = len(cur_core) - len(cur_rec_judgeable)

    # 4. 核心问题覆盖
    core_prompt_ids = set(
        db.scalars(
            select(GeoMonitoringPlanPrompt.prompt_variant_id)
            .join(GeoMonitoringPlan, GeoMonitoringPlan.id == GeoMonitoringPlanPrompt.plan_id)
            .join(
                GeoPromptVariant,
                GeoPromptVariant.id == GeoMonitoringPlanPrompt.prompt_variant_id,
            )
            .where(
                GeoMonitoringPlan.plan_role == "CORE_BASELINE",
                GeoMonitoringPlan.status == "ACTIVE",
                GeoPromptVariant.prompt_category == "NATURAL_DEMAND",
            )
        )
    )
    if not core_prompt_ids:
        core_prompt_ids = set(
            db.scalars(
                select(GeoPromptVariant.id).where(
                    GeoPromptVariant.is_active.is_(True),
                    GeoPromptVariant.prompt_category == "NATURAL_DEMAND",
                    GeoPromptVariant.priority == "CORE",
                )
            )
        )
    sampled_core_qs = {
        r.prompt_variant_id for r in cur_core if r.prompt_variant_id in core_prompt_ids
    }
    hit_core_qs = {
        r.prompt_variant_id
        for r in cur_core
        if r.prompt_variant_id in core_prompt_ids and run_mentions_target(r, product_id=product_id)
    }
    total_core_q = len(core_prompt_ids)
    coverage_card = GeoCoreCoverageCard(
        hit_questions=len(hit_core_qs),
        sampled_questions=len(sampled_core_qs),
        total_core_questions=total_core_q,
        unsampled_questions=max(0, total_core_q - len(sampled_core_qs)),
        coverage_rate=round(len(hit_core_qs) / total_core_q, 6) if total_core_q > 0 else None,
    )

    # 5. 文章表现与“系统历史首次被引文章数”
    pub_runs_in_period: dict[UUID, list[UUID]] = defaultdict(list)
    for r in cur_runs:
        if r.status == "COMPLETED":
            for pub_id in r.effective_linked_pub_ids:
                pub_runs_in_period[pub_id].append(r.run_id)

    article_perf: list[GeoArticlePerformanceOut] = []
    first_cited_count = 0
    if pub_runs_in_period:
        pub_ids = list(pub_runs_in_period.keys())
        eff_time = func.coalesce(GeoObservationRun.collected_at, GeoObservationRun.created_at)
        first_seen_rows = db.execute(
            select(
                GeoCitationPublicationLink.article_publication_id,
                func.min(eff_time),
            )
            .join(GeoAnswerCitation, GeoAnswerCitation.id == GeoCitationPublicationLink.citation_id)
            .join(GeoAnswerSnapshot, GeoAnswerSnapshot.id == GeoAnswerCitation.answer_snapshot_id)
            .join(GeoObservationRun, GeoObservationRun.id == GeoAnswerSnapshot.run_id)
            .where(
                GeoCitationPublicationLink.article_publication_id.in_(pub_ids),
                GeoCitationPublicationLink.link_status.in_(["AUTO_EXACT", "CONFIRMED"]),
                GeoObservationRun.status == "COMPLETED",
            )
            .group_by(GeoCitationPublicationLink.article_publication_id)
        ).all()
        first_seen_map: dict[UUID, datetime] = {
            pid: ts for pid, ts in first_seen_rows if ts is not None
        }
        pub_meta = db.execute(
            select(ArticlePublication, Article.title, Article.product_id)
            .join(Article, Article.id == ArticlePublication.article_id)
            .where(ArticlePublication.id.in_(pub_ids))
        ).all()
        for pub, art_title, art_product_id in pub_meta:
            if product_id is not None and art_product_id != product_id:
                continue
            first_at = first_seen_map.get(pub.id) or as_of
            is_first = period_from <= first_at < period_to
            if is_first:
                first_cited_count += 1
            rids = pub_runs_in_period[pub.id]
            article_perf.append(
                GeoArticlePerformanceOut(
                    article_publication_id=pub.id,
                    article_id=pub.article_id,
                    article_title=str(art_title),
                    publication_title=pub.actual_title,
                    platform_name=pub.platform_name_snapshot,
                    final_url=pub.final_url,
                    verification_status=pub.verification_status,
                    cited_run_count=len(rids),
                    first_cited_at=first_at,
                    is_first_cited_in_period=is_first,
                    sample_run_ids=rids[:20],
                )
            )
        article_perf.sort(key=lambda x: (-x.cited_run_count, x.first_cited_at))

    # 6. 分平台对比（不同 collection_mode 分列）
    plat_groups: dict[tuple[UUID, str, str], list[EffectiveRunFacts]] = defaultdict(list)
    for r in cur_runs:
        if (
            r.prompt_category == "NATURAL_DEMAND"
            and r.entry_kind != "EXPLORATORY"
            and not r.query_modified
        ):
            plat_groups[(r.surface_id, r.platform_name, r.collection_mode)].append(r)
    platform_comparisons: list[GeoPlatformComparisonOut] = []
    for (sid, pname, cmode), grp in sorted(plat_groups.items(), key=lambda x: (x[0][1], x[0][2])):
        valid = [r for r in grp if r.status == "COMPLETED"]
        mn = sum(1 for r in valid if run_mentions_target(r, product_id=product_id))
        md = len(valid)
        ci = wilson_confidence_interval(mn, md)
        cj = [r for r in valid if run_citation_judgeable(r)]
        cn = sum(1 for r in cj if r.effective_linked_pub_ids)
        cd = len(cj)
        platform_comparisons.append(
            GeoPlatformComparisonOut(
                surface_id=sid,
                platform_name=pname,
                collection_mode=cmode,
                mention_numerator=mn,
                mention_denominator=md,
                natural_mention_rate=round(mn / md, 6) if md > 0 else None,
                mention_ci_95=(
                    GeoRateCiOut(lower=ci.lower, upper=ci.upper, sample_size=ci.sample_size)
                    if ci is not None
                    else None
                ),
                citation_numerator=cn,
                citation_denominator=cd,
                citation_hit_rate=round(cn / cd, 6) if cd > 0 else None,
                needs_review_count=sum(1 for r in grp if r.status == "NEEDS_REVIEW"),
                failed_count=sum(1 for r in grp if r.status == "FAILED"),
            )
        )

    # 7. 问题 × 平台矩阵
    matrix_surfaces = sorted(
        {(r.surface_id, r.platform_name) for r in cur_runs}, key=lambda x: x[1]
    )
    by_prompt: dict[UUID, list[EffectiveRunFacts]] = defaultdict(list)
    for r in cur_runs:
        if (
            r.prompt_category == "NATURAL_DEMAND"
            and r.entry_kind != "EXPLORATORY"
            and not r.query_modified
        ):
            by_prompt[r.prompt_variant_id].append(r)
    matrix_rows: list[GeoQuestionMatrixRowOut] = []
    for pvid, pruns in sorted(by_prompt.items(), key=lambda x: x[1][0].prompt_text):
        cells: list[GeoMatrixCellOut] = []
        for sid, pname in matrix_surfaces:
            cell_runs = [r for r in pruns if r.surface_id == sid]
            valid = [r for r in cell_runs if r.status == "COMPLETED"]
            cells.append(
                GeoMatrixCellOut(
                    surface_id=sid,
                    platform_name=pname,
                    valid_count=len(valid),
                    mention_hit_count=sum(
                        1 for r in valid if run_mentions_target(r, product_id=product_id)
                    ),
                    citation_hit_count=sum(1 for r in valid if r.effective_linked_pub_ids),
                    needs_review_count=sum(1 for r in cell_runs if r.status == "NEEDS_REVIEW"),
                    failed_count=sum(1 for r in cell_runs if r.status == "FAILED"),
                    run_ids=[r.run_id for r in cell_runs[:30]],
                )
            )
        matrix_rows.append(
            GeoQuestionMatrixRowOut(
                prompt_variant_id=pvid,
                prompt_text=pruns[0].prompt_text,
                prompt_priority=pruns[0].prompt_priority,
                cells=cells,
            )
        )

    # 8. 数据质量与可比性警告
    data_quality = GeoDataQualityOut(
        planned_total=len(cur_runs),
        completed_valid_count=len(cur_core),
        needs_review_count=sum(1 for r in cur_runs if r.status == "NEEDS_REVIEW"),
        pending_count=sum(1 for r in cur_runs if r.status == "PENDING"),
        failed_count=sum(1 for r in cur_runs if r.status == "FAILED"),
        cancelled_count=sum(1 for r in cur_runs if r.status == "CANCELLED"),
        query_modified_excluded_count=sum(1 for r in cur_runs if r.query_modified),
        exploratory_excluded_count=sum(1 for r in cur_runs if r.entry_kind == "EXPLORATORY"),
        backfill_count=sum(1 for r in cur_runs if r.is_backfill),
        citation_partial_or_unknown_count=cit_unobserved,
        pending_candidate_links_count=sum(1 for r in cur_runs if r.has_pending_candidate_links),
    )
    warnings: list[str] = []
    if len({r.collection_mode for r in cur_core}) > 1:
        warnings.append("当前区间包含多种采集入口（如人工与 API），请分平台入口解读而非直接混算。")
    if coverage_card.unsampled_questions > 0:
        warnings.append(
            f"固定核心问题尚有 {coverage_card.unsampled_questions} 个未完成采样，"
            "未查不能解释为确定无效果。"
        )
    if data_quality.needs_review_count > 0:
        warnings.append(
            f"当前有 {data_quality.needs_review_count} 条待判断样本尚未计入有效分母，"
            "确认后将实时更新。"
        )
    if 0 < len(cur_core) < 5:
        warnings.append("当前区间有效样本量偏小（<5），百分比波动仅供观察。")

    selected_prod_label: str | None = None
    if product_id is not None:
        prod = db.get(Product, product_id)
        if prod is not None:
            selected_prod_label = f"{prod.brand} {prod.part_number}"

    summary_cards = GeoLeadershipSummaryCards(
        perspective="SINGLE_PRODUCT" if product_id is not None else "COMPANY",
        selected_product_label=selected_prod_label,
        natural_mention_rate=build_rate_metric(
            nat_num, len(cur_core), prev_numerator=prev_nat_num, prev_denominator=len(prev_core)
        ),
        brand_mention_breakdown=build_rate_metric(
            brand_num,
            len(cur_core),
            prev_numerator=prev_brand_num,
            prev_denominator=len(prev_core),
        ),
        product_mention_breakdown=build_rate_metric(
            prod_num,
            len(cur_core),
            prev_numerator=prev_prod_num,
            prev_denominator=len(prev_core),
        ),
        article_citation_hit_rate=build_rate_metric(
            cit_num,
            len(cur_cit_judgeable),
            prev_numerator=prev_cit_num,
            prev_denominator=len(prev_cit_judgeable),
        ),
        citation_unobserved_count=cit_unobserved,
        core_question_coverage=coverage_card,
        first_cited_articles=GeoFirstCitedCard(
            first_cited_count=first_cited_count,
            total_cited_publications_in_period=len(article_perf),
        ),
        recommendation_rate=build_rate_metric(
            rec_num,
            len(cur_rec_judgeable),
            prev_numerator=prev_rec_num,
            prev_denominator=len(prev_rec_judgeable),
        ),
        recommendation_unknown_count=rec_unknown,
    )

    trend_series = build_trend_series(
        period_from=period_from,
        period_to=period_to,
        granularity=bucket_granularity,
        tz_name=tz_name,
        core_completed_runs=cur_core,
        product_id=product_id,
    )

    return GeoLeadershipDashboardOut(
        as_of=as_of,
        period_from=period_from,
        period_to=period_to,
        bucket_granularity=bucket_granularity,
        comparability_warnings=warnings,
        summary_cards=summary_cards,
        trend_series=trend_series,
        platform_comparisons=platform_comparisons,
        question_platform_matrix=matrix_rows,
        article_performance=article_perf,
        brand_model_section=_category_section(GeoPromptCategory.BRAND_MODEL, cur_runs, product_id),
        article_lookup_section=_category_section(
            GeoPromptCategory.ARTICLE_LOOKUP, cur_runs, product_id
        ),
        data_quality=data_quality,
        evidence_run_ids=[r.run_id for r in cur_runs],
    )
