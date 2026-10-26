"""真实 PostgreSQL/HTTP 的观察声明、证据冻结和旧请求重放。"""

import hashlib
import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_manual_collection import GeoManualSubmission
from app.models.geo_runs import GeoObservationRun
from app.schemas.geo_manual_collection import GeoManualObservationSubmit
from app.services.geo_manual_collection import submission_identity
from tests.integration.test_geo_manual_collection import (
    batch_run,
    evidence,
    payload,
    prefix,
    save,
    submit,
)
from tests.integration.test_geo_manual_collection import (
    plans_api as plans_api,
)
from tests.integration.test_geo_manual_collection import (
    questions_api as questions_api,
)
from tests.integration.test_geo_manual_collection import (
    questions_engine as questions_engine,
)

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "status,citations,reason",
    [
        ("NONE", [], None),
        ("COMPLETE", [{"original_url": "https://example.test/a", "position": 2}], None),
        (
            "PARTIAL",
            [{"original_url": "https://example.test/a", "position": 4}],
            "来源面板仅显示部分，已保存截图",
        ),
        ("UNKNOWN", [], "来源面板无法展开"),
    ],
)
def test_observation_roundtrip_frozen_with_original_evidence(plans_api, status, citations, reason):
    api = plans_api
    run = batch_run(api)[0]
    f, _ = evidence(api)
    observation = {"status": status, "missing_reason": reason}
    value = payload(
        run, screenshot_file_id=str(f), citations=citations, citation_observation=observation
    )
    draft = {k: v for k, v in value.items() if k != "expected_draft_revision"}
    saved = save(api, run, draft)
    assert saved.status_code == 200, saved.text
    assert saved.json()["draft"]["citation_observation"] == observation
    assert save(api, run, draft, revision=1).json()["draft_revision"] == 1
    value["expected_draft_revision"] = 1
    submitted = submit(api, run, value)
    assert submitted.status_code == 201, submitted.text
    assert submit(api, run, value).json() == submitted.json()
    detail = api.api.engineer.get(prefix(run)).json()
    assert detail["answer"]["citation_observation"] == observation
    assert detail["answer"]["screenshot_file_id"] == str(f)
    assert detail["answer"]["answer_text"] == value["answer_text"]
    assert len(detail["citations"]) == len(citations)
    with api.api.factory() as db:
        with pytest.raises(DBAPIError):
            db.execute(
                text("UPDATE geo_answer_snapshots SET citation_observation=NULL WHERE run_id=:id"),
                {"id": run.id},
            )
            db.commit()
        db.rollback()


def test_missing_declaration_draft_stays_unrecorded_but_new_submission_rejected(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    f, _ = evidence(api)
    value = payload(run, screenshot_file_id=str(f))
    value.pop("citation_observation")
    draft = {k: v for k, v in value.items() if k != "expected_draft_revision"}
    saved = save(api, run, draft)
    assert saved.status_code == 200 and saved.json()["draft"]["citation_observation"] is None
    assert save(api, run, draft, revision=1).json()["draft_revision"] == 1
    value["expected_draft_revision"] = 1
    rejected = submit(api, run, value)
    assert rejected.status_code == 422 and rejected.json()["error"]["code"] == "VALIDATION_ERROR"
    with api.api.factory() as db:
        assert db.get(GeoObservationRun, run.id).status == "PENDING"
        assert (
            db.scalar(select(GeoAnswerSnapshot).where(GeoAnswerSnapshot.run_id == run.id)) is None
        )


def test_real_legacy_request_receipt_replays_without_new_facts(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    f, _ = evidence(api)
    old_request = payload(run, screenshot_file_id=str(f))
    old_request.pop("citation_observation")
    # 构造旧版已冻结事务：没有新字段，旧 canonical hash 与新实现独立计算。
    old = GeoManualObservationSubmit.model_validate(old_request).model_dump(
        mode="json", exclude={"expected_draft_revision", "citation_observation"}
    )
    now = datetime.now(UTC)
    old["collected_at"] = (
        datetime.fromisoformat(old_request["collected_at"])
        .astimezone(UTC)
        .isoformat(timespec="microseconds")
    )
    hash_input = {"run_id": str(run.id), "expected_draft_revision": 0, "observation": old}
    digest = hashlib.sha256(
        json.dumps(hash_input, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    with api.api.factory() as db:
        current = db.get(GeoObservationRun, run.id)
        answer = GeoAnswerSnapshot(
            run_id=run.id,
            prompt_text=run.input_snapshot["prompt"]["prompt_text"],
            answer_text=old["answer_text"],
            answer_format=old["answer_format"],
            raw_payload_summary=old["raw_payload_summary"],
            screenshot_file_id=f,
            citation_count=0,
            collected_at=datetime.fromisoformat(old["collected_at"]),
        )
        db.add(answer)
        db.flush()
        current.status = "COLLECTED"
        current.revision += 1
        current.started_at = answer.collected_at
        current.collected_at = answer.collected_at
        db.flush()
        db.add(
            GeoManualSubmission(
                identity_hash=submission_identity(api.api.engineer_id, "legacy"),
                request_hash=digest,
                run_id=run.id,
                answer_snapshot_id=answer.id,
                submitted_by=api.api.engineer_id,
                run_revision=current.revision,
                draft_revision=0,
                created_at=now,
            )
        )
        db.commit()
    replay = submit(api, run, old_request, key="legacy")
    assert replay.status_code == 201, replay.text
    detail = api.api.engineer.get(prefix(run)).json()
    assert detail["answer"]["citation_observation"] is None
    assert detail["answer"]["citation_count"] == 0
    altered = {**old_request, "citation_observation": {"status": "NONE", "missing_reason": None}}
    assert submit(api, run, altered, key="legacy").status_code == 409


@pytest.mark.parametrize(
    "value,count",
    [
        ({"status": "COMPLETE", "missing_reason": None}, 0),
        ({"status": "NONE", "missing_reason": None}, 1),
        ({"status": "UNKNOWN", "missing_reason": "失败"}, 1),
        ({"status": "PARTIAL", "missing_reason": "  "}, 1),
        ({"status": "NONE", "missing_reason": None, "extra": True}, 0),
        ({"status": "NONE"}, 0),
        (None, 0),
    ],
)
def test_database_shape_validation_matches_observation_contract(questions_engine, value, count):
    with questions_engine.connect() as db:
        valid = db.scalar(
            text("SELECT geo_citation_observation_valid(CAST(:v AS jsonb),:n)"),
            {"v": json.dumps(value), "n": count},
        )
        assert valid is False
        assert db.scalar(text("SELECT geo_citation_observation_valid(NULL,0)")) is True
