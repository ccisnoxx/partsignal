"""702真实PG：服务并发、来源追加、不可用记录、状态/历史与迁移防线。"""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import UUID, uuid4

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from psycopg.types.json import Jsonb
from sqlalchemy import event, func, insert, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.sql.dml import Insert

from app.config import settings
from app.db import Base
from app.models.geo_opportunities import GeoOpportunity as Opportunity
from app.models.geo_opportunities import GeoOpportunityEvaluation as Evaluation
from app.models.geo_opportunities import GeoOpportunitySource as Source
from app.models.identity import AuditLog, User
from app.schemas.geo_insights import GeoOverviewFilters
from app.schemas.geo_rules import GeoRuleUpdateRequest
from app.services import geo_opportunities as service
from app.services import geo_rules
from tests.integration.geo_reviews_support import (
    analysis_engine,
    answer_database,
    harness,
    plan_database,
    review_api,
    run_database,
)
from tests.integration.geo_runs_support import batch, run, terminal
from tests.integration.test_geo_catalog import insert_row
from tests.integration.test_geo_overview import overview_api
from tests.integration.test_geo_reviews import empty_correction
from tests.integration.test_migrations import run_alembic
from tests.unit.test_geo_run_contract import plan_snapshot

pytestmark = pytest.mark.integration
__all__ = [
    "analysis_engine",
    "answer_database",
    "harness",
    "plan_database",
    "review_api",
    "run_database",
    "overview_api",
]


@pytest.fixture
def api(overview_api, monkeypatch):
    db = overview_api.harness.database.runs.plan
    run_alembic(db.env, db.backend_dir, "head")
    monkeypatch.setattr(settings, "geo_opportunity_evaluation_enabled", True)
    return overview_api


def prepared(api, severity="HIGH", verdict="INCORRECT"):
    case = api.create()
    claim = api.detail(case)["analysis"]["revisions"][0]["claims"][0]
    correction = empty_correction(
        claims=[
            dict(
                claim_assessment_id=claim["id"],
                verdict=verdict,
                severity=severity,
                explanation="虚构核验",
            )
        ]
    )
    assert api.submit(case, decision="CORRECTED", correction_payload=correction).status_code == 201
    filters = GeoOverviewFilters(
        date_from=datetime(2020, 1, 1, tzinfo=UTC),
        date_to=datetime(2100, 1, 1, tzinfo=UTC),
        subject_ids=[UUID(claim["subject_id"])],
    )
    return case, filters, correction


def evaluate(api, filters, actor_id=None):
    with api.harness.factory() as db:
        actor = db.get(User, actor_id or api.harness.database.runs.plan.actor)
        return service.evaluate_opportunities(
            db, filters, actor=actor, request_id="geo702-evaluate"
        )


def critical(api, results):
    ids = {r.evaluation_id for r in results}
    with api.harness.factory() as db:
        result = db.scalar(
            select(Evaluation).where(
                Evaluation.id.in_(ids),
                Evaluation.result_snapshot["rule_code"].as_string() == "CRITICAL_FACT_ERROR",
            )
        )
        return result


def test_real_rules_persist_full_snapshot_and_unavailable_without_misleading_opportunity(api):
    case, filters, _ = prepared(api, verdict="PARTIAL")
    results = evaluate(api, filters)
    with api.harness.factory() as db:
        rows = list(
            db.scalars(
                select(Evaluation).where(Evaluation.id.in_([r.evaluation_id for r in results]))
            )
        )
        assert rows and not any(r.opportunity_id for r in rows)
        codes = {r.result_snapshot["rule_code"] for r in rows}
        assert "TOPIC_COVERAGE_GAP" in codes and "DATA_QUALITY_PROBLEM" in codes
        gap = next(r for r in rows if r.result_snapshot["rule_code"] == "TOPIC_COVERAGE_GAP")
        assert "INSUFFICIENT_SAMPLE" in gap.result_snapshot["unavailable_reasons"]
        assert gap.disposition == "UNAVAILABLE"
        assert gap.result_snapshot["rule_snapshot"]["configuration"]
        assert (
            db.scalar(
                select(func.count())
                .select_from(Opportunity)
                .where(Opportunity.subject_id.in_(filters.subject_ids))
            )
            == 0
        )


