"""真实 PostgreSQL 创建合同：冻结、身份、完整性与失败原子性。"""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import UTC, datetime, timedelta, timezone
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, text

from app.errors import AppError
from app.models.geo_batch_creation import GeoBatchCreationRequest, GeoBatchSubject
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.models.identity import AuditLog, User
from app.schemas.geo_batch_creation import GeoAdHocBatchCreate, GeoPlanBatchCreate
from app.services import geo_batches
from tests.integration.geo_plans_support import (
    PREFIX,
    PlansAPI,
)
from tests.integration.geo_plans_support import (
    plans_api as plans_api,
)
from tests.integration.geo_plans_support import (
    questions_api as questions_api,
)
from tests.integration.geo_plans_support import (
    questions_engine as questions_engine,
)

pytestmark = pytest.mark.integration
BATCHES = "/api/v1/geo/observation-batches"


def create(api: PlansAPI, value: dict, key: str = "geo303-create"):
    return api.api.engineer.post(BATCHES, json=value, headers={"Idempotency-Key": key})


def plan_request(row: dict) -> dict:
    return {"source": "PLAN", "plan_id": row["id"], "expected_revision": row["revision"]}


def counts(api: PlansAPI) -> tuple[int, ...]:
    with api.api.factory() as db:
        return tuple(
            db.scalar(select(func.count()).select_from(model))
            for model in (
                GeoObservationBatch,
                GeoObservationRun,
                GeoBatchCreationRequest,
                GeoBatchSubject,
                AuditLog,
            )
        )


def invoke(api: PlansAPI, value: dict, key: str):
    payload = (
        GeoPlanBatchCreate if value["source"] == "PLAN" else GeoAdHocBatchCreate
    ).model_validate(value)
    with api.api.factory() as db:
        return geo_batches.create_manual_batch(
            db=db,
            payload=payload,
            actor=db.get(User, api.api.engineer_id),
            idempotency_key=key,
            request_id=str(uuid4()),
        )


def test_plan_freezes_safe_snapshots_and_replays_after_configuration_changes(plans_api: PlansAPI):
    api = plans_api
    row = api.create(repeat_count=2)
    value = plan_request(row)
    result = create(api, value)
    assert result.status_code == 201, result.text
    receipt = result.json()
    assert set(receipt) == {"batch_id", "requested_run_count", "created_at"}
    assert receipt["requested_run_count"] == 2
    batch_id = UUID(receipt["batch_id"])
    with api.api.factory() as db:
        batch = db.get(GeoObservationBatch, batch_id)
        runs = db.scalars(
            select(GeoObservationRun).where(GeoObservationRun.batch_id == batch_id)
        ).all()
        assert batch.status == "QUEUED" and batch.revision == 1
        assert batch.requested_run_count == len(runs) == 2
        assert {r.repeat_index for r in runs} == {1, 2}
        assert all(
            r.status == "PENDING"
            and r.revision == 0
            and r.attempt_no == 1
            and r.external_call_state == "NOT_STARTED"
            and r.cost_amount is None
            for r in runs
        )
        snapshots = deepcopy([r.input_snapshot for r in runs])
        plan_snapshot = deepcopy(batch.plan_snapshot)
        assert plan_snapshot["plan_revision"] == 0
        assert snapshots[0]["prompt"]["revision"] == 1
        assert snapshots[0]["profile"]["surface"]["revision"] == 1
        assert snapshots[0]["profile"]["adapter_version"] == "1"
        assert snapshots[0]["data_classification"] == "INTERNAL"
        assert db.get(GeoPromptVariant, api.prompt).first_referenced_at is not None
        assert db.get(GeoEngineSurface, api.surface).first_referenced_at is not None
        db.execute(
            text(
                "UPDATE geo_collection_profiles SET name='变更后的配置', "
                "is_active=false, revision=revision+1 WHERE id=:id"
            ),
            {"id": api.profile},
        )
        db.execute(
            text(
                "UPDATE geo_prompt_variants SET is_active=false, revision=revision+1 WHERE id=:id"
            ),
            {"id": api.prompt},
        )
        db.commit()
    changed = api.api.engineer.patch(
        f"{PREFIX}/{row['id']}",
        json=api.payload(name="变更后的计划", repeat_count=10, expected_revision=0),
    )
    assert changed.status_code == 200, changed.text
    replay = create(api, value)
    assert replay.status_code == 201 and replay.json() == receipt
    assert create(api, plan_request(changed.json()), "new-current-key").status_code == 409
    with api.api.factory() as db:
        assert db.get(GeoObservationBatch, batch_id).plan_snapshot == plan_snapshot
        after = db.scalars(
            select(GeoObservationRun).where(GeoObservationRun.batch_id == batch_id)
        ).all()
        assert [r.input_snapshot for r in after] == snapshots
        logs = db.scalars(select(AuditLog).where(AuditLog.target_id == str(batch_id))).all()
        assert len(logs) == 1 and logs[0].action == "geo_observation_batch.created"
        assert "变更后的" not in str(logs[0].details)


