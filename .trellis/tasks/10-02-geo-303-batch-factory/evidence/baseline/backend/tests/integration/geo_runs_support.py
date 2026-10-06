"""运行模型直接 PostgreSQL 反例的最小既有资源与冻结输入。"""

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.types.json import Jsonb

from app.schemas.geo_runs import GeoRunInputSnapshot
from tests.integration.test_geo_catalog import insert_row
from tests.integration.test_geo_monitoring_plans import PlanDatabase, existing_rows, plan_database
from tests.integration.test_migrations import run_alembic
from tests.unit.test_geo_run_contract import input_snapshot, plan_snapshot

__all__ = ["plan_database", "run_database", "connection"]
BATCH = "geo_observation_batches"
RUN = "geo_observation_runs"


@dataclass
class RunDatabase:
    plan: PlanDatabase
    input: dict[str, Any]
    before: list[Any]

    @property
    def url(self) -> str:
        return self.plan.url


@pytest.fixture(scope="module")
def run_database(plan_database: PlanDatabase) -> Iterator[RunDatabase]:
    db = plan_database
    value = input_snapshot()
    with psycopg.connect(db.url) as conn:
        topic = conn.execute(
            "SELECT query_topic_id FROM geo_prompt_variants WHERE id=%s", (db.prompt,)
        ).fetchone()[0]
        surface = conn.execute(
            "SELECT engine_surface_id FROM geo_collection_profiles WHERE id=%s", (db.profile,)
        ).fetchone()[0]
        value["prompt"].update(id=str(db.prompt), query_topic_id=str(topic))
        value["profile"]["id"] = str(db.profile)
        value["profile"]["surface"]["id"] = str(surface)
        value["subjects"][0]["id"] = str(db.subjects[0])
        product = uuid4()
        insert_row(
            conn,
            "products",
            {
                "id": product,
                "part_number": "GEO301",
                "normalized_part_number": "geo301",
                "brand": "虚构品牌",
                "normalized_brand": "虚构品牌",
                "category": "测试",
                "status": "ACTIVE",
                "revision": 0,
                "facts_revision": 0,
                "facts_body_markdown": "历史事实",
            },
        )
        conn.execute(
            "INSERT INTO geo_observations (id,observation_kind,query_topic_id,product_id,"
            "actual_prompt,model_name,answer_summary,web_search_enabled,mentioned,"
            "recommendation,accuracy,tested_at,notes,tested_by) VALUES (%s,"
            "'LEGACY_MODEL_RESULT',%s,%s,'原问题','legacy-model','原回答',true,true,"
            "'RECOMMENDED','ACCURATE',now(),'保持旧记录',%s)",
            (uuid4(), topic, product, db.actor),
        )
        before = existing_rows(conn)
    run_alembic(db.env, db.backend_dir, "0048_geo_batches_runs")
    yield RunDatabase(db, GeoRunInputSnapshot.model_validate(value).model_dump(mode="json"), before)


@pytest.fixture
def connection(run_database: RunDatabase) -> Iterator[psycopg.Connection[Any]]:
    with psycopg.connect(run_database.url) as conn:
        yield conn
        conn.rollback()


def batch(conn: psycopg.Connection[Any], db: RunDatabase, **patch: Any) -> UUID:
    identity = uuid4()
    insert_row(
        conn,
        BATCH,
        {
            "id": identity,
            "trigger_type": "MANUAL",
            "created_by": db.plan.actor,
            "requested_run_count": 1,
            "plan_snapshot": Jsonb(plan_snapshot(db.input)),
            "rule_snapshot": Jsonb({"schema_version": 1, "rule_set_revision": 1}),
            **patch,
        },
    )
    return identity


def run(conn: psycopg.Connection[Any], db: RunDatabase, batch_id: UUID, **patch: Any) -> UUID:
    identity = uuid4()
    insert_row(
        conn,
        RUN,
        {
            "id": identity,
            "batch_id": batch_id,
            "prompt_variant_id": db.plan.prompt,
            "collection_profile_id": db.plan.profile,
            "repeat_index": 1,
            "input_snapshot": Jsonb(db.input),
            **patch,
        },
    )
    return identity


def update(conn: psycopg.Connection[Any], identity: UUID, **patch: Any) -> None:
    conn.execute(
        sql.SQL("UPDATE geo_observation_runs SET {}, revision=revision+1 WHERE id=%s").format(
            sql.SQL(",").join(sql.SQL("{}=%s").format(sql.Identifier(k)) for k in patch)
        ),
        (*patch.values(), identity),
    )


def terminal(conn: psycopg.Connection[Any], identity: UUID, status: str, **patch: Any) -> None:
    now = conn.execute("SELECT now()").fetchone()[0]
    fields = {"status": status, "finished_at": now}
    if status == "COMPLETED":
        fields.update(started_at=now, collected_at=now, external_call_state="COMPLETED")
    elif status in {"FAILED", "BUDGET_BLOCKED"}:
        fields.update(
            error_stage="COLLECTION",
            error_code="BUDGET_EXCEEDED" if status == "BUDGET_BLOCKED" else "PROVIDER_TIMEOUT",
            error_summary="虚构失败",
        )
    update(conn, identity, **(fields | patch))
