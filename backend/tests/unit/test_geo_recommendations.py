"""GEO-503：独立金标验证推荐、可靠位置及原文依据，不接外部模型。"""

from dataclasses import FrozenInstanceError
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

import pytest
from geo_fixtures import (
    GeoFixtureError,
    load_geo_fixtures,
    load_geo_recommendation_fixtures,
    validate_geo_recommendation_fixtures,
)

from app.schemas.geo_analysis import GeoRecommendationOut
from app.schemas.geo_catalog import GeoSubjectAliasKind, GeoSubjectType
from app.schemas.geo_monitoring_plans import GeoPlanSubjectRole
from app.schemas.geo_runs import GeoRunAliasSnapshot, GeoRunSubjectSnapshot
from app.services.geo_analysis import (
    RECOMMENDATION_RULE_VERSION,
    classify_recommendations,
    freeze_subject_aliases,
)
from app.services.geo_catalog_normalization import catalog_text_key

SHARED = load_geo_fixtures()
GOLD = load_geo_recommendation_fixtures()


def identity(label: str) -> UUID:
    return uuid5(NAMESPACE_URL, "geo-503-fixture:" + label)


def snapshots(labels: list[str]) -> list[GeoRunSubjectSnapshot]:
    indexed = {
        row["id"]: row for row in [*SHARED["corpus"]["subjects"], *GOLD["additional_subjects"]]
    }
    return [
        GeoRunSubjectSnapshot(
            id=identity(label),
            revision=1,
            subject_type=GeoSubjectType(indexed[label]["subject_type"]),
            role=GeoPlanSubjectRole.PRIMARY,
            product_id=identity(indexed[label]["product_id"])
            if indexed[label].get("product_id")
            else None,
            parent_subject_id=identity(indexed[label]["parent_subject_id"])
            if indexed[label].get("parent_subject_id")
            else None,
            canonical_name=indexed[label]["name"],
            display_name=indexed[label]["name"],
            aliases=[
                GeoRunAliasSnapshot(
                    alias=alias,
                    normalized_alias=catalog_text_key(alias),
                    alias_kind=GeoSubjectAliasKind.PART_NUMBER,
                    language_code=None,
                )
                for alias in indexed[label]["aliases"]
            ],
            domains=[],
        )
        for label in labels
    ]


@pytest.mark.parametrize("case", GOLD["cases"], ids=lambda row: row["id"])
def test_recommendation_gold(case: dict[str, Any]) -> None:
    inputs = snapshots(case["subject_ids"])
    result = classify_recommendations(case["text"], freeze_subject_aliases(inputs))
    actual = {r.subject_id: (r.recommendation.value, r.rank) for r in result.recommendations}
    assert actual == {
        identity(r["subject_id"]): (r["recommendation"], r["rank"])
        for r in case["expected"]["recommendations"]
    }
    assert list(result.review_required_reasons) == case["expected"]["review_required_reasons"]
    assert result.rule_set_version == RECOMMENDATION_RULE_VERSION
    assert result == classify_recommendations(case["text"], freeze_subject_aliases(inputs[::-1]))
    for row in result.recommendations:
        assert row.confidence is None
        assert row.rationale_excerpt and row.rationale_excerpt in case["text"]
        assert len(row.rationale_excerpt) <= 2000
        for evidence in row.evidence:
            assert case["text"][evidence.start : evidence.end] == evidence.excerpt
            assert evidence.subject_id == row.subject_id


