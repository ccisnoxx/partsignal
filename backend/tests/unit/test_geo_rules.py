"""规则 Schema、方法默认门槛、冻结值隔离和共享 preview 样本策略。"""

from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.schemas.geo_rules import GeoRuleConfiguration, GeoRuleUpdateRequest
from app.services.geo_rule_policy import FrozenRuleSet, sample_gates
from tests.unit.test_geo_surface_contract import contract as contract
from tests.unit.test_geo_surface_contract import validate


def test_default_snapshot_is_closed_and_matches_methodology(contract: dict) -> None:
    value = GeoRuleConfiguration()
    rules = FrozenRuleSet.freeze(1, value)
    validate(contract, "GeoRuleSnapshot", rules.snapshot().model_dump(mode="json"))
    gates = {row.rule_code: row for row in sample_gates(rules, current_runs=3, previous_runs=3)}
    assert not gates["VISIBILITY_DROP"].sample_sufficient
    assert not gates["RECOMMENDATION_DROP"].sample_sufficient
    assert not gates["TOPIC_COVERAGE_GAP"].sample_sufficient
    assert gates["COMPETITOR_SURGE"].sample_sufficient
    assert gates["REPEATED_FACT_ERROR"].current_minimum == 3
    assert not gates["RUN_FAILURE"].threshold_configured
    assert not gates["DATA_QUALITY_PROBLEM"].threshold_configured


@pytest.mark.parametrize(
    "patch",
    [
        {"sample_policy": {"reportable_minimum": 5, "stable_minimum": 5}},
        {"sample_policy": {"reportable_minimum": True}},
        {"visibility_drop_points": -0.01},
        {"visibility_drop_points": 1.01},
        {"visibility_drop_points": "0.1"},
        {"visibility_drop_points": float("nan")},
        {"dedup_window_days": 0},
        {"dedup_window_days": 366},
        {"run_failure_consecutive_limit": 1.5},
        {"secret": "forbidden"},
        {"recovery": {"manual_confirmation_required": False}},
        {"recovery": {"strict_comparability_required": False}},
        {"recovery": {"fact_error_max_count": 1}},
        {"recovery": {"fact_error_max_count": False}},
        {"recovery": {"manual_confirmation_required": 1}},
    ],
)
def test_invalid_configuration_fails_explicitly(patch: dict) -> None:
    with pytest.raises(ValidationError):
        GeoRuleConfiguration.model_validate(patch)


def test_snapshot_cannot_be_retroactively_changed_by_mutable_inputs() -> None:
    original = GeoRuleConfiguration()
    rules = FrozenRuleSet.freeze(7, original)
    before = deepcopy(rules.snapshot().model_dump(mode="json"))
    original.sample_policy.stable_minimum = 10
    rules.configuration().visibility_drop_points = 0.5
    assert rules.snapshot().model_dump(mode="json") == before
    future = FrozenRuleSet.freeze(8, original)
    assert not sample_gates(future, current_runs=5, previous_runs=5)[0].sample_sufficient
    assert sample_gates(rules, current_runs=5, previous_runs=5)[0].sample_sufficient


def test_revision_is_strict_and_positive() -> None:
    for revision in (0, -1, True, "1", 1.5):
        with pytest.raises(ValidationError):
            GeoRuleUpdateRequest(expected_revision=revision, configuration=GeoRuleConfiguration())
