"""GEO-106：Catalog 纵向操作不得改写现有产品事实聚合。"""

import pytest
from sqlalchemy import text

from tests.integration.geo_catalog_support import PREFIX, CatalogAPI, catalog_state
from tests.integration.geo_catalog_support import catalog_api as catalog_api
from tests.integration.geo_catalog_support import catalog_engine as catalog_engine

pytestmark = pytest.mark.integration


def product_facts_snapshot(api: CatalogAPI) -> tuple:
    """包含时间戳/revision 和审核历史，防止只比较 Markdown 漏掉隐式写入。"""
    with api.factory() as db:
        return tuple(
            db.execute(
                text(
                    "SELECT to_jsonb(p), "
                    "(SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM fact_versions f "
                    "WHERE f.product_id=p.id), "
                    "(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM fact_review_records r "
                    "JOIN fact_versions f ON f.id=r.fact_version_id WHERE f.product_id=p.id) "
                    "FROM products p WHERE p.id=:id"
                ),
                {"id": api.product_id},
            ).one()
        )


def test_catalog_identity_and_dictionary_preserve_approved_product_facts(
    catalog_api: CatalogAPI,
) -> None:
    api = catalog_api
    product_path = f"/api/v1/products/{api.product_id}"
    saved = api.admin.put(
        f"{product_path}/facts",
        json={
            "expected_revision": 0,
            "body_markdown": "# 虚构验收事实\n\n- 参数：只允许产品工作区修改",
            "classification": "RESTRICTED",
        },
    )
    assert saved.status_code == 200, saved.text
    submitted = api.admin.post(
        f"{product_path}/fact-review-submissions",
        json={"expected_revision": saved.json()["revision"], "change_summary": "虚构事实验收"},
    )
    assert submitted.status_code == 201, submitted.text
    approved = api.admin.post(
        f"/api/v1/fact-versions/{submitted.json()['id']}/approve",
        json={"expected_revision": 0, "comment": "虚构批准记录"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "APPROVED"
    before = product_facts_snapshot(api)
    assert before[1] and len(before[2]) == 2

    own_brand = api.create(subject_type="OWN_BRAND")
    own = api.admin.post(
        PREFIX,
        json={
            "subject_type": "OWN_PRODUCT",
            "product_id": str(api.product_id),
            "parent_subject_id": own_brand["id"],
            "description": "只描述监测用途，不是事实正文",
        },
    )
    assert own.status_code == 201, own.text
    sid = own.json()["id"]
    assert product_facts_snapshot(api) == before
    parent_before = catalog_state(api, sid)
    duplicate = api.admin.post(
        PREFIX, json={"subject_type": "OWN_PRODUCT", "product_id": str(api.product_id)}
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "GEO_SUBJECT_PRODUCT_EXISTS"
    assert catalog_state(api, sid) == parent_before
    assert product_facts_snapshot(api) == before

    alias = api.admin.post(
        f"{PREFIX}/{sid}/aliases",
        json={"expected_revision": 0, "alias": "  ＰＳ-106  ", "alias_kind": "PART_NUMBER"},
    )
    assert alias.status_code == 200, alias.text
    domain = api.admin.post(
        f"{PREFIX}/{sid}/domains",
        json={
            "expected_revision": 1,
            "hostname": "产品.example.invalid",
            "relation_type": "OFFICIAL",
        },
    )
    assert domain.status_code == 200, domain.text
    edited = api.admin.patch(
        f"{PREFIX}/{sid}",
        json={
            "subject_type": "OWN_PRODUCT",
            "expected_revision": 2,
            "description": "更新监测说明，仍不触及事实",
        },
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["revision"] == 3
    assert product_facts_snapshot(api) == before

    competitor_brand = api.create(subject_type="COMPETITOR_BRAND")
    competitor = api.create(parent_subject_id=competitor_brand["id"])
    assert competitor["product_id"] is None
    assert api.admin.post(
        f"{PREFIX}/{sid}/disable", json={"expected_revision": 3}
    ).status_code == 200
    assert api.admin.post(
        f"{PREFIX}/{sid}/enable", json={"expected_revision": 4}
    ).status_code == 200
    assert product_facts_snapshot(api) == before

    readonly = api.engineer.get(f"{PREFIX}/{sid}")
    assert readonly.status_code == 200
    assert readonly.json()["available_actions"] == []
    assert readonly.json()["aliases"][0]["alias"] == "PS-106"
    assert "facts_body_markdown" not in readonly.json()
    product = api.admin.get(product_path).json()
    assert {"type": "GEO_SUBJECT", "count": 1} in product["deletion"]["blockers"]
    with api.factory() as db:
        assert db.scalar(
            text(
                "SELECT count(*) FROM geo_subjects "
                "WHERE product_id=:id AND subject_type='OWN_PRODUCT' AND is_active"
            ),
            {"id": api.product_id},
        ) == 1
