"""GEO-104 HTTP/应用服务合同：CRUD、权限、版本、引用及原子审计。"""

import uuid
from typing import Any

import pytest
from sqlalchemy import select, text

from app.errors import AppError
from app.models.geo_catalog import GeoSubject
from app.models.identity import AuditLog, User
from app.services.identity import delete_user, users_out
from tests.integration.geo_catalog_support import (
    PREFIX,
    CatalogAPI,
    actor,
    catalog_state,
)
from tests.integration.geo_catalog_support import (
    catalog_api as catalog_api,
)
from tests.integration.geo_catalog_support import (
    catalog_engine as catalog_engine,
)

pytestmark = pytest.mark.integration


def error(response: Any, status: int, code: str) -> dict:
    assert response.status_code == status, response.text
    payload = response.json()["error"]
    assert payload["code"] == code
    assert payload["request_id"] == response.headers["X-Request-ID"]
    return payload["details"]


def test_subject_children_revision_noop_and_audit(catalog_api: CatalogAPI) -> None:
    api = catalog_api
    row = api.create(canonical_name="  ＣＰ-104  ")
    sid = row["id"]
    assert row["canonical_name"] == "CP-104" and row["revision"] == 0
    before = catalog_state(api, sid)
    same = api.admin.patch(
        f"{PREFIX}/{sid}",
        json={
            "subject_type": row["subject_type"],
            "expected_revision": 0,
            "description": "",
        },
    )
    assert same.status_code == 200 and same.json()["revision"] == 0
    assert catalog_state(api, sid) == before
    alias = api.admin.post(
        f"{PREFIX}/{sid}/aliases",
        json={
            "expected_revision": 0,
            "alias": " ＣＰ-104  ",
            "alias_kind": "PART_NUMBER",
            "language_code": "ZH-Hans",
        },
    ).json()
    assert alias["revision"] == 1
    child = alias["aliases"][0]
    assert (child["alias"], child["normalized_alias"], child["language_code"]) == (
        "CP-104",
        "cp-104",
        "zh-hans",
    )
    changed = api.admin.patch(
        f"{PREFIX}/{sid}/aliases/{child['id']}",
        json={
            "expected_revision": 1,
            "is_active": False,
            "language_code": None,
        },
    ).json()
    assert changed["revision"] == 2 and changed["aliases"][0]["language_code"] is None
    assert changed["aliases"][0]["alias"] == child["alias"]
    before = catalog_state(api, sid)
    conflict = api.admin.post(
        f"{PREFIX}/{sid}/aliases",
        json={
            "expected_revision": 2,
            "alias": "cp-104",
            "alias_kind": "NAME",
        },
    )
    details = error(conflict, 409, "GEO_SUBJECT_ALIAS_EXISTS")
    assert details["errors"][0]["loc"] == ["body", "alias"]
    assert catalog_state(api, sid) == before
    domain = api.admin.post(
        f"{PREFIX}/{sid}/domains",
        json={
            "expected_revision": 2,
            "hostname": "BÜCHER.example",
            "relation_type": "OFFICIAL",
        },
    ).json()
    assert domain["revision"] == 3
    assert domain["domains"][0]["hostname"] == "xn--bcher-kva.example"
    before = catalog_state(api, sid)
    duplicate = api.admin.post(
        f"{PREFIX}/{sid}/domains",
        json={
            "expected_revision": 3,
            "hostname": "xn--bcher-kva.example",
            "relation_type": "OTHER",
        },
    )
    error(duplicate, 409, "GEO_SUBJECT_DOMAIN_EXISTS")
    assert catalog_state(api, sid) == before
    removed = api.admin.delete(
        f"{PREFIX}/{sid}/aliases/{child['id']}?expected_revision=3",
    ).json()
    assert removed["revision"] == 4 and removed["aliases"] == []
    removed = api.admin.delete(
        f"{PREFIX}/{sid}/domains/{domain['domains'][0]['id']}?expected_revision=4",
    ).json()
    assert removed["revision"] == 5 and removed["domains"] == []
    disabled = api.admin.post(f"{PREFIX}/{sid}/disable", json={"expected_revision": 5}).json()
    assert disabled["revision"] == 6 and disabled["workflow_stage"] == "DISABLED"
    before = catalog_state(api, sid)
    assert (
        api.admin.post(f"{PREFIX}/{sid}/disable", json={"expected_revision": 6}).status_code == 200
    )
    assert catalog_state(api, sid) == before
    error(
        api.admin.post(f"{PREFIX}/{sid}/disable", json={"expected_revision": 5}),
        409,
        "REVISION_CONFLICT",
    )
    enabled = api.admin.post(f"{PREFIX}/{sid}/enable", json={"expected_revision": 6}).json()
    assert enabled["revision"] == 7 and enabled["workflow_stage"] == "ACTIVE"
    assert api.admin.delete(f"{PREFIX}/{sid}?expected_revision=7").status_code == 204
    error(api.admin.get(f"{PREFIX}/{sid}"), 404, "NOT_FOUND")
    with api.factory() as db:
        logs = list(db.scalars(select(AuditLog).where(AuditLog.target_id == sid)))
        assert len(logs) == 9
        assert {item.action for item in logs} == {
            "geo_subject.created",
            "geo_subject.disabled",
            "geo_subject.enabled",
            "geo_subject.deleted",
            "geo_subject_alias.created",
            "geo_subject_alias.updated",
            "geo_subject_alias.deleted",
            "geo_subject_domain.created",
            "geo_subject_domain.deleted",
        }
        assert all(set(item.details["facts"]) == {"revision", "is_active"} for item in logs)
        assert all(item.outcome == "SUCCESS" for item in logs)


