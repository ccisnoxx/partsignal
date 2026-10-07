"""704行动资格和判别协议保护业务可达边界。"""

from uuid import uuid4

import pytest
from pydantic import TypeAdapter, ValidationError

from app.models.identity import User
from app.schemas.geo_opportunities import GeoOpportunityStatus as Status
from app.schemas.geo_opportunity_actions import GeoOpportunityPublicationRepairRequest
from app.schemas.geo_rules import GeoRuleCode
from app.services.geo_opportunity_policy import action_types


@pytest.mark.parametrize(
    "rule,expected",
    [
        (GeoRuleCode.CRITICAL_FACT_ERROR, ["FACT_REVISION", "CONTENT_TASK"]),
        (GeoRuleCode.REPEATED_FACT_ERROR, ["FACT_REVISION", "CONTENT_TASK"]),
        (GeoRuleCode.OWN_CITATION_LOST, ["PUBLICATION_REPAIR"]),
        (GeoRuleCode.TOPIC_COVERAGE_GAP, ["CONTENT_TASK"]),
        (GeoRuleCode.RUN_FAILURE, []),
        (GeoRuleCode.DATA_QUALITY_PROBLEM, []),
        (GeoRuleCode.UNSTABLE_RESULT, []),
    ],
)
def test_only_confirmed_business_opportunities_can_create_actions(rule, expected):
    actor = User(account_type="ENGINEER", is_active=True, must_change_password=False)
    for state in Status:
        assert action_types(state, rule, actor) == (
            expected + ["ADDITIONAL_MONITORING"]
            if state == Status.IN_PROGRESS
            else expected if state == Status.ACKNOWLEDGED else []
        )
    actor.must_change_password = True
    assert action_types(Status.IN_PROGRESS, rule, actor) == []


@pytest.mark.parametrize(
    "patch",
    [
        {"mode": "UNKNOWN"},
        {"expected_issue_revision": True},
        {"expected_revision": 0},
        {"target_url": "https://arbitrary.invalid"},
        {"fact_version_id": str(uuid4())},
    ],
)
def test_publication_union_rejects_unknown_mode_invalid_revision_and_extra_identity(patch):
    value = {
        "mode": "LINK_ISSUE",
        "expected_revision": 1,
        "published_content_issue_id": str(uuid4()),
        "expected_issue_revision": 0,
    }
    with pytest.raises(ValidationError):
        TypeAdapter(GeoOpportunityPublicationRepairRequest).validate_python(value | patch)


@pytest.mark.parametrize("account_type,is_active,must_change_password", [
    ("ADMIN", True, False), ("ENGINEER", True, False),
    ("ADMIN", False, False), ("ENGINEER", True, True),
])
def test_strict_retest_entry_respects_actor_and_in_progress_boundary(
    account_type, is_active, must_change_password
):
    actor = User(account_type=account_type, is_active=is_active,
                 must_change_password=must_change_password)
    result = action_types(Status.IN_PROGRESS, GeoRuleCode.TOPIC_COVERAGE_GAP, actor)
    assert ("ADDITIONAL_MONITORING" in result) == (is_active and not must_change_password)
    assert "ADDITIONAL_MONITORING" not in action_types(
        Status.ACKNOWLEDGED, GeoRuleCode.TOPIC_COVERAGE_GAP, actor
    )
