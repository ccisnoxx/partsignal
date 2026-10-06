"""分析 Worker 的数据库信任边界和不可变历史负例。"""

import traceback
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.models.geo_analysis_worker import GeoAnalysisJob
from app.models.geo_answers import GeoAnswerCitation
from app.models.product_facts import FactVersion
from app.services import geo_analysis_dispatch as dispatch
from app.services import geo_analysis_runs as runs
from tests.integration.geo_analysis_worker_support import analysis_engine as analysis_engine
from tests.integration.geo_analysis_worker_support import answer_database as answer_database
from tests.integration.geo_analysis_worker_support import harness as harness
from tests.integration.geo_analysis_worker_support import plan_database as plan_database
from tests.integration.geo_analysis_worker_support import run_database as run_database

pytestmark = pytest.mark.integration


def rejected(harness, statement, values, constraint):
    with pytest.raises(IntegrityError) as error, harness.factory.begin() as db:
        db.execute(text(statement), values)
    expected = (constraint,) if isinstance(constraint, str) else constraint
    assert error.value.orig.diag.constraint_name in expected


def test_lease_token_and_expiry_checked_before_scanner(harness, monkeypatch):
    case = harness.create(answer_text="虚构资料。")
    identity = runs.prepare_collected_run(case.run_id)
    lease = runs.claim_analysis_revision(identity)
    result = harness.result(identity)
    wrong = replace(lease, token=uuid4())
    assert not runs.submit_analysis_result(wrong, result)
    assert not runs.submit_analysis_failure(wrong)
    with monkeypatch.context() as scope:
        scope.setattr(runs, "database_now", lambda _: datetime.now(UTC) + timedelta(minutes=10))
        assert not runs.submit_analysis_result(lease, result)
        assert not runs.submit_analysis_failure(lease)
    assert harness.analysis(identity).status == "PENDING"
    assert runs.submit_analysis_result(lease, result)


def test_lease_release_cannot_commit_pending_revision(harness):
    case = harness.create(answer_text="虚构资料。")
    identity = runs.prepare_collected_run(case.run_id)
    lease = runs.claim_analysis_revision(identity)
    rejected(
        harness,
        "UPDATE geo_analysis_jobs SET lease_token=NULL,lease_expires_at=NULL "
        "WHERE analysis_revision_id=:id",
        {"id": identity},
        ("ck_geo_analysis_jobs_assembly", "ck_geo_analysis_jobs_run_lease"),
    )
    rejected(
        harness,
        "UPDATE geo_analysis_jobs SET lease_token=:token WHERE analysis_revision_id=:id",
        {"id": identity, "token": uuid4()},
        "ck_geo_analysis_jobs_immutable",
    )
    assert runs.submit_analysis_result(lease, harness.result(identity))


def test_revision_failure_cannot_leave_first_run_analyzing(harness):
    case = harness.create(answer_text="虚构资料。")
    identity = runs.prepare_collected_run(case.run_id)
    lease = runs.claim_analysis_revision(identity)
    with pytest.raises(IntegrityError) as error, harness.factory.begin() as db:
        runs.lock_analysis(db, identity)
        db.execute(
            text(
                "UPDATE geo_analysis_jobs SET lease_token=NULL,lease_expires_at=NULL "
                "WHERE analysis_revision_id=:id"
            ),
            {"id": identity},
        )
        db.execute(
            text(
                "UPDATE geo_analysis_revisions SET status='FAILED',finished_at=clock_timestamp(),"
                "error_code='ANALYSIS_FAILED',error_summary='虚构失败' WHERE id=:id"
            ),
            {"id": identity},
        )
    assert error.value.orig.diag.constraint_name == "ck_geo_analysis_jobs_run_lease"
    assert harness.analysis(identity).status == "PENDING"
    assert harness.run(case.run_id).status == "ANALYZING"
    assert runs.submit_analysis_failure(lease)


@pytest.mark.parametrize(
    "change",
    [
        "lease_token=:token",
        "status='COMPLETED',finished_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL",
    ],
)
def test_run_only_change_cannot_break_active_analysis_lease(harness, change):
    case = harness.create(answer_text="虚构资料。")
    identity = runs.prepare_collected_run(case.run_id)
    lease = runs.claim_analysis_revision(identity)
    rejected(
        harness,
        f"UPDATE geo_observation_runs SET {change},revision=revision+1 WHERE id=:id",
        {"id": case.run_id, "token": uuid4()},
        "ck_geo_analysis_jobs_run_lease",
    )
    assert runs.submit_analysis_result(lease, harness.result(identity))


def test_citation_own_answer_scope_and_atomic_completion(harness):
    case = harness.create(answer_text="虚构资料。", citation_urls=("https://example.com/a",))
    other = harness.create(answer_text="另一虚构资料。", citation_urls=("https://other.example/a",))
    identity = runs.prepare_collected_run(case.run_id)
    with harness.factory() as db:
        own = db.scalar(
            select(GeoAnswerCitation.id).where(
                GeoAnswerCitation.answer_snapshot_id == case.answer_id
            )
        )
        foreign = db.scalar(
            select(GeoAnswerCitation.id).where(
                GeoAnswerCitation.answer_snapshot_id == other.answer_id
            )
        )
    statement = (
        "INSERT INTO geo_citation_classifications"
        "(analysis_revision_id,citation_id,source_category,subject_id) "
        "VALUES (:id,:citation,'UNKNOWN',:subject)"
    )
    rejected(
        harness,
        statement,
        {"id": identity, "citation": foreign, "subject": None},
        "ck_geo_citation_classifications_answer",
    )
    rejected(
        harness,
        statement,
        {"id": identity, "citation": own, "subject": harness.database.runs.plan.subjects[1]},
        "ck_geo_citation_classifications_subject",
    )
    rejected(
        harness,
        statement,
        {"id": identity, "citation": own, "subject": None},
        "ck_geo_citation_classifications_complete",
    )
    rejected(
        harness,
        "UPDATE geo_analysis_revisions SET status='COMPLETED',finished_at=clock_timestamp() "
        "WHERE id=:id",
        {"id": identity},
        "ck_geo_citation_classifications_assembly",
    )
    runs.process_analysis_revision(identity)
    runs.process_analysis_run(other.run_id)