def test_parent_references_and_current_product_identity(catalog_api: CatalogAPI) -> None:
    api = catalog_api
    brand = api.create(subject_type="OWN_BRAND")
    response = api.admin.post(
        PREFIX,
        json={
            "subject_type": "OWN_PRODUCT",
            "product_id": str(api.product_id),
            "parent_subject_id": brand["id"],
        },
    )
    assert response.status_code == 201
    row = response.json()
    assert row["canonical_name"] == "PS-104" and row["product"]["revision"] == 0
    sid = row["id"]
    parent = api.admin.get(f"{PREFIX}/{brand['id']}").json()
    assert parent["references"]["child_subject_count"] == 1
    assert parent["deletion"]["blockers"] == [{"type": "CHILD_SUBJECT", "count": 1}]
    assert "DELETE" not in parent["available_actions"]
    error(
        api.admin.delete(f"{PREFIX}/{brand['id']}?expected_revision=0"), 409, "GEO_SUBJECT_IN_USE"
    )
    assert (
        api.admin.post(f"{PREFIX}/{brand['id']}/disable", json={"expected_revision": 0}).status_code
        == 200
    )
    assert api.admin.get(f"{PREFIX}/{sid}").json()["is_active"]
    with api.factory() as db:
        db.execute(
            text(
                "UPDATE products SET part_number='PS-104B', brand='新虚构品牌', "
                "revision=revision+1 WHERE id=:id"
            ),
            {"id": api.product_id},
        )
        db.commit()
    current = api.engineer.get(f"{PREFIX}/{sid}").json()
    assert (
        current["canonical_name"] == "PS-104B" and current["display_name"] == "新虚构品牌 PS-104B"
    )
    assert current["product"]["revision"] == 1 and current["revision"] == 0
    assert current["available_actions"] == [] and current["deletion"] is None
    duplicate = api.admin.post(
        PREFIX, json={"subject_type": "OWN_PRODUCT", "product_id": str(api.product_id)}
    )
    error(duplicate, 409, "GEO_SUBJECT_PRODUCT_EXISTS")
    assert (
        api.admin.post(f"{PREFIX}/{sid}/disable", json={"expected_revision": 0}).status_code == 200
    )
    second = api.admin.post(
        PREFIX, json={"subject_type": "OWN_PRODUCT", "product_id": str(api.product_id)}
    )
    assert second.status_code == 201
    before = catalog_state(api, sid)
    details = error(
        api.admin.post(f"{PREFIX}/{sid}/enable", json={"expected_revision": 1}),
        409,
        "GEO_SUBJECT_PRODUCT_EXISTS",
    )
    assert details["subject_id"] == sid and details["product_id"] == str(api.product_id)
    assert catalog_state(api, sid) == before
    product = api.admin.get(f"/api/v1/products/{api.product_id}").json()
    assert product["deletion"]["blockers"] == [{"type": "GEO_SUBJECT", "count": 2}]
    error(
        api.admin.delete(f"/api/v1/products/{api.product_id}?expected_revision=1"),
        409,
        "PRODUCT_IN_USE",
    )
    with api.factory() as db:
        stored = db.execute(
            text(
                "SELECT canonical_name,normalized_name,display_name FROM geo_subjects WHERE id=:id"
            ),
            {"id": sid},
        ).one()
        assert tuple(stored) == (None, None, None)


def test_alias_noop_cross_parent_and_parent_validation(catalog_api: CatalogAPI) -> None:
    api = catalog_api
    row = api.create()
    other = api.create(subject_type="OWN_BRAND")
    alias = api.admin.post(
        f"{PREFIX}/{row['id']}/aliases",
        json={
            "expected_revision": 0,
            "alias": "名称",
            "alias_kind": "NAME",
        },
    ).json()["aliases"][0]
    before = catalog_state(api, row["id"])
    assert (
        api.admin.patch(
            f"{PREFIX}/{row['id']}/aliases/{alias['id']}",
            json={
                "expected_revision": 1,
                "alias": "名称",
            },
        ).status_code
        == 200
    )
    assert catalog_state(api, row["id"]) == before
    error(
        api.admin.delete(f"{PREFIX}/{other['id']}/aliases/{alias['id']}?expected_revision=0"),
        404,
        "NOT_FOUND",
    )
    error(
        api.admin.patch(
            f"{PREFIX}/{row['id']}",
            json={
                "subject_type": row["subject_type"],
                "expected_revision": 1,
                "parent_subject_id": other["id"],
            },
        ),
        409,
        "GEO_SUBJECT_PARENT_INVALID",
    )
    error(
        api.admin.patch(
            f"{PREFIX}/{row['id']}",
            json={
                "subject_type": row["subject_type"],
                "expected_revision": 0,
                "parent_subject_id": other["id"],
            },
        ),
        409,
        "REVISION_CONFLICT",
    )
    error(
        api.admin.patch(
            f"{PREFIX}/{row['id']}",
            json={
                "subject_type": row["subject_type"],
                "expected_revision": 1,
                "parent_subject_id": str(uuid.uuid4()),
            },
        ),
        404,
        "NOT_FOUND",
    )
    assert catalog_state(api, row["id"]) == before


