"""冻结规则值与样本策略的唯一入口，供 preview 和未来正式评估复用。"""

import json
from dataclasses import dataclass

from app.schemas.geo_rules import (
    GeoRuleCode,
    GeoRuleConfiguration,
    GeoRuleSampleGate,
    GeoRuleSnapshot,
)
from app.services.geo_metric_types import SamplePolicy


@dataclass(frozen=True)
class FrozenRuleSet:
    """完整值快照，无可变 JSON 引用；不得通过当前配置重建历史。"""

    revision: int
    configuration_json: str

    @classmethod
    def freeze(cls, revision: int, configuration: GeoRuleConfiguration) -> "FrozenRuleSet":
        return cls(revision, json.dumps(configuration.model_dump(mode="json"), sort_keys=True))

    def configuration(self) -> GeoRuleConfiguration:
        return GeoRuleConfiguration.model_validate_json(self.configuration_json)

    def snapshot(self) -> GeoRuleSnapshot:
        return GeoRuleSnapshot(
            schema_version=1, rule_set_revision=self.revision, configuration=self.configuration()
        )

    def sample_policy(self) -> SamplePolicy:
        policy = self.configuration().sample_policy
        return SamplePolicy(policy.reportable_minimum, policy.stable_minimum)


def sample_gates(
    rules: FrozenRuleSet, *, current_runs: int, previous_runs: int
) -> list[GeoRuleSampleGate]:
    """仅样本资格，不推断题目、来源、维度可比性或触发机会。"""
    value = rules.configuration()
    reportable, stable = (
        rules.sample_policy().reportable_minimum,
        rules.sample_policy().stable_minimum,
    )
    requirements = {
        GeoRuleCode.VISIBILITY_DROP: (stable, stable, True),
        GeoRuleCode.RECOMMENDATION_DROP: (stable, stable, True),
        GeoRuleCode.COMPETITOR_SURGE: (reportable, reportable, True),
        GeoRuleCode.TOPIC_COVERAGE_GAP: (stable, 0, True),
        GeoRuleCode.OWN_CITATION_LOST: (reportable, reportable, True),
        GeoRuleCode.CRITICAL_FACT_ERROR: (1, 0, True),
        GeoRuleCode.REPEATED_FACT_ERROR: (value.repeated_error_minimum_runs, 0, True),
        GeoRuleCode.UNSTABLE_RESULT: (value.unstable_minimum_repeats, 0, True),
        GeoRuleCode.DATA_QUALITY_PROBLEM: (
            1,
            0,
            value.data_quality_minimum_success_rate is not None
            or value.data_quality_minimum_evidence_rate is not None,
        ),
        GeoRuleCode.RUN_FAILURE: (
            value.run_failure_consecutive_limit or 1,
            0,
            value.run_failure_consecutive_limit is not None,
        ),
    }
    return [
        GeoRuleSampleGate(
            rule_code=code,
            current_minimum=current,
            previous_minimum=previous,
            sample_sufficient=current_runs >= current and previous_runs >= previous,
            threshold_configured=configured,
        )
        for code, (current, previous, configured) in requirements.items()
    ]
