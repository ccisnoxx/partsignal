"""706 比较夹具：真实303/705与PG历史，存储明确的虚构分析事实，无外部调用。"""

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text

from app.models.geo_analysis import GeoAnalysisRevision, GeoEntityMention
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_opportunities import GeoOpportunity, GeoOpportunitySource
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.geo_surfaces import GeoCollectionProfile
from app.schemas.geo_insights import GeoOverviewFilters
from app.schemas.geo_opportunities import GeoOpportunityTriggerSnapshot
from app.schemas.geo_rules import GeoRuleConfiguration
from app.services.geo_metric_inputs import metric_scope_from_snapshot
from app.services.geo_metric_types import MetricCode
from app.services.geo_metrics import calculate_metric
from app.services.geo_opportunity_quality_rules import metric_details
from app.services.geo_overview_queries import load_inputs
from tests.integration.geo_retests_support import PATH
from tests.unit.test_geo_analysis_contract import analysis_input


def complete_run(db, run, *, mentioned=True, version="fixture-v1", source_product=None):
    now = datetime.now(UTC)
    answer = GeoAnswerSnapshot(
        run_id=run.id,
        prompt_text=run.input_snapshot["prompt"]["prompt_text"],
        answer_text=run.input_snapshot["subjects"][0]["canonical_name"] + " 的虚构观测。",
        answer_format="TEXT",
        source_model="fixture-model",
        source_version=version,
        source_product=source_product,
        raw_payload_summary={
            "schema_version": 1,
            "payload_format": None,
            "payload_bytes": None,
            "finish_reason": None,
        },
        citation_count=0,
        collected_at=now,
    )
    db.add(answer)
    db.flush()
    run.status, run.started_at, run.collected_at = "COLLECTED", now, now
    run.revision += 1
    db.flush()
    run.status = "ANALYZING"
    run.lease_token, run.lease_expires_at = uuid4(), now + timedelta(minutes=1)
    run.revision += 1
    db.flush()
    identity = append_analysis(db, run, answer, mentioned=mentioned)
    run.status, run.finished_at = "COMPLETED", datetime.now(UTC)
    run.lease_token, run.lease_expires_at = None, None
    run.revision += 1
    db.flush()
    return answer.id, identity


def append_analysis(db, run, answer, *, mentioned):
    last = db.scalar(
        select(GeoAnalysisRevision.revision)
        .where(GeoAnalysisRevision.run_id == run.id)
        .order_by(GeoAnalysisRevision.revision.desc())
        .limit(1)
    )
    frozen = analysis_input() | {
        "answer_sha256": answer.answer_sha256,
        "subjects": deepcopy(run.input_snapshot["subjects"]),
    }
    if last:
        frozen["configuration"]["rule_set_version"] = f"fixture-r{last + 1}"
    analysis = GeoAnalysisRevision(
        run_id=run.id,
        answer_snapshot_id=answer.id,
        revision=(last or 0) + 1,
        analyzer_type="DETERMINISTIC",
        analyzer_version="fixture-v1",
        input_snapshot=frozen,
    )
    db.add(analysis)
    db.flush()
    subject = run.input_snapshot["subjects"][0]
    if mentioned:
        db.add(
            GeoEntityMention(
                analysis_revision_id=analysis.id,
                subject_id=subject["id"],
                mention_count=int(mentioned),
                first_character_offset=0 if mentioned else None,
                matched_aliases=[subject["canonical_name"]] if mentioned else [],
            )
        )
    db.flush()
    db.execute(
        text(
            "UPDATE geo_analysis_revisions SET status='COMPLETED',"
            "finished_at=clock_timestamp() WHERE id=:id"
        ),
        {"id": analysis.id},
    )
    run.current_analysis_revision_id = analysis.id
    run.revision += 1
    db.flush()
    return analysis.id


