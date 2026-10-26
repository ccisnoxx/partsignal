"""采集观察事实、历史 hash 和引用分母的定向合同。"""

import hashlib
import json
from dataclasses import replace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.geo_answers import GeoCitationObservation, GeoCitationObservationStatus
from app.schemas.geo_manual_collection import GeoManualObservationDraft, GeoManualObservationSubmit
from app.services.geo_manual_collection import canonical_draft, submission_hash
from app.services.geo_metric_inputs import metric_run_from_snapshot
from app.services.geo_metric_types import MetricCitation, MetricCode, MetricExclusion
from app.services.geo_metrics import metric_eligibility
from tests.unit.geo_metrics_gold import SCOPE, observation
from tests.unit.test_geo_metric_inputs import case, result

CITATION = {"original_url": "https://example.test/a", "position": 1}


@pytest.mark.parametrize(
    "status,reason,citations",
    [
        ("COMPLETE", None, []),
        ("NONE", None, [CITATION]),
        ("UNKNOWN", "未展开来源", [CITATION]),
        ("PARTIAL", None, []),
        ("UNKNOWN", "\u3000\t", []),
        ("NONE", "不该有原因", []),
        ("PARTIAL", "x" * 2001, []),
        ("PARTIAL", "nul\x00", []),
    ],
)
def test_reject_conflicting_or_incomplete_observation(status, reason, citations):
    with pytest.raises(ValidationError):
        GeoManualObservationDraft.model_validate(
            {
                "citation_observation": {"status": status, "missing_reason": reason},
                "citations": citations,
            }
        )


def test_legacy_canonical_draft_and_submission_hash_have_no_new_null_field():
    run_id = uuid4()
    value = GeoManualObservationSubmit(
        expected_draft_revision=3, answer_text="旧证据", collected_at="2026-10-01T00:00:00Z"
    )
    data = canonical_draft(value)
    assert "citation_observation" not in data
    legacy = {"run_id": str(run_id), "expected_draft_revision": 3, "observation": data}
    expected = hashlib.sha256(
        json.dumps(legacy, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    assert submission_hash(run_id, value) == expected
    explicit = value.model_copy(
        update={"citation_observation": GeoCitationObservation(status="NONE")}
    )
    assert submission_hash(run_id, explicit) != expected


@pytest.mark.parametrize("status", ["PARTIAL", "UNKNOWN"])
@pytest.mark.parametrize(
    "code",
    [MetricCode.OWNED_SOURCE_COVERAGE, MetricCode.OWNED_CITATION_SHARE, MetricCode.DOMAIN_COVERAGE],
)
def test_incomplete_observation_excluded_even_with_classified_sources_or_absence_flag(status, code):
    run = observation(
        citation_observation_status=GeoCitationObservationStatus(status),
        citations=(MetricCitation("https://example.test/a", "example.test", True),)
        if status == "PARTIAL"
        else (),
    )
    assert (
        MetricExclusion.CITATION_OBSERVATION_UNAVAILABLE
        in metric_eligibility(
            run, metric=code, scope=SCOPE, dimensions=run.dimensions
        ).exclusion_reasons
    )
    assert metric_eligibility(
        run, metric=MetricCode.ANSWER_COVERAGE, scope=SCOPE, dimensions=run.dimensions
    ).eligible


def test_none_is_observable_absence_without_changing_zero_citation_share():
    value = case()
    legacy = result(value, MetricCode.OWNED_SOURCE_COVERAGE)
    assert legacy.eligible_run_count == 0
    value["answer"].citation_observation = GeoCitationObservation(status="NONE")
    run = metric_run_from_snapshot(**value)
    assert run.citation_absence_observable and run.citation_observation_status == "NONE"
    coverage = result(value, MetricCode.OWNED_SOURCE_COVERAGE)
    assert (coverage.numerator, coverage.denominator, coverage.value) == (0, 1, 0)
    share = result(value, MetricCode.OWNED_CITATION_SHARE)
    assert share.eligible_run_count == 1 and share.denominator == 0 and share.value is None


def test_complete_and_legacy_known_citations_keep_existing_classification_gate():
    old = observation(
        citation_observation_status=None,
        citations=(MetricCitation("https://example.test/a", "example.test", True),),
    )
    complete = replace(old, citation_observation_status=GeoCitationObservationStatus.COMPLETE)
    assert metric_eligibility(
        old, metric=MetricCode.OWNED_SOURCE_COVERAGE, scope=SCOPE, dimensions=old.dimensions
    ) == metric_eligibility(
        complete,
        metric=MetricCode.OWNED_SOURCE_COVERAGE,
        scope=SCOPE,
        dimensions=complete.dimensions,
    )
    excluded = replace(complete, citation_classification_complete=False)
    assert (
        MetricExclusion.CITATION_CLASSIFICATION_INCOMPLETE
        in metric_eligibility(
            excluded,
            metric=MetricCode.OWNED_SOURCE_COVERAGE,
            scope=SCOPE,
            dimensions=excluded.dimensions,
        ).exclusion_reasons
    )
