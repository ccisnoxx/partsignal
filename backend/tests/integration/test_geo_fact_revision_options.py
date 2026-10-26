"""CORE-03：合法选项与既有命令共享保存范围，读取不创建事实或行动。"""

from copy import deepcopy
from hashlib import sha256
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb
from sqlalchemy import event, func, select

from app.main import app
from app.models.geo_catalog import GeoSubject
from app.models.geo_opportunities import GeoOpportunity, GeoOpportunityAction, GeoOpportunitySource
from app.models.product_facts import FactVersion, Product
from tests.integration.geo_answers_support import collect, snapshot
from tests.integration.geo_runs_support import batch, run
from tests.integration.test_geo_catalog import insert_row
from tests.integration.test_geo_opportunity_workbench import (
    PATH,
    analysis_engine,
    answer_database,
    api,
    harness,
    opportunity,
    overview_api,
    plan_database,
    review_api,
    run_database,
)
from tests.unit.test_geo_run_contract import contract as contract
from tests.unit.test_geo_run_contract import plan_snapshot, validate

pytestmark = pytest.mark.integration
__all__ = [
    "analysis_engine",
    "answer_database",
    "api",
    "harness",
    "overview_api",
    "plan_database",
    "review_api",
    "run_database",
]


def options(api, identity):
    response = api.engineer.get(f"{PATH}/{identity}/fact-revision-options")
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    return response.json()


def acknowledge(api, identity):
    result = api.engineer.post(f"{PATH}/{identity}/acknowledge", json={"expected_revision": 1})
    assert result.status_code == 200, result.text


def fact_post(api, identity, revision, product_id, key="core03-fact-key"):
    return api.engineer.post(
        f"{PATH}/{identity}/actions/fact-revision",
        json={
            "expected_revision": revision,
            "product_id": str(product_id),
        },
        headers={"Idempotency-Key": key},
    )


def test_fact_options_are_read_only_use_saved_scope_and_match_existing_command(api, contract):
    case, _, _, identity = opportunity(api)
    assert options(api, identity)["available_action_types"] == []
    acknowledge(api, identity)
    with api.harness.factory() as db:
        before = (
            db.scalar(select(func.count()).select_from(FactVersion)),
            db.scalar(select(func.count()).select_from(GeoOpportunityAction)),
        )
        product_id = db.get(GeoOpportunity, UUID(identity)).trigger_snapshot["scope"]["subject_id"]
        expected = db.get(GeoSubject, UUID(product_id)).product_id
        original = db.get(Product, expected)
        body = original.facts_body_markdown
    sqls, levels = [], []

    def capture(conn, _cursor, statement, _parameters, _context, _many):
        sqls.append(statement)
        levels.append(conn.get_isolation_level())

    engine = api.harness.factory.kw["bind"]
    event.listen(engine, "before_cursor_execute", capture)
    try:
        value = options(api, identity)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert all(sql.lstrip().startswith("SELECT") for sql in sqls)
    assert all(level == "REPEATABLE READ" for level in levels)
    assert value["opportunity_revision"] == 2
    assert value["available_action_types"] == ["FACT_REVISION"]
    assert [row["product_id"] for row in value["products"]] == [str(expected)]
    # 即使机会详情当前来源分页为空，选项仍来自全部保存来源。
    assert (
        api.engineer.get(f"{PATH}/{identity}", params={"source_page": 2}).json()["sources"]["items"]
        == []
    )
    assert options(api, identity)["products"] == value["products"]
    with api.harness.factory() as db:
        assert before == (
            db.scalar(select(func.count()).select_from(FactVersion)),
            db.scalar(select(func.count()).select_from(GeoOpportunityAction)),
        )
    for document in (contract, app.openapi()):
        validate(document, "GeoOpportunityFactRevisionOptions", value)
    result = fact_post(api, identity, value["opportunity_revision"], expected)
    assert result.status_code == 200, result.text
    receipt = result.json()
    assert (
        receipt["action"]["navigation_path"]
        == f"/products/{expected}/facts?source_opportunity_id={identity}"
    )
    replay = fact_post(api, identity, value["opportunity_revision"], expected)
    assert replay.status_code == 200 and replay.json() == receipt | {"replayed": True}
    records = api.engineer.get(f"{PATH}/{identity}").json()["actions"]
    saved = next(item for item in records if item["id"] == receipt["action"]["id"])
    assert saved["source_snapshot"]["product_id"] == str(expected)
    assert saved["navigation_path"] == receipt["action"]["navigation_path"]
    with api.harness.factory() as db:
        assert db.scalar(select(func.count()).select_from(FactVersion)) == before[0]
        assert db.get(Product, expected).facts_body_markdown == body
        assert db.scalar(select(func.count()).select_from(GeoOpportunityAction)) == before[1] + 1


