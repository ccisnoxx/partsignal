"""确定性开发生成器和质量规则测试。"""

from typing import cast

import pytest

from app.errors import AppError
from app.models.content import ContentTask
from app.models.product_facts import (
    FactVersion,
    Product,
)
from app.schemas.geo_files import GeneratedDraft
from app.schemas.product_facts import Confidentiality, ProductFactsBody
from app.services.generation import (
    DevelopmentContentGenerator,
    ensure_generation_eligible,
    ensure_generation_sources_public,
    ensure_humanization_egress_allowed,
    ensure_third_party_egress_allowed,
    generation_timeout_seconds,
    run_quality_checks,
    text_similarity,
)


def humanization_input() -> dict[str, object]:
    """构造与生产自然化快照一致的最小输入。"""
    original = generation_input()
    approved_facts = cast(dict[str, object], original["approved_facts"])
    approved_facts["evidence_confidentialities"] = ["PUBLIC"]
    return {
        "adapter_name": "openai-compatible-chat-completions",
        "contract_version": "humanization-json-v1",
        "channel": {"id": "channel", "timeout_seconds": 30},
        "model": {"id": "model", "model_id": "demo", "request_parameters": {}},
        "humanization_prompt": {"revision": 3, "template_markdown": "改善表达。"},
        "source_content": {
            "id": "00000000-0000-0000-0000-000000000010",
            "task_id": "00000000-0000-0000-0000-000000000011",
            "fact_version_id": "00000000-0000-0000-0000-000000000001",
            "version": 1,
            "content_hash": "a" * 64,
            "title": "DEMO-001",
            "summary": "摘要",
            "body_markdown": "使用前必须核对具体应用条件。",
            "tags": ["DEMO-001"],
        },
        "source_generation_job_id": "00000000-0000-0000-0000-000000000012",
        "user_prompt_markdown": original["user_prompt_markdown"],
        "generation_data_classification": "PUBLIC",
        "generation_data_classified_by": "00000000-0000-0000-0000-000000000002",
        "generation_data_classified_at": "2026-07-17T00:00:00Z",
        "approved_facts": approved_facts,
        "task_requirements": original["task_requirements"],
        "system_message": "只改写表达并返回严格 JSON",
        "user_message": "源文章、批准事实与任务要求",
    }


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


def test_generation_sources_require_public_task_and_every_evidence() -> None:
    task = cast(
        ContentTask,
        type(
            "Task",
            (),
            {
                "generation_data_classification": "PUBLIC",
                "generation_data_classified_by": "actor",
                "generation_data_classified_at": "time",
            },
        )(),
    )
    public_facts = cast(
        ProductFactsBody,
        type(
            "Facts",
            (),
            {"evidences": [type("Evidence", (), {"confidentiality": Confidentiality.PUBLIC})()]},
        )(),
    )
    ensure_generation_sources_public(task, public_facts)

    public_facts.evidences[0].confidentiality = Confidentiality.INTERNAL
    with pytest.raises(AppError) as captured:
        ensure_generation_sources_public(task, public_facts)
    assert captured.value.code == "AI_DATA_CLASSIFICATION_FORBIDDEN"


def test_generation_lease_timeout_comes_from_immutable_snapshot() -> None:
    input_data = generation_input()
    input_data["channel"] = {"id": "channel", "timeout_seconds": 600}

    assert generation_timeout_seconds(input_data) == 600


def test_humanization_snapshot_reuses_public_and_quality_boundaries() -> None:
    input_data = humanization_input()
    snapshot = ensure_humanization_egress_allowed(input_data)
    assert snapshot.humanization_prompt.revision == 3
    draft = GeneratedDraft(
        title="DEMO-001",
        summary="摘要",
        body_markdown="参数为 99 V。使用前必须核对具体应用条件。",
        tags=["DEMO-001"],
    )
    issues = run_quality_checks(draft, input_data, job_type="HUMANIZE")
    assert any(issue["code"] == "UNKNOWN_NUMERIC_FACT" for issue in issues)
    assert generation_timeout_seconds(input_data, job_type="HUMANIZE") == 30


def test_humanization_snapshot_rejects_non_public_history() -> None:
    input_data = humanization_input()
    input_data["generation_data_classification"] = "INTERNAL"
    with pytest.raises(AppError) as captured:
        ensure_humanization_egress_allowed(input_data)
    assert captured.value.code == "AI_DATA_CLASSIFICATION_FORBIDDEN"


def test_third_party_egress_requires_public_task_and_evidence_classification() -> None:
    input_data = generation_input()
    input_data["adapter_name"] = "openai-compatible-chat-completions"
    input_data["generation_data_classification"] = "PUBLIC"
    input_data["generation_data_classified_by"] = "00000000-0000-0000-0000-000000000002"
    input_data["generation_data_classified_at"] = "2026-07-11T00:00:00Z"
    approved_facts = cast(dict[str, object], input_data["approved_facts"])
    approved_facts["evidence_confidentialities"] = ["PUBLIC"]

    snapshot = ensure_third_party_egress_allowed(input_data)
    assert snapshot.generation_data_classification is not None
    assert snapshot.generation_data_classification.value == "PUBLIC"


@pytest.mark.parametrize(
    ("classification", "evidence_classifications"),
    [(None, ["PUBLIC"]), ("INTERNAL", ["PUBLIC"]), ("PUBLIC", ["RESTRICTED"]), ("PUBLIC", None)],
)
def test_third_party_egress_rejects_missing_or_non_public_classification(
    classification: object, evidence_classifications: object
) -> None:
    input_data = generation_input()
    input_data["adapter_name"] = "openai-compatible-chat-completions"
    input_data["generation_data_classification"] = classification
    input_data["generation_data_classified_by"] = "00000000-0000-0000-0000-000000000002"
    input_data["generation_data_classified_at"] = "2026-07-11T00:00:00Z"
    approved_facts = cast(dict[str, object], input_data["approved_facts"])
    if evidence_classifications is not None:
        approved_facts["evidence_confidentialities"] = evidence_classifications

    with pytest.raises(AppError) as captured:
        ensure_third_party_egress_allowed(input_data)
    assert captured.value.code == "AI_DATA_CLASSIFICATION_FORBIDDEN"


@pytest.mark.parametrize("timeout", [True, 9, 601, "30", None])
def test_generation_lease_rejects_invalid_snapshot_timeout(timeout: object) -> None:
    input_data = generation_input()
    input_data["channel"] = {"id": "channel", "timeout_seconds": timeout}

    with pytest.raises(AppError, match="快照超时无效"):
        generation_timeout_seconds(input_data)
