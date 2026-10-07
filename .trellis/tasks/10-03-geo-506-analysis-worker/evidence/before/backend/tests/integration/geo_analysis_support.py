"""GEO-501 离线、虚构、真实 PostgreSQL 分析装配夹具。"""

from copy import deepcopy
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

import psycopg
from psycopg.types.json import Jsonb

from tests.integration.geo_answers_support import AnswerDatabase, collect, snapshot
from tests.integration.geo_runs_support import batch, run
from tests.integration.test_geo_catalog import insert_row
from tests.unit.test_geo_analysis_contract import analysis_input
from tests.unit.test_geo_run_contract import plan_snapshot


@dataclass
class AnalysisCase:
    run_id: UUID
    answer_id: UUID
    input: dict[str, Any]
    facts: list[UUID]


def collected_case(
    conn: psycopg.Connection[Any], db: AnswerDatabase, products: int = 0
) -> AnalysisCase:
    value = deepcopy(db.runs.input)
    facts = []
    for number in range(products):
        product, subject, fact = uuid4(), uuid4(), uuid4()
        insert_row(
            conn,
            "products",
            {
                "id": product,
                "part_number": f"GEO501-{product}",
                "normalized_part_number": str(product),
                "brand": "虚构品牌",
                "normalized_brand": "虚构品牌",
                "category": "虚构器件",
                "status": "ACTIVE",
                "revision": 0,
                "facts_revision": 0,
                "facts_body_markdown": "虚构公开事实",
            },
        )
        insert_row(
            conn,
            "geo_subjects",
            {
                "id": subject,
                "subject_type": "OWN_PRODUCT",
                "product_id": product,
                "created_by": db.runs.plan.actor,
            },
        )
        leaf = deepcopy(value["subjects"][0])
        leaf.update(
            id=str(subject),
            subject_type="OWN_PRODUCT",
            product_id=str(product),
            role="REFERENCE",
            canonical_name=f"GEO501-{number}",
            display_name=f"GEO501-{number}",
        )
        value["subjects"].append(leaf)
        insert_row(
            conn,
            "fact_versions",
            {
                "id": fact,
                "product_id": product,
                "version": 1,
                "status": "APPROVED",
                "classification": "PUBLIC",
                "body_markdown": "虚构公开事实",
                "change_summary": "测试核验依据",
                "revision": 0,
                "created_by": db.runs.plan.actor,
                "approved_by": db.runs.plan.actor,
                "approved_at": conn.execute("SELECT now()").fetchone()[0],
            },
        )
        facts.append(fact)
    plan = plan_snapshot(value)
    plan["subjects"] = [
        {"subject_id": item["id"], "role": item["role"]} for item in value["subjects"]
    ]
    root = batch(conn, db.runs, plan_snapshot=Jsonb(plan))
    for item in value["subjects"]:
        insert_row(
            conn,
            "geo_batch_subjects",
            {"batch_id": root, "subject_id": UUID(item["id"]), "role": item["role"]},
        )
    identity = run(conn, db.runs, root, input_snapshot=Jsonb(value))
    answer = snapshot(conn, db, identity)
    collect(conn, identity)
    frozen = analysis_input()
    frozen["subjects"] = value["subjects"]
    frozen["answer_sha256"] = conn.execute(
        "SELECT answer_sha256 FROM geo_answer_snapshots WHERE id=%s", (answer,)
    ).fetchone()[0]
    frozen["fact_versions"] = [
        {"subject_id": leaf["id"], "fact_version_id": str(fact)}
        for leaf, fact in zip(value["subjects"][1:], facts, strict=True)
    ]
    return AnalysisCase(identity, answer, frozen, facts)


def pending(conn: psycopg.Connection[Any], case: AnalysisCase, **patch: Any) -> UUID:
    revision = conn.execute(
        "SELECT COALESCE(max(revision),0)+1 FROM geo_analysis_revisions WHERE run_id=%s",
        (case.run_id,),
    ).fetchone()[0]
    values = {
        "id": uuid4(),
        "run_id": case.run_id,
        "answer_snapshot_id": case.answer_id,
        "revision": revision,
        "analyzer_type": "DETERMINISTIC",
        "analyzer_version": "fixture-v1",
        "input_snapshot": Jsonb(case.input),
        **patch,
    }
    insert_row(conn, "geo_analysis_revisions", values)
    return values["id"]


def bind(conn: psycopg.Connection[Any], case: AnalysisCase, analysis: UUID) -> None:
    for binding in case.input["fact_versions"]:
        insert_row(
            conn,
            "geo_analysis_fact_versions",
            {
                "analysis_revision_id": analysis,
                "subject_id": UUID(binding["subject_id"]),
                "fact_version_id": UUID(binding["fact_version_id"]),
            },
        )


def finish(conn: psycopg.Connection[Any], analysis: UUID, failed: bool = False) -> None:
    conn.execute(
        "UPDATE geo_analysis_revisions SET status=%s, "
        "finished_at=clock_timestamp(),error_code=%s,error_summary=%s WHERE "
        "id=%s",
        (
            "FAILED" if failed else "COMPLETED",
            "ANALYSIS_FAILED" if failed else None,
            "虚构分析失败" if failed else None,
            analysis,
        ),
    )


def publish(conn: psycopg.Connection[Any], case: AnalysisCase, analysis: UUID) -> None:
    conn.execute(
        "UPDATE geo_observation_runs SET "
        "current_analysis_revision_id=%s,revision=revision+1 WHERE id=%s",
        (analysis, case.run_id),
    )


def review(
    conn: psycopg.Connection[Any], case: AnalysisCase, analysis: UUID, actor: UUID, **patch: Any
) -> UUID:
    values = {
        "id": uuid4(),
        "run_id": case.run_id,
        "analysis_revision_id": analysis,
        "decision": "CONFIRMED",
        "comment": "虚构人工确认",
        "reviewer_id": actor,
        **patch,
    }
    insert_row(conn, "geo_run_reviews", values)
    return values["id"]
