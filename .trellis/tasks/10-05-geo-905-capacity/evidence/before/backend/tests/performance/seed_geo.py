"""复制虚构采集模板，保持所有 FK、CHECK、不可变及 deferred trigger 开启。"""

import os
from pathlib import Path
from typing import Any
from uuid import UUID

import psycopg
from psycopg import sql


def clone(
    conn: psycopg.Connection[Any],
    table: str,
    predicate: str,
    identity: UUID,
    overrides: dict[str, str],
    *,
    selected: str = "true",
) -> None:
    # 只跳过 PostgreSQL 的 generated 列；其余字段来自真实、已验证的虚构模板。
    columns = [
        row[0]
        for row in conn.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name=%s AND is_generated='NEVER' "
            "ORDER BY ordinal_position",
            (table,),
        )
    ]
    conn.execute(
        sql.SQL(
            "INSERT INTO {} ({}) SELECT {} FROM {} t CROSS JOIN seed s WHERE {}=%s AND {}"
        ).format(
            sql.Identifier(table),
            sql.SQL(",").join(map(sql.Identifier, columns)),
            sql.SQL(",").join(
                sql.SQL(overrides[column]) if column in overrides
                else sql.SQL("t.{}").format(sql.Identifier(column))
                for column in columns
            ),
            sql.Identifier(table),
            sql.SQL(predicate),
            sql.SQL(selected),
        ),
        (identity,),
    )


def seed_template(conn: psycopg.Connection[Any], case: Any, offset: int) -> None:
    source = conn.execute(
        "SELECT batch_id,current_analysis_revision_id,status FROM geo_observation_runs WHERE id=%s",
        (case.run_id,),
    ).fetchone()
    batch_id, analysis_id, status = source
    # 100k / 365 天；每批10次重复。模10末两次失败，一次待采集，七次有分析。
    conn.execute(
        "CREATE TEMP TABLE seed ON COMMIT DROP AS SELECT n, "
        "md5('geo607-run-'||n)::uuid run_id, md5('geo607-batch-'||(n/10))::uuid batch_id, "
        "md5('geo607-answer-'||n)::uuid answer_id, md5('geo607-analysis-'||n)::uuid analysis_id, "
        "md5('geo607-citation-'||n)::uuid citation_id, n%%10+1 repeat_index, "
        "timestamptz '2026-10-01' - interval '1 day' * ((n/10)%%365) created_at "
        "FROM generate_series(%s::integer,%s::integer) n",
        (offset, offset + 999),
    )
    clone(conn, "geo_observation_batches", "t.id", batch_id, {
        "id": "s.batch_id", "status": "'PLANNED'", "revision": "0",
        "created_at": "s.created_at", "started_at": "NULL", "finished_at": "NULL",
        "requested_run_count": "10",
        "plan_snapshot": "jsonb_set(t.plan_snapshot,'{repeat_count}','10'::jsonb)",
    }, selected="s.repeat_index=1")
    clone(conn, "geo_batch_subjects", "t.batch_id", batch_id, {"batch_id": "s.batch_id"},
          selected="s.repeat_index=1")
    # 新 Run 必须从 PENDING revision 0 开始；不能直接插入完成态。
    conn.execute(
        "INSERT INTO geo_observation_runs (id,batch_id,prompt_variant_id,collection_profile_id,"
        "repeat_index,input_snapshot,created_at) SELECT s.run_id,s.batch_id,t.prompt_variant_id,"
        "t.collection_profile_id,s.repeat_index,t.input_snapshot,s.created_at "
        "FROM geo_observation_runs t CROSS JOIN seed s WHERE t.id=%s", (case.run_id,),
    )
    collected = "s.repeat_index<=7"
    clone(conn, "geo_answer_snapshots", "t.run_id", case.run_id,
          {"id": "s.answer_id", "run_id": "s.run_id", "collected_at": "now()"},
          selected=collected)
    clone(conn, "geo_answer_citations", "t.answer_snapshot_id", case.answer_id,
          {"id": "s.citation_id", "answer_snapshot_id": "s.answer_id"}, selected=collected)
    conn.execute(
        "UPDATE geo_observation_runs r SET status='COLLECTED',started_at=now(),collected_at=now(),"
        "revision=revision+1 FROM seed s WHERE r.id=s.run_id AND s.repeat_index<=7"
    )
    clone(conn, "geo_analysis_revisions", "t.id", analysis_id, {
        "id": "s.analysis_id", "run_id": "s.run_id", "answer_snapshot_id": "s.answer_id",
        "status": "'PENDING'", "confidence_summary": "NULL",
        "review_required_reasons": "'[]'::jsonb",
        "finished_at": "NULL", "created_at": "now()",
    }, selected=collected)
    conn.execute(
        "INSERT INTO geo_analysis_jobs (analysis_revision_id) SELECT analysis_id FROM seed "
        "WHERE repeat_index<=7"
    )
    conn.execute(
        "UPDATE geo_analysis_jobs j SET claimed_at=now(),lease_token=s.analysis_id,"
        "lease_expires_at=now()+interval '1 hour' FROM seed s "
        "WHERE j.analysis_revision_id=s.analysis_id"
    )
    conn.execute(
        "UPDATE geo_observation_runs r SET status='ANALYZING',lease_token=s.analysis_id,"
        "lease_expires_at=now()+interval '1 hour',revision=revision+1 FROM seed s "
        "WHERE r.id=s.run_id AND s.repeat_index<=7"
    )
    for table in ("geo_analysis_fact_versions", "geo_entity_mentions", "geo_recommendations",
                  "geo_claim_assessments", "geo_citation_classifications"):
        overrides = {"analysis_revision_id": "s.analysis_id"}
        if table in {"geo_entity_mentions", "geo_recommendations", "geo_claim_assessments"}:
            overrides["id"] = "md5(t.id::text||s.run_id::text)::uuid"
        if table == "geo_citation_classifications":
            overrides["citation_id"] = "s.citation_id"
        clone(conn, table, "t.analysis_revision_id", analysis_id, overrides, selected=collected)
    conn.execute(
        "UPDATE geo_analysis_jobs j SET lease_token=NULL,lease_expires_at=NULL FROM seed s "
        "WHERE j.analysis_revision_id=s.analysis_id"
    )
    conn.execute(
        "UPDATE geo_analysis_revisions a SET status='COMPLETED',finished_at=clock_timestamp(),"
        "confidence_summary=t.confidence_summary,review_required_reasons=t.review_required_reasons "
        "FROM geo_analysis_revisions t,seed s WHERE t.id=%s AND a.id=s.analysis_id", (analysis_id,),
    )
    conn.execute(
        "UPDATE geo_observation_runs r SET current_analysis_revision_id=s.analysis_id,"
        "revision=revision+1 FROM seed s WHERE r.id=s.run_id AND s.repeat_index<=7"
    )
    has_review = conn.execute(
        "SELECT EXISTS(SELECT 1 FROM geo_run_reviews WHERE analysis_revision_id=%s)",
        (analysis_id,),
    ).fetchone()[0]
    conn.execute(
        "UPDATE geo_observation_runs r SET status=%s,lease_token=NULL,lease_expires_at=NULL,"
        "finished_at=CASE WHEN %s='COMPLETED' THEN now() ELSE NULL END,revision=revision+1 "
        "FROM seed s WHERE r.id=s.run_id AND s.repeat_index<=7",
        ("NEEDS_REVIEW" if has_review else status, "NEEDS_REVIEW" if has_review else status),
    )
    if has_review:
        clone(conn, "geo_run_reviews", "t.analysis_revision_id", analysis_id, {
            "id": "md5(t.id::text||s.run_id::text)::uuid", "run_id": "s.run_id",
            "analysis_revision_id": "s.analysis_id", "created_at": "clock_timestamp()",
        }, selected=collected)
        conn.execute(
            "UPDATE geo_observation_runs r SET status='COMPLETED',finished_at=now(),"
            "revision=revision+1 "
            "FROM seed s WHERE r.id=s.run_id AND s.repeat_index<=7"
        )
    conn.execute(
        "UPDATE geo_observation_runs r SET status='FAILED',finished_at=now(),"
        "error_stage='COLLECTION',"
        "error_code='PROVIDER_TIMEOUT',error_summary='虚构性能夹具失败',revision=revision+1 "
        "FROM seed s WHERE r.id=s.run_id AND s.repeat_index>=9"
    )


