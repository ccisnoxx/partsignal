"""GEO-603独立手算窗口金标；环境、集合和样本门禁不能被比例掩盖。"""

from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.services.geo_metric_types import MetricCode, SamplePolicy
from app.services.geo_metric_views import MetricWindow
from app.services.geo_metrics import (
    calculate_metric,
    compare_metric_windows,
    coverage_classification,
)
from tests.unit.geo_metrics_gold import (
    COMPETITOR,
    DIMENSIONS,
    OWN,
    REFERENCE,
    SCOPE,
    observation,
    subject,
)


def result(
    count=5,
    positive=2,
    *,
    window="now",
    code=MetricCode.NATURAL_VISIBILITY,
    dimensions=None,
    scope=SCOPE,
):
    dims = replace(dimensions or DIMENSIONS, window_key=window)
    runs = [
        observation(i + 1, dimensions=dims, subjects=(subject(OWN, i < positive),))
        for i in range(count)
    ]
    return calculate_metric(runs, metric=code, dimensions=dims, scope=scope)


def test_adjacent_equal_window_normalizes_timezones_and_is_half_open():
    current = MetricWindow(
        datetime(2026, 10, 1, tzinfo=timezone(timedelta(hours=8))),
        datetime(2026, 10, 8, tzinfo=timezone(timedelta(hours=8))),
    )
    assert current.date_from == datetime(2026, 9, 30, 16, tzinfo=UTC)
    assert current.previous.date_to == current.date_from
    assert current.previous.date_to - current.previous.date_from == timedelta(days=7)
    for start, end in (
        (datetime(2026, 1, 1), datetime(2026, 1, 2)),
        (current.date_to, current.date_from),
    ):
        with pytest.raises(ValueError):
            MetricWindow(start, end)


def test_change_points_and_relative_change_are_distinct_and_zero_previous_is_null():
    before, now = result(5, 1, window="before"), result(5, 3)
    comparison = compare_metric_windows([now], [before], metric=MetricCode.NATURAL_VISIBILITY)
    assert comparison.change_points == pytest.approx(0.4)
    assert comparison.relative_change == pytest.approx(2)
    assert comparison.unavailable_reasons == ()
    zero = compare_metric_windows(
        [now], [result(5, 0, window="before")], metric=MetricCode.NATURAL_VISIBILITY
    )
    assert zero.change_points == 0.6 and zero.relative_change is None


@pytest.mark.parametrize("side", ["current", "previous"])
def test_each_window_requires_its_own_samples_even_with_many_presence_events(side):
    now, before = result(5, 3), result(5, 1, window="before")
    if side == "current":
        now = result(4, 4)
    else:
        before = result(4, 4, window="before")
    comparison = compare_metric_windows([now], [before], metric=MetricCode.NATURAL_VISIBILITY)
    assert comparison.change_points is comparison.relative_change is None
    assert comparison.unavailable_reasons == ("INSUFFICIENT_SAMPLE",)
    assert comparison.minimum_run_count == 5


def test_competitor_set_change_is_explicit_even_when_values_are_identical():
    code = MetricCode.MENTION_SOV
    before = result(3, 3, code=code, window="before")
    now = result(3, 3, code=code, scope=replace(SCOPE, sov_subject_ids=frozenset({OWN, REFERENCE})))
    comparison = compare_metric_windows([now], [before], metric=code)
    assert now.value == before.value == 1
    assert comparison.unavailable_reasons == ("COMPETITOR_SET_CHANGED",)
    assert comparison.change_points is None
    assert comparison.minimum_run_count == 3


