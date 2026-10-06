"""GEO-501 绕过应用层的不可变、归属、唯一和选择反例。"""

from copy import deepcopy
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.types.json import Jsonb
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.identity import User
from app.models.product_facts import FactVersion
from app.services.geo_catalog_queries import subject_references
from app.services.identity import _user_business_reference_counts
from app.services.product_facts import delete_fact_version
from app.services.projections import fact_version_out
from tests.integration.geo_analysis_support import (
    bind,
    collected_case,
    finish,
    pending,
    publish,
    review,
)
from tests.integration.geo_answers_support import (
    answer_connection,
    answer_database,
    plan_database,
    run_database,
)
from tests.integration.test_geo_catalog import insert_row
from tests.unit.test_geo_analysis_contract import corrections

pytestmark = pytest.mark.integration
__all__ = ["answer_connection", "answer_database", "plan_database", "run_database"]


def test_full_results_facts_and_review_separate_from_answer(answer_connection, answer_database):
    conn, db = answer_connection, answer_database
    case = collected_case(conn, db, products=2)
    original = conn.execute(
        "SELECT to_jsonb(a) FROM geo_answer_snapshots a WHERE id=%s", (case.answer_id,)
    ).fetchone()[0]
    analysis = pending(conn, case)
    bind(conn, case, analysis)
    subject = UUID(case.input["subjects"][1]["id"])
    mention, recommendation, claim = uuid4(), uuid4(), uuid4()
    insert_row(
        conn,
        "geo_entity_mentions",
        {
            "id": mention,
            "analysis_revision_id": analysis,
            "subject_id": subject,
            "mention_count": 1,
            "matched_aliases": Jsonb(["GEO501-0"]),
            "first_character_offset": 0,
        },
    )
    insert_row(
        conn,
        "geo_recommendations",
        {
            "id": recommendation,
            "analysis_revision_id": analysis,
            "subject_id": subject,
            "recommendation": "UNKNOWN",
            "rank": None,
        },
    )
    insert_row(
        conn,
        "geo_claim_assessments",
        {
            "id": claim,
            "analysis_revision_id": analysis,
            "subject_id": subject,
            "fact_version_id": case.facts[0],
            "claim_kind": "IDENTITY",
            "claim_text": "虚构声明",
            "verdict": "ACCURATE",
            "severity": "LOW",
            "fact_excerpt": "虚构公开事实",
            "explanation": "依据冻结事实",
        },
    )
    finish(conn, analysis)
    publish(conn, case, analysis)
    reviewed = review(conn, case, analysis, db.runs.plan.actor)
    conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
    assert (
        conn.execute(
            "SELECT to_jsonb(a) FROM geo_answer_snapshots a WHERE id=%s", (case.answer_id,)
        ).fetchone()[0]
        == original
    )
    assert (
        conn.execute(
            "SELECT current_analysis_revision_id FROM geo_observation_runs WHERE id=%s",
            (case.run_id,),
        ).fetchone()[0]
        == analysis
    )
    assert (
        conn.execute(
            "SELECT id FROM geo_run_reviews WHERE analysis_revision_id=%s ORDER BY "
            "created_at DESC,id DESC LIMIT 1",
            (analysis,),
        ).fetchone()[0]
        == reviewed
    )
    for table, identity in [
        ("geo_analysis_revisions", analysis),
        ("geo_entity_mentions", mention),
        ("geo_recommendations", recommendation),
        ("geo_claim_assessments", claim),
        ("geo_run_reviews", reviewed),
    ]:
        for operation in ["UPDATE", "DELETE"]:
            with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
                query = sql.SQL(
                    "UPDATE {} SET id=id WHERE id=%s"
                    if operation == "UPDATE"
                    else "DELETE FROM {} WHERE id=%s"
                ).format(sql.Identifier(table))
                conn.execute(query, (identity,))
    for operation in [
        "UPDATE geo_analysis_fact_versions SET fact_version_id=fact_version_id",
        "DELETE FROM geo_analysis_fact_versions",
    ]:
        with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
            conn.execute(operation + " WHERE analysis_revision_id=%s", (analysis,))
    with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
        insert_row(
            conn,
            "geo_entity_mentions",
            {
                "id": uuid4(),
                "analysis_revision_id": analysis,
                "subject_id": subject,
                "mention_count": 1,
                "matched_aliases": Jsonb(["晚到结果"]),
            },
        )


