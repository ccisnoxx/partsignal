"""Slice 1D 单元测试：无分母空桶、双视角自然提及率、95% Wilson/Newcombe 区间与人工复核优先。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.services.geo_leadership_calc import (
    EffectiveRunFacts,
    apply_review_overrides,
    build_rate_metric,
    build_trend_series,
    run_citation_judgeable,
    run_mentions_target,
)


def test_rate_metric_null_when_no_denominator_and_pp_delta_with_ci() -> None:
    empty = build_rate_metric(0, 0)
    assert empty.rate is None
    assert empty.ci_95 is None
    assert empty.delta_pp is None

    improved = build_rate_metric(7, 20, prev_numerator=4, prev_denominator=20)
    assert improved.rate == 0.35
    assert improved.previous_rate == 0.2
    assert improved.delta_pp == 15.0
    assert improved.ci_95 is not None
    assert 0.0 <= improved.ci_95.lower < 0.35 < improved.ci_95.upper <= 1.0
    assert improved.delta_ci_95 is not None


def test_trend_series_preserves_null_gaps_never_fills_zero() -> None:
    start = datetime(2026, 11, 20, 0, 0, tzinfo=UTC)
    end = start + timedelta(days=3)
    run = EffectiveRunFacts(
        run_id=uuid4(),
        effective_at=start + timedelta(hours=10),
        status="COMPLETED",
        entry_kind="PLAN_STANDARD",
        is_backfill=False,
        prompt_variant_id=uuid4(),
        prompt_text="低功耗运放选型",
        prompt_category="NATURAL_DEMAND",
        prompt_priority="CORE",
        surface_id=uuid4(),
        platform_name="豆包",
        collection_mode="MANUAL",
        query_modified=False,
        citation_observation_status="COMPLETE",
        mentioned_brand=True,
        mentioned_any_product=False,
        mentioned_product_ids=frozenset(),
        recommended_any_own=False,
        recommendation_unknown=False,
        effective_linked_pub_ids=frozenset({uuid4()}),
        has_pending_candidate_links=False,
    )
    series = build_trend_series(
        period_from=start,
        period_to=end,
        granularity="DAY",
        tz_name="UTC",
        core_completed_runs=[run],
        product_id=None,
    )
    assert len(series) == 3
    assert series[0].natural_mention_rate == 1.0
    assert series[1].mention_denominator == 0
    assert series[1].natural_mention_rate is None
    assert series[2].citation_hit_rate is None


def test_dual_perspective_and_review_override_precedence() -> None:
    prod_a = uuid4()
    prod_b = uuid4()
    brand_sub = uuid4()
    prod_sub = uuid4()
    subjects = [
        {"id": str(brand_sub), "subject_type": "OWN_BRAND", "product_id": None},
        {"id": str(prod_sub), "subject_type": "OWN_PRODUCT", "product_id": str(prod_a)},
    ]
    # 机器未检出，但人工复核修正为命中产品 A 并推荐
    m_brand, m_any_prod, m_pids, rec_own, rec_unk = apply_review_overrides(
        subjects_snapshot=subjects,
        machine_mentioned_subject_ids=set(),
        machine_recommendations={},
        correction_payload={
            "mentions": [{"subject_id": str(prod_sub), "mention_count": 1}],
            "recommendations": [{"subject_id": str(prod_sub), "recommendation": "RECOMMENDED"}],
        },
    )
    assert m_brand is False
    assert m_any_prod is True
    assert m_pids == frozenset({prod_a})
    assert rec_own is True and rec_unk is False

    fact = EffectiveRunFacts(
        run_id=uuid4(),
        effective_at=datetime.now(UTC),
        status="COMPLETED",
        entry_kind="PLAN_STANDARD",
        is_backfill=False,
        prompt_variant_id=uuid4(),
        prompt_text="Q",
        prompt_category="NATURAL_DEMAND",
        prompt_priority="CORE",
        surface_id=uuid4(),
        platform_name="豆包",
        collection_mode="MANUAL",
        query_modified=False,
        citation_observation_status="PARTIAL",
        mentioned_brand=False,
        mentioned_any_product=True,
        mentioned_product_ids=frozenset({prod_a}),
        recommended_any_own=True,
        recommendation_unknown=False,
        effective_linked_pub_ids=frozenset(),
        has_pending_candidate_links=False,
    )
    assert run_mentions_target(fact, product_id=None) is True
    assert run_mentions_target(fact, product_id=prod_a) is True
    assert run_mentions_target(fact, product_id=prod_b) is False
    # PARTIAL 且无生效引用时不得强制计入引用分母
    assert run_citation_judgeable(fact) is False
