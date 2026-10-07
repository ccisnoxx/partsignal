"""GEO-502 实际提及阶段对照独立金标；不检验后续推荐、声明和状态写入。"""

from dataclasses import FrozenInstanceError
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

import pytest
from geo_fixtures import (
    GeoFixtureError,
    load_geo_fixtures,
    load_geo_mention_fixtures,
    validate_geo_mention_fixtures,
)

from app.schemas.geo_analysis import GeoEntityMentionOut
from app.schemas.geo_catalog import GeoSubjectAliasKind, GeoSubjectType
from app.schemas.geo_monitoring_plans import GeoPlanSubjectRole
from app.schemas.geo_runs import GeoRunAliasSnapshot, GeoRunSubjectSnapshot
from app.services.geo_analysis import (
    ALIAS_AMBIGUOUS,
    MENTION_RULE_VERSION,
    MentionOccurrence,
    freeze_subject_aliases,
    identify_mentions,
)
from app.services.geo_catalog_normalization import catalog_text_key

SHARED = load_geo_fixtures()
MENTION_GOLD = load_geo_mention_fixtures()


def identity(label: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"geo-502-fixture:{label}")


def subject(row: dict[str, Any]) -> GeoRunSubjectSnapshot:
    kind = GeoSubjectType(row["subject_type"])
    return GeoRunSubjectSnapshot(
        id=identity(row["id"]),
        revision=3,
        subject_type=kind,
        role=GeoPlanSubjectRole.PRIMARY,
        product_id=identity(row["product_id"]) if row.get("product_id") else None,
        parent_subject_id=identity(row["parent_subject_id"])
        if row.get("parent_subject_id")
        else None,
        canonical_name=row["name"],
        display_name=row["name"],
        aliases=[
            GeoRunAliasSnapshot(
                alias=alias,
                normalized_alias=catalog_text_key(alias),
                alias_kind=GeoSubjectAliasKind.PART_NUMBER
                if kind in {GeoSubjectType.OWN_PRODUCT, GeoSubjectType.COMPETITOR_PRODUCT}
                else GeoSubjectAliasKind.NAME,
                language_code="en" if alias.isascii() else "zh-CN",
            )
            for alias in row["aliases"]
        ],
        domains=[],
    )


def subjects(labels: list[str]) -> list[GeoRunSubjectSnapshot]:
    rows = [*SHARED["corpus"]["subjects"], *MENTION_GOLD["additional_subjects"]]
    indexed = {row["id"]: row for row in rows}
    return [subject(indexed[label]) for label in labels]


def span(occurrence: MentionOccurrence) -> dict[str, Any]:
    return {
        "start": occurrence.start,
        "end": occurrence.end,
        "excerpt": occurrence.excerpt,
        "negation_cues": list(occurrence.negation_cues),
    }


def test_mention_gold_validation_protects_original_evidence_and_sensitive_boundary() -> None:
    invalid = load_geo_mention_fixtures()
    invalid["cases"][0]["expected"]["mentions"][0]["occurrences"][0]["start"] += 1
    with pytest.raises(GeoFixtureError, match="位置与摘录"):
        validate_geo_mention_fixtures(invalid)
    invalid = load_geo_mention_fixtures()
    invalid["cases"][0]["subject_ids"] = ["subject-not-in-the-frozen-dictionary"]
    with pytest.raises(GeoFixtureError, match="监测对象引用不存在"):
        validate_geo_mention_fixtures(invalid)
    invalid = load_geo_mention_fixtures()
    invalid["cases"][0]["text"] = "Authorization: " + "fixture-invalid-marker"
    with pytest.raises(GeoFixtureError, match="禁止敏感凭据") as error:
        validate_geo_mention_fixtures(invalid)
    assert "fixture-invalid-marker" not in str(error.value)


@pytest.mark.parametrize("case", MENTION_GOLD["cases"], ids=lambda case: case["id"])
def test_mention_gold(case: dict[str, Any]) -> None:
    snapshot = freeze_subject_aliases(subjects(case["subject_ids"]))
    result = identify_mentions(case["text"], snapshot)
    expected = case["expected"]
    assert result.rule_set_version == MENTION_RULE_VERSION
    assert {row.subject_id for row in result.mentions} == {
        identity(row["subject_id"]) for row in expected["mentions"]
    }
    actual = {row.subject_id: row for row in result.mentions}
    for gold in expected["mentions"]:
        mention = actual[identity(gold["subject_id"])]
        assert mention.mention_count == len(gold["occurrences"])
        assert mention.first_character_offset == gold["occurrences"][0]["start"]
        assert list(mention.matched_aliases) == gold["matched_aliases"]
        assert [span(item) for item in mention.occurrences] == gold["occurrences"]
    assert len(result.ambiguities) == len(expected["ambiguities"])
    for actual_occurrence, gold in zip(result.ambiguities, expected["ambiguities"], strict=True):
        assert span(actual_occurrence) == {key: gold[key] for key in span(actual_occurrence)}
        assert actual_occurrence.candidate_subject_ids == tuple(
            sorted(identity(label) for label in gold["subject_ids"])
        )
        assert actual_occurrence.ambiguity_reason == gold["reason"]
        assert list(actual_occurrence.matched_aliases) == gold["matched_aliases"]
    assert result.review_required_reasons == ((ALIAS_AMBIGUOUS,) if result.ambiguities else ())
    for item in [*result.ambiguities, *(o for m in result.mentions for o in m.occurrences)]:
        assert case["text"][item.start : item.end] == item.excerpt
    assert identify_mentions(case["text"], snapshot) == result
    assert (
        identify_mentions(
            case["text"], freeze_subject_aliases(list(reversed(subjects(case["subject_ids"]))))
        )
        == result
    )