def test_pending_input_frozen_and_children_cannot_commit_partial(
    answer_connection, answer_database
):
    conn = answer_connection
    case = collected_case(conn, answer_database)
    analysis = pending(conn, case)
    with pytest.raises(psycopg.errors.CheckViolation) as error, conn.transaction():
        conn.execute(
            "UPDATE geo_analysis_revisions SET analyzer_version='changed' WHERE id=%s", (analysis,)
        )
    assert error.value.diag.constraint_name == "ck_geo_analysis_immutable"
    with pytest.raises(psycopg.errors.CheckViolation) as error, conn.transaction():
        insert_row(
            conn,
            "geo_entity_mentions",
            {
                "id": uuid4(),
                "analysis_revision_id": analysis,
                "subject_id": UUID(case.input["subjects"][0]["id"]),
                "mention_count": 1,
                "matched_aliases": Jsonb(["虚构品牌"]),
            },
        )
        conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
    assert error.value.diag.constraint_name == "ck_geo_analysis_results_complete"
    finish(conn, analysis, failed=True)
    with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
        finish(conn, analysis)


def test_unique_revision_subject_and_success_input(answer_connection, answer_database):
    conn = answer_connection
    case = collected_case(conn, answer_database)
    analysis = pending(conn, case)
    with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
        pending(conn, case, revision=1)
    subject = UUID(case.input["subjects"][0]["id"])
    for table, values in [
        ("geo_entity_mentions", {"mention_count": 1, "matched_aliases": Jsonb(["虚构品牌"])}),
        ("geo_recommendations", {"recommendation": "UNKNOWN"}),
    ]:
        insert_row(
            conn,
            table,
            {"id": uuid4(), "analysis_revision_id": analysis, "subject_id": subject, **values},
        )
        with pytest.raises(psycopg.errors.UniqueViolation), conn.transaction():
            insert_row(
                conn,
                table,
                {"id": uuid4(), "analysis_revision_id": analysis, "subject_id": subject, **values},
            )
    finish(conn, analysis)
    duplicate = pending(conn, case)
    with pytest.raises(psycopg.errors.UniqueViolation) as error, conn.transaction():
        finish(conn, duplicate)
    assert error.value.diag.constraint_name == "uq_geo_analysis_success_input"
    finish(conn, duplicate, failed=True)
    assert (
        conn.execute(
            "SELECT count(*) FROM geo_analysis_revisions WHERE run_id=%s", (case.run_id,)
        ).fetchone()[0]
        == 2
    )
    conn.execute("SET CONSTRAINTS ALL IMMEDIATE")


def test_pointer_latest_success_failure_and_stale_review(answer_connection, answer_database):
    conn = answer_connection
    db = answer_database
    case = collected_case(conn, db)
    first = pending(conn, case)
    finish(conn, first)
    publish(conn, case, first)
    old_review = review(conn, case, first, db.runs.plan.actor)
    failed = pending(conn, case, analyzer_version="fixture-v2")
    finish(conn, failed, failed=True)
    assert (
        conn.execute(
            "SELECT current_analysis_revision_id FROM geo_observation_runs WHERE id=%s",
            (case.run_id,),
        ).fetchone()[0]
        == first
    )
    for target in [failed, None]:
        with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
            publish(conn, case, target)
    latest = pending(conn, case, analyzer_version="fixture-v3")
    finish(conn, latest)
    publish(conn, case, latest)
    for target in [first, failed]:
        with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
            publish(conn, case, target)
    with pytest.raises(psycopg.errors.CheckViolation) as error, conn.transaction():
        review(conn, case, first, db.runs.plan.actor)
    assert error.value.diag.constraint_name == "ck_geo_reviews_current_analysis"
    assert (
        conn.execute(
            "SELECT id FROM geo_run_reviews WHERE run_id=%s AND "
            "analysis_revision_id=(SELECT current_analysis_revision_id FROM "
            "geo_observation_runs WHERE id=%s)",
            (case.run_id, case.run_id),
        ).fetchone()
        is None
    )
    assert (
        conn.execute("SELECT id FROM geo_run_reviews WHERE id=%s", (old_review,)).fetchone()[0]
        == old_review
    )


