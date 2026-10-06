"""一致快照转换不选历史最佳分析，只消费 pointer 内当前人工修正。"""

from copy import deepcopy
from datetime import UTC, datetime
from hashlib import sha256
from uuid import UUID, uuid4

import pytest

from app.schemas.geo_analysis import (
    GeoAnalysisRevisionOut,
    GeoAnalysisSelection,
    GeoEntityMentionOut,
    GeoRunReviewOut,
)
from app.schemas.geo_answers import GeoAnswerSnapshotOut
from app.schemas.geo_reviews import GeoAnalysisResult, GeoReviewHistoryItem, GeoRunAnalysisDetail
from app.schemas.geo_runs import GeoRunInputSnapshot, GeoRunStatus
from app.services.geo_metric_inputs import metric_run_from_snapshot, metric_scope_from_snapshot
from app.services.geo_metric_types import MetricCode, MetricExclusion, MetricScope
from app.services.geo_metrics import calculate_metric
from tests.unit.test_geo_analysis_contract import revision_payload
from tests.unit.test_geo_run_contract import input_snapshot


def case():
    snapshot = GeoRunInputSnapshot.model_validate(input_snapshot("API"))
    identity, answer_id = uuid4(), uuid4()
    text = "虚构回答"
    digest = sha256(text.encode()).hexdigest()
    timestamp = datetime.now(UTC)
    answer = GeoAnswerSnapshotOut(
        id=answer_id,
        run_id=identity,
        prompt_text=snapshot.prompt.prompt_text,
        answer_text=text,
        answer_sha256=digest,
        answer_format="TEXT",
        source_product=None,
        source_model="fake",
        source_version=None,
        web_search_observed=True,
        raw_payload_summary={"schema_version": 1},
        raw_payload_file_id=None,
        screenshot_file_id=None,
        citation_count=0,
        collected_at=timestamp,
        created_at=timestamp,
    )
    payload = revision_payload()
    payload.update(
        run_id=str(identity),
        answer_snapshot_id=str(answer_id),
        status="COMPLETED",
        created_at=timestamp.isoformat(),
        finished_at=timestamp.isoformat(),
        review_required_reasons=["LOW_CONFIDENCE"],
    )
    payload["input_snapshot"]["answer_sha256"] = digest
    payload["input_snapshot"]["subjects"] = snapshot.model_dump(mode="json")["subjects"]
    analysis = GeoAnalysisRevisionOut.model_validate(payload)
    subject_id = snapshot.subjects[0].id
    mention = GeoEntityMentionOut(
        id=uuid4(),
        analysis_revision_id=analysis.id,
        subject_id=subject_id,
        mention_count=7,
        first_character_offset=None,
        matched_aliases=["虚构品牌"],
        confidence=None,
    )
    machine = GeoAnalysisResult(
        analysis=analysis,
        mentions=[mention],
        recommendations=[],
        claims=[],
        citations=[],
        citation_classification_complete=True,
    )
    review = GeoRunReviewOut(
        id=uuid4(),
        run_id=identity,
        analysis_revision_id=analysis.id,
        decision="CORRECTED",
        correction_payload={
            "schema_version": 1,
            "mentions": [
                {
                    "subject_id": str(subject_id),
                    "mention_count": 0,
                    "first_character_offset": None,
                    "matched_aliases": [],
                }
            ],
            "recommendations": [],
            "claims": [],
            "citations": [],
        },
        comment="修正误匹配",
        reviewer_id=uuid4(),
        created_at=timestamp,
    )
    detail = GeoRunAnalysisDetail(
        selection=GeoAnalysisSelection(
            run_id=identity, current_analysis_revision_id=analysis.id, current_review_id=review.id
        ),
        revisions=[machine],
        reviews=[GeoReviewHistoryItem(review=review, is_current=True)],
        effective_results=None,
        review_required=False,
        review_gate_passed=True,
        available_actions=[],
    )
    return dict(
        run_id=identity,
        batch_id=uuid4(),
        repeat_index=1,
        status=GeoRunStatus.COMPLETED,
        snapshot=snapshot,
        answer=answer,
        citations=[],
        analysis_detail=detail,
        window_key="test",
        applicable_subject_ids=frozenset({subject_id}),
        described_subject_ids=frozenset(),
        citation_absence_observable=False,
        integrity_valid=True,
    )


def result(value, code=MetricCode.ANSWER_COVERAGE):
    run = metric_run_from_snapshot(**value)
    return calculate_metric(
        [run],
        metric=code,
        scope=MetricScope(value["snapshot"].subjects[0].id),
        dimensions=run.dimensions,
    )


def test_current_review_removes_machine_mention_without_mutating_history():
    value = case()
    assert result(value).value == 0
    assert value["analysis_detail"].revisions[0].mentions[0].mention_count == 7
    assert not metric_run_from_snapshot(**value).subjects[0].described


def test_unreviewed_current_machine_is_excluded():
    value = case()
    detail = value["analysis_detail"]
    detail.selection.current_review_id = None
    assert result(value).value is None
    assert MetricExclusion.CURRENT_REVIEW_REQUIRED in dict(result(value).exclusion_reason_counts)


