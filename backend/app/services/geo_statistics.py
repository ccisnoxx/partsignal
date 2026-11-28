"""GEO 指标与前后窗口比较的纯统计不确定性计算模块（仅标准库 math，无 I/O）。"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

CONFIDENCE_LEVEL_95: float = 0.95
# 双侧 95% 正态分位数 Phi^{-1}(0.975)
WILSON_Z_95 = 1.959963984540054
_ROUND_DIGITS = 6


@dataclass(frozen=True, slots=True)
class ProportionConfidenceInterval:
    """二项/比率指标的 95% Wilson 置信区间（小样本与 0/1 边界稳健，不越界）。"""

    lower: float
    upper: float
    sample_size: int
    confidence_level: float = CONFIDENCE_LEVEL_95
    method: Literal["WILSON_95"] = "WILSON_95"


@dataclass(frozen=True, slots=True)
class DifferenceConfidenceInterval:
    """两独立窗口比率差（current - baseline）的 95% Newcombe-Wilson 混合区间。"""

    lower: float
    upper: float
    excludes_zero: bool
    confidence_level: float = CONFIDENCE_LEVEL_95
    method: Literal["NEWCOMBE_WILSON_95"] = "NEWCOMBE_WILSON_95"


@dataclass(frozen=True, slots=True)
class CrossRunDispersion:
    """同一 cell 跨合格运行的无偏样本离散度（至少 2 次合格运行才可计算）。"""

    run_count: int
    sample_variance: float
    sample_std_dev: float


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _wilson_bounds_raw(numerator: int, denominator: int) -> tuple[float, float]:
    p = numerator / denominator
    z = WILSON_Z_95
    z2 = z * z
    denom = 1.0 + z2 / denominator
    center = (p + z2 / (2.0 * denominator)) / denom
    half = (z * math.sqrt((p * (1.0 - p) + z2 / (4.0 * denominator)) / denominator)) / denom
    lower = 0.0 if numerator == 0 else _clamp(center - half, 0.0, 1.0)
    upper = 1.0 if numerator == denominator else _clamp(center + half, 0.0, 1.0)
    return lower, upper


def wilson_confidence_interval(
    numerator: int,
    denominator: int,
) -> ProportionConfidenceInterval | None:
    """计算 95% Wilson 得分置信区间；无可用分母返回 None，不伪造区间。"""
    if denominator < 0 or numerator < 0 or numerator > denominator:
        raise ValueError("Wilson 区间要求满足 0 <= numerator <= denominator")
    if denominator == 0:
        return None
    lower_raw, upper_raw = _wilson_bounds_raw(numerator, denominator)
    lower = round(lower_raw, _ROUND_DIGITS)
    upper = round(upper_raw, _ROUND_DIGITS)
    if lower > upper:
        lower = upper
    return ProportionConfidenceInterval(
        lower=_clamp(lower, 0.0, 1.0),
        upper=_clamp(upper, 0.0, 1.0),
        sample_size=denominator,
    )


def newcombe_wilson_diff_ci(
    baseline_numerator: int,
    baseline_denominator: int,
    current_numerator: int,
    current_denominator: int,
) -> DifferenceConfidenceInterval | None:
    """基于 Newcombe (1998) Method 10 计算 p_current - p_baseline 的 95% 差值置信区间。

    excludes_zero 仅表示两窗口差值在 95% 水平上未跨零，不构成因果证明。
    """
    if (
        baseline_denominator < 0
        or baseline_numerator < 0
        or baseline_numerator > baseline_denominator
        or current_denominator < 0
        or current_numerator < 0
        or current_numerator > current_denominator
    ):
        raise ValueError("Newcombe-Wilson 差值区间要求两窗口均满足 0 <= numerator <= denominator")
    if baseline_denominator == 0 or current_denominator == 0:
        return None
    l1, u1 = _wilson_bounds_raw(baseline_numerator, baseline_denominator)
    l2, u2 = _wilson_bounds_raw(current_numerator, current_denominator)
    p1 = baseline_numerator / baseline_denominator
    p2 = current_numerator / current_denominator
    delta = p2 - p1
    lower_delta = math.sqrt((p2 - l2) ** 2 + (u1 - p1) ** 2)
    upper_delta = math.sqrt((u2 - p2) ** 2 + (p1 - l1) ** 2)
    lower = round(_clamp(delta - lower_delta, -1.0, 1.0), _ROUND_DIGITS)
    upper = round(_clamp(delta + upper_delta, -1.0, 1.0), _ROUND_DIGITS)
    if lower > upper:
        lower = upper
    return DifferenceConfidenceInterval(
        lower=lower,
        upper=upper,
        excludes_zero=(lower > 0.0) or (upper < 0.0),
    )


def cross_run_dispersion(run_values: Sequence[float]) -> CrossRunDispersion | None:
    """计算同一 cell 跨运行的无偏样本方差与标准差（ddof=1）；样本少于 2 次返回 None。"""
    count = len(run_values)
    if count < 2:
        return None
    if any(not math.isfinite(value) for value in run_values):
        raise ValueError("跨运行样本值必须全部有限")
    mean = sum(run_values) / count
    variance_raw = sum((value - mean) ** 2 for value in run_values) / (count - 1)
    variance = max(0.0, round(variance_raw, _ROUND_DIGITS))
    std_dev = max(0.0, round(math.sqrt(max(0.0, variance_raw)), _ROUND_DIGITS))
    return CrossRunDispersion(
        run_count=count,
        sample_variance=variance,
        sample_std_dev=std_dev,
    )
