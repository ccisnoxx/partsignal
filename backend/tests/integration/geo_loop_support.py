"""707纵向夹具：虚构人工采集输入，实际分析、规则、内容及复测领域服务。"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.config import settings
from app.models.geo_analysis import GeoAnalysisRevision
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_catalog import GeoSubject
from app.models.geo_opportunities import GeoOpportunity
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.geo_surfaces import GeoCollectionProfile
from app.models.identity import User
from app.schemas.geo_insights import GeoOverviewFilters
from app.services import geo_analysis_runs, geo_opportunities
from tests.integration.geo_opportunity_actions_support import publish_task
from tests.integration.geo_plans_support import plans_api, questions_api, questions_engine
from tests.integration.test_content_task_creation import _seed_creation_graph

__all__ = ["plans_api", "questions_api", "questions_engine"]
PATH = "/api/v1/geo/opportunities"


def finish_batch(api, batch_id, *, mentioned):
    """只准备采集事实；analysis、Run/Batch终态均由真实分析应用服务裁决。"""
    with api.factory.begin() as db:
        runs = list(
            db.scalars(select(GeoObservationRun).where(GeoObservationRun.batch_id == batch_id))
        )
        assert len(runs) == 5
        for run in runs:
            now = datetime.now(UTC)
            answer = GeoAnswerSnapshot(
                run_id=run.id,
                prompt_text=run.input_snapshot["prompt"]["prompt_text"],
                answer_text=(
                    "推荐 " + run.input_snapshot["subjects"][0]["canonical_name"] + "。"
                    if mentioned
                    else "虚构对照器件可供选择。"
                ),
                answer_format="TEXT",
                source_product="GEO707虚构观测",
                source_model="fixture-model",
                source_version="fixture-v1",
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
            run.status, run.started_at, run.collected_at = "COLLECTED", now, now
            run.revision += 1
        run_ids = [r.id for r in runs]
    for identity in run_ids:
        geo_analysis_runs.process_analysis_run(identity)
        with api.factory() as db:
            run = db.get(GeoObservationRun, identity)
            if run.status != "NEEDS_REVIEW":
                continue
            analysis = db.get(GeoAnalysisRevision, run.current_analysis_revision_id)
            # 普通推荐句没有可靠排序，沿既有人工复核确认，不改分析规则或直接推进终态。
            assert analysis.review_required_reasons == ["UNRELIABLE_RANK"]
            payload = {
                "analysis_revision_id": str(analysis.id),
                "expected_run_revision": run.revision,
                "decision": "CONFIRMED",
                "correction_payload": None,
                "comment": "GEO707虚构样本人工确认",
            }
        response = api.engineer.post(
            f"/api/v1/geo/observation-runs/{identity}/review", json=payload
        )
        assert response.status_code == 201, response.text
    with api.factory() as db:
        assert db.get(GeoObservationBatch, batch_id).status == "COMPLETED", [
            (
                db.get(GeoObservationRun, identity).status,
                db.get(
                    GeoAnalysisRevision,
                    db.get(GeoObservationRun, identity).current_analysis_revision_id,
                ).review_required_reasons,
            )
            for identity in run_ids
        ]
        assert all(
            db.get(GeoObservationRun, identity).status == "COMPLETED" for identity in run_ids
        )


@pytest.fixture
def loop_case(plans_api, monkeypatch):
    api = plans_api.api
    monkeypatch.setattr(settings, "geo_opportunity_evaluation_enabled", True)
    monkeypatch.setattr(geo_analysis_runs, "SessionLocal", api.factory)
    with api.factory() as db:
        graph = _seed_creation_graph(db, suffix=f"g707-{uuid4()}")
        graph["platform"].allowed_domains = ["community.example.invalid"]
        subject = GeoSubject(
            subject_type="OWN_PRODUCT",
            product_id=graph["product"].id,
            created_by=api.admin_id,
            is_active=True,
        )
        db.add(subject)
        profile = db.get(GeoCollectionProfile, plans_api.profile)
        profile.settings_json = {"require_screenshot": False}
        profile.revision += 1
        db.commit()
        plans_api.subject = subject.id
    plan = plans_api.create(repeat_count=5)
    response = api.engineer.post(
        f"/api/v1/geo/monitoring-plans/{plan['id']}/run",
        json={"expected_revision": plan["revision"]},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    batch_id = UUID(response.json()["batch_id"])
    finish_batch(api, batch_id, mentioned=False)
    filters = GeoOverviewFilters(
        date_from=datetime.now(UTC) - timedelta(days=1),
        date_to=datetime.now(UTC) + timedelta(days=1),
        subject_ids=[subject.id],
    )
    return SimpleNamespace(
        api=api, graph=graph, filters=filters, batch_id=batch_id, subject_id=subject.id
    )


def evaluate(case):
    with case.api.factory() as db:
        return geo_opportunities.evaluate_opportunities(
            db, case.filters, actor=db.get(User, case.api.admin_id), request_id="geo707-evaluate"
        )


def gap(case, results):
    with case.api.factory() as db:
        ids = [r.opportunity_id for r in results if r.opportunity_id]
        opportunity = db.scalar(
            select(GeoOpportunity).where(
                GeoOpportunity.id.in_(ids), GeoOpportunity.rule_code == "TOPIC_COVERAGE_GAP"
            )
        )
        assert opportunity is not None
        return opportunity


def complete_content(case, task_id):
    # 此层复用已批准稿夹具；真实页面人工稿/审核/发布由Playwright覆盖。
    return publish_task(
        SimpleNamespace(
            harness=SimpleNamespace(factory=case.api.factory), engineer_id=case.api.engineer_id
        ),
        task_id,
        case.graph["fact"].id,
    )
