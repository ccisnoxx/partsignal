"""机会identity时区规范、合法状态边和公开快照防线。"""

from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

import pytest
import yaml
from pydantic import ValidationError

from app.errors import AppError
from app.schemas.geo_opportunities import GeoOpportunityStatus as Status
from app.schemas.geo_opportunities import GeoOpportunityTriggerSnapshot
from app.schemas.geo_rules import GeoRuleCode, GeoRuleConfiguration
from app.services.geo_opportunity_policy import TRANSITIONS, assert_transition, identity_key
from app.services.geo_opportunity_types import OpportunityScope
from app.services.geo_rule_policy import FrozenRuleSet
from tests.unit.test_geo_surface_contract import validate

SCOPE = OpportunityScope(
    UUID(int=1), UUID(int=2), UUID(int=3), UUID(int=4), UUID(int=5), environment_key="a" * 64
)
START = datetime(2026, 10, 1, tzinfo=UTC)
END = START + timedelta(days=1)


def test_identity_normalizes_timezone_and_is_sensitive_to_period_and_scope():
    code = GeoRuleCode.TOPIC_COVERAGE_GAP
    key = identity_key(code, SCOPE, START, END)
    west = timezone(timedelta(hours=-7))
    assert identity_key(code, SCOPE, START.astimezone(west), END.astimezone(west)) == key
    assert identity_key(code, SCOPE, START, END + timedelta(days=1)) != key
    assert identity_key(code, replace(SCOPE, collection_profile_id=UUID(int=9)), START, END) != key
    assert identity_key(GeoRuleCode.RUN_FAILURE, SCOPE, START, END) != key
    with pytest.raises(ValueError):
        identity_key(code, SCOPE, START.replace(tzinfo=None), END)


@pytest.mark.parametrize("before", list(Status))
@pytest.mark.parametrize("after", list(Status))
def test_state_machine_matches_approved_edges_and_terminal_is_final(before, after):
    if after in TRANSITIONS[before]:
        assert_transition(before, after, reason="人工理由")
    else:
        with pytest.raises(AppError, match="机会状态") as failure:
            assert_transition(before, after, reason="人工理由")
        assert failure.value.status_code == 409


@pytest.mark.parametrize("reason", [None, "", "   "])
def test_closing_requires_nonempty_reason(reason):
    with pytest.raises(AppError):
        assert_transition(Status.OPEN, Status.DISMISSED, reason=reason)


def snapshot():
    return dict(
        schema_version=1,
        rule_snapshot=FrozenRuleSet.freeze(1, GeoRuleConfiguration()).snapshot(),
        rule_code="TOPIC_COVERAGE_GAP",
        scope=dict(
            subject_id=SCOPE.subject_id,
            query_topic_id=SCOPE.query_topic_id,
            prompt_variant_id=SCOPE.prompt_variant_id,
            collection_profile_id=SCOPE.collection_profile_id,
            engine_surface_id=SCOPE.engine_surface_id,
            batch_id=None,
            environment_key=SCOPE.environment_key,
        ),
        source_date_from=START,
        source_date_to=END,
        triggered=True,
        priority="MEDIUM",
        value=0.0,
        threshold=0.0,
        numerator=0,
        denominator=5,
        unavailable_reasons=[],
        sources=[
            dict(
                run_id=UUID(int=9), analysis_revision_id=None, review_id=None, source_role="TRIGGER"
            )
        ],
        details={},
    )


def test_closed_public_snapshot_preserves_actual_rule_values_and_sources():
    value = GeoOpportunityTriggerSnapshot.model_validate(snapshot())
    contract = yaml.safe_load(Path("contracts/openapi.yaml").read_text())
    validate(contract, "GeoOpportunityTriggerSnapshot", value.model_dump(mode="json"))
    assert "/api/v1/geo/opportunities" in contract["paths"]
    assert "/api/v1/geo/opportunities/{opportunity_id}/retest" in contract["paths"]
    assert "/api/v1/geo/opportunities/{opportunity_id}/resolve" in contract["paths"]
    assert "/api/v1/geo/opportunities/{opportunity_id}/continue" in contract["paths"]
    assert "/api/v1/geo/opportunities/{opportunity_id}/actions" not in contract["paths"]
    for patch in (
        {"unavailable_reasons": ["INSUFFICIENT_SAMPLE"]},
        {"value": None},
        {"sources": []},
    ):
        with pytest.raises(ValidationError):
            GeoOpportunityTriggerSnapshot.model_validate(snapshot() | patch)