def test_concurrent_service_dedup_replay_and_new_review_append_preserve_first_trigger(
    api, monkeypatch
):
    case, filters, correction = prepared(api)
    original = service._capture
    barrier = Barrier(2)

    def capture(db, request):
        value = original(db, request)
        barrier.wait(timeout=10)
        return value

    monkeypatch.setattr(service, "_capture", capture)
    admin_id = api.harness.database.runs.plan.actor
    with ThreadPoolExecutor(max_workers=2) as pool:
        one = pool.submit(evaluate, api, filters, admin_id)
        two = pool.submit(evaluate, api, filters, admin_id)
        results = [one.result(timeout=20), two.result(timeout=20)]
    monkeypatch.setattr(service, "_capture", original)
    rows = [critical(api, r) for r in results]
    assert rows[0].id == rows[1].id and rows[0].disposition == "CREATED"
    identity = rows[0].opportunity_id
    with api.harness.factory() as db:
        first = db.get(Opportunity, identity)
        frozen = deepcopy(first.trigger_snapshot)
        revision = first.revision
        assert (
            db.scalar(
                select(func.count()).select_from(Source).where(Source.opportunity_id == identity)
            )
            == 1
        )
    assert all(r.replayed for r in evaluate(api, filters))
    assert api.submit(case, decision="CORRECTED", correction_payload=correction).status_code == 201
    updated = critical(api, evaluate(api, filters))
    assert updated.opportunity_id == identity and updated.disposition == "UPDATED"
    with api.harness.factory() as db:
        after = db.get(Opportunity, identity)
        assert after.trigger_snapshot == frozen and after.revision == revision + 1
        sources = list(db.scalars(select(Source).where(Source.opportunity_id == identity)))
        assert len(sources) == 2 and len({s.review_id for s in sources}) == 2
        assert all(s.run_id == case.run_id for s in sources)
    # 当前规则变化只能增加未来评估；首次配置必须保留。
    with api.harness.factory() as db:
        current = geo_rules.get_rules(db)
        config = current.configuration.model_copy(update={"visibility_drop_points": 0.25})
        geo_rules.update_rules(
            db,
            GeoRuleUpdateRequest(expected_revision=current.revision, configuration=config),
            actor=db.get(User, admin_id),
            request_id="geo702-rules",
        )
    future = critical(api, evaluate(api, filters))
    assert future.result_snapshot["rule_snapshot"]["rule_set_revision"] == current.revision + 1
    with api.harness.factory() as db:
        assert db.get(Opportunity, identity).trigger_snapshot == frozen
        assert db.scalar(
            select(func.count()).select_from(AuditLog).where(
                AuditLog.action == "geo_opportunity.opened", AuditLog.target_id == str(identity)
            )
        ) == 1
        assert (
            db.scalar(
                select(func.count()).select_from(Source).where(Source.opportunity_id == identity)
            )
            == 2
        )


def test_period_and_closed_dedup_never_reopen_history(api):
    _, filters, _ = prepared(api)
    first = critical(api, evaluate(api, filters))
    identity = first.opportunity_id
    with api.harness.factory.begin() as db:
        db.execute(
            text(
                "UPDATE geo_opportunities SET status='DISMISSED',revision=revision+1,"
                "resolved_at=clock_timestamp(),resolved_by=:actor,resolution_code='NOT_APPLICABLE',"
                "resolution_comment='虚构关闭原因' WHERE id=:id"
            ),
            {"id": identity, "actor": api.engineer_id},
        )
    suppressed = critical(api, evaluate(api, filters))
    assert suppressed.disposition == "SUPPRESSED" and suppressed.opportunity_id is None
    assert critical(api, evaluate(api, filters)).id == suppressed.id
    newer = filters.model_copy(update={"date_to": filters.date_to + timedelta(days=1)})
    next_period = critical(api, evaluate(api, newer))
    assert next_period.opportunity_id != identity and next_period.disposition == "CREATED"
    with api.harness.factory() as db:
        assert db.get(Opportunity, identity).status == "DISMISSED"


def template(api, filters):
    with api.harness.factory() as db:
        as_of, rules, results = service._capture(db, filters)
    result = next(r for r in results if r.rule_code == "CRITICAL_FACT_ERROR" and r.triggered)
    snapshot = service._snapshot(result, filters, rules)
    scope = {k: v for k, v in snapshot["scope"].items() if k != "environment_key"}
    values = dict(
        identity_key=service.identity_key(
            result.rule_code, result.scope, filters.date_from, filters.date_to
        ),
        rule_code=result.rule_code,
        priority=result.priority,
        trigger_snapshot=snapshot,
        source_date_from=filters.date_from,
        source_date_to=filters.date_to,
        **scope,
    )
    return result, values