def seed(api: Any, output: Path) -> list[Any]:
    cases = []
    for number in range(20):
        case = api.create(review_required=number % 4 != 3)
        if number % 4 < 2:
            response = api.submit(case)
            assert response.status_code == 201, response.text
        cases.append(case)
        for chunk in range(5):
            with psycopg.connect(api.harness.database.url) as conn:
                seed_template(conn, case, number * 5000 + chunk * 1000)
        print(f"GEO-607 fixture: {(number + 1) * 5000}/100000", flush=True)
    with psycopg.connect(api.harness.database.url, autocommit=True) as conn:
        if os.environ.get("GEO_PERF_PHASE") == "baseline":
            # 仅隔离性能库撤销0057访问路径，重现0056查询计划；业务约束保持完整。
            conn.execute("DROP INDEX IF EXISTS ix_geo_runs_insight_created")
        conn.execute("ANALYZE")
        count = conn.execute("SELECT count(*) FROM geo_observation_runs").fetchone()[0]
        assert count >= 100_000
        rows = conn.execute(
            "SELECT status,count(*) FROM geo_observation_runs GROUP BY status ORDER BY status"
        ).fetchall()
    import json

    output.mkdir(parents=True, exist_ok=True)
    (output / "fixture.json").write_text(json.dumps({
        "seeded_runs": 100_000, "total_runs": count, "days": 365, "products": 20,
        "repeat_count": 10, "status_counts": dict(rows), "constraints_enabled": True,
        "external_provider_calls": 0,
    }, ensure_ascii=False, indent=2) + "\n")
    return cases
