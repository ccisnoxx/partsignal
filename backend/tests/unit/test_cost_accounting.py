"""Slice 4B：AI 冻结成本计算与 Schema 单元测试。"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import ValidationError

from app.schemas.cost_accounting import (
    AIModelPricingUpdate,
    OperatingCostEntryCreate,
    OperatingCostEntryVoidRequest,
)
from app.services.cost_accounting import compute_frozen_ai_cost


def _fake_model(
    *,
    input_price: Decimal | None,
    output_price: Decimal | None,
    currency: str | None,
) -> Any:
    return SimpleNamespace(
        input_price_per_1m_tokens=input_price,
        output_price_per_1m_tokens=output_price,
        price_currency=currency,
    )


def test_compute_frozen_ai_cost_exact_decimal() -> None:
    model = _fake_model(
        input_price=Decimal("2.500000"),
        output_price=Decimal("10.000000"),
        currency="USD",
    )
    amount, currency = compute_frozen_ai_cost(
        model,
        prompt_tokens=1500,
        completion_tokens=400,
    )
    # 1500 * 2.5 / 1e6 + 400 * 10 / 1e6 = 0.00375 + 0.004 = 0.007750
    assert amount == Decimal("0.007750")
    assert currency == "USD"


def test_compute_frozen_ai_cost_unpriced_returns_none_never_fake_zero() -> None:
    unpriced_model = _fake_model(input_price=None, output_price=None, currency=None)
    assert compute_frozen_ai_cost(unpriced_model, prompt_tokens=1000, completion_tokens=500) == (
        None,
        None,
    )
    assert compute_frozen_ai_cost(None, prompt_tokens=1000, completion_tokens=500) == (None, None)


def test_compute_frozen_ai_cost_explicit_zero_price_preserves_zero() -> None:
    free_model = _fake_model(
        input_price=Decimal("0"),
        output_price=Decimal("0"),
        currency="CNY",
    )
    assert compute_frozen_ai_cost(free_model, prompt_tokens=1200, completion_tokens=300) == (
        Decimal("0.000000"),
        "CNY",
    )


def test_compute_frozen_ai_cost_missing_or_negative_tokens_returns_none() -> None:
    priced_model = _fake_model(
        input_price=Decimal("1.25"),
        output_price=Decimal("5.00"),
        currency="USD",
    )
    assert compute_frozen_ai_cost(priced_model, prompt_tokens=None, completion_tokens=100) == (
        None,
        None,
    )
    assert compute_frozen_ai_cost(priced_model, prompt_tokens=100, completion_tokens=None) == (
        None,
        None,
    )
    assert compute_frozen_ai_cost(priced_model, prompt_tokens=-1, completion_tokens=100) == (
        None,
        None,
    )


def test_pricing_and_cost_entry_schema_validation() -> None:
    # 三字段同空可清空定价
    cleared = AIModelPricingUpdate(expected_revision=1)
    assert cleared.price_currency is None

    # 部分填写被拒绝
    with pytest.raises(ValidationError):
        AIModelPricingUpdate(
            input_price_per_1m_tokens="1.5",  # type: ignore[arg-type]
            output_price_per_1m_tokens=None,
            price_currency="USD",
            expected_revision=1,
        )

    # 非法小数位或科学计数法被拒绝
    with pytest.raises(ValidationError):
        AIModelPricingUpdate(
            input_price_per_1m_tokens="1e3",  # type: ignore[arg-type]
            output_price_per_1m_tokens="2",  # type: ignore[arg-type]
            price_currency="USD",
            expected_revision=1,
        )

    # 费用台账必须至少绑定 Campaign 或 GeoIntervention
    with pytest.raises(ValidationError):
        OperatingCostEntryCreate(
            category="LABOR",
            amount="120.50",  # type: ignore[arg-type]
            currency="CNY",
            incurred_on=date(2026, 11, 27),
        )

    entry = OperatingCostEntryCreate(
        campaign_id=uuid.uuid4(),
        category="EXTERNAL_PLACEMENT",
        amount="800.00",  # type: ignore[arg-type]
        currency="CNY",
        incurred_on=date(2026, 11, 27),
        note="行业媒体专栏投放",
    )
    assert entry.amount == Decimal("800.00")

    # 作废原因不能为空白
    with pytest.raises(ValidationError):
        OperatingCostEntryVoidRequest(reason="   ")


def test_geo_intervention_review_fixes_schema_and_comparison_parser() -> None:
    from app.schemas.geo_interventions import (
        GeoInterventionCreate,
        GeoInterventionTargetMetrics,
        GeoInterventionUpdate,
    )
    from app.services.geo_intervention_queries import _extract_comparison_deltas

    # 1. 混传 naive + aware 时间戳由 Pydantic 显式拒绝（422，严禁抛 TypeError 导致 500）
    with pytest.raises(ValidationError):
        GeoInterventionCreate(
            opportunity_id=uuid.uuid4(),
            title="时间校验",
            hypothesis="测试混合时区",
            planned_action_type="CONTENT_TASK",
            retest_window_start="2026-11-27T10:00:00",  # type: ignore[arg-type]
            retest_window_end="2026-11-28T10:00:00Z",  # type: ignore[arg-type]
        )
    with pytest.raises(ValidationError):
        GeoInterventionUpdate(
            title="时间校验",
            hypothesis="测试混合时区",
            planned_action_type="CONTENT_TASK",
            status="ACTIVE",
            expected_revision=1,
            retest_window_start="2026-11-27T10:00:00",  # type: ignore[arg-type]
            retest_window_end="2026-11-28T10:00:00Z",  # type: ignore[arg-type]
        )

    # 2. 按真实 R6 GeoRetestComparison 结构提取差值与可比性原因
    fake_decision: Any = SimpleNamespace(
        comparison_snapshot={
            "comparable": False,
            "differences": [
                {"code": "MODEL_VERSION_CHANGED", "field": "source_version"},
                {"code": "MODEL_VERSION_CHANGED", "field": "source_version"},
            ],
            "recovery": {
                "status": "NOT_COMPARABLE",
                "reasons": ["INSUFFICIENT_SAMPLE"],
            },
            "baseline": {
                "metrics": [
                    {"metric_code": "natural_visibility", "value": 0.25},
                    {"metric_code": "owned_source_coverage", "value": 0.1},
                    {"metric_code": "incorrect_claim_rate", "value": 0.2},
                ]
            },
            "retest": {
                "metrics": [
                    {"metric_code": "natural_visibility", "value": 0.45},
                    {"metric_code": "owned_source_coverage", "value": 0.35},
                    {"metric_code": "incorrect_claim_rate", "value": 0.05},
                ]
            },
        }
    )
    targets = GeoInterventionTargetMetrics(
        target_mention_rate=0.4,
        target_citation_rate=0.5,
        target_accuracy_rate=0.9,
    )
    comparable, reasons, deltas = _extract_comparison_deltas(fake_decision, targets)
    assert comparable is False
    assert reasons == ["MODEL_VERSION_CHANGED", "INSUFFICIENT_SAMPLE"]
    by_code = {item.metric_code: item for item in deltas}
    assert by_code["natural_visibility"].delta == 0.2
    assert by_code["natural_visibility"].target_value == 0.4
    assert by_code["natural_visibility"].target_met is True
    assert by_code["owned_source_coverage"].delta == 0.25
    assert by_code["owned_source_coverage"].target_met is False
    # 反向错误率不误用正向 target_accuracy_rate 判达标
    assert by_code["incorrect_claim_rate"].delta == -0.15
    assert by_code["incorrect_claim_rate"].target_value is None
    assert by_code["incorrect_claim_rate"].target_met is None