WRITE_ROUTES = [
    ("POST", "", {"subject_type": "REFERENCE_PART", "canonical_name": "X", "display_name": "X"}),
    (
        "PATCH",
        "/{id}",
        {"subject_type": "COMPETITOR_PRODUCT", "expected_revision": 0, "description": "X"},
    ),
    ("DELETE", "/{id}?expected_revision=0", None),
    ("POST", "/{id}/enable", {"expected_revision": 0}),
    ("POST", "/{id}/disable", {"expected_revision": 0}),
    ("POST", "/{id}/aliases", {"expected_revision": 0, "alias": "X", "alias_kind": "NAME"}),
    ("PATCH", "/{id}/aliases/{child}", {"expected_revision": 0, "alias": "X"}),
    ("DELETE", "/{id}/aliases/{child}?expected_revision=0", None),
    (
        "POST",
        "/{id}/domains",
        {"expected_revision": 0, "hostname": "a.example", "relation_type": "OWNED"},
    ),
    ("DELETE", "/{id}/domains/{child}?expected_revision=0", None),
]


@pytest.mark.parametrize("method,path,payload", WRITE_ROUTES)
def test_all_writes_require_admin_and_csrf(
    catalog_api: CatalogAPI,
    method: str,
    path: str,
    payload: dict | None,
) -> None:
    api = catalog_api
    row = api.create()
    before = catalog_state(api, row["id"])
    url = PREFIX + path.format(id=row["id"], child=uuid.uuid4())
    error(api.engineer.request(method, url, json=payload), 403, "PERMISSION_DENIED")
    api.admin.headers["X-CSRF-Token"] = "x" * 32
    error(api.admin.request(method, url, json=payload), 403, "CSRF_INVALID")
    del api.admin.headers["X-CSRF-Token"]
    error(api.admin.request(method, url, json=payload), 422, "VALIDATION_ERROR")
    assert catalog_state(api, row["id"]) == before


@pytest.mark.parametrize("path", ["", "/{id}"])
def test_reads_require_session(catalog_api: CatalogAPI, path: str) -> None:
    api = catalog_api
    row = api.create()
    api.admin.cookies.clear()
    error(api.admin.get(PREFIX + path.format(id=row["id"])), 401, "AUTH_REQUIRED")


def test_list_filters_pagination_literal_search_and_sort(catalog_api: CatalogAPI) -> None:
    api = catalog_api
    for index in range(12):
        api.create(canonical_name=f"CP-{index:02}", display_name=f"虚构 {index:02}")
    wildcard = api.create(subject_type="REFERENCE_PART", canonical_name="CP-%_")
    rows = api.engineer.get(
        PREFIX, params={"page_size": 10, "page": 2, "subject_type": "COMPETITOR_PRODUCT"}
    ).json()
    assert rows["total"] == 12 and len(rows["items"]) == 2
    assert [item["canonical_name"] for item in rows["items"]] == ["CP-10", "CP-11"]
    exact = api.admin.get(PREFIX, params={"q": "%_"}).json()
    assert exact["total"] == 1 and exact["items"][0]["id"] == wildcard["id"]
    assert api.admin.get(PREFIX, params={"page": 9}).json()["items"] == []
    error(api.admin.get(PREFIX, params={"page_size": 100}), 422, "VALIDATION_ERROR")
    error(api.admin.get(PREFIX, params={"sort": "UNKNOWN"}), 422, "VALIDATION_ERROR")


def test_user_creator_reference_blocks_deletion(catalog_api: CatalogAPI) -> None:
    api = catalog_api
    with api.factory() as db:
        acting = actor(db, api)
        creator = User(
            username=f"creator-{uuid.uuid4().hex}",
            display_name="虚构创建者",
            password_hash="unused",
            account_type="ADMIN",
            is_active=False,
            must_change_password=False,
            revision=0,
        )
        db.add(creator)
        db.flush()
        db.add(
            GeoSubject(
                subject_type="REFERENCE_PART",
                canonical_name="CP-X",
                normalized_name="cp-x",
                display_name="虚构参考型号",
                created_by=creator.id,
            )
        )
        db.commit()
        projected = users_out(db, [creator], actor=acting)[0]
        assert projected.deletion is not None and projected.deletion.blockers
        with pytest.raises(AppError, match="仍被") as rejected:
            delete_user(
                db=db,
                user_id=creator.id,
                expected_revision=creator.revision,
                actor=acting,
                request_id="geo104-user-delete",
            )
        assert rejected.value.code == "USER_IN_USE"
        db.rollback()
