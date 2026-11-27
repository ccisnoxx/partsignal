"""Slice 4C：统一多币种 AI 作业与运营费用 SQL 汇总及单位经济学服务。"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ai_generation import GenerationJob
from app.models.content import ContentTask
from app.models.content_quality import ContentQualityCheckJob
from app.models.cost_accounting import OperatingCostEntry
from app.schemas.operations_dashboard import (
    CostSampleCoverageOut,
    CurrencyCostBreakdownOut,
    UnitEconomicsByCurrencyOut,
)
from app.services.operations_content_metrics import ratio

ZERO = Decimal("0")
SIX_DP = Decimal("0.000001")


def _unit_cost(amount: Decimal, denominator: int) -> Decimal | None:
    if denominator <= 0:
        return None
    return (amount / Decimal(denominator)).quantize(SIX_DP, rounding=ROUND_HALF_UP)


def compute_unified_costs(
    db: Session,
    *,
    campaign_id: uuid.UUID | None,
    geo_run_costs: list[tuple[Decimal | None, str | None]],
    since: datetime,
    now: datetime,
    approved_count: int,
    published_count: int,
    resolved_opportunities: int,
) -> tuple[
    CostSampleCoverageOut,
    list[CurrencyCostBreakdownOut],
    list[UnitEconomicsByCurrencyOut],
]:
    """按统一窗口 [since, now] 与单一币种 SQL 汇总 AI 与运营费用（严禁跨币种混加与假 0）。"""
    buckets: dict[str, dict[str, Decimal]] = defaultdict(
        lambda: {
            "gen": ZERO,
            "sem": ZERO,
            "geo": ZERO,
            "labor": ZERO,
            "ext": ZERO,
            "other": ZERO,
        }
    )

    gen_ts = func.coalesce(GenerationJob.finished_at, GenerationJob.created_at)
    gen_stmt = select(
        GenerationJob.cost_currency,
        func.count().label("cnt"),
        func.coalesce(func.sum(GenerationJob.cost_amount), ZERO).label("amt"),
    ).where(
        GenerationJob.status == "SUCCEEDED",
        gen_ts >= since,
        gen_ts <= now,
    )
    if campaign_id is not None:
        gen_stmt = gen_stmt.join(
            ContentTask, ContentTask.id == GenerationJob.content_task_id
        ).where(ContentTask.campaign_id == campaign_id)

    total_ai = 0
    priced_ai = 0
    for curr, cnt, amt in db.execute(gen_stmt.group_by(GenerationJob.cost_currency)).tuples():
        count_i = int(cnt or 0)
        total_ai += count_i
        if curr is not None:
            priced_ai += count_i
            buckets[curr]["gen"] += amt or ZERO

    sem_ts = func.coalesce(
        ContentQualityCheckJob.finished_at, ContentQualityCheckJob.created_at
    )
    sem_stmt = select(
        ContentQualityCheckJob.cost_currency,
        func.count().label("cnt"),
        func.coalesce(func.sum(ContentQualityCheckJob.cost_amount), ZERO).label("amt"),
    ).where(
        ContentQualityCheckJob.status == "SUCCEEDED",
        sem_ts >= since,
        sem_ts <= now,
    )
    if campaign_id is not None:
        sem_stmt = sem_stmt.join(
            ContentTask, ContentTask.id == ContentQualityCheckJob.content_task_id
        ).where(ContentTask.campaign_id == campaign_id)

    for curr, cnt, amt in db.execute(
        sem_stmt.group_by(ContentQualityCheckJob.cost_currency)
    ).tuples():
        count_i = int(cnt or 0)
        total_ai += count_i
        if curr is not None:
            priced_ai += count_i
            buckets[curr]["sem"] += amt or ZERO

    total_geo = len(geo_run_costs)
    priced_geo = 0
    for amt, curr in geo_run_costs:
        if amt is not None and curr is not None:
            priced_geo += 1
            buckets[curr]["geo"] += amt

    # incurred_on 为无时区日历日期，按 UTC+14 取当日上界：
    # 既覆盖东八区 00:00-08:00 当日录入，又排除未来排期费用。
    max_incurred_date = (now + timedelta(hours=14)).date()
    op_stmt = select(
        OperatingCostEntry.currency,
        OperatingCostEntry.category,
        func.coalesce(func.sum(OperatingCostEntry.amount), ZERO).label("amt"),
    ).where(
        OperatingCostEntry.voided_at.is_(None),
        OperatingCostEntry.incurred_on >= since.date(),
        OperatingCostEntry.incurred_on <= max_incurred_date,
    )
    if campaign_id is not None:
        op_stmt = op_stmt.where(OperatingCostEntry.campaign_id == campaign_id)

    for curr, category, amt in db.execute(
        op_stmt.group_by(OperatingCostEntry.currency, OperatingCostEntry.category)
    ).tuples():
        if category == "LABOR":
            buckets[curr]["labor"] += amt
        elif category == "EXTERNAL_PLACEMENT":
            buckets[curr]["ext"] += amt
        else:
            buckets[curr]["other"] += amt

    unpriced_ai = total_ai - priced_ai
    coverage = CostSampleCoverageOut(
        total_ai_jobs=total_ai,
        priced_ai_jobs=priced_ai,
        unpriced_ai_jobs=unpriced_ai,
        missing_price_rate=ratio(unpriced_ai, total_ai),
        total_geo_runs=total_geo,
        priced_geo_runs=priced_geo,
        missing_geo_price_rate=ratio(total_geo - priced_geo, total_geo),
    )

    breakdowns: list[CurrencyCostBreakdownOut] = []
    unit_economics: list[UnitEconomicsByCurrencyOut] = []
    for currency in sorted(buckets.keys()):
        row = buckets[currency]
        total_ai_cost = row["gen"] + row["sem"] + row["geo"]
        total_op_cost = row["labor"] + row["ext"] + row["other"]
        total_cost = total_ai_cost + total_op_cost
        breakdowns.append(
            CurrencyCostBreakdownOut(
                currency=currency,
                ai_generation_cost=row["gen"],
                ai_semantic_check_cost=row["sem"],
                geo_collection_cost=row["geo"],
                labor_cost=row["labor"],
                external_placement_cost=row["ext"],
                other_operating_cost=row["other"],
                total_ai_cost=total_ai_cost,
                total_operating_cost=total_op_cost,
                total_cost=total_cost,
            )
        )
        unit_economics.append(
            UnitEconomicsByCurrencyOut(
                currency=currency,
                cost_per_approved_content=_unit_cost(total_cost, approved_count),
                cost_per_published_article=_unit_cost(total_cost, published_count),
                cost_per_geo_sample=_unit_cost(row["geo"], total_geo),
                cost_per_resolved_opportunity=_unit_cost(total_cost, resolved_opportunities),
            )
        )
    return coverage, breakdowns, unit_economics
