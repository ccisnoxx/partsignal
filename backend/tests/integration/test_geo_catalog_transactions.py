"""GEO-104 真实 PostgreSQL 失败原子性与一致读投影。"""

from uuid import UUID

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.exc import IntegrityError

from app.models.identity import AuditLog
from app.schemas.geo_catalog import GeoNamedSubjectCreate, GeoNamedSubjectUpdate
from app.services import geo_catalog as commands
from app.services.audit_logs import get_audit_log
from tests.integration.geo_catalog_support import PREFIX, CatalogAPI, actor, catalog_state
from tests.integration.geo_catalog_support import catalog_api as catalog_api
from tests.integration.geo_catalog_support import catalog_engine as catalog_engine

pytestmark = pytest.mark.integration


def test_patch_reparent_clear_and_immutable_type(catalog_api: CatalogAPI) -> None:
    api = catalog_api
    brand = api.create(subject_type="COMPETITOR_BRAND")
    child = api.create()
    changed = api.admin.patch(
        f"{PREFIX}/{child['id']}",
        json={
            "subject_type": "COMPETITOR_PRODUCT",
            "expected_revision": 0,
            "canonical_name": "新的型号",
            "parent_subject_id": brand["id"],
        },
    )
    assert changed.status_code == 200
    row = changed.json()
    assert row["canonical_name"] == "新的型号" and row["revision"] == 1
    assert row["parent"]["id"] == brand["id"] and row["description"] == ""
    wrong = api.admin.patch(
        f"{PREFIX}/{child['id']}",
        json={
            "subject_type": "OWN_PRODUCT",
            "expected_revision": 1,
            "parent_subject_id": child["id"],
        },
    )
    assert wrong.status_code == 422
    assert wrong.json()["error"]["details"]["errors"][0]["loc"] == ["body", "subject_type"]
    clear = api.admin.patch(
        f"{PREFIX}/{child['id']}",
        json={
            "subject_type": "COMPETITOR_PRODUCT",
            "expected_revision": 1,
            "parent_subject_id": None,
            "description": "监测用途",
        },
    ).json()
    assert clear["parent"] is None and clear["revision"] == 2
    assert clear["canonical_name"] == "新的型号" and clear["description"] == "监测用途"
    assert api.admin.get(f"{PREFIX}/{brand['id']}").json()["references"]["child_subject_count"] == 0