def test_terminal_run_publication_cannot_change_collection(answer_connection, answer_database):
    conn = answer_connection
    case = collected_case(conn, answer_database)
    conn.execute(
        "UPDATE geo_observation_runs SET "
        "status='COMPLETED',finished_at=now(),revision=revision+1 WHERE id=%s",
        (case.run_id,),
    )
    before = conn.execute(
        "SELECT to_jsonb(r)-ARRAY['current_analysis_revision_id','revision'] "
        "FROM geo_observation_runs r WHERE id=%s",
        (case.run_id,),
    ).fetchone()[0]
    analysis = pending(conn, case)
    finish(conn, analysis)
    with pytest.raises(psycopg.errors.CheckViolation) as error, conn.transaction():
        conn.execute(
            "UPDATE geo_observation_runs SET "
            "current_analysis_revision_id=%s,status='COLLECTED',finished_at=NULL,revision=revision+1"
            " WHERE id=%s",
            (analysis, case.run_id),
        )
    assert error.value.diag.constraint_name == "ck_geo_runs_analysis_publication"
    publish(conn, case, analysis)
    assert (
        conn.execute(
            "SELECT to_jsonb(r)-ARRAY['current_analysis_revision_id','revision'] "
            "FROM geo_observation_runs r WHERE id=%s",
            (case.run_id,),
        ).fetchone()[0]
        == before
    )


def test_wrong_run_subject_and_hash_rejected(answer_connection, answer_database):
    conn = answer_connection
    case = collected_case(conn, answer_database)
    other = collected_case(conn, answer_database)
    for patch in [{"answer_snapshot_id": other.answer_id}, {"revision": 3}]:
        with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
            pending(conn, case, **patch)
    invalid = deepcopy(case.input)
    invalid["answer_sha256"] = "0" * 64
    with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
        pending(conn, case, input_snapshot=Jsonb(invalid))
    analysis = pending(conn, case)
    finish(conn, analysis)
    with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
        publish(conn, other, analysis)


def test_fact_manifest_qualification_claim_binding_and_deletion(answer_connection, answer_database):
    conn = answer_connection
    db = answer_database
    case = collected_case(conn, db, products=2)
    analysis = pending(conn, case)
    with pytest.raises(psycopg.errors.CheckViolation) as error, conn.transaction():
        conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
    assert error.value.diag.constraint_name == "ck_geo_analysis_fact_manifest"
    one, two = case.input["fact_versions"]
    with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
        insert_row(
            conn,
            "geo_analysis_fact_versions",
            {
                "analysis_revision_id": analysis,
                "subject_id": UUID(one["subject_id"]),
                "fact_version_id": UUID(two["fact_version_id"]),
            },
        )
    bind(conn, case, analysis)
    with pytest.raises(psycopg.errors.ForeignKeyViolation), conn.transaction():
        insert_row(
            conn,
            "geo_claim_assessments",
            {
                "id": uuid4(),
                "analysis_revision_id": analysis,
                "subject_id": UUID(one["subject_id"]),
                "fact_version_id": case.facts[1],
                "claim_kind": "PARAMETER",
                "claim_text": "虚构声明",
                "verdict": "ACCURATE",
                "severity": "HIGH",
                "explanation": "虚构依据",
            },
        )
    with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
        insert_row(
            conn,
            "geo_claim_assessments",
            {
                "id": uuid4(),
                "analysis_revision_id": analysis,
                "subject_id": UUID(one["subject_id"]),
                "claim_kind": "PARAMETER",
                "claim_text": "虚构声明",
                "verdict": "ACCURATE",
                "severity": "HIGH",
                "explanation": "无依据",
            },
        )
    finish(conn, analysis)
    conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
    with pytest.raises(psycopg.errors.ForeignKeyViolation), conn.transaction():
        conn.execute("DELETE FROM fact_versions WHERE id=%s", (case.facts[0],))
    conn.execute(
        "UPDATE fact_versions SET status='RETIRED',revision=revision+1 WHERE id=%s",
        (case.facts[0],),
    )
    assert (
        conn.execute(
            "SELECT count(*) FROM geo_analysis_fact_versions WHERE analysis_revision_id=%s",
            (analysis,),
        ).fetchone()[0]
        == 2
    )
    conn.execute("SET CONSTRAINTS ALL DEFERRED")
    next_analysis = pending(conn, case, analyzer_version="fixture-v2")
    with pytest.raises(psycopg.errors.CheckViolation) as error, conn.transaction():
        bind(conn, case, next_analysis)
    assert error.value.diag.constraint_name == "ck_geo_analysis_fact_qualification"


