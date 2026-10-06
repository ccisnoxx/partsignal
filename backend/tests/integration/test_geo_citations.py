"""GEO-504：真实 PG 原始引用/冻结字典与追加修正；不接线 Analysis Worker。"""

from copy import deepcopy
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.geo_citation_urls import normalize_citation_url
from app.schemas.geo_analysis import GeoAnalysisInputSnapshot, GeoRunReviewOut, GeoSourceCategory
from app.schemas.geo_answers import GeoAnswerCitationOut
from app.services.geo_analysis import classify_citations
from app.services.geo_citation_rules import (
    CITATION_RULE_VERSION,
    freeze_subject_domains,
    project_citation_corrections,
)
from tests.integration.geo_analysis_support import AnalysisCase, finish, pending, publish, review
from tests.integration.geo_answers_support import (
    answer_connection,
    answer_database,
    citation,
    collect,
    new_run,
    plan_database,
    run_database,
    snapshot,
)
from tests.unit.test_geo_analysis_contract import analysis_input

pytestmark = pytest.mark.integration
__all__ = ["answer_connection", "answer_database", "plan_database", "run_database"]


def citation_case(conn, db):
    run_id = new_run(conn, db)
    answer_id = snapshot(conn, db, run_id, citation_count=2)
    ids = []
    for position, url, occurrences in [
        (1, "HTTPS://docs.geo-fixture-owned.test:443/a#original", [1, 3]),
        (2, "https://geo-fixture-outside.test/geo-fixture-owned.test", [2]),
    ]:
        normalized = normalize_citation_url(url)
        ids.append(
            citation(
                conn,
                answer_id,
                position=position,
                occurrences=occurrences,
                original_url=url,
                normalized_url=normalized.normalized_url,
                hostname=normalized.hostname,
                title="虚构采集标题",
            )
        )
    collect(conn, run_id)
    frozen = analysis_input()
    frozen["subjects"] = deepcopy(db.runs.input["subjects"])
    frozen["subjects"][0]["domains"] = [
        {"hostname": "geo-fixture-owned.test", "relation_type": "OFFICIAL"}
    ]
    frozen["configuration"]["rule_set_version"] = CITATION_RULE_VERSION
    frozen["answer_sha256"] = conn.execute(
        "SELECT answer_sha256 FROM geo_answer_snapshots WHERE id=%s", (answer_id,)
    ).fetchone()[0]
    return AnalysisCase(run_id, answer_id, frozen, []), ids


def raw_citations(conn, case):
    with conn.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            "SELECT * FROM geo_answer_citations WHERE answer_snapshot_id=%s ORDER BY position",
            (case.answer_id,),
        )
        return [GeoAnswerCitationOut.model_validate(row) for row in cursor.fetchall()]


def original_evidence(conn, case):
    return conn.execute(
        "SELECT to_jsonb(a), (SELECT jsonb_agg(to_jsonb(c) ORDER BY position) "
        "FROM geo_answer_citations c WHERE c.answer_snapshot_id=a.id) "
        "FROM geo_answer_snapshots a WHERE id=%s",
        (case.answer_id,),
    ).fetchone()


