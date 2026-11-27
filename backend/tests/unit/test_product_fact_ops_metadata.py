"""Slice 2A：产品事实运营元数据、新鲜度投影与外发边界单元测试。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.models.product_facts import FactVersion, Product
from app.schemas.product_facts import (
    Confidentiality,
    ProductFactsConfirmReviewRequest,
    ProductFactsDraftUpdate,
    ProductFactsFreshness,
    ProductWorkflowStage,
)
from app.services.product_facts import (
    product_facts_draft_out,
    product_facts_freshness,
    product_workflow,
)


class _FakeSession:
    def __init__(self, versions: list[FactVersion]) -> None:
        self._versions = versions

    def scalars(self, _stmt: Any) -> list[FactVersion]:
        return self._versions


def _make_product() -> Product:
    now = datetime(2026, 11, 27, 8, 0, tzinfo=UTC)
    return Product(
        id=uuid.uuid4(),
        part_number="PS-BUCK-01",
        normalized_part_number="ps-buck-01",
        brand="PartSignal",
        normalized_brand="partsignal",
        category="DC-DC",
        status="ACTIVE",
        revision=1,
        facts_revision=2,
        facts_body_markdown="## 核心参数\n输入电压 4.5V-36V",
        facts_classification="PUBLIC",
        source_owner="产品负责人 A",
        next_review_at=now - timedelta(days=1),
        facts_source_reference="INTERNAL-DOC-2026-009",
        facts_verified_at=now - timedelta(days=30),
        facts_applicable_region="中国大陆",
        facts_content_restrictions="禁止宣称 100% Pin-to-Pin 直接替代",
        facts_approved_claims_summary="支持宽压输入 4.5V-36V 工业降压场景",
        created_at=now,
        updated_at=now,
    )


def _make_approved_fact(product: Product) -> FactVersion:
    now = datetime(2026, 11, 27, 8, 0, tzinfo=UTC)
    return FactVersion(
        id=uuid.uuid4(),
        product_id=product.id,
        version=1,
        status="APPROVED",
        body_markdown=product.facts_body_markdown,
        classification=product.facts_classification,
        source_reference=product.facts_source_reference,
        verified_at=product.facts_verified_at,
        applicable_region=product.facts_applicable_region,
        content_restrictions=product.facts_content_restrictions,
        approved_claims_summary=product.facts_approved_claims_summary,
        change_summary="初始已批准事实",
        revision=1,
        created_by=uuid.uuid4(),
        approved_by=uuid.uuid4(),
        created_at=now,
        approved_at=now,
    )


def test_product_facts_freshness_boundaries() -> None:
    now = datetime(2026, 11, 27, 8, 0, tzinfo=UTC)
    assert product_facts_freshness(None, now=now) == ProductFactsFreshness.UNSET
    assert product_facts_freshness(now, now=now) == ProductFactsFreshness.OVERDUE
    assert (
        product_facts_freshness(now - timedelta(seconds=1), now=now)
        == ProductFactsFreshness.OVERDUE
    )
    assert (
        product_facts_freshness(now + timedelta(seconds=1), now=now)
        == ProductFactsFreshness.FRESH
    )


def test_product_workflow_distinguishes_mutable_governance_and_frozen_metadata() -> None:
    product = _make_product()
    approved = _make_approved_fact(product)

    # 仅修改可变治理态（source_owner / next_review_at），工作流保持 FACT_APPROVED。
    product.source_owner = "新产品负责人 B"
    product.next_review_at = datetime(2027, 6, 1, 0, 0, tzinfo=UTC)
    stage, primary = product_workflow(product, approved, has_pending=False)
    assert stage == ProductWorkflowStage.FACT_APPROVED
    assert primary == "CREATE_CONTENT_TASK"

    # 修改任意 5 项冻结元数据之一，立即回退为 FACTS_EDITING，要求提交新审核。
    product.facts_content_restrictions = "禁止宣称 100% 替代且禁止用于车规"
    stage_edited, primary_edited = product_workflow(product, approved, has_pending=False)
    assert stage_edited == ProductWorkflowStage.FACTS_EDITING
    assert primary_edited == "SUBMIT_FACT_REVIEW"


def test_draft_update_normalizes_whitespace_and_rejects_naive_datetime() -> None:
    payload = ProductFactsDraftUpdate.model_validate(
        {
            "expected_revision": 1,
            "body_markdown": "## 事实",
            "classification": Confidentiality.PUBLIC,
            "source_owner": "  张工  ",
            "source_reference": "   ",
            "applicable_region": " 全球 ",
            "content_restrictions": "  禁止绝对替代  ",
            "approved_claims_summary": "",
        }
    )
    assert payload.source_owner == "张工"
    assert payload.source_reference is None
    assert payload.applicable_region == "全球"
    assert payload.content_restrictions == "禁止绝对替代"
    assert payload.approved_claims_summary is None

    with pytest.raises(ValidationError):
        ProductFactsConfirmReviewRequest.model_validate(
            {"expected_revision": 1, "next_review_at": "2027-06-01T08:00:00"}
        )


def test_confirm_review_action_only_available_when_active_approved_and_no_pending() -> None:
    now = datetime(2026, 11, 27, 8, 0, tzinfo=UTC)
    product = _make_product()
    approved = _make_approved_fact(product)

    approved_only = product_facts_draft_out(
        cast(Session, _FakeSession([approved])), product, now=now
    )
    assert approved_only.facts_freshness == ProductFactsFreshness.OVERDUE
    assert approved_only.available_actions == ["SAVE", "SUBMIT_REVIEW", "CONFIRM_REVIEW"]

    no_approved = product_facts_draft_out(cast(Session, _FakeSession([])), product, now=now)
    assert no_approved.available_actions == ["SAVE", "SUBMIT_REVIEW"]

    pending = _make_approved_fact(product)
    pending.status = "PENDING_REVIEW"
    pending.version = 2
    with_pending = product_facts_draft_out(
        cast(Session, _FakeSession([pending, approved])), product, now=now
    )
    assert with_pending.available_actions == ["SAVE"]

    product.status = "RETIRED"
    retired = product_facts_draft_out(cast(Session, _FakeSession([approved])), product, now=now)
    assert retired.available_actions == []