@pytest.fixture
def comparison_case(plans_api, request):
    api = plans_api.api
    with api.factory.begin() as db:
        profile = db.get(GeoCollectionProfile, plans_api.profile)
        profile.settings_json = {"require_screenshot": False}
        profile.revision += 1
    count = getattr(request, "param", 5)
    plan = plans_api.create(repeat_count=count)
    response = api.engineer.post(
        f"/api/v1/geo/monitoring-plans/{plan['id']}/run",
        json={"expected_revision": plan["revision"]},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    batch_id = UUID(response.json()["batch_id"])
    with api.factory.begin() as db:
        runs = list(
            db.scalars(select(GeoObservationRun).where(GeoObservationRun.batch_id == batch_id))
        )
        for run in runs:
            complete_run(db, run, mentioned=False)
        batch = db.get(GeoObservationBatch, batch_id)
        batch.status, batch.finished_at = "COMPLETED", datetime.now(UTC)
        batch.revision += 1
    filters = GeoOverviewFilters(
        date_from=datetime.now(UTC) - timedelta(days=1),
        date_to=datetime.now(UTC) + timedelta(days=1),
    )
    with api.factory() as db:
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        db.autoflush = False
        _, inputs = load_inputs(db, filters, run_ids=[r.id for r in runs])
        scope = metric_scope_from_snapshot(inputs[0].snapshot, subject_id=plans_api.subject)
        result = calculate_metric(
            [s.metric for s in inputs],
            metric=MetricCode.NATURAL_VISIBILITY,
            scope=scope,
            dimensions=inputs[0].metric.dimensions,
        )
        current = metric_details(result)
        previous = current | {"numerator": 5, "value": 1.0}
        frozen_sources = [
            {
                "run_id": str(s.metric.run_id),
                "analysis_revision_id": str(s.analysis_id),
                "review_id": None,
                "source_role": "TRIGGER",
            }
            for s in inputs
        ]
    trigger = GeoOpportunityTriggerSnapshot.model_validate(
        {
            "schema_version": 1,
            "rule_code": "VISIBILITY_DROP",
            "triggered": True,
            "rule_snapshot": {
                "schema_version": 1,
                "rule_set_revision": 1,
                "configuration": GeoRuleConfiguration().model_dump(mode="json"),
            },
            "scope": {
                "subject_id": plans_api.subject,
                "query_topic_id": inputs[0].snapshot.prompt.query_topic_id,
                "prompt_variant_id": plans_api.prompt,
                "collection_profile_id": plans_api.profile,
                "engine_surface_id": plans_api.surface,
                "batch_id": batch_id,
                "environment_key": "a" * 64,
            },
            "source_date_from": filters.date_from,
            "source_date_to": filters.date_to,
            "priority": "MEDIUM",
            "value": -1.0,
            "threshold": -0.1,
            "numerator": 0,
            "denominator": 5,
            "unavailable_reasons": [],
            "sources": frozen_sources,
            "details": {"current": [current], "previous": [previous]},
        }
    )
    with api.factory.begin() as db:
        opportunity = GeoOpportunity(
            identity_key=sha256(str(uuid4()).encode()).hexdigest(),
            rule_code=trigger.rule_code,
            priority=trigger.priority,
            trigger_snapshot=trigger.model_dump(mode="json"),
            source_date_from=trigger.source_date_from,
            source_date_to=trigger.source_date_to,
            subject_id=plans_api.subject,
            query_topic_id=trigger.scope.query_topic_id,
            prompt_variant_id=plans_api.prompt,
            collection_profile_id=plans_api.profile,
            engine_surface_id=plans_api.surface,
            batch_id=batch_id,
        )
        db.add(opportunity)
        db.flush()
        for source in frozen_sources:
            db.add(GeoOpportunitySource(opportunity_id=opportunity.id, **source))
        identity = opportunity.id
    response = api.engineer.post(f"{PATH}/{identity}/acknowledge", json={"expected_revision": 1})
    assert response.status_code == 200, response.text
    with api.factory.begin() as db:
        opportunity = db.get(GeoOpportunity, identity)
        opportunity.status, opportunity.revision = "IN_PROGRESS", 3
    return (
        plans_api,
        identity,
        batch_id,
        {"expected_revision": 3, "baseline_batch_id": str(batch_id)},
    )


def create_retest(case):
    response = case[0].api.engineer.post(
        f"{PATH}/{case[1]}/retest", json=case[3], headers={"Idempotency-Key": str(uuid4())}
    )
    assert response.status_code == 201, response.text
    return UUID(response.json()["batch_id"])


def finish_retest(case, batch_id, *, mentioned=True, version="fixture-v1", source_product=None):
    with case[0].api.factory.begin() as db:
        runs = list(
            db.scalars(select(GeoObservationRun).where(GeoObservationRun.batch_id == batch_id))
        )
        for run in runs:
            complete_run(
                db, run, mentioned=mentioned, version=version, source_product=source_product
            )
        batch = db.get(GeoObservationBatch, batch_id)
        batch.status, batch.finished_at, batch.revision = (
            "COMPLETED",
            datetime.now(UTC),
            batch.revision + 1,
        )


def read_comparison(case, **params):
    response = case[0].api.engineer.get(f"{PATH}/{case[1]}/comparison", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def payload(case, read, **patch):
    return {
        "expected_revision": read["opportunity_revision"],
        "resolution_code": "OBSERVED",
        "resolution_comment": "明确的虚构处理依据",
        "retest_batch_id": read["selected_retest_batch_id"],
        "comparison_fingerprint": read["comparison"]["fingerprint"],
        **patch,
    }
