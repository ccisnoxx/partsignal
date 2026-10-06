"""GEO-505 对照人工声明金标；事实资格、原文证据及本地安全边界。"""

import socket
from dataclasses import FrozenInstanceError, replace
from typing import Any
from uuid import uuid4

import pytest
from geo_fixtures import (
    GeoFixtureError,
    load_geo_claim_fixtures,
    validate_geo_claim_fixtures,
)
from test_geo_analysis import SHARED, identity, subjects

from app.schemas.geo_analysis import GeoClaimAssessmentOut, GeoClaimKind
from app.schemas.product_facts import Confidentiality, FactVersionStatus
from app.services.geo_claims import (
    CLAIM_RULE_VERSION,
    CLAIM_SCOPE_AMBIGUOUS,
    CLAIM_TEXT_TOO_LONG,
    assess_claims,
)
from app.services.geo_fact_versions import (
    FactAssembly,
    FactCandidate,
    SubjectFact,
    freeze_fact_versions,
)

GOLD = load_geo_claim_fixtures()


def candidates() -> list[FactCandidate]:
    return [
        FactCandidate(
            identity(row["id"]),
            identity(row["product_id"]),
            row["version"],
            FactVersionStatus(row["status"]),
            Confidentiality(row["classification"]),
            row["markdown"],
        )
        for row in SHARED["corpus"]["fact_versions"]
    ]


@pytest.mark.parametrize("case", GOLD["cases"], ids=lambda row: row["id"])
def test_claim_gold(case: dict[str, Any]) -> None:
    scope = subjects(case["subject_ids"])
    facts = candidates()
    facts[0] = replace(
        facts[0],
        status=FactVersionStatus(case["fact_status"]),
        body_markdown=case["fact_body"]
        if case["fact_body"] is not None
        else facts[0].body_markdown,
    )
    result = assess_claims(case["text"], scope, freeze_fact_versions(scope, facts))
    assert result.rule_set_version == CLAIM_RULE_VERSION
    expected = [
        {**row, "subject_id": identity(row["subject_id"])} for row in case["expected"]["claims"]
    ]
    assert [
        {
            "subject_id": row.subject_id,
            "claim_kind": row.claim_kind,
            "verdict": row.verdict,
            "severity": row.severity,
        }
        for row in result.assessments
    ] == expected
    assert list(result.review_required_reasons) == case["expected"]["review_required_reasons"]
    for row in result.assessments:
        assert row.claim_text == case["text"][row.start : row.end]
        if row.fact_excerpt:
            assert row.fact_excerpt in facts[0].body_markdown
        if row.fact_version_id is None:
            assert row.verdict == "UNJUDGEABLE" and row.fact_excerpt is None


@pytest.mark.parametrize("case", SHARED["gold"]["cases"], ids=lambda row: row["id"])
def test_shared_claim_gold(case: dict[str, Any]) -> None:
    corpus = SHARED["corpus"]
    answer = next(row for row in corpus["answers"] if row["id"] == case["answer_id"])
    question = next(row for row in corpus["questions"] if row["id"] == answer["question_id"])
    scope = subjects(question["subject_ids"])
    result = assess_claims(answer["text"], scope, freeze_fact_versions(scope, candidates()))
    expected = case["expected"]["claims"]
    assert len(result.assessments) == len(expected)
    for actual, gold in zip(result.assessments, expected, strict=True):
        assert actual.subject_id == identity(gold["subject_id"])
        assert actual.fact_version_id == identity(gold["fact_version_id"])
        kind = "REPLACEMENT_RELATION" if gold["claim_type"] == "REPLACEMENT" else gold["claim_type"]
        assert actual.claim_kind == kind
        assert actual.claim_text == gold["excerpt"]
        assert actual.verdict == gold["verdict"] and actual.severity == gold["severity"]


def test_each_own_product_uses_its_own_fact_and_alias_suffix() -> None:
    scope = subjects(["subject-base", "subject-suffix"])
    text = "GEOFX-731Q 的供电电压为 3.3 V，GEOFX-731Q-S 的供电电压为 1.8 V。"
    result = assess_claims(text, scope, freeze_fact_versions(scope, candidates()))
    assert [row.verdict for row in result.assessments] == ["ACCURATE", "ACCURATE"]
    assert {row.fact_version_id for row in result.assessments} == {row.id for row in candidates()}
    suffix_only = assess_claims(
        "GEOFX-731Q-S 的供电电压为 3.3 V。", scope, freeze_fact_versions(scope, candidates()[:1])
    )
    assert suffix_only.assessments[0].verdict == "UNJUDGEABLE"
    assert suffix_only.assessments[0].fact_version_id is None


def test_ambiguous_alias_cannot_pick_an_own_product() -> None:
    scope = subjects(["subject-own-brand", "subject-competitor-brand"])
    result = assess_claims("桥芯的封装为 QFN-12。", scope, freeze_fact_versions(scope, ()))
    assert not result.assessments
    assert "ALIAS_AMBIGUOUS" in result.review_required_reasons


def test_joined_products_and_long_claims_require_review() -> None:
    scope = subjects(["subject-base", "subject-suffix"])
    facts = freeze_fact_versions(scope, candidates())
    joined = assess_claims("GEOFX-731Q 和 GEOFX-731Q-S 的供电电压为 1.8 V。", scope, facts)
    assert all(row.verdict == "UNJUDGEABLE" for row in joined.assessments)
    assert CLAIM_SCOPE_AMBIGUOUS in joined.review_required_reasons
    long = assess_claims("GEOFX-731Q 的供电电压为 3.3 V" + "，" * 2001, scope, facts)
    assert not long.assessments
    assert CLAIM_TEXT_TOO_LONG in long.review_required_reasons


