"""GEO 分析器黄金评估引擎数学单元测试与端到端量化回归门禁。"""

from __future__ import annotations

from typing import Any

import pytest
from geo_fixtures import (
    GeoFixtureError,
    load_geo_eval_golden_fixtures,
    load_geo_fixtures,
    validate_geo_eval_golden_fixtures,
)

from app.services.geo_analyzer_eval import (
    AnalyzerEvalThresholds,
    EvalCaseGold,
    EvalCasePrediction,
    EvalCitationItem,
    EvalClaimItem,
    EvalMentionItem,
    EvalRecommendationItem,
    compute_binary_prf,
    compute_cohen_kappa,
    evaluate_analyzer_predictions,
    span_iou,
)
from app.tools.geo_analyzer_eval import DEFAULT_GOLDEN_THRESHOLDS, evaluate_eval_golden_bundle


def test_binary_prf_cohen_kappa_and_span_iou_edge_cases() -> None:
    empty = compute_binary_prf(0, 0, 0)
    assert (empty.precision, empty.recall, empty.f1) == (None, None, None)

    zero_tp = compute_binary_prf(0, 2, 1)
    assert (zero_tp.precision, zero_tp.recall, zero_tp.f1) == (0.0, 0.0, 0.0)

    balanced = compute_binary_prf(3, 1, 2)
    assert balanced.precision == pytest.approx(0.75)
    assert balanced.recall == pytest.approx(0.6)
    assert balanced.f1 == pytest.approx(0.666667, abs=1e-5)

    assert compute_cohen_kappa([], []) is None
    # 全部单一类别时 p_e == 1.0，必须返回 None 而非除零或虚构 1.0
    assert compute_cohen_kappa(["ACCURATE", "ACCURATE"], ["ACCURATE", "ACCURATE"]) is None
    assert compute_cohen_kappa(["A", "B", "A", "B"], ["A", "B", "A", "B"]) == 1.0
    assert compute_cohen_kappa(["A", "A", "B", "B"], ["A", "B", "A", "B"]) == 0.0

    assert span_iou(0, 10, 0, 10) == 1.0
    assert span_iou(0, 10, 5, 15) == pytest.approx(5 / 15)
    assert span_iou(0, 5, 5, 10) == 0.0
    assert span_iou(5, 5, 0, 10) == 0.0


def test_evaluator_detects_critical_false_negatives_and_threshold_violations() -> None:
    gold = [
        EvalCaseGold(
            case_id="c1",
            mentions=(EvalMentionItem("s1"),),
            recommendations=(EvalRecommendationItem("s1", "RECOMMENDED", 1),),
            citations=(EvalCitationItem("https://geo-fixture-owned.test/a", "OWNED"),),
            claims=(
                EvalClaimItem("s1", "CERTIFICATION", 0, 20, "INCORRECT", "CRITICAL"),
                EvalClaimItem("s1", "PARAMETER", 21, 40, "INCORRECT", "HIGH"),
            ),
            review_required=True,
        )
    ]
    # 预测将 CRITICAL 误判为 ACCURATE，并漏检 HIGH 错误
    preds = [
        EvalCasePrediction(
            case_id="c1",
            mentions=(EvalMentionItem("s1"),),
            recommendations=(EvalRecommendationItem("s1", "CONSIDERED", None),),
            citations=(EvalCitationItem("https://geo-fixture-owned.test/a", "OTHER"),),
            claims=(EvalClaimItem("s1", "CERTIFICATION", 0, 20, "ACCURATE", "LOW"),),
            review_required=False,
        )
    ]
    report = evaluate_analyzer_predictions(
        dataset_id="synthetic-check",
        analyzer_version="v1",
        rule_set_version="r1",
        gold_cases=gold,
        predictions=preds,
    )
    assert report.mentions.entity.f1 == 1.0
    assert report.citations.category_accuracy == 0.0
    assert report.claims.critical_error_false_negative_count == 2
    assert report.review_trigger.recall == 0.0

    violations = report.check_thresholds(
        AnalyzerEvalThresholds(
            min_citation_category_accuracy=0.9,
            max_critical_error_false_negatives=0,
            min_review_trigger_recall=1.0,
        )
    )
    assert len(violations) == 3
    assert any("critical_error_false_negative_count" in item for item in violations)


def test_eval_golden_fixture_validation_rejects_sensitive_and_out_of_scope_data() -> None:
    bundle: dict[str, Any] = load_geo_eval_golden_fixtures()
    assert len(bundle["cases"]) == 16

    invalid_scope = load_geo_eval_golden_fixtures()
    invalid_scope["cases"][0]["expected"]["mentions"] = ["subject-nonexistent"]
    with pytest.raises(GeoFixtureError, match="提及对象越界"):
        validate_geo_eval_golden_fixtures(invalid_scope)

    invalid_secret = load_geo_eval_golden_fixtures()
    invalid_secret["cases"][0]["text"] = "Bearer secret-canary-value-not-allowed"
    with pytest.raises(GeoFixtureError, match="禁止敏感凭据") as caught:
        validate_geo_eval_golden_fixtures(invalid_secret)
    assert "secret-canary-value-not-allowed" not in str(caught.value)


def test_deterministic_analyzer_meets_all_golden_eval_quantitative_thresholds() -> None:
    shared = load_geo_fixtures()
    eval_bundle = load_geo_eval_golden_fixtures()
    report = evaluate_eval_golden_bundle(shared["corpus"], eval_bundle)

    assert report.case_count == 16
    assert report.mentions.entity.f1 == 1.0
    assert report.mentions.ambiguity.f1 == 1.0
    assert report.recommendations.macro_f1 == 1.0
    assert report.recommendations.cohen_kappa == 1.0
    assert report.recommendations.rank_exact_accuracy == 1.0
    assert report.citations.url_match.f1 == 1.0
    assert report.citations.category_accuracy == 1.0
    assert report.claims.span.f1 == 1.0
    assert report.claims.verdict_agreement_rate == 1.0
    assert report.claims.verdict_cohen_kappa == 1.0
    assert report.claims.severity_agreement_rate == 1.0
    assert report.claims.critical_error_false_negative_count == 0
    assert report.review_trigger.recall == 1.0
    assert report.check_thresholds(DEFAULT_GOLDEN_THRESHOLDS) == []
