"""矩阵与费用金标；估价替身只计算，无 provider、Batch/Run 或 I/O。"""

from dataclasses import replace
from decimal import Decimal
from typing import Any
from uuid import uuid4

import pytest

from app.collectors.registry import CollectorCapability, CollectorRegistry, collector_registry
from app.schemas.geo_monitoring_plans import GeoMonitoringPlanCreate
from app.schemas.geo_surfaces import GeoCollectionMode as Mode
from app.services.geo_collection_profiles import ProfileFacts
from app.services.geo_plans import (
    CellCostEstimate,
    PlanMatrixSelection,
    PromptFacts,
    RunMatrixBuilder,
)
from tests.unit.test_geo_collector_registry import SWITCHES, profile, registration, surface


def matrix_inputs(n: int = 10, repeat: int = 3, **patch: Any):
    s = surface()
    profiles = {}
    for mode in Mode:
        p = profile(
            s, mode, adapter_key="manual" if mode == Mode.MANUAL else "test-" + mode.lower()
        )
        profiles[p.id] = ProfileFacts(p, s, None)
    subject = uuid4()
    prompts = {}
    for index in range(n):
        key = uuid4()
        prompts[key] = PromptFacts(key, 0, True, "zh-hans", "CN", f"虚构问题{index}")
    configuration = GeoMonitoringPlanCreate(
        name="虚构计划",
        subjects=[{"subject_id": subject, "role": "PRIMARY"}],
        prompt_variant_ids=list(prompts),
        collection_profile_ids=list(profiles),
        repeat_count=repeat,
        **patch,
    )
    selection = PlanMatrixSelection.from_configuration(configuration)
    registry = CollectorRegistry(
        [
            collector_registry.resolve("manual"),
            registration(key="test-api"),
            registration(Mode.BROWSER, key="test-browser"),
        ]
    )
    return RunMatrixBuilder(registry), selection, {subject: True}, prompts, profiles


def build(inputs, **patch):
    builder, selection, subjects, prompts, profiles = inputs
    return builder.build(
        selection, subjects=subjects, prompts=prompts, profiles=profiles, switches=SWITCHES, **patch
    )


def test_ten_by_three_by_three_is_ninety_unique_deterministic_cells() -> None:
    inputs = matrix_inputs()
    result = build(inputs)
    preview = result.preview()
    assert preview.run_count == 90
    assert (preview.manual_run_count, preview.api_run_count, preview.browser_run_count) == (
        30,
        30,
        30,
    )
    assert preview.unresolved_run_count == 0 and not preview.blockers
    cells = list(result.cells())
    assert len(set(cells)) == len(cells) == 90
    assert {c.repeat_index for c in cells} == {1, 2, 3}
    builder, selection, subjects, prompts, profiles = inputs
    extra = uuid4()
    reordered = replace(
        selection,
        subject_ids=(*selection.subject_ids, extra),
        prompt_variant_ids=tuple(reversed(selection.prompt_variant_ids)),
        collection_profile_ids=tuple(reversed(selection.collection_profile_ids)),
    )
    other = builder.build(
        reordered,
        subjects={**subjects, extra: True},
        prompts=prompts,
        profiles=profiles,
        switches=SWITCHES,
    )
    # 对象不参与乘法，三个Profile共享Surface也不合并。
    assert other.run_count == 90 and list(other.cells()) == cells


@pytest.mark.parametrize("n,repeat,expected", [(1, 1, 3), (1, 10, 30), (100, 10, 3000)])
def test_repeat_and_large_matrix_boundaries(n: int, repeat: int, expected: int) -> None:
    result = build(matrix_inputs(n, repeat))
    assert result.run_count == expected == len(list(result.cells()))


@pytest.mark.parametrize("repeat", [0, 11, True, "3"])
def test_internal_repeat_cannot_bypass_contract(repeat: Any) -> None:
    selection = matrix_inputs()[1]
    with pytest.raises(ValueError):
        replace(selection, repeat_count=repeat)


@pytest.mark.parametrize("name", ["subject_ids", "prompt_variant_ids", "collection_profile_ids"])
def test_internal_empty_duplicate_selection_rejected(name: str) -> None:
    selection = matrix_inputs()[1]
    ids = getattr(selection, name)
    for invalid in [(), (ids[0], ids[0])]:
        with pytest.raises(ValueError):
            replace(selection, **{name: invalid})


