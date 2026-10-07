"""复核发布不允许重写采集终态字段。"""

import psycopg
import pytest

from tests.integration.geo_analysis_support import review
from tests.integration.geo_reviews_support import (
    analysis_engine,
    answer_database,
    harness,
    plan_database,
    review_api,
    run_database,
)

pytestmark = pytest.mark.integration
__all__ = [
    "analysis_engine",
    "answer_database",
    "harness",
    "plan_database",
    "review_api",
    "run_database",
]


@pytest.mark.parametrize(
    "extra",
    [
        "cost_amount=3,cost_currency='USD'",
        "finished_at=clock_timestamp()",
        "error_summary='虚构改写'",
    ],
)
def test_review_cannot_rewrite_terminal_collection_fields(review_api, extra):
    api = review_api
    case = api.create()
    assert api.submit(case).status_code == 201
    original = api.harness.run(case.run_id)
    with psycopg.connect(api.harness.database.url) as conn:
        review(conn, case, original.current_analysis_revision_id, api.engineer_id)
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute(
                f"UPDATE geo_observation_runs SET revision=revision+1,{extra} WHERE id=%s",
                (case.run_id,),
            )
        conn.rollback()
    assert api.harness.run(case.run_id).revision == original.revision
    assert len(api.detail(case)["analysis"]["reviews"]) == 1


def test_needs_review_cannot_complete_without_new_review(review_api):
    api = review_api
    case = api.create()
    with psycopg.connect(api.harness.database.url) as conn:
        with pytest.raises(psycopg.errors.CheckViolation) as failure:
            conn.execute(
                "UPDATE geo_observation_runs SET status='COMPLETED',revision=revision+1,"
                "finished_at=clock_timestamp() WHERE id=%s",
                (case.run_id,),
            )
        assert failure.value.diag.constraint_name == "ck_geo_runs_review_publication"
        conn.rollback()
    assert api.harness.run(case.run_id).status == "NEEDS_REVIEW"
