"""706 金标：冻结门槛、历史参考、十类规则及未知证据不会产生恢复。"""

from dataclasses import replace
from datetime import timedelta
from uuid import uuid4

import pytest

from app.schemas.geo_opportunities import GeoOpportunityTriggerSnapshot
from app.schemas.geo_retests import GeoRetestBaselineSnapshot
from app.schemas.geo_rules import GeoRuleConfiguration
from app.services.geo_retest_comparison_metrics import metrics
from app.services.geo_retest_recovery import recovery
from tests.unit.test_geo_opportunity_policy import snapshot as trigger
from tests.unit.test_geo_opportunity_rules import FILTERS, cohort, with_citations, with_claim
from tests.unit.test_geo_overview import source
from tests.unit.test_geo_run_contract import plan_snapshot


def frozen(base, code, *, config=None, details=None, legacy=False):
    config = config or GeoRuleConfiguration()
    value = trigger()
    value.update(
        rule_code=code,
        rule_snapshot={
            "schema_version": 1,
            "rule_set_revision": 1,
            "configuration": config.model_dump(mode="json"),
        },
        details=details or {},
    )
    value["scope"].update(
        subject_id=base.snapshot.subjects[0].id,
        prompt_variant_id=base.snapshot.prompt.id,
        collection_profile_id=base.snapshot.profile.id,
    )
    input_value = base.snapshot.model_dump(mode="json")
    return GeoRetestBaselineSnapshot.model_validate(
        {
            "schema_version": 1,
            "opportunity_id": uuid4(),
            "baseline_batch_id": base.metric.batch_id,
            "trigger_snapshot": GeoOpportunityTriggerSnapshot.model_validate(value),
            "plan_snapshot": plan_snapshot(input_value),
            "rule_snapshot": {
                "schema_version": 1 if legacy else 2,
                "rule_set_revision": 1,
                **({} if legacy else {"configuration": config.model_dump(mode="json")}),
            },
            "cells": [
                {
                    "root_run_id": base.metric.run_id,
                    "repeat_index": 1,
                    "input_snapshot": input_value,
                    "answer_snapshot_id": None,
                    "source_product": None,
                    "source_model": None,
                    "source_version": None,
                }
            ],
        }
    )


def judge(freeze, inputs, baseline):
    values, reasons = metrics(inputs, freeze, FILTERS, baseline=baseline)
    return recovery(freeze, values, comparable=True, pending=False, extra_reasons=reasons), values


@pytest.mark.parametrize("code", ["VISIBILITY_DROP", "RECOMMENDATION_DROP", "COMPETITOR_SURGE"])
def test_drop_and_surge_use_previous_trigger_window_not_anomalous_baseline(code):
    base = source()
    metric_code = {
        "VISIBILITY_DROP": "natural_visibility",
        "RECOMMENDATION_DROP": "recommendation_rate",
        "COMPETITOR_SURGE": "recommendation_sov",
    }[code]
    before = cohort(base, [True, True, False, False, False])
    frozen_value = frozen(base, code)
    _, cards = judge(frozen_value, before, before)
    reference = cards[0].model_dump(mode="json")
    reference.update(
        metric_code=metric_code, numerator=5, denominator=5, eligible_run_count=5, value=1.0
    )
    frozen_value.trigger_snapshot.details = {"previous": [reference]}
    # 当前异常值0.4与本次0.4相同，仍不等于旧健康窗口1.0。
    partial, _ = judge(frozen_value, before, before)
    assert partial.status == ("RECOVERED" if code == "COMPETITOR_SURGE" else "NOT_RECOVERED")
    restored, _ = judge(frozen_value, cohort(base, [True] * 5), before)
    assert restored.status == "RECOVERED"
    assert restored.reference_value == 1
    frozen_value.trigger_snapshot.details = {}
    assert judge(frozen_value, cohort(base, [True] * 5), before)[0].status == "UNAVAILABLE"


def test_recovery_minimum_never_reduces_frozen_stable_gate_or_legacy_configuration():
    base = source()
    config = GeoRuleConfiguration(
        sample_policy={"reportable_minimum": 3, "stable_minimum": 7}, recovery={"minimum_runs": 2}
    )
    value = frozen(base, "TOPIC_COVERAGE_GAP", config=config)
    result, _ = judge(value, cohort(base, [True] * 5), [base])
    assert result.required_run_count == 7 and result.status == "INSUFFICIENT_SAMPLE"
    assert judge(value, cohort(base, [True] * 7), [base])[0].status == "RECOVERED"
    old = frozen(base, "TOPIC_COVERAGE_GAP", legacy=True)
    result, _ = judge(old, cohort(base, [True] * 7), [base])
    assert result.status == "UNAVAILABLE" and result.recovery_configuration is None