def test_audit_failure_rolls_back_business_and_revision(
    catalog_api: CatalogAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = catalog_api
    row = api.create()
    before = catalog_state(api, row["id"])

    def fail_audit(*args: object, **kwargs: object) -> None:
        raise RuntimeError("test-only audit storage failure")

    monkeypatch.setattr(commands, "append_audit", fail_audit)
    with api.factory() as db, pytest.raises(RuntimeError, match="audit storage failure"):
        commands.update_subject(
            db=db,
            actor=actor(db, api),
            subject_id=UUID(row["id"]),
            request_id="geo104-audit-fail",
            payload=GeoNamedSubjectUpdate(
                subject_type="COMPETITOR_PRODUCT", expected_revision=0, description="失败写入"
            ),
        )
    assert catalog_state(api, row["id"]) == before


def test_audit_constraint_failure_remains_unknown_and_atomic(
    catalog_api: CatalogAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = catalog_api
    row = api.create()
    before = catalog_state(api, row["id"])

    def violate_audit(db, *args: object, **kwargs: object) -> None:
        # 真实 FK 故障发生于审计阶段，不能按任何 Catalog 写约束重分类。
        db.execute(
            text(
                "INSERT INTO audit_logs (id, action, target_type, details, "
                "business_module, outcome, result_message, actor_id, request_id) "
                "VALUES (gen_random_uuid(), 'geo_subject.updated', 'GeoSubject', '{}', "
                "'CONFIGURATION', 'SUCCESS', '', gen_random_uuid(), 'geo104-fail')"
            )
        )

    monkeypatch.setattr(commands, "append_audit", violate_audit)
    with api.factory() as db, pytest.raises(IntegrityError) as caught:
        commands.update_subject(
            db=db,
            actor=actor(db, api),
            subject_id=UUID(row["id"]),
            request_id="geo104-unknown",
            payload=GeoNamedSubjectUpdate(
                subject_type="COMPETITOR_PRODUCT", expected_revision=0, description="失败写入"
            ),
        )
    assert caught.value.orig.sqlstate == "23503"
    assert catalog_state(api, row["id"]) == before


def test_commit_failure_rolls_back_instead_of_mapping_catalog_constraints(
    catalog_api: CatalogAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = catalog_api
    row = api.create()
    before = catalog_state(api, row["id"])
    with api.factory() as db:
        original = IntegrityError("test-only commit", {}, Exception("commit transport failure"))

        def fail_commit() -> None:
            raise original

        monkeypatch.setattr(db, "commit", fail_commit)
        with pytest.raises(IntegrityError) as caught:
            commands.update_subject(
                db=db,
                actor=actor(db, api),
                subject_id=UUID(row["id"]),
                request_id="geo104-commit",
                payload=GeoNamedSubjectUpdate(
                    subject_type="COMPETITOR_PRODUCT", expected_revision=0, description="失败写入"
                ),
            )
        assert caught.value is original
    assert catalog_state(api, row["id"]) == before


def test_list_uses_one_repeatable_snapshot(catalog_api: CatalogAPI) -> None:
    api = catalog_api
    row = api.create()
    inserted = False

    def insert_between_count_and_page(connection, cursor, statement, parameters, context, many):
        nonlocal inserted
        if not inserted and "count(*)" in statement and "geo_subjects" in statement:
            inserted = True
            with api.factory() as db:
                commands.create_subject(
                    db=db,
                    actor=actor(db, api),
                    request_id="geo104-between-queries",
                    payload=GeoNamedSubjectCreate(
                        subject_type="REFERENCE_PART",
                        canonical_name="后来的型号",
                        display_name="后来的型号",
                    ),
                )

    event.listen(api.engine, "after_cursor_execute", insert_between_count_and_page)
    try:
        result = api.admin.get(PREFIX).json()
    finally:
        event.remove(api.engine, "after_cursor_execute", insert_between_count_and_page)
    assert inserted and result["total"] == 1
    assert [item["id"] for item in result["items"]] == [row["id"]]
    assert api.admin.get(PREFIX).json()["total"] == 2


def test_bulk_projection_query_cost_does_not_grow_with_subject_count(
    catalog_api: CatalogAPI,
) -> None:
    api = catalog_api
    api.create()
    statements: list[str] = []

    def record(connection, cursor, statement, parameters, context, many):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(api.engine, "before_cursor_execute", record)
    try:
        assert api.admin.get(PREFIX).json()["total"] == 1
        single_cost = len(statements)
        for index in range(12):
            api.create(canonical_name=f"虚构型号{index}")
        statements.clear()
        assert len(api.admin.get(PREFIX).json()["items"]) == 13
        assert len(statements) == single_cost
    finally:
        event.remove(api.engine, "before_cursor_execute", record)


def test_catalog_audit_projection_and_deleted_tombstone(catalog_api: CatalogAPI) -> None:
    api = catalog_api
    row = api.create()
    with api.factory() as db:
        audit_id = db.scalars(select(AuditLog.id).where(AuditLog.target_id == row["id"])).one()
        detail = get_audit_log(db, audit_id)
        assert detail.related_entry.status == "AVAILABLE"
        assert detail.related_entry.kind == "GeoSubject"
        assert detail.facts == {"revision": 0, "is_active": True}
    assert api.admin.delete(f"{PREFIX}/{row['id']}?expected_revision=0").status_code == 204
    with api.factory() as db:
        assert get_audit_log(db, audit_id).related_entry.status == "MISSING"
        assert len(list(db.scalars(select(AuditLog).where(AuditLog.target_id == row["id"])))) == 2