def test_partial_unique_is_final_defense_without_application_advisory_lock(api):
    _, filters, _ = prepared(api)
    result, values = template(api, filters)
    barrier = Barrier(2)

    def write():
        with api.harness.factory() as db:
            barrier.wait(timeout=10)
            identity = uuid4()
            try:
                db.execute(insert(Opportunity).values(id=identity, **values))
                service._append_sources(db, identity, result)
                db.commit()
                return "success"
            except IntegrityError as error:
                db.rollback()
                assert error.orig.sqlstate == "23505"
                assert error.orig.diag.constraint_name == "uq_geo_opportunity_open_identity"
                assert (
                    db.scalar(
                        select(func.count())
                        .select_from(Source)
                        .where(Source.opportunity_id == identity)
                    )
                    == 0
                )
                return "duplicate"

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: write(), range(2)))
    assert sorted(outcomes) == ["duplicate", "success"]
    with api.harness.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(Opportunity)
                .where(Opportunity.identity_key == values["identity_key"])
            )
            == 1
        )


def test_expired_closed_same_period_can_create_new_generation_and_replay(api):
    _, filters, _ = prepared(api)
    result, values = template(api, filters)
    old_id = uuid4()
    now = datetime.now(UTC)
    with api.harness.factory.begin() as db:
        db.execute(
            insert(Opportunity).values(
                id=old_id,
                created_at=now - timedelta(days=40),
                last_seen_at=now - timedelta(days=40),
                **values,
            )
        )
        service._append_sources(db, old_id, result)
        db.execute(
            text(
                "UPDATE geo_opportunities SET status='DISMISSED',revision=revision+1,"
                "resolved_at=:closed,resolved_by=:actor,resolution_code='OLD',"
                "resolution_comment='旧周期' "
                "WHERE id=:id"
            ),
            {"id": old_id, "actor": api.engineer_id, "closed": now - timedelta(days=31)},
        )
    first = critical(api, evaluate(api, filters))
    assert first.disposition == "CREATED" and first.opportunity_id != old_id
    second = critical(api, evaluate(api, filters))
    assert first.id == second.id


def test_immutable_state_source_affiliation_and_atomic_rollback(api, monkeypatch):
    case, filters, _ = prepared(api)
    first = critical(api, evaluate(api, filters))
    with api.harness.factory() as db:
        for sql in (
            "UPDATE geo_opportunities SET trigger_snapshot='{}',revision=revision+1 WHERE id=:id",
            "DELETE FROM geo_opportunities WHERE id=:id",
            "UPDATE geo_opportunities SET status='IN_PROGRESS',revision=revision+1 WHERE id=:id",
            "UPDATE geo_opportunities SET status='DISMISSED',revision=revision+1 WHERE id=:id",
        ):
            with pytest.raises(DBAPIError) as failure:
                db.execute(text(sql), {"id": first.opportunity_id})
            assert failure.value.orig.sqlstate in {"23514", "55000"}
            db.rollback()
        source = db.scalar(select(Source).where(Source.opportunity_id == first.opportunity_id))
        with pytest.raises(DBAPIError) as failure:
            db.execute(text("DELETE FROM geo_opportunity_sources WHERE id=:id"), {"id": source.id})
        assert failure.value.orig.sqlstate == "55000"
        db.rollback()
        other_case = api.create()
        with pytest.raises(IntegrityError) as failure:
            db.execute(
                insert(Source).values(
                    id=uuid4(),
                    opportunity_id=first.opportunity_id,
                    run_id=other_case.run_id,
                    analysis_revision_id=source.analysis_revision_id,
                    review_id=source.review_id,
                    source_role="SUPPORTING",
                )
            )
        assert failure.value.orig.diag.constraint_name == "ck_geo_opportunity_source_analysis"
        db.rollback()
    _, new_filters, _ = prepared(api)
    original = service._append_sources

    def fail(db, identity, result):
        original(db, identity, result)
        raise RuntimeError("模拟提交前故障")

    monkeypatch.setattr(service, "_append_sources", fail)
    with pytest.raises(RuntimeError, match="模拟"):
        evaluate(api, new_filters)
    with api.harness.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(Opportunity)
                .where(Opportunity.subject_id.in_(new_filters.subject_ids))
            )
            == 0
        )


def test_model_metadata_and_subject_history_reference_projection(api):
    _, filters, _ = prepared(api)
    critical(api, evaluate(api, filters))
    from app.services.geo_catalog_queries import subject_references

    with api.harness.factory() as db:
        refs = subject_references(db, filters.subject_ids)
        assert refs[filters.subject_ids[0]].opportunity_count == 1
    tables = {
        "geo_opportunities",
        "geo_opportunity_sources",
        "geo_opportunity_actions",
        "geo_opportunity_evaluations",
    }
    engine = api.harness.factory.kw["bind"]
    with engine.connect() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "compare_type": True,
                "compare_server_default": True,
                "include_object": lambda obj, name, kind, reflected, compared: (
                    obj.name in tables if kind == "table" else obj.table.name in tables
                ),
            },
        )
        assert compare_metadata(context, Base.metadata) == []


