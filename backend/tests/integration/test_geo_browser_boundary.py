"""真实 PostgreSQL：API 消费误投 Browser UUID 不领取、不更改历史和派发元数据。"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.models.geo_batch_creation import GeoBatchSubject
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.services import geo_dispatch, geo_runs
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine
from tests.unit.test_geo_run_contract import input_snapshot, plan_snapshot
from tests.unit.test_geo_surface_contract import capabilities

pytestmark = pytest.mark.integration


def test_browser_run_is_unchanged_by_api_claim_and_dispatch(plans_api, monkeypatch):
    factory = plans_api.api.factory
    monkeypatch.setattr(geo_runs, "SessionLocal", factory)
    monkeypatch.setattr(geo_dispatch, "SessionLocal", factory)
    with factory.begin() as db:
        surface = GeoEngineSurface(
            name="虚构未批准Browser",
            slug=f"geo801-{uuid4()}",
            surface_kind="CONSUMER_UI",
            provider_brand="CUSTOM",
            capabilities=capabilities(),
            created_by=plans_api.api.admin_id,
        )
        db.add(surface)
        db.flush()
        profile = GeoCollectionProfile(
            engine_surface_id=surface.id,
            name="虚构Browser骨架",
            collection_mode="BROWSER",
            adapter_key="fictional-adapter",
            language_code="zh-hans",
            region_code="CN",
            login_state="ANONYMOUS",
            web_search_policy="UNKNOWN",
            settings_json={},
            created_by=plans_api.api.admin_id,
        )
        db.add(profile)
        db.flush()
        value = input_snapshot("BROWSER")
        value["prompt"].update(id=str(plans_api.prompt), query_topic_id=str(plans_api.api.topic))
        value["profile"]["id"] = str(profile.id)
        value["profile"]["surface"]["id"] = str(surface.id)
        value["subjects"][0]["id"] = str(plans_api.subject)
        batch = GeoObservationBatch(
            trigger_type="MANUAL",
            created_by=plans_api.api.engineer_id,
            requested_run_count=1,
            plan_snapshot=plan_snapshot(value),
            rule_snapshot={"schema_version": 1, "rule_set_revision": 1},
        )
        db.add(batch)
        db.flush()
        db.add(GeoBatchSubject(batch_id=batch.id, subject_id=plans_api.subject, role="PRIMARY"))
        run = GeoObservationRun(
            batch_id=batch.id,
            prompt_variant_id=plans_api.prompt,
            collection_profile_id=profile.id,
            repeat_index=1,
            input_snapshot=value,
        )
        db.add(run)
        db.flush()
        run_id, batch_id = run.id, batch.id

    def rows():
        with factory() as db:
            return [
                db.scalar(text(f"SELECT to_jsonb(t) FROM {table} t WHERE id=:id"), {"id": identity})
                for table, identity in (
                    ("geo_observation_batches", batch_id),
                    ("geo_observation_runs", run_id),
                )
            ]

    before = rows()
    for _ in range(2):
        assert geo_runs.claim_collection_run(run_id) is None
        geo_runs.process_collection_run(run_id)
    published = []
    with factory() as db:
        assert geo_dispatch.dispatch_batch(db, batch_id, published.append) == 0
    assert (
        geo_dispatch.redispatch_pending_collection_runs(
            published.append, now=datetime.now(UTC) + timedelta(days=1)
        )
        == 0
    )
    assert not published
    assert rows() == before