@pytest.mark.parametrize("table", ["geo_citation_classifications", "geo_analysis_jobs"])
@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
def test_terminal_execution_and_citation_history_immutable(harness, table, operation):
    case = harness.create(answer_text="虚构资料。", citation_urls=("https://example.com/a",))
    runs.process_analysis_run(case.run_id)
    identity = harness.run(case.run_id).current_analysis_revision_id
    if operation == "UPDATE":
        change = (
            "source_category='OWNED'"
            if table == "geo_citation_classifications"
            else "dispatch_attempt_count=dispatch_attempt_count+1"
        )
        statement = f"UPDATE {table} SET {change} WHERE analysis_revision_id=:id"
    else:
        statement = f"DELETE FROM {table} WHERE analysis_revision_id=:id"
    constraint = (
        "ck_geo_citation_classifications_immutable"
        if table == "geo_citation_classifications"
        else (
            "ck_geo_analysis_jobs_open"
            if operation == "UPDATE"
            else "ck_geo_analysis_jobs_immutable"
        )
    )
    rejected(harness, statement, {"id": identity}, constraint)


def test_bound_fact_remains_historical_after_retirement(harness):
    case = harness.create(products=1, answer_text="GEO501-0 的供电电压为 5 V。")
    identity = runs.prepare_collected_run(case.run_id)
    with harness.factory.begin() as db:
        fact = db.get(FactVersion, case.facts[0])
        fact.status = "RETIRED"
        fact.revision += 1
    runs.process_analysis_revision(identity)
    assert harness.analysis(identity).status == "COMPLETED"
    assert harness.analysis(identity).input_snapshot["fact_versions"][0]["fact_version_id"] == str(
        case.facts[0]
    )


def test_failed_first_analysis_reanalyze_does_not_regress_run(harness):
    case = harness.create(answer_text="虚构资料。")
    identity = runs.prepare_collected_run(case.run_id)
    lease = runs.claim_analysis_revision(identity)
    assert runs.submit_analysis_failure(lease)
    failed = harness.run(case.run_id)
    second = harness.reanalyze(case.run_id)
    rerun = runs.claim_analysis_revision(second)
    with harness.factory() as db:
        job = db.get(GeoAnalysisJob, second)
        assert job.lease_token == rerun.token
    assert harness.run(case.run_id).lease_token is None
    assert runs.submit_analysis_result(rerun, harness.result(second))
    state = harness.run(case.run_id)
    assert state.status == "FAILED" and state.finished_at == failed.finished_at
    assert state.error_code == "ANALYSIS_FAILED" and state.current_analysis_revision_id == second


def test_expired_reanalysis_retains_successful_current_pointer(harness):
    case = harness.create(answer_text="虚构资料。")
    runs.process_analysis_run(case.run_id)
    first = harness.run(case.run_id).current_analysis_revision_id
    second = harness.reanalyze(case.run_id)
    lease = runs.claim_analysis_revision(second)
    assert (
        dispatch.recover_expired_analysis_revisions(now=datetime.now(UTC) + timedelta(minutes=10))
        == 1
    )
    assert not runs.submit_analysis_result(lease, harness.result(second))
    assert harness.run(case.run_id).status == "COMPLETED"
    assert harness.run(case.run_id).current_analysis_revision_id == first
    assert harness.analysis(second).status == "FAILED"


def test_failure_recording_outage_is_explicit_and_does_not_expose_original_error(
    harness, monkeypatch
):
    case = harness.create(answer_text="虚构资料。")
    identity = runs.prepare_collected_run(case.run_id)
    canary = "geo506-private-answer-canary"

    def broken_analysis(_value):
        raise RuntimeError(canary)

    def broken_failure(_lease):
        raise DBAPIError("虚构数据库语句", {"answer": canary}, RuntimeError(canary))

    with monkeypatch.context() as scope:
        scope.setattr(runs.execution, "analyze", broken_analysis)
        scope.setattr(runs, "submit_analysis_failure", broken_failure)
        with pytest.raises(RuntimeError, match="分析失败记录未提交") as error:
            runs.process_analysis_revision(identity)
    assert canary not in "".join(traceback.format_exception(error.value))
    assert harness.analysis(identity).status == "PENDING"
    assert harness.run(case.run_id).status == "ANALYZING"
    with harness.factory() as db:
        assert db.scalar(
            text("SELECT count(*) FROM geo_answer_snapshots WHERE id=:id"),
            {"id": case.answer_id},
        ) == 1
    assert dispatch.recover_expired_analysis_revisions(
        now=datetime.now(UTC) + timedelta(minutes=10)
    ) == 1
    assert harness.analysis(identity).status == "FAILED"
