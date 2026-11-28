"""Slice 1D：领导效果看板纯统计与分桶计算模块（零数据库 I/O）。"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from app.schemas.geo_leadership_dashboard import (
    GeoDiffCiOut,
    GeoRateCiOut,
    GeoRateMetricOut,
    GeoTrendBucketOut,
)
from app.services.geo_statistics import newcombe_wilson_diff_ci, wilson_confidence_interval


@dataclass(frozen=True)
class EffectiveRunFacts:
    """单次运行应用最新人工复核修正后的权威业务事实。"""

    run_id: UUID
    effective_at: datetime
    status: str
    entry_kind: str
    is_backfill: bool
    prompt_variant_id: UUID
    prompt_text: str
    prompt_category: str
    prompt_priority: str
    surface_id: UUID
    platform_name: str
    collection_mode: str
    query_modified: bool
    citation_observation_status: str | None
    mentioned_brand: bool
    mentioned_any_product: bool
    mentioned_product_ids: frozenset[UUID]
    recommended_any_own: bool
    recommendation_unknown: bool
    effective_linked_pub_ids: frozenset[UUID]
    has_pending_candidate_links: bool


def build_rate_metric(
    numerator: int,
    denominator: int,
    *,
    prev_numerator: int = 0,
    prev_denominator: int = 0,
) -> GeoRateMetricOut:
    """按严格分子分母构建比率卡，保留 95% Wilson 区间与 Newcombe-Wilson 百分点差值区间。"""
    rate = round(numerator / denominator, 6) if denominator > 0 else None
    ci = wilson_confidence_interval(numerator, denominator)
    prev_rate = round(prev_numerator / prev_denominator, 6) if prev_denominator > 0 else None
    delta_pp = (
        round((rate - prev_rate) * 100.0, 2)
        if rate is not None and prev_rate is not None
        else None
    )
    diff_ci = (
        newcombe_wilson_diff_ci(prev_numerator, prev_denominator, numerator, denominator)
        if denominator > 0 and prev_denominator > 0
        else None
    )
    return GeoRateMetricOut(
        numerator=numerator,
        denominator=denominator,
        rate=rate,
        ci_95=(
            GeoRateCiOut(lower=ci.lower, upper=ci.upper, sample_size=ci.sample_size)
            if ci is not None
            else None
        ),
        previous_numerator=prev_numerator,
        previous_denominator=prev_denominator,
        previous_rate=prev_rate,
        delta_pp=delta_pp,
        delta_ci_95=(
            GeoDiffCiOut(
                lower_pp=round(diff_ci.lower * 100.0, 2),
                upper_pp=round(diff_ci.upper * 100.0, 2),
                excludes_zero=diff_ci.excludes_zero,
            )
            if diff_ci is not None
            else None
        ),
    )


def run_mentions_target(
    run: EffectiveRunFacts, *, product_id: UUID | None
) -> bool:
    """双视角自然提及判定：公司总览取 OWN_BRAND ∪ OWN_PRODUCT，单产品严格取该产品。"""
    if product_id is not None:
        return product_id in run.mentioned_product_ids
    return run.mentioned_brand or run.mentioned_any_product


def run_citation_judgeable(run: EffectiveRunFacts) -> bool:
    """PARTIAL 与 UNKNOWN 引用状态不得被强行算作未引用，仅 COMPLETE / NONE 或已有生效归因可判定。"""
    if run.effective_linked_pub_ids:
        return True
    return run.citation_observation_status in {"COMPLETE", "NONE"}


def bucket_key_and_label(
    dt: datetime, granularity: Literal["DAY", "WEEK"], tz_name: str
) -> tuple[str, str]:
    local_dt = dt.astimezone(ZoneInfo(tz_name))
    if granularity == "WEEK":
        iso_year, iso_week, _ = local_dt.isocalendar()
        key = f"{iso_year}-W{iso_week:02d}"
        return key, f"{iso_year} 第{iso_week:02d}周"
    key = local_dt.strftime("%Y-%m-%d")
    return key, local_dt.strftime("%m-%d")


def enumerate_buckets(
    period_from: datetime,
    period_to: datetime,
    granularity: Literal["DAY", "WEEK"],
    tz_name: str,
) -> list[tuple[str, str]]:
    """按自然日或自然周生成连续分桶，无样本桶返回 null，绝不补 0。"""
    tz = ZoneInfo(tz_name)
    cur = period_from.astimezone(tz)
    end = period_to.astimezone(tz)
    seen: set[str] = set()
    ordered: list[tuple[str, str]] = []
    step = timedelta(days=1)
    while cur < end:
        key, label = bucket_key_and_label(cur, granularity, tz_name)
        if key not in seen:
            seen.add(key)
            ordered.append((key, label))
        cur += step
    if not ordered:
        key, label = bucket_key_and_label(period_from.astimezone(UTC), granularity, tz_name)
        ordered.append((key, label))
    return ordered


def build_trend_series(
    *,
    period_from: datetime,
    period_to: datetime,
    granularity: Literal["DAY", "WEEK"],
    tz_name: str,
    core_completed_runs: Sequence[EffectiveRunFacts],
    product_id: UUID | None,
) -> list[GeoTrendBucketOut]:
    buckets = enumerate_buckets(period_from, period_to, granularity, tz_name)
    mention_num: dict[str, int] = defaultdict(int)
    mention_den: dict[str, int] = defaultdict(int)
    cit_num: dict[str, int] = defaultdict(int)
    cit_den: dict[str, int] = defaultdict(int)

    for run in core_completed_runs:
        key, _ = bucket_key_and_label(run.effective_at, granularity, tz_name)
        mention_den[key] += 1
        if run_mentions_target(run, product_id=product_id):
            mention_num[key] += 1
        if run_citation_judgeable(run):
            cit_den[key] += 1
            if run.effective_linked_pub_ids:
                cit_num[key] += 1

    series: list[GeoTrendBucketOut] = []
    for key, label in buckets:
        md = mention_den[key]
        mn = mention_num[key]
        cd = cit_den[key]
        cn = cit_num[key]
        series.append(
            GeoTrendBucketOut(
                bucket_key=key,
                label=label,
                mention_numerator=mn,
                mention_denominator=md,
                natural_mention_rate=round(mn / md, 6) if md > 0 else None,
                citation_numerator=cn,
                citation_denominator=cd,
                citation_hit_rate=round(cn / cd, 6) if cd > 0 else None,
            )
        )
    return series


def apply_review_overrides(
    *,
    subjects_snapshot: list[dict[str, Any]],
    machine_mentioned_subject_ids: set[UUID],
    machine_recommendations: dict[UUID, str],
    correction_payload: dict[str, Any] | None,
) -> tuple[bool, bool, frozenset[UUID], bool, bool]:
    """将最新人工复核修正覆盖到机器结果之上，返回有效提及与推荐事实。"""
    mentioned_ids = set(machine_mentioned_subject_ids)
    recs = dict(machine_recommendations)
    if correction_payload:
        for m in correction_payload.get("mentions", []):
            sid = UUID(str(m["subject_id"]))
            if int(m.get("mention_count", 0)) > 0:
                mentioned_ids.add(sid)
            else:
                mentioned_ids.discard(sid)
        for r in correction_payload.get("recommendations", []):
            sid = UUID(str(r["subject_id"]))
            recs[sid] = str(r["recommendation"])

    mentioned_brand = False
    mentioned_prod_ids: set[UUID] = set()
    own_subject_ids: set[UUID] = set()
    for sub in subjects_snapshot:
        sid = UUID(str(sub["id"]))
        stype = str(sub["subject_type"])
        if stype in {"OWN_BRAND", "OWN_PRODUCT"}:
            own_subject_ids.add(sid)
        if sid in mentioned_ids:
            if stype == "OWN_BRAND":
                mentioned_brand = True
            elif stype == "OWN_PRODUCT" and sub.get("product_id"):
                mentioned_prod_ids.add(UUID(str(sub["product_id"])))

    recommended_own = any(recs.get(sid) == "RECOMMENDED" for sid in own_subject_ids)
    rec_unknown = any(recs.get(sid) == "UNKNOWN" for sid in own_subject_ids)
    return (
        mentioned_brand,
        bool(mentioned_prod_ids),
        frozenset(mentioned_prod_ids),
        recommended_own,
        rec_unknown,
    )