@pytest.mark.parametrize("case", SHARED["gold"]["cases"], ids=lambda case: case["id"])
def test_shared_analysis_gold_mentions(case: dict[str, Any]) -> None:
    corpus = SHARED["corpus"]
    answer = next(row for row in corpus["answers"] if row["id"] == case["answer_id"])
    question = next(row for row in corpus["questions"] if row["id"] == answer["question_id"])
    result = identify_mentions(
        answer["text"], freeze_subject_aliases(subjects(question["subject_ids"]))
    )
    expected = case["expected"]["mentions"]
    actual = {row.subject_id: row for row in result.mentions}
    assert set(actual) == {
        identity(row["subject_ids"][0]) for row in expected if row["mentioned"] is True
    }
    ambiguous = [row for row in expected if row["mentioned"] is None]
    assert len(result.ambiguities) == len(ambiguous)
    for row in expected:
        if row["mentioned"] is True:
            assert row["excerpt"] in {
                item.excerpt for item in actual[identity(row["subject_ids"][0])].occurrences
            }
        elif row["mentioned"] is False:
            assert identity(row["subject_ids"][0]) not in actual
    for occurrence, gold in zip(result.ambiguities, ambiguous, strict=True):
        assert occurrence.candidate_subject_ids == tuple(sorted(map(identity, gold["subject_ids"])))
        assert occurrence.excerpt == gold["excerpt"]
    assert result.review_required_reasons == ((ALIAS_AMBIGUOUS,) if ambiguous else ())


def test_frozen_aliases_do_not_follow_later_catalog_dto_changes() -> None:
    inputs = subjects(["subject-base", "subject-own-brand"])
    snapshot = freeze_subject_aliases(inputs)
    original = identify_mentions("GEOFX731Q", snapshot)
    inputs[0].aliases.clear()
    inputs[0].canonical_name = "虚构新型号"
    inputs[0].revision += 1
    assert identify_mentions("GEOFX731Q", snapshot) == original
    assert identify_mentions("GEOFX731Q", freeze_subject_aliases(inputs)).mentions == ()
    frozen = next(row for row in snapshot.subjects if row.subject_id == inputs[0].id)
    assert frozen.revision == 3
    with pytest.raises(FrozenInstanceError):
        frozen.revision = 99  # type: ignore[misc]
    assert {item.alias_kind for item in frozen.aliases} == {
        GeoSubjectAliasKind.NAME,
        GeoSubjectAliasKind.PART_NUMBER,
    }
    assert {item.language_code for item in frozen.aliases} == {None, "en"}


def test_bad_dictionary_fails_without_echoing_input() -> None:
    inputs = subjects(["subject-base"])
    inputs[0].aliases[0].normalized_alias = "虚构错误规范键"
    with pytest.raises(ValueError, match="提及快照别名规范键不一致") as error:
        freeze_subject_aliases(inputs)
    assert "虚构错误规范键" not in str(error.value)
    assert "GEOFX" not in str(error.value)
    for invalid in [[], [inputs[0], inputs[0]]]:
        with pytest.raises(ValueError, match="唯一监测对象"):
            freeze_subject_aliases(invalid)


@pytest.mark.parametrize("text", ["", "  \n", "GEOFX-731Q\x00"])
def test_invalid_answer_fails(text: str) -> None:
    with pytest.raises(ValueError, match="有效回答正文"):
        identify_mentions(text, freeze_subject_aliases(subjects(["subject-base"])))


def test_scope_and_metadata_do_not_guess_a_subject_or_an_extra_alias() -> None:
    inputs = subjects(["subject-own-brand", "subject-competitor-brand"])
    inputs[0].aliases[-1].language_code = "zh-CN"
    inputs[1].aliases[-1].language_code = "en"
    inputs[1].role = GeoPlanSubjectRole.COMPETITOR
    inputs[0].display_name = "虚构未登记展示名"
    snapshot = freeze_subject_aliases(inputs)
    assert identify_mentions("虚构未登记展示名", snapshot).mentions == ()
    result = identify_mentions("桥芯", snapshot)
    assert result.mentions == ()
    assert result.ambiguities[0].candidate_subject_ids == tuple(sorted(row.id for row in inputs))
    assert (
        identify_mentions("桥芯", freeze_subject_aliases(inputs[:1])).mentions[0].subject_id
        == inputs[0].id
    )


def test_confirmed_result_fits_existing_public_mention_contract_and_safe_repr() -> None:
    snapshot = freeze_subject_aliases(subjects(["subject-base"]))
    result = identify_mentions("不推荐 GEOFX-731Q", snapshot)
    mention = result.mentions[0]
    dto = GeoEntityMentionOut(
        id=UUID(int=901),
        analysis_revision_id=UUID(int=902),
        subject_id=mention.subject_id,
        mention_count=mention.mention_count,
        first_character_offset=mention.first_character_offset,
        matched_aliases=list(mention.matched_aliases),
        confidence=None,
    )
    assert dto.mention_count == 1
    assert mention.occurrences[0].negation_cues == ("不推荐",)
    for value in [snapshot, result, mention, mention.occurrences[0]]:
        assert "GEOFX" not in repr(value)
        assert "不推荐" not in repr(value)