def test_primary_saved_product_does_not_offer_other_source_products_and_inactive_is_removed(api):
    case, _, _, identity = opportunity(api)
    acknowledge(api, identity)
    value = options(api, identity)
    selected = UUID(value["products"][0]["product_id"])
    # 当前其他产品和当前Catalog名称不授权跨产品行动。
    with api.harness.factory.begin() as db:
        other = Product(
            brand="CORE03 Other",
            normalized_brand="core03 other",
            part_number=str(uuid4()),
            normalized_part_number=str(uuid4()),
            category="虚构器件",
            status="ACTIVE",
        )
        db.add(other)
    assert fact_post(api, identity, value["opportunity_revision"], other.id).status_code == 422
    assert [row["product_id"] for row in options(api, identity)["products"]] == [str(selected)]
    with api.harness.factory.begin() as db:
        product = db.get(Product, selected)
        product.status = "INACTIVE"
        product.revision += 1
    refreshed = options(api, identity)
    assert refreshed["products"] == []
    assert fact_post(api, identity, refreshed["opportunity_revision"], selected).status_code == 409
    assert api.anonymous.get(f"{PATH}/{identity}/fact-revision-options").status_code == 401
    assert api.engineer.get(f"{PATH}/{uuid4()}/fact-revision-options").status_code == 404


def test_saved_unscoped_own_product_without_approved_facts_is_a_valid_revision_target(api):
    _, _, _, original_id = opportunity(api)
    with api.harness.factory.begin() as db:
        product = Product(
            brand="CORE03 Draft",
            normalized_brand="core03 draft",
            part_number=str(uuid4()),
            normalized_part_number=str(uuid4()),
            category="虚构器件",
            status="ACTIVE",
        )
        db.add(product)
        db.flush()
        subject = GeoSubject(
            subject_type="OWN_PRODUCT",
            product_id=product.id,
            created_by=api.harness.database.runs.plan.actor,
        )
        db.add(subject)
        db.flush()
        leaf = deepcopy(api.harness.database.runs.input["subjects"][0])
        leaf.update(
            id=str(subject.id),
            revision=subject.revision,
            subject_type="OWN_PRODUCT",
            product_id=str(product.id),
            role="REFERENCE",
            canonical_name="CORE03 Draft",
            display_name="CORE03 Draft",
        )
    # 保存一条没有事实版本绑定的真实采集证据；不调用要求批准核验事实的分析夹具。
    database = api.harness.database
    frozen = deepcopy(database.runs.input)
    frozen["subjects"].append(leaf)
    plan = plan_snapshot(frozen)
    plan["subjects"] = [
        {"subject_id": item["id"], "role": item["role"]} for item in frozen["subjects"]
    ]
    with psycopg.connect(database.url) as conn:
        batch_id = batch(conn, database.runs, plan_snapshot=Jsonb(plan))
        for item in frozen["subjects"]:
            insert_row(
                conn,
                "geo_batch_subjects",
                {
                    "batch_id": batch_id,
                    "subject_id": UUID(item["id"]),
                    "role": item["role"],
                },
            )
        source_run = run(conn, database.runs, batch_id, input_snapshot=Jsonb(frozen))
        snapshot(conn, database, source_run, answer_text="CORE-03 无批准事实的采集来源")
        collect(conn, source_run)
    with api.harness.factory.begin() as db:
        original = db.get(GeoOpportunity, UUID(original_id))
        trigger = deepcopy(original.trigger_snapshot)
        trigger["scope"]["subject_id"] = None
        value = GeoOpportunity(
            identity_key=sha256(str(uuid4()).encode()).hexdigest(),
            status="OPEN",
            trigger_snapshot=trigger,
            subject_id=None,
            **{
                key: getattr(original, key)
                for key in (
                    "rule_code",
                    "priority",
                    "source_date_from",
                    "source_date_to",
                    "query_topic_id",
                    "prompt_variant_id",
                    "collection_profile_id",
                    "engine_surface_id",
                    "batch_id",
                )
            },
        )
        db.add(value)
        db.flush()
        db.add(
            GeoOpportunitySource(
                opportunity_id=value.id, run_id=source_run, source_role="SUPPORTING"
            )
        )
        # 保存原触发来源，新增无批准事实的自有产品作为合法历史支持来源。
        for source in db.scalars(
            select(GeoOpportunitySource).where(GeoOpportunitySource.opportunity_id == original.id)
        ):
            db.add(
                GeoOpportunitySource(
                    opportunity_id=value.id,
                    run_id=source.run_id,
                    analysis_revision_id=source.analysis_revision_id,
                    review_id=source.review_id,
                    source_role=source.source_role,
                )
            )
        identity = str(value.id)
    acknowledge(api, identity)
    read = options(api, identity)
    assert str(product.id) in {item["product_id"] for item in read["products"]}
    with api.harness.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(FactVersion)
                .where(FactVersion.product_id == product.id)
            )
            == 0
        )
    response = fact_post(api, identity, read["opportunity_revision"], product.id)
    assert response.status_code == 200, response.text
    with api.harness.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(FactVersion)
                .where(FactVersion.product_id == product.id)
            )
            == 0
        )
        assert db.get(Product, product.id).facts_body_markdown == ""