def test_frozen_pg_input_classifies_citations_without_changing_raw_authority(
    answer_connection, answer_database
):
    conn = answer_connection
    case, ids = citation_case(conn, answer_database)
    original = original_evidence(conn, case)
    analysis = pending(conn, case)
    frozen = GeoAnalysisInputSnapshot.model_validate(
        conn.execute(
            "SELECT input_snapshot FROM geo_analysis_revisions WHERE id=%s", (analysis,)
        ).fetchone()[0]
    )
    machine = classify_citations(raw_citations(conn, case), freeze_subject_domains(frozen.subjects))
    assert [
        (row.evidence.citation_id, row.source_category, row.subject_id) for row in machine.citations
    ] == [
        (ids[0], GeoSourceCategory.OWNED, frozen.subjects[0].id),
        (ids[1], GeoSourceCategory.UNKNOWN, None),
    ]
    assert machine.citations[0].evidence.occurrences == (1, 3)
    assert machine.citations[0].matches[0].match_kind == "SUBDOMAIN"
    finish(conn, analysis)
    publish(conn, case, analysis)
    before_machine = conn.execute(
        "SELECT to_jsonb(a) FROM geo_analysis_revisions a WHERE id=%s", (analysis,)
    ).fetchone()[0]
    corrected = review(
        conn,
        case,
        analysis,
        answer_database.runs.plan.actor,
        decision="CORRECTED",
        comment="虚构人工确认该页面为经销商来源",
        correction_payload=Jsonb(
            {
                "schema_version": 1,
                "mentions": [],
                "recommendations": [],
                "claims": [],
                "citations": [
                    {
                        "citation_id": str(ids[0]),
                        "source_category": "DISTRIBUTOR",
                        "subject_id": None,
                    }
                ],
            }
        ),
    )
    with conn.cursor(row_factory=dict_row) as cursor:
        cursor.execute("SELECT * FROM geo_run_reviews WHERE id=%s", (corrected,))
        human = GeoRunReviewOut.model_validate(cursor.fetchone())
    projected = project_citation_corrections(machine, human.correction_payload.citations)
    assert projected[0].source_category == GeoSourceCategory.DISTRIBUTOR
    assert projected[0].subject_id is None
    assert projected[0].machine.source_category == GeoSourceCategory.OWNED
    assert projected[1].corrected is False
    conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
    assert original_evidence(conn, case) == original
    assert (
        conn.execute(
            "SELECT to_jsonb(a) FROM geo_analysis_revisions a WHERE id=%s", (analysis,)
        ).fetchone()[0]
        == before_machine
    )
    for table, target, constraint in [
        ("geo_answer_citations", ids[0], "ck_geo_citations_immutable"),
        ("geo_answer_snapshots", case.answer_id, "ck_geo_answers_immutable"),
    ]:
        with pytest.raises(psycopg.errors.CheckViolation) as error, conn.transaction():
            conn.execute(f"UPDATE {table} SET id=id WHERE id=%s", (target,))
        assert error.value.diag.constraint_name == constraint


@pytest.mark.parametrize("outside", ["answer", "subject"])
def test_pg_citation_review_scope_and_old_revision_cannot_be_retargeted(
    answer_connection, answer_database, outside
):
    conn, db = answer_connection, answer_database
    case, ids = citation_case(conn, db)
    other, foreign_ids = citation_case(conn, db)
    analysis = pending(conn, case)
    finish(conn, analysis)
    publish(conn, case, analysis)
    payload = {
        "schema_version": 1,
        "mentions": [],
        "recommendations": [],
        "claims": [],
        "citations": [
            {
                "citation_id": str(foreign_ids[0] if outside == "answer" else ids[0]),
                "source_category": "OWNED",
                "subject_id": str(uuid4()) if outside == "subject" else None,
            }
        ],
    }
    with pytest.raises(psycopg.errors.CheckViolation) as error, conn.transaction():
        review(
            conn,
            case,
            analysis,
            db.runs.plan.actor,
            decision="CORRECTED",
            correction_payload=Jsonb(payload),
            comment="虚构非法目标修正",
        )
    assert error.value.diag.constraint_name == "ck_geo_reviews_correction_scope"
    payload["citations"][0].update(
        citation_id=str(ids[0]), subject_id=case.input["subjects"][0]["id"]
    )
    accepted = review(
        conn,
        case,
        analysis,
        db.runs.plan.actor,
        decision="CORRECTED",
        correction_payload=Jsonb(payload),
        comment="虚构来源确认",
    )
    second = pending(conn, case, analyzer_version="fixture-v2")
    finish(conn, second)
    publish(conn, case, second)
    with pytest.raises(psycopg.errors.CheckViolation) as error, conn.transaction():
        review(
            conn,
            case,
            analysis,
            db.runs.plan.actor,
            decision="CORRECTED",
            correction_payload=Jsonb(payload),
            comment="虚构过期修正",
        )
    assert error.value.diag.constraint_name == "ck_geo_reviews_current_analysis"
    assert (
        conn.execute(
            "SELECT correction_payload FROM geo_run_reviews WHERE id=%s", (accepted,)
        ).fetchone()[0]
        == payload
    )
    assert (
        conn.execute(
            "SELECT count(*) FROM geo_run_reviews v JOIN geo_observation_runs r ON r.id=v.run_id "
            "AND r.current_analysis_revision_id=v.analysis_revision_id WHERE r.id=%s",
            (case.run_id,),
        ).fetchone()[0]
        == 0
    )
    assert UUID(case.input["subjects"][0]["id"]) == db.runs.plan.subjects[0]
    conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