def test_feature_flag_and_authoritative_identity_boundary(api, monkeypatch):
    _, filters, _ = prepared(api)
    monkeypatch.setattr(settings, "geo_opportunity_evaluation_enabled", False)
    from app.errors import AppError

    with pytest.raises(AppError) as failure:
        evaluate(api, filters)
    assert failure.value.code == "GEO_MONITORING_DISABLED"


def test_subject_filter_does_not_hide_profile_success_interrupting_failure(api):
    case, filters, _ = prepared(api)
    database = api.harness.database.runs
    with psycopg.connect(database.url) as conn:
        frozen = conn.execute(
            "SELECT input_snapshot FROM geo_observation_runs WHERE id=%s", (case.run_id,)
        ).fetchone()[0]
        plan = plan_snapshot(frozen)
        plan["subjects"] = [{"subject_id": s["id"], "role": s["role"]} for s in frozen["subjects"]]
        root = batch(conn, database, plan_snapshot=Jsonb(plan))
        for s in frozen["subjects"]:
            insert_row(
                conn,
                "geo_batch_subjects",
                {"batch_id": root, "subject_id": UUID(s["id"]), "role": s["role"]},
            )
        failed = run(conn, database, root, input_snapshot=Jsonb(frozen))
        terminal(conn, failed, "FAILED")
    later_success = api.create()
    assert api.submit(later_success).status_code == 201
    with api.harness.factory() as db:
        current = geo_rules.get_rules(db)
        config = current.configuration.model_copy(update={"run_failure_consecutive_limit": 1})
        geo_rules.update_rules(
            db,
            GeoRuleUpdateRequest(expected_revision=current.revision, configuration=config),
            actor=db.get(User, database.plan.actor),
            request_id="geo702-governance",
        )
    outcomes = evaluate(api, filters)
    with api.harness.factory() as db:
        failure = db.scalar(
            select(Evaluation).where(
                Evaluation.id.in_([r.evaluation_id for r in outcomes]),
                Evaluation.result_snapshot["rule_code"].as_string() == "RUN_FAILURE",
            )
        )
        assert failure.disposition == "NO_TRIGGER" and failure.opportunity_id is None
        assert failure.result_snapshot["value"] == 0
        assert failure.result_snapshot["details"]["latest_run_id"] == str(later_success.run_id)
        assert failure.result_snapshot["details"]["candidate_run_count"] >= 3


def test_lock_refreshes_preloaded_opportunity_after_other_session_appends_evidence(api):
    case, filters, correction = prepared(api)
    first = critical(api, evaluate(api, filters))
    with api.harness.factory() as db:
        stale = db.get(Opportunity, first.opportunity_id)
        assert stale.revision == 1
        assert (
            api.submit(case, decision="CORRECTED", correction_payload=correction).status_code == 201
        )
        assert critical(api, evaluate(api, filters)).disposition == "UPDATED"
        assert stale.revision == 1
        assert (
            api.submit(case, decision="CORRECTED", correction_payload=correction).status_code == 201
        )
        outcomes = service.evaluate_opportunities(
            db, filters, actor=db.get(User, api.harness.database.runs.plan.actor),
            request_id="geo702-evaluate"
        )
        assert critical(api, outcomes).disposition == "UPDATED"
        assert stale.revision == 3


def test_service_unique_fallback_uses_clock_after_raw_competitor_wins(api):
    _, filters, _ = prepared(api)
    rule, values = template(api, filters)
    winner = uuid4()
    with api.harness.factory() as db:
        competed = False

        def compete(state):
            nonlocal competed
            statement = state.statement
            if (
                not competed
                and isinstance(statement, Insert)
                and statement.table.name == ("geo_opportunities")
            ):
                competed = True
                # 在服务确认无开放行之后，独立写者先提交；精确复现ON CONFLICT fallback。
                with api.harness.factory.begin() as other:
                    other.execute(insert(Opportunity).values(id=winner, **values))
                    service._append_sources(other, winner, rule)

        event.listen(db, "do_orm_execute", compete)
        try:
            results = service.evaluate_opportunities(
                db, filters, actor=db.get(User, api.harness.database.runs.plan.actor),
            request_id="geo702-evaluate"
            )
        finally:
            event.remove(db, "do_orm_execute", compete)
    result = critical(api, results)
    assert competed and result.disposition == "UPDATED" and result.opportunity_id == winner
    with api.harness.factory() as db:
        opportunity = db.get(Opportunity, winner)
        assert opportunity.revision == 2 and opportunity.last_seen_at >= opportunity.created_at
