"""GEO 统计置信区间（Wilson 95%、Newcombe-Wilson 差值 95%）、跨运行方差与干预归因测试。"""

from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace
from typing import cast

import pytest

from app.models.geo_opportunity_decisions import GeoOpportunityDecision
from app.schemas.geo_interventions import GeoInterventionTargetMetrics
from app.schemas.geo_retest_comparisons import GeoRetestComparisonMetric
from app.services.geo_intervention_queries import _extract_comparison_deltas
from app.services.geo_metric_types import MetricCode
from app.services.geo_metrics import calculate_metric, compare_metric_windows
from app.services.geo_statistics import (
    cross_run_dispersion,
    newcombe_wilson_diff_ci,
    wilson_confidence_interval,
)
from tests.unit.geo_metrics_gold import DIMENSIONS, OWN, SCOPE, observation, subject


def test_wilson_95_matches_closed_form_reference_values_and_boundaries() -> None:
    assert wilson_confidence_interval(0, 0) is None

    # 3/5 = 0.6 -> Wilson 95%: [0.230724, 0.882382]
    ci_3_5 = wilson_confidence_interval(3, 5)
    assert ci_3_5 is not None
    assert ci_3_5.confidence_level == 0.95
    assert ci_3_5.method == "WILSON_95"
    assert ci_3_5.sample_size == 5
    assert ci_3_5.lower == pytest.approx(0.230724, abs=1e-5)
    assert ci_3_5.upper == pytest.approx(0.882382, abs=1e-5)

    # 0/10 边界：下界精确为 0.0，上界严格大于 0 且 <= 1
    ci_0_10 = wilson_confidence_interval(0, 10)
    assert ci_0_10 is not None
    assert ci_0_10.lower == 0.0
    assert ci_0_10.upper == pytest.approx(0.277533, abs=1e-5)

    # 10/10 边界：上界精确为 1.0，下界严格小于 1
    ci_10_10 = wilson_confidence_interval(10, 10)
    assert ci_10_10 is not None
    assert ci_10_10.upper == 1.0
    assert ci_10_10.lower == pytest.approx(0.722467, abs=1e-5)

    for bad_num, bad_den in ((-1, 5), (6, 5), (0, -1)):
        with pytest.raises(ValueError):
            wilson_confidence_interval(bad_num, bad_den)


def test_newcombe_wilson_diff_ci_separates_real_signal_from_small_sample_noise() -> None:
    assert newcombe_wilson_diff_ci(0, 0, 3, 5) is None
    assert newcombe_wilson_diff_ci(3, 5, 0, 0) is None

    # 小样本 1/5 (20%) -> 3/5 (60%)：差值 +40%，但 95% CI 跨零
    noisy = newcombe_wilson_diff_ci(1, 5, 3, 5)
    assert noisy is not None
    assert noisy.method == "NEWCOMBE_WILSON_95"
    assert noisy.confidence_level == 0.95
    assert noisy.lower < 0.0 < noisy.upper
    assert noisy.excludes_zero is False

    # 充足样本 4/20 (20%) -> 16/20 (80%)：差值 +60%，95% CI 严格大于 0
    separated = newcombe_wilson_diff_ci(4, 20, 16, 20)
    assert separated is not None
    assert separated.lower > 0.0
    assert separated.upper <= 1.0
    assert separated.excludes_zero is True

    # 显著下降 18/20 -> 4/20：差值 -70%，95% CI 严格小于 0
    dropped = newcombe_wilson_diff_ci(18, 20, 4, 20)
    assert dropped is not None
    assert dropped.upper < 0.0
    assert dropped.lower >= -1.0
    assert dropped.excludes_zero is True


def test_cross_run_dispersion_requires_at_least_two_runs_and_uses_unbiased_variance() -> None:
    assert cross_run_dispersion([]) is None
    assert cross_run_dispersion([1.0]) is None

    constant = cross_run_dispersion([1.0, 1.0, 1.0])
    assert constant is not None
    assert (constant.run_count, constant.sample_variance, constant.sample_std_dev) == (3, 0.0, 0.0)

    # [1, 1, 1, 0, 0]: mean=0.6, sum_sq=3*0.16 + 2*0.36 = 1.2, ddof=1 -> var=0.3, std=sqrt(0.3)
    mixed = cross_run_dispersion([1.0, 1.0, 1.0, 0.0, 0.0])
    assert mixed is not None
    assert mixed.run_count == 5
    assert mixed.sample_variance == pytest.approx(0.3, abs=1e-6)
    assert mixed.sample_std_dev == pytest.approx(0.547723, abs=1e-5)