@pytest.mark.parametrize("case", SHARED["gold"]["cases"], ids=lambda row: row["id"])
def test_shared_recommendation_gold_is_not_rewritten(case: dict[str, Any]) -> None:
    corpus = SHARED["corpus"]
    answer = next(row for row in corpus["answers"] if row["id"] == case["answer_id"])
    question = next(row for row in corpus["questions"] if row["id"] == answer["question_id"])
    result = classify_recommendations(
        answer["text"], freeze_subject_aliases(snapshots(question["subject_ids"]))
    )
    actual = {r.subject_id: r for r in result.recommendations}
    expected = case["expected"]["recommendations"]
    for row in expected:
        output = actual[identity(row["subject_id"])]
        assert (output.recommendation.value, output.rank) == (row["label"], row["rank"])
        assert output.rationale_excerpt in answer["text"]
        # 旧金标依据粒度可为整句/标题，算法可以保留更小的原文证据单位。
        assert any(
            e.excerpt in row["excerpt"] or row["excerpt"] in e.excerpt for e in output.evidence
        )
    assert {r.subject_id for r in result.recommendations if r.recommendation == "RECOMMENDED"} == {
        identity(r["subject_id"]) for r in expected if r["label"] == "RECOMMENDED"
    }
    if "unreliable_rank" in case["expected"]["review_required_reasons"]:
        assert "UNRELIABLE_RANK" in result.review_required_reasons


def test_results_fit_contract_are_immutable_and_hide_answer_in_repr() -> None:
    result = classify_recommendations(
        "首选 GEOFX-731Q。", freeze_subject_aliases(snapshots(["subject-base"]))
    )
    row = result.recommendations[0]
    dto = GeoRecommendationOut(
        id=UUID(int=1),
        analysis_revision_id=UUID(int=2),
        subject_id=row.subject_id,
        recommendation=row.recommendation,
        rank=row.rank,
        rationale_excerpt=row.rationale_excerpt,
        confidence=row.confidence,
    )
    assert dto.rank == 1
    for value in [result, row, *row.evidence]:
        assert "GEOFX" not in repr(value)
        assert "首选" not in repr(value)
    with pytest.raises(FrozenInstanceError):
        row.rank = 99  # type: ignore[misc]


@pytest.mark.parametrize("text", ["", "  \n", "GEOFX-731Q\x00"])
def test_invalid_answer_retains_existing_safe_failure(text: str) -> None:
    with pytest.raises(ValueError, match="有效回答正文") as error:
        classify_recommendations(text, freeze_subject_aliases(snapshots(["subject-base"])))
    assert "GEOFX" not in str(error.value)


def test_gold_validator_rejects_bad_references_ranks_and_sensitive_text() -> None:
    invalid = load_geo_recommendation_fixtures()
    invalid["cases"][0]["subject_ids"] = ["subject-nonexistent"]
    with pytest.raises(GeoFixtureError, match="引用不存在"):
        validate_geo_recommendation_fixtures(invalid)
    invalid = load_geo_recommendation_fixtures()
    invalid["cases"][0]["expected"]["recommendations"][0]["rank"] = 1
    with pytest.raises(GeoFixtureError, match="只有明确推荐"):
        validate_geo_recommendation_fixtures(invalid)
    invalid = load_geo_recommendation_fixtures()
    invalid["cases"][0]["text"] = "Authorization: " + "fixture-invalid-marker"
    with pytest.raises(GeoFixtureError, match="禁止敏感凭据") as error:
        validate_geo_recommendation_fixtures(invalid)
    assert "fixture-invalid-marker" not in str(error.value)


def test_long_list_preserves_bounded_original_evidence() -> None:
    text = "推荐顺序：\n1. " + "虚构说明" * 600 + "\n2. GEOFX-731Q"
    result = classify_recommendations(text, freeze_subject_aliases(snapshots(["subject-base"])))
    row = result.recommendations[0]
    assert (row.recommendation.value, row.rank) == ("RECOMMENDED", 2)
    assert row.rationale_excerpt == "推荐顺序："
    assert text[row.evidence[0].start : row.evidence[0].end] == row.rationale_excerpt


def test_oversized_header_cannot_create_out_of_contract_rationale() -> None:
    text = "推荐顺序" + "虚构说明" * 600 + "：\n1. GEOFX-731Q"
    result = classify_recommendations(text, freeze_subject_aliases(snapshots(["subject-base"])))
    row = result.recommendations[0]
    assert (row.recommendation.value, row.rank) == ("UNKNOWN", None)
    assert row.rationale_excerpt in text
    assert len(row.rationale_excerpt) <= 2000