def test_stability_recovery_preserves_frozen_rule_repeat_gate_above_sample_policy():
    base = source()
    value = frozen(
        base,
        "UNSTABLE_RESULT",
        config=GeoRuleConfiguration(unstable_minimum_repeats=10, recovery={"minimum_runs": 5}),
    )
    short, _ = judge(value, cohort(base, [True] * 5), [base])
    assert short.required_run_count == 10 and short.status == "INSUFFICIENT_SAMPLE"
    sufficient, _ = judge(value, cohort(base, [True] * 10), [base])
    assert sufficient.required_run_count == 10 and sufficient.status == "RECOVERED"


def test_owned_citation_recovery_deduplicates_normalized_urls_and_observation_unknown():
    base = with_citations(source(), [True, True])
    repeated = replace(
        base,
        metric=replace(base.metric, citations=(base.metric.citations[0], base.metric.citations[0])),
        evidence=replace(
            base.evidence, citations=(base.evidence.citations[0], base.evidence.citations[0])
        ),
    )
    value = frozen(
        base,
        "OWN_CITATION_LOST",
        config=GeoRuleConfiguration(recovery={"owned_citation_minimum_count": 6}),
    )
    result, cards = judge(value, cohort(repeated, [True] * 5), [base])
    assert next(c for c in cards if c.metric_code == "owned_citation_count").value == 5
    assert result.status == "NOT_RECOVERED"
    no_citations = cohort(source(), [True] * 5)
    assert judge(value, no_citations, [base])[0].status == "UNAVAILABLE"


@pytest.mark.parametrize("code", ["CRITICAL_FACT_ERROR", "REPEATED_FACT_ERROR"])
def test_same_error_recovery_requires_complete_judgement_and_preserves_signature(code):
    error = with_claim(source(), text="错误  参数")
    from app.services.geo_claim_signatures import claim_signature

    kind, digest = claim_signature(error.evidence.claims[0].claim_kind, "错误  参数")
    details = {
        "claim_assessment_ids": [str(error.evidence.claims[0].claim_assessment_id)],
        "claim_kind": kind,
        "normalized_claim_sha256": digest,
    }
    value = frozen(error, code, details=details)
    still_error, _ = judge(value, cohort(with_claim(error, text="错误 参数"), [True] * 5), [error])
    assert still_error.status == "NOT_RECOVERED"
    accurate = with_claim(error, verdict="ACCURATE")
    assert judge(value, cohort(accurate, [True] * 5), [error])[0].status == "RECOVERED"
    unjudgeable = with_claim(error, verdict="UNJUDGEABLE")
    assert judge(value, cohort(unjudgeable, [True] * 5), [error])[0].status == "UNAVAILABLE"
    partial = cohort(accurate, [True] * 6)
    partial[-1] = replace(
        partial[-1], metric=replace(partial[-1].metric, current_analysis_available=False)
    )
    assert judge(value, partial, [error])[0].status == "UNAVAILABLE"


def test_stability_quality_and_failure_frozen_thresholds_use_all_candidate_facts():
    base = source()
    stable = frozen(base, "UNSTABLE_RESULT")
    assert (
        judge(stable, cohort(base, [True, True, True, False, False]), [base])[0].status
        == "NOT_RECOVERED"
    )
    assert judge(stable, cohort(base, [True] * 5), [base])[0].status == "RECOVERED"
    quality = frozen(
        base,
        "DATA_QUALITY_PROBLEM",
        config=GeoRuleConfiguration(
            data_quality_minimum_success_rate=0.8, data_quality_minimum_evidence_rate=1.0
        ),
    )
    parts = cohort(base, [True] * 5)
    parts[0] = replace(parts[0], evidence_complete=False)
    assert judge(quality, parts, [base])[0].status == "NOT_RECOVERED"
    assert judge(quality, cohort(base, [True] * 5), [base])[0].status == "RECOVERED"
    assert judge(frozen(base, "DATA_QUALITY_PROBLEM"), parts, [base])[0].status == "UNAVAILABLE"
    failure = frozen(
        base, "RUN_FAILURE", config=GeoRuleConfiguration(run_failure_consecutive_limit=2)
    )
    sequence = sorted(cohort(base, [True] * 5), key=lambda s: s.created_at)
    sequence[-2:] = [replace(s, metric=replace(s.metric, status="FAILED")) for s in sequence[-2:]]
    assert judge(failure, sequence, [base])[0].status == "NOT_RECOVERED"
    # 相同profile里业务cell筛选外的成功仍打断真实末尾失败链。
    latest = replace(
        base,
        created_at=sequence[-1].created_at + timedelta(seconds=1),
        metric=replace(base.metric, run_id=uuid4()),
    )
    assert judge(failure, sequence + [latest], [base])[0].status == "RECOVERED"