def test_highest_qualifying_version_not_newest_draft() -> None:
    scope = subjects(["subject-base"])
    base = candidates()[0]
    approved = replace(base, id=uuid4(), version=2, body_markdown="供电电压为 5 V。")
    draft = replace(base, id=uuid4(), version=3, status=FactVersionStatus.PENDING_REVIEW)
    blank = replace(base, id=uuid4(), version=4, body_markdown=" \n\t　")
    retired = replace(base, id=uuid4(), version=5, status=FactVersionStatus.RETIRED)
    frozen = freeze_fact_versions(scope, [draft, base, retired, approved, blank])
    assert frozen.subjects[0].fact == approved
    result = assess_claims("GEOFX-731Q 的供电电压为 5 V。", scope, frozen)
    assert result.assessments[0].verdict == "ACCURATE"
    with pytest.raises(FrozenInstanceError):
        approved.version = 3  # type: ignore[misc]


def test_invalid_assembly_and_snapshot_mismatch_fail_without_body() -> None:
    scope = subjects(["subject-base"])
    base = candidates()[0]
    with pytest.raises(ValueError, match="同产品"):
        FactAssembly((SubjectFact(scope[0].id, uuid4(), 3, base),))
    with pytest.raises(ValueError, match="APPROVED"):
        FactAssembly(
            (
                SubjectFact(
                    scope[0].id, base.product_id, 3, replace(base, status=FactVersionStatus.RETIRED)
                ),
            )
        )
    frozen = freeze_fact_versions(scope, [base])
    scope[0].revision += 1
    with pytest.raises(ValueError, match="冻结监测对象"):
        assess_claims("GEOFX-731Q 的供电电压为 3.3 V。", scope, frozen)


@pytest.mark.parametrize("classification", list(Confidentiality))
def test_all_classifications_stay_local_and_out_of_repr(
    classification: Confidentiality,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def no_network(*args: Any, **kwargs: Any) -> None:
        pytest.fail("本地声明评估不能连接外部服务")

    monkeypatch.setattr(socket, "create_connection", no_network)
    monkeypatch.setattr(socket.socket, "connect", no_network)
    scope = subjects(["subject-base"])
    fact = replace(candidates()[0], classification=classification)
    frozen = freeze_fact_versions(scope, [fact])
    result = assess_claims("GEOFX-731Q 的供电电压为 3.3 V。", scope, frozen)
    assert result.assessments[0].verdict == "ACCURATE"
    assert "3.3" not in repr((fact, frozen, result, result.assessments[0]))
    row = result.assessments[0]
    wire = GeoClaimAssessmentOut(
        id=uuid4(),
        analysis_revision_id=uuid4(),
        subject_id=row.subject_id,
        fact_version_id=row.fact_version_id,
        claim_kind=row.claim_kind,
        claim_text=row.claim_text,
        claim_sha256="0" * 64,
        verdict=row.verdict,
        severity=row.severity,
        fact_excerpt=row.fact_excerpt,
        explanation=row.explanation,
        confidence=row.confidence,
    )
    assert wire.claim_kind == GeoClaimKind.PARAMETER


def test_fixture_schema_and_sensitive_scan_are_independent() -> None:
    invalid = load_geo_claim_fixtures()
    invalid["cases"][0]["fact_status"] = "PENDING_REVIEW"
    with pytest.raises(GeoFixtureError, match="不合格事实"):
        validate_geo_claim_fixtures(invalid)
    invalid = load_geo_claim_fixtures()
    invalid["cases"][0]["text"] = "Authorization: fixture-invalid-marker"
    with pytest.raises(GeoFixtureError, match="敏感") as error:
        validate_geo_claim_fixtures(invalid)
    assert "fixture-invalid-marker" not in str(error.value)


def test_later_replacement_conflict_is_not_overwritten_by_first_relation() -> None:
    scope = subjects(["subject-base", "subject-reference"])
    fact = replace(candidates()[0], body_markdown="不能替代 GEORF-915T。")
    text = "GEOFX-731Q 不能替代 GEORF-915T，GEOFX-731Q 可替代 GEORF-915T。"
    result = assess_claims(text, scope, freeze_fact_versions(scope, [fact]))
    assert [row.verdict for row in result.assessments] == ["ACCURATE", "INCORRECT"]
    assert "HIGH_SEVERITY_INCORRECT" in result.review_required_reasons
    assert result.assessments[0].start != result.assessments[1].start


def test_unmonitored_product_in_comparison_cannot_supply_own_claim() -> None:
    scope = subjects(["subject-base", "subject-reference"])
    fact = replace(candidates()[0], body_markdown="供电电压为 5 V。")
    result = assess_claims(
        "与 GEOFX-731Q 相比，GEOCX-842R 的供电电压为 5 V。",
        scope,
        freeze_fact_versions(scope, [fact]),
    )
    assert not any(row.verdict == "ACCURATE" for row in result.assessments)
    assert result.review_required_reasons


def test_each_replacement_keeps_its_own_preceding_conditions() -> None:
    scope = subjects(["subject-base", "subject-reference"])
    fact = replace(candidates()[0], body_markdown="仅在 3.3 V 供电时，可替代 GEORF-915T。")
    text = (
        "在 3.3 V 供电时，GEOFX-731Q 可替代 GEORF-915T，"
        "且在 3.3 V 供电时，GEOFX-731Q 可替代 GEORF-915T。"
    )
    result = assess_claims(text, scope, freeze_fact_versions(scope, [fact]))
    assert len(result.assessments) == 2
    assert all(row.verdict == "ACCURATE" for row in result.assessments)
    assert "HIGH_SEVERITY_INCORRECT" not in result.review_required_reasons
    assert all("在 3.3 V 供电时" in row.claim_text for row in result.assessments)