@pytest.mark.parametrize(
    "resource,disabled,code",
    [
        ("subject", False, "SUBJECT_NOT_FOUND"),
        ("subject", True, "SUBJECT_DISABLED"),
        ("prompt", False, "PROMPT_NOT_FOUND"),
        ("prompt", True, "PROMPT_DISABLED"),
        ("profile", False, "PROFILE_NOT_FOUND"),
        ("profile", True, "PROFILE_DISABLED"),
        ("surface", True, "SURFACE_DISABLED"),
    ],
)
def test_unavailable_resources_block_without_silently_shrinking_matrix(resource, disabled, code):
    inputs = matrix_inputs()
    _, _, subjects, prompts, profiles = inputs
    if resource == "subject":
        key = next(iter(subjects))
        subjects[key] = False
        if not disabled:
            del subjects[key]
    elif resource == "prompt":
        key = next(iter(prompts))
        prompts[key] = replace(prompts[key], is_active=False)
        if not disabled:
            del prompts[key]
    else:
        key = next(iter(profiles))
        facts = profiles[key]
        profiles[key] = replace(
            facts, **{resource: replace(getattr(facts, resource), is_active=False)}
        )
        if not disabled:
            del profiles[key]
    result = build(inputs).preview()
    assert result.run_count == 90
    assert any(b.code == code and b.resource_id == key for b in result.blockers)
    assert result.unresolved_run_count == (30 if resource == "profile" and not disabled else 0)


def test_missing_capability_and_unknown_adapter_reuse_shared_policy() -> None:
    inputs = matrix_inputs()
    profiles = inputs[4]
    key = next(iter(profiles))
    facts = profiles[key]
    profiles[key] = replace(
        facts,
        surface=replace(
            facts.surface, capabilities=facts.surface.capabilities - {CollectorCapability.CITATIONS}
        ),
    )
    result = build(
        inputs, required_capabilities=frozenset({CollectorCapability.CITATIONS})
    ).preview()
    assert any(b.code == "CAPABILITY_UNSUPPORTED" and b.resource_id == key for b in result.blockers)
    profiles[key] = replace(facts, profile=replace(facts.profile, adapter_key="unknown"))
    result = build(inputs).preview()
    assert any(b.code == "ADAPTER_UNKNOWN" and b.resource_id == key for b in result.blockers)


def test_closed_switch_and_unapproved_browser_are_not_relaxed() -> None:
    inputs = matrix_inputs()
    builder, selection, subjects, prompts, profiles = inputs
    result = builder.build(
        selection,
        subjects=subjects,
        prompts=prompts,
        profiles=profiles,
        switches=replace(SWITCHES, api_collection_enabled=False),
    )
    assert any(b.code == "API_COLLECTION_DISABLED" for b in result.blockers)
    browser = next(p for p in profiles.values() if p.profile.collection_mode == Mode.BROWSER)
    profiles[browser.profile.id] = replace(
        browser, surface=replace(browser.surface, compliance_status="NOT_REVIEWED")
    )
    assert any(b.code == "COMPLIANCE_NOT_APPROVED" for b in build(inputs).blockers)


def test_default_estimate_all_unknown_even_with_cost_capability_and_manual_mode() -> None:
    result = build(matrix_inputs(budget_limit="0")).preview()
    cost = result.estimated_cost
    assert cost.value is None and cost.currency is None and cost.coverage == "NONE"
    assert (cost.known_run_count, cost.unknown_run_count, cost.known_costs) == (0, 90, [])
    assert not result.blockers
    assert {w.code for w in result.warnings} >= {"COST_UNKNOWN", "BUDGET_UNVERIFIED"}


def test_partial_cost_aggregates_per_prompt_profile_repeat_without_inventing_missing_prices() -> (
    None
):
    def estimate(prompt, facts):
        # 10个文本有不同长度；独立金标按0..9的后缀计算，不能只按profile给固定总额。
        return (
            CellCostEstimate(Decimal(prompt.prompt_text[-1]) / 100 + Decimal("0.000001"), "USD")
            if facts.profile.collection_mode == Mode.API
            else None
        )

    result = build(matrix_inputs(), estimate=estimate).preview()
    cost = result.estimated_cost
    assert cost.value == Decimal("1.350030") and cost.currency == "USD"
    assert (cost.known_run_count, cost.unknown_run_count, cost.coverage) == (30, 60, "PARTIAL")
    assert result.model_dump(mode="json")["estimated_cost"]["value"] == "1.35003"