def test_manual_same_key_concurrent_and_conflicting_payload(plans_api: PlansAPI):
    api = plans_api
    row = api.create()
    before = counts(api)
    barrier = Barrier(2)

    def attempt():
        barrier.wait(timeout=5)
        return invoke(api, plan_request(row), "concurrent-key")

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: attempt(), range(2)))
    assert results[0] == results[1]
    after = counts(api)
    assert tuple(a - b for a, b in zip(after, before, strict=True)) == (1, 3, 1, 1, 1)
    other = create(api, {**plan_request(row), "expected_revision": 99}, "concurrent-key")
    assert other.status_code == 409 and other.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert counts(api) == after
    # 两个公共入口的相同计划命令共享身份与规范载荷。
    replay = api.api.engineer.post(
        f"{PREFIX}/{row['id']}/run",
        json={"expected_revision": 0},
        headers={"Idempotency-Key": "concurrent-key"},
    )
    assert replay.json() == results[0].model_dump(mode="json")


def test_adhoc_canonical_identity_and_history_references(plans_api: PlansAPI):
    api = plans_api
    request = {"source": "AD_HOC", "configuration": api.payload(repeat_count=1)}
    before = counts(api)
    result = create(api, request)
    assert result.status_code == 201, result.text
    explicit = deepcopy(request)
    explicit["configuration"].update(
        description="虚构内部说明，不进入审计",
        timezone="Asia/Shanghai",
        schedule_kind="MANUAL_ONLY",
        cron_expression=None,
        rule_set_revision=1,
        budget_limit=None,
    )
    assert create(api, explicit).json() == result.json()
    assert tuple(a - b for a, b in zip(counts(api), before, strict=True)) == (1, 1, 1, 1, 1)
    subject = api.api.admin.get(f"/api/v1/geo/subjects/{api.subject}").json()
    assert subject["references"]["observation_run_count"] == 1
    denied = api.api.admin.delete(
        f"/api/v1/geo/subjects/{api.subject}", params={"expected_revision": subject["revision"]}
    )
    assert denied.status_code == 409 and denied.json()["error"]["code"] == "GEO_SUBJECT_IN_USE"
    profile = api.api.admin.get(f"/api/v1/geo/collection-profiles/{api.profile}").json()
    assert "DELETE" not in profile["available_actions"]
    assert profile["deletion"]["blockers"] == [{"type": "HISTORICAL_REFERENCE", "count": 1}]
    denied = api.api.admin.delete(
        f"/api/v1/geo/collection-profiles/{api.profile}",
        params={"expected_revision": profile["summary"]["revision"]},
    )
    assert denied.status_code == 409 and denied.json()["error"]["code"] == "GEO_PROFILE_IN_USE"