def test_current_without_review_requirement_uses_machine_results():
    value = case()
    detail = value["analysis_detail"]
    detail.selection.current_review_id = None
    detail.revisions[0].analysis.review_required_reasons = []
    assert result(value).value == 1


@pytest.mark.parametrize("selected", [None, UUID(int=999)])
def test_pointer_never_falls_back_to_historical_success(selected):
    value = case()
    detail = value["analysis_detail"]
    detail.selection.current_analysis_revision_id = selected
    detail.selection.current_review_id = None
    assert result(value).value is None
    assert not metric_run_from_snapshot(**value).current_analysis_available


def test_current_failed_analysis_not_historical_success():
    value = case()
    detail = value["analysis_detail"]
    old = detail.revisions[0].model_copy(deep=True)
    old.analysis.id = uuid4()
    detail.revisions.append(old)
    detail.revisions[0].analysis.status = "FAILED"
    assert result(value).value is None


def test_review_for_old_analysis_does_not_clear_current_gate():
    value = case()
    value["analysis_detail"].reviews[0].review.analysis_revision_id = uuid4()
    result_value = result(value)
    assert result_value.value is None
    assert MetricExclusion.CURRENT_REVIEW_REQUIRED in dict(result_value.exclusion_reason_counts)
    assert MetricExclusion.INTEGRITY_ERROR in dict(result_value.exclusion_reason_counts)


def test_latest_selected_review_replaces_old_corrections():
    value = case()
    detail = value["analysis_detail"]
    old = detail.reviews[0].model_copy(deep=True)
    old.is_current = False
    old.review.id = uuid4()
    detail.reviews.append(old)
    current = detail.reviews[0].review
    current.decision = "CONFIRMED"
    current.correction_payload = None
    assert result(value).value == 1


def test_capability_or_web_search_signal_is_not_no_citation_proof():
    value = case()
    assert value["answer"].web_search_observed
    assert result(value, MetricCode.OWNED_SOURCE_COVERAGE).value is None
    value["citation_absence_observable"] = True
    assert result(value, MetricCode.OWNED_SOURCE_COVERAGE).value == 0


def test_citation_count_mismatch_blocks_citation_metrics():
    value = case()
    value["answer"].citation_count = 1
    value["citation_absence_observable"] = True
    assert result(value, MetricCode.OWNED_SOURCE_COVERAGE).value is None


@pytest.mark.parametrize("field", ["run_id", "answer_snapshot_id"])
def test_mismatched_current_analysis_identity_excluded(field):
    value = case()
    setattr(value["analysis_detail"].revisions[0].analysis, field, uuid4())
    assert result(value).value is None


def test_answer_digest_must_match_current_analysis_input():
    value = case()
    value["analysis_detail"].revisions[0].analysis.input_snapshot.answer_sha256 = "a" * 64
    assert result(value).value is None


def test_cross_run_inputs_fail_explicitly():
    value = case()
    value["answer"].run_id = uuid4()
    with pytest.raises(ValueError, match="同一运行"):
        metric_run_from_snapshot(**value)


def test_scope_uses_frozen_bindings_not_answer_or_live_catalog():
    value = case()
    snapshot = value["snapshot"]
    target = snapshot.subjects[0].id
    reference = snapshot.subjects[0].model_copy(deep=True)
    reference.id = uuid4()
    reference.role = "REFERENCE"
    snapshot.subjects.append(reference)
    scope = metric_scope_from_snapshot(snapshot, subject_id=target)
    assert scope.sov_subject_ids == frozenset({target})
    assert not scope.is_product
    with pytest.raises(ValueError, match="冻结"):
        metric_scope_from_snapshot(snapshot, subject_id=uuid4())


def test_reanalysis_subject_revision_defines_comparison_cell():
    first = case()
    second = deepcopy(first)
    second["run_id"] = uuid4()
    second["repeat_index"] = 2
    second["answer"].run_id = second["run_id"]
    second["analysis_detail"].selection.run_id = second["run_id"]
    second["analysis_detail"].revisions[0].analysis.run_id = second["run_id"]
    second["analysis_detail"].reviews[0].review.run_id = second["run_id"]
    # 相同采集 binding 下仅一个 repeat 重分析，必须按实际字典版本分栏。
    second["analysis_detail"].revisions[0].analysis.input_snapshot.subjects[0].revision += 1
    first_run = metric_run_from_snapshot(**first)
    second_run = metric_run_from_snapshot(**second)
    assert first_run.dimensions.subject_versions != second_run.dimensions.subject_versions
    assert first["snapshot"].subjects[0].revision == second["snapshot"].subjects[0].revision
    result = calculate_metric(
        [first_run, second_run],
        metric=MetricCode.ANSWER_COVERAGE,
        scope=MetricScope(first["snapshot"].subjects[0].id),
        dimensions=first_run.dimensions,
    )
    assert result.denominator == 1
