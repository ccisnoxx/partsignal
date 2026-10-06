"""PG 输入摘要与复核修正边界；只使用冻结虚构数据。"""

from copy import deepcopy
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

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

pytestmark = pytest.mark.integration
__all__ = ["answer_connection", "answer_database", "plan_database", "run_database"]


def digest(conn, value, analyzer="DETERMINISTIC", version="fixture-v1"):
    return conn.execute(
        "SELECT geo_analysis_input_sha256(%s,%s,%s)", (Jsonb(value), analyzer, version)
    ).fetchone()[0]


def test_hash_covers_frozen_evidence_dictionary_facts_and_configuration(
    answer_connection, answer_database
):
    conn = answer_connection
    case = collected_case(conn, answer_database, products=2)
    analysis = pending(conn, case)
    bind(conn, case, analysis)
    base = conn.execute(
        "SELECT input_sha256 FROM geo_analysis_revisions WHERE id=%s", (analysis,)
    ).fetchone()[0]
    assert base == digest(conn, case.input)
    assert base == digest(conn, dict(reversed(list(case.input.items()))))
    variants = []
    for field in ["answer_sha256", "rule", "alias", "fact", "model"]:
        value = deepcopy(case.input)
        if field == "answer_sha256":
            value["answer_sha256"] = "b" * 64
        elif field == "rule":
            value["configuration"]["rule_set_version"] = "fixture-v2"
        elif field == "alias":
            value["subjects"][0]["aliases"].append(
                {
                    "alias": "虚构新别名",
                    "normalized_alias": "虚构新别名",
                    "alias_kind": "NAME",
                    "language_code": None,
                }
            )
        elif field == "fact":
            value["fact_versions"][0]["fact_version_id"] = str(uuid4())
        else:
            value["configuration"].update(
                model_name="fixture-model",
                model_version="fixture-v1",
                prompt_template_version="fixture-v1",
                prompt_sha256="b" * 64,
            )
        variants.append(digest(conn, value))
    assert (
        len(
            set(
                [
                    base,
                    *variants,
                    digest(conn, case.input, version="fixture-v2"),
                    digest(conn, case.input, analyzer="HYBRID"),
                ]
            )
        )
        == 8
    )


@pytest.mark.parametrize(
    "path", [[], ["configuration"], ["configuration", "parameters"], ["subjects", 0]]
)
def test_sql_rejects_unknown_input_slots(answer_connection, answer_database, path):
    case = collected_case(answer_connection, answer_database)
    value = deepcopy(case.input)
    leaf = value
    for key in path:
        leaf = leaf[key]
    leaf["headers"] = {"Authorization": "fixture-only"}
    assert not answer_connection.execute(
        "SELECT geo_analysis_input_valid(%s)", (Jsonb(value),)
    ).fetchone()[0]
    with pytest.raises(psycopg.errors.CheckViolation) as error, answer_connection.transaction():
        pending(answer_connection, case, input_snapshot=Jsonb(value))
    assert error.value.diag.constraint_name == "ck_geo_analysis_input"


def test_review_claim_must_preserve_same_analysis_fact_basis(answer_connection, answer_database):
    conn = answer_connection
    db = answer_database
    case = collected_case(conn, db)
    analysis = pending(conn, case)
    claim = uuid4()
    insert_row(
        conn,
        "geo_claim_assessments",
        {
            "id": claim,
            "analysis_revision_id": analysis,
            "subject_id": UUID(case.input["subjects"][0]["id"]),
            "claim_kind": "IDENTITY",
            "claim_text": "虚构声明",
            "verdict": "UNJUDGEABLE",
            "severity": "LOW",
            "explanation": "无产品事实依据",
        },
    )
    finish(conn, analysis)
    publish(conn, case, analysis)
    payload = {
        "schema_version": 1,
        "mentions": [],
        "recommendations": [],
        "citations": [],
        "claims": [
            {
                "claim_assessment_id": str(claim),
                "verdict": "ACCURATE",
                "severity": "LOW",
                "explanation": "不能伪造事实依据",
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
        )
    assert error.value.diag.constraint_name == "ck_geo_reviews_correction_scope"
    payload["claims"][0]["verdict"] = "UNJUDGEABLE"
    review(
        conn,
        case,
        analysis,
        db.runs.plan.actor,
        decision="CORRECTED",
        correction_payload=Jsonb(payload),
    )
    conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
