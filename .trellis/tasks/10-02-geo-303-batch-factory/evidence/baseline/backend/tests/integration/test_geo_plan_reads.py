"""分页和资格投影批量查询，认证前建立一致快照，GET无隐式写入。"""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, text

from app.models.identity import User
from app.schemas.geo_monitoring_plans import GeoMonitoringPlanCreate
from app.services import geo_plan_commands as commands
from tests.integration.geo_plans_support import PREFIX, PlansAPI
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine

pytestmark = pytest.mark.integration


def test_filters_literal_search_stable_pagination(plans_api: PlansAPI) -> None:
    api = plans_api
    prefix = f"list-{uuid4()}"
    rows = [api.create(name=f"{prefix}-{index:02}") for index in range(12)]
    options = {"q": prefix, "sort": "NAME_ASC", "page_size": 10}
    first = api.api.engineer.get(PREFIX, params=options).json()
    second = api.api.engineer.get(PREFIX, params=options | {"page": 2}).json()
    assert first["total"] == second["total"] == 12
    assert [item["id"] for item in first["items"] + second["items"]] == [row["id"] for row in rows]
    assert api.api.engineer.get(PREFIX, params=options | {"page": 9}).json()["items"] == []
    assert api.api.engineer.get(PREFIX, params=options | {"status": "ACTIVE"}).json()["total"] == 0
    assert (
        api.api.engineer.get(PREFIX, params=options | {"schedule_kind": "CRON"}).json()["total"]
        == 0
    )
    unique = api.create(name=f"{prefix}%_字面")
    literal = api.api.engineer.get(PREFIX, params={"q": f"{prefix}%_"}).json()
    assert [item["id"] for item in literal["items"]] == [unique["id"]]
    for params in ({"page_size": 11}, {"page": 0}, {"q": "\x00"}, {"sort": "INVALID"}):
        assert api.api.engineer.get(PREFIX, params=params).status_code == 422


def test_query_cost_constant_with_page_size_and_no_sensitive_reads(plans_api: PlansAPI) -> None:
    api = plans_api
    api.create()
    statements: list[str] = []

    def collect(conn, cursor, statement, params, context, many):
        statements.append(statement)

    event.listen(api.api.engine, "before_cursor_execute", collect)
    try:
        assert api.api.engineer.get(PREFIX, params={"q": api.name}).status_code == 200
        cost = len(statements)
        for _ in range(11):
            api.create()
        statements.clear()
        result = api.api.engineer.get(PREFIX, params={"q": api.name})
        assert len(result.json()["items"]) == 12 and len(statements) == cost
        assert all(sql.lstrip().startswith("SELECT") for sql in statements)
        assert not any(
            "base_url" in sql or "request_parameters" in sql or "ai_channel_headers" in sql
            for sql in statements
        )
        assert len([sql for sql in statements if "FROM geo_monitoring_plans" in sql]) == 2
    finally:
        event.remove(api.api.engine, "before_cursor_execute", collect)


def test_count_page_memberships_and_eligibility_share_snapshot(plans_api: PlansAPI) -> None:
    api = plans_api
    row = api.create()
    inserted = False

    def insert_after_count(conn, cursor, statement, params, context, many):
        nonlocal inserted
        if inserted or "count(*)" not in statement or "geo_monitoring_plans" not in statement:
            return
        inserted = True
        with api.api.factory() as db:
            commands.create_plan(
                db=db,
                payload=GeoMonitoringPlanCreate.model_validate(api.payload()),
                actor=db.get(User, api.api.admin_id),
                request_id="geo208-between-read",
            )
            db.execute(
                text(
                    "UPDATE geo_collection_profiles SET is_active=false, "
                    "revision=revision+1 WHERE id=:id"
                ),
                {"id": api.profile},
            )
            db.commit()

    event.listen(api.api.engine, "after_cursor_execute", insert_after_count)
    try:
        result = api.api.engineer.get(PREFIX, params={"q": api.name}).json()
    finally:
        event.remove(api.api.engine, "after_cursor_execute", insert_after_count)
    assert inserted and result["total"] == 1 and result["items"] == [row]
    next_read = api.api.engineer.get(PREFIX, params={"q": api.name}).json()
    assert next_read["total"] == 2 and all(
        item["preview"]["blockers"] for item in next_read["items"]
    )
    assert (
        api.api.engineer.get(f"{PREFIX}/{UUID(row['id'])}").json()["workflow_stage"]
        == "CONFIGURATION_REQUIRED"
    )
