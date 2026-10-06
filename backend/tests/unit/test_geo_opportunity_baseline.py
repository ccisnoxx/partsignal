"""机会基线保存完整合格分母，不只保存异常事件所在运行。"""

from tests.unit.test_geo_opportunity_rules import cohort, results, with_claim
from tests.unit.test_geo_overview import source


def test_critical_baseline_keeps_nonerror_eligible_run_and_its_revision_identity():
    error, accurate = cohort(source(), [True, True])
    inputs = [with_claim(error), with_claim(accurate, verdict="ACCURATE")]
    result = results(inputs, "CRITICAL_FACT_ERROR")[0]
    assert result.triggered and (result.numerator, result.denominator) == (1, 2)
    assert {s.run_id for s in result.sources} == {s.metric.run_id for s in inputs}
    assert {(s.analysis_revision_id, s.review_id) for s in result.sources} == {
        (s.analysis_id, s.review_id) for s in inputs
    }


def test_repeated_baseline_keeps_full_30_day_eligible_set_with_source_period_roles():
    base = source()
    inputs = [with_claim(cohort(base, [True], age=age)[0]) for age in (1, 10, 29)]
    accurate = with_claim(cohort(base, [True], age=2)[0], verdict="ACCURATE")
    result = results(inputs + [accurate], "REPEATED_FACT_ERROR")[0]
    assert result.triggered and (result.numerator, result.denominator) == (3, 4)
    assert {s.run_id for s in result.sources} == {s.metric.run_id for s in inputs + [accurate]}
    assert {s.run_id for s in result.sources if s.source_role == "BASELINE"} == {
        s.metric.run_id for s in inputs[1:]
    }
