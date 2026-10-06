"""703真实栈的离线规则评估夹具；只接受本轮拥有的随机虚构数据库。"""

import json
import os
import sys
from urllib.parse import urlsplit
from uuid import UUID

import psycopg
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.identity import User
from app.schemas.geo_insights import GeoOverviewFilters
from app.services.geo_opportunities import evaluate_opportunities
from tests.geo_e2e_environment import DATABASE_PATTERN, TOKEN_PATTERN


def validate_owned_database() -> None:
    """命名不是授权：PG comment必须与本轮owner token一致；不输出凭据。"""
    url = os.environ.get("DATABASE_URL", "")
    parsed = urlsplit(url)
    database = parsed.path.removeprefix("/")
    token = os.environ.get("PARTSIGNAL_E2E_DATABASE_OWNER_TOKEN", "")
    if (
        os.environ.get("APP_ENV") != "test"
        or not DATABASE_PATTERN.fullmatch(database)
        or not TOKEN_PATTERN.fullmatch(token)
        or parsed.fragment
        or parsed.scheme not in {"postgresql", "postgresql+psycopg"}
        or not settings.geo_opportunity_evaluation_enabled
    ):
        raise ValueError("机会E2E评估只允许显式test、本轮拥有的随机数据库和独立进程评估开关")
    with psycopg.connect(
        url.replace("postgresql+psycopg://", "postgresql://", 1), connect_timeout=5
    ) as conn:
        row = conn.execute(
            "SELECT current_database(), shobj_description(oid, 'pg_database') "
            "FROM pg_database WHERE datname=current_database()"
        ).fetchone()
    if row != (database, f"partsignal-e2e-owner:{token}"):
        raise ValueError("机会E2E数据库实际归属不匹配")


def main() -> None:
    validate_owned_database()
    run_id = UUID(sys.argv[1])
    with SessionLocal() as db:
        run = db.get(GeoObservationRun, run_id)
        if run is None or "GEOR4-" not in run.input_snapshot["prompt"]["prompt_text"]:
            raise ValueError("机会E2E仅评估API创建的虚构参数核验运行")
        batch = db.get(GeoObservationBatch, run.batch_id)
        assert batch is not None
        actor = db.get(User, batch.created_by)
        assert actor is not None
        subject_ids = [UUID(row["id"]) for row in run.input_snapshot["subjects"]]
        from datetime import UTC, datetime

        filters = GeoOverviewFilters(
            date_from=datetime(2020, 1, 1, tzinfo=UTC),
            date_to=datetime(2100, 1, 1, tzinfo=UTC),
            subject_ids=subject_ids,
        )
        results = evaluate_opportunities(
            db, filters, actor=actor, request_id=f"geo-opportunity-seed-{run_id}"
        )
        from app.models.geo_opportunities import GeoOpportunityEvaluation

        value = db.scalar(
            select(GeoOpportunityEvaluation).where(
                GeoOpportunityEvaluation.id.in_([result.evaluation_id for result in results]),
                GeoOpportunityEvaluation.result_snapshot["rule_code"].as_string()
                == "CRITICAL_FACT_ERROR",
            )
        )
        if value is None or value.opportunity_id is None:
            raise ValueError("虚构核验没有生成严重事实错误机会")
        print(json.dumps({"opportunity_id": str(value.opportunity_id), "run_id": str(run_id)}))


if __name__ == "__main__":
    main()
