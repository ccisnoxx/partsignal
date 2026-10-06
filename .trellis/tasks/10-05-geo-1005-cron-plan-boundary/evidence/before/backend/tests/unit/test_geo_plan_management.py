"""合法/非法Plan转换及公共读模型的可满足合同。"""

from pathlib import Path

import pytest
import yaml
from pydantic import TypeAdapter

from app.errors import AppError
from app.schemas.geo_monitoring_plans import GeoMonitoringPlanStatus as Status
from app.schemas.geo_plan_management import (
    GeoMonitoringPlanCopy,
    GeoMonitoringPlanDetail,
    GeoMonitoringPlanListPage,
)
from app.services.geo_plan_policy import projection, transition


@pytest.mark.parametrize("state", list(Status))
@pytest.mark.parametrize("command", ["activate", "pause", "resume", "archive"])
def test_transition_table(state, command):
    allowed = {
        ("DISABLED", "activate"): "ACTIVE",
        ("ACTIVE", "pause"): "PAUSED",
        ("PAUSED", "resume"): "ACTIVE",
        ("DISABLED", "archive"): "ARCHIVED",
        ("PAUSED", "archive"): "ARCHIVED",
        ("ACTIVE", "archive"): "ARCHIVED",
    }
    if (state, command) in allowed:
        assert transition(state, command) == allowed[state, command]
    else:
        with pytest.raises(AppError) as caught:
            transition(state, command)
        assert caught.value.code == (
            "GEO_PLAN_ARCHIVED" if state == "ARCHIVED" else "INVALID_STATE_TRANSITION"
        )


@pytest.mark.parametrize("eligible", [True, False])
@pytest.mark.parametrize("state", list(Status))
def test_actions_follow_state_and_eligibility(state, eligible):
    stage, task, actions, deletion = projection(state, eligible=eligible)
    assert "RUN_NOW" not in actions
    assert ("DELETE" in actions) == (state == "DISABLED")
    assert ("ACTIVATE" in actions) == (state == "DISABLED" and eligible)
    assert ("RESUME" in actions) == (state == "PAUSED" and eligible)
    if state == "ARCHIVED":
        assert actions == ["COPY"] and stage == "ARCHIVED" and task == "VIEW_HISTORY"
        assert deletion.blockers == ["ARCHIVED"]
    elif state == "ACTIVE":
        assert "CREATE_REVISION" in actions and "UPDATE" not in actions
    elif not eligible:
        assert task == "COMPLETE_CONFIGURATION"


def test_new_components_match_public_shape():
    contract = yaml.safe_load(
        (Path(__file__).resolve().parents[3] / "contracts/openapi.yaml").read_text()
    )
    for model in (GeoMonitoringPlanDetail, GeoMonitoringPlanCopy, GeoMonitoringPlanListPage):
        actual = TypeAdapter(model).json_schema(
            ref_template="#/components/schemas/{model}", mode="serialization"
        )
        actual.pop("$defs", None)
        expected = contract["components"]["schemas"][model.__name__]
        # FastAPI的公开响应移除可空字段的None默认值，206未接线组件仍保留它。
        for name in ("cron_expression", "budget_limit"):
            if name in actual["properties"]:
                actual["properties"][name].pop("default", None)
        assert actual == expected
    paths = contract["paths"]
    operations = [
        op
        for path, item in paths.items()
        if "/geo/monitoring-plans" in path
        for op in item.values()
    ]
    assert len(operations) == 12
    run = paths["/api/v1/geo/monitoring-plans/{plan_id}/run"]["post"]
    assert "201" in run["responses"] and "501" not in run["responses"]

