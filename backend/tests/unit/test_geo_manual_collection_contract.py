"""人工命令输入边界与稳定提交身份。"""

from datetime import UTC, datetime, timedelta, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.errors import AppError
from app.schemas.geo_manual_collection import GeoManualObservationDraft, GeoManualObservationSubmit
from app.services.geo_manual_collection import submission_hash, submission_identity


@pytest.mark.parametrize(
    "field,value",
    [
        ("web_search_observed", "true"),
        ("answer_text", "a\x00b"),
        ("source_model", "   "),
        ("source_product", " x"),
        ("raw_payload_summary", {"authorization": "fake"}),
        ("environment", {}),
        (
            "citations",
            [{"original_url": "https://example.test/", "position": 1, "extraction_source": "DOM"}],
        ),
        ("citations", [{"original_url": "https://u:p@example.test/", "position": 1}]),
        ("citations", [{"original_url": "file:///etc/passwd", "position": 1}]),
        ("collected_at", "2026-10-02T00:00:00"),
    ],
)
def test_draft_rejects_untrusted_shape(field, value):
    with pytest.raises(ValidationError):
        GeoManualObservationDraft.model_validate({field: value})


def test_draft_can_be_incomplete_but_submit_requires_explicit_time_and_answer():
    assert GeoManualObservationDraft().answer_text == ""
    with pytest.raises(ValidationError):
        GeoManualObservationSubmit.model_validate({"expected_draft_revision": 0})


def test_hash_normalizes_time_and_citation_order_but_preserves_original_evidence():
    r = uuid4()
    value = GeoManualObservationSubmit(
        expected_draft_revision=0,
        answer_text="  原始文本\n",
        collected_at=datetime.now(UTC),
        citations=[
            {"original_url": "https://example.test/b", "position": 2},
            {"original_url": "https://example.test/a", "position": 1},
        ],
    )
    equivalent = value.model_copy(
        update={
            "collected_at": value.collected_at.astimezone(timezone(timedelta(hours=8))),
            "citations": list(reversed(value.citations)),
        }
    )
    assert submission_hash(r, value) == submission_hash(r, equivalent)
    assert submission_hash(r, value) != submission_hash(
        r, value.model_copy(update={"answer_text": "原始文本"})
    )
    assert submission_hash(r, value) != submission_hash(uuid4(), value)
    assert submission_hash(r, value) != submission_hash(
        r, value.model_copy(update={"expected_draft_revision": 1})
    )
    citation = value.citations[0].model_copy(
        update={"original_url": "https://example.test/b#fragment"}
    )
    assert submission_hash(r, value) != submission_hash(
        r, value.model_copy(update={"citations": [citation, value.citations[1]]})
    )


@pytest.mark.parametrize("key", ["", " ", "x\n", "中文", "a" * 161])
def test_identity_rejects_invalid_key(key):
    with pytest.raises(AppError) as error:
        submission_identity(uuid4(), key)
    assert error.value.code == "VALIDATION_ERROR"


def test_identity_is_per_actor_and_does_not_store_key():
    actor = uuid4()
    assert len(submission_identity(actor, "abc")) == 64
    assert submission_identity(actor, "abc") == submission_identity(actor, "abc")
    assert submission_identity(actor, "abc") != submission_identity(uuid4(), "abc")