def test_calculate_metric_and_compare_windows_attach_ci_and_dispersion_safely() -> None:
    before_dims = replace(DIMENSIONS, window_key="before")
    now_dims = replace(DIMENSIONS, window_key="now")
    before_runs = [
        observation(i + 1, dimensions=before_dims, subjects=(subject(OWN, i < 1),))
        for i in range(5)
    ]
    now_runs = [
        observation(i + 1, dimensions=now_dims, subjects=(subject(OWN, i < 4),))
        for i in range(5)
    ]
    before = calculate_metric(
        before_runs, metric=MetricCode.NATURAL_VISIBILITY, scope=SCOPE, dimensions=before_dims
    )
    now = calculate_metric(
        now_runs, metric=MetricCode.NATURAL_VISIBILITY, scope=SCOPE, dimensions=now_dims
    )
    assert before.confidence_interval is not None
    assert before.confidence_interval.sample_size == 5
    assert before.cross_run_dispersion is not None
    assert before.cross_run_dispersion.sample_variance == pytest.approx(0.2, abs=1e-6)

    comp = compare_metric_windows([now], [before], metric=MetricCode.NATURAL_VISIBILITY)
    assert comp.unavailable_reasons == ()
    assert comp.delta_confidence_interval is not None
    assert comp.delta_confidence_interval.lower < 0.6 < comp.delta_confidence_interval.upper

    # 非比例指标 AVERAGE_RECOMMENDATION_RANK 不得附带 Wilson 置信区间，但仍保留跨运行方差
    rank_runs = [
        observation(
            i + 1,
            dimensions=now_dims,
            subjects=(subject(OWN, True, recommendation="RECOMMENDED", rank=i + 1),),
        )
        for i in range(3)
    ]
    rank_result = calculate_metric(
        rank_runs, metric=MetricCode.AVERAGE_RECOMMENDATION_RANK, scope=SCOPE, dimensions=now_dims
    )
    assert rank_result.value == pytest.approx(2.0)
    assert rank_result.confidence_interval is None
    assert rank_result.cross_run_dispersion is not None
    assert rank_result.cross_run_dispersion.sample_variance == pytest.approx(1.0, abs=1e-6)


def test_intervention_deltas_ci_from_historical_snapshot_skips_counts() -> None:
    # 模拟迁移前历史 JSONB（metric 条目中无 confidence_interval 字段，仅含 numerator/denominator）
    historical_snapshot = {
        "comparable": True,
        "differences": [],
        "recovery": {"status": "RECOVERED", "reasons": []},
        "baseline": {
            "metrics": [
                {
                    "metric_code": "recommendation_rate",
                    "value": 0.2,
                    "numerator": 4,
                    "denominator": 20,
                },
                {
                    "metric_code": "same_fact_error_count",
                    "value": 3.0,
                    "numerator": 3,
                    "denominator": 5,
                },
            ]
        },
        "retest": {
            "metrics": [
                {
                    "metric_code": "recommendation_rate",
                    "value": 0.8,
                    "numerator": 16,
                    "denominator": 20,
                },
                {
                    "metric_code": "same_fact_error_count",
                    "value": 0.0,
                    "numerator": 0,
                    "denominator": 5,
                },
            ]
        },
    }
    decision = cast(
        GeoOpportunityDecision, SimpleNamespace(comparison_snapshot=historical_snapshot)
    )
    comparable, reasons, deltas = _extract_comparison_deltas(
        decision,
        GeoInterventionTargetMetrics(target_recommendation_rate=0.6),
    )
    assert comparable is True
    assert reasons == []
    assert len(deltas) == 2

    rec = deltas[0]
    assert rec.metric_code == "recommendation_rate"
    assert (rec.baseline_sample_size, rec.retest_sample_size) == (20, 20)
    assert rec.baseline_ci is not None and rec.retest_ci is not None
    assert rec.delta_ci is not None and rec.delta_ci.excludes_zero is True
    assert rec.target_met is True

    # 计数型指标不得伪造比例置信区间，但保留样本分母计数
    cnt = deltas[1]
    assert cnt.metric_code == "same_fact_error_count"
    assert (cnt.baseline_sample_size, cnt.retest_sample_size) == (5, 5)
    assert cnt.baseline_ci is None and cnt.retest_ci is None and cnt.delta_ci is None


def test_retest_comparison_metric_schema_accepts_historical_json_without_ci() -> None:
    parsed = GeoRetestComparisonMetric.model_validate(
        {
            "metric_code": "natural_visibility",
            "formula_version": "geo-answer-v1",
            "value": 0.6,
            "numerator": 3,
            "denominator": 5,
            "candidate_run_count": 5,
            "eligible_run_count": 5,
            "excluded_run_count": 0,
            "sample_level": "STABLE",
            "exclusion_reason_counts": [],
            "unjudgeable_claim_count": 0,
            "dimensions": None,
            "unavailable_reasons": [],
        }
    )
    assert parsed.confidence_interval is None
