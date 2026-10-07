"""人工接口的模式、身份、安全边界及跨命令竞争。"""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.errors import AppError
from app.models.geo_batch_creation import GeoBatchSubject
from app.models.geo_manual_collection import GeoManualDraft
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.identity import User
from app.schemas.geo_manual_collection import GeoManualDraftSave, GeoManualObservationSubmit
from app.services import geo_manual_collection as service
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine
from tests.integration.test_geo_manual_collection import (
    batch_run,
    evidence,
    payload,
    prefix,
    save,
    submit,
)
from tests.unit.test_geo_run_contract import input_snapshot

pytestmark = pytest.mark.integration
__all__ = ["plans_api", "questions_api", "questions_engine"]


@pytest.mark.parametrize("mode", ["API", "BROWSER"])
def test_nonmanual_read_draft_and_submit_rejected(plans_api, mode):
    api = plans_api
    original = batch_run(api)[0]
    with api.api.factory() as db:
        old = db.get(GeoObservationBatch, original.batch_id)
        batch = GeoObservationBatch(
            trigger_type="MANUAL",
            plan_snapshot=old.plan_snapshot,
            rule_snapshot=old.rule_snapshot,
            requested_run_count=1,
            created_by=api.api.engineer_id,
        )
        db.add(batch)
        db.flush()
        db.add(GeoBatchSubject(batch_id=batch.id, subject_id=api.subject, role="PRIMARY"))
        value = deepcopy(original.input_snapshot)
        profile = input_snapshot(mode)["profile"]
        profile["id"] = str(api.profile)
        profile["surface"]["id"] = str(api.surface)
        value["profile"] = profile
        run = GeoObservationRun(
            batch_id=batch.id,
            prompt_variant_id=api.prompt,
            collection_profile_id=api.profile,
            repeat_index=1,
            input_snapshot=value,
        )
        db.add(run)
        db.flush()
        batch.status = "QUEUED"
        batch.revision = 1
        db.commit()
    results = [
        api.api.engineer.get(prefix(run) + "/manual-entry"),
        save(api, run, {}),
        submit(api, run, payload(run)),
    ]
    assert all(
        r.status_code == 409 and r.json()["error"]["code"] == "GEO_MANUAL_MODE_REQUIRED"
        for r in results
    )
    with api.api.factory() as db:
        bad = GeoManualDraft(
            run_id=run.id,
            draft_revision=1,
            draft=service.canonical_draft(
                GeoManualDraftSave.model_validate({"expected_draft_revision": 0, "draft": {}}).draft
            ),
            updated_by=api.api.engineer_id,
        )
        db.add(bad)
        with pytest.raises(IntegrityError) as error:
            db.commit()
        assert error.value.orig.diag.constraint_name == "ck_geo_manual_drafts_editable"


