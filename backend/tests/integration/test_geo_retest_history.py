"""706首次trigger之后追加attempt、复核竞争与独立操作者保留边界。"""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from threading import Event
from time import monotonic
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.errors import AppError
from app.main import app
from app.models.geo_opportunities import GeoOpportunity, GeoOpportunitySource
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.identity import User
from app.schemas.geo_opportunities import GeoOpportunityTriggerSnapshot
from app.schemas.geo_retest_comparisons import GeoOpportunityContinueRequest
from app.schemas.geo_reviews import GeoRunReviewRequest
from app.services import geo_opportunity_decisions as decisions
from app.services import geo_reviews, identity
from tests.integration.geo_comparisons_support import (
    comparison_case,
    complete_run,
    create_retest,
    finish_retest,
    payload,
    read_comparison,
)
from tests.integration.geo_retests_support import PATH, plans_api, questions_api, questions_engine
from tests.unit.test_geo_opportunity_policy import snapshot as trigger_snapshot

pytestmark = pytest.mark.integration
__all__ = ["comparison_case", "plans_api", "questions_api", "questions_engine"]


def test_first_trigger_failed_attempt_is_not_replaced_by_705_latest_answer(plans_api):
    api = plans_api.api
    plan = plans_api.create(repeat_count=2)
    response = api.engineer.post(
        f"/api/v1/geo/monitoring-plans/{plan['id']}/run",
        json={"expected_revision": plan["revision"]},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    batch_id = UUID(response.json()["batch_id"])
    with api.factory.begin() as db:
        roots = list(
            db.scalars(select(GeoObservationRun).where(GeoObservationRun.batch_id == batch_id))
        )
        now = datetime.now(UTC)
        for root in roots:
            root.status, root.finished_at = "FAILED", now
            root.error_stage, root.error_code, root.error_summary = (
                "COLLECTION",
                "PROVIDER_TIMEOUT",
                "虚构失败",
            )
            root.revision += 1
        value = trigger_snapshot()
        value.update(rule_code="RUN_FAILURE", value=2.0, threshold=2.0, numerator=2, denominator=2)
        value["scope"].update(
            subject_id=plans_api.subject,
            query_topic_id=api.topic,
            prompt_variant_id=plans_api.prompt,
            collection_profile_id=plans_api.profile,
            engine_surface_id=plans_api.surface,
            batch_id=batch_id,
        )
        value["source_date_from"], value["source_date_to"] = now - timedelta(days=1), now
        value["sources"] = [
            dict(run_id=r.id, analysis_revision_id=None, review_id=None, source_role="TRIGGER")
            for r in roots
        ]
        trigger = GeoOpportunityTriggerSnapshot.model_validate(value)
        opportunity = GeoOpportunity(
            identity_key=sha256(str(uuid4()).encode()).hexdigest(),
            rule_code="RUN_FAILURE",
            priority=trigger.priority,
            trigger_snapshot=trigger.model_dump(mode="json"),
            source_date_from=trigger.source_date_from,
            source_date_to=trigger.source_date_to,
            subject_id=plans_api.subject,
            query_topic_id=api.topic,
            prompt_variant_id=plans_api.prompt,
            collection_profile_id=plans_api.profile,
            engine_surface_id=plans_api.surface,
            batch_id=batch_id,
        )
        db.add(opportunity)
        db.flush()
        for root in roots:
            db.add(
                GeoOpportunitySource(
                    opportunity_id=opportunity.id, run_id=root.id, source_role="TRIGGER"
                )
            )
        opportunity_id, original_ids = opportunity.id, {str(r.id) for r in roots}
    assert (
        api.engineer.post(
            f"{PATH}/{opportunity_id}/acknowledge", json={"expected_revision": 1}
        ).status_code
        == 200
    )
    with api.factory.begin() as db:
        opportunity = db.get(GeoOpportunity, opportunity_id)
        opportunity.status, opportunity.revision = "IN_PROGRESS", 3
        # trigger已经冻结，705尚未执行：后继attempt提供已知版本的新Answer。
        for root in db.scalars(
            select(GeoObservationRun).where(GeoObservationRun.batch_id == batch_id)
        ).all():
            successor = GeoObservationRun(
                batch_id=batch_id,
                prompt_variant_id=root.prompt_variant_id,
                collection_profile_id=root.collection_profile_id,
                repeat_index=root.repeat_index,
                attempt_no=2,
                previous_attempt_id=root.id,
                input_snapshot=deepcopy(root.input_snapshot),
            )
            db.add(successor)
            db.flush()
            complete_run(db, successor)
        batch = db.get(GeoObservationBatch, batch_id)
        batch.status, batch.finished_at = "COMPLETED", datetime.now(UTC) + timedelta(days=3)
        batch.revision += 1
    case = (
        plans_api,
        opportunity_id,
        batch_id,
        {"expected_revision": 3, "baseline_batch_id": str(batch_id)},
    )
    retest = create_retest(case)
    finish_retest(case, retest)
    comparison = read_comparison(case)["comparison"]
    assert {s["run_id"] for s in comparison["baseline"]["sources"]} == original_ids
    assert all(s["analysis_revision_id"] is None for s in comparison["baseline"]["sources"])
    assert all(e["source_version"] is None for e in comparison["baseline"]["environments"])
    assert comparison["baseline"]["date_to"] == trigger.source_date_to.isoformat().replace(
        "+00:00", "Z"
    )
    assert comparison["recovery"]["status"] == "NOT_COMPARABLE"


def test_decision_only_actor_projects_business_reference_and_cannot_be_deleted(comparison_case):
    case = comparison_case
    with case[0].api.factory() as db:
        actor = User(
            username=f"706-history-{uuid4()}",
            display_name="虚构新操作者",
            password_hash="unused",
            account_type="ENGINEER",
            is_active=True,
            must_change_password=False,
        )
        db.add(actor)
        db.commit()
        decisions.continue_followup(
            db,
            case[1],
            GeoOpportunityContinueRequest(
                expected_revision=3, resolution_code="FOLLOWUP", resolution_comment="明确依据"
            ),
            actor=actor,
            request_id="706-new-actor",
        )
        assert identity._user_business_reference_counts(db, [actor.id]) == {actor.id: 1}
        actor.is_active, actor.revision = False, actor.revision + 1
        db.commit()
        with pytest.raises(AppError) as blocked:
            identity.delete_user(
                db=db,
                user_id=actor.id,
                expected_revision=actor.revision,
                actor=db.get(User, case[0].api.admin_id),
                request_id="706-delete-actor",
            )
        assert blocked.value.code == "USER_IN_USE"
        db.rollback()
        assert db.get(User, actor.id) is not None


def test_anonymous_and_password_change_sessions_cannot_access_commands(comparison_case):
    case = comparison_case
    with TestClient(app) as anonymous:
        assert anonymous.get(f"{PATH}/{case[1]}/comparison").status_code == 401
    with case[0].api.factory.begin() as db:
        actor = db.get(User, case[0].api.engineer_id)
        actor.must_change_password, actor.revision = True, actor.revision + 1
    assert case[0].api.engineer.get(f"{PATH}/{case[1]}/comparison").status_code == 403
    assert (
        case[0]
        .api.engineer.post(
            f"{PATH}/{case[1]}/continue",
            json={
                "expected_revision": 3,
                "resolution_code": "FOLLOWUP",
                "resolution_comment": "明确依据",
            },
        )
        .status_code
        == 403
    )


def test_concurrent_review_blocks_evidence_decision_then_rejects_stale_fingerprint(
    comparison_case, monkeypatch
):
    case = comparison_case
    batch_id = create_retest(case)
    finish_retest(case, batch_id)
    before = read_comparison(case)
    with case[0].api.factory() as db:
        run = db.scalar(select(GeoObservationRun).where(GeoObservationRun.batch_id == batch_id))
        run_id, revision, analysis_id = run.id, run.revision, run.current_analysis_revision_id
    locked, release, started = Event(), Event(), Event()
    original_lock = geo_reviews.lock_run
    waiting_pid = []

    def held_lock(db, identity):
        result = original_lock(db, identity)
        locked.set()
        assert release.wait(10)
        return result

    monkeypatch.setattr(geo_reviews, "lock_run", held_lock)

    def review():
        with case[0].api.factory() as db:
            return geo_reviews.review_run(
                db,
                run_id=run_id,
                payload=GeoRunReviewRequest(
                    analysis_revision_id=analysis_id,
                    expected_run_revision=revision,
                    decision="CONFIRMED",
                    correction_payload=None,
                    comment="虚构复核",
                ),
                actor=db.get(User, case[0].api.engineer_id),
                request_id="706-review-race",
            )

    def decide():
        with case[0].api.factory() as db:
            waiting_pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            started.set()
            try:
                decisions.continue_followup(
                    db,
                    case[1],
                    GeoOpportunityContinueRequest(**payload(case, before)),
                    actor=db.get(User, case[0].api.admin_id),
                    request_id="706-decision-race",
                )
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        review_future = pool.submit(review)
        assert locked.wait(10)
        decision_future = pool.submit(decide)
        assert started.wait(10)
        blocked = False
        try:
            deadline = monotonic() + 5
            with case[0].api.factory() as observer:
                while monotonic() < deadline:
                    blocked = bool(
                        observer.scalar(
                            text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"),
                            {"pid": waiting_pid[0]},
                        )
                    )
                    if blocked:
                        break
                    Event().wait(0.02)
            assert blocked, "比较命令必须等待已经持有Batch/Run的复核事务"
        finally:
            release.set()
        assert review_future.result(timeout=10).review.decision == "CONFIRMED"
        assert decision_future.result(timeout=10) == "GEO_COMPARISON_STALE"
    assert read_comparison(case)["decisions"] == []