@pytest.mark.parametrize(
    "price,budget,blocked",
    [
        ("0", "0", False),
        ("0.01", "0.90", False),
        ("0.01", "0.899999", True),
    ],
)
def test_complete_cost_and_exact_budget_boundary(price, budget, blocked):
    result = build(
        matrix_inputs(budget_limit=budget),
        estimate=lambda p, f: CellCostEstimate(Decimal(price), "USD"),
    ).preview()
    assert result.estimated_cost.coverage == "COMPLETE"
    assert (
        result.estimated_cost.known_run_count == 90 and result.estimated_cost.unknown_run_count == 0
    )
    assert ("BUDGET_EXCEEDED" in {b.code for b in result.blockers}) == blocked
    assert "BUDGET_UNVERIFIED" not in {w.code for w in result.warnings}


def test_known_partial_subtotal_already_exceeding_budget_blocks() -> None:
    result = build(
        matrix_inputs(budget_limit="0.1"),
        estimate=lambda p, f: (
            CellCostEstimate(Decimal("0.01"), "USD")
            if f.profile.collection_mode == Mode.API
            else None
        ),
    ).preview()
    assert result.estimated_cost.value == Decimal("0.30")
    assert {b.code for b in result.blockers} == {"BUDGET_EXCEEDED"}
    assert "BUDGET_UNVERIFIED" in {w.code for w in result.warnings}


def test_mixed_currency_preserves_totals_without_sum_or_conversion() -> None:
    result = build(
        matrix_inputs(budget_limit="100"),
        estimate=lambda p, f: CellCostEstimate(
            Decimal("0.01"), "USD" if f.profile.collection_mode == Mode.API else "CNY"
        ),
    ).preview()
    cost = result.estimated_cost
    assert cost.value is None and cost.currency is None and cost.coverage == "COMPLETE"
    assert {t.currency: t.value for t in cost.known_costs} == {
        "CNY": Decimal("0.6"),
        "USD": Decimal("0.3"),
    }
    assert {b.code for b in result.blockers} == {"BUDGET_CURRENCY_MISMATCH"}


@pytest.mark.parametrize(
    "value",
    [
        Decimal("NaN"),
        Decimal("Infinity"),
        Decimal("-0.1"),
        Decimal("0.0000001"),
        Decimal("100000000"),
        0.1,
    ],
)
def test_invalid_estimate_fails_explicitly(value: Any) -> None:
    with pytest.raises(ValueError):
        CellCostEstimate(value, "USD")


def test_estimator_failure_propagates_and_ineligible_profile_is_not_estimated() -> None:
    inputs = matrix_inputs()
    profiles = inputs[4]
    key = next(iter(profiles))
    facts = profiles[key]
    profiles[key] = replace(facts, profile=replace(facts.profile, is_active=False))
    calls = []

    def estimate(p, f):
        calls.append(f.profile.id)
        return CellCostEstimate(Decimal("0"), "USD")

    result = build(inputs, estimate=estimate).preview()
    assert key not in calls and result.estimated_cost.unknown_run_count == 30

    def fail(p, f):
        raise RuntimeError("虚构估价错误")

    with pytest.raises(RuntimeError, match="虚构估价错误"):
        build(inputs, estimate=fail)


def test_environment_and_version_warnings_have_resource_location() -> None:
    inputs = matrix_inputs()
    profiles = inputs[4]
    key = next(iter(profiles))
    facts = profiles[key]
    profiles[key] = replace(
        facts,
        profile=replace(facts.profile, region_code="US"),
        surface=replace(
            facts.surface,
            capabilities=facts.surface.capabilities - {CollectorCapability.MODEL_VERSION},
        ),
    )
    result = build(inputs).preview()
    assert {w.code for w in result.warnings} >= {
        "MIXED_PROFILE_ENVIRONMENTS",
        "MIXED_COLLECTION_MODES",
        "MODEL_VERSION_UNKNOWN",
    }
    mismatch = [w for w in result.warnings if w.code == "PROMPT_PROFILE_ENVIRONMENT_MISMATCH"]
    assert len(mismatch) == 10 and all(w.related_resource_id == key for w in mismatch)


def test_large_known_total_is_not_limited_to_single_budget_numeric_precision() -> None:
    result = build(
        matrix_inputs(), estimate=lambda p, f: CellCostEstimate(Decimal("99999999.999999"), "USD")
    ).preview()
    assert result.estimated_cost.value == Decimal("8999999999.999910")