def test_csrf_role_and_disabled_actor_are_enforced_even_on_replay(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    f, _ = evidence(api)
    value = payload(run, screenshot_file_id=str(f))
    assert submit(api, run, value).status_code == 201
    assert submit(api, run, value).status_code == 201
    invalid = api.api.engineer.post(
        prefix(run) + "/manual-submit",
        json=value,
        headers={"Idempotency-Key": "submit", "X-CSRF-Token": "a" * 32},
    )
    assert invalid.status_code == 403 and invalid.json()["error"]["code"] == "CSRF_INVALID"
    token = api.api.engineer.headers.pop("X-CSRF-Token")
    try:
        assert submit(api, run, value).status_code == 422
    finally:
        api.api.engineer.headers["X-CSRF-Token"] = token
    for field, value_to_set in [
        ("is_active", False),
        ("must_change_password", True),
    ]:
        with api.api.factory() as db:
            user = db.get(User, api.api.engineer_id)
            old = getattr(user, field)
            setattr(user, field, value_to_set)
            user.revision += 1
            db.commit()
        try:
            assert submit(api, run, value).status_code in (401, 403)
        finally:
            with api.api.factory() as db:
                user = db.get(User, api.api.engineer_id)
                setattr(user, field, old)
                user.revision += 1
                db.commit()


def test_same_key_cannot_be_reused_for_another_run(plans_api):
    api = plans_api
    runs = batch_run(api, repeats=2)
    f, _ = evidence(api)
    value = payload(runs[0], screenshot_file_id=str(f))
    assert submit(api, runs[0], value).status_code == 201
    conflict = submit(api, runs[1], value)
    assert (
        conflict.status_code == 409 and conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    )


def test_distinct_actors_compete_on_run_lock(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    files = [evidence(api, owner=actor)[0] for actor in [api.api.admin_id, api.api.engineer_id]]
    gate = Barrier(2)

    def invoke(i):
        with api.api.factory() as db:
            actor = db.get(User, [api.api.admin_id, api.api.engineer_id][i])
            gate.wait(timeout=10)
            value = GeoManualObservationSubmit.model_validate(
                payload(run, screenshot_file_id=str(files[i]))
            )
            try:
                return service.submit_manual_observation(
                    db,
                    run_id=run.id,
                    payload=value,
                    actor=actor,
                    idempotency_key=f"actor-{i}",
                    request_id=str(uuid4()),
                ).run_revision
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(invoke, range(2)))
    assert sorted(results, key=str) == [1, "INVALID_STATE_TRANSITION"]


def test_save_racing_submit_cannot_overwrite_final_answer(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    f, _ = evidence(api)
    gate = Barrier(2)
    value = GeoManualObservationSubmit.model_validate(payload(run, screenshot_file_id=str(f)))

    def invoke(i):
        with api.api.factory() as db:
            actor = db.get(User, api.api.engineer_id)
            gate.wait(timeout=10)
            try:
                if i == 0:
                    return service.submit_manual_observation(
                        db,
                        run_id=run.id,
                        payload=value,
                        actor=actor,
                        idempotency_key="race-submit",
                        request_id=str(uuid4()),
                    ).run_revision
                return service.save_manual_draft(
                    db,
                    run_id=run.id,
                    payload=GeoManualDraftSave.model_validate(
                        {"expected_draft_revision": 0, "draft": {"answer_text": "竞争草稿"}}
                    ),
                    actor=actor,
                    request_id=str(uuid4()),
                ).draft_revision
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(invoke, range(2)))
    assert results in [[1, "INVALID_STATE_TRANSITION"], ["REVISION_CONFLICT", 1]]


def test_sql_draft_revision_and_file_checks_cannot_be_bypassed(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    assert save(api, run, {"answer_text": "保存"}).status_code == 200
    statements = [
        (
            "UPDATE geo_manual_drafts SET draft_revision=9 WHERE run_id=:id",
            "ck_geo_manual_drafts_revision",
        ),
        (
            "UPDATE geo_manual_drafts SET draft=jsonb_set(draft,'{answer_text}','\"变更\"') "
            "WHERE run_id=:id",
            "ck_geo_manual_drafts_revision",
        ),
        (
            "UPDATE geo_manual_drafts SET updated_at=clock_timestamp() WHERE run_id=:id",
            "ck_geo_manual_drafts_revision",
        ),
    ]
    for sql, constraint in statements:
        with api.api.factory() as db, pytest.raises(IntegrityError) as error:
            db.execute(text(sql), {"id": run.id})
        assert error.value.orig.diag.constraint_name == constraint


@pytest.mark.parametrize(
    "time",
    [
        "TbadZ",
        "2026-02-30T00:00:00.000000+00:00",
        "2026-13-01T00:00:00.000000+00:00",
        "2026-01-01T25:00:00.000000+00:00",
        "2026-01-01T00:00:00.000000",
    ],
)
def test_sql_rejects_invalid_draft_dates_without_poisoning_context(plans_api, time):
    api = plans_api
    run = batch_run(api)[0]
    assert save(api, run, {"answer_text": "合法草稿"}).status_code == 200
    with api.api.factory() as db, pytest.raises(IntegrityError) as error:
        db.execute(
            text(
                "UPDATE geo_manual_drafts SET draft=jsonb_set(draft,'{collected_at}', "
                "to_jsonb(CAST(:time AS text))), draft_revision=draft_revision+1 WHERE run_id=:id"
            ),
            {"id": run.id, "time": time},
        )
    assert error.value.orig.diag.constraint_name == "ck_geo_manual_drafts_payload"
    context = api.api.engineer.get(prefix(run) + "/manual-entry")
    assert context.status_code == 200 and context.json()["draft_revision"] == 1


@pytest.mark.parametrize(
    "field,value",
    [
        ("source_product", " x"),
        ("source_model", "x "),
        ("source_version", "\u3000x"),
        (
            "citations",
            [
                {
                    "original_url": "https://",
                    "position": 1,
                    "title": None,
                    "extraction_source": "MANUAL",
                }
            ],
        ),
        (
            "citations",
            [
                {
                    "original_url": "https://u:p@example.test/",
                    "position": 1,
                    "title": None,
                    "extraction_source": "MANUAL",
                }
            ],
        ),
        (
            "citations",
            [
                {
                    "original_url": "https://example.test/%ZZ",
                    "position": 1,
                    "title": None,
                    "extraction_source": "MANUAL",
                }
            ],
        ),
    ],
)
def test_sql_rejects_unsafe_draft_source_and_url_shape(plans_api, field, value):
    import json

    api = plans_api
    run = batch_run(api)[0]
    assert save(api, run, {"answer_text": "合法草稿"}).status_code == 200
    with api.api.factory() as db, pytest.raises(IntegrityError) as error:
        db.execute(
            text(
                "UPDATE geo_manual_drafts SET draft=jsonb_set(draft,CAST(:field AS text[]), "
                "CAST(:value AS jsonb)), draft_revision=draft_revision+1 WHERE run_id=:id"
            ),
            {"id": run.id, "field": [field], "value": json.dumps(value)},
        )
    assert error.value.orig.diag.constraint_name == "ck_geo_manual_drafts_payload"
    context = api.api.engineer.get(prefix(run) + "/manual-entry")
    assert context.status_code == 200 and context.json()["draft_revision"] == 1