def large_matrix(api: PlansAPI) -> dict:
    prompts, profiles = [api.prompt], [api.profile]
    with api.api.factory() as db:
        for index in range(9):
            prompt = GeoPromptVariant(
                query_topic_id=api.api.topic,
                prompt_text=f"虚构矩阵问题{index}",
                mention_mode="UNBRANDED",
                language_code="zh-hans",
                region_code="CN",
                priority="CORE",
                created_by=api.api.engineer_id,
            )
            profile = GeoCollectionProfile(
                engine_surface_id=api.surface,
                name=f"虚构配置{index}",
                collection_mode="MANUAL",
                adapter_key="manual",
                language_code="zh-hans",
                region_code="CN",
                login_state="ANONYMOUS",
                web_search_policy="UNKNOWN",
                settings_json={},
                is_active=True,
                created_by=api.api.admin_id,
            )
            db.add_all([prompt, profile])
            db.flush()
            prompts.append(prompt.id)
            profiles.append(profile.id)
        db.commit()
    return {
        "source": "AD_HOC",
        "configuration": api.payload(
            prompt_variant_ids=[str(p) for p in prompts],
            collection_profile_ids=[str(p) for p in profiles],
            repeat_count=10,
        ),
    }


def test_1000_runs_without_partial_matrix(plans_api: PlansAPI):
    api = plans_api
    value = large_matrix(api)
    from time import perf_counter

    started = perf_counter()
    result = create(api, value)
    elapsed = perf_counter() - started
    print(f"GEO-303 1000 runs 创建耗时：{elapsed:.3f}s")
    assert elapsed < 5.0
    assert result.status_code == 201, result.text
    assert result.json()["requested_run_count"] == 1000
    batch_id = UUID(result.json()["batch_id"])
    with api.api.factory() as db:
        runs = db.scalars(
            select(GeoObservationRun).where(GeoObservationRun.batch_id == batch_id)
        ).all()
        assert len(runs) == 1000 and len({r.run_cell_key for r in runs}) == 1000
        assert {r.repeat_index for r in runs} == set(range(1, 11))
        assert all(r.attempt_no == 1 and r.previous_attempt_id is None for r in runs)
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoBatchSubject)
                .where(GeoBatchSubject.batch_id == batch_id)
            )
            == 1
        )
    reordered = deepcopy(value)
    reordered["configuration"]["prompt_variant_ids"].reverse()
    reordered["configuration"]["collection_profile_ids"].reverse()
    assert create(api, reordered).json() == result.json()


@pytest.mark.parametrize("failure", ["run_chunk", "audit"])
def test_failure_rolls_back_every_creation_effect(plans_api: PlansAPI, monkeypatch, failure):
    api = plans_api
    value = (
        large_matrix(api)
        if failure == "run_chunk"
        else {"source": "AD_HOC", "configuration": api.payload()}
    )
    before = counts(api)
    if failure == "audit":

        def failed_audit(*args, **kwargs):
            raise RuntimeError("虚构审计故障")

        monkeypatch.setattr(geo_batches, "append_audit", failed_audit)
    with api.api.factory() as db:
        if failure == "run_chunk":
            original = db.execute
            calls = 0

            def fail_second_chunk(statement, *args, **kwargs):
                nonlocal calls
                if (
                    getattr(getattr(statement, "table", None), "name", None)
                    == "geo_observation_runs"
                ):
                    calls += 1
                    if calls == 2:
                        raise RuntimeError("虚构第二块写入故障")
                return original(statement, *args, **kwargs)

            monkeypatch.setattr(db, "execute", fail_second_chunk)
        with pytest.raises(RuntimeError, match="虚构"):
            geo_batches.create_manual_batch(
                db=db,
                payload=GeoAdHocBatchCreate.model_validate(value),
                actor=db.get(User, api.api.engineer_id),
                idempotency_key="failed-create",
                request_id="failure-test",
            )
        if failure == "run_chunk":
            assert calls == 2
    assert counts(api) == before
    with api.api.factory() as db:
        assert db.get(GeoPromptVariant, api.prompt).first_referenced_at is None
        assert db.get(GeoEngineSurface, api.surface).first_referenced_at is None