def test_review_corrected_scope_clock_and_reference_projection(answer_connection, answer_database):
    conn = answer_connection
    db = answer_database
    case = collected_case(conn, db)
    analysis = pending(conn, case)
    finish(conn, analysis)
    publish(conn, case, analysis)
    value = corrections()
    value["mentions"][0]["subject_id"] = case.input["subjects"][0]["id"]
    first = review(
        conn,
        case,
        analysis,
        db.runs.plan.actor,
        decision="CORRECTED",
        correction_payload=Jsonb(value),
        created_at="2000-01-01",
    )
    second = review(conn, case, analysis, db.runs.plan.actor, created_at="1999-01-01")
    assert (
        conn.execute(
            "SELECT id FROM geo_run_reviews WHERE analysis_revision_id=%s ORDER BY "
            "created_at DESC,id DESC LIMIT 1",
            (analysis,),
        ).fetchone()[0]
        == second
    )
    assert conn.execute(
        "SELECT created_at > '2026-01-01' FROM geo_run_reviews WHERE id=%s", (first,)
    ).fetchone()[0]
    value["mentions"][0]["subject_id"] = str(uuid4())
    with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
        review(
            conn,
            case,
            analysis,
            db.runs.plan.actor,
            decision="CORRECTED",
            correction_payload=Jsonb(value),
        )
    conn.execute("SET CONSTRAINTS ALL IMMEDIATE")


def test_fact_delete_and_reviewer_history_existing_service_boundary(answer_database):
    db = answer_database
    with psycopg.connect(db.url) as conn:
        case = collected_case(conn, db, products=1)
        analysis = pending(conn, case)
        bind(conn, case, analysis)
        finish(conn, analysis)
        publish(conn, case, analysis)
        review(conn, case, analysis, db.runs.plan.actor)
    engine = create_engine(db.url.replace("postgresql://", "postgresql+psycopg://"))
    try:
        with Session(engine) as session:
            version = session.get(FactVersion, case.facts[0])
            actor = session.get(User, db.runs.plan.actor)
            out = fact_version_out(session, version, can_delete=True)
            subject = UUID(case.input["fact_versions"][0]["subject_id"])
            assert subject_references(session, [subject])[subject].analysis_count == 1
            assert "DELETE" not in out.available_actions
            assert [(x.type, x.count) for x in out.deletion.blockers] == [("GEO_ANALYSIS", 1)]
            with pytest.raises(AppError) as error:
                delete_fact_version(
                    db=session, fact_version_id=version.id, actor=actor, request_id="geo501-test"
                )
            assert error.value.code == "FACT_VERSION_IN_USE"
            assert _user_business_reference_counts(session, [actor.id])[actor.id] >= 1
    finally:
        engine.dispose()


def test_product_with_approved_fact_cannot_omit_binding(answer_connection, answer_database):
    conn = answer_connection
    case = collected_case(conn, answer_database, products=1)
    invalid = deepcopy(case.input)
    invalid["fact_versions"] = []
    with pytest.raises(psycopg.errors.CheckViolation) as error, conn.transaction():
        pending(conn, case, input_snapshot=Jsonb(invalid))
    assert error.value.diag.constraint_name == "ck_geo_analysis_fact_required"
    conn.execute(
        "UPDATE fact_versions SET status='RETIRED',revision=revision+1 WHERE id=%s",
        (case.facts[0],),
    )
    analysis = pending(conn, case, input_snapshot=Jsonb(invalid))
    finish(conn, analysis)
    conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
