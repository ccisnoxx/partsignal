"""703公开命令及工作流：原因非空、闭合动作、不推导后续能力。"""

import pytest
from pydantic import ValidationError

from app.models.identity import User
from app.schemas.geo_opportunities import GeoOpportunityStatus as Status
from app.schemas.geo_opportunity_workbench import GeoOpportunityDismissRequest
from app.services.geo_opportunity_policy import workflow


@pytest.mark.parametrize(
    "status,expected",
    [
        (Status.OPEN, ["ACKNOWLEDGE", "DISMISS"]),
        (Status.ACKNOWLEDGED, ["DISMISS"]),
        (Status.IN_PROGRESS, ["DISMISS", "RESOLVE", "CONTINUE"]),
        (Status.RESOLVED, []),
        (Status.DISMISSED, []),
    ],
)
def test_only_implemented_actions_are_projected(status, expected):
    actor = User(account_type="ENGINEER", is_active=True, must_change_password=False)
    assert workflow(status, actor).available_actions == expected
    actor.is_active = False
    assert workflow(status, actor).available_actions == []


@pytest.mark.parametrize(
    "field,value",
    [
        ("resolution_code", " \t\n"),
        ("resolution_comment", "\u3000"),
        ("resolution_code", "x" * 41),
        ("resolution_comment", "x" * 2001),
        ("resolution_code", "\x00"),
        ("expected_revision", True),
    ],
)
def test_dismiss_rejects_empty_or_invalid_public_boundary(field, value):
    with pytest.raises(ValidationError):
        GeoOpportunityDismissRequest.model_validate(
            dict(expected_revision=1, resolution_code="OTHER", resolution_comment="人工理由")
            | {field: value}
        )


def test_reason_is_trimmed_and_arbitrary_business_code_is_not_guessed():
    value = GeoOpportunityDismissRequest(
        expected_revision=1,
        resolution_code="  重复记录  ",
        resolution_comment=" 人工判断有重复证据 ",
    )
    assert value.resolution_code == "重复记录"
    assert value.resolution_comment == "人工判断有重复证据"


@pytest.mark.parametrize(
    "url", ["postgresql://unused/partsignal", "postgresql://unused/partsignal_e2e_bad"]
)
def test_offline_e2e_seed_refuses_non_owned_database_before_connect(monkeypatch, url):
    from tests import geo_opportunity_e2e_seed as seed

    monkeypatch.setattr(seed.settings, "geo_opportunity_evaluation_enabled", True)
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("PARTSIGNAL_E2E_DATABASE_OWNER_TOKEN", "b" * 32)

    def forbidden(*_args, **_kwargs):
        pytest.fail("未经所有权核验不得连接数据库")

    monkeypatch.setattr(seed.psycopg, "connect", forbidden)
    with pytest.raises(ValueError, match="随机数据库"):
        seed.validate_owned_database()
