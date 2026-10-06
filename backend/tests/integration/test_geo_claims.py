"""GEO-505 在隔离 PostgreSQL 上证明事实资格与只读装配。"""

from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.models.product_facts import FactVersion, Product
from app.schemas.geo_runs import GeoRunSubjectSnapshot
from app.services.geo_claims import assess_claims
from app.services.geo_fact_versions import assemble_fact_versions
from tests.integration.geo_analysis_support import collected_case
from tests.integration.geo_answers_support import (
    answer_connection,
    answer_database,
    plan_database,
    run_database,
)
from tests.integration.test_geo_catalog import insert_row

pytestmark = pytest.mark.integration
__all__ = ["answer_connection", "answer_database", "plan_database", "run_database"]


def add_fact(
    conn,
    db,
    product,
    version,
    status="APPROVED",
    body="供电电压为 3.3 V。",
    classification="PUBLIC",
):
    identity = uuid4()
    insert_row(
        conn,
        "fact_versions",
        {
            "id": identity,
            "product_id": product,
            "version": version,
            "status": status,
            "body_markdown": body,
            "classification": classification,
            "change_summary": "虚构事实核验",
            "revision": 0,
            "created_by": db.runs.plan.actor,
            "approved_by": db.runs.plan.actor if status == "APPROVED" else None,
            "approved_at": conn.execute("SELECT now()").fetchone()[0]
            if status == "APPROVED"
            else None,
        },
    )
    return identity


def prepare(conn, db, products=1):
    case = collected_case(conn, db, products=products)
    scope = [GeoRunSubjectSnapshot.model_validate(row) for row in case.input["subjects"]]
    return scope, [row for row in scope if row.product_id is not None]


@pytest.mark.parametrize("classification", ["PUBLIC", "INTERNAL", "RESTRICTED"])
def test_current_approved_nonblank_same_product_only(
    answer_connection, answer_database, classification
):
    conn, db = answer_connection, answer_database
    scope, own = prepare(conn, db, products=2)
    approved = add_fact(conn, db, own[0].product_id, 2, classification=classification)
    second = add_fact(conn, db, own[1].product_id, 2, body="供电电压为 1.8 V。")
    add_fact(conn, db, own[0].product_id, 3, status="PENDING_REVIEW", body="供电电压为 5 V。")
    add_fact(conn, db, own[0].product_id, 4, status="RETIRED")
    add_fact(conn, db, own[0].product_id, 5, status="CHANGES_REQUESTED")
    # APPROVED 空白属于已有 DB 拒绝的非法输入；空白候选另由 unit 防线验证。
    conn.execute(
        "UPDATE products SET facts_body_markdown='供电电压为 9 V。' WHERE id=%s",
        (own[0].product_id,),
    )
    conn.commit()
    analysis_count = conn.execute("SELECT count(*) FROM geo_analysis_revisions").fetchone()[0]
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://"))
    try:
        with Session(engine) as session:
            facts = assemble_fact_versions(session, scope)
            assert {row.fact.id for row in facts.subjects} == {approved, second}
            text = (
                f"{own[0].canonical_name} 的供电电压为 3.3 V。"
                f"{own[1].canonical_name} 的供电电压为 1.8 V。"
            )
            result = assess_claims(text, scope, facts)
            assert [row.verdict for row in result.assessments] == ["ACCURATE", "ACCURATE"]
            assert {row.fact_version_id for row in result.assessments} == {approved, second}
            assert (
                conn.execute("SELECT count(*) FROM geo_analysis_revisions").fetchone()[0]
                == analysis_count
            )
    finally:
        engine.dispose()


def test_column_query_ignores_dirty_identity_map_and_does_not_flush(
    answer_connection, answer_database
):
    conn, db = answer_connection, answer_database
    scope, own = prepare(conn, db)
    fact_id = add_fact(conn, db, own[0].product_id, 2)
    conn.commit()
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://"))
    try:
        with Session(engine) as session:
            cached = session.get(FactVersion, fact_id)
            cached.status = "RETIRED"
            cached.body_markdown = "供电电压为 9 V。"
            pending_product = Product(
                part_number="不应写入",
                normalized_part_number="不应写入",
                brand="虚构",
                normalized_brand="虚构",
                category="虚构",
            )
            session.add(pending_product)
            frozen = assemble_fact_versions(session, scope)
            assert frozen.subjects[0].fact.id == fact_id
            assert frozen.subjects[0].fact.body_markdown == "供电电压为 3.3 V。"
            assert cached in session.dirty and pending_product in session.new
            assert pending_product.id is None
            assert (
                conn.execute(
                    "SELECT body_markdown FROM fact_versions WHERE id=%s", (fact_id,)
                ).fetchone()[0]
                == "供电电压为 3.3 V。"
            )
    finally:
        engine.dispose()


def test_retirement_after_read_excludes_stale_orm_from_new_assembly(
    answer_connection, answer_database
):
    conn, db = answer_connection, answer_database
    scope, own = prepare(conn, db)
    newest = add_fact(conn, db, own[0].product_id, 2)
    conn.commit()
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://"))
    try:
        with Session(engine, expire_on_commit=False) as session:
            cached = session.get(FactVersion, newest)
            original = assemble_fact_versions(session, scope)
            conn.execute(
                "UPDATE fact_versions SET status='RETIRED', revision=revision+1 WHERE id=%s",
                (newest,),
            )
            conn.commit()
            assert cached.status == "APPROVED"
            current = assemble_fact_versions(session, scope)
            assert current.subjects[0].fact.id != newest
            text = f"{own[0].canonical_name} 的供电电压为 3.3 V。"
            assert assess_claims(text, scope, original).assessments[0].verdict == "ACCURATE"
            assert assess_claims(text, scope, current).assessments[0].verdict == "UNJUDGEABLE"
            assert (
                session.scalar(select(FactVersion.status).where(FactVersion.id == newest))
                == "RETIRED"
            )
    finally:
        engine.dispose()
