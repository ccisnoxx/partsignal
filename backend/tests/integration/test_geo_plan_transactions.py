"""Plan 与最小审计同事务提交；失败不留下配置、关系或成功记录。"""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text

from app.errors import AppError
from app.models.geo_monitoring_plans import GeoMonitoringPlan, GeoMonitoringPlanProfile
from app.models.identity import User
from app.schemas.geo_monitoring_plans import GeoMonitoringPlanCreate, GeoMonitoringPlanUpdate
from app.services import geo_plan_commands as commands
from tests.integration.geo_plans_support import PREFIX, PlansAPI
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine

pytestmark = pytest.mark.integration


def state(api: PlansAPI, identity: str) -> tuple[dict, list[dict]]:
    with api.api.factory() as db:
        row = dict(
            db.execute(text("SELECT * FROM geo_monitoring_plans WHERE id=:id"), {"id": identity})
            .mappings()
            .one()
        )
        audits = [
            dict(entry)
            for entry in db.execute(
                text("SELECT * FROM audit_logs WHERE target_id=:id ORDER BY created_at"),
                {"id": identity},
            ).mappings()
        ]
        return row, audits


@pytest.mark.parametrize("operation", ["update", "archive", "delete"])
def test_audit_failure_rolls_back_every_business_write(
    plans_api: PlansAPI, monkeypatch: pytest.MonkeyPatch, operation: str
) -> None:
    api = plans_api
    row = api.create()
    before = state(api, row["id"])

    def fail(*args, **kwargs):
        raise RuntimeError("测试审计边界故障")

    monkeypatch.setattr(commands, "append_audit", fail)
    with api.api.factory() as db:
        actor = db.get(User, api.api.engineer_id)
        with pytest.raises(RuntimeError, match="审计边界故障"):
            if operation == "update":
                commands.update_plan(
                    db=db,
                    plan_id=UUID(row["id"]),
                    payload=GeoMonitoringPlanUpdate.model_validate(
                        api.payload(name="不得留下", expected_revision=0)
                    ),
                    actor=actor,
                    request_id="geo208-audit-failure",
                )
            elif operation == "archive":
                commands.change_status(
                    db=db,
                    plan_id=UUID(row["id"]),
                    expected_revision=0,
                    operation="archive",
                    actor=actor,
                    request_id="geo208-audit-failure",
                )
            else:
                commands.delete_plan(
                    db=db,
                    plan_id=UUID(row["id"]),
                    expected_revision=0,
                    actor=actor,
                    request_id="geo208-audit-failure",
                )
        assert not db.in_transaction()
    assert state(api, row["id"]) == before
    assert api.api.engineer.get(f"{PREFIX}/{row['id']}").json() == row


def test_create_partial_memberships_failure_rolls_back_aggregate(
    plans_api: PlansAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = plans_api
    original = commands._memberships

    def fail(db, plan, value):
        original(db, plan, value)
        db.flush()
        raise RuntimeError("测试关系写入后故障")

    monkeypatch.setattr(commands, "_memberships", fail)
    with api.api.factory() as db, pytest.raises(RuntimeError, match="关系写入后故障"):
        commands.create_plan(
            db=db,
            payload=GeoMonitoringPlanCreate.model_validate(api.payload()),
            actor=db.get(User, api.api.engineer_id),
            request_id="geo208-create-partial",
        )
    with api.api.factory() as db:
        assert (
            db.scalar(select(GeoMonitoringPlan).where(GeoMonitoringPlan.name == api.name)) is None
        )
        assert (
            db.scalar(
                text("SELECT count(*) FROM audit_logs WHERE request_id='geo208-create-partial'")
            )
            == 0
        )


def test_precise_fk_mapping_and_unknown_integrity_failure(plans_api: PlansAPI) -> None:
    from sqlalchemy.exc import IntegrityError

    api = plans_api
    row = api.create()
    before = state(api, row["id"])
    with api.api.factory() as db:
        db.add(GeoMonitoringPlanProfile(plan_id=UUID(row["id"]), collection_profile_id=uuid4()))
        with pytest.raises(AppError) as caught:
            commands._flush_business(db)
        assert caught.value.code == "GEO_PLAN_REFERENCE_INVALID"
    with api.api.factory() as db:
        plan = db.get(GeoMonitoringPlan, UUID(row["id"]))
        plan.repeat_count = 0
        with pytest.raises(IntegrityError):
            commands._flush_business(db)
        db.rollback()
    assert state(api, row["id"]) == before


def test_active_memberships_replace_atomically_without_history_marker(plans_api: PlansAPI) -> None:
    api = plans_api
    row = api.action(api.create(), "activate").json()
    extra = api.api.create(prompt_text="虚构第二个计划问题")
    changed = api.api.engineer.patch(
        f"{PREFIX}/{row['id']}",
        json=api.payload(
            repeat_count=7,
            prompt_variant_ids=[str(api.prompt), extra["id"]],
            expected_revision=1,
        ),
    )
    assert changed.status_code == 200, changed.text
    after = changed.json()
    assert after["status"] == "ACTIVE" and after["revision"] == 2
    assert after["preview"]["run_count"] == 14 and after["repeat_count"] == 7
    before_noop = state(api, row["id"])
    noop = api.api.engineer.patch(
        f"{PREFIX}/{row['id']}",
        json=api.payload(
            repeat_count=7,
            prompt_variant_ids=list(reversed(after["prompt_variant_ids"])),
            expected_revision=2,
        ),
    )
    assert noop.status_code == 200 and noop.json() == after
    assert state(api, row["id"]) == before_noop
    with api.api.factory() as db:
        assert (
            db.scalar(
                text("SELECT count(*) FROM geo_monitoring_plan_prompts WHERE plan_id=:id"),
                {"id": row["id"]},
            )
            == 2
        )
        prompt = db.scalar(
            text("SELECT first_referenced_at FROM geo_prompt_variants WHERE id=:id"),
            {"id": api.prompt},
        )
        surface = db.scalar(
            text("SELECT first_referenced_at FROM geo_engine_surfaces WHERE id=:id"),
            {"id": api.surface},
        )
        assert prompt is None and surface is None
