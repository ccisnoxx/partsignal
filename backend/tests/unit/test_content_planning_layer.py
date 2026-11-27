"""Slice 2B 单元测试：ContentCampaign、QueryTopic 增强与 ContentBriefSnapshot 契约校验。"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.campaign import (
    ContentCampaignCounts,
    ContentCampaignCreate,
    ContentCampaignTargetMetrics,
)
from app.schemas.configuration import IntentType, QueryTopicCreate, QueryTopicUpdate
from app.schemas.content import ContentBriefInput, ContentBriefSuccessMetrics, ContentTaskCreate
from app.services.content_campaigns import _campaign_workflow


def test_campaign_create_validates_date_range_and_budget_pair() -> None:
    valid = ContentCampaignCreate(
        name="  TPS5430 国产替代活动  ",
        description="  多平台覆盖  ",
        target_audience="  硬件工程师  ",
        priority="HIGH",
        start_date=date(2026, 11, 1),
        end_date=date(2026, 12, 31),
        target_metrics=ContentCampaignTargetMetrics(
            target_content_count=12,
            target_recommendation_rate=0.4,
        ),
        budget_amount="15000.50",  # type: ignore[arg-type]
        budget_currency="CNY",
    )
    assert valid.name == "TPS5430 国产替代活动"
    assert valid.budget_amount == Decimal("15000.50")

    with pytest.raises(ValidationError):
        ContentCampaignCreate(
            name="非法日期",
            start_date=date(2026, 12, 1),
            end_date=date(2026, 11, 1),
        )

    with pytest.raises(ValidationError):
        ContentCampaignCreate(
            name="缺币种预算",
            budget_amount="100.00",  # type: ignore[arg-type]
            budget_currency=None,
        )

    with pytest.raises(ValidationError):
        ContentCampaignCreate(
            name="非法币种",
            budget_amount="100.00",  # type: ignore[arg-type]
            budget_currency="RMB1",
        )


def test_campaign_workflow_projects_server_actions_by_status_and_scope() -> None:
    empty_counts = ContentCampaignCounts(
        product_count=0,
        topic_count=0,
        platform_count=0,
        monitoring_plan_count=0,
        task_count=0,
        published_article_count=0,
    )
    stage, primary, actions, deletion = _campaign_workflow("DRAFT", empty_counts)
    assert stage == "DRAFT"
    assert primary == "CONFIGURE_CAMPAIGN"
    assert actions == ["UPDATE", "ARCHIVE", "DELETE"]
    assert deletion is not None and deletion.blockers == []

    scoped_with_tasks = ContentCampaignCounts(
        product_count=1,
        topic_count=1,
        platform_count=1,
        monitoring_plan_count=0,
        task_count=2,
        published_article_count=1,
    )
    stage, primary, actions, deletion = _campaign_workflow("DRAFT", scoped_with_tasks)
    assert primary == "ACTIVATE_CAMPAIGN"
    assert "ACTIVATE" in actions and "PLAN_TASKS" in actions and "DELETE" not in actions
    assert deletion is not None and deletion.blockers[0].count == 2

    _, primary, actions, deletion = _campaign_workflow("ACTIVE", scoped_with_tasks)
    assert primary == "MANAGE_CAMPAIGN"
    assert actions == ["UPDATE", "PLAN_TASKS", "PAUSE", "COMPLETE", "ARCHIVE"]
    assert deletion is None

    _, primary, actions, _ = _campaign_workflow("COMPLETED", scoped_with_tasks)
    assert primary == "ARCHIVE_CAMPAIGN"
    assert actions == ["ARCHIVE"]

    _, primary, actions, _ = _campaign_workflow("ARCHIVED", scoped_with_tasks)
    assert primary == "VIEW_HISTORY"
    assert actions == []


def test_content_task_create_requires_query_topic_and_brief() -> None:
    brief = ContentBriefInput(
        target_question="  TPS5430 有哪些国产替代型号？  ",
        search_intent=IntentType.REPLACEMENT,
        content_angle="  国产替代选型指南  ",
        must_answer_questions=["  封装差异  "],
        forbidden_expressions=["  完全等效替代  "],
        success_metrics=ContentBriefSuccessMetrics(notes="   "),
    )
    assert brief.target_question == "TPS5430 有哪些国产替代型号？"
    assert brief.content_angle == "国产替代选型指南"
    assert brief.success_metrics.notes is None

    payload = ContentTaskCreate(
        product_id=uuid.uuid4(),
        fact_version_id=uuid.uuid4(),
        platform_profile_id=uuid.uuid4(),
        query_topic_id=uuid.uuid4(),
        brief=brief,
    )
    assert payload.campaign_id is None

    with pytest.raises(ValidationError):
        ContentTaskCreate.model_validate(
            {
                "product_id": str(uuid.uuid4()),
                "fact_version_id": str(uuid.uuid4()),
                "platform_profile_id": str(uuid.uuid4()),
            }
        )


def test_query_topic_schema_supports_description_and_is_active() -> None:
    created = QueryTopicCreate(
        canonical_question="如何选择降压芯片？",
        intent_type=IntentType.PRODUCT,
        variants=["降压芯片选型"],
        description="  面向电源工程师  ",
    )
    assert created.description == "面向电源工程师"

    updated = QueryTopicUpdate(
        canonical_question="如何选择降压芯片？",
        intent_type=IntentType.PRODUCT,
        variants=["降压芯片选型"],
        description="停用说明",
        is_active=False,
        expected_revision=0,
    )
    assert updated.is_active is False
