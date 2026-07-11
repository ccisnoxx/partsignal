"""确定性开发生成器和质量规则测试。"""

from typing import cast

import pytest

from app.errors import AppError
from app.models import ContentTask, FactVersion, Product
from app.schemas import GeneratedDraft
from app.services.generation import (
    DevelopmentContentGenerator,
    ensure_generation_eligible,
    run_quality_checks,
    text_similarity,
)


def generation_input() -> dict[str, object]:
    return {
        "adapter_name": "development-deterministic",
        "contract_version": "chat-json-v1",
        "channel": {"id": "channel", "timeout_seconds": 30},
        "model": {"id": "model", "model_id": "demo", "request_parameters": {}},
        "platform_type": {"id": "type", "name": "开发", "slug": "dev"},
        "system_message": "只返回 JSON",
        "user_prompt_markdown": "补充输入批次 7",
        "approved_facts": {
            "fact_version_id": "00000000-0000-0000-0000-000000000001",
            "reference_parts": [],
            "parameters": [
                {
                    "client_key": "voltage",
                    "owner_key": "product",
                    "key": "voltage",
                    "name": "工作电压",
                    "value_type": "NUMERIC",
                    "min_value": None,
                    "typical_value": 5,
                    "max_value": None,
                    "text_value": None,
                    "unit": "V",
                    "test_conditions": "室温",
                    "is_critical": True,
                }
            ],
            "replacement_relations": [],
            "claims": [
                {
                    "type": "REQUIRED_DISCLOSURE",
                    "text": "使用前必须核对具体应用条件。",
                },
                {"type": "PROHIBITED", "text": "禁止承诺"},
            ],
        },
        "task_requirements": {
            "product": {"part_number": "DEMO-001", "brand": "DEMO", "category": "TEST"},
            "query_topic": {
                "canonical_question": "如何选用 DEMO-001？",
                "intent_type": "PRODUCT",
            },
            "platform_rules": {
                "target_audience": "开发测试人员",
                "title_min": 1,
                "title_max": 100,
                "body_min": 1,
                "body_max": 5000,
                "tone": "技术说明",
                "allow_external_links": True,
                "allow_tables": True,
                "allow_contact": False,
                "prohibited_phrases": ["绝对领先"],
                "sections": [],
            },
            "task": {
                "content_angle": "已批准参数说明",
                "canonical_url": "https://example.invalid/products/demo-001",
            },
        },
        "user_message": "工程师输入、批准事实与任务要求",
    }


def test_development_generator_only_uses_approved_fact_values() -> None:
    draft = DevelopmentContentGenerator().generate(generation_input())
    assert "5 V" in draft.body_markdown
    assert "使用前必须核对具体应用条件。" in draft.body_markdown
    assert draft.tags


def test_development_generator_rejects_empty_fact_snapshot() -> None:
    input_data = generation_input()
    input_data["approved_facts"] = {
        "fact_version_id": "00000000-0000-0000-0000-000000000001",
        "reference_parts": [],
        "parameters": [],
        "replacement_relations": [],
        "claims": [],
    }
    with pytest.raises(AppError, match="没有可用于生成的事实"):
        DevelopmentContentGenerator().generate(input_data)


def test_quality_check_blocks_prohibited_expressions() -> None:
    draft = GeneratedDraft(
        title="DEMO-001",
        summary="摘要",
        body_markdown="绝对领先，禁止承诺。使用前必须核对具体应用条件。",
        tags=["DEMO-001"],
    )
    issues = run_quality_checks(draft, generation_input())
    blocking_codes = {issue["code"] for issue in issues if issue["severity"] == "BLOCKING"}
    assert blocking_codes == {"PROHIBITED_PHRASE", "PROHIBITED_FACT_EXPRESSION"}


def test_quality_check_blocks_unapproved_numeric_fact() -> None:
    draft = DevelopmentContentGenerator().generate(generation_input())
    draft.body_markdown += "\n未经批准的参数为 99 V。"
    issues = run_quality_checks(draft, generation_input())
    numeric = [issue for issue in issues if issue["code"] == "UNKNOWN_NUMERIC_FACT"]
    assert len(numeric) == 1
    assert "99" in numeric[0]["message"]


def test_quality_check_allows_number_from_job_user_prompt() -> None:
    draft = DevelopmentContentGenerator().generate(generation_input())
    draft.body_markdown += "\n输入批次为 7。"
    issues = run_quality_checks(draft, generation_input())
    numeric_messages = [
        issue["message"] for issue in issues if issue["code"] == "UNKNOWN_NUMERIC_FACT"
    ]
    assert all("7" not in message for message in numeric_messages)


def test_quality_check_requires_disclosure_text() -> None:
    draft = DevelopmentContentGenerator().generate(generation_input())
    draft.body_markdown = draft.body_markdown.replace("使用前必须核对具体应用条件。", "")
    issues = run_quality_checks(draft, generation_input())
    assert any(issue["code"] == "REQUIRED_DISCLOSURE_MISSING" for issue in issues)


def test_text_similarity_handles_chinese_near_duplicates() -> None:
    original = "DEMO-001 工作电压说明。使用前必须核对具体应用条件。"
    near_duplicate = "DEMO-001 工作电压说明，使用前必须核对具体应用条件。"
    different = "另一产品的封装库存与交付周期说明。"

    assert text_similarity(original, near_duplicate) >= 0.85
    assert text_similarity(original, different) < 0.85


def test_worker_rejects_fact_retired_after_job_was_queued() -> None:
    task = cast(ContentTask, type("Task", (), {"status": "OPEN"})())
    fact = cast(
        FactVersion,
        type("Fact", (), {"id": "00000000-0000-0000-0000-000000000001", "status": "RETIRED"})(),
    )
    product = cast(Product, type("Product", (), {"status": "ACTIVE"})())

    with pytest.raises(AppError, match="事实或产品已失效"):
        ensure_generation_eligible(task, fact, product, str(fact.id))
