"""GEO 管理列表的稳定分页、固定查询成本与认证前一致快照。"""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import event

from app.schemas.geo_surfaces import GeoEngineSurfaceCreate
from app.services import geo_surface_commands as commands
from tests.integration.geo_surface_management_support import PROFILES, SURFACES, SurfaceAPI, actor
from tests.integration.geo_surface_management_support import surface_api as surface_api
from tests.integration.geo_surface_management_support import surface_engine as surface_engine
from tests.unit.test_geo_surface_contract import surface_payload

pytestmark = pytest.mark.integration


def test_list_filters_pagination_stable_sort_and_role_summary(surface_api: SurfaceAPI) -> None:
    api = surface_api
    prefix = f"list-{uuid4().hex}"
    surfaces = [api.surface(name=f"{prefix}-{index:02}") for index in range(12)]
    profiles = [api.profile(surfaces[0], name=f"{prefix}-{index:02}") for index in range(12)]
    for path, rows in [(SURFACES, surfaces), (PROFILES, profiles)]:
        listing = api.admin.get(path, params={"q": prefix, "page_size": 10}).json()
        assert listing["total"] == 12 and listing["page"] == 1 and listing["page_size"] == 10
        assert [item["summary"]["id"] for item in listing["items"]] == [
            item["summary"]["id"] for item in rows[:10]
        ]
        second = api.admin.get(path, params={"q": prefix, "page_size": 10, "page": 2}).json()
        assert len(second["items"]) == 2 and second["total"] == 12
        empty = api.admin.get(path, params={"q": prefix, "page_size": 10, "page": 9}).json()
        assert empty["items"] == [] and empty["total"] == 12
        active = api.admin.get(path, params={"q": prefix, "is_active": "true"}).json()
        assert active["items"] == [] and active["total"] == 0
        updated = api.admin.get(path, params={"q": prefix, "sort": "UPDATED_DESC"}).json()
        assert [item["summary"]["id"] for item in updated["items"]] == [
            item["summary"]["id"] for item in reversed(rows)
        ]
    listing = api.admin.get(
        PROFILES,
        params={"engine_surface_id": surfaces[0]["summary"]["id"], "collection_mode": "MANUAL"},
    ).json()
    assert listing["total"] == 12
    assert api.admin.get(PROFILES, params={"engine_surface_id": str(uuid4())}).json()["total"] == 0
    assert (
        api.admin.get(SURFACES, params={"q": prefix, "surface_kind": "MODEL_API"}).json()["total"]
        == 0
    )
    assert api.admin.get(SURFACES, params={"q": "%"}).json()["total"] == 0


def test_profile_list_query_cost_is_fixed_and_only_non_sensitive_columns_are_read(
    surface_api: SurfaceAPI,
) -> None:
    api = surface_api
    surface = api.surface()
    api.profile(surface, name="查询成本0")
    statements: list[str] = []

    def collect(conn, cursor, statement, params, context, many):
        statements.append(statement)

    event.listen(api.engine, "before_cursor_execute", collect)
    try:
        assert (
            api.admin.get(
                PROFILES, params={"engine_surface_id": surface["summary"]["id"]}
            ).status_code
            == 200
        )
        first_cost = len(statements)
        for index in range(1, 13):
            api.profile(surface, name=f"查询成本{index}")
        statements.clear()
        result = api.admin.get(PROFILES, params={"engine_surface_id": surface["summary"]["id"]})
        assert len(result.json()["items"]) == 13
        assert len(statements) == first_cost
        assert all(statement.lstrip().startswith("SELECT") for statement in statements)
        qualification = [sql for sql in statements if "credential_configured" in sql]
        assert len(qualification) == 1
        assert "api_key_ciphertext !=" in qualification[0]
        assert "base_url" not in qualification[0] and "request_parameters" not in qualification[0]
        assert "ai_channel_headers" not in qualification[0]
    finally:
        event.remove(api.engine, "before_cursor_execute", collect)


def test_authentication_count_page_and_dependencies_share_repeatable_snapshot(
    surface_api: SurfaceAPI,
) -> None:
    api = surface_api
    prefix = f"snapshot-{uuid4().hex}"
    row = api.surface(name=prefix)
    inserted = False

    def insert_after_count(conn, cursor, statement, params, context, many):
        nonlocal inserted
        if not inserted and "count(*)" in statement and "geo_engine_surfaces" in statement:
            inserted = True
            with api.factory() as db:
                commands.create_surface(
                    db=db,
                    actor=actor(db, api),
                    request_id="geo205-between-reads",
                    payload=GeoEngineSurfaceCreate.model_validate(
                        surface_payload(
                            name=prefix,
                            slug=f"test-{uuid4().hex}",
                        )
                    ),
                )
                commands.set_surface_active(
                    db=db,
                    surface_id=UUID(row["summary"]["id"]),
                    expected_revision=0,
                    is_active=True,
                    actor=actor(db, api),
                    request_id="geo205-between-reads-update",
                )

    event.listen(api.engine, "after_cursor_execute", insert_after_count)
    try:
        result = api.admin.get(SURFACES, params={"q": prefix}).json()
    finally:
        event.remove(api.engine, "after_cursor_execute", insert_after_count)
    assert inserted and result["total"] == 1
    assert result["items"][0]["summary"] == row["summary"]
    assert api.admin.get(SURFACES, params={"q": prefix}).json()["total"] == 2