@pytest.mark.parametrize(
    "field,value",
    [
        ("prompt_revision", 1),
        ("profile_revision", 1),
        ("surface_revision", 1),
        ("collection_mode", "MANUAL"),
        ("language_code", "en"),
        ("region_code", "US"),
        ("login_state", "AUTHENTICATED"),
        ("rule_set_version", "v2"),
        ("analysis_configuration_key", "new"),
        ("subject_versions", ((OWN, 1), (COMPETITOR, 0), (REFERENCE, 0))),
        ("fact_version_bindings", ()),
    ],
)
def test_semantic_and_environment_changes_are_not_comparable(field, value):
    now = result(dimensions=replace(DIMENSIONS, **{field: value}))
    comparison = compare_metric_windows(
        [now], [result(window="before")], metric=MetricCode.NATURAL_VISIBILITY
    )
    assert comparison.change_points is None
    assert "DIMENSIONS_CHANGED" in comparison.unavailable_reasons
    assert comparison.changed_dimensions == (field,)


def test_collection_model_versions_may_change_with_explicit_unknown_warning():
    now = result(dimensions=replace(DIMENSIONS, model_version="v2", product_version=None))
    comparison = compare_metric_windows(
        [now], [result(window="before")], metric=MetricCode.NATURAL_VISIBILITY
    )
    assert comparison.change_points == 0
    assert set(comparison.version_warnings) == {
        "MODEL_VERSION_CHANGED",
        "PRODUCT_VERSION_CHANGED",
        "PRODUCT_VERSION_UNKNOWN",
    }
    # 同窗口多个版本不挑最佳或合并。
    mixed = compare_metric_windows(
        [now, result()], [result(window="before")], metric=MetricCode.NATURAL_VISIBILITY
    )
    assert mixed.change_points is None and "MIXED_DIMENSIONS" in mixed.unavailable_reasons


@pytest.mark.parametrize(
    "code", [MetricCode.NATURAL_VISIBILITY, MetricCode.MENTION_SOV, MetricCode.RECOMMENDATION_SOV]
)
def test_branded_samples_never_enter_natural_or_sov_denominator(code):
    branded = result(8, 8, dimensions=replace(DIMENSIONS, mention_mode="BRANDED"), code=code)
    assert branded.value is None and branded.eligible_run_count == branded.denominator == 0
    assert branded.excluded_run_count == 8
    comparison = compare_metric_windows([branded], [branded], metric=code)
    assert comparison.change_points is None and "NO_DENOMINATOR" in comparison.unavailable_reasons


@pytest.mark.parametrize(
    "count,positive,classification,reason",
    [
        (0, 0, "DATA_INSUFFICIENT", "INSUFFICIENT_SAMPLE"),
        (2, 2, "DATA_INSUFFICIENT", "INSUFFICIENT_SAMPLE"),
        (3, 0, "NOT_VISIBLE", None),
        (5, 2, "OCCASIONAL", None),
        (5, 3, "STABLE", None),
        (3, 2, None, "INSUFFICIENT_STABLE_SAMPLE"),
    ],
)
def test_coverage_classification_matches_defined_sample_and_rate_boundaries(
    count, positive, classification, reason
):
    assert coverage_classification(result(count, positive)) == (classification, reason)


def test_missing_empty_and_changed_formula_do_not_make_zero_trends():
    assert (
        "MISSING_WINDOW"
        in compare_metric_windows(
            [result()], [], metric=MetricCode.NATURAL_VISIBILITY
        ).unavailable_reasons
    )
    assert (
        "NO_DENOMINATOR"
        in compare_metric_windows(
            [result(0, 0)], [result()], metric=MetricCode.NATURAL_VISIBILITY
        ).unavailable_reasons
    )
    old = replace(result(window="before"), formula_version="old")
    assert (
        "FORMULA_CHANGED"
        in compare_metric_windows(
            [result()], [old], metric=MetricCode.NATURAL_VISIBILITY
        ).unavailable_reasons
    )
    custom = compare_metric_windows(
        [result(4, 2)],
        [result(4, 1)],
        metric=MetricCode.NATURAL_VISIBILITY,
        sample_policy=SamplePolicy(2, 4),
    )
    assert custom.change_points == 0.25 and custom.minimum_run_count == 4
