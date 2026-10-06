"""首次机会基线保存完整合格Run/analysis/review，后续复核仅追加。"""

from copy import deepcopy
from uuid import UUID

import psycopg
import pytest
from psycopg.types.json import Jsonb
from sqlalchemy import select

from app.models.geo_opportunities import GeoOpportunity, GeoOpportunitySource
from app.services.geo_analysis_runs import process_analysis_run
from tests.integration.geo_analysis_support import AnalysisCase
from tests.integration.geo_answers_support import citation, collect, snapshot
from tests.integration.geo_runs_support import batch, run
from tests.integration.test_geo_catalog import insert_row
from tests.integration.test_geo_opportunities import (
    analysis_engine,
    answer_database,
    api,
    critical,
    evaluate,
    harness,
    overview_api,
    plan_database,
    prepared,
    review_api,
    run_database,
)
from tests.integration.test_geo_reviews import empty_correction

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


def test_initial_critical_baseline_keeps_nonerror_run_after_later_review(api):
    error, filters, _ = prepared(api)
    database = api.harness.database.runs
    with psycopg.connect(database.url) as conn:
        frozen = conn.execute(
            "SELECT input_snapshot FROM geo_observation_runs WHERE id=%s", (error.run_id,)
        ).fetchone()[0]
        plan = conn.execute(
            "SELECT b.plan_snapshot FROM geo_observation_runs r JOIN geo_observation_batches b "
            "ON b.id=r.batch_id WHERE r.id=%s",
            (error.run_id,),
        ).fetchone()[0]
        root = batch(conn, database, plan_snapshot=Jsonb(plan))
        for s in frozen["subjects"]:
            insert_row(
                conn,
                "geo_batch_subjects",
                {"batch_id": root, "subject_id": UUID(s["id"]), "role": s["role"]},
            )
        identity = run(conn, database, root, input_snapshot=Jsonb(frozen))
        answer = snapshot(
            conn,
            api.harness.database,
            identity,
            answer_text="推荐 GEO501-0，供电电压为 5 V。",
            citation_count=1,
        )
        citation(
            conn,
            answer,
            original_url="https://example.com/geo507",
            normalized_url="https://example.com/geo507",
        )
        collect(conn, identity)
    process_analysis_run(identity)
    accurate = AnalysisCase(identity, answer, deepcopy(error.input), error.facts)
    claim = api.detail(accurate)["analysis"]["revisions"][0]["claims"][0]
    correction = empty_correction(
        claims=[
            dict(
                claim_assessment_id=claim["id"],
                verdict="ACCURATE",
                severity="HIGH",
                explanation="虚构复核",
            )
        ]
    )
    assert (
        api.submit(accurate, decision="CORRECTED", correction_payload=correction).status_code == 201
    )
    result = critical(api, evaluate(api, filters))
    assert (result.result_snapshot["numerator"], result.result_snapshot["denominator"]) == (1, 2)
    with api.harness.factory() as db:
        first = deepcopy(db.get(GeoOpportunity, result.opportunity_id).trigger_snapshot)
        assert {UUID(s["run_id"]) for s in first["sources"]} == {error.run_id, accurate.run_id}
        saved = list(
            db.scalars(
                select(GeoOpportunitySource).where(
                    GeoOpportunitySource.opportunity_id == result.opportunity_id
                )
            )
        )
        assert len(saved) == 2 and all(s.analysis_revision_id and s.review_id for s in saved)
    correction["claims"][0]["verdict"] = "INCORRECT"
    assert (
        api.submit(accurate, decision="CORRECTED", correction_payload=correction).status_code == 201
    )
    assert critical(api, evaluate(api, filters)).disposition == "UPDATED"
    with api.harness.factory() as db:
        assert db.get(GeoOpportunity, result.opportunity_id).trigger_snapshot == first
        saved = list(
            db.scalars(
                select(GeoOpportunitySource).where(
                    GeoOpportunitySource.opportunity_id == result.opportunity_id
                )
            )
        )
        assert len(saved) == 3