def test_schedule_concurrent_window_identity_ignores_revision(plans_api: PlansAPI):
    api = plans_api
    row = api.create(schedule_kind="CRON", cron_expression="0 * * * *")
    active = api.action(row, "activate").json()
    window = datetime(2026, 10, 3, tzinfo=UTC)
    barrier = Barrier(2)

    def attempt():
        barrier.wait(timeout=5)
        with api.api.factory() as db:
            return geo_batches.create_scheduled_batch(
                db=db, plan_id=UUID(row["id"]), scheduled_for=window
            )

    before = counts(api)
    with ThreadPoolExecutor(max_workers=2) as pool:
        receipts = list(pool.map(lambda _: attempt(), range(2)))
    assert receipts[0] == receipts[1]
    assert tuple(a - b for a, b in zip(counts(api), before, strict=True)) == (1, 3, 0, 1, 0)
    paused = api.action(active, "pause").json()
    assert paused["revision"] != active["revision"]
    with api.api.factory() as db:
        replay = geo_batches.create_scheduled_batch(
            db=db,
            plan_id=UUID(row["id"]),
            scheduled_for=window.astimezone(timezone(timedelta(hours=8))),
        )
        assert replay == receipts[0]
        with pytest.raises(AppError, match="调度"):
            geo_batches.create_scheduled_batch(
                db=db, plan_id=UUID(row["id"]), scheduled_for=window + timedelta(hours=1)
            )
        batch = db.get(GeoObservationBatch, receipts[0].batch_id)
        assert (
            batch.created_by is None and batch.plan_snapshot["plan_revision"] == active["revision"]
        )
        assert batch.schedule_identity == geo_batches.schedule_identity(UUID(row["id"]), window)


def test_creation_rejects_untrusted_fields_and_auth_failures(plans_api: PlansAPI):
    api = plans_api
    request = {"source": "AD_HOC", "configuration": api.payload()}
    before = counts(api)
    for patch in (
        {"created_by": str(api.api.admin_id)},
        {"trigger_type": "SCHEDULED"},
        {"input_snapshot": {"api_key": "sensitive-marker"}},
        {"source": "RETEST"},
    ):
        result = create(api, request | patch)
        assert result.status_code == 422 and "sensitive-marker" not in result.text
    invalid = deepcopy(request)
    invalid["configuration"].update(schedule_kind="CRON", cron_expression="0 0 * * *")
    assert create(api, invalid).status_code == 422
    assert api.api.engineer.post(BATCHES, json=request).status_code == 422
    csrf = api.api.engineer.headers.pop("X-CSRF-Token")
    try:
        assert create(api, request).status_code == 422
    finally:
        api.api.engineer.headers["X-CSRF-Token"] = csrf
    assert counts(api) == before


def test_database_count_failure_is_atomic(plans_api: PlansAPI, monkeypatch):
    from itertools import islice

    from sqlalchemy.exc import IntegrityError

    from app.services.geo_plans import RunMatrix

    api = plans_api
    value = {"source": "AD_HOC", "configuration": api.payload()}
    before = counts(api)
    original = RunMatrix.cells
    monkeypatch.setattr(
        RunMatrix, "cells", lambda matrix: islice(original(matrix), matrix.run_count - 1)
    )
    with pytest.raises(IntegrityError) as caught:
        invoke(api, value, "incomplete-matrix")
    assert caught.value.orig.diag.constraint_name == "ck_geo_batches_run_count"
    assert counts(api) == before


def test_plan_stale_revision_and_history_delete(plans_api: PlansAPI):
    api = plans_api
    row = api.create()
    stale = create(api, {**plan_request(row), "expected_revision": 1})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "REVISION_CONFLICT"
    result = create(api, plan_request(row))
    assert result.status_code == 201, result.text
    current = api.api.engineer.get(f"{PREFIX}/{row['id']}").json()
    assert (
        "DELETE" not in current["available_actions"]
        and "HAS_BATCH_HISTORY" in current["deletion"]["blockers"]
    )
    deleted = api.api.engineer.delete(f"{PREFIX}/{row['id']}", params={"expected_revision": 0})
    assert deleted.status_code == 409 and deleted.json()["error"]["code"] == "GEO_PLAN_IN_USE"
    archived = api.action(current, "archive")
    assert archived.status_code == 200, archived.text
    assert create(api, plan_request(row)).json() == result.json()
    fresh = create(api, plan_request(archived.json()), "fresh-after-archive")
    assert fresh.status_code == 409 and fresh.json()["error"]["code"] == "GEO_PLAN_ARCHIVED"
