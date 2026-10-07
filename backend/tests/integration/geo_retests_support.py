"""705夹具使用真实303工厂和PG历史；规则评估另由702覆盖。"""

from datetime import UTC, datetime, timedelta
from hashlib import sha256
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_opportunities import GeoOpportunity, GeoOpportunitySource
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.schemas.geo_opportunities import GeoOpportunityTriggerSnapshot
from app.schemas.geo_rules import GeoRuleConfiguration
from tests.integration.geo_plans_support import (
    plans_api as plans_api,
)
from tests.integration.geo_plans_support import (
    questions_api as questions_api,
)
from tests.integration.geo_plans_support import (
    questions_engine as questions_engine,
)

__all__ = ["plans_api", "questions_api", "questions_engine"]
PATH = "/api/v1/geo/opportunities"


@pytest.fixture
def retest_case(plans_api):
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
        batch = db.get(GeoObservationBatch, batch_id)
        roots = list(
            db.scalars(select(GeoObservationRun).where(GeoObservationRun.batch_id == batch_id))
        )
        for root in roots:
            collected_at = datetime.now(UTC)
            db.add(
                GeoAnswerSnapshot(
                    run_id=root.id,
                    prompt_text=root.input_snapshot["prompt"]["prompt_text"],
                    answer_text="虚构基线回答",
                    answer_format="TEXT",
                    source_model="fixture-model",
                    source_version="fixture-v1",
                    raw_payload_summary={
                        "schema_version": 1,
                        "payload_format": None,
                        "payload_bytes": None,
                        "finish_reason": None,
                    },
                    citation_count=0,
                    collected_at=collected_at,
                )
            )
            root.status = "COLLECTED"
            root.collected_at = collected_at
            root.started_at = root.collected_at
            root.revision += 1
        db.flush()
        for root in roots:
            root.status = "FAILED"
            root.error_stage = "ANALYSIS"
            root.error_code = "ANALYSIS_FAILED"
            root.error_summary = "虚构分析失败"
            root.finished_at = datetime.now(UTC)
            root.revision += 1
        batch.status, batch.revision, batch.finished_at = (
            "FAILED",
            batch.revision + 1,
            datetime.now(UTC),
        )
        source = roots[0]
        now = datetime.now(UTC)
        trigger = GeoOpportunityTriggerSnapshot.model_validate(
            {
                "schema_version": 1,
                "rule_code": "DATA_QUALITY_PROBLEM",
                "triggered": True,
                "rule_snapshot": {
                    "schema_version": 1,
                    "rule_set_revision": 1,
                    "configuration": GeoRuleConfiguration().model_dump(mode="json"),
                },
                "scope": {
                    "subject_id": str(plans_api.subject),
                    "query_topic_id": source.input_snapshot["prompt"]["query_topic_id"],
                    "prompt_variant_id": str(plans_api.prompt),
                    "collection_profile_id": str(plans_api.profile),
                    "engine_surface_id": str(plans_api.surface),
                    "batch_id": str(batch_id),
                    "environment_key": "a" * 64,
                },
                "source_date_from": now - timedelta(days=1),
                "source_date_to": now + timedelta(days=1),
                "priority": "HIGH",
                "value": 0.0,
                "threshold": 0.5,
                "numerator": 0,
                "denominator": 2,
                "unavailable_reasons": [],
                "sources": [
                    {
                        "run_id": str(source.id),
                        "analysis_revision_id": None,
                        "review_id": None,
                        "source_role": "TRIGGER",
                    }
                ],
                "details": {},
            }
        )
        opportunity = GeoOpportunity(
            identity_key=sha256(str(uuid4()).encode()).hexdigest(),
            rule_code=trigger.rule_code,
            priority="HIGH",
            trigger_snapshot=trigger.model_dump(mode="json"),
            source_date_from=trigger.source_date_from,
            source_date_to=trigger.source_date_to,
            subject_id=plans_api.subject,
            query_topic_id=source.input_snapshot["prompt"]["query_topic_id"],
            prompt_variant_id=plans_api.prompt,
            collection_profile_id=plans_api.profile,
            engine_surface_id=plans_api.surface,
            batch_id=batch_id,
        )
        db.add(opportunity)
        db.flush()
        db.add(
            GeoOpportunitySource(
                opportunity_id=opportunity.id, run_id=source.id, source_role="TRIGGER"
            )
        )
        identity = opportunity.id
    response = api.engineer.post(f"{PATH}/{identity}/acknowledge", json={"expected_revision": 1})
    assert response.status_code == 200, response.text
    # 既有状态机允许start work；不模拟其他域行动的完成，也不执行706。
    with api.factory.begin() as db:
        opportunity = db.get(GeoOpportunity, identity)
        opportunity.status = "IN_PROGRESS"
        opportunity.revision += 1
    return (
        plans_api,
        identity,
        batch_id,
        {"expected_revision": 3, "baseline_batch_id": str(batch_id)},
    )


def preview(case):
    plan, identity, baseline, _ = case
    return plan.api.engineer.get(
        f"{PATH}/{identity}/retest-preview", params={"baseline_batch_id": str(baseline)}
    )


def post(case, key=None, payload=None):
    plan, identity, _, command = case
    return plan.api.engineer.post(
        f"{PATH}/{identity}/retest",
        json=payload or command,
        headers={"Idempotency-Key": key or str(uuid4())},
    )


def counts(case):
    from app.models.geo_retests import GeoRetestBaseline, GeoRetestRequest

    with case[0].api.factory() as db:
        return tuple(
            db.scalar(select(func.count()).select_from(m))
            for m in (GeoRetestBaseline, GeoRetestRequest, GeoObservationBatch, GeoObservationRun)
        )
